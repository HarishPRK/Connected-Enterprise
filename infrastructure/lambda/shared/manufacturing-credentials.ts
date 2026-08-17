import { isSafeIdentifier } from './identifiers.js';

export const HARDWARE_PROOF_SCHEME = 'HMAC_SHA256_PEPPER_V1';
export const HARDWARE_PROOF_KEY_VERSION = 1;
const ACTIVATION_CODE_PATTERN = /^[A-Za-z0-9._:-]{16,256}$/;

export function requireActivationCode(value: unknown): string {
  if (typeof value !== 'string' || !ACTIVATION_CODE_PATTERN.test(value)) {
    throw new Error('activationCode must be 16-256 characters using only letters, digits, dot, underscore, colon, or hyphen');
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value) || new Set(value).size < 8 || isRepeatedPattern(value)) {
    throw new Error('activationCode does not meet the minimum uniqueness requirements');
  }
  return value;
}

export function requireHardwareId(value: unknown): string {
  if (!isSafeIdentifier(value)) throw new Error('hardwareId must match the safe identifier grammar');
  return value;
}

export function normalizePresentedSerial(value: unknown): string {
  if (typeof value !== 'string') throw new Error('serialNumber must be a string');
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{2,127}$/.test(normalized)) throw new Error('serialNumber is invalid');
  return normalized;
}

export function requireCanonicalSerial(value: unknown): string {
  const normalized = normalizePresentedSerial(value);
  if (value !== normalized) throw new Error('serialNumber must already be canonical uppercase with no surrounding whitespace');
  return normalized;
}

export function assertUniqueCanonicalSerials(values: readonly unknown[]): string[] {
  const canonical = values.map(requireCanonicalSerial);
  if (new Set(canonical).size !== canonical.length) throw new Error('serialNumber values must be unique after canonical validation');
  return canonical;
}

export function assertUniqueActivationCodes(codes: readonly string[]): void {
  const validated = codes.map(requireActivationCode);
  if (new Set(validated).size !== validated.length) throw new Error('activationCode values must not be repeated within an import batch');
}

function isRepeatedPattern(value: string): boolean {
  return (value + value).indexOf(value, 1) !== value.length;
}
