import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEscape } from './Toast';
import {
  LayoutDashboard, Laptop, Siren, PackagePlus,
  Sparkles, Settings, Search, ArrowRight, MapPin,
  AlertOctagon, FileSearch, GitBranch, Layers, TrendingUp, CloudCog, ShieldCheck, Video, Box, Activity, Bot,
} from 'lucide-react';
import { branches, BRANCH_TO_IPSEC_SOURCE, BRANCH_TO_DEVICE_TOPIC } from '../data/mock';
import { useDevices } from './useDevices';
import { matchesDeviceInventory } from './deviceInventory';
import { orderCommandItems } from './commandResults';
import { useDialogFocus } from './useDialogFocus';

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
  const listRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const { devices } = useDevices();
  useEscape(onClose, open);
  useDialogFocus(open, dialogRef);

  const items: Item[] = useMemo(() => orderCommandItems<Item>([
    { id: 'go-overview',     group: 'Navigate', label: 'Open Home',                  icon: LayoutDashboard, run: () => nav('/') },
    { id: 'go-offerings',    group: 'Navigate', label: 'Open Challenges / Offerings',      icon: CloudCog,        run: () => nav('/service-offerings') },
    { id: 'go-dps',          group: 'Navigate',  label: 'Open Dynamic Failover',       icon: GitBranch,       run: () => nav('/path-selection') },
    { id: 'go-aar',          group: 'Navigate',  label: 'Open Application Traffic Routing', icon: Layers,          run: () => nav('/app-routing') },
    { id: 'go-it',           group: 'Navigate', label: 'Open IT Devices',                icon: Laptop,          run: () => nav('/it-devices') },
    { id: 'go-ot',           group: 'Navigate', label: 'Open OT Devices',                icon: Siren,           run: () => nav('/ot-devices') },
    { id: 'go-hardware-anomalies', group: 'Navigate', label: 'Open EA:GLE',  icon: Activity,        run: () => nav('/hardware-anomalies') },
    { id: 'go-gateway-twin', group: 'Navigate', label: 'Open Gateway Twin',              icon: Box,             run: () => nav('/gateway-twin') },
    { id: 'go-video',       group: 'Navigate', label: 'Open Video Analytics',            icon: Video,           run: () => nav('/video-analytics') },
    { id: 'go-costinsights', group: 'Navigate', label: 'Open Cost Savings',             icon: TrendingUp,      run: () => nav('/cost-insights') },
    { id: 'go-onboard',      group: 'Navigate', label: 'Open Gateway Onboarding',                icon: PackagePlus,     run: () => nav('/onboarding') },
    { id: 'go-incidents',    group: 'Operate',  label: 'Open Incidents',                 icon: AlertOctagon,    run: () => nav('/incidents') },
    { id: 'go-security',     group: 'Operate',  label: 'Open Security',                  icon: ShieldCheck,     run: () => nav('/security') },
    { id: 'go-audit',        group: 'Operate',  label: 'Open Audit Log',                 icon: FileSearch,      run: () => nav('/audit') },
    { id: 'go-ai',           group: 'Navigate', label: 'Ask AI',                         icon: Sparkles,        run: () => nav('/ask-ai') },
    { id: 'go-agentic',      group: 'Navigate', label: 'Open Agentic AI',               icon: Bot,             run: () => nav('/agentic-ai') },
    { id: 'go-settings',     group: 'Navigate', label: 'Open Settings',                  icon: Settings,        run: () => nav('/settings') },
    ...branches.map((b) => ({
      id: `branch-${b.id}`, group: 'Switch branch', label: b.name, hint: b.location,
      icon: MapPin,
      run: () => { onBranchChange(b.id); nav('/'); },
    })),
    ...devices.flatMap((device): Item[] => {
      const branch = branches.find((candidate) => matchesDeviceInventory(device, BRANCH_TO_IPSEC_SOURCE[candidate.id], BRANCH_TO_DEVICE_TOPIC[candidate.id]));
      if (!branch) return [];
      return [{ id: `device-${branch.id}-${device.id}`, group: 'Devices', label: device.name || device.mac, hint: `${device.ip} · ${device.mac} · ${branch.name}`, icon: device.domain === 'OT' ? Siren : Laptop,
        run: () => { onBranchChange(branch.id); nav(`/${device.domain.toLowerCase()}-devices?q=${encodeURIComponent(device.mac)}`); },
      }];
    }),
  ]), [nav, onBranchChange, devices]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) =>
      i.label.toLowerCase().includes(s) ||
      (i.hint?.toLowerCase().includes(s) ?? false) ||
      i.group.toLowerCase().includes(s),
    );
  }, [items, q]);

  useEffect(() => { listRef.current?.querySelector('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' }); }, [active, q]);

  if (!open) return null;
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));

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
    if (e.key === 'ArrowDown')      { e.preventDefault(); setActive((a) => Math.max(0, Math.min(filtered.length - 1, a + 1))); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter')     { e.preventDefault(); runAt(activeIndex); }
  }

  let cursor = -1;
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div className="cmdk" ref={dialogRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search pages, branches and devices">
        <div className="cmdk-input-row">
          <Search size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKey}
            placeholder="Search pages, branches, actions…"
            aria-label="Search commands and devices"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={filtered[activeIndex] ? `command-${filtered[activeIndex].id}` : undefined}
            style={{ background: 'transparent', border: 'none', flex: 1, outline: 'none', fontSize: 15 }}
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="cmdk-list" ref={listRef} id="command-results" role="listbox">
          {[...groups.entries()].map(([g, arr]) => (
            <div key={g}>
              <div className="cmdk-group-label">{g}</div>
              {arr.map((i) => {
                cursor++;
                const isActive = cursor === activeIndex;
                const Icon = i.icon;
                const idx = cursor;
                return (
                  <div
                    key={i.id}
                    id={`command-${i.id}`}
                    role="option"
                    aria-selected={isActive}
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
          <span><span className="kbd">{typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'}</span><span className="kbd">K</span> Toggle</span>
        </div>
      </div>
    </div>
  );
}
