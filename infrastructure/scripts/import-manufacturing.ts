import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { requireSafeIdentifier } from '../lambda/shared/identifiers.js';
import {
  assertUniqueActivationCodes,
  assertUniqueCanonicalSerials,
  HARDWARE_PROOF_KEY_VERSION,
  HARDWARE_PROOF_SCHEME,
  requireActivationCode,
  requireCanonicalSerial,
  requireHardwareId,
} from '../lambda/shared/manufacturing-credentials.js';

interface ManufacturingInput {
  serialNumber: string;
  activationCode: string;
  hardwareId: string;
  modelId: string;
  hardwareRevision: string;
  manufacturingBatch: string;
  allowedSiteIds: string[];
}

const args = new Map(process.argv.slice(2).map((value, index, values) => value.startsWith('--') ? [value, values[index + 1]] : ['', '']));
const required = (name: string): string => {
  const value = args.get(name);
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
};
const apply = process.argv.includes('--apply');
const file = required('--file');
const tableName = required('--table');
const secretArn = required('--secret-arn');
const tenantId = required('--tenant-id');
const claimCertificateId = required('--claim-certificate-id');
requireSafeIdentifier(tenantId, 'tenant-id');
requireSafeIdentifier(claimCertificateId, 'claim-certificate-id');
const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Manufacturing file must be a non-empty JSON array');
const records = parsed.map(validateRecord);
assertUniqueActivationCodes(records.map((record) => record.activationCode));
assertUniqueCanonicalSerials(records.map((record) => record.serialNumber));

if (!apply) {
  console.log(`Validated ${records.length} manufacturing record(s). Re-run with --apply to import; no AWS writes were made.`);
  process.exit(0);
}

const secretResult = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretArn }));
const rawSecret = secretResult.SecretString ?? (secretResult.SecretBinary ? Buffer.from(secretResult.SecretBinary).toString('utf8') : '');
if (!rawSecret) throw new Error('Hardware proof pepper secret is empty');
const secretDocument = JSON.parse(rawSecret) as { pepper?: unknown };
if (typeof secretDocument.pepper !== 'string' || secretDocument.pepper.length < 32) throw new Error('Hardware proof pepper is missing or too short');
const pepper = secretDocument.pepper;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

for (const record of records) {
  const serialNumber = record.serialNumber;
  const hardwareProofDigest = createHmac('sha256', Buffer.from(pepper, 'utf8'))
    .update(serialNumber).update('\0').update(record.activationCode).digest('hex');
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SERIAL#${serialNumber}`, SK: 'MANUFACTURING', entityType: 'MANUFACTURING',
      serialNumber, tenantId, modelId: record.modelId, hardwareId: record.hardwareId,
      hardwareRevision: record.hardwareRevision, manufacturingBatch: record.manufacturingBatch,
      allowedSiteIds: record.allowedSiteIds, claimCertificateId, hardwareProofDigest,
      credentialScheme: HARDWARE_PROOF_SCHEME, credentialKeyVersion: HARDWARE_PROOF_KEY_VERSION,
      state: 'CLAIMABLE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
  console.log(`Imported ${serialNumber}`);
}

function validateRecord(value: unknown): ManufacturingInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Every manufacturing record must be an object');
  const candidate = value as Partial<ManufacturingInput>;
  const text = (key: keyof ManufacturingInput, max = 128): string => {
    const item = candidate[key];
    if (typeof item !== 'string' || !item.trim() || item.length > max) throw new Error(`${String(key)} is required`);
    return item;
  };
  const activationCode = requireActivationCode(candidate.activationCode);
  if (!Array.isArray(candidate.allowedSiteIds) || candidate.allowedSiteIds.length === 0 || !candidate.allowedSiteIds.every((site) => typeof site === 'string' && site.length > 0)) {
    throw new Error('allowedSiteIds must be a non-empty string array');
  }
  requireSafeIdentifier(candidate.modelId, 'modelId');
  for (const siteId of candidate.allowedSiteIds) requireSafeIdentifier(siteId, 'allowedSiteIds');
  return {
    serialNumber: requireCanonicalSerial(candidate.serialNumber), activationCode, hardwareId: requireHardwareId(candidate.hardwareId), modelId: text('modelId'),
    hardwareRevision: text('hardwareRevision'), manufacturingBatch: text('manufacturingBatch'),
    allowedSiteIds: [...candidate.allowedSiteIds],
  };
}
