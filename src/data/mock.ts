import type {
  Alert, AppCategory, AppPolicy, AppTraffic, AuditEntry, BandwidthPoint, Branch,
  ComplianceCheck, ConnEvent, CostWarning, Device, DeviceHealth, DnsBlock, DnsStat,
  FiberLinkMetrics, FiveGLinkMetrics, FleetStat, HealthSignal, Incident, LanPort,
  NaasAddOn, NaasService, PathFlipEvent, PathProbe, PathSla, PathThreshold,
  PoePort, PublicNetInfo, ReachabilityProbe, ROISummary, SavingsTrendPoint,
  SlaItem, ThreatEvent, ThreatSource, ThreatTrendPoint, TrafficPolicy,
  ValueCategory, WanLink,
} from '../types';

/** Branches that are backed by a live IPsec MQTT feed. The value matches the
 *  `source` tag the server attaches to each cached gateway state (derived from
 *  the topic prefix it arrived on). */
export const BRANCH_TO_IPSEC_SOURCE: Record<string, 'rdk' | 'prpl'> = {
  'b-pln-01': 'rdk',   // Plano  → rdk/ipsec/metrics
  'b-mck-03': 'prpl',  // McKinney → prpl/ipsec/metrics
};

export const branches: Branch[] = [
  { id: 'b-dal-hq', name: 'Dallas-HQ',     location: 'Dallas, TX',      gatewayModel: 'CE-GW-500', firmware: '2.4.1', uptimeHours: 338 },
  { id: 'b-pln-01', name: 'Plano-01',      location: 'Plano, TX',       gatewayModel: 'CE-GW-500', firmware: '2.4.1', uptimeHours: 612 },
  { id: 'b-irv-02', name: 'Irving-02',     location: 'Irving, TX',      gatewayModel: 'CE-GW-300', firmware: '2.4.0', uptimeHours: 198 },
  { id: 'b-mck-03', name: 'McKinney-03',   location: 'McKinney, TX',    gatewayModel: 'CE-GW-300', firmware: '2.4.1', uptimeHours: 845 },
  { id: 'b-aus-04', name: 'Austin-04',     location: 'Austin, TX',      gatewayModel: 'CE-GW-500', firmware: '2.4.1', uptimeHours: 1240 },
  { id: 'b-sat-05', name: 'San Antonio-05',location: 'San Antonio, TX', gatewayModel: 'CE-GW-300', firmware: '2.3.9', uptimeHours: 96 },
  { id: 'b-hou-06', name: 'Houston-06',    location: 'Houston, TX',     gatewayModel: 'CE-GW-500', firmware: '2.4.1', uptimeHours: 1480 },
  { id: 'b-sea-01', name: 'Seattle-01',    location: 'Seattle, WA',     gatewayModel: 'CE-GW-500', firmware: '2.4.1', uptimeHours: 1022 },
  { id: 'b-bos-02', name: 'Boston-02',     location: 'Boston, MA',      gatewayModel: 'CE-GW-300', firmware: '2.3.9', uptimeHours: 76 },
  { id: 'b-chi-03', name: 'Chicago-03',    location: 'Chicago, IL',     gatewayModel: 'CE-GW-500', firmware: '2.4.0', uptimeHours: 512 },
  { id: 'b-tpa-04', name: 'Tampa-04',      location: 'Tampa, FL',       gatewayModel: 'CE-GW-300', firmware: '2.4.1', uptimeHours: 221 },
];

export const lanPorts: LanPort[] = [
  { id: 1, linkUp: true, speedMbps: 1000, device: 'PC-01' },
  { id: 2, linkUp: true, speedMbps: 1000, device: 'HP-Printer' },
  { id: 3, linkUp: false, speedMbps: 0 },
  { id: 4, linkUp: true, speedMbps: 100, device: 'VoIP-Gateway' },
];

export const poePorts: PoePort[] = [
  { id: 1, device: 'VoIP-02', watts: 7.2, max: 30 },
  { id: 2, device: 'Conf-Phone', watts: 4.1, max: 30 },
  { id: 3, watts: 0, max: 30 },
  { id: 4, watts: 0, max: 30 },
];

export const wanLinks: WanLink[] = [
  { type: 'Fiber', status: 'ok', active: true, rxMbps: 342, txMbps: 121 },
  { type: '5G', status: 'warn', active: false, rssi: -92, sinr: 6, rxMbps: 0, txMbps: 0 },
];

export const bandwidthSeries: BandwidthPoint[] = Array.from({ length: 24 }, (_, i) => ({
  t: `${String(i).padStart(2, '0')}:00`,
  fiber: Math.round(140 + Math.sin(i / 3) * 80 + (i === 2 ? -80 : 0) + Math.random() * 30),
  fiveg: Math.round(30 + Math.cos(i / 4) * 20 + (i === 2 ? 120 : 0) + Math.random() * 20),
}));

export const appTraffic: AppTraffic[] = [
  { app: 'Teams', sharePct: 42, via: 'Fiber' },
  { app: 'Gmail', sharePct: 18, via: 'Fiber' },
  { app: 'Google Meet', sharePct: 21, via: 'Fiber' },
  { app: 'Browsing', sharePct: 12, via: 'Fiber' },
  { app: 'OT', sharePct: 7, via: 'Fiber' },
];

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

export const alerts: Alert[] = [
  { id: 'a1', level: 'err',  title: 'Door lock DL-2 offline',  detail: 'Server-room lock unreachable since 04:10', whenISO: '2026-04-24T04:10:00Z' },
  { id: 'a2', level: 'warn', title: '5G RSSI low',             detail: 'RSSI -92 dBm at standby radio',             whenISO: '2026-04-24T03:02:00Z' },
  { id: 'a3', level: 'warn', title: 'Fiber link flap',         detail: 'Single flap event at 02:14',                whenISO: '2026-04-24T02:14:00Z' },
  { id: 'a4', level: 'ok',   title: 'Firmware 2.4.1 applied',  detail: 'Applied on gateway CE-GW-500',              whenISO: '2026-04-23T22:00:00Z' },
];

export const pathSla: PathSla[] = [
  { path: 'Fiber', latencyMs: 14, jitterMs: 2, lossPct: 0.02, mos: 4.4, score: 96, active: true  },
  { path: '5G',    latencyMs: 38, jitterMs: 8, lossPct: 0.41, mos: 3.9, score: 78, active: false },
];

export const pathProbes: PathProbe[] = [
  { id: 'pr1', target: 'aws.amazon.com',     type: 'http', intervalSec: 10, rttMs: 22, successPct: 100, enabled: true },
  { id: 'pr2', target: '8.8.8.8',            type: 'ping', intervalSec: 5,  rttMs: 14, successPct: 100, enabled: true },
  { id: 'pr3', target: 'teams.microsoft.com',type: 'http', intervalSec: 10, rttMs: 28, successPct: 99.6, enabled: true },
  { id: 'pr4', target: 'meet.google.com',    type: 'http', intervalSec: 15, rttMs: 31, successPct: 99.9, enabled: true },
  { id: 'pr5', target: '1.1.1.1',            type: 'dns',  intervalSec: 30, rttMs: 12, successPct: 100, enabled: true },
];

export const pathFlips: PathFlipEvent[] = [
  { id: 'f1', whenISO: '2026-04-24T02:14:03Z', from: 'Fiber', to: '5G',    reason: 'Fiber link flap (loss 8%)', durationSec: 19 },
  { id: 'f2', whenISO: '2026-04-23T19:42:00Z', from: '5G',    to: 'Fiber', reason: 'Fiber recovered (SLA met)',  durationSec: 0  },
  { id: 'f3', whenISO: '2026-04-23T14:08:11Z', from: 'Fiber', to: '5G',    reason: 'Latency spike (>120ms)',     durationSec: 47 },
  { id: 'f4', whenISO: '2026-04-22T22:31:00Z', from: '5G',    to: 'Fiber', reason: 'Auto preference restored',   durationSec: 0  },
];

export const pathThresholds: PathThreshold[] = [
  // Fiber holds the tighter bound; 5G is given more headroom on latency/jitter.
  { metric: 'latency', fiber: { warn: 80,  fail: 150 }, fiveg: { warn: 120, fail: 200 }, unit: 'ms' },
  { metric: 'jitter',  fiber: { warn: 30,  fail: 60  }, fiveg: { warn: 40,  fail: 80  }, unit: 'ms' },
  { metric: 'loss',    fiber: { warn: 1,   fail: 3   }, fiveg: { warn: 1.5, fail: 5   }, unit: '%'  },
  { metric: 'mos',     fiber: { warn: 3.6, fail: 3.0 }, fiveg: { warn: 3.4, fail: 2.8 }, unit: ''   },
];

// SLA history — 24 points × 2 paths × 3 metrics
export const slaHistory = Array.from({ length: 24 }, (_, i) => ({
  t: `${String(i).padStart(2, '0')}:00`,
  fiber_latency: Math.round(12 + Math.sin(i / 3) * 4 + (i === 2 ? 90 : 0) + Math.random() * 3),
  fiveg_latency: Math.round(36 + Math.cos(i / 4) * 6 + Math.random() * 4),
  fiber_loss:    +(0.02 + (i === 2 ? 7.8 : 0) + Math.random() * 0.05).toFixed(2),
  fiveg_loss:    +(0.4  + Math.sin(i / 5) * 0.2 + Math.random() * 0.1).toFixed(2),
  fiber_jitter:  +(2 + Math.random() * 1.5).toFixed(1),
  fiveg_jitter:  +(8 + Math.random() * 3).toFixed(1),
}));

