import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isIP } from 'node:net';
import type { OnboardingRepository } from './onboardingStore.js';
import type {
  AuditEvent,
  Gateway,
  GatewayModel,
  IdempotencyRecord,
  ManufacturingRecord,
  OnboardingDatabase,
  OnboardingOperation,
  OnboardingSnapshot,
  OnboardingState,
  OperatorContext,
  OutboxEvent,
  ProfileVersion,
  Site,
  TenantState,
  VerificationResult,
} from './onboardingTypes.js';

const GATEWAY_MODELS: GatewayModel[] = [
  {
    id: 'edge-pro',
    name: 'Connected Edge Pro',
    vendor: 'Connected Enterprise',
    description: 'High-throughput branch gateway with dual-WAN and secure-element support.',
  },
  {
    id: 'edge-compact',
    name: 'Connected Edge Compact',
    vendor: 'Connected Enterprise',
    description: 'Compact gateway for retail and small branch deployments.',
  },
];

const ONBOARD_STEPS: ReadonlyArray<{ state: OnboardingState; detail: string }> = [
  { state: 'CLAIM_ACCEPTED', detail: 'Factory serial registration authorized.' },
  { state: 'CSR_VERIFIED', detail: 'Gateway certificate request accepted.' },
  { state: 'OPERATIONAL_IDENTITY_ISSUED', detail: 'Unique operational identity activated.' },
  { state: 'PROFILE_STAGED', detail: 'Signed immutable profile staged for this gateway.' },
  { state: 'APPLYING', detail: 'Gateway is applying the configuration transaction.' },
  { state: 'HEALTH_CHECK', detail: 'Post-apply connectivity and service checks are running.' },
  { state: 'APPLIED_HEALTHY', detail: 'Gateway acknowledged the applied profile and is healthy.' },
];

const DECOMMISSION_STEPS: ReadonlyArray<{ state: OnboardingState; detail: string }> = [
  { state: 'DECOMMISSIONING', detail: 'Decommission request accepted.' },
  { state: 'CERTIFICATE_DEACTIVATED', detail: 'Operational certificate deactivated.' },
  { state: 'MQTT_SESSION_CLEARED', detail: 'Active and persistent MQTT sessions cleared.' },
  { state: 'DECOMMISSIONED', detail: 'Gateway retired; audit history retained.' },
];

const PROFILE_DEPLOY_STEPS: ReadonlyArray<{ state: OnboardingState; detail: string }> = [
  { state: 'PROFILE_STAGED', detail: 'Signed immutable profile assignment queued.' },
  { state: 'APPLYING', detail: 'Gateway is applying the candidate configuration transactionally.' },
  { state: 'HEALTH_CHECK', detail: 'Gateway is validating management connectivity and network services.' },
  { state: 'APPLIED_HEALTHY', detail: 'Gateway acknowledged the exact profile version and passed health checks.' },
];

const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9._-]{2,127}$/;

export class OnboardingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OnboardingError';
  }
}

interface OnboardingServiceOptions {
  repository: OnboardingRepository;
  now?: () => Date;
  transitionMs?: number;
  simulateDevice?: boolean;
  mode?: 'local-simulator' | 'aws';
}

interface ProfileInput {
  name: string;
  description?: string;
  modelId: string;
  baseProfileVersionId?: string;
  schemaVersion?: number;
  parameters: Record<string, unknown>;
  changeNote: string;
}

interface DeviceStatusInput {
  thingName: string;
  deploymentGeneration: number;
  status: 'APPLIED_HEALTHY' | 'APPLY_FAILED' | 'HEALTH_DEGRADED';
  reason?: string;
}

interface ServiceEvent {
  tenantId: string;
  type: string;
  aggregateId: string;
}

type ProfileRule =
  | { type: 'boolean' }
  | { type: 'number'; min: number; max: number; integer?: boolean }
  | { type: 'string'; maxLength: number; pattern?: RegExp }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'ipv4' }
  | { type: 'ipv4-or-empty' }
  | { type: 'host-or-ipv4' }
  | { type: 'optional-hostname' }
  | { type: 'timezone' }
  | { type: 'secret-reference' };

type ProfileSchemaVersion = 1 | 2;

