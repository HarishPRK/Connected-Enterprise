export type OperationStatus =
  | 'WAITING_FOR_DEVICE'
  | 'IDENTITY_PROVISIONING'
  | 'PERMANENT_IDENTITY_ACTIVE'
  | 'PROFILE_AVAILABLE'
  | 'PROFILE_DELIVERED'
  | 'APPLYING'
  | 'APPLIED_HEALTHY'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'FAILED';

export interface OperationStep {
  key: string;
  label: string;
  status: 'pending' | 'in_progress' | 'complete' | 'error';
  detail?: string;
  timestamp?: string;
}

export const INITIAL_OPERATION_STEPS: OperationStep[] = [
  { key: 'ownership', label: 'Ownership verified', status: 'complete' },
  { key: 'identity', label: 'Permanent identity provisioned', status: 'pending' },
  { key: 'profile', label: 'Signed profile delivered', status: 'pending' },
  { key: 'apply', label: 'Profile applied transactionally', status: 'pending' },
  { key: 'health', label: 'Connectivity and service health validated', status: 'pending' },
];

export function publicOperation(item: Record<string, unknown>): Record<string, unknown> {
  const state = String(item.state ?? legacyState(item.status));
  const status = item.operationStatus ?? (
    state === 'APPLIED_HEALTHY' || state === 'DECOMMISSIONED' ? 'SUCCEEDED'
      : state === 'FAILED' || state === 'ROLLED_BACK' ? 'FAILED'
        : 'IN_PROGRESS'
  );
  return {
    id: item.operationId,
    type: item.type ?? 'ONBOARD',
    status,
    state,
    gatewayId: item.gatewayId,
    serialNumber: item.serialNumber,
    siteId: item.siteId,
    profileVersionId: item.profileVersionId,
    previousProfileVersionId: item.previousProfileVersionId,
    deploymentGeneration: item.deploymentGeneration ?? item.generation ?? 1,
    timeline: item.timeline ?? [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    steps: item.steps,
    ...(item.nextTransitionAt ? { nextTransitionAt: item.nextTransitionAt } : {}),
    ...(item.failure ? { failure: item.failure } : {}),
    ...(item.error ? { error: item.error } : {}),
  };
}

function legacyState(status: unknown): string {
  switch (status) {
    case 'WAITING_FOR_DEVICE': return 'CLAIM_ACCEPTED';
    case 'IDENTITY_PROVISIONING': return 'CSR_VERIFIED';
    case 'PERMANENT_IDENTITY_ACTIVE': return 'OPERATIONAL_IDENTITY_ISSUED';
    case 'PROFILE_AVAILABLE':
    case 'PROFILE_DELIVERED': return 'PROFILE_STAGED';
    case 'APPLYING': return 'APPLYING';
    case 'APPLIED_HEALTHY': return 'APPLIED_HEALTHY';
    case 'ROLLING_BACK': return 'ROLLING_BACK';
    case 'ROLLED_BACK': return 'ROLLED_BACK';
    case 'FAILED': return 'FAILED';
    default: return 'CLAIM_ACCEPTED';
  }
}
