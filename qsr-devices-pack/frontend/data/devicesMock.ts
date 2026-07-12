/**
 * Carved from src/data/mock.ts for the IT/OT Devices integration pack.
 * Contains only the device-fleet slice: Plano/McKinney seed fleets,
 * branch-aware device synthesis, and per-device health diagnostics.
 * MUST stay in sync with the server seed list in deviceSource.ts.
 */
import type { Device, DeviceHealth, FleetStat } from '../types';

/** Branches that are backed by a live IPsec MQTT feed. The value matches the
 *  `source` tag the server attaches to each cached gateway state (derived from
 *  the topic prefix it arrived on). */
export const BRANCH_TO_IPSEC_SOURCE: Record<string, 'rdk' | 'prpl'> = {
  'b-pln-01': 'rdk',   // Plano  → rdk/ipsec/metrics
  'b-mck-03': 'prpl',  // McKinney → prpl/ipsec/metrics
};

/** Plano (rdk) device fleet — the canonical 15 devices for the Plano location. */
export const devices: Device[] = [
  // IT
  { id: 'd1',  name: 'Lap-John',    kind: 'laptop',     domain: 'IT', ip: '10.10.1.12', mac: 'AA:11:22:33:44:55', status: 'ok',  connectedForHours: 32, conn: 'wifi' },
  { id: 'd2',  name: 'Lap-Priya',   kind: 'laptop',     domain: 'IT', ip: '10.10.1.13', mac: 'AA:11:22:33:44:56', status: 'ok',  connectedForHours: 4,  conn: 'wifi' },
  { id: 'd3',  name: 'Desk-Recep',  kind: 'desktop',    domain: 'IT', ip: '10.10.1.20', mac: 'AA:11:22:33:44:57', status: 'ok',  connectedForHours: 214, conn: 'wired' },
  { id: 'd4',  name: 'HP-Printer',  kind: 'printer',    domain: 'IT', ip: '10.10.1.30', mac: 'AA:11:22:33:44:58', status: 'ok',  connectedForHours: 680, conn: 'wired' },
  { id: 'd5',  name: 'POS-01',      kind: 'payment',    domain: 'IT', ip: '10.10.1.41', mac: 'AA:11:22:33:44:59', status: 'ok',  connectedForHours: 112, conn: 'wifi' },
  { id: 'd6',  name: 'POS-02',      kind: 'payment',    domain: 'IT', ip: '10.10.1.42', mac: 'AA:11:22:33:44:5A', status: 'warn',connectedForHours: 1,   conn: 'wifi' },
  { id: 'd7',  name: 'Srv-Local',   kind: 'server',     domain: 'IT', ip: '10.10.1.50', mac: 'AA:11:22:33:44:5B', status: 'ok',  connectedForHours: 1022, conn: 'wired' },
  { id: 'd8',  name: 'Conf-Phone-1',kind: 'confphone',  domain: 'IT', ip: '10.10.1.60', mac: 'AA:11:22:33:44:5C', status: 'ok',  connectedForHours: 440, conn: 'poe' },
  // OT
  { id: 'o1',  name: 'Fire-01',     kind: 'fire_sensor',  domain: 'OT', ip: '10.20.1.11', mac: 'BB:11:22:33:44:01', status: 'ok',  connectedForHours: 2100, conn: 'wifi' },
  { id: 'o2',  name: 'Fire-02',     kind: 'fire_sensor',  domain: 'OT', ip: '10.20.1.12', mac: 'BB:11:22:33:44:02', status: 'ok',  connectedForHours: 2100, conn: 'wifi' },
  { id: 'o3',  name: 'Smoke-01',    kind: 'smoke_sensor', domain: 'OT', ip: '10.20.1.21', mac: 'BB:11:22:33:44:03', status: 'ok',  connectedForHours: 2100, conn: 'wifi' },
  { id: 'o4',  name: 'Smoke-02',    kind: 'smoke_sensor', domain: 'OT', ip: '10.20.1.22', mac: 'BB:11:22:33:44:04', status: 'ok',  connectedForHours: 2100, conn: 'wifi' },
  { id: 'o5',  name: 'DL-1-MainGate', kind: 'door_lock',  domain: 'OT', ip: '10.20.1.31', mac: 'BB:11:22:33:44:05', status: 'ok',  connectedForHours: 1500, conn: 'wifi' },
  { id: 'o6',  name: 'DL-2-Server',   kind: 'door_lock',  domain: 'OT', ip: '10.20.1.32', mac: 'BB:11:22:33:44:06', status: 'err', connectedForHours: 0,    conn: 'wifi' },
  { id: 'o7',  name: 'DL-3-Backdoor', kind: 'door_lock',  domain: 'OT', ip: '10.20.1.33', mac: 'BB:11:22:33:44:07', status: 'ok',  connectedForHours: 1500, conn: 'wifi' },
];