const PROFILE_PARAMETER_RULES_V1: Record<string, ProfileRule> = {
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

const PROFILE_PARAMETER_RULES_V2: Record<string, ProfileRule> = {
  ...PROFILE_PARAMETER_RULES_V1,
  lanMtu: { type: 'number', min: 576, max: 9216, integer: true },
  dhcpServerEnabled: { type: 'boolean' },
  dhcpPoolStart: { type: 'ipv4-or-empty' },
  dhcpPoolEnd: { type: 'ipv4-or-empty' },
  dhcpLeaseSeconds: { type: 'number', min: 60, max: 2_592_000, integer: true },
  wanMode: { type: 'enum', values: ['DHCP', 'STATIC'] },
  wanStaticIpAddress: { type: 'ipv4-or-empty' },
  wanStaticPrefixLength: { type: 'number', min: 1, max: 30, integer: true },
  wanStaticGateway: { type: 'ipv4-or-empty' },
  wanVlanId: { type: 'number', min: 0, max: 4094, integer: true },
  dnsMode: { type: 'enum', values: ['WAN_DHCP', 'STATIC'] },
  dnsPrimaryServer: { type: 'ipv4-or-empty' },
  dnsSecondaryServer: { type: 'ipv4-or-empty' },
  dnsSearchDomain: { type: 'optional-hostname' },
  dnsCacheEnabled: { type: 'boolean' },
  ntpPrimaryServer: { type: 'host-or-ipv4' },
  ntpSecondaryServer: { type: 'host-or-ipv4' },
  ipv4ForwardingEnabled: { type: 'boolean' },
  natMode: { type: 'enum', values: ['MASQUERADE', 'DISABLED'] },
  defaultRouteMetric: { type: 'number', min: 0, max: 65_535, integer: true },
  timezone: { type: 'timezone' },
};

const PROFILE_V2_REQUIRED_KEYS = [
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

const DEFAULT_PROFILE_PARAMETERS: Record<string, string | number | boolean> = {
  serviceOffering: 'ANIRA',
  internetAccess: true,
  usbPortsEnabled: false,
  lanIpAddress: '10.10.10.1',
  lanPrefixLength: 24,
  lanMtu: 1500,
  dhcpServerEnabled: true,
  dhcpPoolStart: '10.10.10.100',
  dhcpPoolEnd: '10.10.10.199',
  dhcpLeaseSeconds: 86_400,
  wanMode: 'DHCP',
  wanStaticIpAddress: '',
  wanStaticPrefixLength: 24,
  wanStaticGateway: '',
  wanVlanId: 0,
  wanMtu: 1500,
  lanEthernetSpeed: 'AUTO',
  wanEthernetSpeed: 'AUTO',
  defaultVlanPortsEnabled: true,
  vrrpEnabled: false,
  dnsTcpEnabled: true,
  dnsCacheEntries: 1000,
  dnsMode: 'WAN_DHCP',
  dnsPrimaryServer: '',
  dnsSecondaryServer: '',
  dnsSearchDomain: '',
  dnsCacheEnabled: true,
  ntpPrimaryServer: 'time.cloudflare.com',
  ntpSecondaryServer: 'time.google.com',
  reversePathFilter: 'STRICT',
  tcpTimestampsEnabled: true,
  firewallMemoryMb: 8192,
  cryptoBufferCount: 512,
  directedBroadcastEnabled: false,
  vpnCredentialRef: '',
  wireGuardKeyRef: '',
  natTraversalEnabled: true,
  ipv4ForwardingEnabled: true,
  natMode: 'MASQUERADE',
  defaultRouteMetric: 100,
  natKeepaliveSeconds: 20,
  tunnelReconnectSeconds: 30,
  maxInboundTunnels: 10,
  cellularBackupEnabled: true,
  cellularRefreshMinutes: 15,
  failbackHoldSeconds: 120,
  timezone: 'America/Chicago',
  daylightSavingEnabled: true,
  language: 'en-US',
  configurationWatchdogSeconds: 180,
  healthCheckIntervalSeconds: 30,
  rollbackOnManagementLoss: true,
  autoRebootAfterApply: false,
};

const defaultDatabase = (): OnboardingDatabase => ({
  schemaVersion: 1,
  tenants: {},
  idempotency: {},
});

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function iso(date: Date): string {
  return date.toISOString();
}

function addMilliseconds(value: Date | string, milliseconds: number): string {
  return new Date(new Date(value).getTime() + milliseconds).toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function newAudit(
  tenantId: string,
  actorId: string,
  action: string,
  targetType: AuditEvent['targetType'],
  targetId: string,
  result: AuditEvent['result'],
  at: string,
  reason?: string,
): AuditEvent {
  return {
    id: `audit_${randomUUID()}`,
    tenantId,
    actorId,
    action,
    targetType,
    targetId,
    result,
    requestId: randomUUID(),
    at,
    reason,
  };
}

function newOutbox(
  tenantId: string,
  type: string,
  aggregateId: string,
  at: string,
  payload: Record<string, unknown>,
  generation?: number,
): OutboxEvent {
  return {
    id: `event_${randomUUID()}`,
    tenantId,
    type,
    aggregateId,
    generation,
    payload,
    createdAt: at,
  };
}

function assertIdempotencyKey(value: string): void {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new OnboardingError(
      428,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Send a unique Idempotency-Key (8–128 safe characters) and retry.',
    );
  }
}

function assertProfileSchemaVersion(value: unknown): ProfileSchemaVersion {
  if (value === undefined) return 1;
  if (value !== 1 && value !== 2) {
    throw new OnboardingError(400, 'INVALID_PROFILE_SCHEMA', 'schemaVersion must be 1 or 2.');
  }
  return value;
}

function assertProfileV2Relationships(parameters: Record<string, unknown>): void {
  const invalid = (key: string, message: string): never => {
    throw new OnboardingError(400, 'INVALID_PROFILE_PARAMETER', `parameters.${key} ${message}`);
  };

  for (const key of PROFILE_V2_REQUIRED_KEYS) {
    if (!Object.hasOwn(parameters, key)) invalid(key, 'is required by profile schema v2.');
  }

  const lanAddress = parameters.lanIpAddress as string;
  const lanPrefix = parameters.lanPrefixLength as number;
  assertSafeHostAddress(lanAddress, lanPrefix, 'lanIpAddress', invalid);

  if (parameters.dhcpServerEnabled === true) {
    for (const key of ['dhcpPoolStart', 'dhcpPoolEnd', 'dhcpLeaseSeconds'] as const) {
      if (!Object.hasOwn(parameters, key)) invalid(key, 'is required when DHCP is enabled.');
    }
    const poolStart = parameters.dhcpPoolStart as string;
    const poolEnd = parameters.dhcpPoolEnd as string;
    assertSafeHostAddress(poolStart, lanPrefix, 'dhcpPoolStart', invalid);
    assertSafeHostAddress(poolEnd, lanPrefix, 'dhcpPoolEnd', invalid);
    const lanRange = ipv4Range(lanAddress, lanPrefix);
    const start = ipv4ToInteger(poolStart);
    const end = ipv4ToInteger(poolEnd);
    const gateway = ipv4ToInteger(lanAddress);
    if (start > end) invalid('dhcpPoolStart', 'must not be greater than parameters.dhcpPoolEnd.');
    if (start <= lanRange.network || end >= lanRange.broadcast) {
      invalid('dhcpPoolStart', 'and parameters.dhcpPoolEnd must be entirely inside the usable LAN subnet.');
    }
    if (gateway >= start && gateway <= end) {
      invalid('dhcpPoolStart', 'and parameters.dhcpPoolEnd must not include the LAN gateway address.');
    }
  }

  const wanMode = parameters.wanMode as string;
  if (wanMode === 'STATIC') {
    for (const key of ['wanStaticIpAddress', 'wanStaticPrefixLength', 'wanStaticGateway'] as const) {
      if (!Object.hasOwn(parameters, key)) invalid(key, 'is required when parameters.wanMode is STATIC.');
    }
    const wanAddress = parameters.wanStaticIpAddress as string;
    const wanPrefix = parameters.wanStaticPrefixLength as number;
    const wanGateway = parameters.wanStaticGateway as string;
    assertSafeHostAddress(wanAddress, wanPrefix, 'wanStaticIpAddress', invalid);
    assertSafeHostAddress(wanGateway, wanPrefix, 'wanStaticGateway', invalid);
    const wanRange = ipv4Range(wanAddress, wanPrefix);
    const gateway = ipv4ToInteger(wanGateway);
    if (gateway <= wanRange.network || gateway >= wanRange.broadcast) {
      invalid('wanStaticGateway', 'must be inside the usable static WAN subnet.');
    }
    if (wanGateway === wanAddress) invalid('wanStaticGateway', 'must differ from parameters.wanStaticIpAddress.');
    if (rangesOverlap(ipv4Range(lanAddress, lanPrefix), wanRange)) {
      invalid('wanStaticIpAddress', 'must not use a subnet that overlaps the LAN subnet.');
    }
  } else if (hasNonEmptyString(parameters, 'wanStaticIpAddress') || hasNonEmptyString(parameters, 'wanStaticGateway')) {
    invalid('wanStaticIpAddress', 'and parameters.wanStaticGateway must be empty or omitted when parameters.wanMode is DHCP.');
  }

  const dnsMode = parameters.dnsMode as string;
  if (dnsMode === 'WAN_DHCP') {
    if (wanMode !== 'DHCP') invalid('dnsMode', 'WAN_DHCP requires parameters.wanMode DHCP.');
    if (hasNonEmptyString(parameters, 'dnsPrimaryServer') || hasNonEmptyString(parameters, 'dnsSecondaryServer')) {
      invalid('dnsPrimaryServer', 'and parameters.dnsSecondaryServer must be empty or omitted when parameters.dnsMode is WAN_DHCP.');
    }
  } else {
    if (!Object.hasOwn(parameters, 'dnsPrimaryServer')) invalid('dnsPrimaryServer', 'is required when parameters.dnsMode is STATIC.');
    const primary = parameters.dnsPrimaryServer as string;
    assertSafeUnicastAddress(primary, 'dnsPrimaryServer', invalid);
    if (hasNonEmptyString(parameters, 'dnsSecondaryServer')) {
      const secondary = parameters.dnsSecondaryServer as string;
      assertSafeUnicastAddress(secondary, 'dnsSecondaryServer', invalid);
      if (secondary === primary) invalid('dnsSecondaryServer', 'must differ from parameters.dnsPrimaryServer.');
    }
  }

  const ntpPrimary = parameters.ntpPrimaryServer as string;
  const ntpSecondary = parameters.ntpSecondaryServer as string;
  assertSafeHostOrIpv4(ntpPrimary, 'ntpPrimaryServer', invalid);
  assertSafeHostOrIpv4(ntpSecondary, 'ntpSecondaryServer', invalid);
  if (ntpPrimary.toLowerCase() === ntpSecondary.toLowerCase()) {
    invalid('ntpSecondaryServer', 'must differ from parameters.ntpPrimaryServer.');
  }

  if (parameters.natMode === 'MASQUERADE' && parameters.ipv4ForwardingEnabled !== true) {
    invalid('ipv4ForwardingEnabled', 'must be true when parameters.natMode is MASQUERADE.');
  }
}

function hasNonEmptyString(parameters: Record<string, unknown>, key: string): boolean {
  return typeof parameters[key] === 'string' && parameters[key] !== '';
}

function assertSafeHostOrIpv4(
  value: string,
  key: string,
  invalid: (key: string, message: string) => never,
): void {
  if (isIP(value) === 4) {
    assertSafeUnicastAddress(value, key, invalid);
    return;
  }
  if (!isStrictHostname(value)) invalid(key, 'must be a safe IPv4 address or ASCII hostname.');
}

function assertSafeHostAddress(
  value: string,
  prefixLength: number,
  key: string,
  invalid: (key: string, message: string) => never,
): void {
  assertSafeUnicastAddress(value, key, invalid);
  const range = ipv4Range(value, prefixLength);
  const address = ipv4ToInteger(value);
  if (address === range.network || address === range.broadcast) {
    invalid(key, 'must be a usable host address for its subnet.');
  }
}

function assertSafeUnicastAddress(
  value: string,
  key: string,
  invalid: (key: string, message: string) => never,
): void {
  if (isIP(value) !== 4) invalid(key, 'must be a valid IPv4 address.');
  const [first = -1, second = -1] = value.split('.').map(Number);
  if (first === 0
    || first === 127
    || first >= 224
    || (first === 169 && second === 254)
    || value === '255.255.255.255') {
    invalid(key, 'must be a safe unicast IPv4 address.');
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

function assertProfileParameters(
  parameters: unknown,
  schemaVersion: ProfileSchemaVersion,
): asserts parameters is Record<string, unknown> {
  if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object') {
    throw new OnboardingError(400, 'INVALID_PROFILE', 'Profile parameters must be a JSON object.');
  }
  const serialized = JSON.stringify(parameters);
  if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) {
    throw new OnboardingError(413, 'PROFILE_TOO_LARGE', 'Profile parameters must be 64 KiB or smaller.');
  }

  const visit = (value: unknown, path: string, inSecretRefs = false): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, inSecretRefs));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nestedPath = path ? `${path}.${key}` : key;
      if (key === 'secretRefs') {
        if (!nested || Array.isArray(nested) || typeof nested !== 'object') {
          throw new OnboardingError(400, 'INVALID_SECRET_REFERENCE', `${nestedPath} must be an object of secret references.`);
        }
        visit(nested, nestedPath, true);
        continue;
      }
      const isReferenceField = /ref$/i.test(key)
        && typeof nested === 'string'
        && (nested === '' || /^(secretsmanager:\/\/|arn:aws:secretsmanager:)/.test(nested));
      if (!inSecretRefs && !isReferenceField && /(password|passphrase|private.?key|pre.?shared|(^|_)psk($|_)|credential|bearer|token|secret)/i.test(key)) {
        throw new OnboardingError(
          400,
          'RAW_SECRET_FORBIDDEN',
          `${nestedPath} looks like secret material. Store it in Secrets Manager and use secretRefs instead.`,
        );
      }
      if (inSecretRefs) {
        if (typeof nested !== 'string' || !/^(secretsmanager:\/\/|arn:aws:secretsmanager:)/.test(nested)) {
          throw new OnboardingError(
            400,
            'INVALID_SECRET_REFERENCE',
            `${nestedPath} must reference AWS Secrets Manager; raw secret values are not accepted.`,
          );
        }
        continue;
      }
      visit(nested, nestedPath, false);
    }
  };

  visit(parameters, 'parameters');

  const rules = schemaVersion === 2 ? PROFILE_PARAMETER_RULES_V2 : PROFILE_PARAMETER_RULES_V1;
  for (const [key, value] of Object.entries(parameters)) {
    const rule = Object.hasOwn(rules, key) ? rules[key] : undefined;
    if (!rule) {
      throw new OnboardingError(
        400,
        'UNKNOWN_PROFILE_PARAMETER',
        `parameters.${key} is not part of profile schema v${schemaVersion}.`,
      );
    }
    const invalid = (message: string): never => {
      throw new OnboardingError(400, 'INVALID_PROFILE_PARAMETER', `parameters.${key} ${message}`);
    };
    switch (rule.type) {
      case 'boolean':
        if (typeof value !== 'boolean') invalid('must be true or false.');
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) invalid('must be a finite number.');
        if (value < rule.min || value > rule.max) invalid(`must be between ${rule.min} and ${rule.max}.`);
        if (rule.integer && !Number.isInteger(value)) invalid('must be a whole number.');
        break;
      case 'string':
        if (typeof value !== 'string' || value.length > rule.maxLength) invalid(`must be a string no longer than ${rule.maxLength} characters.`);
        if (rule.pattern && !rule.pattern.test(value)) invalid('has an invalid format.');
        break;
      case 'enum':
        if (typeof value !== 'string' || !rule.values.includes(value)) invalid(`must be one of: ${rule.values.join(', ')}.`);
        break;
      case 'ipv4':
        if (typeof value !== 'string' || isIP(value) !== 4) invalid('must be a valid IPv4 address.');
        break;
      case 'ipv4-or-empty':
        if (typeof value !== 'string' || (value !== '' && isIP(value) !== 4)) invalid('must be empty or a valid IPv4 address.');
        break;
      case 'host-or-ipv4':
        if (typeof value !== 'string' || (isIP(value) !== 4 && !isStrictHostname(value))) {
          invalid('must be a valid IPv4 address or ASCII hostname.');
        }
        break;
      case 'optional-hostname':
        if (typeof value !== 'string' || (value !== '' && !isStrictHostname(value))) {
          invalid('must be empty or a valid ASCII hostname.');
        }
        break;
      case 'timezone':
        if (typeof value !== 'string' || !isIanaTimezone(value)) invalid('must be a valid IANA time zone.');
        break;
      case 'secret-reference':
        if (typeof value !== 'string' || (value !== '' && !/^(secretsmanager:\/\/|arn:aws:secretsmanager:)/.test(value))) {
          invalid('must be empty or an AWS Secrets Manager reference.');
        }
        break;
    }
  }

  if (schemaVersion === 2) assertProfileV2Relationships(parameters as Record<string, unknown>);
}

