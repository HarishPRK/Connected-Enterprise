import { createHash, randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import {
  DescribeCertificateCommand,
  DescribeThingCommand,
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

/**
 * Development-only ledger recycler for a normally decommissioned demo serial.
 * Prerequisite: an operator must first remove the exact retired operational
 * certificate and deterministic Thing from AWS IoT. This script verifies that
 * absence but intentionally never mutates AWS IoT resources.
 */
const CERTIFICATE_ID_PATTERN = /^[a-f0-9]{64}$/i;
const BOOTSTRAP_MECHANISM = 'PRELOADED_UNIQUE_BOOTSTRAP';
const DEV_TABLE_NAME = 'connected-enterprise-onboarding-dev';
const DEV_BOOTSTRAP_POLICY_NAME = 'ConnectedEnterpriseGatewayBootstrap-dev-v1';
const args = process.argv.slice(2);

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Demo gateway recycle failed: ${message.replace(/[\r\n]+/g, ' ').slice(0, 800)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const apply = args.includes('--apply');
  const region = requireRegion(required('--region'));
  const tableName = requireSafeIdentifier(required('--table'), 'table', 255);
  if (tableName !== DEV_TABLE_NAME) throw new Error(`This lab-only tool can target only ${DEV_TABLE_NAME}`);

  const tenantId = requireSafeIdentifier(required('--tenant-id'), 'tenant-id');
  const serialNumber = requireCanonicalSerial(required('--serial'));
  if (required('--confirm-serial') !== serialNumber) throw new Error('confirm-serial must exactly match serial');
  const modelId = requireSafeIdentifier(required('--model-id'), 'model-id');
  const siteId = requireSafeIdentifier(required('--site-id'), 'site-id');
  const profileVersionId = requireSafeIdentifier(required('--profile-version-id'), 'profile-version-id');
  const deliveryMode = requireDeliveryMode(required('--delivery-mode'));
  const oldBootstrapCertificateId = requireCertificateId(required('--old-bootstrap-certificate-id'));
  const oldOperationalCertificateId = requireCertificateId(required('--old-operational-certificate-id'));
  const oldOnboardingOperationId = requireSafeIdentifier(required('--old-onboarding-operation-id'), 'old-onboarding-operation-id');
  const decommissionOperationId = requireSafeIdentifier(required('--decommission-operation-id'), 'decommission-operation-id');
  const newBootstrapCertificateId = requireCertificateId(required('--new-bootstrap-certificate-id'));
  if (newBootstrapCertificateId === oldBootstrapCertificateId
    || newBootstrapCertificateId === oldOperationalCertificateId) {
    throw new Error('The replacement bootstrap certificate must be a newly issued certificate');
  }
  const newBootstrapCertificateFile = required('--new-bootstrap-certificate-file');
  const bootstrapPolicyName = requireSafeIdentifier(required('--bootstrap-policy'), 'bootstrap-policy', 128);
  if (bootstrapPolicyName !== DEV_BOOTSTRAP_POLICY_NAME) {
    throw new Error(`bootstrap-policy must be exactly ${DEV_BOOTSTRAP_POLICY_NAME}`);
  }
  const reason = required('--reason').trim();
  if (reason.length < 10 || reason.length > 240 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new Error('reason must contain 10-240 printable characters');
  }

  const gatewayId = `gw_${sha256(serialNumber).slice(0, 24)}`;
  const thingName = `gw-${sha256(serialNumber).slice(0, 24)}`;
  if (requireSafeIdentifier(required('--old-thing-name'), 'old-thing-name') !== thingName) {
    throw new Error(`old-thing-name must exactly match the deterministic Thing ${thingName}`);
  }
  const tenantKey = `TENANT#${tenantId}`;
  const gatewayKey = `GATEWAY#${gatewayId}`;
  const deploymentKey = `DEPLOYMENT#${gatewayId}#000000000001`;
  const oldBindingKey = `BOOTSTRAPCERT#${oldBootstrapCertificateId}`;
  const newBindingKey = `BOOTSTRAPCERT#${newBootstrapCertificateId}`;

  const localCertificate = await readPublicCertificate(newBootstrapCertificateFile);
  const iot = new IoTClient({ region });
  const newBootstrapCertificateArn = await validateNewBootstrapCertificate(
    iot,
    newBootstrapCertificateId,
    bootstrapPolicyName,
    localCertificate,
  );

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const [manufacturingResult, gatewayResult, deploymentResult, oldBindingResult, newBindingResult, tenantResult] = await Promise.all([
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: `SERIAL#${serialNumber}`, SK: 'MANUFACTURING' },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: tenantKey, SK: gatewayKey },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: tenantKey, SK: deploymentKey },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: oldBindingKey, SK: 'BINDING' },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: newBindingKey, SK: 'BINDING' },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({
      TableName: tableName,
      Key: { PK: tenantKey, SK: 'METADATA' },
      ConsistentRead: true,
    })),
  ]);

  if (newBindingResult.Item) throw new Error('Replacement bootstrap certificate already has a binding');
  const manufacturing = requireItem(manufacturingResult.Item, 'manufacturing record');
  const gateway = requireItem(gatewayResult.Item, 'gateway record');
  const deployment = requireItem(deploymentResult.Item, 'generation-1 deployment');
  const oldBinding = requireItem(oldBindingResult.Item, 'retired bootstrap binding');
  const tenant = requireItem(tenantResult.Item, 'tenant record');

  validateAuthoritativeState({
    manufacturing,
    gateway,
    deployment,
    oldBinding,
    tenant,
  }, {
    tenantId,
    serialNumber,
    gatewayId,
    thingName,
    modelId,
    oldBootstrapCertificateId,
    oldOperationalCertificateId,
    oldOnboardingOperationId,
    decommissionOperationId,
    profileVersionId,
  });
  await Promise.all([
    assertRetiredIotIdentityAbsent(iot, oldOperationalCertificateId, thingName),
    assertNoPendingOutboxOrActiveLease(ddb, tableName, tenantKey, gatewayId),
    assertNoAdditionalDeployments(ddb, tableName, tenantKey, gatewayId, deploymentKey),
    assertCertificateAbsentFromInventory(ddb, tableName, newBootstrapCertificateId),
    validateSiteAndProfile(ddb, tableName, tenantKey, tenantId, siteId, modelId, profileVersionId),
  ]);
  const previousRecommissionCount = Number(manufacturing.recommissionCount ?? 0);
  if (!Number.isSafeInteger(previousRecommissionCount) || previousRecommissionCount < 0) {
    throw new Error('Existing recommissionCount is invalid');
  }
  const recommissionCount = previousRecommissionCount + 1;
  const observedManufacturingUpdatedAt = requireStoredText(manufacturing.updatedAt, 'manufacturing updatedAt');
  const observedGatewayUpdatedAt = requireStoredText(gateway.updatedAt, 'gateway updatedAt');
  const observedDeploymentUpdatedAt = requireStoredText(deployment.updatedAt, 'deployment updatedAt');
  const observedBindingUpdatedAt = requireStoredText(oldBinding.updatedAt, 'retired binding updatedAt');
  const observedDeploymentStatus = requireStoredText(deployment.status, 'deployment status');

  if (!apply) {
    console.log(`Validated decommissioned demo gateway ${serialNumber} for a guarded same-serial recycle.`);
    console.log(`Replacement bootstrap certificate: ${newBootstrapCertificateId}.`);
    console.log('Re-run with the same arguments plus --apply to archive the old projections and create a new CLAIMABLE binding.');
    return;
  }

  const now = new Date().toISOString();
  const archiveId = `recommission_${now.replace(/[:.]/g, '-')}_${randomUUID()}`;
  const auditId = `lab_recommission_${randomUUID()}`;
  const baseArchive = `ARCHIVE#${archiveId}`;

  // Re-check external state immediately before the transaction. The DynamoDB
  // writes below are then fenced by the exact updatedAt values read above.
  const refreshedCertificateArn = await validateNewBootstrapCertificate(
    iot,
    newBootstrapCertificateId,
    bootstrapPolicyName,
    localCertificate,
  );
  if (refreshedCertificateArn !== newBootstrapCertificateArn) {
    throw new Error('Replacement bootstrap certificate ARN changed during validation');
  }
  await Promise.all([
    assertRetiredIotIdentityAbsent(iot, oldOperationalCertificateId, thingName),
    assertNoPendingOutboxOrActiveLease(ddb, tableName, tenantKey, gatewayId),
    assertNoAdditionalDeployments(ddb, tableName, tenantKey, gatewayId, deploymentKey),
    assertCertificateAbsentFromInventory(ddb, tableName, newBootstrapCertificateId),
  ]);

  const cleanManufacturing = {
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
    bootstrapCertificateId: newBootstrapCertificateId,
    bootstrapCertificateArn: newBootstrapCertificateArn,
    bootstrapCertificateStatus: 'ACTIVE',
    bootstrapPolicyName,
    state: 'CLAIMABLE',
    recommissionCount,
    recommissionedAt: now,
    createdAt: now,
    updatedAt: now,
    ...staticManufacturingFields(manufacturing),
  };

  await ddb.send(new TransactWriteCommand({ TransactItems: [
    {
      ConditionCheck: {
        TableName: tableName,
        Key: { PK: oldBindingKey, SK: 'BINDING' },
        ConditionExpression: 'entityType = :entity AND bootstrapCertificateId = :certificateId AND serialNumber = :serial AND tenantId = :tenant AND #status = :inactive AND updatedAt = :observedUpdatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':entity': 'BOOTSTRAP_CERTIFICATE_BINDING', ':certificateId': oldBootstrapCertificateId,
          ':serial': serialNumber, ':tenant': tenantId, ':inactive': 'INACTIVE',
          ':observedUpdatedAt': observedBindingUpdatedAt,
        },
      },
    },
    {
      Put: {
        TableName: tableName,
        Item: cleanManufacturing,
        ConditionExpression: [
          'entityType = :manufacturing', '#state = :decommissioned', 'serialNumber = :serial',
          'tenantId = :tenant', 'gatewayId = :gatewayId', 'thingName = :thingName',
          'certificateId = :oldOperationalId', 'certificateStatus = :revoked',
          'bootstrapCertificateId = :oldBootstrapId', 'bootstrapCertificateStatus = :inactive',
          'operationId = :oldOnboardingOperationId', 'updatedAt = :observedUpdatedAt',
        ].join(' AND '),
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':manufacturing': 'MANUFACTURING', ':decommissioned': 'DECOMMISSIONED',
          ':serial': serialNumber, ':tenant': tenantId, ':gatewayId': gatewayId, ':thingName': thingName,
          ':oldOperationalId': oldOperationalCertificateId, ':revoked': 'REVOKED',
          ':oldBootstrapId': oldBootstrapCertificateId, ':inactive': 'INACTIVE',
          ':oldOnboardingOperationId': oldOnboardingOperationId,
          ':observedUpdatedAt': observedManufacturingUpdatedAt,
        },
      },
    },
    {
      Put: {
        TableName: tableName,
        Item: {
          PK: newBindingKey,
          SK: 'BINDING',
          entityType: 'BOOTSTRAP_CERTIFICATE_BINDING',
          bootstrapCertificateId: newBootstrapCertificateId,
          certificateArn: newBootstrapCertificateArn,
          serialNumber,
          tenantId,
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    {
      Delete: {
        TableName: tableName,
        Key: { PK: tenantKey, SK: gatewayKey },
        ConditionExpression: 'entityType = :gateway AND #state = :decommissioned AND serialNumber = :serial AND gatewayId = :gatewayId AND thingName = :thingName AND certificateId = :certificateId AND certificateStatus = :revoked AND generation = :generation AND operationId = :operationId AND updatedAt = :observedUpdatedAt',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY', ':decommissioned': 'DECOMMISSIONED', ':serial': serialNumber,
          ':gatewayId': gatewayId, ':thingName': thingName, ':certificateId': oldOperationalCertificateId,
          ':revoked': 'REVOKED', ':generation': Number(gateway.generation), ':operationId': decommissionOperationId,
          ':observedUpdatedAt': observedGatewayUpdatedAt,
        },
      },
    },
    {
      Delete: {
        TableName: tableName,
        Key: { PK: tenantKey, SK: deploymentKey },
        ConditionExpression: 'entityType = :deployment AND gatewayId = :gatewayId AND generation = :generation AND operationId = :operationId AND profileVersionId = :profileVersionId AND #status = :observedStatus AND updatedAt = :observedUpdatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':deployment': 'DEPLOYMENT', ':gatewayId': gatewayId, ':generation': 1,
          ':operationId': oldOnboardingOperationId, ':profileVersionId': profileVersionId,
          ':observedStatus': observedDeploymentStatus, ':observedUpdatedAt': observedDeploymentUpdatedAt,
        },
      },
    },
    archivePut(tableName, tenantKey, `${baseArchive}#MANUFACTURING`, 'ARCHIVED_MANUFACTURING', manufacturing, now),
    archivePut(tableName, tenantKey, `${baseArchive}#GATEWAY`, 'ARCHIVED_GATEWAY', gateway, now),
    archivePut(tableName, tenantKey, `${baseArchive}#DEPLOYMENT#000000000001`, 'ARCHIVED_DEPLOYMENT', deployment, now),
    {
      Put: {
        TableName: tableName,
        Item: {
          PK: tenantKey,
          SK: `AUDIT#${now}#${auditId}`,
          entityType: 'AUDIT',
          auditId,
          tenantId,
          actorSubject: 'OPERATOR#LAB_RECOMMISSION_TOOL',
          actorRole: 'tenant_admin',
          action: 'LAB_GATEWAY_RECOMMISSIONED',
          targetId: gatewayId,
          details: {
            serialNumber,
            reason,
            archiveId,
            oldBootstrapCertificateId,
            oldOperationalCertificateId,
            newBootstrapCertificateId,
          },
          outcome: 'SUCCESS',
          createdAt: now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
  ] }));

  console.log(`Recycled ${serialNumber} to CLAIMABLE with bootstrap certificate ${newBootstrapCertificateId}.`);
  console.log(`Archived the previous manufacturing, gateway, and deployment projections as ${archiveId}.`);
  console.log('Next: use the hosted UI to verify this serial and start secure activation before powering on the gateway.');
}

function validateAuthoritativeState(
  actual: {
    manufacturing: Record<string, unknown>;
    gateway: Record<string, unknown>;
    deployment: Record<string, unknown>;
    oldBinding: Record<string, unknown>;
    tenant: Record<string, unknown>;
  },
  expected: {
    tenantId: string;
    serialNumber: string;
    gatewayId: string;
    thingName: string;
    modelId: string;
    oldBootstrapCertificateId: string;
    oldOperationalCertificateId: string;
    oldOnboardingOperationId: string;
    decommissionOperationId: string;
    profileVersionId: string;
  },
): void {
  const { manufacturing, gateway, deployment, oldBinding, tenant } = actual;
  if (tenant.entityType !== 'TENANT' || tenant.tenantId !== expected.tenantId) throw new Error('Tenant record does not match');
  if (manufacturing.entityType !== 'MANUFACTURING'
    || manufacturing.state !== 'DECOMMISSIONED'
    || manufacturing.serialNumber !== expected.serialNumber
    || manufacturing.tenantId !== expected.tenantId
    || manufacturing.gatewayId !== expected.gatewayId
    || manufacturing.thingName !== expected.thingName
    || manufacturing.modelId !== expected.modelId
    || manufacturing.certificateId !== expected.oldOperationalCertificateId
    || manufacturing.certificateStatus !== 'REVOKED'
    || manufacturing.bootstrapCertificateId !== expected.oldBootstrapCertificateId
    || manufacturing.bootstrapCertificateStatus !== 'INACTIVE'
    || manufacturing.operationId !== expected.oldOnboardingOperationId) {
    throw new Error('Manufacturing record is not the exact decommissioned identity requested');
  }
  if (gateway.entityType !== 'GATEWAY'
    || gateway.state !== 'DECOMMISSIONED'
    || gateway.serialNumber !== expected.serialNumber
    || gateway.tenantId !== expected.tenantId
    || gateway.gatewayId !== expected.gatewayId
    || gateway.thingName !== expected.thingName
    || gateway.certificateId !== expected.oldOperationalCertificateId
    || gateway.certificateStatus !== 'REVOKED'
    || gateway.operationId !== expected.decommissionOperationId
    || !Number.isSafeInteger(gateway.generation)
    || Number(gateway.generation) < 2) {
    throw new Error('Gateway record is not the exact terminal decommission projection requested');
  }
  if (deployment.entityType !== 'DEPLOYMENT'
    || deployment.gatewayId !== expected.gatewayId
    || deployment.operationId !== expected.oldOnboardingOperationId
    || Number(deployment.generation) !== 1
    || deployment.profileVersionId !== expected.profileVersionId
    || deployment.status !== 'APPLIED_HEALTHY') {
    throw new Error('Generation-1 deployment is not the expected terminal deployment');
  }
  if (oldBinding.entityType !== 'BOOTSTRAP_CERTIFICATE_BINDING'
    || oldBinding.bootstrapCertificateId !== expected.oldBootstrapCertificateId
    || oldBinding.serialNumber !== expected.serialNumber
    || oldBinding.tenantId !== expected.tenantId
    || oldBinding.status !== 'INACTIVE') {
    throw new Error('Retired bootstrap certificate binding does not match');
  }
  const nowEpoch = Math.floor(Date.now() / 1000);
  assertNoActiveLeaseFields(manufacturing, 'manufacturing record', nowEpoch);
  assertNoActiveLeaseFields(gateway, 'gateway record', nowEpoch);
}

async function validateSiteAndProfile(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  tenantKey: string,
  tenantId: string,
  siteId: string,
  modelId: string,
  profileVersionId: string,
): Promise<void> {
  const [site, model, profile] = await Promise.all([
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
  if (site.Item?.entityType !== 'SITE' || site.Item.tenantId !== tenantId || site.Item.siteId !== siteId) {
    throw new Error('Requested site is not authoritative for the tenant');
  }
  if (model.Item?.entityType !== 'GATEWAY_MODEL' || model.Item.tenantId !== tenantId || model.Item.modelId !== modelId) {
    throw new Error('Requested model is not authoritative for the tenant');
  }
  const profileItem = profile.Items?.[0];
  if (profileItem?.entityType !== 'PROFILE_VERSION'
    || profileItem.tenantId !== tenantId
    || profileItem.profileVersionId !== profileVersionId
    || profileItem.modelId !== modelId) {
    throw new Error('Requested profile version is unavailable or incompatible');
  }
}

async function assertRetiredIotIdentityAbsent(
  iot: IoTClient,
  certificateId: string,
  thingName: string,
): Promise<void> {
  try {
    await iot.send(new DescribeCertificateCommand({ certificateId }));
    throw new Error(`Retired operational certificate ${certificateId} still exists; delete it before recycling`);
  } catch (error) {
    if (errorName(error) !== 'ResourceNotFoundException') throw error;
  }

  try {
    await iot.send(new DescribeThingCommand({ thingName }));
    throw new Error(`Retired Thing ${thingName} still exists; delete it before recycling`);
  } catch (error) {
    if (errorName(error) !== 'ResourceNotFoundException') throw error;
  }
}

async function validateNewBootstrapCertificate(
  iot: IoTClient,
  certificateId: string,
  policyName: string,
  localCertificate: X509Certificate,
): Promise<string> {
  const result = await iot.send(new DescribeCertificateCommand({ certificateId }));
  const certificate = result.certificateDescription;
  if (!certificate?.certificateArn || !certificate.certificatePem || certificate.certificateId !== certificateId) {
    throw new Error('AWS returned an incomplete replacement bootstrap certificate');
  }
  if (certificate.status !== 'ACTIVE') throw new Error('Replacement bootstrap certificate must be ACTIVE');
  const awsCertificate = parseCertificate(certificate.certificatePem, 'AWS replacement bootstrap certificate');
  if (localCertificate.raw.length !== awsCertificate.raw.length || !timingSafeEqual(localCertificate.raw, awsCertificate.raw)) {
    throw new Error('Replacement public certificate file does not match the AWS certificate ID');
  }
  const now = Date.now();
  if (new Date(localCertificate.validFrom).getTime() > now || new Date(localCertificate.validTo).getTime() <= now) {
    throw new Error('Replacement bootstrap certificate is outside its validity period');
  }
  const policies = await listAttachedPolicies(iot, certificate.certificateArn);
  if (policies.length !== 1 || policies[0] !== policyName) {
    throw new Error(`Replacement bootstrap certificate must have only ${policyName}`);
  }
  const things = await listPrincipalThings(iot, certificate.certificateArn);
  if (things.length !== 0) throw new Error('Replacement bootstrap certificate must not be attached to a Thing');
  return certificate.certificateArn;
}

async function assertNoPendingOutboxOrActiveLease(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  tenantKey: string,
  gatewayId: string,
): Promise<void> {
  const nowEpoch = Math.floor(Date.now() / 1000);
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :tenant AND begins_with(SK, :prefix)',
      FilterExpression: 'gatewayId = :gatewayId',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: {
        ':tenant': tenantKey,
        ':prefix': 'OUTBOX#',
        ':gatewayId': gatewayId,
      },
      ProjectionExpression: 'PK, SK, #state, dispatchLeaseId, dispatchLeaseExpiresAtEpoch',
      ExclusiveStartKey: exclusiveStartKey,
      ConsistentRead: true,
    }));
    for (const item of page.Items ?? []) {
      if (item.state === 'PENDING') throw new Error(`Gateway still has a pending outbox event at ${String(item.SK)}`);
      assertNoActiveLeaseFields(item, `outbox ${String(item.SK)}`, nowEpoch);
    }
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
}

