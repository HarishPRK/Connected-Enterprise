import { Card } from '../Card';
import type { LanPort } from '../../types';

export function LanPorts({ ports }: { ports: LanPort[] }) {
  const up = ports.filter((p) => p.linkUp).length;
  return (
    <Card title="LAN Ports" sub={`${up}/${ports.length} link up`}>
      {ports.map((p) => (
        <div key={p.id} className="port-row">
          <span className="port-id">P{p.id}</span>
          <span className={`dot ${p.linkUp ? 'ok' : 'off'}`} />
          <span className="port-dev">{p.device ?? <em style={{ color: 'var(--text-muted)' }}>— unused</em>}</span>
          <span className="port-rate">{p.linkUp ? `${p.speedMbps >= 1000 ? '1G' : `${p.speedMbps}M`}` : 'down'}</span>
        </div>
      ))}
    </Card>
  );
}
