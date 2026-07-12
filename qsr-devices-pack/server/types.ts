/**
 * Verbatim type extracts from the main app's src/types.ts — only the types
 * the copied server modules (deviceSource / ipsecSource / ipsecProto /
 * telemetryHistory) import, plus their transitive dependencies.
 */

export type Status = 'ok' | 'warn' | 'err' | 'off';

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

export interface IpsecGatewayState {
  metrics: IpsecMetrics;
  /** Server epoch ms — the moment WE received the decoded payload. */
  receivedAt: number;
  /** Which MQTT topic family this gateway is publishing under. Drives the
   *  per-branch live-data routing — Plano uses `rdk`, McKinney uses `prpl`. */
  source?: 'rdk' | 'prpl' | 'other';
}