async function assertNoAdditionalDeployments(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  tenantKey: string,
  gatewayId: string,
  expectedDeploymentSk: string,
): Promise<void> {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :tenant AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':tenant': tenantKey, ':prefix': `DEPLOYMENT#${gatewayId}#` },
    ProjectionExpression: 'PK, SK',
    ConsistentRead: true,
  }));
  if (result.LastEvaluatedKey || result.Items?.length !== 1 || result.Items[0]?.SK !== expectedDeploymentSk) {
    throw new Error('Gateway has additional deployment records; this generation-1-only recycler refuses the reset');
  }
}

async function assertCertificateAbsentFromInventory(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  certificateId: string,
): Promise<void> {
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#bootstrapCertificateId = :certificateId OR #certificateId = :certificateId OR #claimCertificateId = :certificateId',
      ProjectionExpression: 'PK, SK',
      ExpressionAttributeNames: {
        '#bootstrapCertificateId': 'bootstrapCertificateId',
        '#certificateId': 'certificateId',
        '#claimCertificateId': 'claimCertificateId',
      },
      ExpressionAttributeValues: { ':certificateId': certificateId },
      ExclusiveStartKey: exclusiveStartKey,
      ConsistentRead: true,
    }));
    if ((page.Items?.length ?? 0) > 0) throw new Error('Replacement certificate is already referenced in inventory');
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
}

