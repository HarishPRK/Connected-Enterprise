export type Status = 'ok' | 'warn' | 'err' | 'off';

export interface Branch {
  id: string;
  name: string;
  location: string;
  gatewayModel: string;
  firmware: string;
  uptimeHours: number;
}

export interface LanPort {
  id: number;
  label?: string;
  interfaceName?: string;
  linkUp?: boolean;
  speedMbps?: number;
  device?: string;
  rxPackets?: string;
  txPackets?: string;
  rxPps?: number;
  txPps?: number;
}

export interface PoePort {
  id: number;
  device?: string;
  watts: number;
  max: number;
}

export interface WanLink {
  type: '5G' | 'Fiber';
  status: Status;
  active: boolean;
  rssi?: number;
  sinr?: number;
  /** Omitted until two source counter samples have produced a measured rate. */
  rxMbps?: number;
  txMbps?: number;
}

export interface BandwidthPoint {
  t: string;
  fiber: number;
  fiveg: number;
}

export interface AppTraffic {
  /** A source-reported label. The Overview uses the live client name/IP/MAC. */
  app: string;
  sharePct: number;
  /** Measured client throughput represented by this row. */
  mbps?: number;
  /** Kept for policy/demo consumers; live client telemetry is not path-scoped. */
  via?: '5G' | 'Fiber';
}

export interface Device {
  id: string;
  name: string;
  kind:
    | 'laptop' | 'desktop' | 'printer' | 'payment' | 'server' | 'confphone'
    | 'fire_sensor' | 'smoke_sensor' | 'door_lock'
    // Live-discovery kinds (Phase 1) — devices the gateway reports off the LAN.
    | 'phone' | 'tablet' | 'matter' | 'shelly' | 'generic';
  domain: 'IT' | 'OT';
  ip: string;
  mac: string;
  status: Status;
  connectedForHours: number;
  conn: 'wired' | 'wifi' | 'poe' | 'thread';
  /** Current relay/switch state for controllable kinds (matter, shelly).
   *  Undefined = unknown or not switchable. */
  power?: boolean;
  /** Live electrical readings reported by the device itself (e.g. a Shelly's
   *  switch:0 metering). Present only for devices that publish them. */
  telemetry?: DeviceTelemetry;
}

export interface DeviceTelemetry {
  apowerW?: number;        // active power draw
  voltageV?: number;
  currentA?: number;
  energyWhTotal?: number;  // lifetime energy through the relay
  tempC?: number;          // device internal temperature
  // Wi-Fi link readings (from the gateway's per-client ipsec/metrics block).
  rssiDbm?: number;
  snrDb?: number;
  linkDownMbps?: number;
  linkUpMbps?: number;
  wifiStandard?: string;   // e.g. "802.11ax"
  wifiHealth?: string;     // gateway verdict, e.g. "high_retrans" | "tx_errors"
  rxBytes?: number;
  txBytes?: number;
  // Live measured throughput, derived server-side from byte-counter deltas.
  rxMbps?: number;
  txMbps?: number;
}

export interface Alert {
  id: string;
  level: 'ok' | 'warn' | 'err';
  title: string;
  detail: string;
  whenISO: string;
}

export interface TrafficPolicy {
  id: string;
  app: string;
  priority: 'high' | 'med' | 'low';
  preferredPath: '5G' | 'Fiber' | 'Auto';
  enabled: boolean;
}

/* ─── IPsec metrics (mirrors files/ipsec-metrics/proto/ipsec_metrics.proto) ─── */

export interface IpsecGatewayMetric {
  name: string;
  mac: string;
  prim_wan_ip: string;
  sec_wan_ip: string;
}

export interface IpsecTunnelMetric {
  ifname: string;
  present: boolean;
  reachable: boolean;
  latency_ms: number;
  loss_percent: number;
  rx_bytes: number;
  tx_bytes: number;
}

export interface IpsecWanMetric {
  ifname: string;
  link_up: boolean;
  rx_bytes: number;
  tx_bytes: number;
  rx_packets: number;
  tx_packets: number;
}

export interface IpsecWifiClient {
  mac: string;
  ip: string;
  hostname: string;
  ap_index: number;
  ssid: string;
  active: boolean;
  authenticated: boolean;
  rssi: number;
  snr: number;
  standard: string;
  downlink_rate: number;
  uplink_rate: number;
  rx_bytes: number;
  tx_bytes: number;
  rx_packets: number;
  tx_packets: number;
  errors_sent: number;
  retrans_count: number;
  failed_retrans_count: number;
  health: string;
}

export interface IpsecWifiMetrics {
  total_clients: number;
  active_clients: number;
  weak_signal_clients: number;
  clients_with_errors: number;
  high_retrans_clients: number;
  clients: IpsecWifiClient[];
}