export class OnboardingService {
  private database: OnboardingDatabase;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly events = new EventEmitter();
  private readonly now: () => Date;
  private readonly transitionMs: number;
  private readonly simulateDevice: boolean;
  private readonly mode: 'local-simulator' | 'aws';

  private constructor(
    private readonly repository: OnboardingRepository,
    database: OnboardingDatabase,
    options: Omit<OnboardingServiceOptions, 'repository'>,
  ) {
    this.database = database;
    this.now = options.now ?? (() => new Date());
    this.transitionMs = Math.max(50, options.transitionMs ?? 900);
    this.simulateDevice = options.simulateDevice ?? true;
    this.mode = options.mode ?? 'local-simulator';
    this.events.setMaxListeners(100);
  }

  static async create(options: OnboardingServiceOptions): Promise<OnboardingService> {
    const database = (await options.repository.load()) ?? defaultDatabase();
    return new OnboardingService(options.repository, database, options);
  }

  subscribe(listener: (event: ServiceEvent) => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  async getSnapshot(context: OperatorContext): Promise<OnboardingSnapshot> {
    const snapshot = await this.transaction((database) => {
      const tenant = this.ensureTenant(database, context.tenantId);
      this.reconcileTenant(tenant, this.now());
      return this.snapshotForTenant(tenant);
    });
    return clone(snapshot);
  }

  async verifyClaim(
    context: OperatorContext,
    input: { serialNumber: string },
    idempotencyKey: string,
  ): Promise<VerificationResult> {
    assertIdempotencyKey(idempotencyKey);
    const serialNumber = String(input.serialNumber ?? '').trim().toUpperCase();
    if (!SERIAL_PATTERN.test(serialNumber)) {
      throw new OnboardingError(400, 'INVALID_CLAIM_INPUT', 'Enter a valid factory serial number.');
    }

    const request = { serialNumber };
    const outcome = await this.transaction((database) => {
      const tenant = this.ensureTenant(database, context.tenantId);
      const storageKey = `${context.tenantId}:verify-claim:${idempotencyKey}`;
      const requestHash = sha256(stableJson(request));
      const replay = database.idempotency[storageKey];
      if (replay) {
        if (replay.requestHash !== requestHash) {
          throw new OnboardingError(409, 'IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used for a different request.');
        }
        return { denied: false as const, value: clone(replay.response as VerificationResult) };
      }
      this.expireReservations(tenant, this.now());
      const record = tenant.manufacturing.find((candidate) => candidate.serialNumber === serialNumber);
      const valid = Boolean(
        record
          && record.tenantId === context.tenantId
          && record.state === 'CLAIMABLE',
      );

      if (!valid || !record) {
        tenant.audit.push(newAudit(
          context.tenantId,
          context.actorId,
          'CLAIM_VERIFY',
          'verification',
          sha256(serialNumber).slice(0, 16),
          'DENIED',
          iso(this.now()),
          'Factory serial is not registered, available, or authorized for this tenant.',
        ));
        return { denied: true as const };
      }

      return {
        denied: false as const,
        value: this.idempotent(database, context, 'verify-claim', idempotencyKey, request, () => {
          const createdAt = iso(this.now());
          const verificationId = `verify_${randomUUID()}`;
          const expiresAt = addMilliseconds(createdAt, 10 * 60 * 1000);
          tenant.verifications.push({
            id: verificationId,
            tenantId: context.tenantId,
            serialNumber,
            modelId: record.modelId,
            hardwareRevision: record.hardwareRevision,
            manufacturingBatch: record.manufacturingBatch,
            allowedSiteIds: [...record.allowedSiteIds],
            state: 'VERIFIED',
            createdAt,
            expiresAt,
          });
          record.state = 'RESERVED';
          record.reservedByVerificationId = verificationId;
          record.reservationExpiresAt = expiresAt;
          tenant.audit.push(newAudit(
            context.tenantId,
            context.actorId,
            'CLAIM_VERIFY',
            'verification',
            verificationId,
            'SUCCESS',
            createdAt,
          ));
          tenant.outbox.push(newOutbox(
            context.tenantId,
            'ClaimVerified',
            verificationId,
            createdAt,
            { serialNumberHash: sha256(serialNumber), modelId: record.modelId },
          ));
          return {
            verificationId,
            expiresAt,
            identity: {
              serialNumber,
              modelId: record.modelId,
              hardwareRevision: record.hardwareRevision,
              manufacturingBatch: record.manufacturingBatch,
            },
            allowedSites: tenant.sites.filter((site) => record.allowedSiteIds.includes(site.id)),
          } satisfies VerificationResult;
        }),
      };
    });

    if (outcome.denied) {
      throw new OnboardingError(
        401,
        'CLAIM_NOT_VERIFIED',
        'Registration is not authorized for this factory serial.',
      );
    }
    this.emit(context.tenantId, 'ClaimVerified', outcome.value.verificationId);
    return clone(outcome.value);
  }

  async createProfile(
    context: OperatorContext,
    input: ProfileInput,
    idempotencyKey: string,
  ): Promise<ProfileVersion> {
    assertIdempotencyKey(idempotencyKey);
    const name = String(input.name ?? '').trim();
    const description = String(input.description ?? '').trim();
    const modelId = String(input.modelId ?? '').trim();
    const baseProfileVersionId = String(input.baseProfileVersionId ?? '').trim() || undefined;
    const changeNote = String(input.changeNote ?? '').trim();
    const schemaVersion = assertProfileSchemaVersion(input.schemaVersion);
    if (name.length < 3 || name.length > 80 || description.length > 500 || changeNote.length < 3 || changeNote.length > 300) {
      throw new OnboardingError(400, 'INVALID_PROFILE', 'Provide a profile name and a short, meaningful change note.');
    }
    if (!GATEWAY_MODELS.some((model) => model.id === modelId)) {
      throw new OnboardingError(400, 'UNSUPPORTED_MODEL', 'Choose a supported gateway model.');
    }
    assertProfileParameters(input.parameters, schemaVersion);

    const normalizedInput = {
      name,
      description,
      modelId,
      baseProfileVersionId,
      schemaVersion,
      parameters: stableValue(input.parameters) as Record<string, unknown>,
      changeNote,
    };
    const profile = await this.transaction((database) => {
      const tenant = this.ensureTenant(database, context.tenantId);
      return this.idempotent(database, context, 'create-profile', idempotencyKey, normalizedInput, () => {
        const baseProfile = baseProfileVersionId
          ? tenant.profiles.find((candidate) => candidate.id === baseProfileVersionId)
          : undefined;
        if (baseProfileVersionId && !baseProfile) {
          throw new OnboardingError(404, 'BASE_PROFILE_NOT_FOUND', 'The selected base profile version does not exist in this tenant.');
        }
        if (baseProfile && baseProfile.modelId !== modelId) {
          throw new OnboardingError(409, 'PROFILE_MODEL_MISMATCH', 'A profile lineage cannot change its compatible gateway model.');
        }
        const profileId = baseProfile?.profileId ?? `${slug(name)}-${modelId}`;
        const version = Math.max(
          0,
          ...tenant.profiles.filter((candidate) => candidate.profileId === profileId).map((candidate) => candidate.version),
        ) + 1;
        const createdAt = iso(this.now());
        const contentHash = sha256(stableJson({
          profileId,
          version,
          schemaVersion,
          modelId,
          parameters: normalizedInput.parameters,
        }));
        const value: ProfileVersion = {
          id: `${profileId}@${version}`,
          profileId,
          name,
          description,
          modelId,
          version,
          schemaVersion,
          parameters: normalizedInput.parameters,
          contentHash,
          immutable: true,
          createdAt,
          createdBy: context.actorId,
          changeNote,
        };
        tenant.profiles.push(value);
        tenant.audit.push(newAudit(context.tenantId, context.actorId, 'PROFILE_CREATE', 'profile', value.id, 'SUCCESS', createdAt));
        tenant.outbox.push(newOutbox(
          context.tenantId,
          'ProfileVersionCreated',
          value.id,
          createdAt,
          { profileId, version, schemaVersion, modelId, contentHash },
        ));
        return value;
      });
    });
    this.emit(context.tenantId, 'ProfileVersionCreated', profile.id);
    return clone(profile);
  }

  async startOnboarding(
    context: OperatorContext,
    input: { verificationId: string; siteId: string; profileVersionId: string },
    idempotencyKey: string,
  ): Promise<OnboardingOperation> {
    assertIdempotencyKey(idempotencyKey);
    const normalizedInput = {
      verificationId: String(input.verificationId ?? ''),
      siteId: String(input.siteId ?? ''),
      profileVersionId: String(input.profileVersionId ?? ''),
    };
    const operation = await this.transaction((database) => {
      const tenant = this.ensureTenant(database, context.tenantId);
      this.expireReservations(tenant, this.now());
      return this.idempotent(database, context, 'start-onboarding', idempotencyKey, normalizedInput, () => {
        const verification = tenant.verifications.find((candidate) => candidate.id === normalizedInput.verificationId);
        if (!verification || verification.tenantId !== context.tenantId) {
          throw new OnboardingError(404, 'VERIFICATION_NOT_FOUND', 'Verification not found or no longer available.');
        }
        if (verification.state !== 'VERIFIED' || new Date(verification.expiresAt) <= this.now()) {
          throw new OnboardingError(409, 'VERIFICATION_EXPIRED', 'Verification expired. Verify the gateway again.');
        }
        if (!verification.allowedSiteIds.includes(normalizedInput.siteId)) {
          throw new OnboardingError(403, 'SITE_NOT_ALLOWED', 'This gateway is not authorized for the selected site.');
        }
        const site = tenant.sites.find((candidate) => candidate.id === normalizedInput.siteId);
        if (!site) throw new OnboardingError(404, 'SITE_NOT_FOUND', 'Selected site is unavailable.');
        const profile = tenant.profiles.find((candidate) => candidate.id === normalizedInput.profileVersionId);
        if (!profile) throw new OnboardingError(404, 'PROFILE_NOT_FOUND', 'Selected profile version is unavailable.');
        if (profile.modelId !== verification.modelId) {
          throw new OnboardingError(409, 'PROFILE_INCOMPATIBLE', 'Selected profile is not compatible with this gateway model.');
        }
        const manufacturing = tenant.manufacturing.find((candidate) => candidate.serialNumber === verification.serialNumber);
        if (!manufacturing || manufacturing.reservedByVerificationId !== verification.id) {
          throw new OnboardingError(409, 'CLAIM_RESERVATION_LOST', 'The device registration reservation is no longer valid.');
        }
        const existingGateway = tenant.gateways.find((candidate) => candidate.serialNumber === verification.serialNumber);
        if (existingGateway && existingGateway.state !== 'DECOMMISSIONED') {
          throw new OnboardingError(409, 'GATEWAY_ALREADY_CLAIMED', 'This gateway is already owned by an active tenant.');
        }

        const createdAt = iso(this.now());
        const gatewayId = existingGateway?.id ?? `gw_${sha256(`${context.tenantId}:${verification.serialNumber}`).slice(0, 16)}`;
        const deploymentGeneration = (existingGateway?.deploymentGeneration ?? 0) + 1;
        const thingName = `ce-${slug(context.tenantId).slice(0, 18)}-${slug(verification.serialNumber).slice(0, 28)}`;
        const previousProfileVersionId = existingGateway?.profileVersionId;
        const gateway: Gateway = {
          id: gatewayId,
          thingName,
          serialNumber: verification.serialNumber,
          modelId: verification.modelId,
          hardwareRevision: verification.hardwareRevision,
          siteId: site.id,
          state: 'PENDING',
          certificateState: 'PENDING',
          health: 'UNKNOWN',
          deploymentGeneration,
          profileVersionId: profile.id,
          createdAt: existingGateway?.createdAt ?? createdAt,
          updatedAt: createdAt,
        };
        if (existingGateway) Object.assign(existingGateway, gateway);
        else tenant.gateways.push(gateway);

        verification.state = 'CONSUMED';
        verification.consumedAt = createdAt;
        manufacturing.state = 'PROVISIONING';
        manufacturing.gatewayId = gatewayId;
        const operation: OnboardingOperation = {
          id: `op_${randomUUID()}`,
          tenantId: context.tenantId,
          type: 'ONBOARD',
          status: 'IN_PROGRESS',
          state: 'CLAIM_ACCEPTED',
          gatewayId,
          serialNumber: verification.serialNumber,
          siteId: site.id,
          profileVersionId: profile.id,
          previousProfileVersionId,
          deploymentGeneration,
          timeline: [{ ...ONBOARD_STEPS[0], at: createdAt }],
          createdAt,
          updatedAt: createdAt,
          nextTransitionAt: addMilliseconds(createdAt, this.transitionMs),
        };
        tenant.operations.push(operation);
        tenant.audit.push(newAudit(context.tenantId, context.actorId, 'ONBOARD_START', 'operation', operation.id, 'SUCCESS', createdAt));
        tenant.outbox.push(newOutbox(
          context.tenantId,
          'OnboardingStarted',
          operation.id,
          createdAt,
          { gatewayId, thingName, siteId: site.id, profileVersionId: profile.id },
          deploymentGeneration,
        ));
        return operation;
      });
    });
    this.emit(context.tenantId, 'OnboardingStarted', operation.id);
    return clone(operation);
  }

  async getOperation(context: OperatorContext, operationId: string): Promise<OnboardingOperation> {
    const operation = await this.transaction((database) => {
      const tenant = this.ensureTenant(database, context.tenantId);
      this.reconcileTenant(tenant, this.now());
      const found = tenant.operations.find((candidate) => candidate.id === operationId);
      if (!found) throw new OnboardingError(404, 'OPERATION_NOT_FOUND', 'Operation not found.');
      return found;
    });
    return clone(operation);
  }

  async assignProfile(
    context: OperatorContext,
    gatewayId: string,
    input: { profileVersionId: string; deliveryMode?: 'SHADOW' | 'JOB' },
    idempotencyKey: string,
  ): Promise<OnboardingOperation> {
    assertIdempotencyKey(idempotencyKey);
    const normalizedInput = {
      gatewayId: String(gatewayId ?? '').trim(),
      profileVersionId: String(input.profileVersionId ?? '').trim(),
      deliveryMode: input.deliveryMode === 'JOB' ? 'JOB' as const : 'SHADOW' as const,
    };
    const operation = await this.transaction((database) => {
      const tenant = this.ensureTenant(database, context.tenantId);
      return this.idempotent(database, context, `assign-profile:${normalizedInput.gatewayId}`, idempotencyKey, normalizedInput, () => {
        const gateway = tenant.gateways.find((candidate) => candidate.id === normalizedInput.gatewayId);
        if (!gateway) throw new OnboardingError(404, 'GATEWAY_NOT_FOUND', 'Gateway not found.');
        if (gateway.state !== 'ACTIVE' || gateway.health !== 'HEALTHY' || gateway.certificateState !== 'ACTIVE') {
          throw new OnboardingError(409, 'GATEWAY_NOT_STABLE', 'Gateway must be applied healthy with an active certificate before a profile deployment.');
        }
        if (tenant.operations.some((candidate) => candidate.gatewayId === gateway.id && candidate.status === 'IN_PROGRESS')) {
          throw new OnboardingError(409, 'GATEWAY_OPERATION_ACTIVE', 'Another gateway operation is already in progress.');
        }
        const profile = tenant.profiles.find((candidate) => candidate.id === normalizedInput.profileVersionId);
        if (!profile) throw new OnboardingError(404, 'PROFILE_NOT_FOUND', 'Selected profile version is unavailable.');
        if (profile.modelId !== gateway.modelId) {
          throw new OnboardingError(409, 'PROFILE_INCOMPATIBLE', 'Selected profile is not compatible with this gateway model.');
        }
        if (profile.id === gateway.profileVersionId) {
          throw new OnboardingError(409, 'PROFILE_ALREADY_ASSIGNED', 'The gateway already has this immutable profile version assigned.');
        }

        const createdAt = iso(this.now());
        const previousProfileVersionId = gateway.profileVersionId;
        const deploymentGeneration = gateway.deploymentGeneration + 1;
        gateway.profileVersionId = profile.id;
        gateway.deploymentGeneration = deploymentGeneration;
        gateway.health = 'APPLYING';
        gateway.updatedAt = createdAt;
        const value: OnboardingOperation = {
          id: `op_${randomUUID()}`,
          tenantId: context.tenantId,
          type: 'PROFILE_DEPLOY',
          status: 'IN_PROGRESS',
          state: 'PROFILE_STAGED',
          gatewayId: gateway.id,
          serialNumber: gateway.serialNumber,
          siteId: gateway.siteId,
          profileVersionId: profile.id,
          previousProfileVersionId,
          deploymentGeneration,
          timeline: [{ ...PROFILE_DEPLOY_STEPS[0], at: createdAt }],
          createdAt,
          updatedAt: createdAt,
          nextTransitionAt: addMilliseconds(createdAt, this.transitionMs),
        };
        tenant.operations.push(value);
        tenant.audit.push(newAudit(context.tenantId, context.actorId, 'PROFILE_ASSIGN', 'operation', value.id, 'SUCCESS', createdAt));
        tenant.outbox.push(newOutbox(
          context.tenantId,
          normalizedInput.deliveryMode === 'JOB' ? 'ProfileJobRequested' : 'ProfileShadowUpdateRequested',
          value.id,
          createdAt,
          { gatewayId: gateway.id, thingName: gateway.thingName, profileVersionId: profile.id },
          deploymentGeneration,
        ));
        return value;
      });
    });
    this.emit(context.tenantId, 'ProfileAssigned', operation.id);
    return clone(operation);
  }

  async decommissionGateway(
    context: OperatorContext,
    gatewayId: string,
    input: { confirmation: string },
    idempotencyKey: string,
  ): Promise<OnboardingOperation> {
    assertIdempotencyKey(idempotencyKey);
    const confirmation = String(input.confirmation ?? '').trim().toUpperCase();
    const operation = await this.transaction((database) => {
      const tenant = this.ensureTenant(database, context.tenantId);
      return this.idempotent(database, context, `decommission:${gatewayId}`, idempotencyKey, { confirmationHash: sha256(confirmation) }, () => {
        const gateway = tenant.gateways.find((candidate) => candidate.id === gatewayId);
        if (!gateway) throw new OnboardingError(404, 'GATEWAY_NOT_FOUND', 'Gateway not found.');
        if (gateway.state === 'DECOMMISSIONED') {
          throw new OnboardingError(409, 'ALREADY_DECOMMISSIONED', 'Gateway is already decommissioned.');
        }
        if (confirmation !== gateway.serialNumber) {
          throw new OnboardingError(400, 'CONFIRMATION_MISMATCH', 'Type the gateway serial number exactly to confirm decommissioning.');
        }
        const createdAt = iso(this.now());
        const deploymentGeneration = gateway.deploymentGeneration + 1;
        gateway.state = 'DECOMMISSIONING';
        gateway.health = 'UNKNOWN';
        gateway.deploymentGeneration = deploymentGeneration;
        gateway.updatedAt = createdAt;
        const value: OnboardingOperation = {
          id: `op_${randomUUID()}`,
          tenantId: context.tenantId,
          type: 'DECOMMISSION',
          status: 'IN_PROGRESS',
          state: 'DECOMMISSIONING',
          gatewayId: gateway.id,
          serialNumber: gateway.serialNumber,
          siteId: gateway.siteId,
          profileVersionId: gateway.profileVersionId,
          deploymentGeneration,
          timeline: [{ ...DECOMMISSION_STEPS[0], at: createdAt }],
          createdAt,
          updatedAt: createdAt,
          nextTransitionAt: addMilliseconds(createdAt, this.transitionMs),
        };
        tenant.operations.push(value);
        tenant.audit.push(newAudit(context.tenantId, context.actorId, 'GATEWAY_DECOMMISSION', 'operation', value.id, 'SUCCESS', createdAt));
        tenant.outbox.push(newOutbox(
          context.tenantId,
          'GatewayDecommissionRequested',
          value.id,
          createdAt,
          { gatewayId: gateway.id, thingName: gateway.thingName },
          deploymentGeneration,
        ));
        return value;
      });
    });
    this.emit(context.tenantId, 'GatewayDecommissionRequested', operation.id);
    return clone(operation);
  }

  async recordDeviceStatus(context: OperatorContext, input: DeviceStatusInput): Promise<OnboardingOperation> {
    if (!Number.isSafeInteger(input.deploymentGeneration) || input.deploymentGeneration < 1) {
      throw new OnboardingError(400, 'INVALID_GENERATION', 'Device status must include a positive deployment generation.');
    }
    if (!['APPLIED_HEALTHY', 'APPLY_FAILED', 'HEALTH_DEGRADED'].includes(input.status)) {
      throw new OnboardingError(400, 'INVALID_DEVICE_STATUS', 'Device status is not recognized.');
    }
    const operation = await this.transaction((database) => {
      const tenant = this.ensureTenant(database, context.tenantId);
      const gateway = tenant.gateways.find((candidate) => candidate.thingName === input.thingName);
      if (!gateway) throw new OnboardingError(404, 'GATEWAY_NOT_FOUND', 'Authenticated gateway is not registered.');
      if (gateway.deploymentGeneration !== input.deploymentGeneration) {
        throw new OnboardingError(409, 'STALE_GENERATION', 'Device acknowledgement is for a stale deployment generation.', {
          expectedGeneration: gateway.deploymentGeneration,
        });
      }
      const active = [...tenant.operations]
        .reverse()
        .find((candidate) => candidate.gatewayId === gateway.id && candidate.status === 'IN_PROGRESS');
      if (!active) throw new OnboardingError(409, 'NO_ACTIVE_OPERATION', 'No active operation can accept this acknowledgement.');
      const at = iso(this.now());
      if (input.status === 'APPLIED_HEALTHY') {
        this.transitionOperation(tenant, active, 'APPLIED_HEALTHY', at, 'Gateway acknowledged the applied profile and is healthy.');
      } else {
        const reason = String(input.reason ?? 'Gateway health validation failed.').slice(0, 300);
        this.transitionOperation(tenant, active, 'ROLLING_BACK', at, 'Gateway rejected the candidate profile; rollback started.');
        this.transitionOperation(tenant, active, 'ROLLED_BACK', at, 'Last-known-good configuration restored.');
        active.status = 'FAILED';
        active.failure = { code: input.status, message: reason, rolledBack: true };
        delete active.nextTransitionAt;
        gateway.state = active.previousProfileVersionId ? 'ACTIVE' : 'QUARANTINED';
        gateway.profileVersionId = active.previousProfileVersionId;
        gateway.health = active.previousProfileVersionId ? 'HEALTHY' : 'DEGRADED';
        gateway.updatedAt = at;
        tenant.audit.push(newAudit(context.tenantId, context.actorId, 'PROFILE_APPLY', 'operation', active.id, 'FAILED', at, reason));
        tenant.outbox.push(newOutbox(
          context.tenantId,
          'ProfileApplyRolledBack',
          active.id,
          at,
          { gatewayId: gateway.id, reason },
          active.deploymentGeneration,
        ));
      }
      return active;
    });
    this.emit(context.tenantId, 'DeviceStatusRecorded', operation.id);
    return clone(operation);
  }

  async reconcileAll(): Promise<void> {
    const current = this.now();
    const hasDueOperation = Object.values(this.database.tenants).some((tenant) => tenant.operations.some((operation) => (
      operation.status === 'IN_PROGRESS'
      && operation.nextTransitionAt
      && new Date(operation.nextTransitionAt) <= current
    )));
    if (!hasDueOperation) return;
    const changedTenants = await this.transaction((database) => {
      const changed: string[] = [];
      for (const tenant of Object.values(database.tenants)) {
        if (this.reconcileTenant(tenant, current)) changed.push(tenant.tenant.id);
      }
      return changed;
    });
    changedTenants.forEach((tenantId) => this.emit(tenantId, 'OperationProgressed', tenantId));
  }

  private async transaction<T>(work: (database: OnboardingDatabase) => T): Promise<T> {
    const run = this.writeQueue.then(async () => {
      const draft = clone(this.database);
      const result = work(draft);
      await this.repository.save(draft);
      this.database = draft;
      return clone(result);
    });
    this.writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private idempotent<T>(
    database: OnboardingDatabase,
    context: OperatorContext,
    scope: string,
    key: string,
    request: unknown,
    create: () => T,
  ): T {
    const storageKey = `${context.tenantId}:${scope}:${key}`;
    const requestHash = sha256(stableJson(request));
    const existing = database.idempotency[storageKey];
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new OnboardingError(409, 'IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used for a different request.');
      }
      return clone(existing.response as T);
    }
    const response = create();
    const record: IdempotencyRecord = { requestHash, response: clone(response), createdAt: iso(this.now()) };
    database.idempotency[storageKey] = record;
    return response;
  }

