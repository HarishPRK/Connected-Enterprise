import { Radio, Cable, ArrowLeftRight } from 'lucide-react';
import { Card } from '../Card';
import { StatusBadge } from '../StatusBadge';
import type { WanLink } from '../../types';

export function WanWidget({ links }: { links: WanLink[] }) {
  const active = links.find((l) => l.active);
  return (
    <Card
      title="WAN (5G / Fiber)"
      sub="Dual-WAN with auto-failover"
      right={<span className="badge"><ArrowLeftRight size={12} /> Failover ready</span>}
    >
      {links.map((l) => (
        <div key={l.type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {l.type === '5G' ? <Radio size={16} /> : <Cable size={16} />}
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {l.type} {l.active && <span className="badge ok" style={{ marginLeft: 6 }}>Active</span>}
                {!l.active && <span className="badge" style={{ marginLeft: 6 }}>Standby</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {l.type === '5G' && l.rssi != null
                  ? `RSSI ${l.rssi} dBm · SINR ${l.sinr}`
                  : `Rx ${l.rxMbps} · Tx ${l.txMbps} Mbps`}
              </div>
            </div>
          </div>
          <StatusBadge status={l.status} />
        </div>
      ))}
      <div className="card-sub">Currently routing via <strong style={{ color: 'var(--text)' }}>{active?.type ?? '—'}</strong></div>
    </Card>
  );
}
