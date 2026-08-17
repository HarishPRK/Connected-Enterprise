import { X509Certificate, timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import {
  DescribeCertificateCommand,
  IoTClient,
  ListAttachedPoliciesCommand,
  ListPrincipalThingsV2Command,
} from '@aws-sdk/client-iot';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { requireSafeIdentifier } from '../lambda/shared/identifiers.js';
import { requireCanonicalSerial } from '../lambda/shared/manufacturing-credentials.js';

const CERTIFICATE_ID_PATTERN = /^[a-f0-9]{64}$/i;
const BOOTSTRAP_MECHANISM = 'PRELOADED_UNIQUE_BOOTSTRAP';
const BOOTSTRAP_STATUS = 'ACTIVE';
const args = process.argv.slice(2);

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unique bootstrap binding failed: ${message.replace(/[\r\n]+/g, ' ').slice(0, 500)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const apply = args.includes('--apply');
  const region = requireRegion(required('--region'));
  const tableName = requireSafeIdentifier(required('--table'), 'table', 255);
  const tenantId = requireSafeIdentifier(required('--tenant-id'), 'tenant-id');
  const serialNumber = requireCanonicalSerial(required('--serial'));
  const modelId = requireSafeIdentifier(required('--model-id'), 'model-id');
  const siteId = requireSafeIdentifier(required('--site-id'), 'site-id');
  const profileVersionId = requireSafeIdentifier(required('--profile-version-id'), 'profile-version-id');
  const deliveryMode = requireDeliveryMode(required('--delivery-mode'));
  const bootstrapCertificateId = requireCertificateId(required('--bootstrap-certificate-id'));
  const bootstrapCertificateFile = required('--bootstrap-certificate-file');
  const bootstrapPolicyName = requireSafeIdentifier(required('--bootstrap-policy'), 'bootstrap-policy', 128);

  const localCertificate = await readPublicCertificate(bootstrapCertificateFile);
  const iot = new IoTClient({ region });
  const certificateArn = await validateAwsBootstrapCertificate(
    iot,
    bootstrapCertificateId,
    bootstrapPolicyName,
    localCertificate,
  );

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const tenantKey = `TENANT#${tenantId}`;
  const certificateBindingKey = `BOOTSTRAPCERT#${bootstrapCertificateId}`;
  const [existingSerial, existingBinding, tenant, site, model, profile] = await Promise.all([
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: `SERIAL#${serialNumber}`, SK: 'MANUFACTURING' },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: certificateBindingKey, SK: 'BINDING' },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: 'METADATA' }, ConsistentRead: true })),
    ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: `SITE#${siteId}` }, ConsistentRead: true })),
    ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tenantKey, SK: `MODEL#${modelId}` }, ConsistentRead: true })),
    ddb.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :profile AND GSI2SK = :tenant',
      ExpressionAttributeValues: { ':profile': `PROFILEVERSION#${profileVersionId}`, ':tenant': tenantKey },
      Limit: 1,
    })),
  ]);

  if (existingSerial.Item) throw new Error(`Manufacturing identity ${serialNumber} already exists`);
  if (existingBinding.Item) throw new Error(`Bootstrap certificate ${bootstrapCertificateId} is already bound`);
  validateTenantData({
    ...(tenant.Item ? { tenant: tenant.Item } : {}),
    ...(site.Item ? { site: site.Item } : {}),
    ...(model.Item ? { model: model.Item } : {}),
    ...(profile.Items?.[0] ? { profile: profile.Items[0] } : {}),
  }, {
    tenantId, siteId, modelId, profileVersionId,
  });
  await assertCertificateNotPresentInLegacyInventory(ddb, tableName, bootstrapCertificateId);

  if (!apply) {
    console.log(`Validated unique bootstrap certificate ${bootstrapCertificateId} for ${serialNumber}.`);
    console.log('Re-run with --apply to create the one-to-one certificate and serial binding; no AWS writes were made.');
    return;
  }

  const now = new Date().toISOString();
  const profileItem = profile.Items?.[0];
  if (!profileItem || typeof profileItem.PK !== 'string' || typeof profileItem.SK !== 'string') {
    throw new Error('Profile version has no authoritative DynamoDB key');
  }
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        ConditionCheck: {
          TableName: tableName,
          Key: { PK: tenantKey, SK: 'METADATA' },
          ConditionExpression: 'entityType = :entity AND tenantId = :tenantId',
          ExpressionAttributeValues: { ':entity': 'TENANT', ':tenantId': tenantId },
        },
      },
      {
        ConditionCheck: {
          TableName: tableName,
          Key: { PK: tenantKey, SK: `SITE#${siteId}` },
          ConditionExpression: 'entityType = :entity AND tenantId = :tenantId AND siteId = :siteId',
          ExpressionAttributeValues: { ':entity': 'SITE', ':tenantId': tenantId, ':siteId': siteId },
        },
      },
      {
        ConditionCheck: {
          TableName: tableName,
          Key: { PK: tenantKey, SK: `MODEL#${modelId}` },
          ConditionExpression: 'entityType = :entity AND tenantId = :tenantId AND modelId = :modelId',
          ExpressionAttributeValues: { ':entity': 'GATEWAY_MODEL', ':tenantId': tenantId, ':modelId': modelId },
        },
      },
      {
        ConditionCheck: {
          TableName: tableName,
          Key: { PK: profileItem.PK, SK: profileItem.SK },
          ConditionExpression: 'entityType = :entity AND tenantId = :tenantId AND profileVersionId = :profileVersionId AND modelId = :modelId',
          ExpressionAttributeValues: {
            ':entity': 'PROFILE_VERSION', ':tenantId': tenantId,
            ':profileVersionId': profileVersionId, ':modelId': modelId,
          },
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: {
            PK: `SERIAL#${serialNumber}`,
            SK: 'MANUFACTURING',
            entityType: 'MANUFACTURING',
            serialNumber,
            tenantId,
            modelId,
            allowedSiteIds: [siteId],
            demoExpectedProfileVersionId: profileVersionId,
            demoExpectedDeliveryMode: deliveryMode,
            claimMechanism: BOOTSTRAP_MECHANISM,
            bootstrapCertificateId,
            bootstrapCertificateArn: certificateArn,
            bootstrapCertificateStatus: BOOTSTRAP_STATUS,
            bootstrapPolicyName,
            state: 'CLAIMABLE',
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: {
            PK: certificateBindingKey,
            SK: 'BINDING',
            entityType: 'BOOTSTRAP_CERTIFICATE_BINDING',
            bootstrapCertificateId,
            certificateArn,
            serialNumber,
            tenantId,
            status: BOOTSTRAP_STATUS,
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ],
  }));

  console.log(`Bound unique bootstrap certificate ${bootstrapCertificateId} to ${serialNumber}.`);
  console.log('Next: complete the serial, site, and profile steps in the onboarding UI and stop at ENROLLMENT_PENDING.');
}

