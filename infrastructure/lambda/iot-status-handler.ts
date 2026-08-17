import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Context } from 'aws-lambda';
import { AWS_ACCOUNT_ID, AWS_REGION_NAME, TABLE_NAME } from './shared/config.js';
import { auditSk, ddb, deploymentSk, gatewaySk, operationSk, outboxSk, tenantPk } from './shared/ddb.js';
import { INITIAL_OPERATION_STEPS } from './shared/models.js';

const TOPIC_PREFIX = 'ce/v1/gateways/';
const STATUS_SUFFIX = '/status';

type DeviceStatus = 'APPLYING' | 'HEALTH_CHECK' | 'APPLIED_HEALTHY' | 'FAILED' | 'ROLLING_BACK' | 'ROLLED_BACK';
type UiOperationStatus = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
export type TransitionDisposition = 'APPLY' | 'STALE_NOOP';

interface StatusEvent extends Record<string, unknown> {
  generation?: unknown;
  status?: unknown;
  profileVersionId?: unknown;
  profileChecksum?: unknown;
  detail?: unknown;
  error?: unknown;
  brokerClientId?: unknown;
  brokerPrincipal?: unknown;
  brokerTopic?: unknown;
  brokerTraceId?: unknown;
  brokerReceivedAt?: unknown;
}

export function statusBrokerIdentity(event: Record<string, unknown>): {
  brokerClientId: string;
  brokerPrincipal: string;
  brokerTopic: string;
  thingName: string;
} {
  const brokerTopic = requiredBrokerString(event.brokerTopic, 'brokerTopic', 256);
  const thingName = thingNameFromTopic(brokerTopic);
  const brokerClientId = requiredBrokerString(event.brokerClientId, 'brokerClientId', 128);
  const brokerPrincipal = requiredBrokerString(event.brokerPrincipal, 'brokerPrincipal', 256);
  if (brokerClientId !== thingName) throw new Error('Broker client ID does not match the authoritative thing topic');
  return { brokerClientId, brokerPrincipal, brokerTopic, thingName };
}

