import { memo } from 'react';
import { Card } from '../Card';
import { BranchMap } from './BranchMap';
import { DeviceTopology } from './DeviceTopology';
import type { Branch, Device } from '../../types';
import type { BranchInventorySource } from '../../ui/deviceInventory';

interface Props {
  branchId: string;
  branch: Branch;
  devices: Device[];
  inventorySource: BranchInventorySource;
  onSelectBranch: (id: string) => void;
  /** Only live branches report gateway reachability. */
  liveGatewayOnline?: boolean;
}

export const BranchOverviewCard = memo(function BranchOverviewCard({
  branchId, branch, devices, inventorySource, onSelectBranch, liveGatewayOnline,
}: Props) {
  return (
    <Card
      className="branch-workspace"
      title={<h2>Branch explorer</h2>}
      sub={`${branch.name} · ${branch.location} · ${inventorySource === 'waiting' ? 'Awaiting gateway inventory' : `${devices.length} devices${inventorySource === 'sample' ? ' · Sample inventory' : ''}`}`}
      right={liveGatewayOnline === undefined ? null : liveGatewayOnline
        ? <span className="badge ok"><span className="dot ok" /> Live</span>
        : <span className="badge err"><span className="dot err" /> Offline</span>}
    >
      <div className="branch-overview-grid">
        <div className="branch-overview-map">
          <BranchMap selectedId={branchId} onSelect={onSelectBranch} embedded />
        </div>

        <div className="branch-overview-side">
          <DeviceTopology branch={branch} devices={devices} inventorySource={inventorySource} online={liveGatewayOnline} />
        </div>
      </div>
    </Card>
  );
});