/* ─── Cellular metrics (field 8 in the proto) ─── */

export interface CellularInterfaceMetric {
  ifname: string;
  present: boolean;
  link_up: boolean;
  mac: string;
  ipv4_address: string;
  ipv6_address: string;
  mtu: number;
  rx_bytes: number;
  tx_bytes: number;
  rx_packets: number;
  tx_packets: number;
  rx_errors: number;
  tx_errors: number;
  rx_dropped: number;
  tx_dropped: number;
}

export interface CellularModemMetric {
  modem_path: string;
  modem_index: number;
  manufacturer: string;
  model: string;
  firmware_revision: string;
  hardware_revision: string;
  device_id: string;
  imei: string;
  driver: string;
  plugin: string;
  primary_port: string;
  ports: string[];
  state: string;
  power_state: string;
  lock: string;
  signal_quality_percent: number;
  access_technology: string;
  allowed_modes: string;
  preferred_mode: string;
  current_bands: string;
  supported_bands: string;
  operator_name: string;
  operator_code: string;
  registration_state: string;
}

export interface CellularSimMetric {
  sim_path: string;
  sim_slot: string;
  active: boolean;
  iccid: string;
  imsi: string;
  eid: string;
}

export interface CellularBearerMetric {
  bearer_path: string;
  connected: boolean;
  apn: string;
  ip_type: string;
  interface: string;
  ipv4_address: string;
  ipv4_gateway: string;
  ipv4_dns1: string;
  ipv4_dns2: string;
  ipv6_address: string;
  ipv6_gateway: string;
  ipv6_dns1: string;
  ipv6_dns2: string;
  mtu: number;
}

export interface CellularRadioMetric {
  rssi_dbm: number;
  rsrp_dbm: number;
  rsrq_db: number;
  snr_db: number;
  serving_cell_info: string;
  lte_band: string;
  nr5g_band: string;
  cell_id: number;
  tac: number;
  pci: number;
  earfcn: number;
  nrarfcn: number;
}

export interface CellularMetrics {
  available: boolean;
  modem_count: number;
  interface?: CellularInterfaceMetric;
  modem?: CellularModemMetric;
  sim?: CellularSimMetric;
  bearer?: CellularBearerMetric;
  radio?: CellularRadioMetric;
  health: string;
}

export interface IpsecMetrics {
  timestamp_ms: number;
  active_tunnel: string;
  tunnel_count: number;
  tunnels: IpsecTunnelMetric[];
  wan: IpsecWanMetric;
  gateway: IpsecGatewayMetric;
  wifi?: IpsecWifiMetrics;
  cellular?: CellularMetrics;
}

/** Server snapshot wrapper — adds when the message was received locally so the
 *  client can show "last seen X seconds ago" without relying on device clocks. */
export interface IpsecSnapshot {
  /** key = gateway.name, always lowercased. */
  gateways: Record<string, IpsecGatewayState>;
  receivedAt: number;
}

export interface IpsecGatewayState {
  metrics: IpsecMetrics;
  /** Server epoch ms — the moment WE received the decoded payload. */
  receivedAt: number;
  /** Which MQTT topic family this gateway is publishing under. Drives the
   *  per-branch live-data routing — Plano uses `rdk`, McKinney uses `prpl`. */
  source?: 'rdk' | 'prpl' | 'other';
}

export type WanPath = '5G' | 'Fiber';

export interface PathSla {
  path: WanPath;
  latencyMs: number;
  jitterMs: number;
  lossPct: number;
  mos: number;
  score: number;
  active: boolean;
}

export interface PathProbe {
  id: string;
  target: string;
  type: 'ping' | 'http' | 'dns';
  intervalSec: number;
  rttMs: number;
  successPct: number;
  enabled: boolean;
}

export interface PathFlipEvent {
  id: string;
  whenISO: string;
  from: WanPath;
  to: WanPath;
  reason: string;
  durationSec: number;
}

export interface PathThreshold {
  metric: 'latency' | 'jitter' | 'loss' | 'mos';
  /** Per-underlay warn/fail bounds — Fiber and 5G are tuned independently
   *  since cellular tolerates higher latency/jitter than fixed-line fiber. */
  fiber: { warn: number; fail: number };
  fiveg: { warn: number; fail: number };
  unit: string;
}

export type AppCategoryId = 'voice' | 'video' | 'business' | 'web' | 'bulk' | 'iot';

export interface AppCategory {
  id: AppCategoryId;
  name: string;
  slaClass: 'realtime' | 'business' | 'best-effort';
  trafficSharePct: number;
  color: string;
  description: string;
}

export interface AppPolicy {
  id: string;
  app: string;
  category: AppCategoryId;
  preferredPath: WanPath | 'Auto';
  backupPath: WanPath | 'None';
  match: string;
  hitsPerMin: number;
  throughputMbps: number;
  slaClass: 'realtime' | 'business' | 'best-effort';
  enabled: boolean;
}

