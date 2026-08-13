import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../Card';
import { BranchMap } from './BranchMap';
import { SegmentDonut } from './SegmentDonut';
import { MapPin, Clock, Cpu, Router as RouterIcon } from 'lucide-react';
import type { Branch, Device } from '../../types';

/** Alpha ramp over a theme accent — segment 0 is the full accent, later
 *  segments fade toward the background. Keeps both donuts on-brand per
 *  domain (IT = accent, OT = accent-2) and correct in both themes. */
function accentRamp(rgbVar: string, count: number): (index: number) => string {
  return (index: number) => {
    const alpha = count <= 1 ? 1 : 1 - (Math.min(index, count - 1) * 0.72) / (count - 1);
    return `rgba(var(${rgbVar}) / ${alpha.toFixed(2)})`;
  };
}

/* ────────── Combined Branch Overview Card
 *
 * One card, three logical regions:
 *  • Left  — interactive Branch Map (embedded, no nested Card)
 *  • Right — stacked sidebar:
 *      · Gateway status mini-panel (current branch)
 *      · IT mix + devices (donut + categorised list)
 *      · OT mix + devices (donut + categorised list)
 *
 * All three regions react to branch selection. The same card replaces what
 * used to be 5 separate widgets on the Overview page.
 */

interface Props {
  branchId: string;
  branch: Branch;
  devices: Device[];
  onSelectBranch: (id: string) => void;
  /** Live gateway reachability for branches with a real telemetry feed.
   *  undefined = no live feed (illustrative branch) — keep the static badges. */
  liveGatewayOnline?: boolean;
}

const KIND_LABEL: Record<Device['kind'], string> = {
  laptop: 'Laptops',
  desktop: 'Desktops',
  printer: 'Printers',
  payment: 'Payment',
  server: 'Servers',
  confphone: 'Conf phones',
  fire_sensor: 'Fire sensors',
  smoke_sensor: 'Smoke sensors',
  door_lock: 'Door locks',
  phone: 'Phones',
  tablet: 'Tablets',
  matter: 'Matter',
  shelly: 'Shelly',
  generic: 'Other',
};

function fmtUptime(h: number) {
  const d = Math.floor(h / 24); const r = h % 24;
  return `${d}d ${r}h`;
}

export function BranchOverviewCard({
  branchId, branch, devices, onSelectBranch, liveGatewayOnline,
}: Props) {
  // A branch with a live feed must not claim "Live" while its stream is down —
  // the KPI strip already tells the truth, and the two must agree.
  const online = liveGatewayOnline ?? true;
  return (
    <Card
      title="Branch Map · per-site overview"
      sub={`${branch.name} · ${branch.location} · ${devices.length} devices on this gateway`}
      right={online
        ? <span className="badge ok"><span className="dot ok" /> Live</span>
        : <span className="badge err"><span className="dot err" /> Offline</span>}
    >
      <div className="branch-overview-grid">
        {/* ── Left: the map (embedded — no nested Card) ── */}
        <div className="branch-overview-map">
          <BranchMap selectedId={branchId} onSelect={onSelectBranch} embedded />
        </div>

        {/* ── Right: gateway + IT + OT panels ── */}
        <div className="branch-overview-side">
          <GatewayMini branch={branch} online={online} />
          <DomainSection domain="IT" devices={devices} />
          <DomainSection domain="OT" devices={devices} />
        </div>
      </div>
    </Card>
  );
}

/* ─────────── Gateway mini-panel ─────────── */

function GatewayMini({ branch, online }: { branch: Branch; online: boolean }) {
  return (
    <div className="bo-section">
      <div className="bo-section-head">
        <span className="bo-section-icon" style={{ color: online ? 'var(--accent)' : 'var(--err)' }}>
          <RouterIcon size={14} />
        </span>
        <div>
          <div className="bo-section-title">Gateway</div>
          <div className="bo-section-sub">{branch.gatewayModel} · Firmware {branch.firmware}</div>
        </div>
        {online ? (
          <span className="badge ok" style={{ marginLeft: 'auto' }}>
            <span className="dot ok" />ONLINE
          </span>
        ) : (
          <span className="badge err" style={{ marginLeft: 'auto' }}>
            <span className="dot err" />OFFLINE
          </span>
        )}
      </div>
      <div className="bo-section-grid">
        <Stat icon={MapPin} label="Location" value={branch.location} />
        <Stat icon={Clock}  label="Uptime"   value={fmtUptime(branch.uptimeHours)} />
        <Stat icon={Cpu}    label="Branch ID" value={branch.id} mono />
      </div>
    </div>
  );
}

function Stat({
  icon: Icon, label, value, mono,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bo-stat">
      <div className="bo-stat-label">
        <Icon size={11} /> {label}
      </div>
      <div className={`bo-stat-value ${mono ? 'bo-stat-mono' : ''}`}>{value}</div>
    </div>
  );
}

/* ─────────── Domain section (IT or OT) ─────────── */

function DomainSection({ domain, devices }: { domain: 'IT' | 'OT'; devices: Device[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const list = devices.filter((d) => d.domain === domain);
  // Group by kind, preserve insertion order
  const groups = new Map<Device['kind'], Device[]>();
  for (const d of list) {
    const arr = groups.get(d.kind) ?? [];
    arr.push(d);
    groups.set(d.kind, arr);
  }
  const entries = [...groups.entries()];
  const total = list.length;
  const accentVar = domain === 'IT' ? 'var(--accent)' : 'var(--accent-2)';
  const route = domain === 'IT' ? '/it-devices' : '/ot-devices';
  const colorFor = accentRamp(domain === 'IT' ? '--accent-rgb' : '--accent-2-rgb', entries.length);

  const segments = entries.map(([k, arr]) => ({
    key: k,
    label: KIND_LABEL[k],
    count: arr.length,
    attention: arr.length - arr.filter((d) => d.status === 'ok').length,
  }));

  return (
    <div className="bo-section">
      <div className="bo-section-head">
        <span className="bo-domain-pill" style={{ color: accentVar, borderColor: accentVar }}>
          {domain}
        </span>
        <div>
          <div className="bo-section-title">{domain} Devices</div>
          <div className="bo-section-sub">{total} devices · {entries.length} categories</div>
        </div>
        <Link to={route} style={{ marginLeft: 'auto' }}>
          <button style={{ padding: '4px 10px', fontSize: 11 }}>View all</button>
        </Link>
      </div>
      <div className="bo-domain-body">
        <SegmentDonut
          segments={segments}
          size={100}
          colorFor={colorFor}
          hoverIndex={hoverIndex}
          onHover={setHoverIndex}
        />
        <ul className="bo-domain-list">
          {entries.map(([k, arr], i) => {
            const ok = arr.filter((d) => d.status === 'ok').length;
            const attention = ok < arr.length;
            const pct = total > 0 ? Math.round((arr.length / total) * 100) : 0;
            return (
              <li
                key={k}
                className="bo-domain-row"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
                style={{
                  opacity: hoverIndex != null && hoverIndex !== i ? 0.45 : 1,
                  transition: 'opacity 0.15s ease',
                  cursor: 'default',
                }}
              >
                <span className="bo-domain-dot" style={{ background: colorFor(i) }} />
                <span className="bo-domain-kind">{KIND_LABEL[k]}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                  {pct}%
                </span>
                <span className="bo-domain-count">{ok}/{arr.length}</span>
                {attention && (
                  <span className="badge warn" style={{ fontSize: 9, padding: '1px 5px' }}>
                    {arr.length - ok} attn
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
