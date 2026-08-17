import type { ProfileParameterValue } from './types';

export type ProfileControl =
  | { kind: 'text'; placeholder?: string }
  | { kind: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'boolean' }
  | { kind: 'select'; options: Array<{ value: string; label: string }> }
  | { kind: 'secret-reference'; placeholder: string };

export interface ProfileCategory {
  id: string;
  title: string;
  description: string;
  tone: 'cyan' | 'green' | 'violet' | 'amber' | 'pink' | 'blue' | 'lime' | 'rose';
}

export interface ProfileParameterDefinition {
  key: string;
  categoryId: string;
  label: string;
  description: string;
  control: ProfileControl;
  defaultValue: ProfileParameterValue;
}

export const PROFILE_CATEGORIES: ProfileCategory[] = [
  { id: 'identity', title: 'Service & identity', description: 'Non-secret service metadata and operating state', tone: 'cyan' },
  { id: 'network', title: 'Network & addressing', description: 'LAN, WAN, VLAN and interface behavior', tone: 'green' },
  { id: 'dns', title: 'DNS & packet handling', description: 'Resolver, caching and packet validation', tone: 'violet' },
  { id: 'firewall', title: 'Firewall & crypto', description: 'Runtime limits and hardware acceleration', tone: 'amber' },
  { id: 'vpn', title: 'VPN & tunnels', description: 'Tunnel behavior with secret references kept separate', tone: 'pink' },
  { id: 'cellular', title: 'Cellular backup', description: 'Managed backup and failover telemetry', tone: 'blue' },
  { id: 'locale', title: 'Time & locale', description: 'Clock, daylight saving and language', tone: 'lime' },
  { id: 'health', title: 'Recovery & health', description: 'Watchdogs, rollback and health confirmation', tone: 'rose' },
];

const ethernetOptions = [
  { value: 'AUTO', label: 'Automatic negotiation' },
  { value: '10_HALF', label: '10 Mbps / Half' },
  { value: '10_FULL', label: '10 Mbps / Full' },
  { value: '100_FULL', label: '100 Mbps / Full' },
  { value: '1000_FULL', label: '1 Gbps / Full' },
  { value: '10000_FULL', label: '10 Gbps / Full' },
];