/* ───── Incidents (agentic AI) ───── */

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';

export type IncidentStatus =
  | 'triaging'
  | 'investigating'
  | 'awaiting_approval'
  | 'resolving'
  | 'resolved'
  | 'escalated';

export type AgentStepKind =
  | 'system'
  | 'thought'
  | 'tool_call'
  | 'tool_result'
  | 'diagnosis'
  | 'proposal'
  | 'resolution';

export interface AgentStep {
  id: string;
  /** ms offset from incident creation, used to space out the live playback */
  ts: number;
  kind: AgentStepKind;
  content: string;
  tool?: string;
  args?: Record<string, unknown>;
  resultPreview?: string;
  ok?: boolean;
  confidence?: number;
}

export interface PendingAction {
  description: string;
  tool: string;
  args: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
  reason: string;
}

export interface Incident {
  id: string;
  title: string;
  branchId: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  /** 'agent' or a human's email/name */
  assignee: string;
  agentName?: string;
  createdISO: string;
  resolvedISO?: string;
  confidence?: number;
  rootCause?: string;
  postMortem?: string;
  steps: AgentStep[];
  pendingAction?: PendingAction;
  /** Steps that get appended after the user approves the pending action */
  postApprovalSteps?: AgentStep[];
}

/* ───── Audit log ───── */

export type AuditActionKind =
  | 'auth.login' | 'auth.logout'
  | 'door.unlock' | 'door.lock'
  | 'device.reboot' | 'device.disable'
  | 'firmware.push' | 'firmware.rollback'
  | 'policy.create' | 'policy.update' | 'policy.delete'
  | 'wan.failover'
  | 'incident.create' | 'incident.resolve' | 'incident.escalate' | 'incident.approve'
  | 'agent.action' | 'agent.proposal'
  | 'config.change';

export interface AuditEntry {
  id: string;
  ts: string;
  actor: { kind: 'user' | 'agent' | 'system'; id: string; name: string };
  action: AuditActionKind;
  target?: { kind: string; id: string; label: string };
  branchId?: string;
  result: 'success' | 'failure' | 'pending';
  details?: string;
  ip?: string;
}

/* ───── Fleet ───── */

export interface FleetStat {
  devicesOnline: number;
  totalDevices: number;
  openAlerts: number;
  uptimePct: number;
  throughputMbps: number;
  /** 0-1 composite */
  healthScore: number;
  status: Status;
  /** Last 24 throughput sparkline */
  throughputSeries: number[];
}

/* ───── Business value (Insights tab) ───── */

export type ValueCategoryId =
  | 'efficiency'  // IT/OT Opex — auto-triage, agent resolutions
  | 'storage'     // telemetry DB cost reduction (compression / retention)
  | 'uptime'      // dynamic path selection avoided outages
  | 'energy';     // HVAC, lights, idle PoE + predictive maintenance

export interface ValueCategory {
  id: ValueCategoryId;
  name: string;
  description: string;
  /** USD saved this month — what the dashboard claims to have prevented spending */
  monthSavedUsd: number;
  /** USD saved annualised at current run-rate */
  yearSavedUsd: number;
  /** % change vs last month (positive = savings improving) */
  trendPct: number;
  /** 2-4 short bullets that explain how the savings break down */
  details: string[];
}

export interface CostWarning {
  id: string;
  severity: 'info' | 'warn' | 'high';
  title: string;
  detail: string;
  /** Estimated $/month being wasted if this remains unaddressed */
  monthlyCostUsd: number;
  target?: { kind: string; id: string; label: string };
  recommendation: string;
  /** Where the "Fix" button should navigate the user */
  fixRoute?: string;
}

export interface SavingsTrendPoint {
  month: string;
  efficiency: number;
  storage: number;
  uptime: number;
  energy: number;
}

export interface ROISummary {
  /** Total annualised savings across all categories */
  annualSavingsUsd: number;
  /** Annual subscription / operating cost of the app itself */
  appAnnualCostUsd: number;
  /** Months for app cost to break even on savings */
  paybackPeriodMonths: number;
  /** Operational hours of downtime that DPS / agentic AI prevented */
  downtimeAvoidedHours: number;
  /** $ value of that prevented downtime (using customer's per-hour ops cost) */
  downtimeAvoidedUsd: number;
  /** Incidents the agent closed without human intervention this year */
  incidentsAutoResolved: number;
  /** TB of bandwidth saved by app-aware routing this year */
  bandwidthSavedTb: number;
}

/* ───── NaaS (Network as a Service) ───── */

export type NaasCategoryId = 'connectivity' | 'security' | 'observability' | 'access' | 'compute';

