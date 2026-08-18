import { createHash, createPublicKey, verify } from 'node:crypto';

export const DEVICE_STATUS_SEQUENCE = ['APPLYING', 'HEALTH_CHECK', 'APPLIED_HEALTHY'] as const;

export type DeviceStatus = (typeof DEVICE_STATUS_SEQUENCE)[number];
export type ProfileSchemaVersion = 1 | 2;

export interface AssignmentExpectation {
  thingName: string;
  generation: number;
  requestId: string;
  signingKeyId: string;
  now?: Date;
}

export interface SignedAssignmentDescriptor extends Record<string, unknown> {
  kind: 'gateway-profile-assignment';
  tenantId: string;
  gatewayId: string;
  thingName: string;
  generation: number;
  profileId: string;
  profileVersionId: string;
  schemaVersion: ProfileSchemaVersion;
  profileSha256: string;
  objectKey: string;
  manifestKey: string;
  issuedAt: string;
  expiresAt: string;
  signingKeyId: string;
  signature: string;
  signingAlgorithm: 'ECDSA_SHA_256';
}

export interface AssignmentResponse {
  type: 'SIGNED_PROFILE_ASSIGNMENT';
  requestId: string;
  gatewayId: string;
  thingName: string;
  generation: number;
  profileVersionId: string;
  descriptor: SignedAssignmentDescriptor;
  artifacts: {
    profile: { url: string; sha256: string; expiresAt: string };
    manifest: { url: string; expiresAt: string };
  };
  issuedAt: string;
}

export interface VerifiedArtifacts {
  assignment: AssignmentResponse;
  profile: Record<string, unknown>;
  profileText: string;
  manifest: Record<string, unknown>;
  manifestText: string;
  checksum: string;
}

export interface AppliedState {
  generation: number;
  profileVersionId: string;
  profileChecksum: string;
  appliedAt: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  throw new Error('Value cannot be encoded as canonical JSON');
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

/**
 * KMS ECDSA_SHA_256 signs SHA-256(canonical JSON). Node's `verify('sha256', ...)`
 * performs that same single hash before checking the DER-encoded ECDSA signature.
 */
export function verifyKmsSignedObject(
  value: Record<string, unknown>,
  publicKeyPem: string,
  expectedSigningKeyId: string,
  label: string,
): void {
  const signingKeyId = requiredString(value.signingKeyId, `${label}.signingKeyId`, 2048);
  if (signingKeyId !== expectedSigningKeyId) throw new Error(`${label} was signed by an unpinned KMS key`);
  if (value.signingAlgorithm !== 'ECDSA_SHA_256') throw new Error(`${label} uses an unsupported signing algorithm`);
  const signatureText = requiredString(value.signature, `${label}.signature`, 4096);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText)) throw new Error(`${label}.signature is not canonical base64`);

  const signedPayload = { ...value };
  delete signedPayload.signature;
  delete signedPayload.signingAlgorithm;
  const canonical = canonicalJson(signedPayload);
  const signature = Buffer.from(signatureText, 'base64');
  const publicKey = createPublicKey(publicKeyPem);
  if (!verify('sha256', Buffer.from(canonical), publicKey, signature)) {
    throw new Error(`${label} KMS signature verification failed`);
  }
}

export function validateAssignmentResponse(
  value: unknown,
  expectation: AssignmentExpectation,
  publicKeyPem: string,
): AssignmentResponse {
  if (!isRecord(value)) throw new Error('Configuration response must be a JSON object');
  if (value.type !== 'SIGNED_PROFILE_ASSIGNMENT') throw new Error('Configuration response has an unsupported type');

  const requestId = requiredString(value.requestId, 'configuration response requestId', 128);
  if (requestId !== expectation.requestId) throw new Error('Configuration response requestId does not match this request');
  const thingName = requiredThingName(value.thingName, 'configuration response thingName');
  if (thingName !== expectation.thingName) throw new Error('Configuration response is bound to a different Thing');
  const generation = requiredPositiveInteger(value.generation, 'configuration response generation');
  if (generation !== expectation.generation) throw new Error('Configuration response generation is not the requested generation');

  const gatewayId = requiredString(value.gatewayId, 'configuration response gatewayId', 128);
  const profileVersionId = requiredString(value.profileVersionId, 'configuration response profileVersionId', 128);
  if (!isRecord(value.descriptor)) throw new Error('Configuration response descriptor is missing');
  verifyKmsSignedObject(value.descriptor, publicKeyPem, expectation.signingKeyId, 'assignment descriptor');
  const descriptor = validateDescriptor(value.descriptor, {
    thingName,
    gatewayId,
    generation,
    profileVersionId,
    now: expectation.now ?? new Date(),
  });

  if (!isRecord(value.artifacts) || !isRecord(value.artifacts.profile) || !isRecord(value.artifacts.manifest)) {
    throw new Error('Configuration response artifact locations are missing');
  }
  const profileUrl = requiredHttpsUrl(value.artifacts.profile.url, 'profile artifact URL');
  const profileSha256 = requiredChecksum(value.artifacts.profile.sha256, 'profile artifact checksum');
  if (profileSha256 !== descriptor.profileSha256) throw new Error('Profile artifact checksum does not match the signed descriptor');
  const profileExpiresAt = requiredFutureTimestamp(value.artifacts.profile.expiresAt, 'profile artifact expiry', expectation.now);
  const manifestUrl = requiredHttpsUrl(value.artifacts.manifest.url, 'manifest artifact URL');
  const manifestExpiresAt = requiredFutureTimestamp(value.artifacts.manifest.expiresAt, 'manifest artifact expiry', expectation.now);
  const issuedAt = requiredTimestamp(value.issuedAt, 'configuration response issuedAt');

  return {
    type: 'SIGNED_PROFILE_ASSIGNMENT',
    requestId,
    gatewayId,
    thingName,
    generation,
    profileVersionId,
    descriptor,
    artifacts: {
      profile: { url: profileUrl, sha256: profileSha256, expiresAt: profileExpiresAt },
      manifest: { url: manifestUrl, expiresAt: manifestExpiresAt },
    },
    issuedAt,
  };
}

