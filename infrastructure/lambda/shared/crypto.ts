import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { HARDWARE_PROOF_SECRET_ARN } from './config.js';
import { InputError } from './ddb.js';
import { requireActivationCode } from './manufacturing-credentials.js';

const secrets = new SecretsManagerClient({});
let cachedPepper: Buffer | undefined;

export async function hardwareProofDigest(serialNumber: string, proof: unknown): Promise<string> {
  const normalizedProof = activationCode(proof);
  const pepper = await getPepper();
  return createHmac('sha256', pepper).update(serialNumber).update('\0').update(normalizedProof).digest('hex');
}

export function activationCode(value: unknown): string {
  try {
    return requireActivationCode(value);
  } catch {
    throw new InputError('activationCode must be an exact 16-256 character high-entropy manufacturing credential');
  }
}

export function safeDigestEqual(expected: unknown, supplied: string): boolean {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const left = Buffer.from(expected.toLowerCase(), 'hex');
  const right = Buffer.from(supplied.toLowerCase(), 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

async function getPepper(): Promise<Buffer> {
  if (cachedPepper) return cachedPepper;
  if (!HARDWARE_PROOF_SECRET_ARN) throw new Error('Hardware proof secret is not configured');
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: HARDWARE_PROOF_SECRET_ARN }));
  const raw = result.SecretString ?? (result.SecretBinary ? Buffer.from(result.SecretBinary).toString('utf8') : '');
  if (!raw) throw new Error('Hardware proof secret is empty');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Hardware proof secret must be a JSON object containing pepper');
  }
  const pepper = (parsed as { pepper?: unknown } | null)?.pepper;
  if (typeof pepper !== 'string' || pepper.length < 32) throw new Error('Hardware proof secret pepper is missing or too short');
  cachedPepper = Buffer.from(pepper, 'utf8');
  return cachedPepper;
}
