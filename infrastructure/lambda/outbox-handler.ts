import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { createHash } from 'node:crypto';
import {
  CreateJobCommand,
  DescribeJobCommand,
  IoTClient,
  UpdateCertificateCommand,
} from '@aws-sdk/client-iot';
import {
  DeleteConnectionCommand,
  IoTDataPlaneClient,
  UpdateThingShadowCommand,
} from '@aws-sdk/client-iot-data-plane';
import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { Context, DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda';
import {
  AWS_ACCOUNT_ID,
  AWS_REGION_NAME,
  IOT_DATA_ENDPOINT,
  JOB_TEMPLATE_ARN,
  TABLE_NAME,
} from './shared/config.js';
import { auditSk, ddb, deploymentSk, gatewaySk, operationSk, serialPk, tenantPk } from './shared/ddb.js';

const CONFIG_SHADOW_NAME = 'configuration';

type OutboxEventType = 'UPDATE_CONFIG_SHADOW' | 'CREATE_JOB' | 'CLEAR_CONFIG_SHADOW' | 'DECOMMISSION_GATEWAY';
export type DeliveryFenceDisposition = 'CURRENT' | 'SUPERSEDED' | 'DELIVERY_OBSERVED';

interface OutboxItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  entityType: 'OUTBOX';
  state: 'PENDING';
  eventType: OutboxEventType;
  outboxId: string;
  tenantId: string;
  gatewayId: string;
  thingName: string;
  operationId?: string;
  serialNumber?: string;
  certificateId?: string;
  generation?: number;
  profileVersionId?: string;
  rollbackProfileVersionId?: string;
  rollbackProfileChecksum?: string;
  recoveryRequired?: boolean;
  dispatchLeaseId?: string;
  dispatchLeaseExpiresAtEpoch?: number;
}

const iot = new IoTClient({});
const iotData = new IoTDataPlaneClient({ endpoint: dataEndpoint() });

/** Dispatches idempotent side effects from the DynamoDB transactional outbox. */
export const handler: DynamoDBStreamHandler = async (event, context) => {
  const candidates = event.Records.filter((record) => record.eventName === 'INSERT' || record.eventName === 'MODIFY');
  const outcomes = await Promise.allSettled(candidates.map((record) => processRecord(record, context)));
  const failures = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length > 0) {
    // Keep the outbox PENDING and fail the invocation so the event source
    // mapping can exhaust its bounded retries and route the original stream
    // record to its dead-letter queue.
    throw new Error(`${failures.length} outbox record(s) failed`);
  }
};

async function processRecord(record: DynamoDBRecord, context: Context): Promise<void> {
  const image = record.dynamodb?.NewImage;
  if (!image) return;
  const candidate = unmarshall(image as unknown as Record<string, AttributeValue>);
  if (candidate.entityType !== 'OUTBOX' || candidate.state !== 'PENDING') return;

  const pk = requiredString(candidate.PK, 'outbox PK', 256);
  const sk = requiredString(candidate.SK, 'outbox SK', 512);
  const currentResult = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: pk, SK: sk },
    ConsistentRead: true,
  }));
  const current = currentResult.Item;
  if (!current || current.entityType !== 'OUTBOX' || current.state !== 'PENDING') return;
  const outbox = outboxItem(current, pk, sk);

  try {
    let reference: Record<string, unknown>;
    if (outbox.eventType === 'UPDATE_CONFIG_SHADOW') {
      if (!await acquireDeliveryFence(outbox, context)) return;
      await assertDeliveryFence(outbox);
      reference = await updateConfigurationShadow(outbox);
    } else if (outbox.eventType === 'CREATE_JOB') {
      if (!await acquireDeliveryFence(outbox, context)) return;
      await assertDeliveryFence(outbox);
      reference = await createConfigurationJob(outbox);
    } else if (outbox.eventType === 'CLEAR_CONFIG_SHADOW') {
      if (!await acquireRollbackClearFence(outbox, context)) return;
      await assertRollbackClearFence(outbox);
      reference = await clearConfigurationShadow(outbox);
    } else {
      reference = await decommissionGateway(outbox);
    }
    await markSent(outbox, reference, context);
  } catch (error) {
    await markFailed(outbox, error);
    console.error(JSON.stringify({
      level: 'error',
      action: 'outbox-dispatch-failed',
      outboxId: outbox.outboxId,
      eventType: outbox.eventType,
      error: errorName(error),
    }));
    throw error;
  }
}

