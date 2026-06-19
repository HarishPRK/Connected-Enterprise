import { Link } from 'react-router-dom';
import { Card } from '../Card';
import { BranchMap } from './BranchMap';
import { MapPin, Clock, Cpu, Router as RouterIcon } from 'lucide-react';
import type { Branch, Device } from '../../types';

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

const PALETTE = ['#10b981', '#ec4899', '#a855f7', '#84cc16', '#f59e0b', '#ef4444', '#06b6d4', '#6366f1', '#f43f5e'];

function fmtUptime(h: number) {
  const d = Math.floor(h / 24); const r = h % 24;
  return `${d}d ${r}h`;
}

export function BranchOverviewCard({ branchId, branch, devices, onSelectBranch }: Props) {
  return (
    <Card
      title="Branch Map · per-site overview"
      sub={`${branch.name} · ${branch.location} · ${devices.length} devices on this gateway`}
      right={<span className="badge ok"><span className="dot ok" /> Live</span>}
    >
      <div className="branch-overview-grid">
        {/* ── Left: the map (embedded — no nested Card) ── */}
        <div className="branch-overview-map">
          <BranchMap selectedId={branchId} onSelect={onSelectBranch} embedded />
        </div>

        {/* ── Right: gateway + IT + OT panels ── */}
        <div className="branch-overview-side">
          <GatewayMini branch={branch} />
          <DomainSection domain="IT" devices={devices} />
          <DomainSection domain="OT" devices={devices} />
        </div>
      </div>
    </Card>
  );
}

/* ─────────── Gateway mini-panel ─────────── */

function GatewayMini({ branch }: { branch: Branch }) {
  return (
    <div className="bo-section">
      <div className="bo-section-head">
        <span className="bo-section-icon" style={{ color: 'var(--accent)' }}>
          <RouterIcon size={14} />
        </span>
        <div>
          <div className="bo-section-title">Gateway</div>
          <div className="bo-section-sub">{branch.gatewayModel} · Firmware {branch.firmware}</div>
        </div>
        <span className="badge ok" style={{ marginLeft: 'auto' }}>
          <span className="dot ok" />ONLINE
        </span>
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

  const cx = 50, cy = 50, r = 32, sw = 10;
  const C = 2 * Math.PI * r;
  let acc = 0;

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
        <svg width={100} height={100} style={{ flexShrink: 0 }}>
          <circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.05)" strokeWidth={sw} fill="none" />
          {entries.map(([k, arr], i) => {
            const frac = arr.length / total;
            const dash = C * frac;
            const offset = -acc;
            acc += dash;
            return (
              <circle
                key={k}
                cx={cx} cy={cy} r={r}
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={sw} fill="none"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${cx} ${cy})`}
                style={{ transition: 'stroke-dasharray 0.4s' }}
              />
            );
          })}
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--text)">
            {total}
          </text>
          <text x={cx} y={cy + 11} textAnchor="middle" fontSize="8" fill="var(--text-muted)"
            style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Total
          </text>
        </svg>
        <ul className="bo-domain-list">
          {entries.map(([k, arr], i) => {
            const ok = arr.filter((d) => d.status === 'ok').length;
            const attention = ok < arr.length;
            return (
              <li key={k} className="bo-domain-row">
                <span className="bo-domain-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="bo-domain-kind">{KIND_LABEL[k]}</span>
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
