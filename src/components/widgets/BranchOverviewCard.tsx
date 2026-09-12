import { Card } from '../Card';
import { BranchMap } from './BranchMap';
import { DeviceDomainSummary } from './DeviceDomainSummary';
import { MapPin, Clock, Cpu, Router as RouterIcon } from 'lucide-react';
import type { Branch, Device } from '../../types';

/* ────────── Combined Branch Overview Card
 *
 * One card, three logical regions:
 *  • Left  — interactive Branch Map (embedded, no nested Card)
 *  • Right — stacked sidebar:
 *      · Gateway status mini-panel (current branch)
 *      · IT health and device categories
 *      · OT health and device categories
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
          <DeviceDomainSummary key={`${branchId}-IT`} domain="IT" devices={devices} />
          <DeviceDomainSummary key={`${branchId}-OT`} domain="OT" devices={devices} />
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
