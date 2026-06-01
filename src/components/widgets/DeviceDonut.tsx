import { Card } from '../Card';
import { devices as allDevices } from '../../data/mock';
import type { Device } from '../../types';

const labelMap: Record<Device['kind'], string> = {
  laptop: 'Laptops', desktop: 'Desktops', printer: 'Printers',
  payment: 'Payment', server: 'Servers', confphone: 'Conf phones',
  fire_sensor: 'Fire', smoke_sensor: 'Smoke', door_lock: 'Door locks',
};

const palette = ['#10b981', '#ec4899', '#a855f7', '#84cc16', '#f59e0b', '#ef4444', '#06b6d4', '#6366f1', '#f43f5e'];

export function DeviceDonut({
  domain,
  devices = allDevices,
}: {
  domain: 'IT' | 'OT';
  devices?: Device[];
}) {
  const list = devices.filter((d) => d.domain === domain);
  const counts = new Map<Device['kind'], number>();
  for (const d of list) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  const entries = [...counts.entries()];
  const total = list.length;

  const cx = 70, cy = 70, r = 48, sw = 14;
  const C = 2 * Math.PI * r;
  let acc = 0;

  return (
    <Card title={`${domain} Mix`} sub={`${total} devices in ${entries.length} categories`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <svg width={140} height={140} style={{ flexShrink: 0 }}>
          <circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.05)" strokeWidth={sw} fill="none" />
          {entries.map(([k, n], i) => {
            const frac = n / total;
            const dash = C * frac;
            const offset = -acc;
            acc += dash;
            return (
              <circle
                key={k}
                cx={cx} cy={cy} r={r}
                stroke={palette[i % palette.length]}
                strokeWidth={sw} fill="none"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${cx} ${cy})`}
                style={{ transition: 'stroke-dasharray 0.4s' }}
              />
            );
          })}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--text)">{total}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>Total</text>
        </svg>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map(([k, n], i) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: palette[i % palette.length], flexShrink: 0 }} />
              <span style={{ flex: 1, color: 'var(--text-dim)' }}>{labelMap[k]}</span>
              <span style={{ color: 'var(--text)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