async function validateAwsBootstrapCertificate(
  iot: IoTClient,
  certificateId: string,
  expectedPolicyName: string,
  localCertificate: X509Certificate,
): Promise<string> {
  const description = await iot.send(new DescribeCertificateCommand({ certificateId }));
  const certificate = description.certificateDescription;
  if (!certificate || certificate.certificateId !== certificateId || !certificate.certificateArn) {
    throw new Error('AWS IoT returned an incomplete or mismatched certificate description');
  }
  if (certificate.status !== 'ACTIVE') throw new Error('Bootstrap certificate must be ACTIVE in AWS IoT');
  if (!certificate.certificatePem) throw new Error('AWS IoT did not return the bootstrap public certificate');
  const awsCertificate = parseCertificate(certificate.certificatePem, 'AWS IoT bootstrap certificate');
  if (localCertificate.raw.length !== awsCertificate.raw.length
    || !timingSafeEqual(localCertificate.raw, awsCertificate.raw)) {
    throw new Error('The public certificate file does not match the specified AWS IoT certificate ID');
  }
  const now = Date.now();
  if (new Date(localCertificate.validFrom).getTime() > now || new Date(localCertificate.validTo).getTime() <= now) {
    throw new Error('Bootstrap certificate is outside its validity period');
  }

  const policies = await listAttachedPolicies(iot, certificate.certificateArn);
  if (policies.length !== 1 || policies[0] !== expectedPolicyName) {
    throw new Error(`Bootstrap certificate must have only the ${expectedPolicyName} policy attached`);
  }
  const things = await listPrincipalThings(iot, certificate.certificateArn);
  if (things.length > 0) throw new Error('Bootstrap certificate must not already be attached to an AWS IoT Thing');
  return certificate.certificateArn;
}