async function acquireRollbackClearFence(outbox: OutboxItem, context: Context): Promise<boolean> {
  const generation = positiveInteger(outbox.generation, 'outbox generation');
  const operationId = requiredString(outbox.operationId, 'outbox operationId', 128);
  const tenantKey = tenantPk(outbox.tenantId);
  const [gatewayResult, deploymentResult] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: tenantKey, SK: gatewaySk(outbox.gatewayId) }, ConsistentRead: true })),
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: tenantKey, SK: deploymentSk(outbox.gatewayId, generation) }, ConsistentRead: true })),
  ]);
  const gateway = gatewayResult.Item;
  const deployment = deploymentResult.Item;
  if (!gateway || gateway.entityType !== 'GATEWAY' || gateway.thingName !== outbox.thingName || gateway.certificateStatus !== 'ACTIVE') {
    throw new Error('Rollback-clear identity does not match the active gateway');
  }
  const desiredGeneration = positiveInteger(gateway.desiredGeneration ?? gateway.generation, 'gateway desiredGeneration');
  if (desiredGeneration > generation) {
    await markNoLongerPending(outbox, 'SUPERSEDED', `Rollback clear generation ${generation} was superseded by ${desiredGeneration}`);
    return false;
  }
  const gatewayState = String(gateway.state);
  const deploymentState = String(deployment?.status);
  if (desiredGeneration !== generation
    || gateway.operationId !== operationId
    || !['ROLLED_BACK', 'QUARANTINED'].includes(gatewayState)
    || !deployment
    || deployment.entityType !== 'DEPLOYMENT'
    || deployment.generation !== generation
    || deployment.operationId !== operationId
    || !['ROLLED_BACK', 'FAILED'].includes(deploymentState)) {
    throw new Error('Rollback-clear outbox does not match the authoritative terminal deployment');
  }
  if (!outbox.recoveryRequired
    && (gateway.appliedProfileVersionId !== outbox.rollbackProfileVersionId
      || gateway.appliedProfileChecksum !== outbox.rollbackProfileChecksum)) {
    throw new Error('Rollback-clear target does not match the authoritative applied profile');
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  if (outbox.dispatchLeaseId
    && outbox.dispatchLeaseExpiresAtEpoch
    && outbox.dispatchLeaseExpiresAtEpoch >= nowEpoch
    && gateway.dispatchLeaseId === outbox.dispatchLeaseId) {
    return true;
  }
  const leaseId = `${context.awsRequestId}:${outbox.outboxId}`.slice(0, 128);
  const leaseExpiry = nowEpoch + 60;
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: outbox.PK, SK: outbox.SK },
        UpdateExpression: 'SET dispatchLeaseId = :leaseId, dispatchLeaseExpiresAtEpoch = :leaseExpiry, lastAttemptStatus = :dispatching, updatedAt = :now',
        ConditionExpression: '#state = :pending AND outboxId = :outboxId AND (attribute_not_exists(dispatchLeaseExpiresAtEpoch) OR dispatchLeaseExpiresAtEpoch < :nowEpoch)',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':pending': 'PENDING', ':outboxId': outbox.outboxId, ':leaseId': leaseId,
          ':leaseExpiry': leaseExpiry, ':dispatching': 'DISPATCHING', ':nowEpoch': nowEpoch,
          ':now': new Date().toISOString(),
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: gatewaySk(outbox.gatewayId) },
        UpdateExpression: 'SET dispatchLeaseId = :leaseId, dispatchLeaseGeneration = :generation, dispatchLeaseExpiresAtEpoch = :leaseExpiry',
        ConditionExpression: 'entityType = :gateway AND desiredGeneration = :generation AND operationId = :operationId AND (#state = :rolledBack OR #state = :quarantined) AND certificateStatus = :active AND (attribute_not_exists(dispatchLeaseExpiresAtEpoch) OR dispatchLeaseExpiresAtEpoch < :nowEpoch)',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY', ':generation': generation, ':operationId': operationId,
          ':rolledBack': 'ROLLED_BACK', ':quarantined': 'QUARANTINED', ':active': 'ACTIVE',
          ':leaseId': leaseId, ':leaseExpiry': leaseExpiry, ':nowEpoch': nowEpoch,
        },
      },
    },
  ] }));
  outbox.dispatchLeaseId = leaseId;
  outbox.dispatchLeaseExpiresAtEpoch = leaseExpiry;
  return true;
}

async function assertRollbackClearFence(outbox: OutboxItem): Promise<void> {
  const leaseId = requiredString(outbox.dispatchLeaseId, 'rollback clear lease', 128);
  const generation = positiveInteger(outbox.generation, 'outbox generation');
  const [gatewayResult, outboxResult] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: tenantPk(outbox.tenantId), SK: gatewaySk(outbox.gatewayId) }, ConsistentRead: true })),
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: outbox.PK, SK: outbox.SK }, ConsistentRead: true })),
  ]);
  if (gatewayResult.Item?.dispatchLeaseId !== leaseId
    || gatewayResult.Item.desiredGeneration !== generation
    || !['ROLLED_BACK', 'QUARANTINED'].includes(String(gatewayResult.Item.state))
    || outboxResult.Item?.dispatchLeaseId !== leaseId
    || outboxResult.Item.state !== 'PENDING') {
    throw new Error('Rollback clear fence changed before external dispatch');
  }
}

