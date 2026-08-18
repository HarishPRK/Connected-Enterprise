import { isIP } from 'node:net';
import { InputError } from './ddb.js';

type ProfileRule =
  | { type: 'boolean' }
  | { type: 'number'; min: number; max: number; integer?: boolean }
  | { type: 'string'; maxLength: number; pattern?: RegExp }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'ipv4' }
  | { type: 'optional-ipv4' }
  | { type: 'hostname' }
  | { type: 'optional-hostname' }
  | { type: 'host-or-ipv4' }
  | { type: 'timezone' }
  | { type: 'secret-reference' };

export type UiProfileSchemaVersion = 1 | 2;

const V1_RULES: Record<string, ProfileRule> = {
  serviceOffering: { type: 'enum', values: ['ANIRA', 'AVTS', 'NETBOND', 'VPN_MANAGED'] },
  internetAccess: { type: 'boolean' },
  usbPortsEnabled: { type: 'boolean' },
  lanIpAddress: { type: 'ipv4' },
  lanPrefixLength: { type: 'number', min: 8, max: 30, integer: true },
  wanMtu: { type: 'number', min: 576, max: 9216, integer: true },
  lanEthernetSpeed: { type: 'enum', values: ['AUTO', '10_HALF', '10_FULL', '100_FULL', '1000_FULL', '10000_FULL'] },
  wanEthernetSpeed: { type: 'enum', values: ['AUTO', '10_HALF', '10_FULL', '100_FULL', '1000_FULL', '10000_FULL'] },
  defaultVlanPortsEnabled: { type: 'boolean' },
  vrrpEnabled: { type: 'boolean' },
  dnsTcpEnabled: { type: 'boolean' },
  dnsCacheEntries: { type: 'number', min: 0, max: 100_000, integer: true },
  reversePathFilter: { type: 'enum', values: ['STRICT', 'LOOSE', 'DISABLED'] },
  tcpTimestampsEnabled: { type: 'boolean' },
  firewallMemoryMb: { type: 'number', min: 256, max: 32_768, integer: true },
  cryptoBufferCount: { type: 'number', min: 64, max: 8192, integer: true },
  directedBroadcastEnabled: { type: 'boolean' },
  vpnCredentialRef: { type: 'secret-reference' },
  wireGuardKeyRef: { type: 'secret-reference' },
  natTraversalEnabled: { type: 'boolean' },
  natKeepaliveSeconds: { type: 'number', min: 5, max: 300, integer: true },
  tunnelReconnectSeconds: { type: 'number', min: 1, max: 900, integer: true },
  maxInboundTunnels: { type: 'number', min: 0, max: 1000, integer: true },
  cellularBackupEnabled: { type: 'boolean' },
  cellularRefreshMinutes: { type: 'number', min: 1, max: 1440, integer: true },
  failbackHoldSeconds: { type: 'number', min: 0, max: 3600, integer: true },
  timezone: { type: 'string', maxLength: 64, pattern: /^[A-Za-z_]+\/[A-Za-z0-9_+/-]+$/ },
  daylightSavingEnabled: { type: 'boolean' },
  language: { type: 'enum', values: ['en-US', 'en-GB', 'fr-FR', 'de-DE'] },
  configurationWatchdogSeconds: { type: 'number', min: 30, max: 1800, integer: true },
  healthCheckIntervalSeconds: { type: 'number', min: 10, max: 900, integer: true },
  rollbackOnManagementLoss: { type: 'boolean' },
  autoRebootAfterApply: { type: 'boolean' },
};

const V2_RULES: Record<string, ProfileRule> = {
  ...V1_RULES,
  lanMtu: { type: 'number', min: 576, max: 9216, integer: true },
  dhcpServerEnabled: { type: 'boolean' },
  dhcpPoolStart: { type: 'optional-ipv4' },
  dhcpPoolEnd: { type: 'optional-ipv4' },
  dhcpLeaseSeconds: { type: 'number', min: 60, max: 2_592_000, integer: true },
  wanMode: { type: 'enum', values: ['DHCP', 'STATIC'] },
  wanStaticIpAddress: { type: 'optional-ipv4' },
  wanStaticPrefixLength: { type: 'number', min: 1, max: 30, integer: true },
  wanStaticGateway: { type: 'optional-ipv4' },
  wanVlanId: { type: 'number', min: 0, max: 4094, integer: true },
  dnsMode: { type: 'enum', values: ['WAN_DHCP', 'STATIC'] },
  dnsPrimaryServer: { type: 'optional-ipv4' },
  dnsSecondaryServer: { type: 'optional-ipv4' },
  dnsSearchDomain: { type: 'optional-hostname' },
  dnsCacheEnabled: { type: 'boolean' },
  ntpPrimaryServer: { type: 'host-or-ipv4' },
  ntpSecondaryServer: { type: 'host-or-ipv4' },
  ipv4ForwardingEnabled: { type: 'boolean' },
  natMode: { type: 'enum', values: ['MASQUERADE', 'DISABLED'] },
  defaultRouteMetric: { type: 'number', min: 0, max: 65_535, integer: true },
  timezone: { type: 'timezone' },
};