async function listAttachedPolicies(iot: IoTClient, target: string): Promise<string[]> {
  const result: string[] = [];
  let marker: string | undefined;
  do {
    const page = await iot.send(new ListAttachedPoliciesCommand({ target, marker, pageSize: 100 }));
    for (const policy of page.policies ?? []) {
      if (policy.policyName) result.push(policy.policyName);
    }
    marker = page.nextMarker;
  } while (marker);
  return result.sort();
}

async function listPrincipalThings(iot: IoTClient, principal: string): Promise<string[]> {
  const result: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await iot.send(new ListPrincipalThingsV2Command({ principal, nextToken, maxResults: 250 }));
    for (const thing of page.principalThingObjects ?? []) if (thing.thingName) result.push(thing.thingName);
    nextToken = page.nextToken;
  } while (nextToken);
  return result;
}

async function assertCertificateNotPresentInLegacyInventory(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  certificateId: string,
): Promise<void> {
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#bootstrapCertificateId = :certificateId OR #legacyClaimCertificateId = :certificateId',
      ProjectionExpression: 'PK, SK, serialNumber',
      ExpressionAttributeNames: {
        '#bootstrapCertificateId': 'bootstrapCertificateId',
        '#legacyClaimCertificateId': 'claimCertificateId',
      },
      ExpressionAttributeValues: { ':certificateId': certificateId },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    if ((page.Items?.length ?? 0) > 0) throw new Error(`Bootstrap certificate ${certificateId} is already present in inventory`);
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
}

function validateTenantData(
  actual: { tenant?: Record<string, unknown>; site?: Record<string, unknown>; model?: Record<string, unknown>; profile?: Record<string, unknown> },
  expected: { tenantId: string; siteId: string; modelId: string; profileVersionId: string },
): void {
  if (actual.tenant?.entityType !== 'TENANT' || actual.tenant.tenantId !== expected.tenantId) {
    throw new Error(`Tenant ${expected.tenantId} is unavailable`);
  }
  if (actual.site?.entityType !== 'SITE' || actual.site.tenantId !== expected.tenantId || actual.site.siteId !== expected.siteId) {
    throw new Error(`Site ${expected.siteId} is unavailable for tenant ${expected.tenantId}`);
  }
  if (actual.model?.entityType !== 'GATEWAY_MODEL' || actual.model.tenantId !== expected.tenantId
    || actual.model.modelId !== expected.modelId) {
    throw new Error(`Gateway model ${expected.modelId} is unavailable for tenant ${expected.tenantId}`);
  }
  if (actual.profile?.entityType !== 'PROFILE_VERSION' || actual.profile.tenantId !== expected.tenantId
    || actual.profile.profileVersionId !== expected.profileVersionId || actual.profile.modelId !== expected.modelId) {
    throw new Error(`Profile version ${expected.profileVersionId} is unavailable or incompatible with ${expected.modelId}`);
  }
}

async function readPublicCertificate(path: string): Promise<X509Certificate> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('bootstrap-certificate-file must be a regular file');
  const value = await readFile(path, 'utf8');
  if (/PRIVATE KEY/.test(value)) throw new Error('bootstrap-certificate-file must not contain private key material');
  return parseCertificate(value, 'bootstrap-certificate-file');
}

function parseCertificate(value: string, label: string): X509Certificate {
  try {
    return new X509Certificate(value);
  } catch {
    throw new Error(`${label} is not a valid X.509 certificate`);
  }
}

function required(name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

function requireCertificateId(value: string): string {
  if (!CERTIFICATE_ID_PATTERN.test(value)) throw new Error('bootstrap-certificate-id must be a 64-character hexadecimal ID');
  return value.toLowerCase();
}

function requireRegion(value: string): string {
  const region = value.trim();
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) throw new Error('region is invalid');
  return region;
}

function requireDeliveryMode(value: string): 'SHADOW' {
  if (value !== 'SHADOW') throw new Error('delivery-mode must be SHADOW for initial onboarding');
  return value;
}
