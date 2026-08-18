import { useEffect } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  CloudCog,
  FileCheck2,
  LoaderCircle,
  Radio,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { fetchOnboardingOperation } from './api';
import type { OnboardingOperation, OnboardingState, Site } from './types';
import { isOperationHealthy, isOperationTerminal } from './types';
import type { OnboardingStreamState } from './useOnboardingData';

interface OperationProgressProps {
  operation: OnboardingOperation;
  sites: Site[];
  streamState: OnboardingStreamState;
  onUpdate: (operation: OnboardingOperation) => void;
  onBack: () => void;
}

interface LifecycleMilestone {
  state: OnboardingState;
  label: string;
  description: string;
}

const ONBOARD_MILESTONES: LifecycleMilestone[] = [
  { state: 'CLAIM_ACCEPTED', label: 'Registration authorized', description: 'The factory serial reservation was accepted for this tenant.' },
  { state: 'CSR_VERIFIED', label: 'Certificate request accepted', description: 'The gateway certificate request passed validation.' },
  { state: 'OPERATIONAL_IDENTITY_ISSUED', label: 'Operational identity issued', description: 'A per-device identity was attached to the authoritative Thing.' },
];

const PROFILE_VALIDATION_MILESTONES: LifecycleMilestone[] = [
  { state: 'PROFILE_STAGED', label: 'Profile staged', description: 'The immutable assignment manifest is ready for the gateway.' },
  { state: 'APPLYING', label: 'Applying configuration', description: 'The gateway is applying the candidate transaction with its watchdog armed.' },
  { state: 'HEALTH_CHECK', label: 'Validating health', description: 'Management connectivity and network services are being confirmed.' },
  { state: 'APPLIED_HEALTHY', label: 'Applied healthy', description: 'The gateway acknowledged the exact version and passed health checks.' },
];

const ONBOARD_OPERATION_MILESTONES = [...ONBOARD_MILESTONES, ...PROFILE_VALIDATION_MILESTONES];

const DECOMMISSION_MILESTONES: LifecycleMilestone[] = [
  { state: 'DECOMMISSIONING', label: 'Decommission requested', description: 'The gateway has entered a protected retirement workflow.' },
  { state: 'CERTIFICATE_DEACTIVATED', label: 'Certificate deactivated', description: 'The operational identity can no longer authenticate.' },
  { state: 'MQTT_SESSION_CLEARED', label: 'MQTT session cleared', description: 'The broker session and subscriptions were removed.' },
  { state: 'DECOMMISSIONED', label: 'Decommissioned', description: 'The gateway is retained as an auditable retired record.' },
];

const PROFILE_DEPLOY_MILESTONES: LifecycleMilestone[] = [
  { state: 'PROFILE_STAGED', label: 'Profile staged', description: 'The signed assignment is queued for this gateway.' },
  { state: 'APPLYING', label: 'Applying configuration', description: 'The gateway is applying the candidate transaction with its watchdog armed.' },
  { state: 'HEALTH_CHECK', label: 'Validating health', description: 'Management connectivity and network services are being confirmed.' },
  { state: 'APPLIED_HEALTHY', label: 'Applied healthy', description: 'The gateway acknowledged the exact version and passed health checks.' },
];

function formatTimestamp(value?: string): string {
  if (!value) return 'Waiting';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(date);
}

function hasReachedMilestone(operation: OnboardingOperation, state: OnboardingState): boolean {
  if (operation.timeline.some((entry) => entry.state === state)) return true;
  if (operation.status === 'SUCCEEDED') return true;
  const currentIndex = ONBOARD_OPERATION_MILESTONES.findIndex((milestone) => milestone.state === operation.state);
  const targetIndex = ONBOARD_OPERATION_MILESTONES.findIndex((milestone) => milestone.state === state);
  return currentIndex >= targetIndex && targetIndex >= 0;
}

function MilestoneList({
  milestones,
  operation,
  label,
}: {
  milestones: LifecycleMilestone[];
  operation: OnboardingOperation;
  label: string;
}) {
  const activeIndex = milestones.findIndex((milestone) => milestone.state === operation.state);

  return (
    <ol className="ce-onb-milestones" aria-label={label}>
      {milestones.map((milestone, index) => {
        const timeline = [...operation.timeline].reverse().find((entry) => entry.state === milestone.state);
        const current = operation.status === 'IN_PROGRESS' && milestone.state === operation.state;
        const complete = operation.status === 'SUCCEEDED'
          ? activeIndex === -1 || index <= activeIndex
          : Boolean(timeline) && !current;
        return (
          <li key={milestone.state} data-state={complete ? 'complete' : current ? 'current' : 'pending'}>
            <span className="ce-onb-milestone-mark">
              {complete
                ? <Check size={14} aria-hidden="true" />
                : current
                  ? <LoaderCircle size={15} aria-hidden="true" />
                  : <span aria-hidden="true" />}
            </span>
            <div>
              <strong>{milestone.label}</strong>
              <span>{timeline?.detail ?? milestone.description}</span>
            </div>
            <time dateTime={timeline?.at}>
              {timeline ? formatTimestamp(timeline.at) : complete ? 'Completed' : current ? 'In progress' : 'Waiting'}
            </time>
          </li>
        );
      })}
    </ol>
  );
}

