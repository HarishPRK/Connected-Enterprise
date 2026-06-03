import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Router, Laptop, Siren, Shuffle, Building2,
  PackagePlus, Sparkles, Settings, GitBranch, Layers, AlertOctagon, FileSearch,
  TrendingUp, CloudCog, ShieldCheck, Video, Bot,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';

const nav = [
  { to: '/',                 label: 'Overview',                  icon: LayoutDashboard, section: 'Monitor' },
  { to: '/fleet',            label: 'Fleet',                     icon: Building2,       section: 'Monitor' },
  { to: '/connectivity',     label: 'Connectivity',              icon: Router,          section: 'Monitor' },
  { to: '/it-devices',       label: 'IT Devices',                icon: Laptop,          section: 'Monitor' },
  { to: '/ot-devices',       label: 'OT Devices',                icon: Siren,           section: 'Monitor' },
  { to: '/video-analytics',  label: 'Video Analytics',           icon: Video,           section: 'Monitor' },
  { to: '/naas',             label: 'Network as a Service',      icon: CloudCog,        section: 'Insights' },
  { to: '/cost-insights',    label: 'Cost Insights',             icon: TrendingUp,      section: 'Insights' },
  { to: '/incidents',        label: 'Incidents',                 icon: AlertOctagon,    section: 'Operate' },
  { to: '/security',         label: 'Security',                  icon: ShieldCheck,     section: 'Operate' },
  { to: '/audit',            label: 'Audit Log',                 icon: FileSearch,      section: 'Operate' },
  { to: '/path-selection',   label: 'Dynamic Failover',    icon: GitBranch,       section: 'Routing' },
  { to: '/app-routing',      label: 'Application Traffic Routing', icon: Layers,          section: 'Routing' },
  { to: '/traffic-policy',   label: 'Traffic Policy',            icon: Shuffle,         section: 'Manage' },
  { to: '/onboarding',       label: 'Onboarding',                icon: PackagePlus,     section: 'Manage' },
  { to: '/ask-ai',           label: 'Ask AI',                    icon: Sparkles,        section: 'Assist' },
  { to: '/agentic-ai',       label: 'Agentic AI',                icon: Bot,             section: 'Assist' },
  { to: '/settings',         label: 'Settings',                  icon: Settings,        section: 'Assist' },
];

const COLLAPSED_KEY = 'ce-sidebar-collapsed';

export function Sidebar() {
  // Read the persisted preference on first render so the sidebar mounts in
  // the right state (avoids a width-flash after hydrate).
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  });

  // Reflect the state onto <html> so .app-shell can collapse the grid column
  // via CSS — keeps the layout logic in one place.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-sidebar-collapsed', collapsed ? 'true' : 'false');
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore quota */ }
  }, [collapsed]);

  const sections = Array.from(new Set(nav.map((n) => n.section)));

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      {/* Collapse toggle — full width when expanded, icon-only when collapsed */}
      <button
        className="sidebar-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        {!collapsed && <span>Collapse</span>}
      </button>

      {sections.map((s) => (
        <div key={s}>
          <div className="section-label">{s}</div>
          {nav.filter((n) => n.section === s).map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
                title={collapsed ? n.label : undefined}
              >
                <Icon size={16} />
                <span>{n.label}</span>
              </NavLink>
            );
          })}
        </div>
      ))}
      <div className="sidebar-footer">
        v0.1.0 · <span className="gradient-text">preview build</span>
      </div>
    </aside>
  );
}