/** McKinney (prpl) device fleet — distinct devices for the McKinney location.
 *  Completely separate MACs/IPs from Plano so the two locations never collide. */
export const mckinneyDevices: Device[] = [
  // IT
  { id: 'mck-d1', name: 'Lap-Carlos',    kind: 'laptop',    domain: 'IT', ip: '10.30.1.12', mac: 'CC:22:33:44:55:01', status: 'ok',  connectedForHours: 48, conn: 'wifi' },
  { id: 'mck-d2', name: 'Lap-Sarah',     kind: 'laptop',    domain: 'IT', ip: '10.30.1.13', mac: 'CC:22:33:44:55:02', status: 'ok',  connectedForHours: 12, conn: 'wifi' },
  { id: 'mck-d3', name: 'Desk-FrontDesk',kind: 'desktop',   domain: 'IT', ip: '10.30.1.20', mac: 'CC:22:33:44:55:03', status: 'ok',  connectedForHours: 320, conn: 'wired' },
  { id: 'mck-d4', name: 'Canon-Printer', kind: 'printer',   domain: 'IT', ip: '10.30.1.30', mac: 'CC:22:33:44:55:04', status: 'ok',  connectedForHours: 510, conn: 'wired' },
  { id: 'mck-d5', name: 'POS-MCK-01',   kind: 'payment',   domain: 'IT', ip: '10.30.1.41', mac: 'CC:22:33:44:55:05', status: 'ok',  connectedForHours: 88,  conn: 'wifi' },
  { id: 'mck-d6', name: 'Srv-MCK',      kind: 'server',    domain: 'IT', ip: '10.30.1.50', mac: 'CC:22:33:44:55:06', status: 'ok',  connectedForHours: 845, conn: 'wired' },
  { id: 'mck-d7', name: 'Conf-Phone-MCK',kind: 'confphone', domain: 'IT', ip: '10.30.1.60', mac: 'CC:22:33:44:55:07', status: 'ok',  connectedForHours: 310, conn: 'poe' },
  // OT
  { id: 'mck-o1', name: 'Fire-MCK-01',    kind: 'fire_sensor',  domain: 'OT', ip: '10.40.1.11', mac: 'DD:22:33:44:55:01', status: 'ok',  connectedForHours: 1800, conn: 'wifi' },
  { id: 'mck-o2', name: 'Fire-MCK-02',    kind: 'fire_sensor',  domain: 'OT', ip: '10.40.1.12', mac: 'DD:22:33:44:55:02', status: 'ok',  connectedForHours: 1800, conn: 'wifi' },
  { id: 'mck-o3', name: 'Smoke-MCK-01',   kind: 'smoke_sensor', domain: 'OT', ip: '10.40.1.21', mac: 'DD:22:33:44:55:03', status: 'ok',  connectedForHours: 1800, conn: 'wifi' },
  { id: 'mck-o4', name: 'Smoke-MCK-02',   kind: 'smoke_sensor', domain: 'OT', ip: '10.40.1.22', mac: 'DD:22:33:44:55:04', status: 'ok',  connectedForHours: 1800, conn: 'wifi' },
  { id: 'mck-o5', name: 'DL-MCK-Entry',   kind: 'door_lock',    domain: 'OT', ip: '10.40.1.31', mac: 'DD:22:33:44:55:05', status: 'ok',  connectedForHours: 1200, conn: 'wifi' },
  { id: 'mck-o6', name: 'DL-MCK-Warehouse',kind: 'door_lock',   domain: 'OT', ip: '10.40.1.32', mac: 'DD:22:33:44:55:06', status: 'ok',  connectedForHours: 1200, conn: 'wifi' },
  { id: 'mck-o7', name: 'DL-MCK-Office',  kind: 'door_lock',    domain: 'OT', ip: '10.40.1.33', mac: 'DD:22:33:44:55:07', status: 'ok',  connectedForHours: 1200, conn: 'wifi' },
];

