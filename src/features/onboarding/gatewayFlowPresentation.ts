import type { GatewaySimulatorJob } from './api';
import { isAuthenticatedPullConfirmedOperation } from './gatewayProfileDeploymentEligibility';
import type { OnboardingOperation } from './types';
import { isOperationHealthy } from './types';

export interface GatewayFlowPresentation {
  state: 'ready' | 'starting' | 'running' | 'awaiting-confirmation' | 'confirmed' | 'failed' | 'closed';
  title: string;
  detail: string;
  canInitiate: boolean;
}

export function isManagedGatewaySerial(serial: string): boolean {
  return /^MOCK-[A-Z0-9][A-Z0-9._-]{0,90}$/.test(serial);
}

/** A simulator exit alone cannot confirm an AWS onboarding operation. */
export function gatewayFlowPresentation(
  operation: OnboardingOperation,
  job: GatewaySimulatorJob | null,
  starting = false,
): GatewayFlowPresentation {
  if (operation.status === 'FAILED') return {
    state: 'failed', title: 'Activation needs attention', canInitiate: false,
    detail: operation.failure?.message ?? 'The onboarding service reported a failure. Review the recorded operation below.',
  };
  if (isOperationHealthy(operation)) return {
    state: 'confirmed', canInitiate: false,
    title: isAuthenticatedPullConfirmedOperation(operation) ? 'Configuration retrieval confirmed' : 'Configuration deployed',
    detail: isAuthenticatedPullConfirmedOperation(operation)
      ? 'The authenticated gateway retrieved its assigned configuration. The operation below records the confirmation.'
      : 'The onboarding service confirmed configuration deployment. The timeline below records the reported deployment stages.',
  };
  if (operation.type !== 'ONBOARD' || operation.status !== 'IN_PROGRESS') return {
    state: 'closed', title: 'Flow closed', canInitiate: false,
    detail: 'This operation has finished. Its recorded result is shown below.',
  };
  if (starting) return {
    state: 'starting', title: 'Initiating flow', canInitiate: false,
    detail: 'The server is preparing the software gateway for this assignment.',
  };
  if (job?.state === 'failed') return {
    state: 'failed', title: 'Software gateway stopped', canInitiate: false,
    detail: job.phase || 'The software gateway stopped before completion. Review the AWS operation below.',
  };
  if (job?.state === 'completed') return {
    state: 'awaiting-confirmation', title: 'Waiting for AWS confirmation', canInitiate: false,
    detail: 'The software gateway finished its run. Activation remains unconfirmed until the onboarding service reports completion.',
  };
  if (job?.state === 'running') return {
    state: 'running', title: 'Flow in progress', canInitiate: false,
    detail: operation.state === 'HEALTH_CHECK'
      ? 'The gateway is verifying the assigned configuration.'
      : job.phase === 'Applying configuration and checking health'
        ? 'Applying and verifying configuration.'
        : job.phase === 'Healthy acknowledgement sent to AWS'
          ? 'Configuration deployment confirmation sent to AWS.'
          : job.phase || 'The software gateway is connecting. Follow the reported stages below.',
  };
  return {
    state: 'ready', title: 'Ready to initiate', canInitiate: true,
    detail: 'Start once, then follow the reported activation stages below.',
  };
}
