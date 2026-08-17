export const ONBOARDING_STATES = [
  'CLAIM_ACCEPTED',
  'CSR_VERIFIED',
  'OPERATIONAL_IDENTITY_ISSUED',
  'PROFILE_STAGED',
  'APPLYING',
  'HEALTH_CHECK',
  'APPLIED_HEALTHY',
  'DECOMMISSIONING',
  'CERTIFICATE_DEACTIVATED',
  'MQTT_SESSION_CLEARED',
  'DECOMMISSIONED',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'FAILED',
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];
export type OperationType = 'ONBOARD' | 'PROFILE_DEPLOY' | 'DECOMMISSION';
export type OperationStatus = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
export type GatewayState =
  | 'UNCLAIMED'
  | 'QUARANTINED'
  | 'PENDING'
  | 'ACTIVE'
  | 'ROLLED_BACK'
  | 'FAILED'
  | 'DECOMMISSIONING'
  | 'DECOMMISSIONED';

export interface OperatorContext {
  tenantId: string;
  actorId: string;
  actorEmail?: string;
}

export interface Site {
  id: string;
  name: string;
  location: string;
}

export interface GatewayModel {
  id: string;
  name: string;
  vendor: string;
  description: string;
}

export interface Gateway {
  id: string;
  thingName: string;
  serialNumber: string;
  modelId: string;
  hardwareRevision: string;
  siteId: string;
  state: GatewayState;
  certificateState: 'PENDING' | 'ACTIVE' | 'DEACTIVATING' | 'INACTIVE';
  health: 'UNKNOWN' | 'APPLYING' | 'HEALTHY' | 'DEGRADED';
  deploymentGeneration: number;
  profileVersionId?: string;
  desiredProfileVersionId?: string;
  appliedProfileChecksum?: string;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileVersion {
  id: string;
  profileId: string;
  name: string;
  description: string;
  modelId: string;
  version: number;
  schemaVersion: number;
  parameters: Record<string, unknown>;
  contentHash: string;
  immutable: true;
  createdAt: string;
  createdBy: string;
  changeNote: string;
}

export interface ManufacturingRecord {
  serialNumber: string;
  tenantId: string;
  modelId: string;
  hardwareRevision: string;
  manufacturingBatch: string;
  activationProofHash: string;
  state: 'CLAIMABLE' | 'RESERVED' | 'PROVISIONING' | 'CLAIMED' | 'RETIRED';
  allowedSiteIds: string[];
  reservedByVerificationId?: string;
  reservationExpiresAt?: string;
  gatewayId?: string;
}

export interface Verification {
  id: string;
  tenantId: string;
  serialNumber: string;
  modelId: string;
  hardwareRevision: string;
  manufacturingBatch: string;
  allowedSiteIds: string[];
  state: 'VERIFIED' | 'CONSUMED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface OperationTimelineEntry {
  state: OnboardingState;
  at: string;
  detail: string;
}

export interface OnboardingOperation {
  id: string;
  tenantId: string;
  type: OperationType;
  status: OperationStatus;
  state: OnboardingState;
  gatewayId: string;
  serialNumber: string;
  siteId: string;
  profileVersionId?: string;
  previousProfileVersionId?: string;
  deploymentGeneration: number;
  timeline: OperationTimelineEntry[];
  createdAt: string;
  updatedAt: string;
  nextTransitionAt?: string;
  failure?: {
    code: string;
    message: string;
    rolledBack: boolean;
  };
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  targetType: 'gateway' | 'profile' | 'operation' | 'verification';
  targetId: string;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
  requestId: string;
  at: string;
  beforeHash?: string;
  afterHash?: string;
  reason?: string;
}

export interface OutboxEvent {
  id: string;
  tenantId: string;
  type: string;
  aggregateId: string;
  generation?: number;
  payload: Record<string, unknown>;
  createdAt: string;
  dispatchedAt?: string;
}

export interface IdempotencyRecord {
  requestHash: string;
  response: unknown;
  createdAt: string;
}

export interface TenantState {
  tenant: { id: string; name: string };
  sites: Site[];
  gateways: Gateway[];
  profiles: ProfileVersion[];
  manufacturing: ManufacturingRecord[];
  verifications: Verification[];
  operations: OnboardingOperation[];
  audit: AuditEvent[];
  outbox: OutboxEvent[];
}

export interface OnboardingDatabase {
  schemaVersion: 1;
  tenants: Record<string, TenantState>;
  idempotency: Record<string, IdempotencyRecord>;
}

export interface OnboardingSnapshot {
  generatedAt: string;
  mode: 'local-simulator' | 'aws';
  tenant: TenantState['tenant'];
  sites: Site[];
  gatewayModels: GatewayModel[];
  gateways: Gateway[];
  profiles: ProfileVersion[];
  operations: OnboardingOperation[];
  auditTail: AuditEvent[];
}

export interface VerificationResult {
  verificationId: string;
  expiresAt: string;
  identity: {
    serialNumber: string;
    modelId: string;
    hardwareRevision: string;
    manufacturingBatch: string;
  };
  allowedSites: Site[];
}
