import { isIP } from 'node:net';
import { InputError } from './ddb.js';

type ProfileRule =
  | { type: 'boolean' }
  | { type: 'number'; min: number; max: number; integer?: boolean }
  | { type: 'string'; maxLength: number; pattern?: RegExp }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'ipv4' }
  | { type: 'secret-reference' };

const RULES: Record<string, ProfileRule> = {
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

export function validateUiProfileParameters(value: unknown): Record<string, string | number | boolean> {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new InputError('parameters must be a JSON object');
  const parameters = value as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(parameters), 'utf8') > 64 * 1024) throw new InputError('parameters must not exceed 64 KiB');
  const result: Record<string, string | number | boolean> = {};
  for (const [key, child] of Object.entries(parameters)) {
    const rule = RULES[key];
    if (!rule) throw new InputError(`parameters.${key} is not part of profile schema v1`);
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
      case 'secret-reference':
        if (typeof child !== 'string' || (child !== '' && !/^(secretsmanager:\/\/|arn:aws[a-z-]*:secretsmanager:)/.test(child))) {
          invalid('must be empty or an AWS Secrets Manager reference');
        }
        break;
    }
    result[key] = child as string | number | boolean;
  }
  return result;
}