// Theme-agnostic category colors (Tailwind -500 family) — readable on both light and dark.
export const appCategories: AppCategory[] = [
  { id: 'voice',    name: 'Voice',          slaClass: 'realtime',    trafficSharePct: 12, color: '#06b6d4', description: 'VoIP, conferencing audio' },
  { id: 'video',    name: 'Video',          slaClass: 'realtime',    trafficSharePct: 31, color: '#10b981', description: 'Teams, Meet, Zoom video' },
  { id: 'business', name: 'Business apps',  slaClass: 'business',    trafficSharePct: 24, color: '#84cc16', description: 'SaaS, ERP, CRM, mail' },
  { id: 'web',      name: 'Web browsing',   slaClass: 'best-effort', trafficSharePct: 18, color: '#a855f7', description: 'General HTTP/HTTPS' },
  { id: 'bulk',     name: 'Bulk transfer',  slaClass: 'best-effort', trafficSharePct: 8,  color: '#f59e0b', description: 'Backups, OS updates' },
  { id: 'iot',      name: 'OT / IoT',       slaClass: 'business',    trafficSharePct: 7,  color: '#ef4444', description: 'Sensors, locks, telemetry' },
];

export const appPolicies: AppPolicy[] = [
  { id: 'ap1', app: 'Microsoft Teams',   category: 'video',    preferredPath: 'Fiber', backupPath: '5G',    match: 'DSCP EF · *.teams.microsoft.com', hitsPerMin: 142, throughputMbps: 88, slaClass: 'realtime',    enabled: true },
  { id: 'ap2', app: 'Google Meet',       category: 'video',    preferredPath: 'Fiber', backupPath: '5G',    match: '*.meet.google.com',               hitsPerMin: 96,  throughputMbps: 54, slaClass: 'realtime',    enabled: true },
  { id: 'ap3', app: 'VoIP Gateway',      category: 'voice',    preferredPath: 'Fiber', backupPath: '5G',    match: 'SIP / RTP · DSCP EF',             hitsPerMin: 220, throughputMbps: 6,  slaClass: 'realtime',    enabled: true },
  { id: 'ap4', app: 'Microsoft 365',     category: 'business', preferredPath: 'Auto',  backupPath: 'None',  match: '*.office.com, *.sharepoint.com',  hitsPerMin: 312, throughputMbps: 41, slaClass: 'business',    enabled: true },
  { id: 'ap5', app: 'Google Workspace',  category: 'business', preferredPath: 'Auto',  backupPath: 'None',  match: '*.google.com / mail.google.com',  hitsPerMin: 187, throughputMbps: 22, slaClass: 'business',    enabled: true },
  { id: 'ap6', app: 'Salesforce',        category: 'business', preferredPath: 'Fiber', backupPath: '5G',    match: '*.force.com, *.salesforce.com',   hitsPerMin: 64,  throughputMbps: 9,  slaClass: 'business',    enabled: true },
  { id: 'ap7', app: 'Web browsing',      category: 'web',      preferredPath: 'Auto',  backupPath: 'None',  match: 'TCP/443, TCP/80 (default)',       hitsPerMin: 540, throughputMbps: 76, slaClass: 'best-effort', enabled: true },
  { id: 'ap8', app: 'OS Updates',        category: 'bulk',     preferredPath: '5G',    backupPath: 'Fiber', match: 'WSUS, *.windowsupdate.com',       hitsPerMin: 8,   throughputMbps: 12, slaClass: 'best-effort', enabled: true },
  { id: 'ap9', app: 'Cloud Backup',      category: 'bulk',     preferredPath: '5G',    backupPath: 'Fiber', match: '*.s3.amazonaws.com',              hitsPerMin: 4,   throughputMbps: 18, slaClass: 'best-effort', enabled: false },
  { id: 'ap10',app: 'OT Telemetry',      category: 'iot',      preferredPath: 'Fiber', backupPath: '5G',    match: 'MQTT · TCP/8883',                 hitsPerMin: 360, throughputMbps: 2,  slaClass: 'business',    enabled: true },
];

export const trafficPolicies: TrafficPolicy[] = [
  { id: 't1', app: 'Microsoft Teams', priority: 'high', preferredPath: 'Fiber', enabled: true },
  { id: 't2', app: 'Google Meet',     priority: 'high', preferredPath: 'Fiber', enabled: true },
  { id: 't3', app: 'Gmail / Mail',    priority: 'med',  preferredPath: 'Auto',  enabled: true },
  { id: 't4', app: 'Web Browsing',    priority: 'low',  preferredPath: 'Auto',  enabled: true },
  { id: 't5', app: 'OT Devices',      priority: 'high', preferredPath: 'Fiber', enabled: true },
];

/* ───── Fleet stats (per-branch aggregate) ───── */
const tpSeries = (base: number, noise: number) =>
  Array.from({ length: 24 }, (_, i) => Math.round(base + Math.sin(i / 3) * noise + Math.random() * (noise / 2)));