export function verifyDownloadedArtifacts(
  assignment: AssignmentResponse,
  profileText: string,
  manifestText: string,
  publicKeyPem: string,
  expectedSigningKeyId: string,
): VerifiedArtifacts {
  const checksum = sha256Hex(profileText);
  if (checksum !== assignment.descriptor.profileSha256 || checksum !== assignment.artifacts.profile.sha256) {
    throw new Error('Downloaded profile checksum does not match the signed assignment');
  }

  const manifest = parseJsonObject(manifestText, 'Profile manifest');
  verifyKmsSignedObject(manifest, publicKeyPem, expectedSigningKeyId, 'profile manifest');
  const manifestSchemaVersion = requiredProfileSchemaVersion(manifest.schemaVersion, 'profile manifest schemaVersion');
  if (manifest.kind !== 'gateway-profile'
    || manifest.tenantId !== assignment.descriptor.tenantId
    || manifest.profileId !== assignment.descriptor.profileId
    || manifest.profileVersionId !== assignment.profileVersionId
    || manifest.sha256 !== checksum
    || manifest.objectKey !== assignment.descriptor.objectKey) {
    throw new Error('Profile manifest does not match the signed assignment and downloaded profile');
  }

  const profile = parseJsonObject(profileText, 'Profile document');
  const profileSchemaVersion = requiredProfileSchemaVersion(profile.schemaVersion, 'profile document schemaVersion');
  if (typeof profile.modelId !== 'string'
    || profile.modelId.length === 0
    || !isRecord(profile.parameters)) {
    throw new Error('Profile document does not implement the Connected Enterprise UI profile schema');
  }
  if (profileSchemaVersion !== manifestSchemaVersion
    || profileSchemaVersion !== assignment.descriptor.schemaVersion) {
    throw new Error('Profile, manifest, and assignment schema versions do not match');
  }
  if (manifest.modelId !== profile.modelId) throw new Error('Profile model does not match its signed manifest');

  return { assignment, profile, profileText, manifest, manifestText, checksum };
}

export function statusPayloads(
  generation: number,
  profileVersionId: string,
  profileChecksum: string,
): ReadonlyArray<Record<string, unknown>> {
  requiredPositiveInteger(generation, 'generation');
  requiredString(profileVersionId, 'profileVersionId', 128);
  requiredChecksum(profileChecksum, 'profileChecksum');
  return [
    {
      generation,
      status: 'APPLYING',
      detail: 'Simulator staged the verified immutable profile and started the candidate transaction.',
    },
    {
      generation,
      status: 'HEALTH_CHECK',
      detail: 'Simulator committed the candidate and is validating the persisted profile checksum.',
    },
    {
      generation,
      status: 'APPLIED_HEALTHY',
      profileVersionId,
      profileChecksum,
      detail: 'Simulator persisted the exact signed profile and passed its synthetic health checks.',
    },
  ];
}

export function appliedStateDisposition(
  previous: AppliedState | undefined,
  next: Pick<AppliedState, 'generation' | 'profileVersionId' | 'profileChecksum'>,
): 'APPLY' | 'REACK' {
  if (!previous) return 'APPLY';
  if (previous.generation > next.generation) throw new Error('Refusing a stale profile generation');
  if (previous.generation < next.generation) return 'APPLY';
  if (previous.profileVersionId !== next.profileVersionId || previous.profileChecksum !== next.profileChecksum) {
    throw new Error('The same generation is already bound to a different profile');
  }
  return 'REACK';
}