export interface NaasService {
  id: string;
  name: string;
  category: NaasCategoryId;
  active: boolean;
  status: 'ok' | 'warn' | 'err';
  capacityLabel: string;
  usagePct: number;
  monthlyCostUsd: number;
  description: string;
  details: string[];
}

export interface SlaItem {
  id: string;
  name: string;
  contracted: string;
  actual: string;
  pct: number;
  status: 'ok' | 'warn' | 'err';
}

export interface NaasAddOn {
  id: string;
  name: string;
  category: NaasCategoryId;
  description: string;
  monthlyCostUsd: number;
  bullets: string[];
}

/* ───── Security & threats ───── */

export type ThreatCategory =
  | 'malware'        // malware download / exec
  | 'bruteforce'     // failed-login storms
  | 'recon'          // port scan, fingerprinting
  | 'ddos'           // volumetric or L7
  | 'phishing'       // phishing URL clicks
  | 'c2'             // C2 callbacks
  | 'dlp'            // data exfil / DLP rule hit
  | 'policy';        // generic policy violation

export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ThreatAction = 'blocked' | 'alerted' | 'allowed-logged' | 'quarantined';

export interface ThreatEvent {
  id: string;
  ts: string;                  // ISO timestamp
  category: ThreatCategory;
  severity: ThreatSeverity;
  action: ThreatAction;
  sourceIp: string;
  sourceCountry: string;       // "US", "RU", "CN"…
  sourceFlag: string;          // emoji flag
  sourceAsn?: string;
  destination: string;         // e.g. "POS-02 (10.10.1.42)"
  branchId: string;
  rule: string;                // matching firewall / IDS / DNS rule
  detail: string;
}

export interface ThreatTrendPoint {
  hour: string;                // "14:00"
  malware: number;
  bruteforce: number;
  recon: number;
  ddos: number;
  phishing: number;
  c2: number;
}

export interface ThreatSource {
  country: string;
  flag: string;
  asn: string;
  asnName: string;
  count: number;
  /** Primary category of attacks from this source. */
  primaryCategory: ThreatCategory;
}

export interface DnsBlock {
  domain: string;
  category: 'malware' | 'phishing' | 'c2' | 'cryptomining' | 'adult' | 'tracker';
  hits: number;
  lastHitISO: string;
  branches: string[];          // branch IDs that hit this domain
}

export interface ComplianceCheck {
  id: string;
  framework: 'PCI-DSS' | 'HIPAA' | 'SOC2' | 'GDPR' | 'CIS';
  control: string;             // "PCI-DSS 1.1.4" etc.
  title: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

/* ───── Per-device health diagnostics ───── */

export interface HealthSignal {
  label: string;
  value: string;
  status: Status;
  /** Threshold string shown to the user, e.g. "> -75 dBm" */
  threshold?: string;
  /** Optional one-line justification of why this signal is in the state it is. */
  why?: string;
}

export interface DeviceHealth {
  /** One-line headline explaining the overall status. */
  summary: string;
  signals: HealthSignal[];
}

/* ───── Connectivity deep-dive ───── */

export interface FiberLinkMetrics {
  opticalRxDbm: number;        // -7 to -25 typical
  attenuationDb: number;
  fcsErrorsLastHour: number;
  mtu: number;
  linkSpeedMbps: number;
  duplex: 'full' | 'half';
  uptimeHours: number;
}

export interface FiveGLinkMetrics {
  rssiDbm: number;
  sinrDb: number;
  band: string;            // e.g. "n78"
  carrier: string;
  cellId: string;
  neighborsCount: number;
  uptimeHours: number;
}

export interface ReachabilityProbe {
  id: string;
  target: string;           // "1.1.1.1", "api.openai.com", etc.
  category: 'internet' | 'aws' | 'saas' | 'dns' | 'gateway';
  type: 'icmp' | 'tcp' | 'http' | 'dns';
  rttMs: number;
  successPct: number;       // last 60 min
  lastFailureISO?: string;
}

export type ConnEventKind =
  | 'link_flap' | 'failover' | 'failback'
  | 'dhcp_renew' | 'ipsec_rekey'
  | 'bgp_up' | 'bgp_down'
  | 'dns_failure' | 'nat_overflow' | 'mtu_change';

export interface ConnEvent {
  id: string;
  ts: string;                       // ISO
  kind: ConnEventKind;
  wan?: 'fiber' | '5g' | 'both';
  detail: string;
  severity: 'ok' | 'warn' | 'err';
}

export interface DnsStat {
  domain: string;
  lookupsLastHour: number;
  avgMs: number;
  failures: number;
}

export interface PublicNetInfo {
  publicIp: string;
  asn: string;
  isp: string;
  geo: string;
  natTableSize: number;
  natTableMax: number;
  portMappingsCount: number;
}
