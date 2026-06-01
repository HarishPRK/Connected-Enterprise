import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEscape } from './Toast';
import {
  LayoutDashboard, Router, Laptop, Siren, Shuffle, PackagePlus,
  Sparkles, Settings, Search, ArrowRight, MapPin, Building2,
  AlertOctagon, FileSearch, GitBranch, Layers, TrendingUp, CloudCog, ShieldCheck,
} from 'lucide-react';
import { branches } from '../data/mock';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onBranchChange: (id: string) => void;
}

interface Item {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ComponentType<{ size?: number }>;
  run: () => void;
}

export function CommandPalette({ open, onClose, onBranchChange }: CommandPaletteProps) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEscape(onClose, open);

  const items: Item[] = useMemo(() => [
    { id: 'go-overview',     group: 'Navigate', label: 'Open Overview',                  icon: LayoutDashboard, run: () => nav('/') },
    { id: 'go-fleet',        group: 'Navigate', label: 'Open Fleet',                     icon: Building2,       run: () => nav('/fleet') },
    { id: 'go-conn',         group: 'Navigate', label: 'Open Connectivity',              icon: Router,          run: () => nav('/connectivity') },
    { id: 'go-it',           group: 'Navigate', label: 'Open IT Devices',                icon: Laptop,          run: () => nav('/it-devices') },
    { id: 'go-ot',           group: 'Navigate', label: 'Open OT Devices',                icon: Siren,           run: () => nav('/ot-devices') },
    { id: 'go-naas',         group: 'Insights', label: 'Open Network as a Service',      icon: CloudCog,        run: () => nav('/naas') },
    { id: 'go-costinsights', group: 'Insights', label: 'Open Cost Insights',             icon: TrendingUp,      run: () => nav('/cost-insights') },
    { id: 'go-incidents',    group: 'Operate',  label: 'Open Incidents',                 icon: AlertOctagon,    run: () => nav('/incidents') },
    { id: 'go-security',     group: 'Operate',  label: 'Open Security',                  icon: ShieldCheck,     run: () => nav('/security') },
    { id: 'go-audit',        group: 'Operate',  label: 'Open Audit Log',                 icon: FileSearch,      run: () => nav('/audit') },
    { id: 'go-dps',          group: 'Routing',  label: 'Open Dynamic Path Selection',    icon: GitBranch,       run: () => nav('/path-selection') },
    { id: 'go-aar',          group: 'Routing',  label: 'Open Application Aware Routing', icon: Layers,          run: () => nav('/app-routing') },
    { id: 'go-policy',       group: 'Navigate', label: 'Open Traffic Policy',            icon: Shuffle,         run: () => nav('/traffic-policy') },
    { id: 'go-onboard',      group: 'Navigate', label: 'Open Onboarding',                icon: PackagePlus,     run: () => nav('/onboarding') },
    { id: 'go-ai',           group: 'Navigate', label: 'Ask AI',                         icon: Sparkles,        run: () => nav('/ask-ai') },
    { id: 'go-settings',     group: 'Navigate', label: 'Open Settings',                  icon: Settings,        run: () => nav('/settings') },
    ...branches.map((b) => ({
      id: `branch-${b.id}`, group: 'Switch branch', label: b.name, hint: b.location,
      icon: MapPin,
      run: () => { onBranchChange(b.id); nav('/'); },
    })),
  ], [nav, onBranchChange]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) =>
      i.label.toLowerCase().includes(s) ||
      (i.hint?.toLowerCase().includes(s) ?? false) ||
      i.group.toLowerCase().includes(s),
    );
  }, [items, q]);

  useEffect(() => {
    if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);
  useEffect(() => { setActive(0); }, [q]);

  if (!open) return null;

  // Group results
  const groups = new Map<string, Item[]>();
  filtered.forEach((i) => {
    const arr = groups.get(i.group) ?? [];
    arr.push(i); groups.set(i.group, arr);
  });

  function runAt(idx: number) {
    const item = filtered[idx]; if (!item) return;
    item.run(); onClose();
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown')      { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter')     { e.preventDefault(); runAt(active); }
  }

  let cursor = -1;
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="cmdk-input-row">
          <Search size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search pages, branches, actions…"
            style={{ background: 'transparent', border: 'none', flex: 1, outline: 'none', fontSize: 15 }}
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="cmdk-list">
          {[...groups.entries()].map(([g, arr]) => (
            <div key={g}>
              <div className="cmdk-group-label">{g}</div>
              {arr.map((i) => {
                cursor++;
                const isActive = cursor === active;
                const Icon = i.icon;
                const idx = cursor;
                return (
                  <div
                    key={i.id}
                    className={`cmdk-item ${isActive ? 'active' : ''}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => runAt(idx)}
                  >
                    <Icon size={15} />
                    <span style={{ flex: 1 }}>{i.label}</span>
                    {i.hint && <span className="cmdk-hint">{i.hint}</span>}
                    <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No matches</div>
          )}
        </div>
        <div className="cmdk-foot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> Navigate</span>
          <span><span className="kbd">↵</span> Open</span>
          <span><span className="kbd">⌘</span><span className="kbd">K</span> Toggle</span>
        </div>
      </div>
    </div>
  );
}