/* ───── Fleet stats (per-branch aggregate) ───── */
const tpSeries = (base: number, noise: number) =>
  Array.from({ length: 24 }, (_, i) => Math.round(base + Math.sin(i / 3) * noise + Math.random() * (noise / 2)));

const fleetStats: Record<string, FleetStat> = {
  'b-dal-hq': { devicesOnline: 13, totalDevices: 15, openAlerts: 3, uptimePct: 99.92, throughputMbps: 463, healthScore: 0.91, status: 'ok',   throughputSeries: tpSeries(440, 80) },
  'b-pln-01': { devicesOnline: 14, totalDevices: 15, openAlerts: 0, uptimePct: 99.99, throughputMbps: 380, healthScore: 0.99, status: 'ok',   throughputSeries: tpSeries(360, 50) },
  'b-irv-02': { devicesOnline: 8,  totalDevices: 9,  openAlerts: 1, uptimePct: 99.84, throughputMbps: 220, healthScore: 0.92, status: 'ok',   throughputSeries: tpSeries(210, 40) },
  'b-mck-03': { devicesOnline: 11, totalDevices: 11, openAlerts: 0, uptimePct: 99.99, throughputMbps: 295, healthScore: 0.98, status: 'ok',   throughputSeries: tpSeries(280, 50) },
  'b-aus-04': { devicesOnline: 16, totalDevices: 18, openAlerts: 1, uptimePct: 99.91, throughputMbps: 410, healthScore: 0.94, status: 'ok',   throughputSeries: tpSeries(400, 70) },
  'b-sat-05': { devicesOnline: 10, totalDevices: 12, openAlerts: 2, uptimePct: 99.42, throughputMbps: 168, healthScore: 0.79, status: 'warn', throughputSeries: tpSeries(160, 35) },
  'b-hou-06': { devicesOnline: 19, totalDevices: 20, openAlerts: 0, uptimePct: 99.96, throughputMbps: 472, healthScore: 0.96, status: 'ok',   throughputSeries: tpSeries(450, 80) },
  'b-sea-01': { devicesOnline: 18, totalDevices: 20, openAlerts: 0, uptimePct: 99.99, throughputMbps: 312, healthScore: 0.99, status: 'ok',   throughputSeries: tpSeries(290, 60) },
  'b-bos-02': { devicesOnline: 9,  totalDevices: 10, openAlerts: 1, uptimePct: 99.74, throughputMbps: 187, healthScore: 0.85, status: 'warn', throughputSeries: tpSeries(170, 40) },
  'b-chi-03': { devicesOnline: 22, totalDevices: 22, openAlerts: 0, uptimePct: 99.95, throughputMbps: 524, healthScore: 0.97, status: 'ok',   throughputSeries: tpSeries(500, 90) },
  'b-tpa-04': { devicesOnline: 6,  totalDevices: 8,  openAlerts: 2, uptimePct: 98.41, throughputMbps: 82,  healthScore: 0.62, status: 'warn', throughputSeries: tpSeries(80,  25) },
};

/* ─────────── Branch-aware device list ─────────── */
// Each branch sees a deterministic subset + status reshuffle so the IT/OT
// widgets feel branch-specific. Larger branches (Dallas-HQ) get the full
// set, smaller branches get a representative slice.