async function clearConfigurationShadow(outbox: OutboxItem): Promise<Record<string, unknown>> {
  const generation = positiveInteger(outbox.generation, 'outbox generation');
  await iotData.send(new UpdateThingShadowCommand({
    thingName: outbox.thingName,
    shadowName: CONFIG_SHADOW_NAME,
    payload: Buffer.from(JSON.stringify({
      state: { desired: null },
      clientToken: outbox.outboxId.slice(0, 64),
    })),
  }));
  return { deliveryMode: 'SHADOW_CLEAR', shadowName: CONFIG_SHADOW_NAME, generation };
}

async function acquireDeliveryFence(outbox: OutboxItem, context: Context): Promise<boolean> {
  const generation = positiveInteger(outbox.generation, 'outbox generation');
  const profileVersionId = requiredString(outbox.profileVersionId, 'outbox profileVersionId', 128);
  const operationId = requiredString(outbox.operationId, 'outbox operationId', 128);
  const tenantKey = tenantPk(outbox.tenantId);
  const [gatewayResult, deploymentResult] = await Promise.all([
    ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: tenantKey, SK: gatewaySk(outbox.gatewayId) },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: tenantKey, SK: deploymentSk(outbox.gatewayId, generation) },
      ConsistentRead: true,
    })),
  ]);
  const gateway = gatewayResult.Item;
  const deployment = deploymentResult.Item;
  if (!gateway || gateway.entityType !== 'GATEWAY' || gateway.thingName !== outbox.thingName) {
    throw new Error('Delivery outbox identity does not match the authoritative gateway');
  }
  const desiredGeneration = positiveInteger(gateway.desiredGeneration ?? gateway.generation, 'gateway desiredGeneration');
  const disposition = deliveryFenceDisposition({
    desiredGeneration,
    gatewayProfileVersionId: gateway.desiredProfileVersionId,
    gatewayOperationId: gateway.operationId,
    gatewayCertificateStatus: gateway.certificateStatus,
    gatewayState: gateway.state,
    deploymentGeneration: deployment?.generation,
    deploymentProfileVersionId: deployment?.profileVersionId,
    deploymentOperationId: deployment?.operationId,
    deploymentStatus: deployment?.status,
  }, { generation, profileVersionId, operationId });
  if (disposition === 'SUPERSEDED') {
    await markNoLongerPending(outbox, 'SUPERSEDED', `Generation ${generation} was superseded by ${desiredGeneration}`);
    return false;
  }
  if (!deployment
    || deployment.entityType !== 'DEPLOYMENT'
    || deployment.gatewayId !== outbox.gatewayId) {
    throw new Error('Delivery outbox does not match the authoritative deployment');
  }
  if (disposition === 'DELIVERY_OBSERVED') {
    await markNoLongerPending(outbox, 'SENT', 'Same-generation delivery was already observed by the gateway');
    return false;
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  const leaseId = `${context.awsRequestId}:${outbox.outboxId}`.slice(0, 128);
  const leaseExpiresAtEpoch = nowEpoch + 60;
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: outbox.PK, SK: outbox.SK },
          UpdateExpression: 'SET dispatchLeaseId = :leaseId, dispatchLeaseExpiresAtEpoch = :leaseExpiry, lastAttemptStatus = :dispatching, updatedAt = :now',
          ConditionExpression: '#state = :pending AND outboxId = :outboxId AND (attribute_not_exists(dispatchLeaseExpiresAtEpoch) OR dispatchLeaseExpiresAtEpoch < :nowEpoch)',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':pending': 'PENDING', ':outboxId': outbox.outboxId, ':leaseId': leaseId,
            ':leaseExpiry': leaseExpiresAtEpoch, ':dispatching': 'DISPATCHING',
            ':nowEpoch': nowEpoch, ':now': new Date().toISOString(),
          },
        },
      },
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: tenantKey, SK: gatewaySk(outbox.gatewayId) },
          UpdateExpression: 'SET dispatchLeaseId = :leaseId, dispatchLeaseGeneration = :generation, dispatchLeaseExpiresAtEpoch = :leaseExpiry',
          ConditionExpression: 'entityType = :gateway AND thingName = :thingName AND desiredGeneration = :generation AND desiredProfileVersionId = :profileVersionId AND operationId = :operationId AND #state = :available AND certificateStatus = :active AND (attribute_not_exists(dispatchLeaseExpiresAtEpoch) OR dispatchLeaseExpiresAtEpoch < :nowEpoch)',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':gateway': 'GATEWAY', ':thingName': outbox.thingName, ':generation': generation,
            ':profileVersionId': profileVersionId, ':operationId': operationId,
            ':available': 'PROFILE_AVAILABLE', ':active': 'ACTIVE', ':leaseId': leaseId,
            ':leaseExpiry': leaseExpiresAtEpoch, ':nowEpoch': nowEpoch,
          },
        },
      },
      {
        ConditionCheck: {
          TableName: TABLE_NAME,
          Key: { PK: tenantKey, SK: deploymentSk(outbox.gatewayId, generation) },
          ConditionExpression: 'entityType = :deployment AND gatewayId = :gatewayId AND generation = :generation AND profileVersionId = :profileVersionId AND operationId = :operationId AND #status = :available',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':deployment': 'DEPLOYMENT', ':gatewayId': outbox.gatewayId, ':generation': generation,
            ':profileVersionId': profileVersionId, ':operationId': operationId, ':available': 'PROFILE_AVAILABLE',
          },
        },
      },
    ] }));
    outbox.dispatchLeaseId = leaseId;
    return true;
  } catch (error) {
    if (errorName(error) !== 'TransactionCanceledException') throw error;
    const freshOutbox = (await ddb.send(new GetCommand({
      TableName: TABLE_NAME, Key: { PK: outbox.PK, SK: outbox.SK }, ConsistentRead: true,
    }))).Item;
    if (freshOutbox?.state !== 'PENDING') return false;
    if (Number(freshOutbox.dispatchLeaseExpiresAtEpoch ?? 0) >= nowEpoch) {
      throw new Error('Delivery lease is still active; retry after its bounded expiry', { cause: error });
    }
    const freshGateway = (await ddb.send(new GetCommand({
      TableName: TABLE_NAME, Key: { PK: tenantKey, SK: gatewaySk(outbox.gatewayId) }, ConsistentRead: true,
    }))).Item;
    if (Number(freshGateway?.desiredGeneration ?? 0) > generation) {
      await markNoLongerPending(outbox, 'SUPERSEDED', `Generation ${generation} was superseded`);
      return false;
    }
    throw error;
  }
}

