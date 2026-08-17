export const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isSafeIdentifier(value: unknown, maxLength = 128): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && SAFE_IDENTIFIER_PATTERN.test(value);
}

export function requireSafeIdentifier(value: unknown, label: string, maxLength = 128): string {
  if (!isSafeIdentifier(value, maxLength)) {
    throw new Error(`${label} must match ${SAFE_IDENTIFIER_PATTERN.source} and not exceed ${maxLength} characters`);
  }
  return value;
}