export function OperationProgress({
  operation,
  sites,
  streamState,
  onUpdate,
  onBack,
}: OperationProgressProps) {
  useEffect(() => {
    if (isOperationTerminal(operation)) return;
    let running = false;
    const controller = new AbortController();
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        onUpdate(await fetchOnboardingOperation(operation.id, controller.signal));
      } catch {
        // SSE remains the primary live path in the Express BFF. Polling is a
        // fallback for API Gateway/Lambda deployments and retries next tick.
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 2_500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [operation, onUpdate]);

  const milestones = operation.type === 'DECOMMISSION'
    ? DECOMMISSION_MILESTONES
    : operation.type === 'PROFILE_DEPLOY'
      ? PROFILE_DEPLOY_MILESTONES
      : ONBOARD_OPERATION_MILESTONES;
  const site = sites.find((candidate) => candidate.id === operation.siteId);
  const healthy = isOperationHealthy(operation);
  const failed = operation.status === 'FAILED';
  const rolledBack = operation.state === 'ROLLED_BACK' || operation.failure?.rolledBack;
  const onboardingComplete = operation.type === 'ONBOARD'
    && hasReachedMilestone(operation, 'OPERATIONAL_IDENTITY_ISSUED');
  const profileValidationStarted = operation.type === 'ONBOARD'
    && hasReachedMilestone(operation, 'PROFILE_STAGED');
  const summaryLabel = healthy
    ? 'Configuration applied and healthy'
    : failed
      ? rolledBack ? 'Activation failed; known-good profile restored' : 'Operation needs attention'
      : operation.type === 'ONBOARD' && onboardingComplete
        ? profileValidationStarted
          ? 'Gateway onboarded; profile validation in progress'
          : 'Gateway onboarding complete'
        : milestones.find((milestone) => milestone.state === operation.state)?.label ?? operation.state.replace(/_/g, ' ');

  return (
    <section className="ce-onb-operation" aria-labelledby="operation-progress-title">
      <div className="ce-onb-operation-head">
        <div>
          <button type="button" className="ce-onb-text-button" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />Gateway inventory
          </button>
          <h2 id="operation-progress-title">
            {operation.type === 'DECOMMISSION'
              ? 'Gateway decommissioning'
              : operation.type === 'PROFILE_DEPLOY'
                ? 'Profile deployment progress'
                : 'Gateway onboarding and profile validation'}
          </h2>
          <p>{operation.serialNumber} · {site ? `${site.name}, ${site.location}` : operation.siteId}</p>
        </div>
        <div className="ce-onb-live-state" data-connected={streamState === 'connected'}>
          <span aria-hidden="true" />
          {streamState === 'connected'
            ? 'Live events + polling'
            : streamState === 'polling'
              ? 'Secure status polling'
              : 'Polling while stream reconnects'}
        </div>
      </div>

      <div className="ce-onb-operation-layout">
        <div className="ce-onb-progress-rail" aria-live="polite">
          <div className="ce-onb-operation-summary">
            <span className={`ce-onb-operation-mark${healthy ? ' is-success' : failed ? ' is-error' : ''}`}>
              {healthy
                ? <CheckCircle2 size={23} aria-hidden="true" />
                : failed
                  ? <TriangleAlert size={23} aria-hidden="true" />
                  : <CloudCog size={23} aria-hidden="true" />}
            </span>
            <div>
              <small>Operation {operation.id}</small>
              <strong>{summaryLabel}</strong>
              <span>Deployment generation {operation.deploymentGeneration}</span>
            </div>
          </div>

          {operation.type === 'ONBOARD' ? (
            <div className="ce-onb-phase-stack">
              <section className="ce-onb-phase" aria-labelledby="gateway-onboarding-phase-title">
                <div className="ce-onb-phase-head">
                  <div className="ce-onb-phase-heading">
                    <span className="ce-onb-phase-mark" data-state={onboardingComplete ? 'complete' : failed ? 'error' : 'current'}>
                      {onboardingComplete
                        ? <CheckCircle2 size={18} aria-hidden="true" />
                        : <ShieldCheck size={18} aria-hidden="true" />}
                    </span>
                    <div>
                      <strong id="gateway-onboarding-phase-title">Gateway onboarding</strong>
                      <span>{onboardingComplete ? 'Permanent operational identity established.' : 'Authorizing the serial and establishing permanent identity.'}</span>
                    </div>
                  </div>
                  <span className="ce-onb-status" data-tone={onboardingComplete ? 'ok' : failed ? 'err' : 'warn'}>
                    <span aria-hidden="true" />
                    {onboardingComplete ? 'Complete' : failed ? 'Needs attention' : 'In progress'}
                  </span>
                </div>
                <MilestoneList milestones={ONBOARD_MILESTONES} operation={operation} label="Gateway onboarding milestones" />
              </section>

              <section className="ce-onb-phase" aria-labelledby="profile-validation-phase-title">
                <div className="ce-onb-phase-head">
                  <div className="ce-onb-phase-heading">
                    <span
                      className="ce-onb-phase-mark"
                      data-state={healthy ? 'complete' : failed && onboardingComplete ? 'error' : profileValidationStarted ? 'current' : 'pending'}
                    >
                      {healthy
                        ? <CheckCircle2 size={18} aria-hidden="true" />
                        : <FileCheck2 size={18} aria-hidden="true" />}
                    </span>
                    <div>
                      <strong id="profile-validation-phase-title">Profile deployment &amp; validation</strong>
                      <span>{healthy ? 'Assigned configuration applied and health validated.' : 'Delivering the assigned profile and waiting for device validation.'}</span>
                    </div>
                  </div>
                  <span
                    className="ce-onb-status"
                    data-tone={healthy ? 'ok' : failed && onboardingComplete ? 'err' : profileValidationStarted ? 'warn' : 'neutral'}
                  >
                    <span aria-hidden="true" />
                    {healthy ? 'Complete' : failed && onboardingComplete ? 'Needs attention' : profileValidationStarted ? 'In progress' : 'Next'}
                  </span>
                </div>
                <MilestoneList milestones={PROFILE_VALIDATION_MILESTONES} operation={operation} label="Profile deployment and validation milestones" />
              </section>
            </div>
          ) : (
            <MilestoneList milestones={milestones} operation={operation} label="Operation milestones" />
          )}

          {(operation.state === 'ROLLING_BACK' || operation.state === 'ROLLED_BACK') && (
            <div className="ce-onb-alert is-warning">
              <RotateCcw size={17} aria-hidden="true" />
              <span>{operation.state === 'ROLLING_BACK' ? 'Restoring the last known-good profile.' : 'The last known-good profile was restored.'}</span>
            </div>
          )}

          {failed && (
            <div className="ce-onb-alert is-error" role="alert">
              <TriangleAlert size={17} aria-hidden="true" />
              <span><strong>{operation.failure?.code ?? 'OPERATION_FAILED'}</strong> · {operation.failure?.message ?? 'The backend reported an onboarding failure.'}</span>
            </div>
          )}

          {healthy && (
            <div className="ce-onb-success-panel" role="status">
              <CheckCircle2 size={24} aria-hidden="true" />
              <div>
                <strong>APPLIED_HEALTHY</strong>
                <span>
                  {operation.type === 'PROFILE_DEPLOY'
                    ? 'The gateway applied the assigned version and confirmed management health.'
                    : 'The gateway reconnected with its operational identity, applied the assigned version, and confirmed management health.'}
                </span>
              </div>
            </div>
          )}
        </div>

        <aside className="ce-onb-operation-aside" aria-label="Operation details">
          <h3>{operation.type === 'PROFILE_DEPLOY' ? 'Deployment contract' : operation.type === 'DECOMMISSION' ? 'Retirement contract' : 'Activation contract'}</h3>
          <dl>
            <div><dt>Serial</dt><dd>{operation.serialNumber}</dd></div>
            <div><dt>Site</dt><dd>{site?.name ?? operation.siteId}</dd></div>
            {operation.profileVersionId && <div><dt>Profile version ID</dt><dd className="mono">{operation.profileVersionId}</dd></div>}
            <div><dt>Generation</dt><dd>{operation.deploymentGeneration}</dd></div>
            <div><dt>Started</dt><dd>{formatTimestamp(operation.createdAt)}</dd></div>
            <div><dt>Updated</dt><dd>{formatTimestamp(operation.updatedAt)}</dd></div>
          </dl>
          <div className="ce-onb-operation-assurances">
            <span><ShieldCheck size={15} aria-hidden="true" />Per-device operational identity</span>
            <span><FileCheck2 size={15} aria-hidden="true" />Immutable profile version</span>
            <span><Radio size={15} aria-hidden="true" />Device-confirmed apply state</span>
            <span><Clock3 size={15} aria-hidden="true" />Monotonic deployment generation</span>
          </div>
          <button type="button" onClick={onBack}>
            {isOperationTerminal(operation) ? 'Return to inventory' : 'Leave operation running'}
          </button>
          {!isOperationTerminal(operation) && (
            <p>Safe to leave; progress resumes when the gateway reconnects.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