export function deliveryFenceDisposition(
  authority: {
    desiredGeneration: unknown;
    gatewayProfileVersionId: unknown;
    gatewayOperationId: unknown;
    gatewayCertificateStatus: unknown;
    gatewayState: unknown;
    deploymentGeneration: unknown;
    deploymentProfileVersionId: unknown;
    deploymentOperationId: unknown;
    deploymentStatus: unknown;
  },
  request: { generation: number; profileVersionId: string; operationId: string },
): DeliveryFenceDisposition {
  if (typeof authority.desiredGeneration !== 'number' || !Number.isSafeInteger(authority.desiredGeneration)) {
    throw new Error('Gateway desired generation is invalid');
  }
  if (authority.desiredGeneration > request.generation) return 'SUPERSEDED';
  if (authority.desiredGeneration !== request.generation
    || authority.gatewayProfileVersionId !== request.profileVersionId
    || authority.gatewayOperationId !== request.operationId
    || authority.gatewayCertificateStatus !== 'ACTIVE'
    || authority.deploymentGeneration !== request.generation
    || authority.deploymentProfileVersionId !== request.profileVersionId
    || authority.deploymentOperationId !== request.operationId) {
    throw new Error('Delivery outbox does not match the current gateway/deployment assignment');
  }
  if (authority.gatewayState === 'PROFILE_AVAILABLE' && authority.deploymentStatus === 'PROFILE_AVAILABLE') return 'CURRENT';
  const observed = new Set(['PROFILE_DELIVERED', 'APPLYING', 'HEALTH_CHECK', 'APPLIED_HEALTHY', 'FAILED', 'ROLLING_BACK', 'ROLLED_BACK']);
  if (observed.has(String(authority.gatewayState)) && observed.has(String(authority.deploymentStatus))) return 'DELIVERY_OBSERVED';
  throw new Error('Gateway/deployment is not in a dispatchable or observed delivery state');
}

async function assertDeliveryFence(outbox: OutboxItem): Promise<void> {
  const leaseId = requiredString(outbox.dispatchLeaseId, 'dispatch lease', 128);
  const generation = positiveInteger(outbox.generation, 'outbox generation');
  const tenantKey = tenantPk(outbox.tenantId);
  const [gatewayResult, deploymentResult, outboxResult] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: tenantKey, SK: gatewaySk(outbox.gatewayId) }, ConsistentRead: true })),
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: tenantKey, SK: deploymentSk(outbox.gatewayId, generation) }, ConsistentRead: true })),
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: outbox.PK, SK: outbox.SK }, ConsistentRead: true })),
  ]);
  if (gatewayResult.Item?.dispatchLeaseId !== leaseId
    || gatewayResult.Item.desiredGeneration !== generation
    || gatewayResult.Item.state !== 'PROFILE_AVAILABLE'
    || deploymentResult.Item?.generation !== generation
    || deploymentResult.Item.status !== 'PROFILE_AVAILABLE'
    || outboxResult.Item?.dispatchLeaseId !== leaseId
    || outboxResult.Item.state !== 'PENDING') {
    throw new Error('Delivery fence changed before external dispatch');
  }
}

