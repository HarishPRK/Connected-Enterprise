import type { Gateway, OnboardingOperation, VerificationResult } from './types';

export interface BootstrapRegistration {
  tenantId: string;
  serialNumber: string;
  modelId: string;
  siteId: string;
  profileVersionId: string;
  certificateId: string;
  verifyKey: string;
  operationKey: string;
  verification?: { verificationId: string; expiresAt: string };
  activationAttempted?: boolean;
}

type KeyFactory = (scope: string) => string;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A serial can be reused after reset. Only the surviving gateway and its
 * current registration can establish that a package already has an operation. */
export function currentBootstrapOperation(
  registration: BootstrapRegistration,
  operations: readonly OnboardingOperation[],
  gateways: readonly Gateway[],
): OnboardingOperation | undefined {
  const gateway = gateways.find((item) => item.serialNumber === registration.serialNumber
    && item.modelId === registration.modelId && item.siteId === registration.siteId
    && !['DECOMMISSIONED', 'DECOMMISSIONING'].includes(item.state));
  if (!gateway) return undefined;
  const registeredAt = Date.parse(gateway.createdAt);
  if (!Number.isFinite(registeredAt)) return undefined;
  return operations.filter((operation) => operation.type === 'ONBOARD'
    && operation.gatewayId === gateway.id && operation.serialNumber === registration.serialNumber
    && operation.siteId === registration.siteId && operation.profileVersionId === registration.profileVersionId
    && operation.failure?.code !== 'GATEWAY_RESET' && !operation.registrationReleased && !operation.resetForOnboarding
    && !['DECOMMISSIONED', 'DECOMMISSIONING'].includes(operation.state)
    && Date.parse(operation.createdAt) >= registeredAt)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

/** Extract only assignment metadata. Certificates and private keys are never
 * read, uploaded, or retained by the continuation flow. */
export function registrationFromMetadata(raw: unknown, tenantId: string, createKey: KeyFactory): BootstrapRegistration {
  if (!raw || typeof raw !== 'object') throw new Error('Choose bootstrap-metadata.json from your downloaded package.');
  const value = raw as Record<string, unknown>;
  if (value.formatVersion !== 1 || value.tenantId !== tenantId) {
    throw new Error('Choose a bootstrap package issued for your current tenant.');
  }
  for (const key of ['serialNumber', 'modelId', 'siteId', 'profileVersionId']) {
    if (typeof value[key] !== 'string' || !identifier.test(value[key] as string)) {
      throw new Error('The package metadata is missing a valid gateway, model, site, or profile.');
    }
  }
  if (typeof value.certificateId !== 'string' || !/^[a-f0-9]{64}$/i.test(value.certificateId)) {
    throw new Error('The package metadata is missing its certificate ID.');
  }
  return {
    tenantId,
    serialNumber: value.serialNumber as string,
    modelId: value.modelId as string,
    siteId: value.siteId as string,
    profileVersionId: value.profileVersionId as string,
    certificateId: value.certificateId,
    verifyKey: createKey('verify'),
    operationKey: createKey('activate'),
  };
}

/** Persist non-secret progress, scoped by tenant and signed-in user. Reusing
 * request keys lets a retry recover a committed operation after a lost reply. */
export function serializeRegistration(value: BootstrapRegistration): string {
  return JSON.stringify({
    formatVersion: 1,
    tenantId: value.tenantId,
    serialNumber: value.serialNumber,
    modelId: value.modelId,
    siteId: value.siteId,
    profileVersionId: value.profileVersionId,
    certificateId: value.certificateId,
    verifyKey: value.verifyKey,
    operationKey: value.operationKey,
    ...(value.verification ? { verification: {
      verificationId: value.verification.verificationId,
      expiresAt: value.verification.expiresAt,
    } } : {}),
    activationAttempted: value.activationAttempted === true,
  });
}

export function restoreRegistration(raw: string | null, tenantId: string, createKey: KeyFactory): BootstrapRegistration | undefined {
  try {
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    const result = registrationFromMetadata(value, tenantId, createKey);
    if (typeof value.verifyKey !== 'string' || !identifier.test(value.verifyKey)
      || typeof value.operationKey !== 'string' || !identifier.test(value.operationKey)) return undefined;
    result.verifyKey = value.verifyKey;
    result.operationKey = value.operationKey;
    if (value.verification) {
      if (typeof value.verification.verificationId !== 'string' || !identifier.test(value.verification.verificationId)
        || typeof value.verification.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.verification.expiresAt))) return undefined;
      result.verification = { verificationId: value.verification.verificationId, expiresAt: value.verification.expiresAt };
    }
    result.activationAttempted = value.activationAttempted === true;
    return result;
  } catch {
    return undefined;
  }
}

interface RegistrationActions {
  verify: (serialNumber: string, key: string, modelId: string) => Promise<VerificationResult>;
  activate: (verificationId: string, siteId: string, profileVersionId: string, key: string) => Promise<OnboardingOperation>;
  save: (value: BootstrapRegistration) => void;
  createKey: KeyFactory;
  now: () => number;
}

function expiredVerification(error: unknown): boolean {
  return error instanceof Error && 'status' in error && error.status === 409
    && ['Gateway verification expired', 'Gateway verification is missing or expired'].includes(error.message);
}

export async function completeBootstrapRegistration(
  original: BootstrapRegistration,
  actions: RegistrationActions,
): Promise<OnboardingOperation> {
  let progress = { ...original };
  const activate = () => actions.activate(
    progress.verification!.verificationId, progress.siteId, progress.profileVersionId, progress.operationKey,
  );
  // A prior activation may have succeeded even if its response was lost.
  if (progress.verification && progress.activationAttempted) {
    try {
      return await activate();
    } catch (error) {
      if (!expiredVerification(error)) throw error;
      progress = { ...progress, verification: undefined, activationAttempted: false,
        verifyKey: actions.createKey('verify'), operationKey: actions.createKey('activate') };
      actions.save(progress);
    }
  }
  if (progress.verification && Date.parse(progress.verification.expiresAt) <= actions.now()) {
    progress = { ...progress, verification: undefined,
      verifyKey: actions.createKey('verify'), operationKey: actions.createKey('activate') };
    actions.save(progress);
  }
  if (!progress.verification) {
    let result = await actions.verify(progress.serialNumber, progress.verifyKey, progress.modelId);
    // Recover an expired reservation replayed from an idempotent verify call.
    if (Date.parse(result.expiresAt) <= actions.now()) {
      progress = { ...progress, verifyKey: actions.createKey('verify'), operationKey: actions.createKey('activate') };
      actions.save(progress);
      result = await actions.verify(progress.serialNumber, progress.verifyKey, progress.modelId);
    }
    if (result.identity.serialNumber !== progress.serialNumber || result.identity.modelId !== progress.modelId
      || !result.allowedSites.some((site) => site.id === progress.siteId)) {
      throw new Error('This package does not match the authorized gateway and site. Check the downloaded package before continuing.');
    }
    if (!Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= actions.now()) {
      throw new Error('The gateway reservation has expired. Try verification again.');
    }
    progress = { ...progress, verification: { verificationId: result.verificationId, expiresAt: result.expiresAt } };
    actions.save(progress);
  }
  progress = { ...progress, activationAttempted: true };
  actions.save(progress);
  return activate();
}
