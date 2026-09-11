export const CONNTRACK_MEASUREMENTS = [
  'conntrack_total', 'conntrack_tcp', 'conntrack_udp', 'conntrack_icmp', 'conntrack_other',
] as const;

export type ConntrackMeasurement = (typeof CONNTRACK_MEASUREMENTS)[number];

/** Detector value mappings supplied for the EA:GLE dashboard. */
export const ANOMALY_REASON_LABELS: Readonly<Record<number, string>> = {
  0: 'Normal',
  1: 'CPU Spike',
  2: 'Memory Pressure',
  3: 'Cache Pressure',
  4: 'Thermal Overheat',
  5: 'Conntrack TCP Flood',
  6: 'Conntrack UDP Flood',
  7: 'Conntrack Peak',
  8: 'CPU Unusual',
  9: 'Memory Used Unusual',
  10: 'Memory Cached Unusual',
  11: 'Temperature Unusual',
  12: 'Conntrack Unusual',
  99: 'Unknown Anomaly',
};

export interface AnomalyReasonCode {
  time: string;
  code: number;
  tags: Record<string, string>;
}

export interface ConntrackSeries {
  id: string;
  measurement: ConntrackMeasurement;
  tags: Record<string, string>;
  points: { time: string; value: number }[];
}

export interface EagleTelemetry {
  reasonCodes: AnomalyReasonCode[];
  conntrack: ConntrackSeries[];
}