async function markNoLongerPending(outbox: OutboxItem, state: 'SENT' | 'SUPERSEDED', reason: string): Promise<void> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: outbox.PK, SK: outbox.SK },
      UpdateExpression: 'SET #state = :state, terminalReason = :reason, terminalAt = :now, updatedAt = :now',
      ConditionExpression: '#state = :pending AND outboxId = :outboxId',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: {
        ':state': state, ':reason': reason.slice(0, 240), ':now': new Date().toISOString(),
        ':pending': 'PENDING', ':outboxId': outbox.outboxId,
      },
    }));
  } catch (error) {
    if (errorName(error) !== 'ConditionalCheckFailedException') throw error;
  }
}

async function updateConfigurationShadow(outbox: OutboxItem): Promise<Record<string, unknown>> {
  const generation = positiveInteger(outbox.generation, 'outbox generation');
  const profileVersionId = requiredString(outbox.profileVersionId, 'outbox profileVersionId', 128);
  const desired = {
    schemaVersion: '1.0',
    command: 'FETCH_SIGNED_PROFILE',
    gatewayId: outbox.gatewayId,
    generation,
    profileVersionId,
    requestTopic: `ce/v1/gateways/${outbox.thingName}/config/request`,
    statusTopic: `ce/v1/gateways/${outbox.thingName}/status`,
  };
  await iotData.send(new UpdateThingShadowCommand({
    thingName: outbox.thingName,
    shadowName: CONFIG_SHADOW_NAME,
    payload: Buffer.from(JSON.stringify({
      state: { desired },
      clientToken: outbox.outboxId.slice(0, 64),
    })),
  }));
  return { deliveryMode: 'SHADOW', shadowName: CONFIG_SHADOW_NAME, generation };
}

async function createConfigurationJob(outbox: OutboxItem): Promise<Record<string, unknown>> {
  if (!JOB_TEMPLATE_ARN) throw new Error('IoT Job template ARN is not configured');
  const generation = positiveInteger(outbox.generation, 'outbox generation');
  const profileVersionId = requiredString(outbox.profileVersionId, 'outbox profileVersionId', 128);
  // Custom IoT Job templates do not support documentParameters. Persist the
  // dynamic assignment in the named shadow first; the reusable job document
  // only instructs the device to fetch and apply that authoritative desired
  // state.
  await updateConfigurationShadow(outbox);
  const thingArn = `arn:aws:iot:${AWS_REGION_NAME}:${AWS_ACCOUNT_ID}:thing/${outbox.thingName}`;
  const jobId = deterministicJobId(outbox.gatewayId, generation);
  try {
    await iot.send(new CreateJobCommand({
      jobId,
      targets: [thingArn],
      jobTemplateArn: JOB_TEMPLATE_ARN,
      targetSelection: 'SNAPSHOT',
      description: `Apply signed profile ${profileVersionId}`.slice(0, 2028),
      timeoutConfig: { inProgressTimeoutInMinutes: 30 },
    }));
  } catch (error) {
    if (errorName(error) !== 'ResourceAlreadyExistsException') throw error;
    const described = await iot.send(new DescribeJobCommand({ jobId }));
    const job = described.job;
    if (!job
      || job.jobTemplateArn !== JOB_TEMPLATE_ARN
      || !Array.isArray(job.targets)
      || job.targets.length !== 1
      || job.targets[0] !== thingArn) {
      throw new Error('Existing IoT Job does not match the authoritative outbox request', { cause: error });
    }
  }
  return {
    deliveryMode: 'JOB',
    jobId,
    jobTemplateArn: JOB_TEMPLATE_ARN,
    shadowName: CONFIG_SHADOW_NAME,
    generation,
  };
}

async function decommissionGateway(outbox: OutboxItem): Promise<Record<string, unknown>> {
  const certificateId = requiredString(outbox.certificateId, 'outbox certificateId', 128);
  const serialNumber = requiredString(outbox.serialNumber, 'outbox serialNumber', 128);
  const [gatewayResult, manufacturingResult] = await Promise.all([
    ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: tenantPk(outbox.tenantId), SK: gatewaySk(outbox.gatewayId) },
      ConsistentRead: true,
    })),
    ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: serialPk(serialNumber), SK: 'MANUFACTURING' },
      ConsistentRead: true,
    })),
  ]);
  const gateway = gatewayResult.Item;
  const manufacturing = manufacturingResult.Item;
  if (!gateway
    || gateway.entityType !== 'GATEWAY'
    || gateway.thingName !== outbox.thingName
    || gateway.certificateId !== certificateId
    || gateway.state !== 'DECOMMISSIONING'
    || gateway.certificateStatus !== 'REVOKING'
    || !manufacturing
    || manufacturing.state !== 'DECOMMISSIONING'
    || manufacturing.tenantId !== outbox.tenantId
    || manufacturing.gatewayId !== outbox.gatewayId
    || manufacturing.certificateId !== certificateId
    || manufacturing.thingName !== outbox.thingName) {
    throw new Error('Decommission outbox identity does not match the authoritative gateway');
  }

  await iot.send(new UpdateCertificateCommand({ certificateId, newStatus: 'REVOKED' }));
  try {
    await iotData.send(new DeleteConnectionCommand({ clientId: outbox.thingName, cleanSession: true }));
  } catch (error) {
    // An already-offline client is a successful decommission outcome. The
    // certificate was disabled first, so it cannot establish a new session.
    if (errorName(error) !== 'ResourceNotFoundException') throw error;
  }
  return { action: 'DECOMMISSION', certificateId, certificateStatus: 'REVOKED', connectionClosed: true };
}

