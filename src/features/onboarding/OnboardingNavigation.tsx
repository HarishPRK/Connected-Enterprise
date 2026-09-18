import { CloudCog, FileKey2, FileLock2, ServerCog } from 'lucide-react';
import type { OnboardingStreamState } from './useOnboardingData';

export type WorkspaceSurface = 'gateways' | 'profiles' | 'controller' | 'bootstrap';

interface OnboardingNavigationProps {
  surface: WorkspaceSurface | 'operation';
  onNavigate: (surface: WorkspaceSurface) => void;
  canOperate: boolean;
  gatewayCount: number;
  profileCount: number;
  streamState: OnboardingStreamState;
  localSimulator: boolean;
  generatedAt: string;
}

export function OnboardingNavigation({
  surface, onNavigate, canOperate, gatewayCount, profileCount, streamState, localSimulator, generatedAt,
}: OnboardingNavigationProps) {
  const items = [
    { id: 'gateways' as const, title: 'Gateways', icon: CloudCog, count: gatewayCount },
    { id: 'profiles' as const, title: 'Profiles', icon: FileLock2, count: profileCount },
    { id: 'controller' as const, title: 'Controller', icon: ServerCog },
    ...(canOperate ? [{ id: 'bootstrap' as const, title: 'Initiate Onboarding', icon: FileKey2 }] : []),
  ];
  const current = surface === 'operation' ? 'gateways' : surface;
  return (
    <div className="ce-onb-workspace-toolbar">
      <nav className="ce-onb-workspace-nav" aria-label="Onboarding workspace">
        {items.map(({ id, title, icon: Icon, count }) => (
          <button key={id} type="button" aria-current={current === id ? 'page' : undefined}
            onClick={() => onNavigate(id)}>
            <Icon size={16} aria-hidden="true" />
            <span>{title}</span>
            {count !== undefined && <span className="ce-onb-nav-count">{count}</span>}
          </button>
        ))}
      </nav>
      <div className="ce-onb-workspace-status">
        <strong>{localSimulator ? 'Local simulator' : 'AWS control plane'}</strong>
        <span><i data-connected={streamState === 'connected'} aria-hidden="true" />
          {streamState === 'connected' ? 'Live' : streamState === 'polling' ? 'Polling' : 'Reconnecting'}
        </span>
        <small>Updated <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></small>
      </div>
    </div>
  );
}