export const fleetStats: Record<string, FleetStat> = {
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

/* ───── Incidents (agentic AI) ───── */

export const incidents: Incident[] = [
  {
    id: 'INC-2026-0142',
    title: 'Door lock DL-2 offline',
    branchId: 'b-dal-hq',
    severity: 'high',
    status: 'awaiting_approval',
    assignee: 'agent',
    agentName: 'OT Specialist',
    createdISO: '2026-04-24T04:10:00Z',
    confidence: 0.91,
    rootCause: 'DHCP did not auto-renew on OT VLAN after fiber flap',
    steps: [
      { id: 's1',  ts: 0,     kind: 'system',     content: 'Incident created from alert "Door lock DL-2 offline"' },
      { id: 's2',  ts: 1200,  kind: 'system',     content: 'Auto-assigned to OT Specialist agent (model: claude-sonnet-4-6)' },
      { id: 's3',  ts: 2500,  kind: 'thought',    content: 'DL-2 (10.20.1.32) reported offline at 04:10. Door locks are safety-critical. Pulling current device state first.' },
      { id: 's4',  ts: 4000,  kind: 'tool_call',  tool: 'get_device',     args: { id: 'DL-2-Server' }, content: 'Reading DL-2 state from gateway' },
      { id: 's5',  ts: 5400,  kind: 'tool_result',tool: 'get_device',     ok: true, resultPreview: '{ status: "offline", last_seen: "02:14:31", ip: "10.20.1.32", mac: "BB:11:22:33:44:06", arp: "incomplete" }', content: 'Device offline since 02:14:31, ARP incomplete' },
      { id: 's6',  ts: 6900,  kind: 'thought',    content: 'Last-seen 02:14:31 lines up with the fiber flap window. Correlating with branch alerts.' },
      { id: 's7',  ts: 8200,  kind: 'tool_call',  tool: 'query_alerts',   args: { from: '02:00', to: '02:30', branchId: 'b-dal-hq' }, content: 'Querying alerts in fiber-flap window' },
      { id: 's8',  ts: 9500,  kind: 'tool_result',tool: 'query_alerts',   ok: true, resultPreview: '[ { type: "fiber_flap", at: "02:14:03", duration_s: 19, recovery: "02:14:22" } ]', content: '1 matching alert: 19s fiber flap' },
      { id: 's9',  ts: 10800, kind: 'thought',    content: 'Confirmed: fiber flapped 02:14:03 → 02:14:22. DL-2 last seen at 02:14:31. Hypothesis: lease expired during outage and never re-acquired.' },
      { id: 's10', ts: 12000, kind: 'tool_call',  tool: 'check_probe',    args: { target: '10.20.1.32', count: 5 }, content: 'Probing 10.20.1.32 from gateway' },
      { id: 's11', ts: 13200, kind: 'tool_result',tool: 'check_probe',    ok: true, resultPreview: '{ reachable: false, since: "02:14:22", arp: "incomplete", retries: 5 }', content: 'Unreachable, ARP incomplete' },
      { id: 's12', ts: 14500, kind: 'tool_call',  tool: 'get_dhcp_leases',args: { vlan: 20 }, content: 'Reading OT VLAN DHCP lease table' },
      { id: 's13', ts: 15800, kind: 'tool_result',tool: 'get_dhcp_leases',ok: true, resultPreview: '{ DL-2: { lease: "EXPIRED 02:14:22", state: "abandoned" } }', content: 'Lease for DL-2 marked abandoned' },
      { id: 's14', ts: 17200, kind: 'diagnosis',  content: 'DL-2 lost L3 connectivity during the 19s fiber flap. The DHCP server abandoned its lease and DL-2 has not re-requested. ARP table is incomplete. The device is electrically up but unreachable.', confidence: 0.91 },
      { id: 's15', ts: 18800, kind: 'proposal',   content: 'Force a DHCP lease renewal on the gateway side for DL-2-Server. Brief network blip (~3s). OT door lock action requires explicit human approval.' },
    ],
    pendingAction: {
      description: 'Force DHCP lease renewal on DL-2-Server',
      tool: 'force_dhcp_renew',
      args: { device: 'DL-2-Server', vlan: 20 },
      riskLevel: 'medium',
      reason: 'OT (door-lock) action — policy requires human approval before agent executes write operations on safety-critical devices.',
    },
    postApprovalSteps: [
      { id: 'p1', ts: 0,    kind: 'system',     content: 'Approved by harish06012000@gmail.com · executing' },
      { id: 'p2', ts: 1200, kind: 'tool_call',  tool: 'force_dhcp_renew', args: { device: 'DL-2-Server', vlan: 20 }, content: 'Forcing DHCP renewal' },
      { id: 'p3', ts: 3000, kind: 'tool_result',tool: 'force_dhcp_renew', ok: true, resultPreview: '{ ok: true, lease: { ip: "10.20.1.32", expires: "2026-04-25T04:18:32Z" } }', content: 'New lease assigned' },
      { id: 'p4', ts: 4400, kind: 'thought',    content: 'Lease renewed. Verifying L3 reachability and door-lock heartbeat.' },
      { id: 'p5', ts: 5600, kind: 'tool_call',  tool: 'check_probe',      args: { target: '10.20.1.32', count: 5 }, content: 'Re-probing DL-2' },
      { id: 'p6', ts: 7000, kind: 'tool_result',tool: 'check_probe',      ok: true, resultPreview: '{ reachable: true, rtt_ms: 4, packets: "5/5", arp: "10.20.1.32 → BB:11:22:33:44:06" }', content: 'Reachable: 5/5 packets, RTT 4ms' },
      { id: 'p7', ts: 8200, kind: 'tool_call',  tool: 'get_device',       args: { id: 'DL-2-Server' }, content: 'Confirming device heartbeat' },
      { id: 'p8', ts: 9400, kind: 'tool_result',tool: 'get_device',       ok: true, resultPreview: '{ status: "online", lock_state: "locked", heartbeat: "ok" }', content: 'DL-2 online, lock state: locked, heartbeat ok' },
      { id: 'p9', ts: 10600,kind: 'resolution', content: 'DL-2 fully restored. Total downtime: 7m 32s. Lock remained physically secured throughout. Closing incident.' },
    ],
    postMortem: 'Root cause: DHCP lease was not auto-renewed on the OT VLAN after the 19-second fiber flap at 02:14. The DHCP server abandoned the lease and DL-2 (which is on a fixed sleep cycle) did not re-request until renewal was forced. Recommendation: enable DHCP server warm-failover on the gateway for VLAN 20, and shorten the OT VLAN ARP timeout from 240s to 60s. Tracking as ticket OPS-3104.',
  },

  {
    id: 'INC-2026-0141',
    title: '5G RSSI degraded on standby radio',
    branchId: 'b-dal-hq',
    severity: 'medium',
    status: 'investigating',
    assignee: 'agent',
    agentName: 'WAN Specialist',
    createdISO: '2026-04-24T03:02:00Z',
    confidence: 0.78,
    steps: [
      { id: 's1', ts: 0,    kind: 'system',     content: 'Incident created from alert "5G RSSI -92 dBm (warn threshold -85)"' },
      { id: 's2', ts: 1100, kind: 'system',     content: 'Auto-assigned to WAN Specialist agent' },
      { id: 's3', ts: 2300, kind: 'thought',    content: 'Standby 5G radio RSSI is -92 dBm. Below warn threshold but above fail (-100). Checking 24h trend to distinguish gradual decline vs sudden drop.' },
      { id: 's4', ts: 3700, kind: 'tool_call',  tool: 'get_radio_history', args: { window: '24h' }, content: 'Fetching RSSI history' },
      { id: 's5', ts: 5000, kind: 'tool_result',tool: 'get_radio_history', ok: true, resultPreview: '{ avg_rssi: -88, min: -94, max: -82, gradual_decline: true }', content: 'Gradual decline from -82 to -92 over 24h' },
      { id: 's6', ts: 6400, kind: 'thought',    content: 'Gradual decline rather than sudden drop. Suggests environmental (weather, interference) or carrier-side issue, not gateway hardware. Checking carrier status next.' },
      { id: 's7', ts: 7800, kind: 'tool_call',  tool: 'query_carrier_status', args: { carrier: 'Verizon', region: 'TX' }, content: 'Querying Verizon network status' },
      { id: 's8', ts: 9200, kind: 'tool_result',tool: 'query_carrier_status', ok: true, resultPreview: '{ tower: "DAL-23", status: "degraded", note: "scheduled maintenance 03:00–06:00 CDT" }', content: 'Carrier maintenance window 03:00–06:00 CDT' },
    ],
  },

  {
    id: 'INC-2026-0140',
    title: 'Fiber link flap (19s outage, no impact)',
    branchId: 'b-dal-hq',
    severity: 'high',
    status: 'resolved',
    assignee: 'agent',
    agentName: 'WAN Specialist',
    createdISO: '2026-04-24T02:14:00Z',
    resolvedISO: '2026-04-24T02:14:35Z',
    confidence: 0.96,
    steps: [
      { id: 's1', ts: 0,    kind: 'system',     content: 'Incident created from alert "Fiber link flap"' },
      { id: 's2', ts: 600,  kind: 'system',     content: 'Sub-second auto-failover to 5G triggered by deterministic rule (before agent attached)' },
      { id: 's3', ts: 1500, kind: 'thought',    content: 'Failover already happened. Verifying state and writing the post-mortem.' },
      { id: 's4', ts: 2700, kind: 'tool_call',  tool: 'get_wan_status',   content: 'Reading WAN state' },
      { id: 's5', ts: 3900, kind: 'tool_result',tool: 'get_wan_status',   ok: true, resultPreview: '{ active: "Fiber", primary: "Fiber", standby: "5G", last_flip: "02:14:22" }', content: 'Fiber recovered after 19s, currently active again' },
      { id: 's6', ts: 5200, kind: 'tool_call',  tool: 'get_fiber_logs',   args: { window: '5m' }, content: 'Fetching SFP+ logs' },
      { id: 's7', ts: 6400, kind: 'tool_result',tool: 'get_fiber_logs',   ok: true, resultPreview: '[ { at: "02:14:03", code: "LOS", port: "SFP+1" }, { at: "02:14:22", code: "UP" } ]', content: 'LOS event on SFP+1, clean recovery' },
      { id: 's8', ts: 7700, kind: 'diagnosis',  content: 'Single Loss-Of-Signal event on SFP+1 lasting 19s. Auto-failover routed all traffic via 5G during outage — zero user impact. Likely upstream provider hiccup or optical fluctuation.', confidence: 0.96 },
      { id: 's9', ts: 9000, kind: 'resolution', content: 'No remediation required. Adding to weekly fiber-stability tracker.' },
    ],
    postMortem: 'Single LOS event on Fiber SFP+1 lasting 19 seconds. Auto-failover engaged in <1s; users saw no outage. This is the 3rd LOS on this SFP+ this month — recommend opening a ticket with the upstream provider and considering SFP+ replacement if pattern continues.',
  },

  {
    id: 'INC-2026-0139',
    title: 'POS-02 Wi-Fi reconnect loop',
    branchId: 'b-dal-hq',
    severity: 'medium',
    status: 'investigating',
    assignee: 'agent',
    agentName: 'IT Specialist',
    createdISO: '2026-04-24T03:45:00Z',
    confidence: 0.55,
    steps: [
      { id: 's1', ts: 0,    kind: 'system',     content: 'Anomaly detected: POS-02 reconnected 14× in 5 minutes (baseline 0–1/hr)' },
      { id: 's2', ts: 1100, kind: 'thought',    content: 'POS terminals are payment-critical. Reconnect storm could be Wi-Fi instability, channel congestion, or device-side. Pulling Wi-Fi state.' },
      { id: 's3', ts: 2400, kind: 'tool_call',  tool: 'get_wifi_client',  args: { mac: 'AA:11:22:33:44:5A' }, content: 'Reading POS-02 Wi-Fi state' },
      { id: 's4', ts: 3700, kind: 'tool_result',tool: 'get_wifi_client',  ok: true, resultPreview: '{ rssi: -76, retries: 23%, channel: 36, ssid: "CE-Corp", roams_5m: 14 }', content: '-76 dBm, 23% retries, 14 roams in 5 min' },
    ],
  },

  {
    id: 'INC-2026-0138',
    title: 'High latency to Microsoft Teams',
    branchId: 'b-dal-hq',
    severity: 'medium',
    status: 'escalated',
    assignee: 'On-call NetEng',
    agentName: 'WAN Specialist',
    createdISO: '2026-04-24T01:20:00Z',
    confidence: 0.42,
    steps: [
      { id: 's1', ts: 0,    kind: 'system',     content: 'Anomaly: Teams latency 240ms (baseline 35ms)' },
      { id: 's2', ts: 1100, kind: 'thought',    content: 'Teams latency is up 7× over baseline. Need to determine if it\'s our path or destination.' },
      { id: 's3', ts: 2400, kind: 'tool_call',  tool: 'traceroute',       args: { target: 'teams.microsoft.com' }, content: 'Tracing path to teams.microsoft.com' },
      { id: 's4', ts: 4400, kind: 'tool_result',tool: 'traceroute',       ok: true, resultPreview: '{ hops: 14, slow_at: "hop 7 (level3.net)", added_ms: 180 }', content: '180ms added at hop 7 (level3.net upstream)' },
      { id: 's5', ts: 5800, kind: 'thought',    content: 'Slow hop is upstream of our gateway (carrier network). Outside my action surface. Confidence in any remediation I could apply is low (0.42). Per policy, escalating to a human.' },
      { id: 's6', ts: 7100, kind: 'system',     content: 'Escalated to On-call NetEng — confidence below 0.70 auto-act threshold' },
    ],
  },

  {
    id: 'INC-2026-0137',
    title: 'Firmware 2.4.1 post-deploy verification',
    branchId: 'b-dal-hq',
    severity: 'low',
    status: 'resolved',
    assignee: 'agent',
    agentName: 'Fleet Specialist',
    createdISO: '2026-04-23T22:00:00Z',
    resolvedISO: '2026-04-23T22:01:30Z',
    confidence: 0.99,
    steps: [
      { id: 's1', ts: 0,    kind: 'system',     content: 'Auto-incident on firmware deploy success' },
      { id: 's2', ts: 900,  kind: 'tool_call',  tool: 'verify_firmware',  args: { version: '2.4.1', branchId: 'b-dal-hq' }, content: 'Running 2.4.1 health checks' },
      { id: 's3', ts: 2200, kind: 'tool_result',tool: 'verify_firmware',  ok: true, resultPreview: '{ version: "2.4.1", uptime_s: 90, services: "all_running", config_drift: "none" }', content: 'All services running, no drift' },
      { id: 's4', ts: 3600, kind: 'resolution', content: 'Firmware 2.4.1 verified healthy on Dallas-HQ. No action needed.' },
    ],
    postMortem: 'Routine post-deploy verification. All checks green.',
  },
];

/* ───── Audit log ───── */

export const auditEntries: AuditEntry[] = [
  { id: 'a1',  ts: '2026-04-24T08:01:12Z', actor: { kind: 'user',   id: 'u1', name: 'harish06012000@gmail.com' }, action: 'auth.login',       result: 'success', ip: '203.0.113.42' },
  { id: 'a2',  ts: '2026-04-24T05:33:00Z', actor: { kind: 'agent',  id: 'ot-specialist', name: 'OT Specialist Agent' }, action: 'agent.proposal',  target: { kind: 'device', id: 'o6', label: 'DL-2-Server' }, branchId: 'b-dal-hq', result: 'pending', details: 'Proposed force_dhcp_renew (awaiting human approval)' },
  { id: 'a3',  ts: '2026-04-24T04:10:00Z', actor: { kind: 'system', id: 'monitor', name: 'Anomaly Detector' }, action: 'incident.create',  target: { kind: 'incident', id: 'INC-2026-0142', label: 'Door lock DL-2 offline' }, branchId: 'b-dal-hq', result: 'success' },
  { id: 'a4',  ts: '2026-04-24T03:45:00Z', actor: { kind: 'system', id: 'monitor', name: 'Anomaly Detector' }, action: 'incident.create',  target: { kind: 'incident', id: 'INC-2026-0139', label: 'POS-02 reconnect loop' }, branchId: 'b-dal-hq', result: 'success' },
  { id: 'a5',  ts: '2026-04-24T03:02:00Z', actor: { kind: 'system', id: 'monitor', name: 'Anomaly Detector' }, action: 'incident.create',  target: { kind: 'incident', id: 'INC-2026-0141', label: '5G RSSI degraded' }, branchId: 'b-dal-hq', result: 'success' },
  { id: 'a6',  ts: '2026-04-24T02:14:22Z', actor: { kind: 'system', id: 'autosys', name: 'Auto-failover Engine' }, action: 'wan.failover',     target: { kind: 'wan_link', id: 'fiber-to-5g', label: 'Fiber → 5G → Fiber' }, branchId: 'b-dal-hq', result: 'success', details: 'Fiber LOS for 19s, traffic moved to 5G then back' },
  { id: 'a7',  ts: '2026-04-24T02:14:03Z', actor: { kind: 'system', id: 'monitor', name: 'Anomaly Detector' }, action: 'incident.create',  target: { kind: 'incident', id: 'INC-2026-0140', label: 'Fiber link flap' }, branchId: 'b-dal-hq', result: 'success' },
  { id: 'a8',  ts: '2026-04-24T01:20:00Z', actor: { kind: 'agent',  id: 'wan-specialist', name: 'WAN Specialist Agent' }, action: 'incident.escalate',target: { kind: 'incident', id: 'INC-2026-0138', label: 'High latency to Teams' }, branchId: 'b-dal-hq', result: 'success', details: 'Confidence 0.42 below 0.70 threshold' },
  { id: 'a9',  ts: '2026-04-23T22:01:30Z', actor: { kind: 'agent',  id: 'fleet-specialist', name: 'Fleet Specialist Agent' }, action: 'incident.resolve', target: { kind: 'incident', id: 'INC-2026-0137', label: 'Firmware 2.4.1 verification' }, branchId: 'b-dal-hq', result: 'success' },
  { id: 'a10', ts: '2026-04-23T22:00:00Z', actor: { kind: 'user',   id: 'u1', name: 'harish06012000@gmail.com' }, action: 'firmware.push',    target: { kind: 'gateway', id: 'CE-GW-500', label: 'CE-GW-500 Dallas-HQ' }, branchId: 'b-dal-hq', result: 'success', details: 'Pushed firmware 2.4.1 (from 2.4.0)' },
  { id: 'a11', ts: '2026-04-23T18:45:00Z', actor: { kind: 'user',   id: 'u2', name: 'priya@example.com' }, action: 'door.unlock',      target: { kind: 'device', id: 'o5', label: 'DL-1-MainGate' }, branchId: 'b-dal-hq', result: 'success', details: 'Reason: After-hours delivery' },
  { id: 'a12', ts: '2026-04-23T16:30:00Z', actor: { kind: 'user',   id: 'u1', name: 'harish06012000@gmail.com' }, action: 'policy.update',    target: { kind: 'policy', id: 't5', label: 'OT Devices preferred path' }, branchId: 'b-dal-hq', result: 'success', details: 'Preferred path: Auto → Fiber' },
  { id: 'a13', ts: '2026-04-23T14:15:00Z', actor: { kind: 'user',   id: 'u3', name: 'admin@example.com' }, action: 'auth.login',       result: 'success', ip: '198.51.100.7' },
  { id: 'a14', ts: '2026-04-23T11:02:00Z', actor: { kind: 'agent',  id: 'wan-specialist', name: 'WAN Specialist Agent' }, action: 'agent.action',     target: { kind: 'wan_link', id: 'auto', label: 'Boston-02 path selector' }, branchId: 'b-bos-02', result: 'success', details: 'Auto-restored Fiber as primary after 5G window cleared' },
  { id: 'a15', ts: '2026-04-23T09:30:00Z', actor: { kind: 'user',   id: 'u1', name: 'harish06012000@gmail.com' }, action: 'auth.login',       result: 'success', ip: '203.0.113.42' },
  { id: 'a16', ts: '2026-04-22T22:31:00Z', actor: { kind: 'system', id: 'autosys', name: 'Auto-failover Engine' }, action: 'wan.failover',     target: { kind: 'wan_link', id: '5g-to-fiber', label: '5G → Fiber' }, branchId: 'b-dal-hq', result: 'success', details: 'Auto preference restored' },
  { id: 'a17', ts: '2026-04-22T18:00:00Z', actor: { kind: 'user',   id: 'u1', name: 'harish06012000@gmail.com' }, action: 'config.change',    target: { kind: 'gateway', id: 'CE-GW-500', label: 'Dallas-HQ Gateway' }, branchId: 'b-dal-hq', result: 'success', details: 'SLA threshold: latency warn 60ms → 80ms' },
  { id: 'a18', ts: '2026-04-22T13:20:00Z', actor: { kind: 'user',   id: 'u4', name: 'jenkins@example.com' }, action: 'auth.login',       result: 'failure', ip: '192.0.2.42', details: 'Invalid password (3rd attempt)' },
  { id: 'a19', ts: '2026-04-22T10:00:00Z', actor: { kind: 'user',   id: 'u1', name: 'harish06012000@gmail.com' }, action: 'policy.create',    target: { kind: 'policy', id: 'ap10', label: 'OT Telemetry' }, branchId: 'b-dal-hq', result: 'success', details: 'New app policy: OT Telemetry → Fiber' },
  { id: 'a20', ts: '2026-04-21T19:00:00Z', actor: { kind: 'user',   id: 'u2', name: 'priya@example.com' }, action: 'device.reboot',    target: { kind: 'device', id: 'd6', label: 'POS-02' }, branchId: 'b-dal-hq', result: 'success' },
  { id: 'a21', ts: '2026-04-21T11:00:00Z', actor: { kind: 'user',   id: 'u1', name: 'harish06012000@gmail.com' }, action: 'door.unlock',      target: { kind: 'device', id: 'o5', label: 'DL-1-MainGate' }, branchId: 'b-dal-hq', result: 'success', details: 'Reason: Cleaning crew' },
  { id: 'a22', ts: '2026-04-20T20:30:00Z', actor: { kind: 'user',   id: 'u3', name: 'admin@example.com' }, action: 'firmware.rollback',target: { kind: 'gateway', id: 'CE-GW-300', label: 'Boston-02 Gateway' }, branchId: 'b-bos-02', result: 'success', details: 'Rolled back 2.4.1 → 2.3.9 (incompatibility on CE-GW-300)' },
];

/* ───── Business value ───── */

export const valueCategories: ValueCategory[] = [
  {
    id: 'efficiency',
    name: 'IT/OT Operational Costs',
    description: 'Hours of NetEng / NOC time reclaimed by the agent and automation.',
    monthSavedUsd: 2_800,
    yearSavedUsd: 33_600,
    trendPct: 9.4,
    details: [
      '23 incidents auto-resolved by Claude agent this month',
      '8 hrs of on-call NetEng time reclaimed',
      '4 firmware deploys validated automatically',
      '2 OT remediations gated and approved within SLA',
    ],
  },
  {
    id: 'storage',
    name: 'Database Storage Cost',
    description: 'Telemetry retention + compression policy keeping the time-series DB lean.',
    monthSavedUsd: 180,
    yearSavedUsd: 2_160,
    trendPct: 14.2,
    details: [
      'Downsampled metrics older than 30 days — 5.8x compression',
      'Audit log archived to cold storage after 90d',
      'Bedrock prompt-cache hit rate: 76%',
    ],
  },
  {
    id: 'uptime',
    name: 'Uninterrupted Service via DPS',
    description: 'Dynamic Path Selection prevented downtime by failing over before users noticed.',
    monthSavedUsd: 1_820,
    yearSavedUsd: 21_840,
    trendPct: 8.6,
    details: [
      '2.4 hrs of WAN outage prevented this month',
      '8 sub-second failovers — 0 user-visible flaps',
      'POS terminals: 99.97% transaction success',
    ],
  },
  {
    id: 'energy',
    name: 'Energy & Predictive Maintenance',
    description: 'HVAC scheduling, smart lighting, idle-PoE shutdown, and ML-driven predictive maintenance of energy appliances.',
    monthSavedUsd: 1_420,
    yearSavedUsd: 17_040,
    trendPct: 6.2,
    details: [
      'HVAC tied to occupancy sensors — $720/mo',
      'Smart lighting (motion + dusk) — $480/mo',
      'Idle PoE auto-shutdown — $140/mo',
      'Predictive maintenance flagged 2 appliances before failure',
    ],
  },
];

export const costWarnings: CostWarning[] = [
  {
    id: 'cw1',
    severity: 'high',
    title: 'Door lock DL-2 offline for 14 days',
    detail: 'OT lock unreachable since 2026-04-24. PoE port still drawing standby power, and the physical security gap remains until remediated. Energy waste alone is small; the real risk is the unmonitored entry point.',
    monthlyCostUsd: 38,
    target: { kind: 'device', id: 'o6', label: 'DL-2-Server' },
    recommendation: "Approve the agent's force_dhcp_renew on INC-2026-0142. Estimated fix: 2 minutes.",
    fixRoute: '/incidents',
  },
  {
    id: 'cw2',
    severity: 'warn',
    title: 'POS-02 in Wi-Fi reconnect loop',
    detail: '14 reconnects in 5 minutes — Wi-Fi RF instability on channel 36. Wastes radio power, retries strain the AP, and risks dropped transactions.',
    monthlyCostUsd: 22,
    target: { kind: 'device', id: 'd6', label: 'POS-02' },
    recommendation: "Move POS-02 to channel 149 (recommended by agent INC-2026-0143).",
    fixRoute: '/incidents',
  },
  {
    id: 'cw3',
    severity: 'warn',
    title: 'Idle PoE ports drawing standby power',
    detail: '3 PoE ports across the fleet powered with no devices attached for >7 days. Each draws ~3-5 W of standby power continuously — small per port, but easy to clean up fleet-wide.',
    monthlyCostUsd: 8,
    recommendation: 'Disable unused PoE ports via Settings → Power Management.',
    fixRoute: '/settings',
  },
  {
    id: 'cw4',
    severity: 'info',
    title: 'OT VLAN ARP timeout high — recovery slower than ideal',
    detail: 'ARP entries cached for 240 s on OT VLAN 20. Contributes to the slow OT-device recovery seen after WAN flaps. Tracked as OPS-3104.',
    monthlyCostUsd: 0,
    recommendation: 'Lower ARP timeout to 60 s on VLAN 20 (Settings → Advanced).',
    fixRoute: '/settings',
  },
];

/** 12 months of cumulative monthly savings broken down by category. Gentle ramp
 *  from ~$5.4k/mo when first deployed → $7.65k/mo today as utilisation grew. */
export const savingsTrend: SavingsTrendPoint[] = [
  { month: 'Jun', efficiency: 1_960, storage: 130, uptime: 1_280, energy:   990 },
  { month: 'Jul', efficiency: 2_100, storage: 135, uptime: 1_360, energy: 1_060 },
  { month: 'Aug', efficiency: 2_240, storage: 140, uptime: 1_440, energy: 1_120 },
  { month: 'Sep', efficiency: 2_360, storage: 148, uptime: 1_520, energy: 1_180 },
  { month: 'Oct', efficiency: 2_480, storage: 155, uptime: 1_590, energy: 1_240 },
  { month: 'Nov', efficiency: 2_580, storage: 160, uptime: 1_650, energy: 1_290 },
  { month: 'Dec', efficiency: 2_640, storage: 165, uptime: 1_700, energy: 1_320 },
  { month: 'Jan', efficiency: 2_690, storage: 168, uptime: 1_730, energy: 1_350 },
  { month: 'Feb', efficiency: 2_730, storage: 172, uptime: 1_760, energy: 1_370 },
  { month: 'Mar', efficiency: 2_760, storage: 175, uptime: 1_780, energy: 1_390 },
  { month: 'Apr', efficiency: 2_780, storage: 178, uptime: 1_800, energy: 1_405 },
  { month: 'May', efficiency: 2_800, storage: 180, uptime: 1_820, energy: 1_420 },
];

export const roiSummary: ROISummary = {
  annualSavingsUsd:   74_640,   // sum of category yearSavedUsd
  appAnnualCostUsd:   24_000,   // ~$2k/mo for 11-branch SaaS tier (Meraki/Aruba Central range)
  paybackPeriodMonths: 3.1,
  downtimeAvoidedHours: 26,     // 26 hrs YTD — realistic for 5 mo of operations
  downtimeAvoidedUsd: 15_600,   // 26 hr × $600/hr blended mid-market ops cost
  incidentsAutoResolved: 23,
  bandwidthSavedTb:   0.4,
};

/* ─────────── Per-branch cost insights ───────────
 *
 * The mock values above are fleet-wide. For a single branch we scale them by
 * the branch's relative size (total devices ÷ fleet average) and pick a
 * branch-appropriate subset of cost warnings. Larger / more-degraded branches
 * show more savings + more warnings; small clean branches show less of both. */

const BRANCH_WARNING_IDS: Record<string, string[]> = {
  'b-dal-hq': ['cw1', 'cw2', 'cw3', 'cw4'],   // the demo branch — full set
  'b-pln-01': ['cw3'],
  'b-irv-02': ['cw3'],
  'b-mck-03': [],                              // pristine
  'b-aus-04': ['cw2', 'cw3'],
  'b-sat-05': ['cw1', 'cw3'],                  // warn — has a stuck device
  'b-hou-06': ['cw3'],
  'b-sea-01': ['cw3', 'cw4'],
  'b-bos-02': ['cw2', 'cw3'],                  // warn
  'b-chi-03': [],                              // pristine
  'b-tpa-04': ['cw1', 'cw2', 'cw3'],           // warn — multiple issues
};

interface BranchCostInsights {
  categories: ValueCategory[];
  warnings: CostWarning[];
  trend: SavingsTrendPoint[];
  roi: ROISummary;
  scaleLabel: string;
}

export function getCostInsightsForBranch(branchId: string): BranchCostInsights {
  const stats = fleetStats[branchId] ?? fleetStats['b-dal-hq'];

  const allStats = Object.values(fleetStats);
  const fleetAvgDevices = allStats.reduce((s, x) => s + x.totalDevices, 0) / allStats.length;
  const fleetSize = allStats.length;
  // Per-branch share: scale fleet-wide values by (this branch / average) / fleet size
  const share = (stats.totalDevices / fleetAvgDevices) / fleetSize;

  const trend: SavingsTrendPoint[] = savingsTrend.map((m) => ({
    month:       m.month,
    efficiency:  Math.round(m.efficiency  * share),
    storage:     Math.round(m.storage     * share),
    uptime:      Math.round(m.uptime      * share),
    energy:      Math.round(m.energy      * share),
  }));

  // Derive each category's monthSavedUsd / yearSavedUsd directly from the
  // trend so the mini-card numbers reconcile exactly with the chart bars.
  //   monthSavedUsd = the current (latest) month's value in the trend
  //   yearSavedUsd  = sum of all 12 trend points
  // Previously these came from two independent mock arrays and didn't match.
  const lastIdx = trend.length - 1;
  const sumKey = (k: keyof Omit<SavingsTrendPoint, 'month'>) =>
    trend.reduce((s, p) => s + p[k], 0);

  const categories: ValueCategory[] = valueCategories.map((cat) => {
    const trendKey = cat.id as keyof Omit<SavingsTrendPoint, 'month'>;
    return {
      ...cat,
      monthSavedUsd: trend[lastIdx]?.[trendKey] ?? 0,
      yearSavedUsd:  sumKey(trendKey),
      trendPct: +(cat.trendPct + (stats.healthScore - 0.9) * 4).toFixed(1),
    };
  });

  const branchAnnualSavings = categories.reduce((s, c) => s + c.yearSavedUsd, 0);
  const roi: ROISummary = {
    annualSavingsUsd:    branchAnnualSavings,
    appAnnualCostUsd:    Math.round(roiSummary.appAnnualCostUsd / fleetSize),
    paybackPeriodMonths: +(2.4 + (1 - stats.healthScore) * 2).toFixed(1),
    downtimeAvoidedHours: Math.max(1, Math.round(roiSummary.downtimeAvoidedHours * share * fleetSize / 3)),
    downtimeAvoidedUsd:   Math.round(roiSummary.downtimeAvoidedUsd  * share),
    incidentsAutoResolved: Math.max(0, Math.round(roiSummary.incidentsAutoResolved * share)),
    bandwidthSavedTb:    +(roiSummary.bandwidthSavedTb * share).toFixed(2),
  };

  const allowedIds = BRANCH_WARNING_IDS[branchId] ?? [];
  const warnings: CostWarning[] = costWarnings.filter((w) => allowedIds.includes(w.id));

  return {
    categories,
    warnings,
    trend,
    roi,
    scaleLabel: `${stats.totalDevices} devices · ${stats.openAlerts} active alerts`,
  };
}

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

/* ─────────── NaaS (Network as a Service) ─────────── */

export const naasServices: NaasService[] = [
  {
    id: 'sdwan-as-a-service',
    name: 'SD-WAN as a Service',
    category: 'connectivity',
    active: true, status: 'ok',
    capacityLabel: '1 Gbps · 11 sites',
    usagePct: 73,
    monthlyCostUsd: 1_800,
    description: 'Managed dual-WAN with policy steering, IPsec overlay, and cloud OnRamp.',
    details: [
      'Active branches: 11 / 11',
      'Avg WAN utilisation: 73%',
      'Sub-second failover SLA: 100%',
    ],
  },
  {
    id: 'cloud-firewall',
    name: 'Cloud Firewall',
    category: 'security',
    active: true, status: 'ok',
    capacityLabel: 'All branches',
    usagePct: 100,
    monthlyCostUsd: 720,
    description: 'Cloud-delivered next-gen firewall with TLS inspection and IDS/IPS.',
    details: [
      '12,400 connections inspected / hr',
      '0 policy violations today',
      'Rule sync latency: < 60 s',
    ],
  },
  {
    id: 'ddos-protection',
    name: 'DDoS Protection',
    category: 'security',
    active: true, status: 'ok',
    capacityLabel: 'All public endpoints',
    usagePct: 12,
    monthlyCostUsd: 480,
    description: 'Always-on volumetric + L7 DDoS mitigation in front of WAN egress.',
    details: [
      '12 attacks mitigated (24h)',
      'Largest scrub: 1.2 Gbps SYN flood',
      'False-positive rate: 0.04%',
    ],
  },
  {
    id: 'zero-trust-vpn',
    name: 'Zero-Trust VPN',
    category: 'access',
    active: true, status: 'warn',
    capacityLabel: '47 / 60 seats',
    usagePct: 78,
    monthlyCostUsd: 360,
    description: 'Identity-based remote access · device posture · least-privilege policy.',
    details: [
      '47 active users · 13 seats free',
      '3 device-posture failures today',
      'MFA enforcement: 100%',
    ],
  },
  {
    id: 'bandwidth-on-demand',
    name: 'Bandwidth on Demand',
    category: 'connectivity',
    active: true, status: 'ok',
    capacityLabel: 'Up to 5 Gbps burst',
    usagePct: 0,
    monthlyCostUsd: 0,
    description: 'Pay-as-you-go bandwidth boost activated when policy triggers fire.',
    details: [
      '0 active boosts right now',
      'Last boost: 2026-04-18 · 2 hr · $42',
      'Usage charge: $0.02 / GB above 1 Gbps',
    ],
  },
  {
    id: 'app-monitoring',
    name: 'App Performance Monitoring',
    category: 'observability',
    active: true, status: 'ok',
    capacityLabel: '38 apps tracked',
    usagePct: 64,
    monthlyCostUsd: 240,
    description: 'Real-user monitoring + synthetic probes for SaaS application health.',
    details: [
      '38 apps monitored',
      'P95 page-load: 1.2 s (Teams)',
      'Synthetic checks/min: 320',
    ],
  },
  {
    id: 'device-inventory',
    name: 'Device Inventory & Endpoint Visibility',
    category: 'observability',
    active: true, status: 'ok',
    capacityLabel: 'IT + OT · all branches',
    usagePct: 82,
    monthlyCostUsd: 220,
    description: 'Live inventory of every device on every branch gateway — IP, MAC, posture, last seen, and per-device status. Feeds the IT Devices and OT Devices pages.',
    details: [
      'Auto-discovery via DHCP + LLDP + ARP',
      '15 device kinds classified (laptop, POS, fire sensor, door lock, …)',
      'OT VLAN segmentation enforced',
      'Open the IT Devices or OT Devices pages to drill in',
    ],
  },
  {
    id: 'web-gateway',
    name: 'Secure Web Gateway',
    category: 'security',
    active: true, status: 'ok',
    capacityLabel: 'All user traffic',
    usagePct: 88,
    monthlyCostUsd: 300,
    description: 'URL filtering, CASB, and DLP at the cloud egress.',
    details: [
      '18.4k requests filtered (24h)',
      '142 blocked categories hit',
      'DLP incidents (24h): 2',
    ],
  },
  {
    id: 'dns-security',
    name: 'DNS Security',
    category: 'security',
    active: true, status: 'ok',
    capacityLabel: 'All DNS queries',
    usagePct: 100,
    monthlyCostUsd: 120,
    description: 'Recursive DNS with threat-intel-driven blocking of malicious domains.',
    details: [
      '24 threats blocked (24h)',
      'Avg DNS resolution: 4 ms',
      'C2 callbacks blocked: 6',
    ],
  },
  {
    id: 'sso',
    name: 'Identity Provider (SSO)',
    category: 'access',
    active: true, status: 'ok',
    capacityLabel: '23 users · SAML / OIDC',
    usagePct: 100,
    monthlyCostUsd: 180,
    description: 'Single sign-on for the dashboard + tenant-side admin apps.',
    details: [
      '23 active users',
      'Login success rate: 99.97%',
      '2 failed login alerts (24h)',
    ],
  },
];

export const naasSlas: SlaItem[] = [
  { id: 'uptime',     name: 'Service uptime',     contracted: '≥ 99.9 %',  actual: '99.97 %',     pct: 99.97, status: 'ok' },
  { id: 'mttr',       name: 'Mean time to repair', contracted: '≤ 30 min', actual: '12 min',       pct: 92.0,  status: 'ok' },
  { id: 'latency',    name: 'WAN latency (P95)',   contracted: '< 100 ms', actual: '14 ms',        pct: 99.0,  status: 'ok' },
  { id: 'throughput', name: 'Throughput (sustained)', contracted: '1 Gbps', actual: '463 Mbps avg', pct: 73.0,  status: 'ok' },
  { id: 'security',   name: 'Security SLA',         contracted: '< 5 min triage', actual: '3.2 min avg', pct: 96.0, status: 'ok' },
  { id: 'change',     name: 'Change-window adherence', contracted: '100% in-window', actual: '98 %',  pct: 98.0,  status: 'warn' },
];

export const naasAddons: NaasAddOn[] = [
  {
    id: 'soc-247',
    name: '24/7 SOC Support',
    category: 'security',
    description: 'Managed Security Operations Center — analysts on-call 24×7 for incidents the agent escalates.',
    monthlyCostUsd: 1_200,
    bullets: [
      'Mean response < 15 min',
      'Quarterly threat-hunt reports',
      'Phone + chat escalation path',
    ],
  },
  {
    id: 'iot-edge-compute',
    name: 'IoT Edge Compute',
    category: 'compute',
    description: 'Kubernetes-at-the-edge for OT workloads — run inference / aggregation locally before sending to AWS.',
    monthlyCostUsd: 600,
    bullets: [
      '4 vCPU / 8 GB per branch',
      'Auto-deploy from container registry',
      'GPU-passthrough optional (+$300/mo)',
    ],
  },
  {
    id: 'threat-intel-premium',
    name: 'Advanced Threat Intel',
    category: 'security',
    description: 'Premium threat-intelligence feeds enriched into firewall, web gateway, and DNS Security in real time.',
    monthlyCostUsd: 300,
    bullets: [
      '20+ commercial feeds',
      'Custom IOC ingest via API',
      'Daily intel-pack digest',
    ],
  },
  {
    id: 'multi-cloud',
    name: 'Multi-Cloud Connectivity',
    category: 'connectivity',
    description: 'Extend the SD-WAN overlay into Azure and GCP alongside the existing AWS Cloud OnRamp.',
    monthlyCostUsd: 800,
    bullets: [
      'Azure vWAN attachment',
      'GCP Network Connectivity Center',
      'Identical policy + monitoring across clouds',
    ],
  },
];

/* ─────────── Connectivity deep-dive mock data ─────────── */

export const fiberLink: FiberLinkMetrics = {
  opticalRxDbm: -14.2,
  attenuationDb: 6.8,
  fcsErrorsLastHour: 4,
  mtu: 1500,
  linkSpeedMbps: 1000,
  duplex: 'full',
  uptimeHours: 312,
};

export const fiveGLink: FiveGLinkMetrics = {
  rssiDbm: -78,
  sinrDb: 14,
  band: 'n78',
  carrier: 'Verizon',
  cellId: 'eNB-3014/14',
  neighborsCount: 6,
  uptimeHours: 312,
};

export const reachabilityProbes: ReachabilityProbe[] = [
  { id: 'p1', target: '1.1.1.1',                category: 'internet', type: 'icmp', rttMs: 12, successPct: 100.0 },
  { id: 'p2', target: '8.8.8.8',                category: 'internet', type: 'icmp', rttMs: 14, successPct: 100.0 },
  { id: 'p3', target: 'api.openai.com',         category: 'saas',     type: 'tcp',  rttMs: 31, successPct: 99.8, lastFailureISO: '2026-05-11T07:42:00Z' },
  { id: 'p4', target: 'login.microsoftonline.com', category: 'saas',  type: 'http', rttMs: 28, successPct: 100.0 },
  { id: 'p5', target: 'bedrock.us-east-1.amazonaws.com', category: 'aws', type: 'tcp', rttMs: 41, successPct: 99.5, lastFailureISO: '2026-05-11T08:14:00Z' },
  { id: 'p6', target: 's3.amazonaws.com',       category: 'aws',      type: 'tcp',  rttMs: 38, successPct: 100.0 },
  { id: 'p7', target: 'gateway.local',          category: 'gateway',  type: 'icmp', rttMs: 1,  successPct: 100.0 },
  { id: 'p8', target: 'dns.cloudflare.com',     category: 'dns',      type: 'dns',  rttMs: 6,  successPct: 100.0 },
];

export const connEvents: ConnEvent[] = [
  { id: 'e1', ts: '2026-05-11T08:14:03Z', kind: 'bgp_down',    wan: 'fiber', detail: 'BGP session to AWS TGW peer 169.254.7.2 reset (hold timer expired)',                  severity: 'warn' },
  { id: 'e2', ts: '2026-05-11T08:14:22Z', kind: 'bgp_up',      wan: 'fiber', detail: 'BGP session re-established (eBGP, 4 prefixes received)',                              severity: 'ok'   },
  { id: 'e3', ts: '2026-05-11T07:42:11Z', kind: 'dns_failure',                detail: 'DNS lookup failed: api.openai.com via 1.1.1.1 (NXDOMAIN, retried succeeded)',         severity: 'warn' },
  { id: 'e4', ts: '2026-05-11T06:30:00Z', kind: 'ipsec_rekey', wan: 'fiber', detail: 'IPsec SA rekey for tunnel T-1 (Voice·Video) completed in 412 ms',                      severity: 'ok'   },
  { id: 'e5', ts: '2026-05-11T05:18:44Z', kind: 'dhcp_renew',                 detail: 'DHCP lease renewed for OT VLAN 20 (lease time 86400 s, server 10.20.1.1)',           severity: 'ok'   },
  { id: 'e6', ts: '2026-05-11T02:14:03Z', kind: 'failover',    wan: 'both',  detail: 'Active path flipped Fiber → 5G after 3 consecutive ICMP losses (19 s)',                severity: 'warn' },
  { id: 'e7', ts: '2026-05-11T02:14:22Z', kind: 'failback',    wan: 'both',  detail: 'Failback Fiber primary after stability window (45 s, RTT 12 ms, loss 0%)',             severity: 'ok'   },
  { id: 'e8', ts: '2026-05-10T22:01:09Z', kind: 'mtu_change',  wan: 'fiber', detail: 'PMTUD adjusted MTU 1500 → 1480 on AWS Cloud OnRamp (ICMP frag-needed received)',       severity: 'ok'   },
  { id: 'e9', ts: '2026-05-10T18:33:00Z', kind: 'link_flap',   wan: 'fiber', detail: 'Fiber link bounced once (LOS for 380 ms) — single event, no failover triggered',      severity: 'warn' },
];

export const dnsStats: DnsStat[] = [
  { domain: 'teams.microsoft.com',     lookupsLastHour: 1842, avgMs: 4,  failures: 0 },
  { domain: 'api.openai.com',          lookupsLastHour: 412,  avgMs: 8,  failures: 2 },
  { domain: '*.s3.amazonaws.com',      lookupsLastHour: 388,  avgMs: 6,  failures: 0 },
  { domain: 'gmail-pop.l.google.com',  lookupsLastHour: 274,  avgMs: 5,  failures: 0 },
  { domain: 'bedrock.us-east-1.amazonaws.com', lookupsLastHour: 198, avgMs: 12, failures: 1 },
  { domain: 'firebaseio.com',          lookupsLastHour: 121,  avgMs: 9,  failures: 0 },
];

export const publicNetInfo: PublicNetInfo = {
  publicIp: '203.0.113.42',
  asn: 'AS7018',
  isp: 'AT&T Enterprise',
  geo: 'Dallas, TX, US',
  natTableSize: 2_847,
  natTableMax: 8_192,
  portMappingsCount: 14,
};

/** Throughput Rx vs Tx split — 24h, 30 m bins. */
export interface BandwidthRxTxPoint { t: string; rx: number; tx: number }
export const bandwidthRxTx: BandwidthRxTxPoint[] = (() => {
  const out: BandwidthRxTxPoint[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      // Business hours bump
      const businessBump = h >= 8 && h <= 18 ? 200 : 60;
      const rx = Math.round(businessBump + 80 + 30 * Math.sin(h / 3) + Math.random() * 40);
      const tx = Math.round(businessBump * 0.35 + 25 + 15 * Math.cos(h / 4) + Math.random() * 20);
      const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      out.push({ t, rx, tx });
    }
  }
  return out;
})();

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

