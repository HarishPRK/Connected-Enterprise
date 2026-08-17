import { useState } from 'react';
import { CloudCog, FileLock2, LogOut, MapPin, PackagePlus, Radio, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { GatewayInventory } from './GatewayInventory';
import { OnboardingWizard } from './OnboardingWizard';
import { OperationProgress } from './OperationProgress';
import { ProfileManager } from './ProfileManager';
import type { OnboardingOperation } from './types';
import { useOnboardingData } from './useOnboardingData';
import { useOnboardingAuth } from './onboardingAuthContext';

type Surface = 'gateways' | 'profiles' | 'wizard' | 'operation';

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
  } = useOnboardingData();
  const localSimulator = snapshot?.mode === 'local-simulator';
  const tenantRole = user?.tenantRole;
  const canOperate = localSimulator || tenantRole === 'platform_admin' || tenantRole === 'tenant_admin' || tenantRole === 'operator';
  const canAdminister = localSimulator || tenantRole === 'platform_admin' || tenantRole === 'tenant_admin';
  const [surface, setSurface] = useState<Surface>('gateways');
  const [operationId, setOperationId] = useState<string>();

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
        subtitle="Verify factory serials, assign immutable profiles, and confirm device health."
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

          {(surface === 'gateways' || surface === 'profiles') && (
            <div className="ce-onb-command-bar">
              <div className="ce-onb-tabs" role="tablist" aria-label="Onboarding workspace">
                <button
                  id="ce-onb-gateways-tab"
                  type="button"
                  role="tab"
                  aria-selected={surface === 'gateways'}
                  aria-controls="ce-onb-gateways-panel"
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
                  onClick={() => setSurface('profiles')}
                >
                  <FileLock2 size={15} aria-hidden="true" />Profiles <span>{snapshot.profiles.length}</span>
                </button>
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

          {surface === 'wizard' && (
            <OnboardingWizard
              profiles={snapshot.profiles}
              models={snapshot.gatewayModels}
              preferredSiteId={preferredSiteId}
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