  private ensureTenant(database: OnboardingDatabase, tenantId: string): TenantState {
    const existing = database.tenants[tenantId];
    if (existing) return existing;
    const createdAt = iso(this.now());
    const sites: Site[] = [
      { id: 'site-chicago-hq', name: 'Chicago HQ', location: 'Chicago, IL' },
      { id: 'site-austin-branch', name: 'Austin Branch', location: 'Austin, TX' },
      { id: 'site-milwaukee-plant', name: 'Milwaukee Plant', location: 'Milwaukee, WI' },
    ];
    const profiles: ProfileVersion[] = [
      this.seedProfile('secure-branch-edge-pro', 'Secure Branch', 'edge-pro', createdAt, {
        ...DEFAULT_PROFILE_PARAMETERS,
        serviceOffering: 'ANIRA',
        configurationWatchdogSeconds: 180,
      }),
      this.seedProfile('retail-standard-edge-compact', 'Retail Standard', 'edge-compact', createdAt, {
        ...DEFAULT_PROFILE_PARAMETERS,
        serviceOffering: 'VPN_MANAGED',
        cellularBackupEnabled: true,
        configurationWatchdogSeconds: 120,
      }),
    ];
    const developmentTenantId = process.env.ONBOARDING_DEV_TENANT_ID ?? 'tenant_demo';
    const manufacturing: ManufacturingRecord[] = tenantId === developmentTenantId
      ? [
          this.seedManufacturing(tenantId, 'CE-GW-840021', 'edge-pro', 'rev-d', 'BATCH-2026-08-A', sites.map((site) => site.id)),
          this.seedManufacturing(tenantId, 'CE-GW-840022', 'edge-compact', 'rev-b', 'BATCH-2026-08-B', sites.slice(0, 2).map((site) => site.id)),
        ]
      : [];
    const tenant: TenantState = {
      tenant: { id: tenantId, name: process.env.ONBOARDING_DEV_TENANT_NAME ?? 'Connected Enterprise Demo' },
      sites,
      gateways: [],
      profiles,
      manufacturing,
      verifications: [],
      operations: [],
      audit: [],
      outbox: [],
    };
    database.tenants[tenantId] = tenant;
    return tenant;
  }

