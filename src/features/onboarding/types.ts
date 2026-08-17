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

export interface Tenant {
  id: string;
  name: string;
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

export type ProfileParameterValue = string | number | boolean;

export interface ProfileVersion {
  id: string;
  profileId: string;
  name: string;
  description: string;
  modelId: string;
  version: number;
  schemaVersion: number;
  parameters: Record<string, ProfileParameterValue>;
  contentHash: string;
  immutable: true;
  createdAt: string;
  createdBy: string;
  changeNote: string;
}

export interface OperationTimelineEntry {
  state: OnboardingState;
  at: string;
  detail: string;
}

export interface OnboardingOperation {
  id: string;
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

export interface OnboardingSnapshot {
  generatedAt: string;
  mode: 'local-simulator' | 'aws';
  tenant: Tenant;
  sites: Site[];
  gatewayModels: GatewayModel[];
  gateways: Gateway[];
  profiles: ProfileVersion[];
  operations: OnboardingOperation[];
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

export interface CreateProfileVersionInput {
  name: string;
  description: string;
  modelId: string;
  baseProfileVersionId?: string;
  parameters: Record<string, ProfileParameterValue>;
  changeNote: string;
}

export interface OnboardingEventEnvelope {
  type?: 'snapshot' | 'operation' | 'gateway' | 'profile';
  snapshot?: OnboardingSnapshot;
  operation?: OnboardingOperation;
  gateway?: Gateway;
  profile?: ProfileVersion;
}

export function siteLabel(site: Site): string {
  return `${site.name} · ${site.location}`;
}

export function profileVersionLabel(profile: ProfileVersion): string {
  return `${profile.name} v${profile.version}`;
}

export function isOperationTerminal(operation: OnboardingOperation): boolean {
  return operation.status !== 'IN_PROGRESS';
}

export function isOperationHealthy(operation: OnboardingOperation): boolean {
  return operation.status === 'SUCCEEDED' && operation.state === 'APPLIED_HEALTHY';
}