const V2_REQUIRED_KEYS = [
  'lanIpAddress',
  'lanPrefixLength',
  'lanMtu',
  'wanMtu',
  'dhcpServerEnabled',
  'wanMode',
  'wanVlanId',
  'dnsMode',
  'dnsCacheEnabled',
  'timezone',
  'ntpPrimaryServer',
  'ntpSecondaryServer',
  'ipv4ForwardingEnabled',
  'natMode',
  'defaultRouteMetric',
] as const;

export function uiProfileSchemaVersion(value: unknown): UiProfileSchemaVersion {
  if (value === undefined) return 1;
  if (value === 1 || value === 2) return value;
  throw new InputError('schemaVersion must be the integer 1 or 2');
}

export function validateUiProfileParameters(
  value: unknown,
  schemaVersion: UiProfileSchemaVersion = 1,
): Record<string, string | number | boolean> {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new InputError('parameters must be a JSON object');
  const parameters = value as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(parameters), 'utf8') > 64 * 1024) throw new InputError('parameters must not exceed 64 KiB');
  const rules = schemaVersion === 2 ? V2_RULES : V1_RULES;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, child] of Object.entries(parameters)) {
    const rule = Object.hasOwn(rules, key) ? rules[key] : undefined;
    if (!rule) throw new InputError(`parameters.${key} is not part of profile schema v${schemaVersion}`);
    const invalid = (message: string): never => { throw new InputError(`parameters.${key} ${message}`); };
    switch (rule.type) {
      case 'boolean':
        if (typeof child !== 'boolean') invalid('must be true or false');
        break;
      case 'number':
        if (typeof child !== 'number') invalid('must be a finite number');
        if (!Number.isFinite(child)) invalid('must be a finite number');
        if ((child as number) < rule.min || (child as number) > rule.max) invalid(`must be between ${rule.min} and ${rule.max}`);
        if (rule.integer && !Number.isInteger(child as number)) invalid('must be a whole number');
        break;
      case 'string':
        if (typeof child !== 'string') invalid(`must be a string no longer than ${rule.maxLength} characters`);
        if ((child as string).length > rule.maxLength) invalid(`must be a string no longer than ${rule.maxLength} characters`);
        if (rule.pattern && !rule.pattern.test(child as string)) invalid('has an invalid format');
        break;
      case 'enum':
        if (typeof child !== 'string' || !rule.values.includes(child)) invalid(`must be one of: ${rule.values.join(', ')}`);
        break;
      case 'ipv4':
        if (typeof child !== 'string' || isIP(child) !== 4) invalid('must be a valid IPv4 address');
        break;
      case 'optional-ipv4':
        if (typeof child !== 'string' || (child !== '' && isIP(child) !== 4)) invalid('must be empty or a valid IPv4 address');
        break;
      case 'hostname':
        if (typeof child !== 'string' || !isStrictHostname(child)) invalid('must be a valid ASCII hostname');
        break;
      case 'optional-hostname':
        if (typeof child !== 'string' || (child !== '' && !isStrictHostname(child))) invalid('must be empty or a valid ASCII hostname');
        break;
      case 'host-or-ipv4':
        if (typeof child !== 'string' || (isIP(child) !== 4 && !isStrictHostname(child))) {
          invalid('must be a valid IPv4 address or ASCII hostname');
        }
        break;
      case 'timezone':
        if (typeof child !== 'string' || !isIanaTimezone(child)) invalid('must be a valid IANA time zone');
        break;
      case 'secret-reference':
        if (typeof child !== 'string' || (child !== '' && !/^(secretsmanager:\/\/|arn:aws[a-z-]*:secretsmanager:)/.test(child))) {
          invalid('must be empty or an AWS Secrets Manager reference');
        }
        break;
    }
    result[key] = child as string | number | boolean;
  }
  if (schemaVersion === 2) validateV2CrossFields(result);
  return result;
}