async function markSent(outbox: OutboxItem, reference: Record<string, unknown>, context: Context): Promise<void> {
  const now = new Date().toISOString();
  if (outbox.eventType !== 'DECOMMISSION_GATEWAY') {
    const leaseId = requiredString(outbox.dispatchLeaseId, 'dispatch lease', 128);
    const generation = positiveInteger(outbox.generation, 'outbox generation');
    try {
      await ddb.send(new TransactWriteCommand({ TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK: outbox.PK, SK: outbox.SK },
            UpdateExpression: 'SET #state = :sent, externalReference = :reference, sentAt = :now, updatedAt = :now, attempts = if_not_exists(attempts, :zero) + :one REMOVE lastError, failedAt, dispatchLeaseId, dispatchLeaseExpiresAtEpoch',
            ConditionExpression: '#state = :pending AND outboxId = :outboxId AND dispatchLeaseId = :leaseId',
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: {
              ':pending': 'PENDING', ':sent': 'SENT', ':reference': reference, ':now': now,
              ':zero': 0, ':one': 1, ':outboxId': outbox.outboxId, ':leaseId': leaseId,
            },
          },
        },
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK: tenantPk(outbox.tenantId), SK: gatewaySk(outbox.gatewayId) },
            UpdateExpression: 'REMOVE dispatchLeaseId, dispatchLeaseGeneration, dispatchLeaseExpiresAtEpoch',
            ConditionExpression: 'entityType = :gateway AND dispatchLeaseId = :leaseId AND desiredGeneration = :generation',
            ExpressionAttributeValues: { ':gateway': 'GATEWAY', ':leaseId': leaseId, ':generation': generation },
          },
        },
      ] }));
    } catch (error) {
      if (errorName(error) !== 'TransactionCanceledException') throw error;
      const result = await ddb.send(new GetCommand({
        TableName: TABLE_NAME, Key: { PK: outbox.PK, SK: outbox.SK }, ConsistentRead: true,
      }));
      if (result.Item?.state !== 'SENT') throw error;
    }
    return;
  }

  const certificateId = requiredString(outbox.certificateId, 'outbox certificateId', 128);
  const serialNumber = requiredString(outbox.serialNumber, 'outbox serialNumber', 128);
  const operationId = requiredString(outbox.operationId, 'outbox operationId', 128);
  const tenantKey = tenantPk(outbox.tenantId);
  const transaction: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: outbox.PK, SK: outbox.SK },
        UpdateExpression: 'SET #state = :sent, externalReference = :reference, sentAt = :now, updatedAt = :now, attempts = if_not_exists(attempts, :zero) + :one REMOVE lastError, failedAt',
        ConditionExpression: '#state = :pending AND outboxId = :outboxId',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':pending': 'PENDING', ':sent': 'SENT', ':reference': reference, ':now': now,
          ':zero': 0, ':one': 1, ':outboxId': outbox.outboxId,
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: gatewaySk(outbox.gatewayId) },
        UpdateExpression: 'SET #state = :decommissioned, certificateStatus = :revoked, decommissionedAt = :now, updatedAt = :now',
        ConditionExpression: 'entityType = :gateway AND #state = :decommissioning AND certificateStatus = :revoking AND thingName = :thingName AND certificateId = :certificateId',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY', ':thingName': outbox.thingName, ':certificateId': certificateId,
          ':decommissioning': 'DECOMMISSIONING', ':revoking': 'REVOKING',
          ':decommissioned': 'DECOMMISSIONED', ':revoked': 'REVOKED', ':now': now,
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: serialPk(serialNumber), SK: 'MANUFACTURING' },
        UpdateExpression: 'SET #state = :decommissioned, certificateStatus = :revoked, decommissionedAt = :now, updatedAt = :now',
        ConditionExpression: '#state = :decommissioning AND tenantId = :tenantId AND gatewayId = :gatewayId AND certificateId = :certificateId AND thingName = :thingName',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':decommissioning': 'DECOMMISSIONING', ':decommissioned': 'DECOMMISSIONED', ':revoked': 'REVOKED',
          ':tenantId': outbox.tenantId, ':gatewayId': outbox.gatewayId, ':certificateId': certificateId,
          ':thingName': outbox.thingName, ':now': now,
        },
      },
    },
  ];
  const auditId = `iot_${context.awsRequestId}`;
  transaction.push({
    Update: {
      TableName: TABLE_NAME,
      Key: { PK: tenantKey, SK: operationSk(operationId) },
      UpdateExpression: 'SET operationStatus = :succeeded, #state = :decommissioned, updatedAt = :now, timeline = list_append(if_not_exists(timeline, :empty), :events)',
      ConditionExpression: 'entityType = :operation AND gatewayId = :gatewayId AND (#state = :requested OR #state = :inProgress OR #state = :legacy)',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: {
        ':operation': 'OPERATION', ':gatewayId': outbox.gatewayId, ':requested': 'DECOMMISSION_REQUESTED',
        ':inProgress': 'DECOMMISSION_IN_PROGRESS', ':legacy': 'DECOMMISSIONING',
        ':succeeded': 'SUCCEEDED', ':decommissioned': 'DECOMMISSIONED',
        ':now': now, ':empty': [], ':events': [{ state: 'DECOMMISSIONED', at: now, detail: 'Certificate revoked and MQTT session closed.' }],
      },
    },
  });
  transaction.push({
    Put: {
      TableName: TABLE_NAME,
      Item: {
        PK: tenantKey,
        SK: auditSk(now, auditId),
        entityType: 'AUDIT',
        auditId,
        tenantId: outbox.tenantId,
        actorSubject: 'SYSTEM#OUTBOX',
        actorRole: 'SYSTEM',
        action: 'GATEWAY_DECOMMISSIONED',
        targetId: outbox.gatewayId,
        details: { thingName: outbox.thingName, certificateId },
        outcome: 'SUCCESS',
        createdAt: now,
      },
    },
  });
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: transaction }));
  } catch (error) {
    if (errorName(error) !== 'TransactionCanceledException') throw error;
    // A duplicate stream delivery after the first successful transaction is
    // idempotent. Verify the outbox reached SENT before suppressing the race.
    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: outbox.PK, SK: outbox.SK },
      ConsistentRead: true,
    }));
    if (result.Item?.state !== 'SENT') throw error;
  }

}

