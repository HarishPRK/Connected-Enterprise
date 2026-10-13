import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { OnboardingOperation } from '../src/features/onboarding/types.js';

const ENDPOINT = 'alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com';
const SIGNING_KEY = 'arn:aws:kms:us-east-1:841019700679:key/a594c391-4827-4c5d-a433-fdf1b327e641';
const FILES = new Set(['bootstrap-certificate.pem', 'bootstrap-private-key.pem', 'AmazonRootCA1.pem', 'bootstrap-metadata.json', 'README.txt']);
export const MOCK_SERIAL = /^MOCK-[A-Z0-9][A-Z0-9._-]{0,90}$/;

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Only the bounded, uncompressed ZIP format issued by our bootstrap API. */
export function readSimulatorPackage(archive: Buffer): Map<string, Buffer> {
  const invalid = () => { throw new Error('Choose the original bootstrap ZIP downloaded from this application.'); };
  if (archive.length < 22 || archive.length > 64 * 1024) return invalid();
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== 0x06054b50 || archive.readUInt16LE(end + 4) || archive.readUInt16LE(end + 6)
    || archive.readUInt16LE(end + 8) !== 5 || archive.readUInt16LE(end + 10) !== 5 || archive.readUInt16LE(end + 20)) return invalid();
  const directory = archive.readUInt32LE(end + 16);
  if (directory + archive.readUInt32LE(end + 12) !== end) return invalid();
  const files = new Map<string, Buffer>();
  const offsets = new Map<string, number>();
  let offset = 0;
  while (offset < directory) {
    if (offset + 30 > directory || archive.readUInt32LE(offset) !== 0x04034b50
      || archive.readUInt16LE(offset + 6) || archive.readUInt16LE(offset + 8) || archive.readUInt16LE(offset + 28)) return invalid();
    const size = archive.readUInt32LE(offset + 18);
    const nameEnd = offset + 30 + archive.readUInt16LE(offset + 26);
    if (archive.readUInt32LE(offset + 22) !== size || nameEnd + size > directory) return invalid();
    const name = archive.subarray(offset + 30, nameEnd).toString('utf8');
    const data = archive.subarray(nameEnd, nameEnd + size);
    if (!FILES.has(name) || files.has(name) || crc32(data) !== archive.readUInt32LE(offset + 14)) return invalid();
    files.set(name, data); offsets.set(name, offset); offset = nameEnd + size;
  }
  if (offset !== directory || files.size !== 5) return invalid();
  const checked = new Set<string>();
  for (let i = 0; i < 5; i++) {
    if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50) return invalid();
    const next = offset + 46 + archive.readUInt16LE(offset + 28) + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32);
    if (next > end) return invalid();
    const name = archive.subarray(offset + 46, offset + 46 + archive.readUInt16LE(offset + 28)).toString('utf8');
    const file = files.get(name);
    if (!file || checked.has(name) || archive.readUInt16LE(offset + 8) || archive.readUInt16LE(offset + 10)
      || archive.readUInt32LE(offset + 16) !== crc32(file) || archive.readUInt32LE(offset + 20) !== file.length
      || archive.readUInt32LE(offset + 24) !== file.length || archive.readUInt32LE(offset + 42) !== offsets.get(name)) return invalid();
    checked.add(name); offset = next;
  }
  if (offset !== end) return invalid();
  return files;
}

export function validateSimulatorAssignment(metadata: Record<string, unknown>, operation: OnboardingOperation, tenantId: string): void {
  if (!MOCK_SERIAL.test(operation.serialNumber) || operation.type !== 'ONBOARD' || operation.status !== 'IN_PROGRESS') {
    throw new Error('Use an activating gateway whose ID starts with MOCK-.');
  }
  if (tenantId !== 'ce-test' || metadata.tenantId !== tenantId || metadata.formatVersion !== 1
    || metadata.serialNumber !== operation.serialNumber || metadata.siteId !== operation.siteId
    || metadata.profileVersionId !== operation.profileVersionId || metadata.initialGeneration !== operation.deploymentGeneration
    || metadata.region !== 'us-east-1' || metadata.iotDataEndpoint !== ENDPOINT
    || metadata.fleetProvisioningTemplateName !== 'CEOnboarding-dev'
    || typeof metadata.certificateId !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.certificateId)) {
    throw new Error('This package does not match the live mock gateway, assignment, or AWS environment.');
  }
}

export interface SimulatorJob {
  operationId: string;
  state: 'running' | 'completed' | 'failed';
  phase: string;
  startedAt: string;
}