  private seedProfile(
    profileId: string,
    name: string,
    modelId: string,
    createdAt: string,
    parameters: Record<string, unknown>,
  ): ProfileVersion {
    const contentHash = sha256(stableJson({ profileId, version: 1, schemaVersion: 2, modelId, parameters }));
    return {
      id: `${profileId}@1`,
      profileId,
      name,
      description: 'Validated baseline with transactional apply and automatic rollback.',
      modelId,
      version: 1,
      schemaVersion: 2,
      parameters,
      contentHash,
      immutable: true,
      createdAt,
      createdBy: 'system',
      changeNote: 'Initial validated baseline',
    };
  }

  private seedManufacturing(
    tenantId: string,
    serialNumber: string,
    modelId: string,
    hardwareRevision: string,
    manufacturingBatch: string,
    allowedSiteIds: string[],
  ): ManufacturingRecord {
    return {
      serialNumber,
      tenantId,
      modelId,
      hardwareRevision,
      manufacturingBatch,
      state: 'CLAIMABLE',
      allowedSiteIds,
    };
  }

  private snapshotForTenant(tenant: TenantState): OnboardingSnapshot {
    return {
      generatedAt: iso(this.now()),
      mode: this.mode,
      tenant: tenant.tenant,
      sites: tenant.sites,
      gatewayModels: GATEWAY_MODELS,
      gateways: tenant.gateways,
      profiles: tenant.profiles,
      operations: tenant.operations.slice(-20).reverse(),
      auditTail: tenant.audit.slice(-20).reverse(),
    };
  }

