import type { Gateway, OnboardingOperation, ProfileVersion } from './types';

export function compatibleProfileVersions(
  profiles: ProfileVersion[],
  gateway: Gateway,
): ProfileVersion[] {
  return profiles
    .filter((profile) => profile.modelId === gateway.modelId
      && profile.id !== gateway.profileVersionId
      && profile.id !== gateway.desiredProfileVersionId)
    .sort((left, right) => right.version - left.version || left.name.localeCompare(right.name));
}

export function canSupersedeUnconfirmedProfileAssignment(
  gateway: Gateway,
  activeOperation?: OnboardingOperation,
): boolean {
  const desiredProfileVersionId = gateway.desiredProfileVersionId ?? gateway.profileVersionId;
  return gateway.certificateState === 'ACTIVE'
    && gateway.state === 'ACTIVE'
    && gateway.health === 'APPLYING'
    && Boolean(desiredProfileVersionId)
    && gateway.deploymentGeneration >= 1
    && activeOperation?.type === 'PROFILE_DEPLOY'
    && activeOperation.status === 'IN_PROGRESS'
    && activeOperation.state === 'PROFILE_STAGED'
    && activeOperation.deploymentGeneration === gateway.deploymentGeneration
    && activeOperation.profileVersionId === desiredProfileVersionId;
}
