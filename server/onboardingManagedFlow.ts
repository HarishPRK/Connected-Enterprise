import { createHash } from 'node:crypto';
import { INITIAL_ONBOARDING_GENERATION } from '../shared/onboarding-policy.js';
import type { OnboardingOperation, OnboardingSnapshot } from '../src/features/onboarding/types.js';
import { OnboardingAwsBridgeError, type createOnboardingAwsBridge } from './onboardingAwsBridge.js';
import { MOCK_SERIAL, type createOnboardingSimulator, type SimulatorJob } from './onboardingSimulator.js';
import type { ManagedBootstrapMetadata } from './onboardingManagedBootstrap.js';

interface PackageStore {
  prepare(): Promise<void>;
  load(serial: string): Promise<Buffer | undefined>;
  retain(archive: Buffer, expected?: Partial<ManagedBootstrapMetadata>): Promise<unknown>;
}

const issuanceLocks = new WeakMap<object, Promise<void>>();
/** Cover preflight, one-time issuance and durable retention with the same server-wide lock. */
export function withManagedBootstrapIssuance<T>(store: object, task: () => Promise<T>): Promise<T> {
  const previous = issuanceLocks.get(store) ?? Promise.resolve();
  const result = previous.then(task, task);
  issuanceLocks.set(store, result.then(() => undefined, () => undefined));
  return result;
}

interface Options {
  bridge: ReturnType<typeof createOnboardingAwsBridge>;
  simulator: ReturnType<typeof createOnboardingSimulator>;
  packages: PackageStore;
  tenantId: string;
}

function flowError(status: number, code: string, message: string): never {
  throw new OnboardingAwsBridgeError(status, code, message);
}

