import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import {
  Check, Lock, Sparkles, SlidersHorizontal, Info, Search, ChevronDown, Plus, Trash2, X, MapPin, PackagePlus,
  Cpu, Network, Globe2, ShieldCheck, KeyRound, Radio, Clock, Activity,
  Shuffle, Gauge, Route, Layers, Wifi,
} from 'lucide-react';
import { branches } from '../data/mock';

type Branch = (typeof branches)[number];

type IconType = React.ComponentType<{ size?: number }>;

/* ────────── Gateway model catalog ────────── */

interface GatewayModel {
  id: string;
  name: string;
  tagline: string;
  description: string;
  lanPorts: number;
  has5G: boolean;
  dualFiber: boolean;
  maxThroughputMbps: number;
  antennaCount: number;
  poeWatts: number;
  color: string;
  badges: string[];
}

const GATEWAY_MODELS: GatewayModel[] = [
  {
    id: 'Capgemini-U120', name: 'Capgemini-U120', tagline: 'Compact branch',
    description: 'Small office or retail — 4 LAN ports, 1 Gbps Fiber, optional 5G failover.',
    lanPorts: 4, has5G: false, dualFiber: false, maxThroughputMbps: 1000, antennaCount: 2, poeWatts: 30,
    color: '#5fc1f5', badges: ['1 Gbps', '4× LAN', 'Wi-Fi 6', 'PoE 30W'],
  },
  {
    id: 'CE-GW-300', name: 'CE-GW-300', tagline: 'Small branch',
    description: 'Retail / small office — 4 LAN, 1 Gbps Fiber + 5G failover, Wi-Fi 6.',
    lanPorts: 4, has5G: true, dualFiber: false, maxThroughputMbps: 1000, antennaCount: 2, poeWatts: 30,
    color: '#7cffd4', badges: ['1 Gbps', '4× LAN', '5G', 'PoE 30W'],
  },
  {
    id: 'CE-GW-500', name: 'CE-GW-500', tagline: 'Standard branch',
    description: 'Mid-sized branch — 8 LAN, dual-WAN (Fiber + 5G n78), 60 W PoE budget.',
    lanPorts: 8, has5G: true, dualFiber: false, maxThroughputMbps: 1000, antennaCount: 3, poeWatts: 60,
    color: '#c084fc', badges: ['1 Gbps', '8× LAN', '5G n78', 'PoE 60W'],
  },
  {
    id: 'CE-GW-700', name: 'CE-GW-700', tagline: 'High-density / HQ',
    description: 'HQ or large site — 12 LAN, 10 Gbps dual-Fiber + dual 5G, redundant PSU.',
    lanPorts: 12, has5G: true, dualFiber: true, maxThroughputMbps: 10_000, antennaCount: 4, poeWatts: 240,
    color: '#ffb547', badges: ['10 Gbps', '12× LAN', 'Dual 5G', 'PoE 240W', 'Redundant PSU'],
  },
  {
    id: 'CE-RG-5G', name: 'CE-RG-5G', tagline: 'Rugged / mobile',
    description: 'Rugged 5G-first gateway for mobile, pop-up, or fiber-pending sites.',
    lanPorts: 4, has5G: true, dualFiber: false, maxThroughputMbps: 1000, antennaCount: 4, poeWatts: 30,
    color: '#fb7185', badges: ['5G-first', '4× LAN', 'Rugged', 'PoE 30W'],
  },
];

const MODEL_BY_ID: Record<string, GatewayModel> = {};
for (const m of GATEWAY_MODELS) MODEL_BY_ID[m.id] = m;

/* GMT offset (minutes) per US timezone, keyed by state — used to derive the
   "From GMT" value from the selected site's location. */
const STATE_GMT: Record<string, string> = {
  WA: '-480', OR: '-480', CA: '-480', NV: '-480',            // Pacific
  AZ: '-420', CO: '-420', UT: '-420', NM: '-420',            // Mountain
  TX: '-360', IL: '-360', MN: '-360', MO: '-360', WI: '-360', // Central
  NY: '-300', MA: '-300', FL: '-300', GA: '-300', PA: '-300', // Eastern
};

function gmtForLocation(location: string): string {
  const state = location.split(',').pop()?.trim() ?? '';
  return STATE_GMT[state] ?? '-300';
}

/** Location-derived defaults for a given site (branch). */
function siteDefaults(siteId: string) {
  const b = branches.find((x) => x.id === siteId);
  if (!b) return null;
  return {
    siteName: b.name,
    fromGmt: gmtForLocation(b.location),
    modelId: MODEL_BY_ID[b.gatewayModel] ? b.gatewayModel : 'Capgemini-U120',
  };
}

/* ────────── Onboarded gateways (per-location, session) ────────── */

interface OnboardedGateway {
  id: string;
  modelId: string;
  name: string;
  status: 'active' | 'inactive';
  firmware: string;
  serial: string;
}

/** Seed each location with the primary gateway it already runs (from branch data). */
function seedGateways(): Record<string, OnboardedGateway[]> {
  const map: Record<string, OnboardedGateway[]> = {};
  for (const b of branches) {
    const modelId = MODEL_BY_ID[b.gatewayModel] ? b.gatewayModel : 'Capgemini-U120';
    map[b.id] = [{
      id: `${b.id}-gw1`,
      modelId,
      name: b.name,
      status: 'active',
      firmware: b.firmware,
      serial: `${modelId}-${b.id.slice(-4).toUpperCase()}01`,
    }];
  }
  return map;
}

const throughputLabel = (m: GatewayModel) =>
  m.maxThroughputMbps >= 1000 ? `${m.maxThroughputMbps / 1000} Gbps` : `${m.maxThroughputMbps} Mbps`;

/* ────────── Parameter model ────────── */

type Control =
  | { t: 'toggle'; opts: string[] }
  | { t: 'select'; opts: string[] }
  | { t: 'text'; placeholder?: string }
  | { t: 'action'; label: string }
  | { t: 'locked' };

interface Param {
  key: string;
  label: string;
  cat: string;
  ctrl: Control;
  /** Pre-filled value for this gateway — editable. */
  value: string;
  /** Note shown for locked rows, e.g. "Multiple Tunnel Active". */
  note?: string;
  /** True for user-added fields (removable). */
  custom?: boolean;
}

interface CategoryMeta {
  id: string;
  title: string;
  hint: string;
  icon: IconType;
  color: string;
}