/** Records device-reported deployment state after binding it to broker identity. */
export async function handler(event: StatusEvent, context: Context): Promise<void> {
  const { brokerPrincipal, thingName } = statusBrokerIdentity(event);

  const generation = positiveInteger(event.generation, 'generation');
  const status = deviceStatus(event.status);
  const detail = safeDetail(event.detail ?? event.error);
  const gateway = await gatewayForThing(thingName);
  const tenantId = requiredStoredString(gateway.tenantId, 'gateway tenantId');
  const gatewayId = requiredStoredString(gateway.gatewayId, 'gateway gatewayId');
  const certificateId = requiredStoredString(gateway.certificateId, 'gateway certificateId');
  const certificatePrincipal = requiredStoredString(gateway.certificatePrincipal, 'gateway certificatePrincipal');
  const expectedCertificatePrincipal = `arn:aws:iot:${AWS_REGION_NAME}:${AWS_ACCOUNT_ID}:cert/${certificateId}`;
  if (certificatePrincipal !== expectedCertificatePrincipal) throw new Error('Stored gateway certificate principal is inconsistent');
  if (certificateId !== brokerPrincipal) throw new Error('Broker certificate principal is not authorized for this gateway');
  if (gateway.thingName !== thingName) throw new Error('Gateway thing identity is inconsistent');
  if (gateway.certificateStatus !== 'ACTIVE') throw new Error('Gateway certificate is not active');
  if (positiveInteger(gateway.desiredGeneration ?? gateway.generation, 'gateway desiredGeneration') !== generation) {
    throw new Error('Device status generation is not the authoritative desired generation');
  }

  const deploymentResult = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tenantPk(tenantId), SK: deploymentSk(gatewayId, generation) },
    ConsistentRead: true,
  }));
  const deployment = deploymentResult.Item;
  if (!deployment
    || deployment.entityType !== 'DEPLOYMENT'
    || deployment.gatewayId !== gatewayId
    || positiveInteger(deployment.generation, 'deployment generation') !== generation) {
    throw new Error('Authoritative deployment record is missing or inconsistent');
  }
  const profileVersionId = requiredStoredString(deployment.profileVersionId, 'deployment profileVersionId');
  if (gateway.desiredProfileVersionId != null && gateway.desiredProfileVersionId !== profileVersionId) {
    throw new Error('Gateway desired profile does not match the authoritative deployment');
  }

  const gatewayState = requiredStoredString(gateway.state, 'gateway state');
  const deploymentStatus = requiredStoredString(deployment.status, 'deployment status');
  const descriptor = isRecord(deployment.descriptor) ? deployment.descriptor : undefined;
  const authoritativeChecksum = requiredChecksum(descriptor?.profileSha256, 'deployment descriptor profileSha256');
  let reportedChecksum: string | undefined;
  let rollbackProfileVersionId: string | undefined;
  let rollbackProfileChecksum: string | undefined;
  let rollbackAttestationValid = true;
  if (status === 'APPLIED_HEALTHY') {
    const reportedProfileVersionId = requiredStoredString(event.profileVersionId, 'reported profileVersionId');
    reportedChecksum = requiredChecksum(event.profileChecksum, 'reported profileChecksum');
    if (reportedProfileVersionId !== profileVersionId || reportedChecksum !== authoritativeChecksum) {
      throw new Error('Healthy acknowledgement does not match the authoritative profile version and checksum');
    }
  }
  if (status === 'ROLLED_BACK') {
    rollbackProfileVersionId = typeof event.profileVersionId === 'string' ? event.profileVersionId : undefined;
    rollbackProfileChecksum = typeof event.profileChecksum === 'string' && /^[a-f0-9]{64}$/.test(event.profileChecksum)
      ? event.profileChecksum
      : undefined;
    rollbackAttestationValid = rollbackTargetMatches(
      gateway.appliedProfileVersionId,
      gateway.appliedProfileChecksum,
      rollbackProfileVersionId,
      rollbackProfileChecksum,
    );
  }
  const dispositions: TransitionDisposition[] = [
    transitionDisposition(gatewayState, status, 'gateway'),
    transitionDisposition(deploymentStatus, status, 'deployment'),
  ];

  const operationId = requiredStoredString(deployment.operationId, 'deployment operationId');
  const operation = (await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tenantPk(tenantId), SK: operationSk(operationId) },
    ConsistentRead: true,
  }))).Item;
  if (!operation || operation.entityType !== 'OPERATION' || operation.gatewayId !== gatewayId) {
    throw new Error('Deployment operation record is missing or inconsistent');
  }
  dispositions.push(transitionDisposition(requiredStoredString(operation.state, 'operation state'), status, 'operation'));

  // IoT Rules invoke Lambdas asynchronously and messages can be delivered out
  // of order. A same-generation report that is already reflected, or that is
  // behind any authoritative entity, is a successful stale no-op. This avoids
  // DLQ noise and, more importantly, prevents terminal-state regression.
  if (dispositions.includes('STALE_NOOP')) return;

  const now = new Date().toISOString();
  const tenantKey = tenantPk(tenantId);
  const errorDetail = detail ?? defaultStatusDetail(status);
  if (status === 'ROLLED_BACK' && !rollbackAttestationValid) {
    await quarantineInvalidRollback({
      tenantId, tenantKey, gatewayId, thingName, certificateId, certificatePrincipal, generation,
      profileVersionId, gatewayState, deploymentStatus, operationId,
      operationState: requiredStoredString(operation.state, 'operation state'),
      detail: errorDetail, now, context,
    });
    return;
  }
  const rollbackClearOutboxId = status === 'ROLLED_BACK' ? `rollback_clear_${context.awsRequestId}` : undefined;
  const rollbackLeaseExpiry = status === 'ROLLED_BACK' ? Math.floor(Date.now() / 1000) + 60 : undefined;
  const gatewayUpdate = gatewayUpdateExpression(status);
  const deploymentUpdate = deploymentUpdateExpression(status);
  const transaction: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: gatewaySk(gatewayId) },
        UpdateExpression: gatewayUpdate.expression,
        ConditionExpression: 'entityType = :gateway AND thingName = :thingName AND certificateId = :certificateId AND certificatePrincipal = :certificatePrincipal AND desiredGeneration = :generation AND #state = :current',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY',
          ':thingName': thingName,
          ':certificateId': certificateId,
          ':certificatePrincipal': certificatePrincipal,
          ':generation': generation,
          ':current': gatewayState,
          ':next': status,
          ':health': status === 'APPLIED_HEALTHY' ? 'HEALTHY'
            : status === 'FAILED' || status === 'ROLLING_BACK' || status === 'ROLLED_BACK' ? 'DEGRADED'
              : 'APPLYING',
          ':now': now,
          ...(status === 'APPLIED_HEALTHY' ? { ':profileVersionId': profileVersionId } : {}),
          ...(status === 'APPLIED_HEALTHY' ? { ':profileChecksum': reportedChecksum } : {}),
          ...(status === 'ROLLED_BACK' ? {
            ':rollbackProfileVersionId': rollbackProfileVersionId,
            ':rollbackProfileChecksum': rollbackProfileChecksum,
            ':leaseId': rollbackClearOutboxId,
            ':leaseExpiry': rollbackLeaseExpiry,
          } : {}),
          ...(gatewayUpdate.needsError ? { ':deviceError': errorDetail } : {}),
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: deploymentSk(gatewayId, generation) },
        UpdateExpression: deploymentUpdate.expression,
        ConditionExpression: 'entityType = :deployment AND gatewayId = :gatewayId AND generation = :generation AND #status = :current',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
        ExpressionAttributeValues: {
          ':deployment': 'DEPLOYMENT',
          ':gatewayId': gatewayId,
          ':generation': generation,
          ':current': deploymentStatus,
          ':next': status,
          ':now': now,
          ...(status === 'APPLIED_HEALTHY' ? { ':profileVersionId': profileVersionId, ':profileChecksum': reportedChecksum } : {}),
          ...(status === 'ROLLED_BACK' ? {
            ':rollbackProfileVersionId': rollbackProfileVersionId,
            ':rollbackProfileChecksum': rollbackProfileChecksum,
          } : {}),
          ...(deploymentUpdate.needsError ? { ':deviceError': errorDetail } : {}),
        },
      },
    },
  ];

  if (operation && operationId) {
    const currentOperationState = requiredStoredString(operation.state, 'operation state');
    const uiStatus = uiOperationStatus(status);
    transaction.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: operationSk(operationId) },
        UpdateExpression: status === 'FAILED' || status === 'ROLLED_BACK'
          ? 'SET operationStatus = :uiStatus, #state = :next, deploymentGeneration = :generation, updatedAt = :now, steps = :steps, timeline = list_append(if_not_exists(timeline, :empty), :events), failure = :failure REMOVE #error'
          : 'SET operationStatus = :uiStatus, #state = :next, deploymentGeneration = :generation, updatedAt = :now, steps = :steps, timeline = list_append(if_not_exists(timeline, :empty), :events) REMOVE #error, failure',
        ConditionExpression: 'entityType = :operation AND gatewayId = :gatewayId AND #state = :current',
        ExpressionAttributeNames: { '#state': 'state', '#error': 'error' },
        ExpressionAttributeValues: {
          ':operation': 'OPERATION',
          ':gatewayId': gatewayId,
          ':current': currentOperationState,
          ':next': status,
          ':uiStatus': uiStatus,
          ':generation': generation,
          ':now': now,
          ':steps': operationSteps(operation.steps, status, now, detail),
          ':empty': [],
          ':events': operationTimelineEvents(currentOperationState, status, uiStatus, now, detail),
          ...((status === 'FAILED' || status === 'ROLLED_BACK') ? {
            ':failure': {
              code: status === 'ROLLED_BACK' ? 'PROFILE_APPLY_ROLLED_BACK' : 'PROFILE_APPLY_FAILED',
              message: errorDetail,
              rolledBack: status === 'ROLLED_BACK',
            },
          } : {}),
        },
      },
    });
  }

  if (status === 'ROLLED_BACK' && rollbackClearOutboxId && rollbackLeaseExpiry) {
    transaction.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: tenantKey,
          SK: outboxSk(now, rollbackClearOutboxId),
          entityType: 'OUTBOX',
          outboxId: rollbackClearOutboxId,
          eventType: 'CLEAR_CONFIG_SHADOW',
          state: 'PENDING',
          tenantId,
          gatewayId,
          thingName,
          operationId,
          generation,
          profileVersionId,
          rollbackProfileVersionId,
          rollbackProfileChecksum,
          dispatchLeaseId: rollbackClearOutboxId,
          dispatchLeaseExpiresAtEpoch: rollbackLeaseExpiry,
          createdAt: now,
          updatedAt: now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    });
  }

  const auditId = `iot_${context.awsRequestId}`;
  transaction.push({
    Put: {
      TableName: TABLE_NAME,
      Item: {
        PK: tenantKey,
        SK: auditSk(now, auditId),
        entityType: 'AUDIT',
        auditId,
        tenantId,
        actorSubject: certificatePrincipal,
        actorRole: 'DEVICE',
        action: `DEVICE_PROFILE_${status}`,
        targetId: gatewayId,
        details: {
          generation,
          profileVersionId,
          ...(reportedChecksum ? { profileChecksum: reportedChecksum } : {}),
          thingName,
          ...(detail ? { detail } : {}),
        },
        outcome: status === 'FAILED' || status === 'ROLLED_BACK' ? 'FAILURE' : 'SUCCESS',
        createdAt: now,
      },
    },
  });

  await ddb.send(new TransactWriteCommand({ TransactItems: transaction }));
}

