import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import addFormatsImport, { type FormatsPlugin } from 'ajv-formats';
import { KMSClient, MessageType, SignCommand, SigningAlgorithmSpec } from '@aws-sdk/client-kms';
import profileSchema from '../../schemas/gateway-profile-v1.schema.json' with { type: 'json' };
import { SIGNING_KEY_ID } from './config.js';
import { InputError } from './ddb.js';
import { sha256 } from './crypto.js';

const addFormats = addFormatsImport as unknown as FormatsPlugin;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(profileSchema);
const kms = new KMSClient({});
const SECRETS_MANAGER_URI = /^secretsmanager:\/\/[A-Za-z0-9_+=.@-]+(?:\/[A-Za-z0-9_+=.@-]+)*$/;
const SECRETS_MANAGER_ARN = /^arn:(?:aws|aws-us-gov|aws-cn|aws-iso|aws-iso-b|aws-iso-e|aws-iso-f|aws-eusc):secretsmanager:[a-z0-9-]{3,32}:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$/;
const INLINE_SECRET_KEY = /(password|private.?key|pre.?shared|psk|secret.?value|token)/i;

export interface SignedManifest<T extends Record<string, unknown>> {
  manifest: T & { signingKeyId: string };
  canonicalManifest: string;
  signature: string;
  signingAlgorithm: 'ECDSA_SHA_256';
}

export function validateProfile(document: unknown): asserts document is Record<string, unknown> {
  validateProfileSecretReferences(document);
  if (!validate(document)) {
    const details = (validate.errors ?? []).slice(0, 25).map((error: ErrorObject) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
    throw new InputError(`Profile schema validation failed: ${details.join('; ')}`);
  }
}

export function isSecretsManagerReference(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 768) return false;
  if (SECRETS_MANAGER_ARN.test(value)) return true;
  if (!SECRETS_MANAGER_URI.test(value)) return false;
  const path = value.slice('secretsmanager://'.length);
  return path.split('/').every((segment) => segment !== '.' && segment !== '..');
}

function validateProfileSecretReferences(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateProfileSecretReferences(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (key === 'secretRef') {
      if (!isSecretsManagerReference(child)) {
        throw new InputError(`${childPath} must be a secretsmanager:// reference or an AWS Secrets Manager ARN; raw secret values are not accepted`);
      }
      continue;
    }
    if (/secret.?ref/i.test(key)) {
      throw new InputError(`${childPath} is not an approved secretRef field`);
    }
    if (INLINE_SECRET_KEY.test(key)) {
      throw new InputError(`${childPath} must not contain inline secret material; use an approved secretRef`);
    }
    validateProfileSecretReferences(child, childPath);
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  throw new InputError('Profile contains a value that cannot be encoded as JSON');
}

export async function signManifest<T extends Record<string, unknown>>(manifest: T): Promise<SignedManifest<T>> {
  if (!SIGNING_KEY_ID) throw new Error('Signing key is not configured');
  const signedManifest = { ...manifest, signingKeyId: SIGNING_KEY_ID };
  const canonicalManifest = canonicalJson(signedManifest);
  const digest = Buffer.from(sha256(canonicalManifest), 'hex');
  const result = await kms.send(new SignCommand({
    KeyId: SIGNING_KEY_ID,
    Message: digest,
    MessageType: MessageType.DIGEST,
    SigningAlgorithm: SigningAlgorithmSpec.ECDSA_SHA_256,
  }));
  if (!result.Signature) throw new Error('KMS returned no profile signature');
  return {
    manifest: signedManifest,
    canonicalManifest,
    signature: Buffer.from(result.Signature).toString('base64'),
    signingAlgorithm: 'ECDSA_SHA_256',
  };
}