/** #rrggbb → rgba() with the given alpha. */
function tint(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const ETH_SPEEDS = [
  '1 - Automatic Negotiation',
  '2 - 10 Mbps / Half',
  '3 - 10 Mbps / Full',
  '4 - 100 Mbps / Half',
  '5 - 100 Mbps / Full',
  '6 - 1 Gbps / Full',
];

const LOCKED = 'Multiple Tunnel Active';

/* ── Basic Settings ── */
const BASIC_CATS: CategoryMeta[] = [
  { id: 'identity', title: 'Device Identity', hint: 'Status, make / model, keys & service offering', icon: Cpu, color: '#5fc1f5' },
  { id: 'network', title: 'Network & Addressing', hint: 'LAN / WAN IP, VLAN ports & link speeds', icon: Network, color: '#7cffd4' },
  { id: 'dns', title: 'DNS & Packet Handling', hint: 'Resolver, caching & low-level packet rules', icon: Globe2, color: '#c084fc' },
  { id: 'firewall', title: 'Firewall & Crypto', hint: 'Memory pools for firewall & hardware crypto', icon: ShieldCheck, color: '#ffb547' },
  { id: 'vpn', title: 'VPN & Tunnels', hint: 'Credentials, NAT-T & tunnel timers', icon: KeyRound, color: '#f472b6' },
  { id: 'cellular', title: 'Cellular & Managed Backup', hint: 'ATS, MLAN & AT&T managed cellular', icon: Radio, color: '#60a5fa' },
  { id: 'locale', title: 'Time & Locale', hint: 'GMT offset, DST & language', icon: Clock, color: '#a3e635' },
  { id: 'health', title: 'Recovery & ARMT', hint: 'Reboot behaviour & ARMT monitoring', icon: Activity, color: '#fb7185' },
];

const BASIC_PARAMS: Param[] = [
  { key: 'deviceStatus', cat: 'identity', label: 'Device Status', ctrl: { t: 'toggle', opts: ['Active', 'Inactive'] }, value: 'Active' },
  { key: 'manufacturer', cat: 'identity', label: 'Manufacturer', ctrl: { t: 'select', opts: ['DIGI', 'MCAFEE', 'CISCO', 'JUNIPER'] }, value: 'DIGI' },
  { key: 'partNumber', cat: 'identity', label: 'Part Number', ctrl: { t: 'text' }, value: '' },
  { key: 'slaDetails', cat: 'identity', label: 'Device SLA Details', ctrl: { t: 'text' }, value: '' },
  { key: 'siteName', cat: 'identity', label: 'Site Name', ctrl: { t: 'text' }, value: '' },
  { key: 'portalId', cat: 'identity', label: 'Outsourcing Portal ID', ctrl: { t: 'text' }, value: '' },
  { key: 'e2eCpeKey', cat: 'identity', label: 'E2E CPE Key', ctrl: { t: 'text' }, value: '' },
  { key: 'e2eSiteKey', cat: 'identity', label: 'E2E Site Key', ctrl: { t: 'text' }, value: '' },
  { key: 'usbPorts', cat: 'identity', label: 'USB Ports Active', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'serviceOffering', cat: 'identity', label: 'Service Offering', ctrl: { t: 'select', opts: ['1 - AVTS', '2 - ANIRA', '3 - NetBond', '4 - VPN Managed'] }, value: '2 - ANIRA' },

  { key: 'lanIp', cat: 'network', label: 'LAN IP Address', ctrl: { t: 'text', placeholder: '10.10.10.1' }, value: '10.10.10.1' },
  { key: 'lanSubnet', cat: 'network', label: 'LAN Subnet', ctrl: { t: 'text', placeholder: '255.255.255.0' }, value: '255.255.255.0' },
  { key: 'allowInternet', cat: 'network', label: 'Allow Internet Access', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'Yes' },
  { key: 'disableVlanPorts', cat: 'network', label: 'Disable Default VLAN Ports', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'lanSpeed', cat: 'network', label: 'LAN Ethernet Speed', ctrl: { t: 'select', opts: ETH_SPEEDS }, value: '1 - Automatic Negotiation' },
  { key: 'wanSpeed', cat: 'network', label: 'WAN Ethernet Speed', ctrl: { t: 'select', opts: ETH_SPEEDS }, value: '1 - Automatic Negotiation' },
  { key: 'wanMtu', cat: 'network', label: 'WAN MTU Size', ctrl: { t: 'text', placeholder: '1500' }, value: '' },

  { key: 'dnsTcp', cat: 'dns', label: 'Support DNS via TCP', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'dnsCache', cat: 'dns', label: 'DNS Cache Size', ctrl: { t: 'text', placeholder: '01000' }, value: '01000' },
  { key: 'ignoreDf', cat: 'dns', label: 'Ignore Do Not Fragment (DF) Settings', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'rpFilter', cat: 'dns', label: 'Reverse Path Filter', ctrl: { t: 'select', opts: ['0 - No validation', '1 - Strict mode', '2 - Loose mode'] }, value: '0 - No validation' },
  { key: 'tcpTimestamps', cat: 'dns', label: 'Turn Off TCP Timestamps', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'arpIgnore', cat: 'dns', label: 'ARP Ignore', ctrl: { t: 'select', opts: ['0 - any IP Address on any Interface', '1 - reply only if target is local', '2 - reply only if sender on same subnet'] }, value: '0 - any IP Address on any Interface' },

  { key: 'fwMemory', cat: 'firewall', label: 'Firewall Memory', ctrl: { t: 'text', placeholder: '8192' }, value: '8192' },
  { key: 'cryptoBuffers', cat: 'firewall', label: 'Hardware Crypto Buffers', ctrl: { t: 'text', placeholder: '00500' }, value: '00500' },

  { key: 'saveUserId', cat: 'vpn', label: 'Save Login User ID', ctrl: { t: 'locked' }, value: '', note: LOCKED },
  { key: 'savePassword', cat: 'vpn', label: 'Save Login Password', ctrl: { t: 'locked' }, value: '', note: LOCKED },
  { key: 'savePwrLoss', cat: 'vpn', label: 'Save Password on Power Loss', ctrl: { t: 'locked' }, value: '', note: LOCKED },
  { key: 'initVpn', cat: 'vpn', label: 'Initiate VPN Connection', ctrl: { t: 'locked' }, value: '', note: LOCKED },
  { key: 'idleTunnel', cat: 'vpn', label: 'Idle Tunnel Timeout', ctrl: { t: 'locked' }, value: '', note: LOCKED },
  { key: 'tunnelReconnect', cat: 'vpn', label: 'Tunnel Reconnect Delay', ctrl: { t: 'locked' }, value: '', note: LOCKED },
  { key: 'sendRouteDelete', cat: 'vpn', label: 'Send Route Delete', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'wanInitWait', cat: 'vpn', label: 'WAN Initial Wait Time', ctrl: { t: 'text', placeholder: '0030' }, value: '0030' },
  { key: 'bteMaxTime', cat: 'vpn', label: 'Backup Tunnel Endpoint Maximum Time', ctrl: { t: 'text', placeholder: '0000' }, value: '0000' },
  { key: 'bteIdleTime', cat: 'vpn', label: 'Backup Tunnel Endpoint Idle Time', ctrl: { t: 'text', placeholder: '0000' }, value: '0000' },
  { key: 'reconnectReboot', cat: 'vpn', label: 'Reconnect Tunnel Endpoint in Reboot Window', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'nattKeepAlive', cat: 'vpn', label: 'NAT-T Keep Alive Int', ctrl: { t: 'text', placeholder: '0020' }, value: '0020' },
  { key: 'nattNegotiation', cat: 'vpn', label: 'NAT-T Negotiation', ctrl: { t: 'select', opts: ['Yes', 'No'] }, value: 'Yes' },
  { key: 'altFtpPorts', cat: 'vpn', label: 'Alternate FTP Ports', ctrl: { t: 'text' }, value: '' },

  { key: 'atsService', cat: 'cellular', label: 'Used with the ATS Service', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'usedMlan', cat: 'cellular', label: 'Used with MLAN', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'cellBackup', cat: 'cellular', label: 'AT&T Managed Cellular Backup', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'cellRefresh', cat: 'cellular', label: 'Cell Data Refresh', ctrl: { t: 'text', placeholder: '1440' }, value: '1440' },
  { key: 'sendCellData', cat: 'cellular', label: 'Send Cell Data to SM', ctrl: { t: 'toggle', opts: ['Yes', 'Both', 'No'] }, value: 'Yes' },

  { key: 'fromGmt', cat: 'locale', label: 'From GMT', ctrl: { t: 'text', placeholder: '-300' }, value: '-300' },
  { key: 'dst', cat: 'locale', label: 'Daylight Savings Time', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'Yes' },
  { key: 'langId', cat: 'locale', label: 'Language ID', ctrl: { t: 'text', placeholder: 'EN' }, value: 'EN' },

  { key: 'forceReboot', cat: 'health', label: 'Force Reboot After Query', ctrl: { t: 'select', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'notFoundAction', cat: 'health', label: 'Not Found Action', ctrl: { t: 'select', opts: ['Stop Functioning', 'Continue Functioning'] }, value: 'Stop Functioning' },
  { key: 'armtEnabled', cat: 'health', label: 'ARMT Enabled', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'Yes' },
  { key: 'armtRefProfile', cat: 'health', label: 'ARMT Reference Profile', ctrl: { t: 'text', placeholder: 'ARMT-CONFIG-REF' }, value: 'ARMT-CONFIG-REF' },
  { key: 'armtResend', cat: 'health', label: 'ARMT Tunnel-Up Resend Interval', ctrl: { t: 'text', placeholder: '0020' }, value: '0020' },
];

/* ── Configuration Options ── */
const CONFIG_CATS: CategoryMeta[] = [
  { id: 'nat', title: 'NAT & Address Translation', hint: 'PAT and SA-negotiated NAT overrides', icon: Shuffle, color: '#5fc1f5' },
  { id: 'qos', title: 'Class of Service (QoS)', hint: 'COS activation & bandwidth limits', icon: Gauge, color: '#ffb547' },
  { id: 'routing', title: 'Routing & Broadcast', hint: 'Directed broadcast, PBR & DNS function', icon: Route, color: '#7cffd4' },
  { id: 'tunnels', title: 'Tunnels & Authentication', hint: 'Auth type, multiple & inbound tunnels', icon: Lock, color: '#f472b6' },
  { id: 'vlan', title: 'VLAN & Redundancy', hint: 'VLAN, data merge & VRRP', icon: Layers, color: '#c084fc' },
  { id: 'wifi', title: 'Wi-Fi & WAN', hint: 'Wi-Fi AP & WAN connectivity checks', icon: Wifi, color: '#60a5fa' },
  { id: 'provisioning', title: 'Provisioning & Policies', hint: 'Zero-touch & traffic policies', icon: Sparkles, color: '#a78bfa' },
];

const CONFIG_PARAMS: Param[] = [
  { key: 'addrTranslation', cat: 'nat', label: 'Address Translation', ctrl: { t: 'locked' }, value: '', note: LOCKED },
  { key: 'patIp', cat: 'nat', label: 'PAT IP Address for all other hosts', ctrl: { t: 'text' }, value: '' },
  { key: 'saIpOverride', cat: 'nat', label: 'SA Negotiated IP Address Override for (1-1 + PAT) NAT List', ctrl: { t: 'text' }, value: '' },
  { key: 'saMaskOverride', cat: 'nat', label: 'SA Negotiated Subnet Mask Override for (1-1 + PAT) NAT List', ctrl: { t: 'text' }, value: '' },

  { key: 'cos', cat: 'qos', label: 'Class of Service', ctrl: { t: 'select', opts: ['0 - Not Active', '1 - Active'] }, value: '0 - Not Active' },
  { key: 'cosPrimary', cat: 'qos', label: 'COS Limit Primary Support', ctrl: { t: 'select', opts: ['N - Not Limited', 'Y - Limited'] }, value: 'N - Not Limited' },
  { key: 'cosBackup', cat: 'qos', label: 'COS Limit Backup Support', ctrl: { t: 'select', opts: ['N - Not Limited', 'Y - Limited'] }, value: 'N - Not Limited' },
  { key: 'bwPrimary', cat: 'qos', label: 'B/W Testing without COS - Primary', ctrl: { t: 'text' }, value: '' },
  { key: 'bwBackup', cat: 'qos', label: 'B/W Testing without COS - Backup', ctrl: { t: 'text' }, value: '' },

  { key: 'directedBroadcast', cat: 'routing', label: 'Directed Broadcast', ctrl: { t: 'toggle', opts: ['Enabled', 'Disabled'] }, value: 'Disabled' },
  { key: 'pbr', cat: 'routing', label: 'Performance Based Routing', ctrl: { t: 'toggle', opts: ['Enabled', 'Disabled'] }, value: 'Disabled' },
  { key: 'performDns', cat: 'routing', label: 'Perform DNS Function', ctrl: { t: 'toggle', opts: ['Enabled', 'Disabled'] }, value: 'Enabled' },

  { key: 'authType', cat: 'tunnels', label: 'Authentication Type', ctrl: { t: 'locked' }, value: '', note: LOCKED },
  { key: 'multipleTunnel', cat: 'tunnels', label: 'Multiple Tunnel', ctrl: { t: 'toggle', opts: ['M=Enabled', 'Y=Enabled', 'Disabled'] }, value: 'Disabled' },
  { key: 'maxInboundTunnels', cat: 'tunnels', label: 'Maximum Inbound Tunnels', ctrl: { t: 'text', placeholder: '010' }, value: '010' },
  { key: 'standardIke', cat: 'tunnels', label: 'Use Standard IKE Ports', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'Yes' },

  { key: 'vlan', cat: 'vlan', label: 'VLAN', ctrl: { t: 'toggle', opts: ['Enabled', 'Disabled'] }, value: 'Enabled' },
  { key: 'mergeVlan', cat: 'vlan', label: 'Merge VLAN Data', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'vrrp', cat: 'vlan', label: 'VRRP', ctrl: { t: 'toggle', opts: ['Enabled', 'Disabled'] }, value: 'Disabled' },

  { key: 'wifiAp', cat: 'wifi', label: 'Wifi Access Point on LAN', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'No' },
  { key: 'checkWanAddr', cat: 'wifi', label: 'Check WAN Address', ctrl: { t: 'toggle', opts: ['Yes', 'No'] }, value: 'Yes' },
  { key: 'wanTestMethod', cat: 'wifi', label: 'WAN Connectivity Test Method', ctrl: { t: 'select', opts: ['1 - Ping', '2 - SMx Health Check', '3 - DNS Probe'] }, value: '2 - SMx Health Check' },

  { key: 'zeroTouch', cat: 'provisioning', label: 'Zero Touch', ctrl: { t: 'toggle', opts: ['Enabled', 'Disabled'] }, value: 'Enabled' },
  { key: 'policies', cat: 'provisioning', label: 'Policies', ctrl: { t: 'action', label: 'Configure policies…' }, value: '' },
];

interface ParamGroup {
  title: string;
  sub: string;
  cats: CategoryMeta[];
  params: Param[];
}

const GROUPS: ParamGroup[] = [
  {
    title: 'Basic Settings',
    sub: 'Device-level parameters. Pre-filled with sensible defaults — change anything this gateway needs.',
    cats: BASIC_CATS,
    params: BASIC_PARAMS,
  },
  {
    title: 'Configuration Options',
    sub: 'Feature areas — NAT, Class of Service, routing, tunnels, VLAN, VRRP, Wi-Fi and provisioning.',
    cats: CONFIG_CATS,
    params: CONFIG_PARAMS,
  },
];

const EDITABLE = (c: Control) => c.t === 'toggle' || c.t === 'select' || c.t === 'text';

function buildInitial(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of [...BASIC_PARAMS, ...CONFIG_PARAMS]) {
    if (EDITABLE(p.ctrl)) out[p.key] = p.value;
  }
  return out;
}

/* ────────── Smart search ──────────
   Tolerant matching: substring + prefix + edit-distance (typos) + a synonym
   map so people can search by intent ("wireless" → Wi-Fi, "restart" → reboot,
   "timezone" → GMT) without knowing the exact AT&T parameter name. When nothing
   matches cleanly we surface "Did you mean" suggestions of the real names. */

const TOKEN_RE = /[^a-z0-9]+/;
const toTokens = (s: string) => s.toLowerCase().split(TOKEN_RE).filter(Boolean);

const SYNONYMS: string[][] = [
  ['ip', 'address', 'addressing', 'lan', 'subnet', 'gateway'],
  ['wifi', 'wi-fi', 'wireless', 'access point', 'ap'],
  ['password', 'passwd', 'credential', 'login', 'auth', 'authentication'],
  ['vpn', 'tunnel', 'tunnels', 'ipsec', 'ike', 'nat-t'],
  ['dns', 'resolver', 'domain', 'name', 'hostname'],
  ['qos', 'cos', 'class of service', 'bandwidth', 'priority', 'b/w'],
  ['reboot', 'restart', 'recovery', 'reset', 'power'],
  ['time', 'timezone', 'gmt', 'clock', 'daylight', 'dst', 'locale', 'utc'],
  ['firewall', 'security'],
  ['crypto', 'encryption', 'cipher', 'buffers'],
  ['cellular', 'cell', 'lte', '5g', 'sim', 'mobile', 'mlan', 'ats', 'backup'],
  ['mtu', 'fragment', 'df'],
  ['speed', 'ethernet', 'negotiation', 'duplex', 'link'],
  ['vlan'],
  ['nat', 'pat', 'translation'],
  ['vrrp', 'redundancy', 'failover'],
  ['language', 'lang', 'locale'],
  ['model', 'manufacturer', 'make', 'part', 'identity', 'vendor'],
  ['armt', 'monitoring', 'health', 'heartbeat'],
  ['zero', 'touch', 'ztp', 'provisioning', 'onboarding'],
  ['route', 'routing', 'pbr', 'broadcast', 'directed'],
  ['policy', 'policies'],
  ['sla'],
  ['usb', 'ports'],
];

const SYN_MAP: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const group of SYNONYMS) {
    const words = [...new Set(group.flatMap(toTokens))];
    for (const w of words) m[w] = [...new Set([...(m[w] ?? []), ...words])];
  }
  return m;
})();