async function quarantineInvalidRollback(input: {
  tenantId: string;
  tenantKey: string;
  gatewayId: string;
  thingName: string;
  certificateId: string;
  certificatePrincipal: string;
  generation: number;
  profileVersionId: string;
  gatewayState: string;
  deploymentStatus: string;
  operationId: string;
  operationState: string;
  detail: string;
  now: string;
  context: Context;
}): Promise<void> {
  const outboxId = `rollback_quarantine_${input.context.awsRequestId}`;
  const leaseExpiry = Math.floor(Date.now() / 1000) + 60;
  const auditId = `iot_${input.context.awsRequestId}`;
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: input.tenantKey, SK: gatewaySk(input.gatewayId) },
        UpdateExpression: 'SET #state = :quarantined, health = :degraded, lastError = :error, rollbackRecoveryRequiredAt = :now, dispatchLeaseId = :leaseId, dispatchLeaseGeneration = :generation, dispatchLeaseExpiresAtEpoch = :leaseExpiry, updatedAt = :now REMOVE desiredProfileVersionId, signedDescriptor',
        ConditionExpression: 'entityType = :gateway AND #state = :current AND thingName = :thingName AND certificateId = :certificateId AND certificatePrincipal = :principal AND desiredGeneration = :generation',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY', ':current': input.gatewayState, ':quarantined': 'QUARANTINED',
          ':degraded': 'DEGRADED', ':error': 'Rollback target did not match the last known applied profile.',
          ':thingName': input.thingName, ':certificateId': input.certificateId,
          ':principal': input.certificatePrincipal, ':generation': input.generation,
          ':leaseId': outboxId, ':leaseExpiry': leaseExpiry, ':now': input.now,
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: input.tenantKey, SK: deploymentSk(input.gatewayId, input.generation) },
        UpdateExpression: 'SET #status = :failed, #error = :error, rollbackRecoveryRequiredAt = :now, updatedAt = :now',
        ConditionExpression: 'entityType = :deployment AND #status = :current AND gatewayId = :gatewayId AND generation = :generation',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
        ExpressionAttributeValues: {
          ':deployment': 'DEPLOYMENT', ':current': input.deploymentStatus, ':failed': 'FAILED',
          ':gatewayId': input.gatewayId, ':generation': input.generation,
          ':error': 'Rollback target attestation failed; recovery is required.', ':now': input.now,
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: input.tenantKey, SK: operationSk(input.operationId) },
        UpdateExpression: 'SET operationStatus = :failed, #state = :failed, failure = :failure, updatedAt = :now, timeline = list_append(if_not_exists(timeline, :empty), :events)',
        ConditionExpression: 'entityType = :operation AND #state = :current AND gatewayId = :gatewayId',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':operation': 'OPERATION', ':current': input.operationState, ':gatewayId': input.gatewayId,
          ':failed': 'FAILED', ':now': input.now, ':empty': [],
          ':failure': { code: 'ROLLBACK_ATTESTATION_FAILED', message: input.detail, rolledBack: false },
          ':events': [{ state: 'FAILED', at: input.now, detail: 'Rollback target could not be validated; gateway quarantined.' }],
        },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: input.tenantKey, SK: outboxSk(input.now, outboxId), entityType: 'OUTBOX', outboxId,
          eventType: 'CLEAR_CONFIG_SHADOW', state: 'PENDING', tenantId: input.tenantId,
          gatewayId: input.gatewayId, thingName: input.thingName, operationId: input.operationId,
          generation: input.generation, profileVersionId: input.profileVersionId,
          recoveryRequired: true, dispatchLeaseId: outboxId, dispatchLeaseExpiresAtEpoch: leaseExpiry,
          createdAt: input.now, updatedAt: input.now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: input.tenantKey, SK: auditSk(input.now, auditId), entityType: 'AUDIT', auditId,
          tenantId: input.tenantId, actorSubject: input.certificatePrincipal, actorRole: 'DEVICE',
          action: 'ROLLBACK_ATTESTATION_REJECTED', targetId: input.gatewayId,
          details: { generation: input.generation, failedProfileVersionId: input.profileVersionId },
          outcome: 'FAILURE', createdAt: input.now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
  ] }));
}

