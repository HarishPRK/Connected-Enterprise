import { useMemo, useState } from 'react';
import {
  Activity,
  Box,
  CheckCircle2,
  Clock3,
  CloudUpload,
  Cpu,
  MapPin,
  PackagePlus,
  PowerOff,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { useToast } from '../../ui/Toast';
import { createIdempotencyKey, decommissionGateway, deployProfileToGateway } from './api';
import {
  automaticControllerAssignmentProfile,
  canSupersedeUnconfirmedProfileAssignment,
  compatibleProfileVersions,
  isAuthenticatedPullConfirmedAssignment,
  isLegacyHttpCompletedProfileAssignment,
  profileAssignmentOperationFor,
} from './gatewayProfileDeploymentEligibility';
import type {
  ControllerConfiguration,
  Gateway,
  GatewayModel,
  OnboardingOperation,
  ProfileVersion,
  Site,
} from './types';

interface GatewayInventoryProps {
  gateways: Gateway[];
  sites: Site[];
  models: GatewayModel[];
  profiles: ProfileVersion[];
  operations: OnboardingOperation[];
  controller: ControllerConfiguration | undefined;
  preferredSiteId?: string;
  refreshing: boolean;
  canVerifyDevice: boolean;
  canDecommission: boolean;
  canResetRegistration?: boolean;
  canDeployProfile: boolean;
  onRefresh: () => void;
  onVerifyDevice: () => void;
  onOperation: (operation: OnboardingOperation) => void;
}

function gatewayDisplayState(
  gateway: Gateway,
  operation?: OnboardingOperation,
): { label: string; tone: 'ok' | 'warn' | 'err' | 'neutral'; title?: string } {
  if (isAuthenticatedPullConfirmedAssignment(gateway, operation)) {
    return {
      label: 'Retrieved',
      tone: 'ok',
      title: `Generation ${gateway.deploymentGeneration} was retrieved by the authenticated gateway. Apply and health were not reported separately.`,
    };
  }
  if (gateway.state === 'ACTIVE' && gateway.health === 'HEALTHY') return { label: 'Applied healthy', tone: 'ok' };
  if (isLegacyHttpCompletedProfileAssignment(gateway, operation)) {
    return {
      label: 'Provisioned',
      tone: 'warn',
      title: 'Permanent identity is active. The legacy HTTPS profile fetch was not confirmed by a device health report.',
    };
  }
  if (gateway.state === 'ACTIVE' && gateway.health === 'DEGRADED') return { label: 'Degraded', tone: 'warn' };
  if (gateway.state === 'ROLLED_BACK') return { label: 'Rolled back', tone: 'warn' };
  if (gateway.state === 'DECOMMISSIONING') return { label: 'Decommissioning', tone: 'warn' };
  if (gateway.state === 'DECOMMISSIONED') return { label: 'Decommissioned', tone: 'neutral' };
  if (gateway.state === 'QUARANTINED') return { label: 'Quarantined', tone: 'warn' };
  if (gateway.state === 'FAILED') return { label: 'Failed', tone: 'err' };
  if (gateway.state === 'PENDING' || gateway.health === 'APPLYING') return { label: 'Provisioning', tone: 'warn' };
  return { label: gateway.state.toLowerCase().replace(/_/g, ' '), tone: 'neutral' };
}

function certificateLabel(state: Gateway['certificateState']): string {
  if (state === 'DEACTIVATING') return 'deactivating';
  return state.toLowerCase();
}

function formatTimestamp(value?: string): string {
  if (!value) return 'Not reported';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function operationFor(gateway: Gateway, operations: OnboardingOperation[]): OnboardingOperation | undefined {
  const gatewayOperations = operations.filter((operation) => operation.gatewayId === gateway.id);
  return gatewayOperations.find((operation) => operation.status === 'IN_PROGRESS')
    ?? gatewayOperations.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

function canMigrateLegacyAssignment(
  gateway: Gateway,
  activeOperation?: OnboardingOperation,
): boolean {
  return gateway.certificateState === 'ACTIVE'
    && gateway.state === 'ACTIVE'
    && gateway.health === 'APPLYING'
    && !gateway.profileVersionId
    && Boolean(gateway.desiredProfileVersionId)
    && gateway.deploymentGeneration >= 1
    && activeOperation?.type === 'ONBOARD'
    && activeOperation.state === 'PROFILE_STAGED'
    && activeOperation.deploymentGeneration === gateway.deploymentGeneration
    && activeOperation.profileVersionId === gateway.desiredProfileVersionId;
}

export function GatewayInventory({
  gateways,
  sites,
  models,
  profiles,
  operations,
  controller,
  preferredSiteId,
  refreshing,
  canVerifyDevice,
  canDecommission,
  canResetRegistration = false,
  canDeployProfile,
  onRefresh,
  onVerifyDevice,
  onOperation,
}: GatewayInventoryProps) {
  const { push } = useToast();
  const [decommissionTarget, setDecommissionTarget] = useState<Gateway>();
  const [confirmation, setConfirmation] = useState('');
  const [decommissioning, setDecommissioning] = useState(false);
  const [decommissionError, setDecommissionError] = useState<string>();
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey('decommission'));
  const [resetForOnboarding, setResetForOnboarding] = useState(false);
  const [deployTarget, setDeployTarget] = useState<Gateway>();
  const [deployProfileId, setDeployProfileId] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<'PULL' | 'SHADOW' | 'JOB'>('PULL');
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string>();
  const [deployIdempotencyKey, setDeployIdempotencyKey] = useState(() => createIdempotencyKey('profile-deploy'));

  const siteById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);
  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const selectedSite = preferredSiteId ? siteById.get(preferredSiteId) : undefined;
  const visibleGateways = preferredSiteId && selectedSite
    ? gateways.filter((gateway) => gateway.siteId === preferredSiteId)
    : gateways;

  const openDecommission = (gateway: Gateway, reset = false) => {
    setResetForOnboarding(reset);
    setDecommissionTarget(gateway);
    setConfirmation('');
    setDecommissionError(undefined);
    setIdempotencyKey(createIdempotencyKey('decommission'));
  };

  const closeDecommission = () => {
    if (decommissioning) return;
    setDecommissionTarget(undefined);
    setConfirmation('');
    setDecommissionError(undefined);
  };

  const confirmDecommission = async () => {
    if (!decommissionTarget || confirmation !== decommissionTarget.serialNumber) return;
    setDecommissioning(true);
    setDecommissionError(undefined);
    try {
      const operation = await decommissionGateway(
        decommissionTarget.id,
        confirmation,
        idempotencyKey,
        undefined,
        resetForOnboarding,
      );
      setDecommissionTarget(undefined);
      setConfirmation('');
      setDecommissionError(undefined);
      onOperation(operation);
      push({
        kind: 'warn',
        title: resetForOnboarding ? 'AWS reset started' : 'Decommission started',
        detail: resetForOnboarding
          ? `${decommissionTarget.serialNumber} will be available for onboarding after AWS cleanup completes.`
          : `${decommissionTarget.serialNumber} will have its certificate deactivated and MQTT session cleared.`,
      });
    } catch (cause) {
      setDecommissionError(cause instanceof Error ? cause.message : 'Unable to start decommissioning.');
    } finally {
      setDecommissioning(false);
    }
  };

  const deployTargetOperation = deployTarget ? operationFor(deployTarget, operations) : undefined;
  const deployTargetProfileAssignmentOperation = deployTarget
    ? profileAssignmentOperationFor(deployTarget, operations)
    : undefined;
  const compatibleDeployProfiles = deployTarget
    ? compatibleProfileVersions(profiles, deployTarget, deployTargetProfileAssignmentOperation)
    : [];
  const selectedDeployProfile = profiles.find((profile) => profile.id === deployProfileId);
  const deployTargetActiveOperation = deployTargetOperation?.status === 'IN_PROGRESS'
    ? deployTargetOperation
    : undefined;
  const deployTargetLegacyMigration = deployTarget
    ? canMigrateLegacyAssignment(deployTarget, deployTargetActiveOperation)
    : false;
  const supersedesUnconfirmedProfile = deployTarget
    ? canSupersedeUnconfirmedProfileAssignment(deployTarget, deployTargetProfileAssignmentOperation)
    : false;
  const replacesUnconfirmedProfile = deployTargetLegacyMigration || supersedesUnconfirmedProfile;

  const openDeploy = (gateway: Gateway) => {
    const compatible = compatibleProfileVersions(
      profiles,
      gateway,
      profileAssignmentOperationFor(gateway, operations),
    );
    const automaticControllerProfile = controller
      ? automaticControllerAssignmentProfile(profiles, gateway)
      : undefined;
    setDeployTarget(gateway);
    setDeployProfileId((automaticControllerProfile ?? compatible[0])?.id ?? '');
    setDeliveryMode('PULL');
    setDeployError(undefined);
    setDeployIdempotencyKey(createIdempotencyKey('profile-deploy'));
  };

  const closeDeploy = () => {
    if (deploying) return;
    setDeployTarget(undefined);
    setDeployProfileId('');
    setDeployError(undefined);
  };

  const confirmDeploy = async () => {
    if (!deployTarget || !deployProfileId) return;
    setDeploying(true);
    setDeployError(undefined);
    try {
      const operation = await deployProfileToGateway(
        deployTarget.id,
        deployProfileId,
        deliveryMode,
        deployIdempotencyKey,
        replacesUnconfirmedProfile ? deployTarget.deploymentGeneration : undefined,
      );
      const selectedProfile = profiles.find((profile) => profile.id === deployProfileId);
      setDeployTarget(undefined);
      setDeployProfileId('');
      onOperation(operation);
      push({
        kind: 'success',
        title: controller ? 'Controller deployment created' : 'Profile deployment queued',
        detail: controller
          ? `Generation ${operation.deploymentGeneration} automatically carries ${selectedProfile?.name ?? 'the existing profile'}${selectedProfile ? ` v${selectedProfile.version}` : ''} as its signed baseline. Gateway curl returns only the Controller payload.`
          : `${selectedProfile?.name ?? 'The selected profile'} will deploy as generation ${operation.deploymentGeneration}.`,
      });
    } catch (cause) {
      setDeployError(cause instanceof Error
        ? cause.message
        : controller ? 'Unable to create the Controller deployment.' : 'Unable to queue the profile deployment.');
    } finally {
      setDeploying(false);
    }
  };

  return (
    <section className="ce-onb-inventory" aria-labelledby="gateway-inventory-title">
      <div className="ce-onb-section-heading">
        <div>
          <h2 id="gateway-inventory-title">Gateway inventory</h2>
          <p>
            {selectedSite
              ? `${selectedSite.name} · ${selectedSite.location}`
              : 'All sites authorized for this tenant'}
          </p>
        </div>
        <div className="ce-onb-heading-actions">
          <button type="button" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'ce-onb-spin' : ''} size={14} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {canVerifyDevice && (
            <button type="button" className="primary" onClick={onVerifyDevice}>
              <PackagePlus size={15} aria-hidden="true" />Verify device
            </button>
          )}
        </div>
      </div>

      {visibleGateways.length === 0 ? (
        <div className="ce-onb-empty-state">
          <span className="ce-onb-empty-icon"><Box size={25} aria-hidden="true" /></span>
          <h3>No gateways assigned {selectedSite ? 'to this site' : 'yet'}</h3>
          <p>Verify a factory serial, choose an authorized site, and assign an immutable profile.</p>
          {canVerifyDevice && (
            <button type="button" className="primary" onClick={onVerifyDevice}>
              <PackagePlus size={15} aria-hidden="true" />Verify first device
            </button>
          )}
        </div>
      ) : (
        <ul className="ce-onb-gateway-list">
          {visibleGateways.map((gateway) => {
            const site = siteById.get(gateway.siteId);
            const model = modelById.get(gateway.modelId);
            const profile = gateway.profileVersionId ? profileById.get(gateway.profileVersionId) : undefined;
            const desiredProfile = gateway.desiredProfileVersionId ? profileById.get(gateway.desiredProfileVersionId) : undefined;
            const gatewayOperation = operationFor(gateway, operations);
            const profileAssignmentOperation = profileAssignmentOperationFor(gateway, operations);
            const state = gatewayDisplayState(gateway, profileAssignmentOperation);
            const pullConfirmed = isAuthenticatedPullConfirmedAssignment(gateway, profileAssignmentOperation);
            const activeOperation = gatewayOperation?.status === 'IN_PROGRESS' ? gatewayOperation : undefined;
            const legacyAssignmentCanMigrate = canMigrateLegacyAssignment(gateway, activeOperation);
            const unconfirmedProfileCanSupersede = canSupersedeUnconfirmedProfileAssignment(
              gateway,
              profileAssignmentOperation,
            );
            const gatewayCanDecommission = gateway.certificateState === 'ACTIVE'
              && (gateway.state === 'ACTIVE' || gateway.state === 'ROLLED_BACK' || gateway.state === 'FAILED');
            const gatewayCanDeploy = legacyAssignmentCanMigrate
              || unconfirmedProfileCanSupersede
              || pullConfirmed
              || (gateway.certificateState === 'ACTIVE'
                && ((gateway.state === 'ACTIVE' && gateway.health === 'HEALTHY') || gateway.state === 'ROLLED_BACK'));
            return (
              <li key={gateway.id} className="ce-onb-gateway-row">
                <span className="ce-onb-gateway-icon"><Cpu size={19} aria-hidden="true" /></span>
                <div className="ce-onb-gateway-primary">
                  <div className="ce-onb-gateway-title">
                    <strong>{gateway.serialNumber}</strong>
                    <span
                      className="ce-onb-status"
                      data-tone={state.tone}
                      title={state.title}
                      aria-label={state.title ? `${state.label}. ${state.title}` : undefined}
                    >
                      <span aria-hidden="true" />{state.label}
                    </span>
                  </div>
                  <span>{model?.name ?? gateway.modelId} · hardware {gateway.hardwareRevision}</span>
                  <div className="ce-onb-gateway-facts">
                    <span><MapPin size={12} aria-hidden="true" />{site ? `${site.name} · ${site.location}` : gateway.siteId}</span>
                    <span><ShieldCheck size={12} aria-hidden="true" />Certificate {certificateLabel(gateway.certificateState)}</span>
                    <span><Activity size={12} aria-hidden="true" />Generation {gateway.deploymentGeneration}</span>
                    <span><Clock3 size={12} aria-hidden="true" />Last seen {formatTimestamp(gateway.lastSeenAt)}</span>
                  </div>
                </div>
                <div className="ce-onb-gateway-profile">
                  <small>{pullConfirmed ? 'Assigned profile' : 'Applied profile'}</small>
                  <strong>{profile ? `${profile.name} v${profile.version}` : 'No profile assigned'}</strong>
                  {desiredProfile && desiredProfile.id !== profile?.id && (
                    <span>Candidate: {desiredProfile.name} v{desiredProfile.version}</span>
                  )}
                  <span className="mono" title={gateway.thingName}>{gateway.thingName}</span>
                </div>
                <div className="ce-onb-row-actions">
                  {gatewayOperation && (
                    <button type="button" onClick={() => onOperation(gatewayOperation)}>
                      {activeOperation ? 'View progress' : 'View operation'}
                    </button>
                  )}
                  {canDeployProfile && gatewayCanDeploy && (!activeOperation || legacyAssignmentCanMigrate || unconfirmedProfileCanSupersede) && (
                    <button
                      type="button"
                      onClick={() => openDeploy(gateway)}
                      title={legacyAssignmentCanMigrate || unconfirmedProfileCanSupersede
                        ? `Create signed generation ${gateway.deploymentGeneration + 1} and supersede the unconfirmed generation ${gateway.deploymentGeneration}`
                        : undefined}
                    >
                      <CloudUpload size={14} aria-hidden="true" />{controller ? 'Deploy Controller' : 'Deploy profile'}
                    </button>
                  )}
                  {canDecommission && (
                    <button
                      type="button"
                      className="ce-onb-danger-outline"
                      onClick={() => openDecommission(gateway)}
                      disabled={!gatewayCanDecommission || Boolean(activeOperation)}
                    >
                      <PowerOff size={14} aria-hidden="true" />Decommission
                    </button>
                  )}
                  {canDecommission && canResetRegistration && (
                    <button type="button" className="ce-onb-danger-outline"
                      onClick={() => openDecommission(gateway, true)}
                      disabled={!(gateway.certificateState === 'ACTIVE' || (gateway.certificateState === 'PENDING' && gatewayOperation?.state === 'CLAIM_ACCEPTED') || gateway.state === 'DECOMMISSIONED' || gatewayOperation?.resetError)}>
                      <PowerOff size={14} aria-hidden="true" />
                      {gatewayOperation?.resetError ? 'Retry AWS reset' : gateway.certificateState === 'PENDING' ? 'Cancel & reset onboarding' : gateway.state === 'DECOMMISSIONED' ? 'Reset for onboarding' : 'Decommission & reset'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={Boolean(deployTarget)}
        onClose={closeDeploy}
        title={controller ? 'Deploy Controller configuration' : 'Deploy immutable profile'}
        width={600}
        footer={(
          <>
            <button type="button" onClick={closeDeploy} disabled={deploying}>Cancel</button>
            <button
              type="button"
              className="primary"
              onClick={() => void confirmDeploy()}
              disabled={deploying || !deployProfileId}
            >
              {deploying ? <span className="ce-onb-spinner" aria-hidden="true" /> : <CloudUpload size={14} aria-hidden="true" />}
              {deploying
                ? controller ? 'Creating generation…' : 'Queuing…'
                : controller ? 'Deploy Controller configuration' : 'Deploy profile'}
            </button>
          </>
        )}
      >
        {deployTarget && (
          <div className="ce-onb-decommission-dialog">
            {controller && (
              <div className="ce-onb-deploy-source" role="note" aria-label="Controller payload included automatically">
                <span className="ce-onb-panel-icon"><ServerCog size={19} aria-hidden="true" /></span>
                <div className="ce-onb-deploy-source__body">
                  <div className="ce-onb-deploy-source__header">
                    <strong>Controller payload</strong>
                    <span className="ce-onb-status" data-tone="ok"><span aria-hidden="true" />Included automatically</span>
                  </div>
                  <span className="ce-onb-deploy-source__identity mono" dir="ltr">
                    {controller.configuration.usp.controller_endpoint_id}
                  </span>
                  <small title={controller.revision}>
                    {controller.configuration.usp.mqtt.broker}:{controller.configuration.usp.mqtt.port} · revision <span className="mono">{controller.revision}</span>
                  </small>
                  <p>
                    API Gateway returns the saved <code>{'{ usp: … }'}</code> object as the complete response body for generation {deployTarget.deploymentGeneration + 1}. No profile wrapper or S3 profile document is included.
                  </p>
                </div>
              </div>
            )}
            {!controller && (
              <div className="ce-onb-secret-policy" role="note">
                <ShieldCheck size={18} aria-hidden="true" />
                <div>
                  <strong>Monotonic, signed assignment</strong>
                  <span>The backend creates a new device generation. The gateway must verify the signature and report the exact version and checksum healthy.</span>
                </div>
              </div>
            )}
            {replacesUnconfirmedProfile && (
              <div className="ce-onb-alert is-warning" role="note">
                <TriangleAlert size={17} aria-hidden="true" />
                <span>
                  {controller
                    ? `Generation ${deployTarget.deploymentGeneration} was delivered but never confirmed. Creating generation ${deployTarget.deploymentGeneration + 1} supersedes it without marking the previous profile healthy.`
                    : `Generation ${deployTarget.deploymentGeneration} was delivered but never confirmed applied. This assignment will supersede it and create generation ${deployTarget.deploymentGeneration + 1}; it will not mark the old profile healthy.`}
                </span>
              </div>
            )}
            {(controller ? !selectedDeployProfile : compatibleDeployProfiles.length === 0) ? (
              <div className="ce-onb-alert is-warning" role="status">
                <TriangleAlert size={17} aria-hidden="true" />
                <span>{controller
                  ? `This gateway has no existing compatible profile association to carry forward for ${deployTarget.modelId}. Deploy a profile first, then deploy the Controller configuration.`
                  : `No compatible immutable profile is available for ${deployTarget.modelId}. Publish one in the Profiles tab first.`}</span>
              </div>
            ) : controller && selectedDeployProfile ? (
              <div className="ce-onb-deploy-summary" role="note" aria-label="Automatic Controller deployment details">
                <div className="ce-onb-deploy-summary__header">
                  <strong>Deployment details</strong>
                  <span className="ce-onb-status" data-tone="ok"><span aria-hidden="true" />Automatic</span>
                </div>
                <dl>
                  <div>
                    <dt>Gateway</dt>
                    <dd>{deployTarget.serialNumber}</dd>
                  </div>
                  <div>
                    <dt>Profile assignment</dt>
                    <dd>{selectedDeployProfile.name} · v{selectedDeployProfile.version}</dd>
                  </div>
                  <div>
                    <dt>New generation</dt>
                    <dd>{deployTarget.deploymentGeneration + 1}</dd>
                  </div>
                  <div>
                    <dt>Retrieval</dt>
                    <dd>HTTPS GET · API Gateway</dd>
                  </div>
                </dl>
                <p>
                  <ShieldCheck size={16} aria-hidden="true" />
                  <span>
                    <strong>{selectedDeployProfile.name} v{selectedDeployProfile.version}</strong> is assigned automatically to preserve signing, model compatibility, and deployment lineage. The curl response contains only the Controller payload above.
                  </span>
                </p>
              </div>
            ) : (
              <>
                <label>
                  <span>Profile version</span>
                  <select value={deployProfileId} onChange={(event) => { setDeployProfileId(event.target.value); setDeployError(undefined); }} disabled={deploying}>
                    {compatibleDeployProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} · v{profile.version}{profile.id === deployTarget.profileVersionId ? ' · currently applied' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Gateway retrieval</span>
                  <select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as 'PULL' | 'SHADOW' | 'JOB')} disabled={deploying}>
                    <option value="PULL">HTTPS polling · API Gateway</option>
                    <option value="SHADOW">Named Shadow · compatibility mode</option>
                    <option value="JOB">IoT Job · compatibility mode</option>
                  </select>
                </label>
                <p>
                  With HTTPS polling, the gateway pulls the signed generation from API Gateway. No MQTT topic acknowledgement is awaited by this deployment action.
                </p>
                <p>
                  Target <strong>{deployTarget.serialNumber}</strong> is currently on generation {deployTarget.deploymentGeneration}.
                </p>
              </>
            )}
            {deployError && <div className="ce-onb-alert is-error" role="alert">{deployError}</div>}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(decommissionTarget)}
        onClose={closeDecommission}
        title={resetForOnboarding ? 'Reset gateway for onboarding' : 'Decommission gateway'}
        width={540}
        footer={(
          <>
            <button type="button" onClick={closeDecommission} disabled={decommissioning}>Cancel</button>
            <button
              type="button"
              className="danger"
              onClick={() => void confirmDecommission()}
              disabled={decommissioning || confirmation !== decommissionTarget?.serialNumber}
            >
              {decommissioning ? <span className="ce-onb-spinner" aria-hidden="true" /> : <PowerOff size={14} aria-hidden="true" />}
              {decommissioning ? 'Starting…' : resetForOnboarding ? 'Decommission & reset in AWS' : 'Decommission gateway'}
            </button>
          </>
        )}
      >
        {decommissionTarget && (
          <div className="ce-onb-decommission-dialog">
            <div className="ce-onb-alert is-warning">
              <TriangleAlert size={18} aria-hidden="true" />
              <span>{resetForOnboarding
                ? 'This disconnects the gateway and removes its AWS Thing, bootstrap and operational certificates, shadows, and active registration. Audit history is retained.'
                : 'This deactivates the certificate and clears the MQTT session. The serial stays registered; use Reset for onboarding to reuse it.'}</span>
            </div>
            {resetForOnboarding && <p>After cleanup succeeds, create a new bootstrap ZIP for this serial. Fresh onboarding starts at <strong>generation 5</strong>. The previous credentials will stop working.</p>}
            <p>
              To protect <strong>{decommissionTarget.serialNumber}</strong>, enter its complete serial number to confirm.
            </p>
            <label>
              <span>Gateway serial number</span>
              <input
                autoFocus
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setDecommissionError(undefined);
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder={decommissionTarget.serialNumber}
                disabled={decommissioning}
              />
            </label>
            {confirmation === decommissionTarget.serialNumber && (
              <div className="ce-onb-confirmed-copy"><CheckCircle2 size={14} aria-hidden="true" />Serial confirmed</div>
            )}
            {decommissionError && <div className="ce-onb-alert is-error" role="alert">{decommissionError}</div>}
          </div>
        )}
      </Modal>
    </section>
  );
}
