/**
 * Type definitions for the IT/OT Devices integration pack.
 * Extracted verbatim from src/types.ts — only the types the devices
 * feature slice needs (Status, Device, DeviceTelemetry, HealthSignal,
 * DeviceHealth, FleetStat).
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