async function gatewayForThing(thingName: string): Promise<Record<string, unknown>> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :thing',
    ExpressionAttributeValues: { ':thing': `THING#${thingName}` },
    Limit: 2,
  }));
  if (result.Items?.length !== 1) throw new Error('A unique gateway identity was not found for the broker thing');
  const gateway = result.Items[0];
  if (!gateway || gateway.entityType !== 'GATEWAY') throw new Error('Thing lookup did not resolve to a gateway');
  return gateway;
}

function gatewayUpdateExpression(status: DeviceStatus): { expression: string; needsError: boolean } {
  const base = 'SET #state = :next, health = :health, lastAuthenticatedAt = :now, lastStatusAt = :now, updatedAt = :now';
  if (status === 'APPLIED_HEALTHY') {
    return {
      expression: `${base}, appliedGeneration = :generation, appliedProfileVersionId = :profileVersionId, appliedProfileChecksum = :profileChecksum, healthyAt = :now, profileValidatedAt = :now REMOVE lastError, dispatchLeaseId, dispatchLeaseGeneration, dispatchLeaseExpiresAtEpoch`,
      needsError: false,
    };
  }
  if (status === 'FAILED' || status === 'ROLLING_BACK' || status === 'ROLLED_BACK') {
    if (status === 'ROLLED_BACK') {
      return {
        expression: `${base}, lastError = :deviceError, rolledBackToProfileVersionId = :rollbackProfileVersionId, rolledBackToProfileChecksum = :rollbackProfileChecksum, rollbackValidatedAt = :now, dispatchLeaseId = :leaseId, dispatchLeaseGeneration = :generation, dispatchLeaseExpiresAtEpoch = :leaseExpiry REMOVE desiredProfileVersionId, signedDescriptor`,
        needsError: true,
      };
    }
    return { expression: `${base}, lastError = :deviceError REMOVE dispatchLeaseId, dispatchLeaseGeneration, dispatchLeaseExpiresAtEpoch`, needsError: true };
  }
  return { expression: `${base} REMOVE lastError, dispatchLeaseId, dispatchLeaseGeneration, dispatchLeaseExpiresAtEpoch`, needsError: false };
}