async function listAttachedPolicies(iot: IoTClient, target: string): Promise<string[]> {
  const names: string[] = [];
  let marker: string | undefined;
  do {
    const page = await iot.send(new ListAttachedPoliciesCommand({ target, marker, pageSize: 100 }));
    for (const policy of page.policies ?? []) if (policy.policyName) names.push(policy.policyName);
    marker = page.nextMarker;
  } while (marker);
  return names.sort();
}

async function listPrincipalThings(iot: IoTClient, principal: string): Promise<string[]> {
  const names: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await iot.send(new ListPrincipalThingsV2Command({ principal, nextToken, maxResults: 250 }));
    for (const thing of page.principalThingObjects ?? []) if (thing.thingName) names.push(thing.thingName);
    nextToken = page.nextToken;
  } while (nextToken);
  return names;
}

function archivePut(
  tableName: string,
  tenantKey: string,
  sk: string,
  entityType: string,
  record: Record<string, unknown>,
  archivedAt: string,
) {
  return {
    Put: {
      TableName: tableName,
      Item: {
        PK: tenantKey,
        SK: sk,
        entityType,
        tenantId: String(record.tenantId ?? ''),
        archivedAt,
        sourceKey: { PK: record.PK, SK: record.SK },
        record: withoutIndexKeys(record),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    },
  };
}

function withoutIndexKeys(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'PK' || key === 'SK' || /^GSI\d+(?:PK|SK)$/.test(key)) continue;
    result[key] = value;
  }
  return result;
}

