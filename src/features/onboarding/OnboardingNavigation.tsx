import { CloudCog, FileKey2, FileLock2, FlaskConical, ServerCog } from 'lucide-react';
import type { OnboardingStreamState } from './useOnboardingData';

export type WorkspaceSurface = 'gateways' | 'profiles' | 'controller' | 'bootstrap';

interface OnboardingNavigationProps {
  surface: WorkspaceSurface | 'operation';
  onNavigate: (surface: WorkspaceSurface) => void;
  canOperate: boolean;
  gatewayCount?: number;
  profileCount?: number;
  streamState: OnboardingStreamState;
  localSimulator: boolean;
  generatedAt?: string;
  unavailableLabel?: string;
  showOnboarding?: boolean;
  onSimulateFlow?: () => void;
  simulationSelected?: boolean;
}

export function OnboardingNavigation({
  surface, onNavigate, canOperate, gatewayCount, profileCount, streamState, localSimulator, generatedAt,
  unavailableLabel, showOnboarding = canOperate,
  onSimulateFlow, simulationSelected = false,
}: OnboardingNavigationProps) {
  const items = [
    { id: 'gateways' as const, title: 'Gateways', icon: CloudCog, count: gatewayCount ?? '—' },
    { id: 'profiles' as const, title: 'Profiles', icon: FileLock2, count: profileCount ?? '—' },
    { id: 'controller' as const, title: 'Controller', icon: ServerCog },
    ...(showOnboarding ? [{ id: 'bootstrap' as const, title: 'Initiate Onboarding', icon: FileKey2 }] : []),
  ];
  const current = surface === 'operation' ? 'gateways' : surface;
  return (
    <div className="ce-onb-workspace-toolbar">
      <nav className="ce-onb-workspace-nav" aria-label="Onboarding workspace">
        {items.map(({ id, title, icon: Icon, count }) => (
          <button key={id} type="button" aria-current={current === id && !(id === 'bootstrap' && simulationSelected) ? 'page' : undefined}
            onClick={() => onNavigate(id)}>
            <Icon size={16} aria-hidden="true" />
            <span>{title}</span>
            {count !== undefined && <span className="ce-onb-nav-count">{count}</span>}
          </button>
        ))}
        {onSimulateFlow && <button type="button" className="ce-onb-simulate-action"
          aria-current={current === 'bootstrap' && simulationSelected ? 'page' : undefined}
          onClick={onSimulateFlow}>
          <FlaskConical size={16} aria-hidden="true" /><span>SIMULATE FLOW</span>
        </button>}
      </nav>
      <div className="ce-onb-workspace-status">
        <strong>{!generatedAt ? 'Onboarding workspace' : localSimulator ? 'Local simulator' : 'AWS control plane'}</strong>
        <span><i data-connected={!unavailableLabel && streamState === 'connected'} aria-hidden="true" />
          {unavailableLabel ?? (streamState === 'connected' ? 'Live' : streamState === 'polling' ? 'Polling' : 'Reconnecting')}
        </span>
        {generatedAt && <small>Updated <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></small>}
      </div>
    </div>
  );
}
