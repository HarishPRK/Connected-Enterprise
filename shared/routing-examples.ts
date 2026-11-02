import type { AppPolicy } from '../src/types';

/** Illustrative enterprise traffic snapshot, never gateway measurements. */
const examples: AppPolicy[] = [
  { id: 'ap1', app: 'Microsoft Teams', category: 'video', preferredPath: 'Fiber', backupPath: '5G', match: 'DSCP EF · *.teams.microsoft.com', hitsPerMin: 142, throughputMbps: 88, slaClass: 'realtime', enabled: true },
  { id: 'ap2', app: 'Google Meet', category: 'video', preferredPath: 'Fiber', backupPath: '5G', match: '*.meet.google.com', hitsPerMin: 96, throughputMbps: 54, slaClass: 'realtime', enabled: true },
  { id: 'ap3', app: 'VoIP Gateway', category: 'voice', preferredPath: 'Fiber', backupPath: '5G', match: 'SIP / RTP · DSCP EF', hitsPerMin: 220, throughputMbps: 6, slaClass: 'realtime', enabled: true },
  { id: 'ap4', app: 'Microsoft 365', category: 'business', preferredPath: 'Auto', backupPath: 'None', match: '*.office.com, *.sharepoint.com', hitsPerMin: 312, throughputMbps: 41, slaClass: 'business', enabled: true },
  { id: 'ap5', app: 'Google Workspace', category: 'business', preferredPath: 'Auto', backupPath: 'None', match: '*.google.com / mail.google.com', hitsPerMin: 187, throughputMbps: 22, slaClass: 'business', enabled: true },
  { id: 'ap6', app: 'Salesforce', category: 'business', preferredPath: 'Fiber', backupPath: '5G', match: '*.force.com, *.salesforce.com', hitsPerMin: 64, throughputMbps: 9, slaClass: 'business', enabled: true },
  { id: 'ap7', app: 'Web browsing', category: 'web', preferredPath: 'Auto', backupPath: 'None', match: 'TCP/443, TCP/80 (default)', hitsPerMin: 540, throughputMbps: 76, slaClass: 'best-effort', enabled: true },
  { id: 'ap8', app: 'OS Updates', category: 'bulk', preferredPath: '5G', backupPath: 'Fiber', match: 'WSUS, *.windowsupdate.com', hitsPerMin: 8, throughputMbps: 12, slaClass: 'best-effort', enabled: true },
  { id: 'ap9', app: 'Cloud Backup', category: 'bulk', preferredPath: '5G', backupPath: 'Fiber', match: '*.s3.amazonaws.com', hitsPerMin: 4, throughputMbps: 18, slaClass: 'best-effort', enabled: false },
  { id: 'ap10', app: 'OT Telemetry', category: 'iot', preferredPath: 'Fiber', backupPath: '5G', match: 'MQTT · TCP/8883', hitsPerMin: 360, throughputMbps: 2, slaClass: 'business', enabled: true },
];

export const ENTERPRISE_ROUTING_EXAMPLES: AppPolicy[] = examples.map((policy) => ({ ...policy, trafficSource: 'sample' }));