/** Credentials remain on the server; only an authoritative operation can select an assignment. */
export function createManagedOnboardingFlow({ bridge, simulator, packages, tenantId }: Options) {
  const starting = new Map<string, Promise<SimulatorJob>>();

  async function readOperation(operationId: string): Promise<OnboardingOperation> {
    const response = await bridge.forward({ method: 'GET', path: `/operations/${operationId}` });
    if (response.statusCode !== 200) flowError(response.statusCode, 'FLOW_OPERATION_UNAVAILABLE', 'The activation operation could not be loaded. Refresh its status and try again.');
    const payload = JSON.parse(response.body.toString('utf8'));
    const operation = (payload.operation ?? payload) as OnboardingOperation;
    if (operation.id !== operationId || tenantId !== 'ce-test' || !MOCK_SERIAL.test(operation.serialNumber) || operation.type !== 'ONBOARD') {
      flowError(400, 'FLOW_NOT_SUPPORTED', 'Initiate flow is available for a registered MOCK- gateway in the configured test tenant.');
    }
    return operation;
  }

  function assertActivating(operation: OnboardingOperation) {
    if (operation.status !== 'IN_PROGRESS' || !operation.profileVersionId || !operation.siteId
      || operation.deploymentGeneration !== INITIAL_ONBOARDING_GENERATION) {
      flowError(409, 'FLOW_NOT_ACTIVATING', 'This gateway is not awaiting activation. Its recorded operation status remains authoritative.');
    }
  }

  async function readAssignment(operation: OnboardingOperation) {
    const snapshotResponse = await bridge.forward({ method: 'GET', path: '/snapshot' });
    if (snapshotResponse.statusCode !== 200) flowError(502, 'FLOW_ASSIGNMENT_UNAVAILABLE', 'The gateway assignment could not be loaded. Try again after refreshing.');
    const snapshot = JSON.parse(snapshotResponse.body.toString('utf8')) as OnboardingSnapshot;
    const gateway = snapshot.gateways?.find(item => item.id === operation.gatewayId && item.serialNumber === operation.serialNumber);
    if (snapshot.tenant?.id !== tenantId || !gateway?.modelId || gateway.state !== 'PENDING' || gateway.siteId !== operation.siteId
      || gateway.deploymentGeneration !== operation.deploymentGeneration
      || (gateway.desiredProfileVersionId ?? gateway.profileVersionId) !== operation.profileVersionId) {
      flowError(409, 'FLOW_ASSIGNMENT_CHANGED', 'The gateway assignment changed. Refresh the activation workspace before initiating the flow.');
    }
    return gateway;
  }

  async function initiate(operationId: string): Promise<SimulatorJob> {
    const operation = await readOperation(operationId);
    const existing = simulator.status(operationId);
    if (existing) return existing;
    assertActivating(operation);
    try { await simulator.prepare(operation); }
    catch { flowError(409, 'FLOW_NOT_READY', 'The simulator is busy or this MOCK- gateway ID has already been used. Wait for running flows, or register a new MOCK- ID for a fresh run.'); }
    // Validate current assignment even when the credentials were retained by an earlier request.
    const gateway = await readAssignment(operation);

    let archive = await packages.load(operation.serialNumber);
    if (!archive) {
      archive = await withManagedBootstrapIssuance(packages, async () => {
        const retained = await packages.load(operation.serialNumber);
        if (retained) return retained;
        await packages.prepare();
        const issued = await bridge.forward({ method: 'POST', path: '/bootstrap-packages',
          idempotencyKey: `managed-flow-${createHash('sha256').update(operationId).digest('hex')}`,
          body: { serialNumber: operation.serialNumber, modelId: gateway.modelId, siteId: operation.siteId,
            profileVersionId: operation.profileVersionId, acknowledgeOneTimePrivateKey: true },
        });
        if (issued.statusCode === 409) flowError(409, 'FLOW_PACKAGE_NOT_RETAINED', 'This gateway already has a one-time bootstrap identity issued before managed flow was available. Register a new MOCK- gateway ID, then choose INITIATE FLOW.');
        if (issued.statusCode !== 201 || issued.headers['content-type'] !== 'application/zip') {
          flowError(502, 'FLOW_PACKAGE_UNAVAILABLE', 'The server could not prepare the gateway identity. Refresh the operation before retrying.');
        }
        await packages.retain(issued.body, { serialNumber: operation.serialNumber, modelId: gateway.modelId,
          siteId: operation.siteId, profileVersionId: operation.profileVersionId, initialGeneration: operation.deploymentGeneration,
          certificateId: issued.headers['x-certificate-id'] });
        return issued.body;
      });
    }
    const currentOperation = await readOperation(operationId);
    assertActivating(currentOperation);
    if (currentOperation.serialNumber !== operation.serialNumber || currentOperation.gatewayId !== operation.gatewayId
      || currentOperation.siteId !== operation.siteId || currentOperation.profileVersionId !== operation.profileVersionId
      || currentOperation.deploymentGeneration !== operation.deploymentGeneration) {
      flowError(409, 'FLOW_ASSIGNMENT_CHANGED', 'The gateway assignment changed while preparing the flow. Refresh its operation status.');
    }
    const currentGateway = await readAssignment(currentOperation);
    if (currentGateway.modelId !== gateway.modelId) flowError(409, 'FLOW_ASSIGNMENT_CHANGED', 'The gateway model changed. Refresh its operation status.');
    // Reusing an archive must preserve the exact current model as well as the
    // operation fields checked by the simulator. This never issues a new key.
    await packages.retain(archive, {
      tenantId: 'ce-test', serialNumber: currentOperation.serialNumber, modelId: currentGateway.modelId,
      siteId: currentOperation.siteId, profileVersionId: currentOperation.profileVersionId,
      initialGeneration: currentOperation.deploymentGeneration,
    });
    try {
      return await simulator.start(currentOperation, tenantId, archive.toString('base64'));
    } catch {
      flowError(409, 'FLOW_START_FAILED', 'The gateway flow could not start with its saved identity. Check the operation status; a previously used MOCK- gateway needs a new ID for a fresh run.');
    }
  }

  return {
    start(operationId: string): Promise<SimulatorJob> {
      const active = starting.get(operationId);
      if (active) return active;
      // Bound credential issuance as well as the simulator processes themselves.
      if (starting.size >= 2) return Promise.reject(new OnboardingAwsBridgeError(429, 'FLOW_BUSY', 'Two gateway flows are starting. Wait for one to finish before trying again.'));
      const work = initiate(operationId).finally(() => starting.delete(operationId));
      starting.set(operationId, work);
      return work;
    },
  };
}