// silence unused-imports linter for HealthSignal (used in DeviceHealth signature)
export type { HealthSignal as _HealthSignalType };

/* ─────────── Security & threats mock data ─────────── */

/** 24-hour trend (1 row per hour). Numbers are pseudo-random but biased to
 *  feel realistic — bruteforce spikes overnight, recon during business hours,
 *  C2 is a slow trickle. */
export const threatTrend: ThreatTrendPoint[] = (() => {
  const out: ThreatTrendPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const seed = (h * 31 + 7) >>> 0;
    const isNight    = h < 6 || h > 21;
    const isBusiness = h >= 8 && h <= 18;
    out.push({
      hour: `${String(h).padStart(2, '0')}:00`,
      malware:    isBusiness ? 4 + (seed % 6) : (seed % 3),
      bruteforce: isNight    ? 18 + (seed % 14) : 4 + (seed % 6),
      recon:      isBusiness ? 12 + (seed % 8)  : 3 + (seed % 4),
      ddos:       seed % 9 === 0 ? 1 + (seed % 3) : 0,
      phishing:   isBusiness ? 6 + (seed % 4) : 1 + (seed % 2),
      c2:         (seed % 7) === 0 ? 1 : 0,
    });
  }
  return out;
})();

export const threatEvents: ThreatEvent[] = [
  { id: 'te1', ts: '2026-05-11T09:14:03Z', category: 'bruteforce', severity: 'high',     action: 'blocked',    sourceIp: '185.220.101.42', sourceCountry: 'RU', sourceFlag: '🇷🇺', sourceAsn: 'AS60729', destination: 'gateway:22 (SSH)',            branchId: 'b-dal-hq', rule: 'fw.ssh.bruteforce',  detail: '47 failed SSH auth attempts in 60 s — source banned for 24h' },
  { id: 'te2', ts: '2026-05-11T09:08:11Z', category: 'recon',      severity: 'medium',   action: 'blocked',    sourceIp: '45.156.85.140',  sourceCountry: 'NL', sourceFlag: '🇳🇱', sourceAsn: 'AS207990', destination: 'gateway public IP',          branchId: 'b-dal-hq', rule: 'fw.portscan',        detail: 'TCP SYN scan against 1024 ports · masscan signature' },
  { id: 'te3', ts: '2026-05-11T08:52:30Z', category: 'phishing',   severity: 'high',     action: 'blocked',    sourceIp: '—',              sourceCountry: 'CN', sourceFlag: '🇨🇳', destination: 'POS-02 → outbound URL',                                  branchId: 'b-dal-hq', rule: 'swg.phishing-feed',  detail: 'Blocked URL: hxxp://login-microsft-365[.]ru/auth (Phishtank ID 8341209)' },
  { id: 'te4', ts: '2026-05-11T08:41:00Z', category: 'c2',         severity: 'critical', action: 'quarantined',sourceIp: '—',              sourceCountry: 'KP', sourceFlag: '🇰🇵', destination: 'Lap-Priya → 91.214.124.55',                              branchId: 'b-dal-hq', rule: 'dns.c2.lazarus',     detail: 'DNS lookup for known Lazarus C2 domain · device isolated from VLAN' },
  { id: 'te5', ts: '2026-05-11T08:30:42Z', category: 'malware',    severity: 'high',     action: 'blocked',    sourceIp: '—',              sourceCountry: 'US', sourceFlag: '🇺🇸', destination: 'Conf-Phone-1 → CDN download',                              branchId: 'b-dal-hq', rule: 'swg.av.signature',   detail: 'AV match: Emotet.gen.412 in firmware-update.exe (12.4 MB) · download terminated' },
  { id: 'te6', ts: '2026-05-11T08:14:00Z', category: 'ddos',       severity: 'medium',   action: 'blocked',    sourceIp: 'mixed botnet',   sourceCountry: 'MULTI', sourceFlag: '🌍', destination: 'gateway public IP',                                    branchId: 'b-dal-hq', rule: 'ddos.syn-flood',     detail: '1.2 Gbps SYN flood from 4,287 IPs · mitigated in 7 s' },
  { id: 'te7', ts: '2026-05-11T07:42:11Z', category: 'phishing',   severity: 'medium',   action: 'alerted',    sourceIp: '—',              sourceCountry: 'US', sourceFlag: '🇺🇸', destination: 'Desk-Recep → google-docs.click',                          branchId: 'b-dal-hq', rule: 'swg.typosquatting',  detail: 'User clicked typo-squatted domain — warning page shown, user accepted risk' },
  { id: 'te8', ts: '2026-05-11T07:12:55Z', category: 'dlp',        severity: 'high',     action: 'blocked',    sourceIp: '—',              sourceCountry: 'US', sourceFlag: '🇺🇸', destination: 'Srv-Local → upload to dropbox.com',                       branchId: 'b-dal-hq', rule: 'dlp.pci-card',       detail: '14 credit card numbers (PCI) detected in upload payload · transfer aborted' },
  { id: 'te9', ts: '2026-05-11T06:38:00Z', category: 'bruteforce', severity: 'medium',   action: 'blocked',    sourceIp: '103.247.50.18',  sourceCountry: 'IN', sourceFlag: '🇮🇳', sourceAsn: 'AS17813',  destination: 'gateway:443 (admin)',         branchId: 'b-aus-04', rule: 'fw.admin-bf',        detail: '18 failed admin login attempts · WebAuthN MFA prevented entry' },
  { id: 'te10', ts: '2026-05-11T06:18:00Z', category: 'recon',     severity: 'low',      action: 'allowed-logged', sourceIp: '8.8.8.8',     sourceCountry: 'US', sourceFlag: '🇺🇸', sourceAsn: 'AS15169',  destination: 'gateway public IP',          branchId: 'b-dal-hq', rule: 'fw.icmp',            detail: 'Single ICMP echo from monitoring probe — allowed per allow-list' },
  { id: 'te11', ts: '2026-05-11T05:55:01Z', category: 'malware',   severity: 'critical', action: 'quarantined',sourceIp: '—',              sourceCountry: 'BR', sourceFlag: '🇧🇷', destination: 'POS-01 → http://193.86.41.5/x.bin',                       branchId: 'b-hou-06', rule: 'ids.banking-trojan', detail: 'Banking trojan signature (Grandoreiro variant) — POS isolated from card network' },
  { id: 'te12', ts: '2026-05-11T05:01:14Z', category: 'c2',        severity: 'high',     action: 'blocked',    sourceIp: '—',              sourceCountry: 'TR', sourceFlag: '🇹🇷', destination: 'Lap-John → 5.45.78.222:6667',                              branchId: 'b-dal-hq', rule: 'dns.c2.irc',         detail: 'IRC-style C2 beacon every 60 s — blocked at DNS level' },
  { id: 'te13', ts: '2026-05-11T04:22:09Z', category: 'bruteforce', severity: 'high',    action: 'blocked',    sourceIp: '212.193.30.18',  sourceCountry: 'RU', sourceFlag: '🇷🇺', sourceAsn: 'AS39711',  destination: 'gateway:22 (SSH)',           branchId: 'b-dal-hq', rule: 'fw.ssh.bruteforce',  detail: '233 failed auth attempts · automated dictionary attack' },
  { id: 'te14', ts: '2026-05-11T03:15:00Z', category: 'recon',     severity: 'low',      action: 'blocked',    sourceIp: '193.142.59.119', sourceCountry: 'NL', sourceFlag: '🇳🇱', sourceAsn: 'AS210644', destination: 'gateway public IP',          branchId: 'b-dal-hq', rule: 'fw.portscan',        detail: 'Slow port scan (1 port / 8 s) — detected by anomaly engine' },
  { id: 'te15', ts: '2026-05-11T02:48:33Z', category: 'phishing',  severity: 'high',     action: 'blocked',    sourceIp: '—',              sourceCountry: 'CN', sourceFlag: '🇨🇳', destination: 'Lap-Priya → outbound URL',                                branchId: 'b-dal-hq', rule: 'swg.phishing-feed',  detail: 'Blocked URL: hxxps://office365-billing[.]cn/login · OpenPhish' },
];

