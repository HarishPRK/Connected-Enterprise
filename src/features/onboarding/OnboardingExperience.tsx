import { useRef, useState } from 'react';
import { CloudCog, LogOut, MapPin, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
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

type Surface = WorkspaceSurface | 'operation';

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
  const workspaceRef = useRef<HTMLDivElement>(null);
  const navigate = (next: Surface) => {
    setSurface(next);
    window.requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  };
  const openOperation = (operation: OnboardingOperation) => {
    upsertOperation(operation);
    setOperationId(operation.id);
    navigate('operation');
  };

  const activeOperation = operationId
    ? snapshot?.operations.find((operation) => operation.id === operationId)
    : undefined;
  const preferredSite = preferredSiteId
    ? snapshot?.sites.find((site) => site.id === preferredSiteId)
    : undefined;

  return (
    <div className="ce-onb-page">
      <header className="ce-onb-masthead">
        <div className="ce-onb-masthead-title">
          <span className="ce-onb-masthead-mark"><CloudCog size={22} aria-hidden="true" /></span>
          <div><h1>Gateway Onboarding</h1><p>Device identity, configuration, and activation. One connected workflow.</p></div>
        </div>
        {snapshot && (
          <div className="ce-onb-page-context">
            <span><ShieldCheck size={13} aria-hidden="true" />{snapshot.tenant.name}</span>
            {preferredSite && <span><MapPin size={13} aria-hidden="true" />{preferredSite.name}</span>}
            {user && (
              <button type="button" className="ce-onb-signout" onClick={signOut} title={user.email ?? user.subject}>
                <LogOut size={13} aria-hidden="true" />Sign out
              </button>
            )}
          </div>
        )}
      </header>

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
                  {localSimulator ? <OnboardingWizard
                    profiles={snapshot.profiles}
                    models={snapshot.gatewayModels}
                    preferredSiteId={preferredSiteId}
                    onCancel={() => navigate('gateways')}
                    onStarted={openOperation}
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
