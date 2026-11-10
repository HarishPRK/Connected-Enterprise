export const DEFAULT_EAGLE_DEVICE_SERIAL = 'R95VA4GP000041';
export const EAGLE_DEVICE_SERIAL_PATTERN = '[A-Za-z0-9][A-Za-z0-9._:\\-]{0,127}';
export function isEagleDeviceSerial(value: string): boolean {
  return new RegExp(`^${EAGLE_DEVICE_SERIAL_PATTERN}$`).test(value);
}

export const ANOMALY_METRICS = ['anomaly_mse', 'anomaly_threshold', 'anomaly_flag', 'anomaly_raw_flag'] as const;
export type AnomalyMetric = (typeof ANOMALY_METRICS)[number];

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
  anomalyMetrics: {
    id: string;
    metric: AnomalyMetric;
    tags: Record<string, string>;
    points: { time: string; value: number }[];
  }[];
}
