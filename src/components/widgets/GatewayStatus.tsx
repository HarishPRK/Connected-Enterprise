import { MapPin, Clock, Cpu } from 'lucide-react';
import { Card } from '../Card';
import { StatusBadge } from '../StatusBadge';
import type { Branch } from '../../types';

function fmtUptime(h: number) {
  const d = Math.floor(h / 24); const r = h % 24;
  return `${d}d ${r}h`;
}

export function GatewayStatus({ branch }: { branch: Branch }) {
  return (
    <Card title="Gateway Status" sub={branch.gatewayModel} right={<StatusBadge status="ok" />}>
      <div className="kv"><span className="k"><MapPin size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Location</span><span className="v">{branch.location}</span></div>
      <div className="kv"><span className="k"><Clock size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Uptime</span><span className="v">{fmtUptime(branch.uptimeHours)}</span></div>
      <div className="kv"><span className="k"><Cpu size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Firmware</span><span className="v">{branch.firmware}</span></div>
      <div className="kv"><span className="k">Branch ID</span><span className="v">{branch.id}</span></div>
    </Card>
  );
}