const expand = (t: string) => (SYN_MAP[t] ? [t, ...SYN_MAP[t]] : [t]);

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

const simil = (a: string, b: string) => {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - lev(a, b) / max;
};

const CAT_BY_ID: Record<string, CategoryMeta> = {};
for (const c of [...BASIC_CATS, ...CONFIG_CATS]) CAT_BY_ID[c.id] = c;

/** Searchable tokens for a parameter: its label + category title + hint. */
function hayFor(p: Param): string[] {
  const c = CAT_BY_ID[p.cat];
  return [...new Set(toTokens(`${p.label}${c ? ` ${c.title} ${c.hint}` : ''}`))];
}

/** Best 0..1 match of one query token against a set of haystack tokens. */
function tokenScore(qt: string, hay: string[]): number {
  let best = 0;
  for (const cand of expand(qt)) {
    for (const ht of hay) {
      if (ht === cand) return 1;
      if (ht.startsWith(cand) || cand.startsWith(ht)) best = Math.max(best, 0.92);
      else if (ht.includes(cand) || cand.includes(ht)) best = Math.max(best, 0.82);
      else if (cand.length >= 4 && ht.length >= 4) {
        const s = simil(cand, ht);
        if (s >= 0.72) best = Math.max(best, s * 0.85);
      }
    }
  }
  return best;
}

