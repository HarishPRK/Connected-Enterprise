import type { Gateway, OnboardingOperation, ProfileVersion } from './types';

export function profileAssignmentOperationFor(
  gateway: Gateway,
  operations: OnboardingOperation[],
): OnboardingOperation | undefined {
  const assignedProfileVersionId = gateway.desiredProfileVersionId ?? gateway.profileVersionId;
  if (!assignedProfileVersionId) return undefined;
  return operations
    .filter((operation) => operation.gatewayId === gateway.id
      && operation.type === 'PROFILE_DEPLOY'
      && operation.deploymentGeneration === gateway.deploymentGeneration
      && operation.profileVersionId === assignedProfileVersionId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

export function compatibleProfileVersions(
  profiles: ProfileVersion[],
  gateway: Gateway,
  operation?: OnboardingOperation,
): ProfileVersion[] {
  const canRedeployAppliedProfile = gateway.certificateState === 'ACTIVE'
    && gateway.state === 'ACTIVE'
    && (gateway.health === 'HEALTHY'
      || isAuthenticatedPullConfirmedAssignment(gateway, operation)
      || isLegacyHttpCompletedProfileAssignment(gateway, operation));
  return profiles
    .filter((profile) => profile.modelId === gateway.modelId
      && (canRedeployAppliedProfile
        || (profile.id !== gateway.profileVersionId
          && profile.id !== gateway.desiredProfileVersionId)))
    .sort((left, right) => right.version - left.version || left.name.localeCompare(right.name));
}

export function isAuthenticatedPullConfirmedOperation(operation: OnboardingOperation): boolean {
  return operation.status === 'SUCCEEDED'
    && operation.state === 'APPLIED_HEALTHY'
    && operation.configurationSource === 'CONTROLLER'
    && operation.configurationConfirmationMethod === 'AUTHENTICATED_CONFIGURATION_PULL';
}

export function isAuthenticatedPullConfirmedAssignment(
  gateway: Gateway,
  operation?: OnboardingOperation,
): boolean {
  const desiredProfileVersionId = gateway.desiredProfileVersionId ?? gateway.profileVersionId;
  const gatewayEvidence = gateway.configurationSource === 'CONTROLLER'
    && gateway.configurationConfirmationMethod === 'AUTHENTICATED_CONFIGURATION_PULL';
  const operationEvidence = operation !== undefined
    && isAuthenticatedPullConfirmedOperation(operation)
    && operation.type === 'PROFILE_DEPLOY'
    && operation.gatewayId === gateway.id
    && operation.deploymentGeneration === gateway.deploymentGeneration
    && operation.profileVersionId === desiredProfileVersionId;
  return gateway.certificateState === 'ACTIVE'
    && gateway.state === 'ACTIVE'
    && Boolean(gateway.profileVersionId)
    && gateway.profileVersionId === desiredProfileVersionId
    && (gatewayEvidence || operationEvidence);
}

export function automaticControllerAssignmentProfile(
  profiles: ProfileVersion[],
  gateway: Gateway,
): ProfileVersion | undefined {
  const associatedProfileIds = [gateway.profileVersionId, gateway.desiredProfileVersionId]
    .filter((profileVersionId): profileVersionId is string => Boolean(profileVersionId));

  for (const profileVersionId of associatedProfileIds) {
    const profile = profiles.find((candidate) => candidate.id === profileVersionId);
    if (profile?.modelId === gateway.modelId) return profile;
  }
  return undefined;
}

export function isLegacyHttpCompletedProfileAssignment(
  gateway: Gateway,
  operation?: OnboardingOperation,
): boolean {
  const desiredProfileVersionId = gateway.desiredProfileVersionId ?? gateway.profileVersionId;
  const hasLegacyCompletionMarker = operation?.timeline.some((entry) => (
    entry.state === 'APPLIED_HEALTHY'
      && entry.detail.includes('health-validated via HTTPS fetch')
  ));
  return gateway.certificateState === 'ACTIVE'
    && gateway.state === 'ACTIVE'
    && gateway.health === 'APPLYING'
    && !gateway.profileVersionId
    && !gateway.appliedProfileChecksum
    && Boolean(desiredProfileVersionId)
    && gateway.deploymentGeneration >= 1
    && operation?.type === 'PROFILE_DEPLOY'
    && operation.status === 'SUCCEEDED'
    && operation.state === 'APPLIED_HEALTHY'
    && operation.gatewayId === gateway.id
    && operation.deploymentGeneration === gateway.deploymentGeneration
    && operation.profileVersionId === desiredProfileVersionId
    && hasLegacyCompletionMarker === true;
}

export function canSupersedeUnconfirmedProfileAssignment(
  gateway: Gateway,
  activeOperation?: OnboardingOperation,
): boolean {
  const desiredProfileVersionId = gateway.desiredProfileVersionId ?? gateway.profileVersionId;
  const assignmentLineageMatches = gateway.certificateState === 'ACTIVE'
    && gateway.state === 'ACTIVE'
    && gateway.health === 'APPLYING'
    && Boolean(desiredProfileVersionId)
    && gateway.deploymentGeneration >= 1
    && activeOperation?.type === 'PROFILE_DEPLOY'
    && activeOperation.gatewayId === gateway.id
    && activeOperation.deploymentGeneration === gateway.deploymentGeneration
    && activeOperation.profileVersionId === desiredProfileVersionId;
  return assignmentLineageMatches && (
    (activeOperation.status === 'IN_PROGRESS' && activeOperation.state === 'PROFILE_STAGED')
      || isLegacyHttpCompletedProfileAssignment(gateway, activeOperation)
  );
}