export const threatSources: ThreatSource[] = [
  { country: 'Russia',         flag: '🇷🇺', asn: 'AS60729',  asnName: 'Petersburg Internet Network',  count: 412, primaryCategory: 'bruteforce' },
  { country: 'China',          flag: '🇨🇳', asn: 'AS4134',   asnName: 'China Telecom Backbone',       count: 287, primaryCategory: 'phishing'   },
  { country: 'Netherlands',    flag: '🇳🇱', asn: 'AS210644', asnName: 'AEZA International',           count: 184, primaryCategory: 'recon'      },
  { country: 'Brazil',         flag: '🇧🇷', asn: 'AS28573',  asnName: 'Claro NXT Telecom',            count: 142, primaryCategory: 'malware'    },
  { country: 'Turkey',         flag: '🇹🇷', asn: 'AS39711',  asnName: 'Vargonen Teknoloji',           count: 96,  primaryCategory: 'c2'         },
  { country: 'United States',  flag: '🇺🇸', asn: 'AS14061',  asnName: 'DigitalOcean',                 count: 71,  primaryCategory: 'recon'      },
  { country: 'India',          flag: '🇮🇳', asn: 'AS17813',  asnName: 'MTNL Mumbai',                  count: 58,  primaryCategory: 'bruteforce' },
  { country: 'North Korea',    flag: '🇰🇵', asn: 'AS131279', asnName: 'Star Joint Venture',           count: 12,  primaryCategory: 'c2'         },
];