function validateV2CrossFields(parameters: Record<string, string | number | boolean>): void {
  for (const key of V2_REQUIRED_KEYS) {
    if (!Object.hasOwn(parameters, key)) throw new InputError(`parameters.${key} is required by profile schema v2`);
  }

  const lanAddress = requiredParameterString(parameters, 'lanIpAddress');
  const lanPrefix = requiredParameterNumber(parameters, 'lanPrefixLength');
  assertSafeHostAddress(lanAddress, lanPrefix, 'lanIpAddress');

  const dhcpEnabled = requiredParameterBoolean(parameters, 'dhcpServerEnabled');
  const dhcpKeys = ['dhcpPoolStart', 'dhcpPoolEnd', 'dhcpLeaseSeconds'] as const;
  if (dhcpEnabled) {
    for (const key of dhcpKeys) {
      if (!Object.hasOwn(parameters, key)) throw new InputError(`parameters.${key} is required when DHCP is enabled`);
    }
    const poolStart = requiredParameterString(parameters, 'dhcpPoolStart');
    const poolEnd = requiredParameterString(parameters, 'dhcpPoolEnd');
    assertSafeHostAddress(poolStart, lanPrefix, 'dhcpPoolStart');
    assertSafeHostAddress(poolEnd, lanPrefix, 'dhcpPoolEnd');
    const lanRange = ipv4Range(lanAddress, lanPrefix);
    const start = ipv4ToInteger(poolStart);
    const end = ipv4ToInteger(poolEnd);
    const gateway = ipv4ToInteger(lanAddress);
    if (start > end) throw new InputError('parameters.dhcpPoolStart must not be greater than parameters.dhcpPoolEnd');
    if (start <= lanRange.network || end >= lanRange.broadcast) {
      throw new InputError('DHCP pool must be entirely inside the usable LAN subnet');
    }
    if (gateway >= start && gateway <= end) throw new InputError('DHCP pool must not include the LAN gateway address');
  }

  const wanMode = requiredParameterString(parameters, 'wanMode');
  const staticWanKeys = ['wanStaticIpAddress', 'wanStaticPrefixLength', 'wanStaticGateway'] as const;
  if (wanMode === 'STATIC') {
    for (const key of staticWanKeys) {
      if (!Object.hasOwn(parameters, key)) throw new InputError(`parameters.${key} is required when parameters.wanMode is STATIC`);
    }
    const wanAddress = requiredParameterString(parameters, 'wanStaticIpAddress');
    const wanPrefix = requiredParameterNumber(parameters, 'wanStaticPrefixLength');
    const wanGateway = requiredParameterString(parameters, 'wanStaticGateway');
    assertSafeHostAddress(wanAddress, wanPrefix, 'wanStaticIpAddress');
    assertSafeHostAddress(wanGateway, wanPrefix, 'wanStaticGateway');
    const wanRange = ipv4Range(wanAddress, wanPrefix);
    const gateway = ipv4ToInteger(wanGateway);
    if (gateway <= wanRange.network || gateway >= wanRange.broadcast) {
      throw new InputError('parameters.wanStaticGateway must be inside the usable static WAN subnet');
    }
    if (wanGateway === wanAddress) throw new InputError('parameters.wanStaticGateway must differ from parameters.wanStaticIpAddress');
    const lanRange = ipv4Range(lanAddress, lanPrefix);
    if (rangesOverlap(lanRange, wanRange)) throw new InputError('LAN and static WAN subnets must not overlap');
  } else {
    if (hasNonEmptyString(parameters, 'wanStaticIpAddress') || hasNonEmptyString(parameters, 'wanStaticGateway')) {
      throw new InputError('Static WAN addresses must be empty or omitted when parameters.wanMode is DHCP');
    }
  }

  const dnsMode = requiredParameterString(parameters, 'dnsMode');
  const staticDnsKeys = ['dnsPrimaryServer', 'dnsSecondaryServer'] as const;
  if (dnsMode === 'WAN_DHCP') {
    if (wanMode !== 'DHCP') throw new InputError('parameters.dnsMode WAN_DHCP requires parameters.wanMode DHCP');
    if (staticDnsKeys.some((key) => hasNonEmptyString(parameters, key))) {
      throw new InputError('Static DNS server fields must be empty or omitted when parameters.dnsMode is WAN_DHCP');
    }
  } else {
    if (!Object.hasOwn(parameters, 'dnsPrimaryServer')) {
      throw new InputError('parameters.dnsPrimaryServer is required when parameters.dnsMode is STATIC');
    }
    const primary = requiredParameterString(parameters, 'dnsPrimaryServer');
    assertSafeUnicastAddress(primary, 'dnsPrimaryServer');
    if (hasNonEmptyString(parameters, 'dnsSecondaryServer')) {
      const secondary = requiredParameterString(parameters, 'dnsSecondaryServer');
      assertSafeUnicastAddress(secondary, 'dnsSecondaryServer');
      if (secondary === primary) throw new InputError('Primary and secondary DNS servers must be different');
    }
  }

  const ntpPrimary = requiredParameterString(parameters, 'ntpPrimaryServer');
  const ntpSecondary = requiredParameterString(parameters, 'ntpSecondaryServer');
  assertSafeHostOrIpv4(ntpPrimary, 'ntpPrimaryServer');
  assertSafeHostOrIpv4(ntpSecondary, 'ntpSecondaryServer');
  if (ntpPrimary.toLowerCase() === ntpSecondary.toLowerCase()) {
    throw new InputError('Primary and secondary NTP servers must be different');
  }

  if (parameters.natMode === 'MASQUERADE' && parameters.ipv4ForwardingEnabled !== true) {
    throw new InputError('parameters.ipv4ForwardingEnabled must be true when parameters.natMode is MASQUERADE');
  }
}