function hashSeed(s: string): number {
  let h = 0;
  for (const ch of s) h = ((h * 31) + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Synthesize an extra device for branches that need more than the canonical
 *  15. Kind, IP, MAC, conn etc. are deterministic from (branchId, index). */
function synthesizeDevice(branchId: string, index: number): Device {
  const seed = hashSeed(`${branchId}:syn:${index}`);

  const itKinds: Device['kind'][] = ['laptop', 'laptop', 'desktop', 'payment', 'printer', 'confphone'];
  const otKinds: Device['kind'][] = ['fire_sensor', 'smoke_sensor', 'door_lock'];

  // ~55% IT, 45% OT — keeps the canonical mix shape for bigger sites.
  const isIt = (seed % 11) < 6;
  const kinds = isIt ? itKinds : otKinds;
  const kind = kinds[seed % kinds.length];
  const domain: 'IT' | 'OT' = isIt ? 'IT' : 'OT';

  const KIND_LABEL: Record<Device['kind'], string> = {
    laptop: 'Lap', desktop: 'Desk', printer: 'Prn', payment: 'POS', server: 'Srv',
    confphone: 'Conf', fire_sensor: 'Fire', smoke_sensor: 'Smoke', door_lock: 'DL',
    phone: 'Phone', tablet: 'Tab', matter: 'Mtr', shelly: 'Shly', generic: 'Dev',
  };
  const branchSlug = branchId.replace('b-', '').toUpperCase().slice(0, 3);
  const hex = (n: number) => ((n >>> 0) & 0xff).toString(16).padStart(2, '0').toUpperCase();

  const conn: Device['conn'] =
    kind === 'fire_sensor' || kind === 'smoke_sensor' || kind === 'door_lock' ? 'wifi' :
    kind === 'printer'    || kind === 'desktop'      || kind === 'server'    ? 'wired' :
    kind === 'confphone'                                                     ? 'poe'   : 'wifi';

  return {
    id: `${branchId}-syn-${index}`,
    name: `${KIND_LABEL[kind]}-${branchSlug}-${index + 1}`,
    kind,
    domain,
    ip: isIt
      ? `10.10.${10 + (index % 200)}.${50 + (seed % 200)}`
      : `10.20.${10 + (index % 200)}.${10 + (seed % 200)}`,
    mac: `CE:${hex(branchSlug.charCodeAt(0))}:${hex(seed)}:${hex(seed >> 8)}:${hex(seed >> 16)}:${hex(seed >> 24)}`,
    status: 'ok',
    connectedForHours: 24 + (seed % 1500),
    conn,
  };
}

/** Branch-aware device list. Every branch returns exactly
 *  `fleetStats[branchId].totalDevices` devices, of which exactly
 *  `fleetStats[branchId].devicesOnline` have status='ok'. The remainder are
 *  marked warn/err deterministically so the KPI strip and the per-branch
 *  widgets always agree. */
export function getDevicesForBranch(branchId: string): Device[] {
  const stats = fleetStats[branchId];
  if (!stats) return devices;

  // McKinney uses its own distinct device fleet (different MACs/IPs from Plano).
  if (branchId === 'b-mck-03') return mckinneyDevices;

  // Plano keeps the canonical authored devices (POS-02 warn, DL-2-Server err).
  if (branchId === 'b-pln-01') return devices;

  // Dallas-HQ keeps the canonical authored devices verbatim (POS-02 warn,
  // DL-2-Server err) so the demo's "anchor" branch matches its mock data.
  if (branchId === 'b-dal-hq') return devices;

  const target = stats.totalDevices;
  const targetOk = stats.devicesOnline;

  // ── Build the device pool to match target count ──
  let pool: Device[];
  if (target <= devices.length) {
    // Smaller branch — deterministically shuffle the canonical 15 and slice.
    const ordered = [...devices].sort((a, b) => {
      const ha = hashSeed(branchId + a.id);
      const hb = hashSeed(branchId + b.id);
      return ha - hb;
    });
    pool = ordered.slice(0, target);
  } else {
    // Larger branch — keep all 15 canonical + synthesize the rest.
    pool = [...devices];
    for (let i = 0; i < target - devices.length; i++) {
      pool.push(synthesizeDevice(branchId, i));
    }
  }

  // ── Reset every status to ok, then mark exactly (target - targetOk) failing ──
  pool = pool.map((d) => ({ ...d, status: 'ok' }));

  const failingCount = Math.max(0, target - targetOk);
  if (failingCount > 0) {
    const failingOrder = [...pool].sort((a, b) => {
      const ha = hashSeed(`${branchId}:fail:${a.id}`);
      const hb = hashSeed(`${branchId}:fail:${b.id}`);
      return ha - hb;
    });
    const failingIds = new Set(failingOrder.slice(0, failingCount).map((d) => d.id));
    let failIdx = 0;
    pool = pool.map((d) => {
      if (!failingIds.has(d.id)) return d;
      // First failing device is err (more severe), the rest warn — gives a
      // bit of variety so badges aren't all the same colour.
      const status = failIdx++ === 0 ? 'err' : 'warn';
      return { ...d, status };
    });
  }

  return pool;
}

/* ─────────── Per-device health diagnostics ───────────
 * Deterministic per-device explanation of WHY a device is healthy / degraded
 * / offline. Same device id always produces the same signals — useful for
 * demo consistency. Surfaced in the devices table summary line and in the
 * full device drawer diagnostic panel. */

function deviceSeed(id: string): number {
  let h = 0;
  for (const ch of id) h = ((h * 31) + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function getDeviceHealth(d: Device): DeviceHealth {
  const seed = deviceSeed(d.id);

  // ── Offline / unreachable devices ──
  if (d.status === 'err') {
    const hoursOffline = 4 + (seed % 9);
    return {
      summary: `Unreachable since ${hoursOffline}h ago · DHCP lease not renewed · 0% ping replies`,
      signals: [
        {
          label: 'Heartbeat',
          value: 'Lost',
          status: 'err',
          threshold: '≤ 5 min',
          why: `Last successful heartbeat ${hoursOffline}h ${(seed % 60)}m ago — gateway has retried 47 times`,
        },
        {
          label: 'Reachability (ICMP)',
          value: '0% · 0/300',
          status: 'err',
          threshold: '≥ 99%',
          why: 'No ICMP echo replies received for the past 6 hours',
        },
        {
          label: 'DHCP lease',
          value: 'Incomplete',
          status: 'err',
          threshold: 'Active lease',
          why: 'ARP entry expired; renewal request unanswered',
        },
        {
          label: 'Last seen',
          value: `${hoursOffline}h ${(seed % 60)}m ago`,
          status: 'err',
        },
        {
          label: 'Auto-remediation',
          value: 'Incident opened',
          status: 'warn',
          why: `Agent created INC-${2000 + (seed % 200)} · awaiting on-site verification`,
        },
      ],
    };
  }

  // ── Wi-Fi devices ──
  if (d.conn === 'wifi') {
    if (d.status === 'warn') {
      const rssi = -76 - (seed % 12);                 // -76 to -87
      const sinr = 6 + (seed % 6);                    // 6 to 11
      const retry = 14 + (seed % 18);                 // 14 to 31 %
      const loss = 1.5 + (seed % 80) / 10;            // 1.5 to 9.5 %
      const neighbors = 6 + (seed % 8);
      return {
        summary: `Wi-Fi RSSI ${rssi} dBm · ${retry}% retries · ${loss.toFixed(1)}% packet loss`,
        signals: [
          {
            label: 'Wi-Fi RSSI',
            value: `${rssi} dBm`,
            status: 'warn',
            threshold: '> −75 dBm',
            why: `Signal ${Math.abs(rssi - (-75))} dB below comfortable working range`,
          },
          {
            label: 'SINR',
            value: `${sinr} dB`,
            status: 'warn',
            threshold: '> 12 dB',
            why: 'Noise floor too close to signal — co-channel interference likely',
          },
          {
            label: 'Retry rate',
            value: `${retry}%`,
            status: 'warn',
            threshold: '< 10%',
            why: `Channel 36 contention with ${neighbors} neighbouring APs`,
          },
          {
            label: 'Packet loss',
            value: `${loss.toFixed(1)}%`,
            status: 'warn',
            threshold: '< 1%',
            why: 'Driven by high retry / SINR margin',
          },
          {
            label: 'Channel · neighbours',
            value: `36 (5 GHz) · ${neighbors} APs`,
            status: 'warn',
            threshold: '< 4 APs',
          },
          {
            label: 'Last DHCP renew',
            value: `${1 + (seed % 5)}h ${(seed % 60)}m ago`,
            status: 'ok',
          },
        ],
      };
    }
    // healthy wifi
    const rssi = -50 - (seed % 18);                   // -50 to -67
    const sinr = 18 + (seed % 12);                    // 18 to 29
    const retry = ((seed % 30) / 10);                 // 0.0 to 2.9 %
    const loss = (retry * 0.04).toFixed(2);
    return {
      summary: `Wi-Fi RSSI ${rssi} dBm · SINR ${sinr} dB · ${retry.toFixed(1)}% retries · all checks passing`,
      signals: [
        { label: 'Wi-Fi RSSI',      value: `${rssi} dBm`,                status: 'ok', threshold: '> −75 dBm' },
        { label: 'SINR',            value: `${sinr} dB`,                  status: 'ok', threshold: '> 12 dB' },
        { label: 'Retry rate',      value: `${retry.toFixed(1)}%`,        status: 'ok', threshold: '< 10%' },
        { label: 'Packet loss',     value: `${loss}%`,                    status: 'ok', threshold: '< 1%' },
        { label: 'Channel · neighbours', value: `149 (5 GHz) · ${1 + (seed % 3)} AP`, status: 'ok', threshold: '< 4 APs' },
        { label: 'Last DHCP renew', value: `${1 + (seed % 22)}h ${(seed % 60)}m ago`, status: 'ok' },
      ],
    };
  }

  // ── Wired (Ethernet) devices ──
  if (d.conn === 'wired') {
    if (d.status === 'warn') {
      return {
        summary: 'Auto-neg fell back to 100 Mbps half-duplex · FCS errors elevated',
        signals: [
          { label: 'Link speed',  value: '100 Mbps · half-duplex', status: 'warn', threshold: '1 Gbps full-duplex', why: 'Auto-negotiation did not lock at 1 Gbps' },
          { label: 'FCS errors',  value: `${120 + (seed % 80)} / hr`, status: 'warn', threshold: '< 50 / hr', why: 'Likely cable or NIC issue' },
          { label: 'Packet loss', value: '1.2%', status: 'warn', threshold: '< 1%' },
          { label: 'Cable type',  value: 'Cat 5e', status: 'ok' },
          { label: 'Last DHCP renew', value: `${1 + (seed % 5)}h ago`, status: 'ok' },
        ],
      };
    }
    return {
      summary: '1 Gbps full-duplex · 0 FCS errors · 0.00% packet loss · all checks passing',
      signals: [
        { label: 'Link speed',      value: '1 Gbps · full-duplex', status: 'ok', threshold: '1 Gbps full-duplex' },
        { label: 'FCS errors',      value: `${seed % 6} / hr`,      status: 'ok', threshold: '< 50 / hr' },
        { label: 'Packet loss',     value: '0.00%',                  status: 'ok', threshold: '< 1%' },
        { label: 'Throughput',      value: `${20 + (seed % 80)} Mbps avg`, status: 'ok' },
        { label: 'Cable type',      value: 'Cat 6',                  status: 'ok' },
        { label: 'Last DHCP renew', value: `${1 + (seed % 22)}h ago`, status: 'ok' },
      ],
    };
  }

  // ── PoE devices ──
  if (d.status === 'warn') {
    return {
      summary: 'PoE power budget margin tight · LLDP re-negotiation pending',
      signals: [
        { label: 'PoE power draw', value: '28 W / 30 W',           status: 'warn', threshold: '< 27 W (90% of port budget)' },
        { label: 'Link speed',     value: '100 Mbps · full-duplex', status: 'ok' },
        { label: 'LLDP',           value: 'last renegotiated 12 min ago', status: 'warn' },
      ],
    };
  }
  return {
    summary: 'PoE 7.2 W / 30 W · link 1 Gbps full-duplex · 0 FCS errors · all checks passing',
    signals: [
      { label: 'PoE power draw',  value: '7.2 W / 30 W',           status: 'ok', threshold: '< 27 W' },
      { label: 'Link speed',      value: '1 Gbps · full-duplex',    status: 'ok', threshold: '1 Gbps full-duplex' },
      { label: 'LLDP',            value: 'Synced',                  status: 'ok' },
      { label: 'FCS errors',      value: '0 / hr',                  status: 'ok', threshold: '< 50 / hr' },
      { label: 'Last DHCP renew', value: `${1 + (seed % 22)}h ago`, status: 'ok' },
    ],
  };
}
