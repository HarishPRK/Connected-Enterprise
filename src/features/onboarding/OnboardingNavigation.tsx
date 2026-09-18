import { ArrowUpRight, CloudCog, FileKey2, FileLock2, Radio, ServerCog } from 'lucide-react';
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
    { id: 'gateways' as const, title: 'Gateways', description: 'Inventory & device health', icon: CloudCog, count: gatewayCount },
    { id: 'profiles' as const, title: 'Profiles', description: 'Configuration catalog', icon: FileLock2, count: profileCount },
    { id: 'controller' as const, title: 'Controller', description: 'Delivery settings', icon: ServerCog },
    ...(canOperate ? [{ id: 'bootstrap' as const, title: 'Initiate Onboarding', description: 'Prepare & activate a gateway', icon: FileKey2 }] : []),
  ];
  const current = surface === 'operation' ? 'gateways' : surface;
  return (
    <aside className="ce-onb-workspace-sidebar">
      <nav className="ce-onb-workspace-nav" aria-label="Onboarding workspace">
        {items.map(({ id, title, description, icon: Icon, count }) => (
          <button key={id} type="button" aria-current={current === id ? 'page' : undefined}
            onClick={() => onNavigate(id)}>
            <Icon size={19} aria-hidden="true" />
            <span className="ce-onb-nav-copy"><strong>{title}</strong><small>{description}</small></span>
            {count !== undefined ? <span className="ce-onb-nav-count">{count}</span>
              : id === 'bootstrap' ? <ArrowUpRight className="ce-onb-nav-arrow" size={15} aria-hidden="true" /> : null}
          </button>
        ))}
      </nav>
      <div className="ce-onb-workspace-status">
        <Radio size={16} aria-hidden="true" />
        <div>
          <strong>{localSimulator ? 'Local simulator' : 'AWS control plane'}</strong>
          <span><i data-connected={streamState === 'connected'} aria-hidden="true" />
            {streamState === 'connected' ? 'Live updates' : streamState === 'polling' ? 'Polling for updates' : 'Reconnecting'}
          </span>
          <small>Updated <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></small>
        </div>
      </div>
    </aside>
  );
}
