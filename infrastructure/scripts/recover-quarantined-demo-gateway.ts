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
 * Development-only recovery for the narrow partial-enrollment shape produced
 * by quarantine-stuck-provisioning.ts. AWS IoT cleanup and retirement of the
 * old bootstrap identity are explicit prerequisites; this tool verifies them
 * but never mutates an IoT certificate, Thing, policy, or connection.
 */
const CERTIFICATE_ID_PATTERN = /^[a-f0-9]{64}$/i;
const BOOTSTRAP_MECHANISM = 'PRELOADED_UNIQUE_BOOTSTRAP';
const DEV_TABLE_NAME = 'connected-enterprise-onboarding-dev';
const DEV_BOOTSTRAP_POLICY_NAME = 'ConnectedEnterpriseGatewayBootstrap-dev-v1';
const args = process.argv.slice(2);

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Quarantined demo recovery failed: ${message.replace(/[\r\n]+/g, ' ').slice(0, 800)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const apply = args.includes('--apply');
  const region = requireRegion(required('--region'));
  const tableName = requireSafeIdentifier(required('--table'), 'table', 255);
  if (tableName !== DEV_TABLE_NAME) throw new Error(`This recovery tool can target only ${DEV_TABLE_NAME}`);

  const tenantId = requireSafeIdentifier(required('--tenant-id'), 'tenant-id');
  const serialNumber = requireCanonicalSerial(required('--serial'));
  if (required('--confirm-serial') !== serialNumber) throw new Error('confirm-serial must exactly match serial');
  const modelId = requireSafeIdentifier(required('--model-id'), 'model-id');
  const siteId = requireSafeIdentifier(required('--site-id'), 'site-id');
  const profileVersionId = requireSafeIdentifier(required('--profile-version-id'), 'profile-version-id');
  const deliveryMode = requireDeliveryMode(required('--delivery-mode'));
  const gatewayId = requireSafeIdentifier(required('--gateway-id'), 'gateway-id');
  const thingName = requireSafeIdentifier(required('--thing-name'), 'thing-name');
  const onboardingOperationId = requireSafeIdentifier(required('--onboarding-operation-id'), 'onboarding-operation-id');
  const recoveryId = requireSafeIdentifier(required('--recovery-id'), 'recovery-id');
  const actor = requireSafeIdentifier(required('--actor'), 'actor');

  const deterministicGatewayId = `gw_${sha256(serialNumber).slice(0, 24)}`;
  const deterministicThingName = `gw-${sha256(serialNumber).slice(0, 24)}`;
  if (gatewayId !== deterministicGatewayId || thingName !== deterministicThingName) {
    throw new Error('gateway-id and thing-name must exactly match the deterministic serial identity');
  }

  const expectedUpdatedAt = {
    manufacturing: requireIsoTimestamp(required('--manufacturing-updated-at'), 'manufacturing-updated-at'),
    gateway: requireIsoTimestamp(required('--gateway-updated-at'), 'gateway-updated-at'),
    deployment: requireIsoTimestamp(required('--deployment-updated-at'), 'deployment-updated-at'),
    operation: requireIsoTimestamp(required('--operation-updated-at'), 'operation-updated-at'),
    oldBinding: requireIsoTimestamp(required('--old-binding-updated-at'), 'old-binding-updated-at'),
  };

  const oldBootstrapCertificateId = requireCertificateId(required('--old-bootstrap-certificate-id'));
  const oldOperationalCertificateId = requireCertificateId(required('--old-operational-certificate-id'));
  const newBootstrapCertificateId = requireCertificateId(required('--new-bootstrap-certificate-id'));
  if (newBootstrapCertificateId === oldBootstrapCertificateId
    || newBootstrapCertificateId === oldOperationalCertificateId) {
    throw new Error('The replacement bootstrap certificate must be newly issued');
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

  const tenantKey = `TENANT#${tenantId}`;
  const manufacturingKey = { PK: `SERIAL#${serialNumber}`, SK: 'MANUFACTURING' };
  const gatewayKey = { PK: tenantKey, SK: `GATEWAY#${gatewayId}` };
  const deploymentSk = `DEPLOYMENT#${gatewayId}#000000000001`;
  const deploymentKey = { PK: tenantKey, SK: deploymentSk };
  const operationKey = { PK: tenantKey, SK: `OPERATION#${onboardingOperationId}` };
  const oldBindingKey = { PK: `BOOTSTRAPCERT#${oldBootstrapCertificateId}`, SK: 'BINDING' };
  const newBindingPk = `BOOTSTRAPCERT#${newBootstrapCertificateId}`;

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

  const [manufacturingResult, gatewayResult, deploymentResult, operationResult,
    oldBindingResult, newBindingResult, tenantResult] = await Promise.all([
    consistentGet(ddb, tableName, manufacturingKey),
    consistentGet(ddb, tableName, gatewayKey),
    consistentGet(ddb, tableName, deploymentKey),
    consistentGet(ddb, tableName, operationKey),
    consistentGet(ddb, tableName, oldBindingKey),
    consistentGet(ddb, tableName, { PK: newBindingPk, SK: 'BINDING' }),
    consistentGet(ddb, tableName, { PK: tenantKey, SK: 'METADATA' }),
  ]);
  if (newBindingResult.Item) throw new Error('Replacement bootstrap certificate already has a binding');

  const manufacturing = requireItem(manufacturingResult.Item, 'manufacturing record');
  const gateway = requireItem(gatewayResult.Item, 'gateway record');
  const deployment = requireItem(deploymentResult.Item, 'generation-1 deployment');
  const operation = requireItem(operationResult.Item, 'onboarding operation');
  const oldBinding = requireItem(oldBindingResult.Item, 'old bootstrap binding');
  const tenant = requireItem(tenantResult.Item, 'tenant record');
  validateQuarantinedState({ manufacturing, gateway, deployment, operation, oldBinding, tenant }, {
    tenantId,
    serialNumber,
    modelId,
    siteId,
    profileVersionId,
    deliveryMode,
    gatewayId,
    thingName,
    onboardingOperationId,
    recoveryId,
    oldBootstrapCertificateId,
    oldOperationalCertificateId,
    expectedUpdatedAt,
  });

  await Promise.all([
    assertOldBootstrapInactive(iot, oldBootstrapCertificateId),
    assertRetiredOperationalIdentityAbsent(iot, oldOperationalCertificateId, thingName),
    assertNoPendingOutboxOrActiveLease(ddb, tableName, tenantKey, gatewayId),
    assertNoAdditionalDeployments(ddb, tableName, tenantKey, gatewayId, deploymentSk),
    assertCertificateAbsentFromInventory(ddb, tableName, newBootstrapCertificateId),
    validateSiteAndProfile(ddb, tableName, tenantKey, tenantId, siteId, modelId, profileVersionId),
  ]);

  const previousRecoveryRetryCount = requireCounter(manufacturing.recoveryRetryCount, 'recoveryRetryCount');
  const previousRecommissionCount = requireCounter(manufacturing.recommissionCount, 'recommissionCount');
  if (!apply) {
    console.log(`Validated quarantined partial onboarding ${onboardingOperationId} for ${serialNumber}.`);
    console.log(`Recovery lock: ${recoveryId}. Replacement bootstrap certificate: ${newBootstrapCertificateId}.`);
    console.log('No writes were made. Re-run the identical command with --apply only after reviewing every supplied CAS value.');
    return;
  }

  // Re-check every external/non-transactional prerequisite immediately before
  // the single DynamoDB transaction. DynamoDB records are additionally fenced
  // by the exact caller-reviewed updatedAt values.
  const refreshedArn = await validateNewBootstrapCertificate(
    iot,
    newBootstrapCertificateId,
    bootstrapPolicyName,
    localCertificate,
  );
  if (refreshedArn !== newBootstrapCertificateArn) throw new Error('Replacement certificate ARN changed');
  await Promise.all([
    assertOldBootstrapInactive(iot, oldBootstrapCertificateId),
    assertRetiredOperationalIdentityAbsent(iot, oldOperationalCertificateId, thingName),
    assertNoPendingOutboxOrActiveLease(ddb, tableName, tenantKey, gatewayId),
    assertNoAdditionalDeployments(ddb, tableName, tenantKey, gatewayId, deploymentSk),
    assertCertificateAbsentFromInventory(ddb, tableName, newBootstrapCertificateId),
  ]);

  const now = new Date().toISOString();
  const archiveId = `quarantine_retry_${now.replace(/[:.]/g, '-')}_${randomUUID()}`;
  const auditId = `quarantine_retry_${randomUUID()}`;
  const archivePrefix = `ARCHIVE#${archiveId}`;
  const cleanManufacturing = {
    PK: manufacturingKey.PK,
    SK: manufacturingKey.SK,
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
    recoveryRetryCount: previousRecoveryRetryCount + 1,
    recommissionCount: previousRecommissionCount,
    recoveredAt: now,
    createdAt: now,
    updatedAt: now,
    ...staticManufacturingFields(manufacturing),
  };

  await ddb.send(new TransactWriteCommand({ TransactItems: [
    {
      ConditionCheck: {
        TableName: tableName,
        Key: oldBindingKey,
        ConditionExpression: 'entityType = :binding AND bootstrapCertificateId = :oldBootstrapId AND serialNumber = :serial AND tenantId = :tenant AND #status = :inactive AND updatedAt = :bindingUpdatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':binding': 'BOOTSTRAP_CERTIFICATE_BINDING', ':oldBootstrapId': oldBootstrapCertificateId,
          ':serial': serialNumber, ':tenant': tenantId, ':inactive': 'INACTIVE',
          ':bindingUpdatedAt': expectedUpdatedAt.oldBinding,
        },
      },
    },
    {
      Put: {
        TableName: tableName,
        Item: cleanManufacturing,
        ConditionExpression: [
          'entityType = :manufacturing', '#state = :quarantined', 'serialNumber = :serial',
          'tenantId = :tenant', 'modelId = :model', 'siteId = :site', 'profileVersionId = :profile',
          'deliveryMode = :deliveryMode', 'gatewayId = :gatewayId', 'thingName = :thingName',
          'operationId = :operationId', 'recoveryId = :recoveryId',
          'certificateId = :oldOperationalId', 'certificateStatus = :inactive',
          'bootstrapCertificateId = :oldBootstrapId', 'bootstrapCertificateStatus = :inactive',
          'updatedAt = :manufacturingUpdatedAt',
        ].join(' AND '),
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':manufacturing': 'MANUFACTURING', ':quarantined': 'QUARANTINED', ':serial': serialNumber,
          ':tenant': tenantId, ':model': modelId, ':site': siteId, ':profile': profileVersionId,
          ':deliveryMode': deliveryMode, ':gatewayId': gatewayId, ':thingName': thingName,
          ':operationId': onboardingOperationId, ':recoveryId': recoveryId,
          ':oldOperationalId': oldOperationalCertificateId, ':oldBootstrapId': oldBootstrapCertificateId,
          ':inactive': 'INACTIVE', ':manufacturingUpdatedAt': expectedUpdatedAt.manufacturing,
        },
      },
    },
    {
      Put: {
        TableName: tableName,
        Item: {
          PK: newBindingPk,
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
        Key: gatewayKey,
        ConditionExpression: 'entityType = :gateway AND #state = :quarantined AND tenantId = :tenant AND serialNumber = :serial AND gatewayId = :gatewayId AND thingName = :thingName AND operationId = :operationId AND recoveryId = :recoveryId AND certificateId = :oldOperationalId AND certificateStatus = :inactive AND updatedAt = :gatewayUpdatedAt',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY', ':quarantined': 'QUARANTINED', ':tenant': tenantId,
          ':serial': serialNumber, ':gatewayId': gatewayId, ':thingName': thingName,
          ':operationId': onboardingOperationId, ':recoveryId': recoveryId,
          ':oldOperationalId': oldOperationalCertificateId, ':inactive': 'INACTIVE',
          ':gatewayUpdatedAt': expectedUpdatedAt.gateway,
        },
      },
    },
    {
      Delete: {
        TableName: tableName,
        Key: deploymentKey,
        ConditionExpression: 'entityType = :deployment AND tenantId = :tenant AND gatewayId = :gatewayId AND generation = :generation AND operationId = :operationId AND profileVersionId = :profile AND #status = :waiting AND updatedAt = :deploymentUpdatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':deployment': 'DEPLOYMENT', ':tenant': tenantId, ':gatewayId': gatewayId,
          ':generation': 1, ':operationId': onboardingOperationId, ':profile': profileVersionId,
          ':waiting': 'WAITING_FOR_DEVICE', ':deploymentUpdatedAt': expectedUpdatedAt.deployment,
        },
      },
    },
    {
      Update: {
        TableName: tableName,
        Key: operationKey,
        UpdateExpression: 'SET operationStatus = :failed, #state = :failed, #status = :failed, failure = :failure, recoveryId = :recoveryId, failedAt = :now, updatedAt = :now, steps[1] = :identityStep, timeline = list_append(if_not_exists(timeline, :empty), :events)',
        ConditionExpression: 'entityType = :operation AND #type = :onboard AND tenantId = :tenant AND operationId = :operationId AND gatewayId = :gatewayId AND serialNumber = :serial AND siteId = :site AND profileVersionId = :profile AND deliveryMode = :deliveryMode AND deploymentGeneration = :generation AND operationStatus = :inProgress AND #state = :csrVerified AND #status = :waiting AND attribute_exists(steps[1]) AND updatedAt = :operationUpdatedAt',
        ExpressionAttributeNames: { '#type': 'type', '#state': 'state', '#status': 'status' },
        ExpressionAttributeValues: {
          ':operation': 'OPERATION', ':onboard': 'ONBOARD', ':tenant': tenantId,
          ':operationId': onboardingOperationId, ':gatewayId': gatewayId, ':serial': serialNumber,
          ':site': siteId, ':profile': profileVersionId, ':deliveryMode': deliveryMode, ':generation': 1,
          ':inProgress': 'IN_PROGRESS', ':csrVerified': 'CSR_VERIFIED', ':waiting': 'WAITING_FOR_DEVICE',
          ':failed': 'FAILED', ':recoveryId': recoveryId, ':now': now, ':empty': [],
          ':events': [{ state: 'FAILED', at: now, detail: 'Quarantined partial onboarding was terminalized before a guarded retry.' }],
          ':failure': { code: 'QUARANTINED_ONBOARDING_RETRY', message: reason, recoveryId },
          ':identityStep': {
            key: 'identity', label: 'Permanent identity provisioned', status: 'error',
            detail: 'The partial identity was quarantined and retired before retry.', timestamp: now,
          },
          ':operationUpdatedAt': expectedUpdatedAt.operation,
        },
      },
    },
    archivePut(tableName, tenantKey, `${archivePrefix}#MANUFACTURING`, 'ARCHIVED_MANUFACTURING', manufacturing, now),
    archivePut(tableName, tenantKey, `${archivePrefix}#GATEWAY`, 'ARCHIVED_GATEWAY', gateway, now),
    archivePut(tableName, tenantKey, `${archivePrefix}#DEPLOYMENT#000000000001`, 'ARCHIVED_DEPLOYMENT', deployment, now),
    {
      Put: {
        TableName: tableName,
        Item: {
          PK: tenantKey,
          SK: `AUDIT#${now}#${auditId}`,
          entityType: 'AUDIT',
          auditId,
          tenantId,
          actorSubject: actor,
          actorRole: 'RECOVERY_OPERATOR',
          action: 'QUARANTINED_ONBOARDING_RECYCLED',
          targetId: gatewayId,
          details: {
            serialNumber,
            reason,
            archiveId,
            recoveryId,
            onboardingOperationId,
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

  console.log(`Recovered ${serialNumber} to CLAIMABLE with bootstrap certificate ${newBootstrapCertificateId}.`);
  console.log(`Archived quarantined projections as ${archiveId} and terminalized operation ${onboardingOperationId}.`);
}

async function consistentGet(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  key: { PK: string; SK: string },
) {
  return ddb.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
}

function validateQuarantinedState(
  actual: {
    manufacturing: Record<string, unknown>;
    gateway: Record<string, unknown>;
    deployment: Record<string, unknown>;
    operation: Record<string, unknown>;
    oldBinding: Record<string, unknown>;
    tenant: Record<string, unknown>;
  },
  expected: {
    tenantId: string;
    serialNumber: string;
    modelId: string;
    siteId: string;
    profileVersionId: string;
    deliveryMode: 'SHADOW';
    gatewayId: string;
    thingName: string;
    onboardingOperationId: string;
    recoveryId: string;
    oldBootstrapCertificateId: string;
    oldOperationalCertificateId: string;
    expectedUpdatedAt: Record<'manufacturing' | 'gateway' | 'deployment' | 'operation' | 'oldBinding', string>;
  },
): void {
  const { manufacturing, gateway, deployment, operation, oldBinding, tenant } = actual;
  if (tenant.entityType !== 'TENANT' || tenant.tenantId !== expected.tenantId) {
    throw new Error('Tenant record does not match');
  }
  if (manufacturing.entityType !== 'MANUFACTURING'
    || manufacturing.state !== 'QUARANTINED'
    || manufacturing.serialNumber !== expected.serialNumber
    || manufacturing.tenantId !== expected.tenantId
    || manufacturing.modelId !== expected.modelId
    || manufacturing.siteId !== expected.siteId
    || manufacturing.profileVersionId !== expected.profileVersionId
    || manufacturing.deliveryMode !== expected.deliveryMode
    || manufacturing.gatewayId !== expected.gatewayId
    || manufacturing.thingName !== expected.thingName
    || manufacturing.operationId !== expected.onboardingOperationId
    || manufacturing.recoveryId !== expected.recoveryId
    || manufacturing.certificateId !== expected.oldOperationalCertificateId
    || manufacturing.certificateStatus !== 'INACTIVE'
    || manufacturing.bootstrapCertificateId !== expected.oldBootstrapCertificateId
    || manufacturing.bootstrapCertificateStatus !== 'INACTIVE'
    || manufacturing.updatedAt !== expected.expectedUpdatedAt.manufacturing) {
    throw new Error('Manufacturing record is not the exact quarantined identity requested');
  }
  if (gateway.entityType !== 'GATEWAY'
    || gateway.state !== 'QUARANTINED'
    || gateway.tenantId !== expected.tenantId
    || gateway.serialNumber !== expected.serialNumber
    || gateway.modelId !== expected.modelId
    || gateway.siteId !== expected.siteId
    || gateway.desiredProfileVersionId !== expected.profileVersionId
    || gateway.gatewayId !== expected.gatewayId
    || gateway.thingName !== expected.thingName
    || gateway.operationId !== expected.onboardingOperationId
    || gateway.recoveryId !== expected.recoveryId
    || gateway.certificateId !== expected.oldOperationalCertificateId
    || gateway.certificateStatus !== 'INACTIVE'
    || Number(gateway.generation) !== 1
    || gateway.updatedAt !== expected.expectedUpdatedAt.gateway) {
    throw new Error('Gateway record is not the exact quarantined projection requested');
  }
  if (deployment.entityType !== 'DEPLOYMENT'
    || deployment.tenantId !== expected.tenantId
    || deployment.gatewayId !== expected.gatewayId
    || deployment.operationId !== expected.onboardingOperationId
    || deployment.profileVersionId !== expected.profileVersionId
    || Number(deployment.generation) !== 1
    || deployment.status !== 'WAITING_FOR_DEVICE'
    || deployment.updatedAt !== expected.expectedUpdatedAt.deployment) {
    throw new Error('Generation-1 deployment is not the exact waiting projection requested');
  }
  if (operation.entityType !== 'OPERATION'
    || operation.type !== 'ONBOARD'
    || operation.tenantId !== expected.tenantId
    || operation.operationId !== expected.onboardingOperationId
    || operation.gatewayId !== expected.gatewayId
    || operation.serialNumber !== expected.serialNumber
    || operation.siteId !== expected.siteId
    || operation.profileVersionId !== expected.profileVersionId
    || operation.deliveryMode !== expected.deliveryMode
    || Number(operation.deploymentGeneration) !== 1
    || operation.operationStatus !== 'IN_PROGRESS'
    || operation.state !== 'CSR_VERIFIED'
    || operation.status !== 'WAITING_FOR_DEVICE'
    || operation.updatedAt !== expected.expectedUpdatedAt.operation) {
    throw new Error('Onboarding operation is not the exact in-progress CSR_VERIFIED operation requested');
  }
  if (oldBinding.entityType !== 'BOOTSTRAP_CERTIFICATE_BINDING'
    || oldBinding.bootstrapCertificateId !== expected.oldBootstrapCertificateId
    || oldBinding.serialNumber !== expected.serialNumber
    || oldBinding.tenantId !== expected.tenantId
    || oldBinding.status !== 'INACTIVE'
    || oldBinding.updatedAt !== expected.expectedUpdatedAt.oldBinding) {
    throw new Error('Old bootstrap binding is not the exact inactive binding requested');
  }
  const nowEpoch = Math.floor(Date.now() / 1000);
  assertNoActiveLeaseFields(manufacturing, 'manufacturing record', nowEpoch);
  assertNoActiveLeaseFields(gateway, 'gateway record', nowEpoch);
}

async function assertOldBootstrapInactive(iot: IoTClient, certificateId: string): Promise<void> {
  const result = await iot.send(new DescribeCertificateCommand({ certificateId }));
  const certificate = result.certificateDescription;
  if (!certificate || certificate.certificateId !== certificateId || certificate.status !== 'INACTIVE') {
    throw new Error('Old bootstrap certificate must still exist in AWS IoT with status INACTIVE');
  }
}

async function assertRetiredOperationalIdentityAbsent(
  iot: IoTClient,
  certificateId: string,
  thingName: string,
): Promise<void> {
  try {
    await iot.send(new DescribeCertificateCommand({ certificateId }));
    throw new Error(`Old operational certificate ${certificateId} still exists`);
  } catch (error) {
    if (errorName(error) !== 'ResourceNotFoundException') throw error;
  }
  try {
    await iot.send(new DescribeThingCommand({ thingName }));
    throw new Error(`Old Thing ${thingName} still exists`);
  } catch (error) {
    if (errorName(error) !== 'ResourceNotFoundException') throw error;
  }
}

async function validateNewBootstrapCertificate(
  iot: IoTClient,
  certificateId: string,
  expectedPolicyName: string,
  localCertificate: X509Certificate,
): Promise<string> {
  const result = await iot.send(new DescribeCertificateCommand({ certificateId }));
  const certificate = result.certificateDescription;
  if (!certificate?.certificateArn || !certificate.certificatePem || certificate.certificateId !== certificateId) {
    throw new Error('AWS IoT returned an incomplete replacement bootstrap certificate');
  }
  if (certificate.status !== 'ACTIVE') throw new Error('Replacement bootstrap certificate must be ACTIVE');
  const awsCertificate = parseCertificate(certificate.certificatePem, 'AWS replacement bootstrap certificate');
  if (localCertificate.raw.length !== awsCertificate.raw.length
    || !timingSafeEqual(localCertificate.raw, awsCertificate.raw)) {
    throw new Error('Replacement public certificate file does not match its AWS certificate ID');
  }
  const now = Date.now();
  if (new Date(localCertificate.validFrom).getTime() > now || new Date(localCertificate.validTo).getTime() <= now) {
    throw new Error('Replacement bootstrap certificate is outside its validity period');
  }
  const policies = await listAttachedPolicies(iot, certificate.certificateArn);
  if (policies.length !== 1 || policies[0] !== expectedPolicyName) {
    throw new Error(`Replacement certificate must have only ${expectedPolicyName}`);
  }
  if ((await listPrincipalThings(iot, certificate.certificateArn)).length !== 0) {
    throw new Error('Replacement bootstrap certificate must not be attached to a Thing');
  }
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
      ExpressionAttributeValues: { ':tenant': tenantKey, ':prefix': 'OUTBOX#', ':gatewayId': gatewayId },
      ProjectionExpression: 'PK, SK, #state, dispatchLeaseId, dispatchLeaseExpiresAtEpoch',
      ExclusiveStartKey: exclusiveStartKey,
      ConsistentRead: true,
    }));
    for (const item of page.Items ?? []) {
      if (item.state === 'PENDING') throw new Error(`Gateway has a pending outbox event at ${String(item.SK)}`);
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
  expectedSk: string,
): Promise<void> {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :tenant AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':tenant': tenantKey, ':prefix': `DEPLOYMENT#${gatewayId}#` },
    ProjectionExpression: 'PK, SK',
    ConsistentRead: true,
  }));
  if (result.LastEvaluatedKey || result.Items?.length !== 1 || result.Items[0]?.SK !== expectedSk) {
    throw new Error('Recovery supports exactly one generation-1 deployment record');
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
      FilterExpression: '#bootstrap = :certificateId OR #operational = :certificateId OR #legacy = :certificateId',
      ProjectionExpression: 'PK, SK',
      ExpressionAttributeNames: {
        '#bootstrap': 'bootstrapCertificateId',
        '#operational': 'certificateId',
        '#legacy': 'claimCertificateId',
      },
      ExpressionAttributeValues: { ':certificateId': certificateId },
      ExclusiveStartKey: exclusiveStartKey,
      ConsistentRead: true,
    }));
    if ((page.Items?.length ?? 0) > 0) throw new Error('Replacement certificate is already referenced in inventory');
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
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
    consistentGet(ddb, tableName, { PK: tenantKey, SK: `SITE#${siteId}` }),
    consistentGet(ddb, tableName, { PK: tenantKey, SK: `MODEL#${modelId}` }),
    ddb.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :profile AND GSI2SK = :tenant',
      ExpressionAttributeValues: { ':profile': `PROFILEVERSION#${profileVersionId}`, ':tenant': tenantKey },
      Limit: 1,
    })),
  ]);
  if (site.Item?.entityType !== 'SITE' || site.Item.tenantId !== tenantId || site.Item.siteId !== siteId) {
    throw new Error('Site is not authoritative for the tenant');
  }
  if (model.Item?.entityType !== 'GATEWAY_MODEL' || model.Item.tenantId !== tenantId || model.Item.modelId !== modelId) {
    throw new Error('Gateway model is not authoritative for the tenant');
  }
  const profileItem = profile.Items?.[0];
  if (profileItem?.entityType !== 'PROFILE_VERSION' || profileItem.tenantId !== tenantId
    || profileItem.profileVersionId !== profileVersionId || profileItem.modelId !== modelId) {
    throw new Error('Profile version is unavailable or incompatible');
  }
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

function assertNoActiveLeaseFields(record: Record<string, unknown>, label: string, nowEpoch: number): void {
  const leaseId = record.dispatchLeaseId;
  const expiry = record.dispatchLeaseExpiresAtEpoch;
  if (leaseId === undefined && expiry === undefined) return;
  if (typeof leaseId !== 'string' || !leaseId || !Number.isSafeInteger(expiry) || Number(expiry) <= 0) {
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

function required(name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

function requireItem(item: Record<string, unknown> | undefined, label: string): Record<string, unknown> {
  if (!item) throw new Error(`${label} is missing`);
  return item;
}

function requireCertificateId(value: string): string {
  if (!CERTIFICATE_ID_PATTERN.test(value)) throw new Error('Certificate IDs must be 64 hexadecimal characters');
  return value.toLowerCase();
}

function requireIsoTimestamp(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be an exact ISO-8601 UTC timestamp`);
  }
  return value;
}

function requireCounter(value: unknown, label: string): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
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