export const PROFILE_PARAMETERS: ProfileParameterDefinition[] = [
  { key: 'serviceOffering', categoryId: 'identity', label: 'Service offering', description: 'Authorized service bundle assigned to this gateway.', control: { kind: 'select', options: [
    { value: 'ANIRA', label: 'ANIRA managed network' },
    { value: 'AVTS', label: 'AVTS' },
    { value: 'NETBOND', label: 'NetBond' },
    { value: 'VPN_MANAGED', label: 'Managed VPN' },
  ] }, defaultValue: 'ANIRA' },
  { key: 'internetAccess', categoryId: 'identity', label: 'Internet access', description: 'Allow direct internet access under the assigned traffic policy.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'usbPortsEnabled', categoryId: 'identity', label: 'USB ports enabled', description: 'Permit USB peripherals on the gateway.', control: { kind: 'boolean' }, defaultValue: false },

  { key: 'lanIpAddress', categoryId: 'network', label: 'LAN IP address', description: 'Gateway address on the primary LAN.', control: { kind: 'text', placeholder: '10.10.10.1' }, defaultValue: '10.10.10.1' },
  { key: 'lanPrefixLength', categoryId: 'network', label: 'LAN prefix length', description: 'CIDR prefix for the primary LAN.', control: { kind: 'number', min: 8, max: 30 }, defaultValue: 24 },
  { key: 'wanMtu', categoryId: 'network', label: 'WAN MTU', description: 'Maximum transmission unit for the primary WAN.', control: { kind: 'number', min: 576, max: 9216, unit: 'bytes' }, defaultValue: 1500 },
  { key: 'lanEthernetSpeed', categoryId: 'network', label: 'LAN Ethernet speed', description: 'Negotiation behavior for LAN interfaces.', control: { kind: 'select', options: ethernetOptions }, defaultValue: 'AUTO' },
  { key: 'wanEthernetSpeed', categoryId: 'network', label: 'WAN Ethernet speed', description: 'Negotiation behavior for WAN interfaces.', control: { kind: 'select', options: ethernetOptions }, defaultValue: 'AUTO' },
  { key: 'defaultVlanPortsEnabled', categoryId: 'network', label: 'Default VLAN ports enabled', description: 'Keep default VLAN membership on physical LAN ports.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'vrrpEnabled', categoryId: 'network', label: 'VRRP enabled', description: 'Advertise a redundant first-hop gateway.', control: { kind: 'boolean' }, defaultValue: false },

  { key: 'dnsTcpEnabled', categoryId: 'dns', label: 'DNS over TCP', description: 'Allow TCP fallback for DNS responses.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'dnsCacheEntries', categoryId: 'dns', label: 'DNS cache size', description: 'Maximum cached DNS records.', control: { kind: 'number', min: 0, max: 100000, step: 100, unit: 'entries' }, defaultValue: 1000 },
  { key: 'reversePathFilter', categoryId: 'dns', label: 'Reverse path filter', description: 'Source validation mode for inbound packets.', control: { kind: 'select', options: [
    { value: 'STRICT', label: 'Strict' },
    { value: 'LOOSE', label: 'Loose' },
    { value: 'DISABLED', label: 'Disabled' },
  ] }, defaultValue: 'STRICT' },
  { key: 'tcpTimestampsEnabled', categoryId: 'dns', label: 'TCP timestamps', description: 'Expose TCP timestamp negotiation.', control: { kind: 'boolean' }, defaultValue: true },

  { key: 'firewallMemoryMb', categoryId: 'firewall', label: 'Firewall memory', description: 'Memory budget reserved for firewall state.', control: { kind: 'number', min: 256, max: 32768, step: 256, unit: 'MB' }, defaultValue: 8192 },
  { key: 'cryptoBufferCount', categoryId: 'firewall', label: 'Hardware crypto buffers', description: 'Buffers allocated to hardware-assisted encryption.', control: { kind: 'number', min: 64, max: 8192, step: 64 }, defaultValue: 512 },
  { key: 'directedBroadcastEnabled', categoryId: 'firewall', label: 'Directed broadcast', description: 'Allow directed broadcasts only when explicitly required.', control: { kind: 'boolean' }, defaultValue: false },

  { key: 'vpnCredentialRef', categoryId: 'vpn', label: 'VPN credential reference', description: 'Reference to a per-device secret overlay; the secret value never enters this profile.', control: { kind: 'secret-reference', placeholder: 'secretsmanager://network/vpn/default' }, defaultValue: '' },
  { key: 'wireGuardKeyRef', categoryId: 'vpn', label: 'WireGuard key reference', description: 'Reference to a device-bound private-key overlay.', control: { kind: 'secret-reference', placeholder: 'secretsmanager://network/wireguard/default' }, defaultValue: '' },
  { key: 'natTraversalEnabled', categoryId: 'vpn', label: 'NAT traversal', description: 'Enable standards-based NAT traversal for managed tunnels.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'natKeepaliveSeconds', categoryId: 'vpn', label: 'NAT keepalive interval', description: 'Keepalive cadence for NAT mappings.', control: { kind: 'number', min: 5, max: 300, unit: 'seconds' }, defaultValue: 20 },
  { key: 'tunnelReconnectSeconds', categoryId: 'vpn', label: 'Tunnel reconnect delay', description: 'Backoff before a disconnected tunnel retries.', control: { kind: 'number', min: 1, max: 900, unit: 'seconds' }, defaultValue: 30 },
  { key: 'maxInboundTunnels', categoryId: 'vpn', label: 'Maximum inbound tunnels', description: 'Upper bound for concurrent inbound tunnels.', control: { kind: 'number', min: 0, max: 1000 }, defaultValue: 10 },

  { key: 'cellularBackupEnabled', categoryId: 'cellular', label: 'Managed cellular backup', description: 'Permit policy-controlled cellular failover.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'cellularRefreshMinutes', categoryId: 'cellular', label: 'Cellular data refresh', description: 'Cadence for cellular usage refresh.', control: { kind: 'number', min: 1, max: 1440, unit: 'minutes' }, defaultValue: 15 },
  { key: 'failbackHoldSeconds', categoryId: 'cellular', label: 'Fiber failback hold', description: 'Healthy interval required before returning to fiber.', control: { kind: 'number', min: 0, max: 3600, unit: 'seconds' }, defaultValue: 120 },

  { key: 'timezone', categoryId: 'locale', label: 'Time zone', description: 'IANA time zone applied to local services and logs.', control: { kind: 'text', placeholder: 'America/Chicago' }, defaultValue: 'America/Chicago' },
  { key: 'daylightSavingEnabled', categoryId: 'locale', label: 'Daylight saving', description: 'Follow daylight-saving changes for the selected zone.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'language', categoryId: 'locale', label: 'Language', description: 'Administrative interface language.', control: { kind: 'select', options: [
    { value: 'en-US', label: 'English (United States)' },
    { value: 'en-GB', label: 'English (United Kingdom)' },
    { value: 'fr-FR', label: 'French' },
    { value: 'de-DE', label: 'German' },
  ] }, defaultValue: 'en-US' },

  { key: 'configurationWatchdogSeconds', categoryId: 'health', label: 'Configuration watchdog', description: 'Rollback if the gateway cannot confirm management health in time.', control: { kind: 'number', min: 30, max: 1800, unit: 'seconds' }, defaultValue: 180 },
  { key: 'healthCheckIntervalSeconds', categoryId: 'health', label: 'Health-check interval', description: 'Cadence for post-apply health checks.', control: { kind: 'number', min: 10, max: 900, unit: 'seconds' }, defaultValue: 30 },
  { key: 'rollbackOnManagementLoss', categoryId: 'health', label: 'Rollback on management loss', description: 'Restore the known-good profile if AWS management connectivity is lost.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'autoRebootAfterApply', categoryId: 'health', label: 'Reboot after apply', description: 'Allow a controlled reboot when the profile requires it.', control: { kind: 'boolean' }, defaultValue: false },
];

export function defaultProfileParameters(): Record<string, ProfileParameterValue> {
  return Object.fromEntries(PROFILE_PARAMETERS.map((parameter) => [parameter.key, parameter.defaultValue]));
}