async function markFailed(outbox: OutboxItem, error: unknown): Promise<void> {
  const now = new Date().toISOString();
  const message = sanitizedError(error);
  try {
    if (outbox.eventType !== 'DECOMMISSION_GATEWAY' && outbox.dispatchLeaseId) {
      await ddb.send(new TransactWriteCommand({ TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK: outbox.PK, SK: outbox.SK },
            UpdateExpression: 'SET lastAttemptStatus = :failed, lastError = :error, failedAt = :now, updatedAt = :now, attempts = if_not_exists(attempts, :zero) + :one REMOVE dispatchLeaseId, dispatchLeaseExpiresAtEpoch',
            ConditionExpression: '#state = :pending AND outboxId = :outboxId AND dispatchLeaseId = :leaseId',
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: {
              ':pending': 'PENDING', ':failed': 'FAILED_RETRYABLE', ':error': message, ':now': now,
              ':zero': 0, ':one': 1, ':outboxId': outbox.outboxId, ':leaseId': outbox.dispatchLeaseId,
            },
          },
        },
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK: tenantPk(outbox.tenantId), SK: gatewaySk(outbox.gatewayId) },
            UpdateExpression: 'REMOVE dispatchLeaseId, dispatchLeaseGeneration, dispatchLeaseExpiresAtEpoch',
            ConditionExpression: 'entityType = :gateway AND dispatchLeaseId = :leaseId',
            ExpressionAttributeValues: { ':gateway': 'GATEWAY', ':leaseId': outbox.dispatchLeaseId },
          },
        },
      ] }));
      return;
    }
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: outbox.PK, SK: outbox.SK },
      UpdateExpression: 'SET lastAttemptStatus = :failed, lastError = :error, failedAt = :now, updatedAt = :now, attempts = if_not_exists(attempts, :zero) + :one',
      ConditionExpression: '#state = :pending AND outboxId = :outboxId',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: {
        ':pending': 'PENDING', ':failed': 'FAILED_RETRYABLE', ':error': message, ':now': now,
        ':zero': 0, ':one': 1, ':outboxId': outbox.outboxId,
      },
    }));
  } catch (markError) {
    if (errorName(markError) === 'TransactionCanceledException' && outbox.dispatchLeaseId) {
      // The status handler may already have removed the gateway half of the
      // lease. Clear the exact outbox half so the rethrown stream record can
      // reacquire on its next retry instead of being checkpointed as busy.
      try {
        await ddb.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: outbox.PK, SK: outbox.SK },
          UpdateExpression: 'SET lastAttemptStatus = :failed, lastError = :error, failedAt = :now, updatedAt = :now, attempts = if_not_exists(attempts, :zero) + :one REMOVE dispatchLeaseId, dispatchLeaseExpiresAtEpoch',
          ConditionExpression: '#state = :pending AND outboxId = :outboxId AND dispatchLeaseId = :leaseId',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':pending': 'PENDING', ':failed': 'FAILED_RETRYABLE', ':error': message, ':now': now,
            ':zero': 0, ':one': 1, ':outboxId': outbox.outboxId, ':leaseId': outbox.dispatchLeaseId,
          },
        }));
      } catch (fallbackError) {
        if (errorName(fallbackError) !== 'ConditionalCheckFailedException') throw fallbackError;
      }
      return;
    }
    if (errorName(markError) !== 'ConditionalCheckFailedException') throw markError;
  }
}

