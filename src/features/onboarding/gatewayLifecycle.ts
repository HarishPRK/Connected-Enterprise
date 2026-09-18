import { isAuthenticatedPullConfirmedAssignment, isLegacyHttpCompletedProfileAssignment } from './gatewayProfileDeploymentEligibility';
import type { Gateway, OnboardingOperation } from './types';

export type GatewayGroup = 'activating' | 'ready' | 'attention' | 'retired';
export type JourneyStageState = 'complete' | 'current' | 'pending' | 'attention' | 'unconfirmed';
export interface JourneyStage {
  id: 'registration' | 'identity' | 'configuration' | 'validation';
  label: string;
  state: JourneyStageState;
  title: string;
  detail: string;
}
export interface GatewayJourney {
  group: GatewayGroup;
  title: string;
  detail: string;
  stages: JourneyStage[];
  focus: JourneyStage['id'];
}

/** Only the current generation can describe a gateway's present activation. */
export function currentGatewayOperation(gateway: Gateway, operations: OnboardingOperation[]) {
  return operations.filter(operation => operation.gatewayId === gateway.id
    && operation.deploymentGeneration === gateway.deploymentGeneration)
    .sort((left, right) => {
      const active = Number(right.status === 'IN_PROGRESS') - Number(left.status === 'IN_PROGRESS');
      return active || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })[0];
}

export function gatewayJourney(gateway: Gateway, operation?: OnboardingOperation): GatewayJourney {
  const current = operation?.gatewayId === gateway.id
    && operation.deploymentGeneration === gateway.deploymentGeneration ? operation : undefined;
  const activation = current?.type !== 'DECOMMISSION' ? current : undefined;
  const pullOnly = isAuthenticatedPullConfirmedAssignment(gateway, activation);
  const legacy = isLegacyHttpCompletedProfileAssignment(gateway, activation);
  const retiring = gateway.state === 'DECOMMISSIONING' || current?.type === 'DECOMMISSION';
  const retired = gateway.state === 'DECOMMISSIONED';
  const failed = gateway.state === 'FAILED' || gateway.state === 'ROLLED_BACK'
    || gateway.state === 'QUARANTINED' || gateway.health === 'DEGRADED'
    || current?.status === 'FAILED' || Boolean(current?.resetError);
  const healthy = gateway.state === 'ACTIVE' && gateway.health === 'HEALTHY'
    && !pullOnly && activation?.status !== 'IN_PROGRESS' && !retiring && !failed;
  const registered = gateway.state !== 'UNCLAIMED';
  const identity = gateway.certificateState === 'ACTIVE';
  const retrieved = pullOnly || legacy;
  const applying = activation?.state === 'APPLYING';
  const configured = retrieved || healthy || activation?.state === 'HEALTH_CHECK'
    || (activation?.status !== 'FAILED' && activation?.timeline.some(entry => entry.state === 'HEALTH_CHECK'));
  const stages: JourneyStage[] = [
    {
      id: 'registration', label: 'Registered', state: registered ? 'complete' : 'current',
      title: registered ? 'Gateway registration accepted' : 'Gateway registration required',
      detail: registered
        ? 'This gateway has a tenant-bound inventory record and site assignment.'
        : 'Initiate onboarding to prepare the gateway identity, site, and profile.',
    },
    {
      id: 'identity', label: 'Identity', state: identity ? 'complete' : registered ? 'current' : 'pending',
      title: identity ? 'Operational certificate active' : 'Waiting for device identity',
      detail: identity
        ? 'The gateway has an active operational certificate for authentication.'
        : 'Use the downloaded package on this gateway and start its onboarding client. This view updates when its operational identity is issued.',
    },
    {
      id: 'configuration', label: 'Configuration', state: configured ? 'complete' : identity ? 'current' : 'pending',
      title: retrieved ? 'Configuration retrieved' : configured ? 'Configuration applied' : applying ? 'Applying gateway configuration' : identity ? 'Waiting for configuration delivery' : 'Configuration follows identity',
      detail: retrieved
        ? 'Authenticated retrieval is confirmed for this generation. Retrieval alone does not confirm apply or health.'
        : configured
          ? 'The current generation has reached configuration validation.'
          : applying
            ? 'The gateway has received this generation and is applying its configuration. Health validation follows the apply step.'
            : identity
              ? 'The gateway must retrieve and apply its assigned configuration. Open the operation for delivery details.'
              : 'After the operational certificate is active, the gateway can retrieve its assigned configuration.',
    },
    {
      id: 'validation', label: 'Validation', state: pullOnly || legacy ? 'unconfirmed' : healthy ? 'complete' : configured ? 'current' : 'pending',
      title: pullOnly || legacy ? 'Device health not confirmed' : healthy ? 'Gateway activation complete' : configured ? 'Waiting for health validation' : 'Health checks follow configuration',
      detail: pullOnly || legacy
        ? 'The available evidence confirms retrieval only. Apply and device health have not been reported separately.'
        : healthy
          ? 'The gateway reported a healthy applied configuration for this generation.'
          : 'The gateway confirms configuration and management connectivity before activation is complete.',
    },
  ];
  let focus = stages.find(stage => stage.state === 'current' || stage.state === 'unconfirmed') ?? stages[3];
  if (retiring || retired) {
    // A stopped registration must never look like a live activation.
    for (const stage of stages) if (stage.state === 'current') stage.state = 'pending';
    const cleanupFailed = Boolean(current?.resetError)
      || (current?.type === 'DECOMMISSION' && current.status === 'FAILED');
    return {
      group: cleanupFailed ? 'attention' : 'retired', stages, focus: 'identity',
      title: cleanupFailed ? 'Gateway retirement needs attention' : retired ? 'Gateway decommissioned' : 'Gateway retirement in progress',
      detail: current?.resetError ?? (cleanupFailed ? current?.failure?.message ?? 'Open the retirement operation to review the cleanup failure.' : retired
        ? 'This registration is no longer active. Use gateway management to review the record or start a supported reset.'
        : 'The current operation is retiring this gateway. Open its operation to follow certificate and registration cleanup.'),
    };
  }
  if (failed) {
    if (gateway.health === 'DEGRADED') focus = stages[3];
    focus.state = 'attention';
    return {
      group: 'attention', stages, focus: focus.id,
      title: gateway.state === 'ROLLED_BACK' ? 'Configuration rolled back' : 'Gateway needs attention',
      detail: current?.failure?.message ?? 'The gateway reported an issue. Inspect the current operation before retrying or changing its assignment.',
    };
  }
  return {
    group: healthy ? 'ready' : pullOnly || legacy ? 'attention' : 'activating',
    stages, focus: focus.id, title: focus.title, detail: focus.detail,
  };
}