/** All query tokens must match (AND); returns the averaged confidence. */
function scoreParam(p: Param, qTokens: string[]): number {
  const hay = hayFor(p);
  let total = 0;
  for (const qt of qTokens) {
    const s = tokenScore(qt, hay);
    if (s === 0) return 0;
    total += s;
  }
  return total / qTokens.length;
}

/** Lenient label-only score used to rank "Did you mean" suggestions. */
function suggestScore(label: string, qTokens: string[]): number {
  const lt = toTokens(label);
  let sum = 0;
  for (const qt of qTokens) sum += tokenScore(qt, lt);
  return sum / qTokens.length;
}

function computeSearch(cats: CategoryMeta[], params: Param[], rawQuery: string) {
  const qRaw = rawQuery.trim().toLowerCase();
  if (!qRaw) {
    return {
      suggestions: [] as string[],
      visibleCats: cats
        .map((meta) => ({ meta, params: params.filter((p) => p.cat === meta.id) }))
        .filter((c) => c.params.length > 0),
    };
  }

  const qTokens = toTokens(qRaw);
  const score = new Map<string, number>();
  for (const p of params) {
    const s = scoreParam(p, qTokens);
    if (s > 0) score.set(p.key, s);
  }

  const visibleCats = cats
    .map((meta) => ({
      meta,
      params: params
        .filter((p) => p.cat === meta.id && score.has(p.key))
        .sort((a, b) => (score.get(b.key) ?? 0) - (score.get(a.key) ?? 0)),
    }))
    .filter((c) => c.params.length > 0);

  // "Did you mean" only when the text doesn't already directly hit a name.
  const directHit = params.some((p) => p.label.toLowerCase().includes(qRaw));
  const suggestions = !directHit && qRaw.length >= 3
    ? params
        .map((p) => ({ label: p.label, s: suggestScore(p.label, qTokens) }))
        .filter((x) => x.s >= 0.6 && !x.label.toLowerCase().includes(qRaw))
        .sort((a, b) => b.s - a.s)
        .slice(0, 3)
        .map((x) => x.label)
    : [];

  return { visibleCats, suggestions };
}