  private expireReservations(tenant: TenantState, now: Date): void {
    for (const verification of tenant.verifications) {
      if (verification.state === 'VERIFIED' && new Date(verification.expiresAt) <= now) {
        verification.state = 'EXPIRED';
        const manufacturing = tenant.manufacturing.find((candidate) => candidate.reservedByVerificationId === verification.id);
        if (manufacturing?.state === 'RESERVED') {
          manufacturing.state = 'CLAIMABLE';
          delete manufacturing.reservedByVerificationId;
          delete manufacturing.reservationExpiresAt;
        }
      }
    }
  }

  private reconcileTenant(tenant: TenantState, now: Date): boolean {
    this.expireReservations(tenant, now);
    if (!this.simulateDevice) return false;
    let changed = false;
    for (const operation of tenant.operations) {
      while (
        operation.status === 'IN_PROGRESS'
        && operation.nextTransitionAt
        && new Date(operation.nextTransitionAt) <= now
      ) {
        const steps = operation.type === 'ONBOARD'
          ? ONBOARD_STEPS
          : operation.type === 'PROFILE_DEPLOY'
            ? PROFILE_DEPLOY_STEPS
            : DECOMMISSION_STEPS;
        const currentIndex = steps.findIndex((step) => step.state === operation.state);
        const next = steps[currentIndex + 1];
        if (!next) break;
        const transitionAt = operation.nextTransitionAt;
        this.transitionOperation(tenant, operation, next.state, transitionAt, next.detail);
        changed = true;
        if (operation.status === 'IN_PROGRESS') {
          operation.nextTransitionAt = addMilliseconds(transitionAt, this.transitionMs);
        }
      }
    }
    return changed;
  }

