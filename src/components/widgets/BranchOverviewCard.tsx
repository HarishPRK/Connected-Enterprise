import { memo } from 'react';
import { Card } from '../Card';
import { BranchMap } from './BranchMap';
import { DeviceTopology } from './DeviceTopology';
import type { Branch, Device } from '../../types';

/* ────────── Combined Branch Overview Card
 *
 * One card, three logical regions:
 *  • Left  — interactive Branch Map (embedded, no nested Card)
 *  • Right — stacked sidebar:
 *      · Animated EDGE gateway and IT/OT device topology
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

export const BranchOverviewCard = memo(function BranchOverviewCard({
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
          <DeviceTopology key={branchId} branch={branch} devices={devices} online={online} />
        </div>
      </div>
    </Card>
  );
});