/* ────────── Page container — gateway list ⇄ add-device form ────────── */

export function OnboardingPage({ branchId }: { branchId: string }) {
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const [gateways, setGateways] = useState<Record<string, OnboardedGateway[]>>(() => seedGateways());
  const [mode, setMode] = useState<'list' | 'form'>('list');

  // Switching the global location (top bar) always returns to that site's list.
  useEffect(() => { setMode('list'); }, [branchId]);

  const list = gateways[branch.id] ?? [];

  const addGateway = (gw: OnboardedGateway) => {
    setGateways((m) => ({ ...m, [branch.id]: [...(m[branch.id] ?? []), gw] }));
    setMode('list');
  };
  const removeGateway = (id: string) =>
    setGateways((m) => ({ ...m, [branch.id]: (m[branch.id] ?? []).filter((g) => g.id !== id) }));

  return (
    <>
      <PageHeader
        title="Gateway Onboarding"
        subtitle={mode === 'list'
          ? 'Gateways provisioned at the selected location.'
          : 'Provision a new Enterprise Gateway end-to-end.'}
        right={
          <span className="badge" style={{ gap: 6 }}>
            <MapPin size={12} />
            {`${branch.name} · ${branch.location}`}
          </span>
        }
      />

      {mode === 'list'
        ? <GatewayList branch={branch} gateways={list} onAdd={() => setMode('form')} onRemove={removeGateway} />
        : <OnboardingForm branch={branch} onCancel={() => setMode('list')} onComplete={addGateway} />}
    </>
  );
}

/* ────────── Gateway list (landing) ────────── */

function GatewayList({
  branch, gateways, onAdd, onRemove,
}: {
  branch: Branch;
  gateways: OnboardedGateway[];
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Card
      title={`Gateways · ${branch.name}`}
      sub={`${gateways.length} device${gateways.length === 1 ? '' : 's'} onboarded at ${branch.location}`}
      right={<button className="primary" onClick={onAdd}><Plus size={14} />Add device</button>}
    >
      {gateways.length === 0 ? (
        <div className="onb-gw-empty">
          <span className="onb-gw-empty-icon"><PackagePlus size={26} /></span>
          <div className="onb-gw-empty-title">No gateways onboarded here yet</div>
          <div className="onb-gw-empty-sub">
            {branch.name} — {branch.location} has no gateways provisioned. Add the first one to get started.
          </div>
          <button className="primary" onClick={onAdd}><Plus size={14} />Add device</button>
        </div>
      ) : (
        <div className="onb-gw-list">
          {gateways.map((gw) => <GatewayRow key={gw.id} gw={gw} onRemove={() => onRemove(gw.id)} />)}
        </div>
      )}
    </Card>
  );
}

function GatewayRow({ gw, onRemove }: { gw: OnboardedGateway; onRemove: () => void }) {
  const model = MODEL_BY_ID[gw.modelId] ?? GATEWAY_MODELS[0];
  const active = gw.status === 'active';
  return (
    <div className="onb-gw-card" style={{ ['--cat' as string]: model.color } as React.CSSProperties}>
      <span
        className="onb-gw-icon"
        style={{ color: model.color, background: tint(model.color, 0.13), borderColor: tint(model.color, 0.32) }}
      >
        <Cpu size={18} />
      </span>
      <div className="onb-gw-main">
        <div className="onb-gw-name">
          {gw.name}
          <span className="onb-gw-model">{model.name} · {model.tagline}</span>
        </div>
        <div className="onb-gw-meta">
          <span className={`badge ${active ? 'ok' : ''}`}>
            <span className={`dot ${active ? 'ok' : 'off'}`} />{active ? 'Active' : 'Inactive'}
          </span>
          <span className="onb-gw-chip">{throughputLabel(model)}</span>
          <span className="onb-gw-chip">{model.lanPorts}× LAN</span>
          <span className="onb-gw-chip">{model.has5G ? 'Fiber + 5G' : 'Fiber'}</span>
          <span className="onb-gw-chip">fw {gw.firmware}</span>
          <span className="onb-gw-chip">SN {gw.serial}</span>
        </div>
      </div>
      <button type="button" className="onb-del-field" onClick={onRemove} title="Remove gateway"><Trash2 size={14} /></button>
    </div>
  );
}

/* ────────── Add-device form (the wizard) ────────── */

