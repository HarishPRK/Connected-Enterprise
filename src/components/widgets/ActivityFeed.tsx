import { Card } from '../Card';
import { CheckCircle2, AlertTriangle, Power, Wifi, ShieldCheck, RefreshCcw } from 'lucide-react';

interface Item {
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  text: string;
  when: string;
}

const items: Item[] = [
  { icon: AlertTriangle, color: 'var(--err)',    text: 'Door lock DL-2 went offline',          when: '2m ago'  },
  { icon: RefreshCcw,    color: 'var(--accent)', text: '5G radio resync triggered automatically', when: '14m ago' },
  { icon: CheckCircle2,  color: 'var(--ok)',     text: 'Fiber link recovered after 19s flap',  when: '2h ago'  },
  { icon: Wifi,          color: 'var(--accent-2)', text: 'POS-02 reconnected on Wi-Fi',          when: '3h ago'  },
  { icon: ShieldCheck,   color: 'var(--ok)',     text: 'Firmware 2.4.1 verified on Dallas-HQ', when: '8h ago'  },
  { icon: Power,         color: 'var(--text-muted)', text: 'Conf-Phone-1 PoE port re-energised', when: '1d ago'  },
];

export function ActivityFeed() {
  return (
    <Card title="Activity" sub="Recent events across this branch">
      <div className="timeline">
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
            <div key={i} className="timeline-item">
              <div className="timeline-icon" style={{ color: it.color, borderColor: `${it.color}55`, background: `${it.color}15` }}>
                <Icon size={12} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--text)' }}>{it.text}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{it.when}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