function hasNonEmptyString(parameters: Record<string, string | number | boolean>, key: string): boolean {
  return typeof parameters[key] === 'string' && parameters[key] !== '';
}

function requiredParameterString(
  parameters: Record<string, string | number | boolean>,
  key: string,
): string {
  const value = parameters[key];
  if (typeof value !== 'string') throw new InputError(`parameters.${key} must be a string`);
  return value;
}

function requiredParameterNumber(
  parameters: Record<string, string | number | boolean>,
  key: string,
): number {
  const value = parameters[key];
  if (typeof value !== 'number') throw new InputError(`parameters.${key} must be a number`);
  return value;
}

function requiredParameterBoolean(
  parameters: Record<string, string | number | boolean>,
  key: string,
): boolean {
  const value = parameters[key];
  if (typeof value !== 'boolean') throw new InputError(`parameters.${key} must be true or false`);
  return value;
}

function assertSafeHostOrIpv4(value: string, key: string): void {
  if (isIP(value) === 4) {
    assertSafeUnicastAddress(value, key);
    return;
  }
  if (!isStrictHostname(value)) throw new InputError(`parameters.${key} must be a safe IPv4 address or ASCII hostname`);
}

function assertSafeHostAddress(value: string, prefixLength: number, key: string): void {
  assertSafeUnicastAddress(value, key);
  const range = ipv4Range(value, prefixLength);
  const address = ipv4ToInteger(value);
  if (address === range.network || address === range.broadcast) {
    throw new InputError(`parameters.${key} must be a usable host address for its subnet`);
  }
}

function assertSafeUnicastAddress(value: string, key: string): void {
  if (isIP(value) !== 4) throw new InputError(`parameters.${key} must be a valid IPv4 address`);
  const [first = -1, second = -1] = value.split('.').map(Number);
  if (first === 0
    || first === 127
    || first >= 224
    || (first === 169 && second === 254)
    || value === '255.255.255.255') {
    throw new InputError(`parameters.${key} must be a safe unicast IPv4 address`);
  }
}

function isStrictHostname(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 253 || value.endsWith('.')) return false;
  const labels = value.split('.');
  if (labels.some((label) => label.length < 1
    || label.length > 63
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))) return false;
  return !/^\d+$/.test(value.replaceAll('.', ''));
}

function isIanaTimezone(value: unknown): value is string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 64
    || (value !== 'UTC' && !/^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)+$/.test(value))) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function ipv4ToInteger(value: string): number {
  return value.split('.').reduce((result, octet) => ((result << 8) | Number(octet)) >>> 0, 0);
}

function ipv4Range(value: string, prefixLength: number): { network: number; broadcast: number } {
  const mask = (0xffff_ffff << (32 - prefixLength)) >>> 0;
  const network = (ipv4ToInteger(value) & mask) >>> 0;
  return { network, broadcast: (network | (~mask >>> 0)) >>> 0 };
}

function rangesOverlap(
  left: { network: number; broadcast: number },
  right: { network: number; broadcast: number },
): boolean {
  return left.network <= right.broadcast && right.network <= left.broadcast;
}