function outboxItem(value: Record<string, unknown>, expectedPk: string, expectedSk: string): OutboxItem {
  const PK = requiredString(value.PK, 'outbox PK', 256);
  const SK = requiredString(value.SK, 'outbox SK', 512);
  const tenantId = requiredString(value.tenantId, 'outbox tenantId', 128);
  const eventType = outboxEventType(value.eventType);
  const item: OutboxItem = {
    PK,
    SK,
    entityType: 'OUTBOX',
    state: 'PENDING',
    eventType,
    outboxId: requiredString(value.outboxId, 'outbox outboxId', 128),
    tenantId,
    gatewayId: requiredString(value.gatewayId, 'outbox gatewayId', 128),
    thingName: thingName(value.thingName),
  };
  if (value.operationId != null) item.operationId = requiredString(value.operationId, 'outbox operationId', 128);
  if (value.serialNumber != null) item.serialNumber = requiredString(value.serialNumber, 'outbox serialNumber', 128);
  if (value.certificateId != null) item.certificateId = requiredString(value.certificateId, 'outbox certificateId', 128);
  if (value.generation != null) item.generation = positiveInteger(value.generation, 'outbox generation');
  if (value.profileVersionId != null) {
    item.profileVersionId = requiredString(value.profileVersionId, 'outbox profileVersionId', 128);
  }
  if (value.rollbackProfileVersionId != null) item.rollbackProfileVersionId = requiredString(value.rollbackProfileVersionId, 'outbox rollbackProfileVersionId', 128);
  if (value.rollbackProfileChecksum != null) item.rollbackProfileChecksum = requiredChecksum(value.rollbackProfileChecksum, 'outbox rollbackProfileChecksum');
  if (value.recoveryRequired === true) item.recoveryRequired = true;
  if (value.dispatchLeaseId != null) item.dispatchLeaseId = requiredString(value.dispatchLeaseId, 'outbox dispatchLeaseId', 128);
  if (value.dispatchLeaseExpiresAtEpoch != null) item.dispatchLeaseExpiresAtEpoch = positiveInteger(value.dispatchLeaseExpiresAtEpoch, 'outbox dispatchLeaseExpiresAtEpoch');
  if (PK !== expectedPk || SK !== expectedSk || PK !== tenantPk(tenantId) || !SK.startsWith('OUTBOX#')) {
    throw new Error('Outbox key is inconsistent with its tenant identity');
  }
  return item;
}

function outboxEventType(value: unknown): OutboxEventType {
  if (value === 'UPDATE_CONFIG_SHADOW' || value === 'CREATE_JOB' || value === 'CLEAR_CONFIG_SHADOW' || value === 'DECOMMISSION_GATEWAY') return value;
  throw new Error('Unsupported outbox event type');
}

function deterministicJobId(gatewayId: string, generation: number): string {
  const normalized = gatewayId.replace(/[^A-Za-z0-9_-]/g, '-');
  const digest = createHash('sha256').update(`${gatewayId}\0${generation}`).digest('hex').slice(0, 12);
  return `ce-${normalized.slice(0, 30)}-${generation}-${digest}`.slice(0, 64);
}

function thingName(value: unknown): string {
  const name = requiredString(value, 'outbox thingName', 128);
  if (!/^[A-Za-z0-9:_-]+$/.test(name)) throw new Error('Outbox thingName contains unsupported characters');
  return name;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maxLength || hasControlCharacters(value)) {
    throw new Error(`Missing or invalid ${label}`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function requiredChecksum(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function dataEndpoint(): string {
  if (!IOT_DATA_ENDPOINT) throw new Error('IoT data endpoint is not configured');
  return /^https:\/\//i.test(IOT_DATA_ENDPOINT) ? IOT_DATA_ENDPOINT : `https://${IOT_DATA_ENDPOINT}`;
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') return error.name;
  return 'Error';
}

function sanitizedError(error: unknown): string {
  const name = errorName(error).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 100) || 'Error';
  const message = error instanceof Error
    ? error.message.split('').map((character) => isControlCharacter(character) ? ' ' : character).join('').slice(0, 350)
    : 'Outbox dispatch failed';
  return `${name}: ${message}`.slice(0, 500);
}

function hasControlCharacters(value: string): boolean {
  return value.split('').some(isControlCharacter);
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}