function OnboardingForm({
  branch, onCancel, onComplete,
}: {
  branch: Branch;
  onCancel: () => void;
  onComplete: (gw: OnboardedGateway) => void;
}) {
  const [step, setStep] = useState(0);
  const [modelId, setModelId] = useState(() => siteDefaults(branch.id)?.modelId ?? 'Capgemini-U120');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init = buildInitial();
    const d = siteDefaults(branch.id);
    if (d) { init.siteName = d.siteName; init.fromGmt = d.fromGmt; }
    return init;
  });
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [customParams, setCustomParams] = useState<Param[]>([]);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);

  const set = (key: string, value: string) => setValues((s) => ({ ...s, [key]: value }));

  const model = MODEL_BY_ID[modelId] ?? GATEWAY_MODELS[0];
  const group = GROUPS[step];
  const searching = query.trim() !== '';

  const effectiveParams = useMemo(() => {
    const ids = new Set(group.cats.map((c) => c.id));
    return [...group.params, ...customParams.filter((p) => ids.has(p.cat))];
  }, [group, customParams]);

  const { visibleCats, suggestions } = useMemo(
    () => computeSearch(group.cats, effectiveParams, query),
    [group, effectiveParams, query],
  );

  const setAll = (open: boolean) =>
    setCollapsed((c) => {
      const next = { ...c };
      for (const cat of group.cats) next[cat.id] = !open;
      return next;
    });

  const addField = (cat: string, label: string, type: 'text' | 'toggle' | 'select', opts: string[]) => {
    const key = `custom-${seq}`;
    setSeq((n) => n + 1);
    let ctrl: Control;
    let value: string;
    if (type === 'toggle') { ctrl = { t: 'toggle', opts: ['Yes', 'No'] }; value = 'No'; }
    else if (type === 'select') { const o = opts.length ? opts : ['Option 1']; ctrl = { t: 'select', opts: o }; value = o[0]; }
    else { ctrl = { t: 'text' }; value = ''; }
    setCustomParams((cp) => [...cp, { key, cat, label, ctrl, value, custom: true }]);
    setValues((v) => ({ ...v, [key]: value }));
    setAddingTo(null);
  };

  const deleteField = (key: string) => {
    setCustomParams((cp) => cp.filter((p) => p.key !== key));
    setValues((v) => {
      const next = { ...v };
      delete next[key];
      return next;
    });
  };

  const finish = () => {
    onComplete({
      id: `gw-${branch.id}-${Date.now()}`,
      modelId,
      name: values.siteName?.trim() || branch.name,
      status: values.deviceStatus === 'Inactive' ? 'inactive' : 'active',
      firmware: branch.firmware,
      serial: `${modelId}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    });
  };

  return (
    <>
      <div className="onb-form-top">
        <button type="button" className="onb-back-link" onClick={onCancel}><ChevronDown size={14} style={{ transform: 'rotate(90deg)' }} />Back to gateways</button>
      </div>

      <div className="wizard-steps">
        {GROUPS.map((g, i) => (
          <div key={g.title} style={{ display: 'contents' }}>
            <div className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`}>
              {i < step ? <Check size={14} /> : <span style={{ width: 14, textAlign: 'center' }}>{i + 1}</span>}
              {g.title}
            </div>
            {i < GROUPS.length - 1 && <div className="sep" />}
          </div>
        ))}
      </div>

      <div className="grid">
        <div className="col-7">
          <Card
            title={group.title}
            sub={group.sub}
            right={<span className="badge">{effectiveParams.length} settings</span>}
          >
            <div className="onb-controls">
              <div className="onb-search">
                <Search size={14} />
                <input placeholder="Search settings…" value={query} onChange={(e) => setQuery(e.target.value)} />
                {query && (
                  <button type="button" className="onb-search-clear" onClick={() => setQuery('')} title="Clear">×</button>
                )}
              </div>
              <button type="button" onClick={() => setAll(true)}>Expand all</button>
              <button type="button" onClick={() => setAll(false)}>Collapse all</button>
            </div>

            {suggestions.length > 0 && (
              <div className="onb-suggest">
                <span className="onb-suggest-label"><Sparkles size={12} />Did you mean</span>
                {suggestions.map((s) => (
                  <button key={s} type="button" className="onb-suggest-chip" onClick={() => setQuery(s)}>{s}</button>
                ))}
              </div>
            )}

            <div className="onb-param-scroll">
              {visibleCats.length === 0 ? (
                <div className="onb-empty">No settings match “{query}”.</div>
              ) : (
                visibleCats.map(({ meta, params }) => (
                  <CategorySection
                    key={meta.id}
                    meta={meta}
                    params={params}
                    open={searching || !collapsed[meta.id]}
                    onToggle={() => setCollapsed((c) => ({ ...c, [meta.id]: !c[meta.id] }))}
                    values={values}
                    query={query}
                    onChange={set}
                    canAdd={!searching}
                    adding={addingTo === meta.id}
                    onStartAdd={() => setAddingTo(meta.id)}
                    onCancelAdd={() => setAddingTo(null)}
                    onAddField={addField}
                    onDeleteField={deleteField}
                  />
                ))
              )}
            </div>

            <div className="toolbar" style={{ marginTop: 14 }}>
              <button onClick={step === 0 ? onCancel : () => setStep((s) => Math.max(0, s - 1))}>
                {step === 0 ? 'Cancel' : 'Back'}
              </button>
              {step < GROUPS.length - 1
                ? <button className="primary" onClick={() => setStep((s) => s + 1)}>Continue</button>
                : <button className="primary" onClick={finish}><Sparkles size={14} />Onboard gateway</button>}
            </div>
          </Card>
        </div>

        <div className="col-5 onb-side" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(18px, 1.4vw, 28px)' }}>
          <Card
            title="Provisioning target"
            sub="This gateway will be onboarded to the location selected in the top bar."
            right={<span className="badge" style={{ color: model.color, borderColor: model.color }}>{throughputLabel(model)}</span>}
          >
            <div className="onb-target">
              <label className="onb-mini-field">
                <span><MapPin size={11} />Site / Location</span>
                <div className="onb-target-site"><MapPin size={12} />{branch.name} — {branch.location}</div>
              </label>
              <label className="onb-mini-field">
                <span><Cpu size={11} />Gateway model</span>
                <div className="onb-select">
                  <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                    {GATEWAY_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.name} · {m.tagline}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="onb-select-caret" />
                </div>
              </label>
            </div>
            <div className="onb-target-desc">{model.description}</div>
            <GatewayIllustration model={model} step={step} />
          </Card>

          <Card title="About this form" right={<Info size={13} style={{ color: 'var(--accent)' }} />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
              <LegendRow swatch="value" title="Pre-filled values">
                Every setting starts on a sensible default. Just change the ones this gateway needs.
              </LegendRow>
              <LegendRow swatch="locked" title={LOCKED}>
                Rows managed automatically while Multiple Tunnel mode is active; not directly editable.
              </LegendRow>
              <div style={{ paddingTop: 4, borderTop: '1px dashed var(--border)', color: 'var(--text-muted)' }}>
                {STEP_TIPS[step]} Use the search box and category headers to jump straight to a setting.
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

const STEP_TIPS: Record<number, string> = {
  0: 'Basic Settings cover identity, addressing, time, firewall and tunnel behaviour for the device.',
  1: 'Configuration Options group the feature areas — NAT, COS, VLAN, VRRP, Wi-Fi and inbound tunnels.',
};

/* ────────── Category accordion ────────── */

function CategorySection({
  meta, params, open, onToggle, values, query, onChange,
  canAdd, adding, onStartAdd, onCancelAdd, onAddField, onDeleteField,
}: {
  meta: CategoryMeta;
  params: Param[];
  open: boolean;
  onToggle: () => void;
  values: Record<string, string>;
  query: string;
  onChange: (key: string, value: string) => void;
  canAdd: boolean;
  adding: boolean;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onAddField: (cat: string, label: string, type: 'text' | 'toggle' | 'select', opts: string[]) => void;
  onDeleteField: (key: string) => void;
}) {
  const Icon = meta.icon;
  return (
    <div className={`onb-cat ${open ? 'is-open' : ''}`} style={{ ['--cat' as string]: meta.color } as React.CSSProperties}>
      <button type="button" className="onb-cat-bar" onClick={onToggle} aria-expanded={open}>
        <span
          className="onb-cat-icon"
          style={{ color: meta.color, background: tint(meta.color, 0.13), borderColor: tint(meta.color, 0.32) }}
        >
          <Icon size={15} />
        </span>
        <span className="onb-cat-titles">
          <span className="onb-cat-title">{meta.title}</span>
          <span className="onb-cat-hint">{meta.hint}</span>
        </span>
        <span className="onb-cat-meta">
          <span className="onb-cat-count">{params.length}</span>
          <ChevronDown size={16} className={`onb-chevron ${open ? 'is-open' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="onb-cat-body">
          {params.map((p) => (
            <ParamRow
              key={p.key}
              p={p}
              value={values[p.key] ?? ''}
              query={query}
              onChange={(v) => onChange(p.key, v)}
              onDelete={p.custom ? () => onDeleteField(p.key) : undefined}
            />
          ))}
          {canAdd && (
            adding
              ? <AddFieldForm color={meta.color} onAdd={(label, type, opts) => onAddField(meta.id, label, type, opts)} onCancel={onCancelAdd} />
              : <button type="button" className="onb-add-field" onClick={onStartAdd}><Plus size={13} />Add field</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────── Add-a-field inline editor ────────── */

function AddFieldForm({
  color, onAdd, onCancel,
}: {
  color: string;
  onAdd: (label: string, type: 'text' | 'toggle' | 'select', opts: string[]) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'text' | 'toggle' | 'select'>('text');
  const [opts, setOpts] = useState('');

  const submit = () => {
    const name = label.trim();
    if (!name) return;
    onAdd(name, type, opts.split(',').map((o) => o.trim()).filter(Boolean));
  };

  return (
    <div className="onb-add-form" style={{ ['--cat' as string]: color } as React.CSSProperties}>
      <div className="onb-add-form-row">
        <input
          autoFocus
          placeholder="Field name (e.g. Asset Tag)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
          style={{ flex: '2 1 200px' }}
        />
        <div className="onb-select" style={{ flex: '1 1 130px' }}>
          <select value={type} onChange={(e) => setType(e.target.value as 'text' | 'toggle' | 'select')}>
            <option value="text">Text</option>
            <option value="toggle">Yes / No</option>
            <option value="select">Dropdown</option>
          </select>
          <ChevronDown size={13} className="onb-select-caret" />
        </div>
      </div>
      {type === 'select' && (
        <input
          placeholder="Dropdown options, comma-separated (e.g. Low, Medium, High)"
          value={opts}
          onChange={(e) => setOpts(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
        />
      )}
      <div className="onb-add-form-actions">
        <button type="button" onClick={onCancel}><X size={13} />Cancel</button>
        <button type="button" className="primary" onClick={submit} disabled={!label.trim()}><Plus size={13} />Add field</button>
      </div>
    </div>
  );
}

/* ────────── Parameter row + controls ────────── */

function ParamRow({
  p, value, query, onChange, onDelete,
}: {
  p: Param;
  value: string;
  query: string;
  onChange: (v: string) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="onb-param-row">
      <div className="onb-param-label">
        <Highlight text={p.label} query={query} />
        {p.custom && <span className="onb-custom-tag">Custom</span>}
      </div>
      <div className="onb-param-ov">
        {p.ctrl.t === 'locked'
          ? <span className="onb-locked"><Lock size={12} />{p.note ?? 'Locked'}</span>
          : <ParamControl ctrl={p.ctrl} value={value} onChange={onChange} />}
        {onDelete && (
          <button type="button" className="onb-del-field" onClick={onDelete} title="Remove field"><Trash2 size={12} /></button>
        )}
      </div>
    </div>
  );
}

function ParamControl({ ctrl, value, onChange }: { ctrl: Control; value: string; onChange: (v: string) => void }) {
  switch (ctrl.t) {
    case 'toggle':
      return <Seg options={ctrl.opts} value={value} onChange={onChange} />;
    case 'select':
      return (
        <div className="onb-select">
          <select value={value} onChange={(e) => onChange(e.target.value)}>
            {ctrl.opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <ChevronDown size={13} className="onb-select-caret" />
        </div>
      );
    case 'text':
      return <input value={value} placeholder={ctrl.placeholder ?? 'Set value…'} onChange={(e) => onChange(e.target.value)} />;
    case 'action':
      return <button type="button" className="onb-action-btn"><SlidersHorizontal size={13} />{ctrl.label}</button>;
    case 'locked':
      return null;
  }
}

function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="onb-seg" role="group">
      {options.map((o) => (
        <button key={o} type="button" className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="onb-hl">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function LegendRow({ swatch, title, children }: { swatch: 'value' | 'locked'; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <span className={`onb-legend-dot is-${swatch}`} />
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>{children}</div>
      </div>
    </div>
  );
}

/* ────────── Animated gateway illustration ────────── */

function GatewayIllustration({ model, step }: { model: GatewayModel; step: number }) {
  // Each step lights up the device a little more, mimicking a real provisioning
  // sequence: power-on → configured → online.
  const power = step >= 0;
  const wanLit = step >= 1;
  const allOnline = step >= 1;

  const W = 300;
  const VBH = 190;
  const bodyH = 92;
  const bodyW = 252;
  const bodyX = (W - bodyW) / 2;
  const bodyY = 64;

  // Port spacing — fit lanPorts across the body width
  const portCount = model.lanPorts;
  const portAreaW = bodyW - 30;
  const portW = Math.min(14, portAreaW / portCount - 2);
  const portGap = (portAreaW - portW * portCount) / Math.max(1, portCount - 1);

  // Antenna positions
  const antennaY = bodyY - 22;
  const antennaSpan = bodyW * 0.6;
  const antennaStartX = (W - antennaSpan) / 2;
  const antennaPositions = Array.from({ length: model.antennaCount }, (_, i) =>
    model.antennaCount === 1
      ? W / 2
      : antennaStartX + (antennaSpan * i) / (model.antennaCount - 1),
  );

  // LED colors
  const offColor = 'rgba(255,255,255,0.10)';
  const okColor = '#74e8a1';
  const warnColor = '#ffb547';

  return (
    <div className="onb-illustration">
      <svg
        viewBox={`0 0 ${W} ${VBH}`}
        style={{ display: 'block', width: '100%', maxWidth: 360, maxHeight: 220 }}
      >
        <defs>
          <linearGradient id="onb-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.10)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
          </linearGradient>
          <radialGradient id="onb-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={model.color} stopOpacity={0.6} />
            <stop offset="100%" stopColor={model.color} stopOpacity={0} />
          </radialGradient>
          <filter id="onb-soft">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        {/* Antenna signal waves — only visible when 5G online */}
        {model.has5G && allOnline && (
          <g>
            {antennaPositions.map((ax, i) => (
              <g key={`wave-${i}`}>
                {[10, 18, 26].map((r, ri) => (
                  <circle
                    key={ri}
                    cx={ax} cy={antennaY - 12}
                    r={r}
                    fill="none"
                    stroke={model.color}
                    strokeWidth={1}
                    opacity={0.5 - ri * 0.12}
                  >
                    <animate
                      attributeName="r"
                      values={`${r};${r + 8};${r}`}
                      dur={`${1.6 + i * 0.2}s`}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values={`${0.5 - ri * 0.12};0;${0.5 - ri * 0.12}`}
                      dur={`${1.6 + i * 0.2}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                ))}
              </g>
            ))}
          </g>
        )}

        {/* Antennas */}
        {antennaPositions.map((ax, i) => (
          <g key={`ant-${i}`}>
            <rect x={ax - 1.6} y={antennaY - 22} width={3.2} height={28} rx={1.6}
              fill={power ? model.color : 'rgba(255,255,255,0.15)'} opacity={power ? 0.95 : 0.6} />
            <circle cx={ax} cy={antennaY - 22} r={2} fill={power ? model.color : offColor} />
          </g>
        ))}

        {/* Glow halo around the body when fully online */}
        {allOnline && (
          <ellipse cx={W / 2} cy={bodyY + bodyH / 2} rx={bodyW / 2 + 20} ry={bodyH / 2 + 12} fill="url(#onb-glow)" filter="url(#onb-soft)" />
        )}

        {/* Router body */}
        <rect
          x={bodyX} y={bodyY} width={bodyW} height={bodyH} rx={8}
          fill="url(#onb-body)"
          stroke={power ? model.color : 'rgba(255,255,255,0.18)'}
          strokeWidth={1.4}
          opacity={power ? 1 : 0.7}
        />
        {/* Top tint stripe */}
        <rect x={bodyX + 2} y={bodyY + 2} width={bodyW - 4} height={2.5} rx={1.2} fill={model.color} opacity={power ? 0.8 : 0.2} />

        {/* Model badge */}
        <text x={bodyX + bodyW - 8} y={bodyY + 16} textAnchor="end" fontSize="9" fontWeight={700} fill="rgba(255,255,255,0.55)" letterSpacing="0.06em">
          {model.name}
        </text>

        {/* Status LED row */}
        <g transform={`translate(${bodyX + 12} ${bodyY + 18})`}>
          {[
            { label: 'PWR', on: power,   color: okColor },
            { label: 'WAN', on: wanLit,  color: wanLit ? okColor : offColor },
            { label: '5G',  on: model.has5G && allOnline, color: okColor, hidden: !model.has5G },
            { label: 'CLD', on: allOnline, color: okColor },
            { label: 'OK',  on: allOnline, color: allOnline ? okColor : warnColor },
          ].filter((l) => !l.hidden).map((led, i) => (
            <g key={led.label} transform={`translate(${i * 22} 0)`}>
              <circle r={3} fill={led.on ? led.color : offColor}>
                {(allOnline && led.label === 'OK') && (
                  <animate attributeName="opacity" values="1;0.55;1" dur="1.4s" repeatCount="indefinite" />
                )}
              </circle>
              <text x={0} y={12} textAnchor="middle" fontSize="6.5" fill="rgba(255,255,255,0.55)" letterSpacing="0.06em">{led.label}</text>
            </g>
          ))}
        </g>

        {/* LAN port row — kept well inside the body so it never overlaps with
            siblings on the page. */}
        <g transform={`translate(${bodyX + 15} ${bodyY + bodyH - 28})`}>
          {Array.from({ length: portCount }).map((_, i) => {
            const lit = allOnline && i < 3;
            const x = i * (portW + portGap);
            return (
              <g key={i} transform={`translate(${x} 0)`}>
                <rect x={0} y={0} width={portW} height={11} rx={1.5}
                  fill="rgba(0,0,0,0.35)"
                  stroke={lit ? okColor : 'rgba(255,255,255,0.22)'}
                  strokeWidth={1}
                />
                <circle cx={portW / 2} cy={-4} r={1.4} fill={lit ? okColor : offColor} />
              </g>
            );
          })}
          {/* "LAN" label underneath the port row, still inside the body */}
          <text x={0} y={20} fontSize="6.5" fill="rgba(255,255,255,0.45)" letterSpacing="0.08em">LAN PORTS</text>
        </g>
      </svg>

      {/* Caption under the illustration */}
      <div className="onb-caption">
        {step === 0 && 'Powering on · applying Basic Settings…'}
        {step === 1 && 'Configuration Options applied · publishing to fleet'}
      </div>

      {/* Badge strip — capability summary, framed with the device */}
      <div className="onb-badges">
        {model.badges.map((b) => (
          <span key={b} className="onb-cap-pill" style={{ borderColor: model.color, color: model.color }}>{b}</span>
        ))}
      </div>
    </div>
  );
}
