import { Card } from '../Card';
import type { Device } from '../../types';
import { Link } from 'react-router-dom';

const labels: Record<Device['kind'], string> = {
  laptop: 'Laptops',
  desktop: 'Desktops',
  printer: 'Printers',
  payment: 'Payment machines',
  server: 'Local servers',
  confphone: 'Conference phones',
  fire_sensor: 'Fire sensors',
  smoke_sensor: 'Smoke sensors',
  door_lock: 'Door locks',
  phone: 'Phones',
  tablet: 'Tablets',
  matter: 'Matter devices',
  shelly: 'Shelly devices',
  generic: 'Other devices',
};

export function DeviceSummary({
  devices,
  domain,
}: { devices: Device[]; domain: 'IT' | 'OT' }) {
  const filtered = devices.filter((d) => d.domain === domain);
  const groups = new Map<Device['kind'], Device[]>();
  for (const d of filtered) {
    const arr = groups.get(d.kind) ?? [];
    arr.push(d);
    groups.set(d.kind, arr);
  }
  const route = domain === 'IT' ? '/it-devices' : '/ot-devices';
  return (
    <Card
      title={`${domain} Devices`}
      sub={`${filtered.length} total on this gateway`}
      right={<Link to={route}><button>View all</button></Link>}
    >
      {[...groups.entries()].map(([kind, arr]) => {
        const ok = arr.filter((d) => d.status === 'ok').length;
        return (
          <div key={kind} className="kv">
            <span className="k">{labels[kind]}</span>
            <span className="v">
              {ok}/{arr.length}{' '}
              {ok < arr.length && <span className="badge warn" style={{ marginLeft: 6 }}>attention</span>}
            </span>
          </div>
        );
      })}
    </Card>
  );
}