function deploymentUpdateExpression(status: DeviceStatus): { expression: string; needsError: boolean } {
  const base = 'SET #status = :next, lastStatusAt = :now, updatedAt = :now';
  if (status === 'APPLIED_HEALTHY') {
    return { expression: `${base}, appliedProfileVersionId = :profileVersionId, appliedProfileChecksum = :profileChecksum, completedAt = :now, validatedAt = :now REMOVE #error`, needsError: false };
  }
  if (status === 'FAILED' || status === 'ROLLING_BACK' || status === 'ROLLED_BACK') {
    if (status === 'ROLLED_BACK') {
      return { expression: `${base}, #error = :deviceError, rolledBackToProfileVersionId = :rollbackProfileVersionId, rolledBackToProfileChecksum = :rollbackProfileChecksum, rollbackValidatedAt = :now`, needsError: true };
    }
    return { expression: `${base}, #error = :deviceError`, needsError: true };
  }
  return { expression: `${base} REMOVE #error`, needsError: false };
}

function operationSteps(value: unknown, status: DeviceStatus, now: string, detail?: string): Record<string, unknown>[] {
  const existing = Array.isArray(value)
    ? new Map(value.filter(isRecord).map((step) => [String(step.key ?? ''), step]))
    : new Map<string, Record<string, unknown>>();
  const steps = INITIAL_OPERATION_STEPS.map((template) => ({ ...template, ...(existing.get(template.key) ?? {}) }));
  const set = (key: string, state: 'pending' | 'in_progress' | 'complete' | 'error', stepDetail?: string) => {
    const index = steps.findIndex((step) => step.key === key);
    if (index < 0) return;
    const previous = steps[index];
    if (!previous) return;
    steps[index] = {
      ...previous,
      status: state,
      timestamp: now,
      ...(stepDetail ? { detail: stepDetail } : {}),
    };
  };

  set('identity', 'complete', 'Permanent certificate authenticated by the IoT broker.');
  set('profile', 'complete', 'Signed profile generation delivered to the gateway.');
  if (status === 'APPLYING') {
    set('apply', 'in_progress', detail ?? 'Gateway is applying the profile transactionally.');
    set('health', 'pending');
  } else if (status === 'HEALTH_CHECK') {
    set('apply', 'complete', 'Profile committed successfully.');
    set('health', 'in_progress', detail ?? 'Gateway is validating connectivity and services.');
  } else if (status === 'APPLIED_HEALTHY') {
    set('apply', 'complete', 'Profile committed successfully.');
    set('health', 'complete', detail ?? 'Gateway reported healthy connectivity and services.');
  } else if (status === 'FAILED') {
    set('apply', 'error', detail ?? 'Gateway rejected or could not apply the profile.');
    set('health', 'error', 'Health validation did not complete.');
  } else if (status === 'ROLLING_BACK') {
    set('apply', 'error', detail ?? 'Apply failed; gateway is restoring its prior configuration.');
    set('health', 'pending', 'Waiting for rollback completion.');
  } else {
    set('apply', 'error', detail ?? 'Profile was not committed.');
    set('health', 'error', 'Gateway restored its prior configuration.');
  }
  return steps;
}

