import { Card } from '../Card';
import type { PoePort } from '../../types';

export function PoePorts({ ports }: { ports: PoePort[] }) {
  const totalW = ports.reduce((s, p) => s + p.watts, 0).toFixed(1);
  return (
    <Card title="PoE Ports" sub={`Draw ${totalW} W total`}>
      {ports.map((p) => {
        const used = p.watts > 0;
        const pct = (p.watts / p.max) * 100;
        return (
          <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--text-dim)' }}>PoE{p.id} · {p.device ?? <em style={{ color: 'var(--text-muted)' }}>unused</em>}</span>
              <span style={{ color: used ? 'var(--text)' : 'var(--text-muted)' }}>{p.watts.toFixed(1)} W / {p.max} W</span>
            </div>
            <div className="progress"><span style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
    </Card>
  );
}
