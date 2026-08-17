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