export function transitionDisposition(current: string, next: DeviceStatus, entity: string): TransitionDisposition {
  const earlyStates = new Set([
    'CLAIM_ACCEPTED', 'CSR_VERIFIED', 'OPERATIONAL_IDENTITY_ISSUED', 'PROFILE_STAGED',
    'WAITING_FOR_DEVICE', 'IDENTITY_PROVISIONING', 'PERMANENT_IDENTITY_ACTIVE',
    'PROFILE_AVAILABLE', 'PROFILE_DELIVERED',
  ]);
  if (earlyStates.has(current)) return 'APPLY';
  if (current === next) return 'STALE_NOOP';
  if (current === 'APPLIED_HEALTHY' || current === 'ROLLED_BACK' || current === 'QUARANTINED') return 'STALE_NOOP';

  const forward: Record<string, ReadonlySet<DeviceStatus>> = {
    APPLYING: new Set(['HEALTH_CHECK', 'APPLIED_HEALTHY', 'FAILED', 'ROLLING_BACK', 'ROLLED_BACK']),
    HEALTH_CHECK: new Set(['APPLIED_HEALTHY', 'FAILED', 'ROLLING_BACK', 'ROLLED_BACK']),
    FAILED: new Set(['ROLLING_BACK', 'ROLLED_BACK']),
    ROLLING_BACK: new Set(['ROLLED_BACK']),
  };
  if (forward[current]?.has(next)) return 'APPLY';
  if (current in forward) return 'STALE_NOOP';
  throw new Error(`Invalid ${entity} state transition from ${current} to ${next}`);
}