export function createOnboardingSimulator() {
  const jobs = new Map<string, SimulatorJob>();
  const pending = new Set<string>();
  const root = join(homedir(), '.local', 'share', 'connected-enterprise', 'mock-gateways');
  return {
    status(operationId: string): SimulatorJob | undefined { return jobs.get(operationId); },
    async prepare(operation: OnboardingOperation): Promise<void> {
      if (!MOCK_SERIAL.test(operation.serialNumber)) throw new Error('Use a MOCK- gateway ID.');
      if (jobs.has(operation.id)) return;
      if (jobs.size >= 50 || pending.size + [...jobs.values()].filter(job => job.state === 'running').length >= 2) {
        throw new Error('The simulator is busy. Wait for the current mock gateway to finish.');
      }
      try { await lstat(join(root, operation.serialNumber)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      throw new Error('This mock gateway already has simulator state. Use a new MOCK- ID for a fresh run.');
    },
    async start(operation: OnboardingOperation, tenantId: string, encodedArchive: unknown): Promise<SimulatorJob> {
      const existing = jobs.get(operation.id);
      if (existing) return existing;
      if (pending.has(operation.id)) throw new Error('The simulator is starting. Check again in a moment.');
      if (jobs.size >= 50 || pending.size + [...jobs.values()].filter(job => job.state === 'running').length >= 2) {
        throw new Error('The simulator is busy. Wait for the current mock gateway to finish.');
      }
      if (typeof encodedArchive !== 'string' || encodedArchive.length > 90_000) throw new Error('Select a bootstrap ZIP smaller than 64 KiB.');
      const archive = Buffer.from(encodedArchive, 'base64');
      if (archive.toString('base64') !== encodedArchive) throw new Error('The bootstrap upload is invalid.');
      const files = readSimulatorPackage(archive);
      const metadata = JSON.parse(files.get('bootstrap-metadata.json')!.toString('utf8')) as Record<string, unknown>;
      if (!metadata || typeof metadata !== 'object') throw new Error('Invalid bootstrap metadata.');
      validateSimulatorAssignment(metadata, operation, tenantId);
      const certificate = new X509Certificate(files.get('bootstrap-certificate.pem')!);
      if (createHash('sha256').update(certificate.raw).digest('hex') !== metadata.certificateId
        || !certificate.checkPrivateKey(createPrivateKey(files.get('bootstrap-private-key.pem')!))) {
        throw new Error('The bootstrap certificate and key do not match this package.');
      }
      pending.add(operation.id);
      const stateDirectory = join(root, operation.serialNumber);
      try {
        await mkdir(root, { recursive: true, mode: 0o700 });
        try { await mkdir(stateDirectory, { mode: 0o700 }); }
        catch { throw new Error('This mock gateway already has simulator state. Use a new MOCK- ID for a fresh demonstration.'); }
        for (const name of ['bootstrap-certificate.pem', 'bootstrap-private-key.pem', 'AmazonRootCA1.pem']) {
          await writeFile(join(stateDirectory, name), files.get(name)!, { mode: 0o600, flag: 'wx' });
        }
        const job: SimulatorJob = { operationId: operation.id, state: 'running', phase: 'Connecting with bootstrap certificate', startedAt: new Date().toISOString() };
        jobs.set(operation.id, job);
        const log = createWriteStream(join(stateDirectory, 'simulator.log'), { flags: 'wx', mode: 0o600 });
        const child = spawn(process.execPath, ['--import', 'tsx', resolve('tools/gateway-simulator/src/index.ts'),
          '--endpoint', ENDPOINT, '--template', 'CEOnboarding-dev', '--serial', operation.serialNumber,
          '--generation', String(operation.deploymentGeneration), '--state-dir', stateDirectory,
          '--signing-key-id', SIGNING_KEY, '--signing-public-key', resolve('tools/gateway-simulator/config/dev-profile-signing-public-key.der'),
          '--root-ca', join(stateDirectory, 'AmazonRootCA1.pem'), '--step-delay-ms', '4000', '--timeout-ms', '45000',
        ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const phases: Record<string, string> = {
          bootstrap: 'Connecting to AWS IoT', csr: 'Submitting certificate request', issued: 'Operational certificate issued',
          registered: 'AWS Thing registered', provisioned: 'Operational identity stored', connected: 'Connected with permanent identity',
          verified: 'Signed configuration verified', status: 'Applying configuration and checking health', healthy: 'Healthy acknowledgement sent to AWS',
        };
        let lines = '';
        child.stdout.on('data', (data: Buffer) => {
          lines = (lines + data.toString('utf8')).slice(-8192);
          const split = lines.split('\n'); lines = split.pop() ?? '';
          for (const line of split) { const stage = /^\[[^\]]+\]\s+(\w+)/.exec(line)?.[1]; if (stage && phases[stage]) job.phase = phases[stage]; }
        });
        child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
        const timeout = setTimeout(() => child.kill(), 180_000);
        log.on('error', () => { child.kill(); job.state = 'failed'; job.phase = 'Simulator storage is unavailable. Contact the operator.'; });
        child.on('error', () => { job.state = 'failed'; job.phase = 'Simulator could not start. Contact the operator.'; });
        child.on('close', (code) => {
          clearTimeout(timeout); log.end(); job.state = code === 0 ? 'completed' : 'failed';
          job.phase = code === 0 ? 'Simulator finished. Waiting for the AWS operation to confirm completion.' : 'The simulator stopped before completion. The AWS status above remains authoritative; contact the operator before retrying.';
        });
        return job;
      } finally { pending.delete(operation.id); }
    },
  };
}
