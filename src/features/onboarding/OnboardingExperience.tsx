import { useState } from 'react';
import { CloudCog, FileKey2, FileLock2, LogOut, MapPin, PackagePlus, Radio, RefreshCw, ServerCog, ShieldCheck, TriangleAlert } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { BootstrapPackageManager } from './BootstrapPackageManager';
import { ControllerManager } from './ControllerManager';
import { GatewayInventory } from './GatewayInventory';
import { OnboardingWizard } from './OnboardingWizard';
import { OperationProgress } from './OperationProgress';
import { ProfileManager } from './ProfileManager';
import type { OnboardingOperation } from './types';
import { useOnboardingData } from './useOnboardingData';
import { useOnboardingAuth } from './onboardingAuthContext';

type WorkspaceSurface = 'gateways' | 'profiles' | 'controller' | 'bootstrap';
type Surface = WorkspaceSurface | 'wizard' | 'operation';

export function OnboardingExperience({ preferredSiteId }: { preferredSiteId?: string }) {
  const { user, signOut } = useOnboardingAuth();
  const {
    snapshot,
    loading,
    refreshing,
    error,
    streamState,
    refresh,
    upsertOperation,
    upsertProfile,
    upsertController,
  } = useOnboardingData();
  const localSimulator = snapshot?.mode === 'local-simulator';
  const tenantRole = user?.tenantRole;
  const canOperate = localSimulator || tenantRole === 'platform_admin' || tenantRole === 'tenant_admin' || tenantRole === 'operator';
  const canAdminister = localSimulator || tenantRole === 'platform_admin' || tenantRole === 'tenant_admin';
  const canIssueBootstrapPackage = snapshot?.mode === 'aws'
    && (tenantRole === 'platform_admin' || tenantRole === 'tenant_admin');
  const [surface, setSurface] = useState<Surface>('gateways');
  const [operationId, setOperationId] = useState<string>();
  const [wizardSerial, setWizardSerial] = useState('');
  const workspaceSurfaces: WorkspaceSurface[] = canIssueBootstrapPackage
    ? ['gateways', 'profiles', 'controller', 'bootstrap']
    : ['gateways', 'profiles', 'controller'];

  const onWorkspaceTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const focusedTab = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    const focusedSurface = workspaceSurfaces.find((candidate) => focusedTab?.id === `ce-onb-${candidate}-tab`);
    const currentIndex = focusedSurface ? workspaceSurfaces.indexOf(focusedSurface) : workspaceSurfaces.indexOf(surface as WorkspaceSurface);
    if (currentIndex < 0) return;

    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? workspaceSurfaces.length - 1
        : event.key === 'ArrowRight'
          ? (currentIndex + 1) % workspaceSurfaces.length
          : (currentIndex - 1 + workspaceSurfaces.length) % workspaceSurfaces.length;
    const nextSurface = workspaceSurfaces[nextIndex];
    setSurface(nextSurface);
    const tablist = event.currentTarget;
    window.requestAnimationFrame(() => {
      tablist.querySelector<HTMLButtonElement>(`#ce-onb-${nextSurface}-tab`)?.focus();
    });
  };

  const openOperation = (operation: OnboardingOperation) => {
    upsertOperation(operation);
    setOperationId(operation.id);
    setSurface('operation');
  };

  const activeOperation = operationId
    ? snapshot?.operations.find((operation) => operation.id === operationId)
    : undefined;
  const preferredSite = preferredSiteId
    ? snapshot?.sites.find((site) => site.id === preferredSiteId)
    : undefined;

  return (
    <div className="ce-onb-page">
      <PageHeader
        title="Gateway Onboarding"
        subtitle="Verify factory serials, assign immutable profiles, and confirm configuration delivery and reported device health."
        right={snapshot && (
          <div className="ce-onb-page-context">
            <span><ShieldCheck size={13} aria-hidden="true" />{snapshot.tenant.name}</span>
            {preferredSite && <span><MapPin size={13} aria-hidden="true" />{preferredSite.name}</span>}
            <span className="ce-onb-connection" data-connected={streamState === 'connected'}>
              <i aria-hidden="true" />{streamState === 'connected' ? 'Live' : snapshot.mode === 'aws' ? 'Polling' : 'Reconnecting'}
            </span>
            {user && (
              <button type="button" className="ce-onb-signout" onClick={signOut} title={user.email ?? user.subject}>
                <LogOut size={13} aria-hidden="true" />Sign out
              </button>
            )}
          </div>
        )}
      />

      {loading && !snapshot ? (
        <div className="ce-onb-loading" role="status" aria-live="polite">
          <span className="ce-onb-spinner" aria-hidden="true" />
          <div><strong>Loading tenant onboarding inventory</strong><span>Retrieving authorized sites, gateway state, and immutable profiles…</span></div>
        </div>
      ) : !snapshot ? (
        <section className="ce-onb-load-error" aria-labelledby="onboarding-load-error-title">
          <span><TriangleAlert size={24} aria-hidden="true" /></span>
          <h2 id="onboarding-load-error-title">Onboarding inventory is unavailable</h2>
          <p>{error ?? 'The service did not return an onboarding snapshot.'}</p>
          <button type="button" className="primary" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={14} aria-hidden="true" />{refreshing ? 'Retrying…' : 'Retry connection'}
          </button>
        </section>
      ) : (
        <>
          {error && (
            <div className="ce-onb-alert is-warning" role="status">
              <TriangleAlert size={17} aria-hidden="true" />
              <span>{error} Showing the most recently received inventory.</span>
              <button type="button" onClick={() => void refresh()} disabled={refreshing}>Retry</button>
            </div>
          )}

          {(surface === 'gateways' || surface === 'profiles' || surface === 'controller' || surface === 'bootstrap') && (
            <div className="ce-onb-command-bar">
              <div className="ce-onb-tabs" role="tablist" aria-label="Onboarding workspace" onKeyDown={onWorkspaceTabKeyDown}>
                <button
                  id="ce-onb-gateways-tab"
                  type="button"
                  role="tab"
                  aria-selected={surface === 'gateways'}
                  aria-controls="ce-onb-gateways-panel"
                  tabIndex={surface === 'gateways' ? 0 : -1}
                  onClick={() => setSurface('gateways')}
                >
                  <CloudCog size={15} aria-hidden="true" />Gateways <span>{snapshot.gateways.length}</span>
                </button>
                <button
                  id="ce-onb-profiles-tab"
                  type="button"
                  role="tab"
                  aria-selected={surface === 'profiles'}
                  aria-controls="ce-onb-profiles-panel"
                  tabIndex={surface === 'profiles' ? 0 : -1}
                  onClick={() => setSurface('profiles')}
                >
                  <FileLock2 size={15} aria-hidden="true" />Profiles <span>{snapshot.profiles.length}</span>
                </button>
                <button
                  id="ce-onb-controller-tab"
                  type="button"
                  role="tab"
                  aria-selected={surface === 'controller'}
                  aria-controls="ce-onb-controller-panel"
                  tabIndex={surface === 'controller' ? 0 : -1}
                  onClick={() => setSurface('controller')}
                >
                  <ServerCog size={15} aria-hidden="true" />Controller
                </button>
                {canIssueBootstrapPackage && (
                  <button
                    id="ce-onb-bootstrap-tab"
                    type="button"
                    role="tab"
                    aria-selected={surface === 'bootstrap'}
                    aria-controls="ce-onb-bootstrap-panel"
                    tabIndex={surface === 'bootstrap' ? 0 : -1}
                    onClick={() => setSurface('bootstrap')}
                  >
                    <FileKey2 size={15} aria-hidden="true" />Bootstrap
                  </button>
                )}
              </div>
              <div className="ce-onb-command-assurance">
                <Radio size={14} aria-hidden="true" />
                <span>{snapshot.mode === 'aws' ? 'AWS control plane' : 'Local simulator'} · generated {new Date(snapshot.generatedAt).toLocaleTimeString()}</span>
              </div>
              {canOperate && (
                <button type="button" className="primary ce-onb-command-cta" onClick={() => setSurface('wizard')}>
                  <PackagePlus size={15} aria-hidden="true" />Verify device
                </button>
              )}
            </div>
          )}

          {surface === 'gateways' && (
            <div id="ce-onb-gateways-panel" role="tabpanel" aria-labelledby="ce-onb-gateways-tab">
              <GatewayInventory
                gateways={snapshot.gateways}
                sites={snapshot.sites}
                models={snapshot.gatewayModels}
                profiles={snapshot.profiles}
                operations={snapshot.operations}
                controller={snapshot.controller}
                preferredSiteId={preferredSiteId}
                refreshing={refreshing}
                canVerifyDevice={canOperate}
                canDecommission={canAdminister}
                canDeployProfile={canOperate}
                onRefresh={() => void refresh()}
                onVerifyDevice={() => setSurface('wizard')}
                onOperation={openOperation}
              />
            </div>
          )}

          {surface === 'profiles' && (
            <div id="ce-onb-profiles-panel" role="tabpanel" aria-labelledby="ce-onb-profiles-tab">
              <ProfileManager
                profiles={snapshot.profiles}
                models={snapshot.gatewayModels}
                canPublish={canAdminister}
                onProfileCreated={upsertProfile}
              />
            </div>
          )}

          {surface === 'controller' && (
            <div id="ce-onb-controller-panel" role="tabpanel" aria-labelledby="ce-onb-controller-tab">
              <ControllerManager
                controller={snapshot.controller}
                canConfigure={canAdminister}
                onControllerSaved={upsertController}
              />
            </div>
          )}

          {surface === 'bootstrap' && canIssueBootstrapPackage && (
            <div id="ce-onb-bootstrap-panel" role="tabpanel" aria-labelledby="ce-onb-bootstrap-tab">
              <BootstrapPackageManager
                models={snapshot.gatewayModels}
                profiles={snapshot.profiles}
                sites={snapshot.sites}
                onVerifySerial={(serialNumber) => {
                  setWizardSerial(serialNumber);
                  setSurface('wizard');
                }}
              />
            </div>
          )}

          {surface === 'wizard' && (
            <OnboardingWizard
              profiles={snapshot.profiles}
              models={snapshot.gatewayModels}
              preferredSiteId={preferredSiteId}
              initialSerialNumber={wizardSerial}
              onCancel={() => setSurface('gateways')}
              onStarted={openOperation}
            />
          )}

          {surface === 'operation' && activeOperation && (
            <OperationProgress
              operation={activeOperation}
              sites={snapshot.sites}
              streamState={streamState}
              onUpdate={upsertOperation}
              onBack={() => {
                setSurface('gateways');
                void refresh();
              }}
            />
          )}

          {surface === 'operation' && !activeOperation && (
            <section className="ce-onb-load-error" aria-labelledby="operation-missing-title">
              <span><TriangleAlert size={24} aria-hidden="true" /></span>
              <h2 id="operation-missing-title">Operation details are unavailable</h2>
              <p>Refresh the inventory and reopen the operation from its gateway row.</p>
              <button type="button" onClick={() => { setSurface('gateways'); void refresh(); }}>Return to inventory</button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