/** Extracts only bounded, redacted fields from an SDK ServiceError. */
export function modeledServiceErrorMessage(error: unknown, operation: string): string | undefined {
  if (!isRecord(error) || !isRecord(error.modeledError)) return undefined;
  const modeled = error.modeledError;
  const statusCode = typeof modeled.statusCode === 'number'
    && Number.isInteger(modeled.statusCode)
    && modeled.statusCode >= 100
    && modeled.statusCode <= 599
    ? modeled.statusCode
    : undefined;
  const errorCode = typeof modeled.errorCode === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(modeled.errorCode)
    ? modeled.errorCode
    : undefined;
  const errorMessage = typeof modeled.errorMessage === 'string'
    ? redactServiceText(modeled.errorMessage)
    : undefined;
  if (statusCode === undefined && !errorCode && !errorMessage) return undefined;
  const metadata = [
    statusCode === undefined ? undefined : `status ${statusCode}`,
    errorCode ? `code ${errorCode}` : undefined,
  ].filter((value): value is string => !!value).join(', ');
  return `${operation} rejected by AWS IoT${metadata ? ` (${metadata})` : ''}${errorMessage ? `: ${errorMessage}` : ''}`;
}

function validateDescriptor(
  value: Record<string, unknown>,
  expected: { thingName: string; gatewayId: string; generation: number; profileVersionId: string; now: Date },
): SignedAssignmentDescriptor {
  if (value.kind !== 'gateway-profile-assignment') throw new Error('Assignment descriptor has an unsupported kind');
  const tenantId = requiredString(value.tenantId, 'descriptor tenantId', 128);
  const gatewayId = requiredString(value.gatewayId, 'descriptor gatewayId', 128);
  const thingName = requiredThingName(value.thingName, 'descriptor thingName');
  const generation = requiredPositiveInteger(value.generation, 'descriptor generation');
  const profileId = requiredString(value.profileId, 'descriptor profileId', 128);
  const profileVersionId = requiredString(value.profileVersionId, 'descriptor profileVersionId', 128);
  const schemaVersion = requiredProfileSchemaVersion(value.schemaVersion, 'descriptor schemaVersion');
  if (gatewayId !== expected.gatewayId || thingName !== expected.thingName
    || generation !== expected.generation || profileVersionId !== expected.profileVersionId) {
    throw new Error('Assignment descriptor binding does not match the configuration response');
  }
  const profileSha256 = requiredChecksum(value.profileSha256, 'descriptor profileSha256');
  const objectKey = requiredString(value.objectKey, 'descriptor objectKey', 1024);
  const manifestKey = requiredString(value.manifestKey, 'descriptor manifestKey', 1024);
  const issuedAt = requiredTimestamp(value.issuedAt, 'descriptor issuedAt');
  const expiresAt = requiredFutureTimestamp(value.expiresAt, 'descriptor expiresAt', expected.now);
  const signingKeyId = requiredString(value.signingKeyId, 'descriptor signingKeyId', 2048);
  const signature = requiredString(value.signature, 'descriptor signature', 4096);
  if (value.signingAlgorithm !== 'ECDSA_SHA_256') throw new Error('Descriptor signing algorithm is unsupported');

  return {
    ...value,
    kind: 'gateway-profile-assignment',
    tenantId,
    gatewayId,
    thingName,
    generation,
    profileId,
    profileVersionId,
    schemaVersion,
    profileSha256,
    objectKey,
    manifestKey,
    issuedAt,
    expiresAt,
    signingKeyId,
    signature,
    signingAlgorithm: 'ECDSA_SHA_256',
  };
}

function requiredString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength || hasControlCharacters(value)) {
    throw new Error(`${label} is missing or invalid`);
  }
  return value;
}

function requiredThingName(value: unknown, label: string): string {
  const result = requiredString(value, label, 128);
  if (!/^[A-Za-z0-9:_-]+$/.test(result)) throw new Error(`${label} contains unsupported characters`);
  return result;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function requiredProfileSchemaVersion(value: unknown, label: string): ProfileSchemaVersion {
  if (value !== 1 && value !== 2) throw new Error(`${label} must be 1 or 2`);
  return value;
}

function requiredChecksum(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function requiredTimestamp(value: unknown, label: string): string {
  const result = requiredString(value, label, 64);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`);
  return result;
}

function requiredFutureTimestamp(value: unknown, label: string, now = new Date()): string {
  const result = requiredTimestamp(value, label);
  if (Date.parse(result) <= now.getTime()) throw new Error(`${label} has expired`);
  return result;
}

function requiredHttpsUrl(value: unknown, label: string): string {
  const result = requiredString(value, label, 8192);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error(`${label} must be an HTTPS URL without embedded credentials`);
  }
  return parsed.toString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function redactServiceText(value: string): string | undefined {
  const normalized = value.trim()
    .split('')
    .map((character) => isControlCharacter(character) ? ' ' : character)
    .join('')
    .replace(/(hardware.?proof|password|passphrase|ownership.?token|token|secret|private.?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 500);
  return normalized || undefined;
}

function hasControlCharacters(value: string): boolean {
  return value.split('').some(isControlCharacter);
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}