export const dnsBlocks: DnsBlock[] = [
  { domain: 'login-microsft-365[.]ru',     category: 'phishing',     hits: 47, lastHitISO: '2026-05-11T08:52:30Z', branches: ['b-dal-hq', 'b-aus-04'] },
  { domain: 'updates[.]lazarus[.]systems',  category: 'c2',           hits: 28, lastHitISO: '2026-05-11T08:41:00Z', branches: ['b-dal-hq'] },
  { domain: 'pay-invoice-secure[.]click',   category: 'phishing',     hits: 22, lastHitISO: '2026-05-11T06:14:00Z', branches: ['b-dal-hq', 'b-hou-06'] },
  { domain: 'cdn-coinhive-mirror[.]ws',     category: 'cryptomining', hits: 18, lastHitISO: '2026-05-11T04:33:00Z', branches: ['b-pln-01'] },
  { domain: 'office365-billing[.]cn',       category: 'phishing',     hits: 14, lastHitISO: '2026-05-11T02:48:33Z', branches: ['b-dal-hq'] },
  { domain: 'tracker[.]doubleclick-meta[.]net', category: 'tracker',  hits: 96, lastHitISO: '2026-05-11T09:11:00Z', branches: ['b-dal-hq', 'b-pln-01', 'b-aus-04', 'b-hou-06'] },
  { domain: 'cryptopool[.]xyz',             category: 'cryptomining', hits: 11, lastHitISO: '2026-05-10T22:00:00Z', branches: ['b-pln-01'] },
  { domain: 'malware-download-server[.]ru', category: 'malware',      hits: 9,  lastHitISO: '2026-05-11T05:55:01Z', branches: ['b-hou-06'] },
];