function staticManufacturingFields(record: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ['manufacturer', 'model', 'hardwareRevision', 'manufacturingBatch'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) result[key] = value;
  }
  return result;
}

function assertNoActiveLeaseFields(
  record: Record<string, unknown>,
  label: string,
  nowEpoch: number,
): void {
  const leaseId = record.dispatchLeaseId;
  const expiry = record.dispatchLeaseExpiresAtEpoch;
  if (leaseId === undefined && expiry === undefined) return;
  if (typeof leaseId !== 'string' || !leaseId
    || !Number.isSafeInteger(expiry) || Number(expiry) <= 0) {
    throw new Error(`${label} has an incomplete dispatch lease`);
  }
  if (Number(expiry) >= nowEpoch) throw new Error(`${label} has an active dispatch lease`);
}

async function readPublicCertificate(path: string): Promise<X509Certificate> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error('new-bootstrap-certificate-file must be a single-link regular file');
  }
  const value = await readFile(path, 'utf8');
  if (/PRIVATE KEY/.test(value)) throw new Error('new-bootstrap-certificate-file must not contain private key material');
  return parseCertificate(value, 'new-bootstrap-certificate-file');
}

function parseCertificate(value: string, label: string): X509Certificate {
  try {
    return new X509Certificate(value);
  } catch {
    throw new Error(`${label} is not a valid X.509 certificate`);
  }
}

function requireItem(item: Record<string, unknown> | undefined, label: string): Record<string, unknown> {
  if (!item) throw new Error(`${label} is missing`);
  return item;
}

function requireStoredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is missing or invalid`);
  return value;
}

function required(name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

function requireCertificateId(value: string): string {
  if (!CERTIFICATE_ID_PATTERN.test(value)) throw new Error('Certificate IDs must be 64 hexadecimal characters');
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : '';
}
