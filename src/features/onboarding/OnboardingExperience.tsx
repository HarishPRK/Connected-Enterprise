import { useRef, useState } from 'react';
import { CloudCog, FileKey2, FlaskConical, LogIn, LogOut, MapPin, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { BootstrapPackageManager } from './BootstrapPackageManager';
import { ControllerManager } from './ControllerManager';
import { GatewayInventory } from './GatewayInventory';
import { OnboardingWizard } from './OnboardingWizard';
import { OperationProgress } from './OperationProgress';
import { ProfileManager } from './ProfileManager';
import type { OnboardingOperation } from './types';
import { useOnboardingData } from './useOnboardingData';
import { useOnboardingAuth } from './onboardingAuthContext';
import { currentProfiles } from './profileSelection';
import { OnboardingNavigation, type WorkspaceSurface } from './OnboardingNavigation';
import './activation-workspace.css';
import { onboardingGatewaySimulatorAvailable } from './auth';

type Surface = WorkspaceSurface | 'operation';

const pendingPanels = {
  gateways: { title: 'Gateways', description: 'Review gateway identity, site assignments, and configuration health.' },
  profiles: { title: 'Profiles', description: 'Review and publish immutable gateway configuration profiles.' },
  controller: { title: 'Controller', description: 'Manage the USP Controller and MQTT connection settings for your tenant.' },
  bootstrap: { title: 'Initiate Onboarding', description: 'Prepare a bootstrap package and register a gateway to its site.' },
  operation: { title: 'Operation', description: 'Follow configuration delivery and reported gateway health.' },
} satisfies Record<Surface, { title: string; description: string }>;

export function OnboardingExperience({ preferredSiteId }: { preferredSiteId?: string }) {
  const { user, signOut, signIn, status: authenticationStatus, authenticationRequired, authenticationError, accessMode } = useOnboardingAuth();
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
  } = useOnboardingData({ enabled: authenticationStatus === 'authenticated' });
  const localSimulator = snapshot?.mode === 'local-simulator';
  const tenantRole = user?.tenantRole;
  const canOperate = localSimulator || tenantRole === 'platform_admin' || tenantRole === 'tenant_admin' || tenantRole === 'operator';
  const canAdminister = localSimulator || tenantRole === 'platform_admin' || tenantRole === 'tenant_admin';
  const canIssueBootstrapPackage = snapshot?.mode === 'aws'
    && (tenantRole === 'platform_admin' || tenantRole === 'tenant_admin');
  const needsSignIn = accessMode === 'cognito' && authenticationRequired && authenticationStatus !== 'authenticated';
  const checkingSignIn = authenticationStatus === 'checking';
  const [surface, setSurface] = useState<Surface>('gateways');
  const [operationId, setOperationId] = useState<string>();
  const [managedSimulatorSelected, setManagedSimulatorSelected] = useState(false);
  const [flowLaunchError, setFlowLaunchError] = useState<string>();
  const managedSimulatorAvailable = snapshot?.mode === 'aws' && onboardingGatewaySimulatorAvailable();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const navigate = (next: Surface) => {
    setSurface(next);
    window.requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  };
  const openOperation = (operation: OnboardingOperation, launchError?: string) => {
    upsertOperation(operation);
    setOperationId(operation.id);
    setFlowLaunchError(launchError);
    navigate('operation');
  };

  const activeOperation = operationId
    ? snapshot?.operations.find((operation) => operation.id === operationId)
    : undefined;
  const preferredSite = preferredSiteId
    ? snapshot?.sites.find((site) => site.id === preferredSiteId)
    : undefined;

  return (
    <div className="ce-onb-page ce-onb-activation-workspace">
      <header className="ce-onb-masthead">
        <div className="ce-onb-masthead-title">
          <span className="ce-onb-masthead-mark"><CloudCog size={22} aria-hidden="true" /></span>
          <div><h1>Gateway Onboarding</h1><p>From device identity to a healthy gateway.</p></div>
        </div>
          <div className="ce-onb-page-context">
            {snapshot && <span><ShieldCheck size={13} aria-hidden="true" />{snapshot.tenant.name}</span>}
            {preferredSite && <span><MapPin size={13} aria-hidden="true" />{preferredSite.name}</span>}
            {needsSignIn && <>
              <span role="status">{checkingSignIn ? 'Checking session…' : 'Session required for live data'}</span>
              <button type="button" className="ce-onb-signout" onClick={signIn} disabled={checkingSignIn}>
                <LogIn size={13} aria-hidden="true" />Sign in
              </button>
            </>}
            {user && accessMode === 'cognito' && (
              <button type="button" className="ce-onb-signout" onClick={signOut} title={user.email ?? user.subject}>
                <LogOut size={13} aria-hidden="true" />Sign out
              </button>
            )}
          </div>
      </header>

      {authenticationError && <div className="ce-onb-alert is-warning" role="status">
        <TriangleAlert size={17} aria-hidden="true" /><span>{authenticationError}</span>
      </div>}

      {!snapshot ? (
        <div className="ce-onb-workspace" ref={workspaceRef}>
          <OnboardingNavigation surface={surface} onNavigate={navigate} canOperate={Boolean(canOperate)}
            showOnboarding={needsSignIn || Boolean(canOperate)} localSimulator={false} streamState={streamState}
            unavailableLabel={checkingSignIn ? 'Checking connection' : needsSignIn ? 'Awaiting sign-in' : loading ? 'Loading inventory' : 'Unavailable'} />
          <div className="ce-onb-workspace-content">
            <section id={`ce-onb-${surface}-panel`} aria-labelledby="onboarding-pending-title" aria-busy={checkingSignIn || loading}>
              <div className="ce-onb-section-heading"><div>
                <h2 id="onboarding-pending-title">{pendingPanels[surface].title}</h2>
                <p>{pendingPanels[surface].description}</p>
              </div></div>
              <div className={`ce-onb-alert${!needsSignIn && !loading ? ' is-warning' : ''}`} role="status">
                {checkingSignIn || (!needsSignIn && loading) ? <>
                  <span className="ce-onb-spinner" aria-hidden="true" />
                  <span>{checkingSignIn ? 'Connecting to onboarding…' : 'Retrieving tenant inventory…'}</span>
                </> : needsSignIn ? <>
                  <ShieldCheck size={17} aria-hidden="true" />
                  <span>Tenant data and controls become available after sign-in.</span>
                </> : <>
                  <TriangleAlert size={17} aria-hidden="true" />
                  <span>{authenticationError ?? error ?? 'The service did not return an onboarding snapshot.'}</span>
                  <button type="button" onClick={() => {
                    if (authenticationStatus === 'error' && accessMode !== 'cognito') window.location.reload();
                    else void refresh();
                  }} disabled={refreshing}>
                    <RefreshCw size={14} aria-hidden="true" />{refreshing ? 'Retrying…' : 'Retry connection'}
                  </button>
                </>}
              </div>
            </section>
          </div>
        </div>
      ) : (
        <>
          {error && (
            <div className="ce-onb-alert is-warning" role="status">
              <TriangleAlert size={17} aria-hidden="true" />
              <span>{error} Showing the most recently received inventory.</span>
              <button type="button" onClick={() => void refresh()} disabled={refreshing}>Retry</button>
            </div>
          )}

          <div className="ce-onb-workspace" ref={workspaceRef}>
            <OnboardingNavigation surface={surface} onNavigate={navigate} canOperate={Boolean(canOperate)}
              gatewayCount={snapshot.gateways.length} profileCount={currentProfiles(snapshot.profiles).length}
              localSimulator={Boolean(localSimulator)} streamState={streamState} generatedAt={snapshot.generatedAt} />
            <div className="ce-onb-workspace-content">

              {surface === 'gateways' && (
                <div id="ce-onb-gateways-panel">
                  <GatewayInventory
                    gateways={snapshot.gateways}
                    sites={snapshot.sites}
                    models={snapshot.gatewayModels}
                    profiles={snapshot.profiles}
                    operations={snapshot.operations}
                    controller={snapshot.controller}
                    preferredSiteId={preferredSiteId}
                    refreshing={refreshing}
                    canInitiateOnboarding={canOperate}
                    canDecommission={canAdminister}
                    canResetRegistration={snapshot.canResetGatewayRegistration}
                    canDeployProfile={canOperate}
                    onRefresh={() => void refresh()}
                    onInitiateOnboarding={() => navigate('bootstrap')}
                    onViewProfiles={() => navigate('profiles')}
                    localSimulator={Boolean(localSimulator)}
                    onOperation={openOperation}
                  />
                </div>
              )}

              {surface === 'profiles' && (
                <div id="ce-onb-profiles-panel">
                  <ProfileManager
                    profiles={snapshot.profiles}
                    models={snapshot.gatewayModels}
                    canPublish={canAdminister}
                    onProfileCreated={upsertProfile}
                  />
                </div>
              )}

              {surface === 'controller' && (
                <div id="ce-onb-controller-panel">
                  <ControllerManager
                    controller={snapshot.controller}
                    canConfigure={canAdminister}
                    onControllerSaved={upsertController}
                  />
                </div>
              )}

              {surface === 'bootstrap' && canOperate && (
                <div id="ce-onb-bootstrap-panel">
                  {managedSimulatorAvailable && <div className="ce-onb-enrollment-choice" role="group" aria-label="Gateway enrollment type">
                    <button type="button" aria-pressed={!managedSimulatorSelected} onClick={() => setManagedSimulatorSelected(false)}><FileKey2 size={16} aria-hidden="true" />Physical gateway</button>
                    <button type="button" aria-pressed={managedSimulatorSelected} onClick={() => setManagedSimulatorSelected(true)}><FlaskConical size={16} aria-hidden="true" />Simulated gateway</button>
                    <p>{managedSimulatorSelected ? 'Register a MOCK- gateway, then INITIATE FLOW. The server prepares the connection internally.' : 'Prepare a certificate package for installation on your physical gateway.'}</p>
                  </div>}
                  {localSimulator || managedSimulatorAvailable && managedSimulatorSelected ? <OnboardingWizard
                    key={managedSimulatorSelected ? 'managed-gateway' : 'local-gateway'}
                    profiles={snapshot.profiles}
                    models={snapshot.gatewayModels}
                    preferredSiteId={preferredSiteId}
                    onCancel={() => navigate('gateways')}
                    onStarted={openOperation}
                    managedSimulator={Boolean(managedSimulatorAvailable && managedSimulatorSelected)}
                  /> : <BootstrapPackageManager
                    key={`${snapshot.tenant.id}:${user?.subject ?? ''}`}
                    profiles={snapshot.profiles}
                    sites={snapshot.sites}
                    tenantId={snapshot.tenant.id}
                    resumeScope={user?.subject ?? ''}
                    canIssue={canIssueBootstrapPackage}
                    operations={snapshot.operations}
                    gateways={snapshot.gateways}
                    preferredSiteId={preferredSiteId}
                    onIssued={refresh}
                    onOperation={openOperation}
                  />}
                </div>
              )}

              {surface === 'operation' && activeOperation && (
                <OperationProgress
                  operation={activeOperation}
                  sites={snapshot.sites}
                  streamState={streamState}
                  onUpdate={upsertOperation}
                  flowLaunchError={flowLaunchError}
                  onContinueOnboarding={canOperate ? () => navigate('bootstrap') : undefined}
                  onBack={() => {
                    navigate('gateways');
                    void refresh();
                  }}
                />
              )}

              {surface === 'operation' && !activeOperation && (
                <section className="ce-onb-load-error" aria-labelledby="operation-missing-title">
                  <span><TriangleAlert size={24} aria-hidden="true" /></span>
                  <h2 id="operation-missing-title">Operation details are unavailable</h2>
                  <p>Refresh the inventory and reopen the operation from its gateway row.</p>
                  <button type="button" onClick={() => { navigate('gateways'); void refresh(); }}>Return to inventory</button>
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