  private transitionOperation(
    tenant: TenantState,
    operation: OnboardingOperation,
    state: OnboardingState,
    at: string,
    detail: string,
  ): void {
    if (operation.timeline.some((entry) => entry.state === state)) return;
    operation.state = state;
    operation.updatedAt = at;
    operation.timeline.push({ state, at, detail });
    const gateway = tenant.gateways.find((candidate) => candidate.id === operation.gatewayId);
    if (!gateway) return;
    gateway.updatedAt = at;
    if (state === 'OPERATIONAL_IDENTITY_ISSUED') gateway.certificateState = 'ACTIVE';
    if (state === 'APPLYING') gateway.health = 'APPLYING';
    if (state === 'APPLIED_HEALTHY') {
      operation.status = 'SUCCEEDED';
      delete operation.nextTransitionAt;
      gateway.state = 'ACTIVE';
      gateway.health = 'HEALTHY';
      gateway.lastSeenAt = at;
      const manufacturing = tenant.manufacturing.find((candidate) => candidate.serialNumber === gateway.serialNumber);
      if (manufacturing) manufacturing.state = 'CLAIMED';
      tenant.outbox.push(newOutbox(
        operation.tenantId,
        'GatewayAppliedHealthy',
        operation.id,
        at,
        { gatewayId: gateway.id, profileVersionId: operation.profileVersionId },
        operation.deploymentGeneration,
      ));
    }
    if (state === 'CERTIFICATE_DEACTIVATED') gateway.certificateState = 'INACTIVE';
    if (state === 'DECOMMISSIONED') {
      operation.status = 'SUCCEEDED';
      delete operation.nextTransitionAt;
      gateway.state = 'DECOMMISSIONED';
      gateway.health = 'UNKNOWN';
      tenant.outbox.push(newOutbox(
        operation.tenantId,
        'GatewayDecommissioned',
        operation.id,
        at,
        { gatewayId: gateway.id },
        operation.deploymentGeneration,
      ));
    }
  }

  private emit(tenantId: string, type: string, aggregateId: string): void {
    this.events.emit('change', { tenantId, type, aggregateId } satisfies ServiceEvent);
  }
}
