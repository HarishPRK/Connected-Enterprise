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
  { id: 'network', title: 'LAN & interfaces', description: 'Local addressing, MTU and interface behavior', tone: 'green' },
  { id: 'dhcp', title: 'DHCP server', description: 'Local address pools and lease behavior', tone: 'blue' },
  { id: 'wan', title: 'WAN uplink', description: 'Uplink addressing, VLAN, forwarding and route policy', tone: 'cyan' },
  { id: 'dns', title: 'DNS & time', description: 'Resolver, caching and clock synchronization', tone: 'violet' },
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
  { key: 'lanMtu', categoryId: 'network', label: 'LAN MTU', description: 'Maximum transmission unit for the primary LAN.', control: { kind: 'number', min: 576, max: 9216, unit: 'bytes' }, defaultValue: 1500 },
  { key: 'lanEthernetSpeed', categoryId: 'network', label: 'LAN Ethernet speed', description: 'Negotiation behavior for LAN interfaces.', control: { kind: 'select', options: ethernetOptions }, defaultValue: 'AUTO' },
  { key: 'defaultVlanPortsEnabled', categoryId: 'network', label: 'Default VLAN ports enabled', description: 'Keep default VLAN membership on physical LAN ports.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'vrrpEnabled', categoryId: 'network', label: 'VRRP enabled', description: 'Advertise a redundant first-hop gateway.', control: { kind: 'boolean' }, defaultValue: false },

  { key: 'dhcpServerEnabled', categoryId: 'dhcp', label: 'DHCP server', description: 'Issue IPv4 leases to clients on the primary LAN.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'dhcpPoolStart', categoryId: 'dhcp', label: 'Pool start address', description: 'First IPv4 address available for dynamic leases.', control: { kind: 'text', placeholder: '10.10.10.100' }, defaultValue: '10.10.10.100' },
  { key: 'dhcpPoolEnd', categoryId: 'dhcp', label: 'Pool end address', description: 'Last IPv4 address available for dynamic leases.', control: { kind: 'text', placeholder: '10.10.10.199' }, defaultValue: '10.10.10.199' },
  { key: 'dhcpLeaseSeconds', categoryId: 'dhcp', label: 'Lease duration', description: 'Lifetime assigned to each dynamic IPv4 lease.', control: { kind: 'number', min: 60, max: 2592000, step: 60, unit: 'seconds' }, defaultValue: 86400 },

  { key: 'wanMode', categoryId: 'wan', label: 'WAN addressing', description: 'Obtain uplink addressing automatically or use a static IPv4 configuration.', control: { kind: 'select', options: [
    { value: 'DHCP', label: 'DHCP · automatic' },
    { value: 'STATIC', label: 'Static IPv4' },
  ] }, defaultValue: 'DHCP' },
  { key: 'wanStaticIpAddress', categoryId: 'wan', label: 'Static WAN IP address', description: 'IPv4 address sent only when WAN addressing is Static IPv4.', control: { kind: 'text', placeholder: '198.51.100.10' }, defaultValue: '' },
  { key: 'wanStaticPrefixLength', categoryId: 'wan', label: 'Static WAN prefix length', description: 'CIDR prefix sent only when WAN addressing is Static IPv4.', control: { kind: 'number', min: 1, max: 30 }, defaultValue: 24 },
  { key: 'wanStaticGateway', categoryId: 'wan', label: 'Static WAN gateway', description: 'Default-router IPv4 address sent only for a static WAN.', control: { kind: 'text', placeholder: '198.51.100.1' }, defaultValue: '' },
  { key: 'wanMtu', categoryId: 'wan', label: 'WAN MTU', description: 'Maximum transmission unit for the primary WAN.', control: { kind: 'number', min: 576, max: 9216, unit: 'bytes' }, defaultValue: 1500 },
  { key: 'wanEthernetSpeed', categoryId: 'wan', label: 'WAN Ethernet speed', description: 'Negotiation behavior for WAN interfaces.', control: { kind: 'select', options: ethernetOptions }, defaultValue: 'AUTO' },
  { key: 'wanVlanId', categoryId: 'wan', label: 'WAN VLAN ID', description: '802.1Q VLAN for the uplink; use 0 for an untagged WAN.', control: { kind: 'number', min: 0, max: 4094 }, defaultValue: 0 },
  { key: 'ipv4ForwardingEnabled', categoryId: 'wan', label: 'IPv4 forwarding', description: 'Forward IPv4 traffic between LAN and WAN interfaces.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'natMode', categoryId: 'wan', label: 'NAT mode', description: 'Translate LAN source addresses at the WAN boundary.', control: { kind: 'select', options: [
    { value: 'MASQUERADE', label: 'Masquerade' },
    { value: 'DISABLED', label: 'Disabled' },
  ] }, defaultValue: 'MASQUERADE' },
  { key: 'defaultRouteMetric', categoryId: 'wan', label: 'Default-route metric', description: 'Priority of the primary WAN default route; lower values win.', control: { kind: 'number', min: 0, max: 65535 }, defaultValue: 100 },
  { key: 'reversePathFilter', categoryId: 'wan', label: 'Reverse path filter', description: 'Source validation mode for inbound packets.', control: { kind: 'select', options: [
    { value: 'STRICT', label: 'Strict' },
    { value: 'LOOSE', label: 'Loose' },
    { value: 'DISABLED', label: 'Disabled' },
  ] }, defaultValue: 'STRICT' },
  { key: 'tcpTimestampsEnabled', categoryId: 'wan', label: 'TCP timestamps', description: 'Expose TCP timestamp negotiation.', control: { kind: 'boolean' }, defaultValue: true },

  { key: 'dnsMode', categoryId: 'dns', label: 'DNS resolver source', description: 'Use resolvers learned from WAN DHCP or provide static servers.', control: { kind: 'select', options: [
    { value: 'WAN_DHCP', label: 'WAN DHCP' },
    { value: 'STATIC', label: 'Static resolvers' },
  ] }, defaultValue: 'WAN_DHCP' },
  { key: 'dnsPrimaryServer', categoryId: 'dns', label: 'Primary DNS server', description: 'Required IPv4 resolver sent only when resolver source is Static.', control: { kind: 'text', placeholder: '1.1.1.1' }, defaultValue: '' },
  { key: 'dnsSecondaryServer', categoryId: 'dns', label: 'Secondary DNS server', description: 'Optional fallback IPv4 resolver for static DNS.', control: { kind: 'text', placeholder: '8.8.8.8' }, defaultValue: '' },
  { key: 'dnsSearchDomain', categoryId: 'dns', label: 'DNS search domain', description: 'Optional suffix used to resolve unqualified host names.', control: { kind: 'text', placeholder: 'branch.example.com' }, defaultValue: '' },
  { key: 'dnsCacheEnabled', categoryId: 'dns', label: 'DNS cache', description: 'Cache resolver answers on the gateway.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'dnsTcpEnabled', categoryId: 'dns', label: 'DNS over TCP', description: 'Allow TCP fallback for DNS responses.', control: { kind: 'boolean' }, defaultValue: true },
  { key: 'dnsCacheEntries', categoryId: 'dns', label: 'DNS cache size', description: 'Maximum cached DNS records.', control: { kind: 'number', min: 0, max: 100000, step: 100, unit: 'entries' }, defaultValue: 1000 },
  { key: 'ntpPrimaryServer', categoryId: 'dns', label: 'Primary NTP server', description: 'Preferred hostname or IPv4 source for clock synchronization.', control: { kind: 'text', placeholder: 'time.cloudflare.com' }, defaultValue: 'time.cloudflare.com' },
  { key: 'ntpSecondaryServer', categoryId: 'dns', label: 'Secondary NTP server', description: 'Distinct fallback hostname or IPv4 source for clock synchronization.', control: { kind: 'text', placeholder: 'time.google.com' }, defaultValue: 'time.google.com' },

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
