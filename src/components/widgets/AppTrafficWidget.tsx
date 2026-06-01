import { Card } from '../Card';
import type { AppTraffic } from '../../types';

export function AppTrafficWidget({ items }: { items: AppTraffic[] }) {
  return (
    <Card title="Critical App Traffic" sub="Share of active traffic, by path">
      {items.map((i) => (
        <div key={i.app} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--text)' }}>{i.app}</span>
            <span style={{ color: 'var(--text-muted)' }}>{i.sharePct}% · via {i.via}</span>
          </div>
          <div className="progress"><span style={{ width: `${i.sharePct}%` }} /></div>
        </div>
      ))}
    </Card>
  );
}