export function rollbackTargetMatches(
  appliedProfileVersionId: unknown,
  appliedProfileChecksum: unknown,
  reportedProfileVersionId: unknown,
  reportedProfileChecksum: unknown,
): boolean {
  return typeof appliedProfileVersionId === 'string'
    && appliedProfileVersionId.length > 0
    && typeof appliedProfileChecksum === 'string'
    && /^[a-f0-9]{64}$/.test(appliedProfileChecksum)
    && reportedProfileVersionId === appliedProfileVersionId
    && reportedProfileChecksum === appliedProfileChecksum;
}

function thingNameFromTopic(topic: string): string {
  if (!topic.startsWith(TOPIC_PREFIX) || !topic.endsWith(STATUS_SUFFIX)) throw new Error('Broker topic is not an authoritative gateway status topic');
  const thingName = topic.slice(TOPIC_PREFIX.length, -STATUS_SUFFIX.length);
  if (!thingName || thingName.includes('/') || !/^[A-Za-z0-9:_-]{1,128}$/.test(thingName)) {
    throw new Error('Broker topic contains an invalid thing name');
  }
  if (topic !== `${TOPIC_PREFIX}${thingName}${STATUS_SUFFIX}`) throw new Error('Broker topic is not canonical');
  return thingName;
}

function deviceStatus(value: unknown): DeviceStatus {
  if (value === 'APPLYING'
    || value === 'HEALTH_CHECK'
    || value === 'APPLIED_HEALTHY'
    || value === 'FAILED'
    || value === 'ROLLING_BACK'
    || value === 'ROLLED_BACK') return value;
  throw new Error('Device status is unsupported');
}

function defaultStatusDetail(status: DeviceStatus): string {
  switch (status) {
    case 'FAILED': return 'Gateway reported an unspecified profile application failure.';
    case 'ROLLING_BACK': return 'Gateway is restoring its prior configuration.';
    case 'ROLLED_BACK': return 'Gateway restored its prior configuration.';
    default: return status;
  }
}

function uiOperationStatus(status: DeviceStatus): UiOperationStatus {
  if (status === 'APPLIED_HEALTHY') return 'SUCCEEDED';
  if (status === 'FAILED' || status === 'ROLLED_BACK') return 'FAILED';
  return 'IN_PROGRESS';
}

function operationTimelineEvents(
  current: string,
  next: DeviceStatus,
  status: UiOperationStatus,
  now: string,
  detail?: string,
): Record<string, unknown>[] {
  if (current === next) return [];
  const events: Record<string, unknown>[] = [];
  if (next === 'APPLIED_HEALTHY' && current !== 'HEALTH_CHECK') {
    events.push({
      state: 'HEALTH_CHECK',
      detail: 'Gateway completed post-apply health validation.',
      at: now,
    });
  }
  events.push({
    state: next,
    operationStatus: status,
    ...(detail ? { detail } : { detail: defaultStatusDetail(next) }),
    at: now,
  });
  return events;
}

function safeDetail(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new Error('Status detail must be a string');
  const normalized = value.trim()
    .split('')
    .map((character) => isControlCharacter(character) ? ' ' : character)
    .join('')
    .replace(/(password|passphrase|token|secret|private.?key|psk)\s*[:=]\s*\S+/gi, '[REDACTED]');
  if (!normalized) return undefined;
  return normalized.slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredBrokerString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maxLength || hasControlCharacters(value)) {
    throw new Error(`Missing or invalid broker field ${label}`);
  }
  return value;
}

function hasControlCharacters(value: string): boolean {
  return value.split('').some(isControlCharacter);
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}

function requiredStoredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}`);
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
