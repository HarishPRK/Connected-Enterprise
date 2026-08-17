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
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { useToast } from '../../ui/Toast';
import { createIdempotencyKey, decommissionGateway, deployProfileToGateway } from './api';
import type {
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
  preferredSiteId?: string;
  refreshing: boolean;
  canVerifyDevice: boolean;
  canDecommission: boolean;
  canDeployProfile: boolean;
  onRefresh: () => void;
  onVerifyDevice: () => void;
  onOperation: (operation: OnboardingOperation) => void;
}

function gatewayDisplayState(gateway: Gateway): { label: string; tone: 'ok' | 'warn' | 'err' | 'neutral' } {
  if (gateway.state === 'ACTIVE' && gateway.health === 'HEALTHY') return { label: 'Applied healthy', tone: 'ok' };
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

export function GatewayInventory({
  gateways,
  sites,
  models,
  profiles,
  operations,
  preferredSiteId,
  refreshing,
  canVerifyDevice,
  canDecommission,
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
  const [deployTarget, setDeployTarget] = useState<Gateway>();
  const [deployProfileId, setDeployProfileId] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<'SHADOW' | 'JOB'>('SHADOW');
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

  const openDecommission = (gateway: Gateway) => {
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
      );
      setDecommissionTarget(undefined);
      setConfirmation('');
      setDecommissionError(undefined);
      onOperation(operation);
      push({
        kind: 'warn',
        title: 'Decommission started',
        detail: `${decommissionTarget.serialNumber} will have its certificate deactivated and MQTT session cleared.`,
      });
    } catch (cause) {
      setDecommissionError(cause instanceof Error ? cause.message : 'Unable to start decommissioning.');
    } finally {
      setDecommissioning(false);
    }
  };

  const compatibleDeployProfiles = deployTarget
    ? profiles.filter((profile) => profile.modelId === deployTarget.modelId && profile.id !== deployTarget.profileVersionId)
    : [];

  const openDeploy = (gateway: Gateway) => {
    const compatible = profiles.filter((profile) => profile.modelId === gateway.modelId && profile.id !== gateway.profileVersionId);
    setDeployTarget(gateway);
    setDeployProfileId(compatible[0]?.id ?? '');
    setDeliveryMode('SHADOW');
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
      );
      const selectedProfile = profiles.find((profile) => profile.id === deployProfileId);
      setDeployTarget(undefined);
      setDeployProfileId('');
      onOperation(operation);
      push({
        kind: 'success',
        title: 'Profile deployment queued',
        detail: `${selectedProfile?.name ?? 'The selected profile'} will deploy as generation ${operation.deploymentGeneration}.`,
      });
    } catch (cause) {
      setDeployError(cause instanceof Error ? cause.message : 'Unable to queue the profile deployment.');
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
          <p>Verify a factory identity, choose an authorized site, and assign an immutable profile.</p>
          {canVerifyDevice && (
            <button type="button" className="primary" onClick={onVerifyDevice}>
              <PackagePlus size={15} aria-hidden="true" />Verify first device
            </button>
          )}
        </div>
      ) : (
        <ul className="ce-onb-gateway-list">
          {visibleGateways.map((gateway) => {
            const state = gatewayDisplayState(gateway);
            const site = siteById.get(gateway.siteId);
            const model = modelById.get(gateway.modelId);
            const profile = gateway.profileVersionId ? profileById.get(gateway.profileVersionId) : undefined;
            const desiredProfile = gateway.desiredProfileVersionId ? profileById.get(gateway.desiredProfileVersionId) : undefined;
            const gatewayOperation = operationFor(gateway, operations);
            const activeOperation = gatewayOperation?.status === 'IN_PROGRESS' ? gatewayOperation : undefined;
            const gatewayCanDecommission = gateway.certificateState === 'ACTIVE'
              && (gateway.state === 'ACTIVE' || gateway.state === 'ROLLED_BACK' || gateway.state === 'FAILED');
            const gatewayCanDeploy = gateway.certificateState === 'ACTIVE'
              && ((gateway.state === 'ACTIVE' && gateway.health === 'HEALTHY') || gateway.state === 'ROLLED_BACK');
            return (
              <li key={gateway.id} className="ce-onb-gateway-row">
                <span className="ce-onb-gateway-icon"><Cpu size={19} aria-hidden="true" /></span>
                <div className="ce-onb-gateway-primary">
                  <div className="ce-onb-gateway-title">
                    <strong>{gateway.serialNumber}</strong>
                    <span className="ce-onb-status" data-tone={state.tone}>
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
                  <small>Applied profile</small>
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
                  {canDeployProfile && gatewayCanDeploy && !activeOperation && (
                    <button type="button" onClick={() => openDeploy(gateway)}>
                      <CloudUpload size={14} aria-hidden="true" />Deploy profile
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
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={Boolean(deployTarget)}
        onClose={closeDeploy}
        title="Deploy immutable profile"
        width={560}
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
              {deploying ? 'Queuing…' : 'Deploy profile'}
            </button>
          </>
        )}
      >
        {deployTarget && (
          <div className="ce-onb-decommission-dialog">
            <div className="ce-onb-secret-policy" role="note">
              <ShieldCheck size={18} aria-hidden="true" />
              <div>
                <strong>Monotonic, signed assignment</strong>
                <span>The backend creates a new device generation. The gateway must verify the signature and report the exact version and checksum healthy.</span>
              </div>
            </div>
            {compatibleDeployProfiles.length === 0 ? (
              <div className="ce-onb-alert is-warning" role="status">
                <TriangleAlert size={17} aria-hidden="true" />
                <span>No newer or alternate immutable profile is available for {deployTarget.modelId}. Publish one in the Profiles tab first.</span>
              </div>
            ) : (
              <>
                <label>
                  <span>Profile version</span>
                  <select value={deployProfileId} onChange={(event) => { setDeployProfileId(event.target.value); setDeployError(undefined); }} disabled={deploying}>
                    {compatibleDeployProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.name} · v{profile.version}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Delivery control</span>
                  <select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as 'SHADOW' | 'JOB')} disabled={deploying}>
                    <option value="SHADOW">Named Shadow · immediate convergence</option>
                    <option value="JOB">IoT Job · tracked controlled rollout</option>
                  </select>
                </label>
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
        title="Decommission gateway"
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
              {decommissioning ? 'Starting…' : 'Decommission gateway'}
            </button>
          </>
        )}
      >
        {decommissionTarget && (
          <div className="ce-onb-decommission-dialog">
            <div className="ce-onb-alert is-warning">
              <TriangleAlert size={18} aria-hidden="true" />
              <span>This starts certificate deactivation and clears the gateway’s MQTT session. It does not merely remove a row.</span>
            </div>
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