export const complianceChecks: ComplianceCheck[] = [
  { id: 'c1', framework: 'PCI-DSS', control: '1.1.4',  title: 'Firewall at each Internet connection',    status: 'pass', detail: '11 / 11 branches have edge firewall enforced' },
  { id: 'c2', framework: 'PCI-DSS', control: '2.3',    title: 'Strong cryptography for non-console admin', status: 'pass', detail: 'Admin UI: TLS 1.3 only · WebAuthN MFA enforced' },
  { id: 'c3', framework: 'PCI-DSS', control: '8.3',    title: 'Multi-factor auth for non-console access', status: 'pass', detail: '23 / 23 users have hardware MFA enrolled' },
  { id: 'c4', framework: 'PCI-DSS', control: '10.2',   title: 'Audit trail for all account actions',     status: 'pass', detail: 'Audit log retained 13 months · forwarded to SIEM' },
  { id: 'c5', framework: 'PCI-DSS', control: '11.4',   title: 'Intrusion detection in place',             status: 'pass', detail: 'IDS active on all edges · 12,400 events / hr inspected' },

  { id: 'c6', framework: 'HIPAA',   control: '164.312(a)(1)', title: 'Access control for ePHI systems',  status: 'pass', detail: 'OT VLAN segmented from IT · zero east-west allowed' },
  { id: 'c7', framework: 'HIPAA',   control: '164.312(e)(1)', title: 'Transmission security',           status: 'pass', detail: 'IPsec overlay AES-256-GCM · all branch traffic' },

  { id: 'c8', framework: 'SOC2',    control: 'CC6.1',  title: 'Logical access controls restrict access',  status: 'pass', detail: 'SSO + RBAC · 4 role tiers · quarterly access review' },
  { id: 'c9', framework: 'SOC2',    control: 'CC7.2',  title: 'Detect unauthorised system changes',       status: 'warn', detail: '1 unsigned config change last month (rolled back) — see INC-2026-0098' },
  { id: 'c10', framework: 'SOC2',   control: 'A1.2',   title: 'System availability monitored',           status: 'pass', detail: 'Uptime 99.92% · automated failover at every edge' },

  { id: 'c11', framework: 'GDPR',   control: 'Art. 32', title: 'Encryption of personal data',            status: 'pass', detail: 'TLS in transit · AES-256 at rest · 0 personal-data exposure events' },
  { id: 'c12', framework: 'GDPR',   control: 'Art. 30', title: 'Records of processing activities',       status: 'warn', detail: 'Last RoPA review 2026-02-14 — annual review due 2026-08-14' },

  { id: 'c13', framework: 'CIS',    control: '4.1',    title: 'Centralised account management',          status: 'pass', detail: 'SCIM-provisioned · auto-deprovision on identity-source leaver' },
  { id: 'c14', framework: 'CIS',    control: '8.5',    title: 'Centralised audit log review',            status: 'pass', detail: 'Logs forwarded to SIEM · Claude agent triages anomalies daily' },
];
