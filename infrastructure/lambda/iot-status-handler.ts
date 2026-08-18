import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Context } from 'aws-lambda';
import { AWS_ACCOUNT_ID, AWS_REGION_NAME, TABLE_NAME } from './shared/config.js';
import { auditSk, ddb, deploymentSk, gatewaySk, operationSk, outboxSk, tenantPk } from './shared/ddb.js';
import { INITIAL_OPERATION_STEPS } from './shared/models.js';
import { canonicalJson } from './shared/profile.js';

const TOPIC_PREFIX = 'ce/v1/gateways/';
const STATUS_SUFFIX = '/status';

export type DeviceStatus = 'APPLYING' | 'HEALTH_CHECK' | 'APPLIED_HEALTHY' | 'FAILED' | 'ROLLING_BACK' | 'ROLLED_BACK';
type UiOperationStatus = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
export type TransitionDisposition = 'APPLY' | 'STALE_NOOP';
export type DeviceStatusRecordDisposition = 'APPLIED' | 'STALE_NOOP' | 'QUARANTINED';

type Item = Record<string, unknown>;
type TransactItems = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']>;
type TransitionEntity = 'gateway' | 'deployment' | 'operation';

const EARLY_STATE_ORDER_BY_ENTITY: Record<TransitionEntity, readonly string[]> = {
  gateway: ['PERMANENT_IDENTITY_ACTIVE', 'PROFILE_AVAILABLE', 'PROFILE_DELIVERED'],
  deployment: ['WAITING_FOR_DEVICE', 'PROFILE_AVAILABLE', 'PROFILE_DELIVERED'],
  // PROFILE_DELIVERED is retained only as an explicit legacy operation
  // state; current writers use PROFILE_STAGED.
  operation: ['CSR_VERIFIED', 'OPERATIONAL_IDENTITY_ISSUED', 'PROFILE_STAGED', 'PROFILE_DELIVERED'],
};
const EARLY_STATES_BY_ENTITY: Record<TransitionEntity, ReadonlySet<string>> = {
  gateway: new Set(EARLY_STATE_ORDER_BY_ENTITY.gateway),
  deployment: new Set(EARLY_STATE_ORDER_BY_ENTITY.deployment),
  operation: new Set(EARLY_STATE_ORDER_BY_ENTITY.operation),
};

export interface AuthoritativeDeviceIdentity {
  thingName: string;
  certificateId: string;
}

export interface DeviceStatusReport extends Record<string, unknown> {
  generation: unknown;
  status: unknown;
  profileVersionId?: unknown;
  profileChecksum?: unknown;
  detail?: unknown;
  error?: unknown;
}

export interface DeviceStatusDependencies {
  queryGatewayByThing(thingName: string): Promise<Item[]>;
  getItem(key: { PK: string; SK: string }): Promise<Item | undefined>;
  transactWrite(items: TransactItems): Promise<void>;
  now(): Date;
  /** MQTT broker identity predates the consistent-base-read HTTP boundary. */
  consistentGatewayRead?: boolean;
}

export class DeviceStatusAuthorizationError extends Error {
  constructor() {
    super('Device identity is not authorized');
  }
}

export class DeviceStatusConflictError extends Error {
  constructor(message = 'Device status is not consistent with the authoritative deployment') {
    super(message);
  }
}

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

const productionDependencies: DeviceStatusDependencies = {
  async queryGatewayByThing(thingName) {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :thing',
      ExpressionAttributeValues: { ':thing': `THING#${thingName}` },
      Limit: 2,
    }));
    return result.Items ?? [];
  },
  async getItem(key) {
    return (await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: key,
      ConsistentRead: true,
    }))).Item;
  },
  async transactWrite(items) {
    await ddb.send(new TransactWriteCommand({ TransactItems: items }));
  },
  now: () => new Date(),
};

const mqttProductionDependencies: DeviceStatusDependencies = {
  ...productionDependencies,
  consistentGatewayRead: false,
};

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

  await recordAuthoritativeDeviceStatus({
    thingName,
    certificateId: brokerPrincipal,
  }, event as DeviceStatusReport, context, mqttProductionDependencies);
}

/**
 * Applies a status report after the transport has authoritatively bound a
 * Thing name to an operational certificate. The core still reauthorizes that
 * pair against the active gateway record before changing deployment state.
 */
export async function recordAuthoritativeDeviceStatus(
  identity: AuthoritativeDeviceIdentity,
  event: DeviceStatusReport,
  context: Context,
  dependencies: DeviceStatusDependencies = productionDependencies,
  raceRetriesRemaining = 1,
): Promise<DeviceStatusRecordDisposition> {
  const thingName = identity.thingName;
  // Keep the broker-oriented local name for source-level compatibility with
  // the existing MQTT identity guard while allowing an HTTPS adapter to call
  // the same transition engine with an already-authoritative certificate ID.
  const brokerPrincipal = identity.certificateId;

  const generation = positiveInteger(event.generation, 'generation');
  const status = deviceStatus(event.status);
  const detail = safeDetail(event.detail ?? event.error);
  const gateway = await gatewayForThing(thingName, dependencies);
  const tenantId = requiredStoredString(gateway.tenantId, 'gateway tenantId');
  const gatewayId = requiredStoredString(gateway.gatewayId, 'gateway gatewayId');
  if (dependencies.consistentGatewayRead !== false
    && (gateway.PK !== tenantPk(tenantId) || gateway.SK !== gatewaySk(gatewayId))) {
    throw new DeviceStatusAuthorizationError();
  }
  const certificateId = requiredStoredString(gateway.certificateId, 'gateway certificateId');
  const certificatePrincipal = requiredStoredString(gateway.certificatePrincipal, 'gateway certificatePrincipal');
  const expectedCertificatePrincipal = `arn:aws:iot:${AWS_REGION_NAME}:${AWS_ACCOUNT_ID}:cert/${certificateId}`;
  if (certificatePrincipal !== expectedCertificatePrincipal) throw new DeviceStatusAuthorizationError();
  if (certificateId !== brokerPrincipal) throw new DeviceStatusAuthorizationError();
  if (gateway.thingName !== thingName) throw new DeviceStatusAuthorizationError();
  if (gateway.certificateStatus !== 'ACTIVE') throw new DeviceStatusAuthorizationError();
  let desiredGeneration: number;
  try {
    desiredGeneration = positiveInteger(gateway.desiredGeneration, 'gateway desiredGeneration');
  } catch {
    throw new DeviceStatusConflictError('Gateway desired generation is missing or invalid');
  }
  if (desiredGeneration !== generation) {
    throw new DeviceStatusConflictError('Device status generation is not the authoritative desired generation');
  }

  const deployment = await dependencies.getItem({
    PK: tenantPk(tenantId),
    SK: deploymentSk(gatewayId, generation),
  });
  if (!deployment
    || deployment.entityType !== 'DEPLOYMENT'
    || deployment.gatewayId !== gatewayId
    || positiveInteger(deployment.generation, 'deployment generation') !== generation) {
    throw new DeviceStatusConflictError('Authoritative deployment record is missing or inconsistent');
  }
  const profileVersionId = requiredStoredString(deployment.profileVersionId, 'deployment profileVersionId');
  const gatewayState = requiredStoredString(gateway.state, 'gateway state');
  const deploymentStatus = requiredStoredString(deployment.status, 'deployment status');
  if (!isRecord(deployment.descriptor)) {
    throw new DeviceStatusConflictError('Authoritative deployment descriptor is missing or invalid');
  }
  const descriptor = deployment.descriptor;
  const assignmentClearedTerminal = gatewayState === 'ROLLED_BACK' || gatewayState === 'QUARANTINED';
  if (!assignmentClearedTerminal && gateway.desiredProfileVersionId !== profileVersionId) {
    throw new DeviceStatusConflictError('Gateway desired profile does not match the authoritative deployment');
  }
  if (deployment.PK !== tenantPk(tenantId)
    || deployment.SK !== deploymentSk(gatewayId, generation)
    || deployment.tenantId !== tenantId
    || (!assignmentClearedTerminal && (!isRecord(gateway.signedDescriptor)
      || canonicalJson(gateway.signedDescriptor) !== canonicalJson(descriptor)))) {
    throw new DeviceStatusConflictError('Authoritative deployment lineage is inconsistent');
  }
  const authoritativeChecksum = requiredChecksum(descriptor.profileSha256, 'deployment descriptor profileSha256');
  let reportedChecksum: string | undefined;
  let rollbackProfileVersionId: string | undefined;
  let rollbackProfileChecksum: string | undefined;
  let rollbackAttestationValid = true;
  if (status === 'APPLIED_HEALTHY') {
    const reportedProfileVersionId = requiredStoredString(event.profileVersionId, 'reported profileVersionId');
    reportedChecksum = requiredChecksum(event.profileChecksum, 'reported profileChecksum');
    if (reportedProfileVersionId !== profileVersionId || reportedChecksum !== authoritativeChecksum) {
      throw new DeviceStatusConflictError('Healthy acknowledgement does not match the authoritative profile version and checksum');
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
  let gatewayDisposition: TransitionDisposition;
  let deploymentDisposition: TransitionDisposition;
  try {
    gatewayDisposition = transitionDisposition(gatewayState, status, 'gateway');
    deploymentDisposition = transitionDisposition(deploymentStatus, status, 'deployment');
  } catch (error) {
    throw new DeviceStatusConflictError(error instanceof Error ? error.message : undefined);
  }

  const operationId = requiredStoredString(deployment.operationId, 'deployment operationId');
  if (gateway.operationId !== operationId) {
    throw new DeviceStatusConflictError('Gateway operation does not match the authoritative deployment');
  }
  const operation = await dependencies.getItem({
    PK: tenantPk(tenantId),
    SK: operationSk(operationId),
  });
  if (!operation
    || operation.entityType !== 'OPERATION'
    || operation.PK !== tenantPk(tenantId)
    || operation.SK !== operationSk(operationId)
    || operation.tenantId !== tenantId
    || operation.operationId !== operationId
    || operation.gatewayId !== gatewayId
    || operation.profileVersionId !== profileVersionId
    || operation.deploymentGeneration !== generation) {
    throw new DeviceStatusConflictError('Deployment operation record is missing or inconsistent');
  }
  const operationState = requiredStoredString(operation.state, 'operation state');
  let operationDisposition: TransitionDisposition;
  try {
    operationDisposition = transitionDisposition(operationState, status, 'operation');
  } catch (error) {
    throw new DeviceStatusConflictError(error instanceof Error ? error.message : undefined);
  }

  // A record already at the reported state can be omitted while lagging peers
  // advance atomically. A record beyond the report still makes the whole event
  // stale, preventing terminal or forward-state regression.
  const transitions = [
    { current: gatewayState, disposition: gatewayDisposition },
    { current: deploymentStatus, disposition: deploymentDisposition },
    { current: operationState, disposition: operationDisposition },
  ];
  if (transitions.some(({ current, disposition }) => disposition === 'STALE_NOOP' && current !== status)) {
    return 'STALE_NOOP';
  }
  const transitionGateway = gatewayDisposition === 'APPLY';
  const transitionDeployment = deploymentDisposition === 'APPLY';
  const transitionOperation = operationDisposition === 'APPLY';
  if (!transitionGateway && !transitionDeployment && !transitionOperation) return 'STALE_NOOP';

  const observedAt = dependencies.now();
  const now = observedAt.toISOString();
  const tenantKey = tenantPk(tenantId);
  const errorDetail = detail ?? defaultStatusDetail(status);
  if (status === 'ROLLED_BACK' && !rollbackAttestationValid) {
    try {
      await quarantineInvalidRollback({
        tenantId, tenantKey, gatewayId, thingName, certificateId, certificatePrincipal, generation,
        profileVersionId, descriptor, gatewayState, deploymentStatus, operationId, operationState,
        detail: errorDetail, now, context, dependencies,
      });
    } catch (error) {
      if (!isConditionalTransactionRace(error)
        || !await committedQuarantineMatches({
          tenantId, gatewayId, thingName, certificateId, certificatePrincipal, generation,
          profileVersionId, operationId, descriptor, dependencies,
        })) throw error;
    }
    return 'QUARANTINED';
  }
  const rollbackClearOutboxId = status === 'ROLLED_BACK' ? `rollback_clear_${context.awsRequestId}` : undefined;
  const rollbackLeaseExpiry = status === 'ROLLED_BACK' ? Math.floor(observedAt.getTime() / 1000) + 60 : undefined;
  const gatewayUpdate = gatewayUpdateExpression(status);
  const deploymentUpdate = deploymentUpdateExpression(status);
  const transaction: TransactItems = [];
  if (transitionGateway) transaction.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: gatewaySk(gatewayId) },
        UpdateExpression: gatewayUpdate.expression,
        ConditionExpression: 'entityType = :gateway AND tenantId = :tenantId AND gatewayId = :gatewayId AND thingName = :thingName AND certificateId = :certificateId AND certificatePrincipal = :certificatePrincipal AND certificateStatus = :active AND desiredGeneration = :generation AND desiredProfileVersionId = :profileVersionId AND operationId = :operationId AND signedDescriptor = :descriptor AND #state = :current',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY',
          ':tenantId': tenantId,
          ':gatewayId': gatewayId,
          ':thingName': thingName,
          ':certificateId': certificateId,
          ':certificatePrincipal': certificatePrincipal,
          ':active': 'ACTIVE',
          ':generation': generation,
          ':profileVersionId': profileVersionId,
          ':operationId': operationId,
          ':descriptor': descriptor,
          ':current': gatewayState,
          ':next': status,
          ':health': status === 'APPLIED_HEALTHY' ? 'HEALTHY'
            : status === 'FAILED' || status === 'ROLLING_BACK' || status === 'ROLLED_BACK' ? 'DEGRADED'
              : 'APPLYING',
          ':now': now,
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
    });
  if (transitionDeployment) transaction.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: deploymentSk(gatewayId, generation) },
        UpdateExpression: deploymentUpdate.expression,
        ConditionExpression: 'entityType = :deployment AND tenantId = :tenantId AND gatewayId = :gatewayId AND generation = :generation AND profileVersionId = :profileVersionId AND operationId = :operationId AND #descriptor = :descriptor AND #status = :current',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error', '#descriptor': 'descriptor' },
        ExpressionAttributeValues: {
          ':deployment': 'DEPLOYMENT',
          ':tenantId': tenantId,
          ':gatewayId': gatewayId,
          ':generation': generation,
          ':profileVersionId': profileVersionId,
          ':operationId': operationId,
          ':descriptor': descriptor,
          ':current': deploymentStatus,
          ':next': status,
          ':now': now,
          ...(status === 'APPLIED_HEALTHY' ? { ':profileChecksum': reportedChecksum } : {}),
          ...(status === 'ROLLED_BACK' ? {
            ':rollbackProfileVersionId': rollbackProfileVersionId,
            ':rollbackProfileChecksum': rollbackProfileChecksum,
          } : {}),
          ...(deploymentUpdate.needsError ? { ':deviceError': errorDetail } : {}),
        },
      },
    });

  if (transitionOperation) {
    const uiStatus = uiOperationStatus(status);
    transaction.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: operationSk(operationId) },
        UpdateExpression: status === 'FAILED' || status === 'ROLLED_BACK'
          ? 'SET operationStatus = :uiStatus, #state = :next, deploymentGeneration = :generation, updatedAt = :now, steps = :steps, timeline = list_append(if_not_exists(timeline, :empty), :events), failure = :failure REMOVE #error'
          : 'SET operationStatus = :uiStatus, #state = :next, deploymentGeneration = :generation, updatedAt = :now, steps = :steps, timeline = list_append(if_not_exists(timeline, :empty), :events) REMOVE #error, failure',
        ConditionExpression: 'entityType = :operation AND tenantId = :tenantId AND operationId = :operationId AND gatewayId = :gatewayId AND profileVersionId = :profileVersionId AND deploymentGeneration = :generation AND #state = :current',
        ExpressionAttributeNames: { '#state': 'state', '#error': 'error' },
        ExpressionAttributeValues: {
          ':operation': 'OPERATION',
          ':tenantId': tenantId,
          ':operationId': operationId,
          ':gatewayId': gatewayId,
          ':profileVersionId': profileVersionId,
          ':current': operationState,
          ':next': status,
          ':uiStatus': uiStatus,
          ':generation': generation,
          ':now': now,
          ':steps': operationSteps(operation.steps, status, now, detail),
          ':empty': [],
          ':events': operationTimelineEvents(operationState, status, uiStatus, now, detail),
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

  try {
    await dependencies.transactWrite(transaction);
  } catch (error) {
    if (!isConditionalTransactionRace(error)) throw error;
    const recovery = await committedStatusRecovery({
      tenantId, gatewayId, thingName, certificateId, certificatePrincipal, generation,
      profileVersionId, operationId, descriptor, status,
      gatewayState, deploymentStatus, operationState,
      rollbackProfileVersionId, rollbackProfileChecksum, dependencies,
    });
    if (recovery === 'STALE_NOOP') return 'STALE_NOOP';
    if (recovery === 'RETRY' && raceRetriesRemaining > 0) {
      return recordAuthoritativeDeviceStatus(identity, event, context, dependencies, raceRetriesRemaining - 1);
    }
    throw error;
  }
  return 'APPLIED';
}

function isConditionalTransactionRace(error: unknown): boolean {
  if (!isRecord(error)
    || error.name !== 'TransactionCanceledException'
    || !Array.isArray(error.CancellationReasons)) return false;

  let hasRaceReason = false;
  for (const reason of error.CancellationReasons) {
    if (!isRecord(reason) || typeof reason.Code !== 'string') return false;
    if (reason.Code === 'None') continue;
    if (reason.Code !== 'ConditionalCheckFailed' && reason.Code !== 'TransactionConflict') return false;
    hasRaceReason = true;
  }
  return hasRaceReason;
}

type ConcurrentStatusRecovery = 'STALE_NOOP' | 'RETRY' | 'MISMATCH';

async function committedStatusRecovery(input: {
  tenantId: string;
  gatewayId: string;
  thingName: string;
  certificateId: string;
  certificatePrincipal: string;
  generation: number;
  profileVersionId: string;
  operationId: string;
  descriptor: Item;
  status: DeviceStatus;
  gatewayState: string;
  deploymentStatus: string;
  operationState: string;
  rollbackProfileVersionId: string | undefined;
  rollbackProfileChecksum: string | undefined;
  dependencies: DeviceStatusDependencies;
}): Promise<ConcurrentStatusRecovery> {
  const tenantKey = tenantPk(input.tenantId);
  const [gateway, deployment, operation] = await Promise.all([
    input.dependencies.getItem({ PK: tenantKey, SK: gatewaySk(input.gatewayId) }),
    input.dependencies.getItem({ PK: tenantKey, SK: deploymentSk(input.gatewayId, input.generation) }),
    input.dependencies.getItem({ PK: tenantKey, SK: operationSk(input.operationId) }),
  ]);
  if (!gateway || !deployment || !operation) return 'MISMATCH';

  const exactGateway = gateway.entityType === 'GATEWAY'
    && gateway.PK === tenantKey
    && gateway.SK === gatewaySk(input.gatewayId)
    && gateway.tenantId === input.tenantId
    && gateway.gatewayId === input.gatewayId
    && gateway.thingName === input.thingName
    && gateway.certificateId === input.certificateId
    && gateway.certificatePrincipal === input.certificatePrincipal
    && gateway.certificateStatus === 'ACTIVE'
    && gateway.desiredGeneration === input.generation
    && gateway.operationId === input.operationId;
  const exactDeployment = deployment.entityType === 'DEPLOYMENT'
    && deployment.PK === tenantKey
    && deployment.SK === deploymentSk(input.gatewayId, input.generation)
    && deployment.tenantId === input.tenantId
    && deployment.gatewayId === input.gatewayId
    && deployment.generation === input.generation
    && deployment.profileVersionId === input.profileVersionId
    && deployment.operationId === input.operationId;
  const exactOperation = operation.entityType === 'OPERATION'
    && operation.PK === tenantKey
    && operation.SK === operationSk(input.operationId)
    && operation.tenantId === input.tenantId
    && operation.operationId === input.operationId
    && operation.gatewayId === input.gatewayId
    && operation.profileVersionId === input.profileVersionId
    && operation.deploymentGeneration === input.generation;
  if (!exactGateway || !exactDeployment || !exactOperation) return 'MISMATCH';

  let authoritativeChecksum: string;
  let assignmentIntact = false;
  try {
    authoritativeChecksum = requiredChecksum(input.descriptor.profileSha256, 'descriptor profileSha256');
    if (!isRecord(deployment.descriptor)
      || canonicalJson(deployment.descriptor) !== canonicalJson(input.descriptor)) return 'MISMATCH';
    assignmentIntact = gateway.desiredProfileVersionId === input.profileVersionId
      && isRecord(gateway.signedDescriptor)
      && canonicalJson(gateway.signedDescriptor) === canonicalJson(input.descriptor);
  } catch {
    return 'MISMATCH';
  }

  // A transaction conflict can be reported even when no competing writer
  // commits. Exact unchanged assignment state is safe for the caller's single
  // bounded retry; it is not a committed device-status winner.
  const exactUnchangedState = gateway.state === input.gatewayState
    && deployment.status === input.deploymentStatus
    && operation.state === input.operationState;
  const validEarlyAdvancement = isValidEarlyStateAdvancement('gateway', input.gatewayState, gateway.state)
    && isValidEarlyStateAdvancement('deployment', input.deploymentStatus, deployment.status)
    && isValidEarlyStateAdvancement('operation', input.operationState, operation.state);
  if (assignmentIntact && (exactUnchangedState || validEarlyAdvancement)) return 'RETRY';

  let committedStatus: DeviceStatus;
  try {
    committedStatus = deviceStatus(gateway.state);
  } catch {
    return 'MISMATCH';
  }
  if (deployment.status !== committedStatus || operation.state !== committedStatus) return 'MISMATCH';
  if (committedStatus !== 'ROLLED_BACK' && !assignmentIntact) return 'MISMATCH';

  if (committedStatus === 'APPLIED_HEALTHY'
    && !(gateway.appliedGeneration === input.generation
      && gateway.appliedProfileVersionId === input.profileVersionId
      && gateway.appliedProfileChecksum === authoritativeChecksum
      && deployment.appliedProfileVersionId === input.profileVersionId
      && deployment.appliedProfileChecksum === authoritativeChecksum)) {
    return 'MISMATCH';
  }
  if (committedStatus === 'ROLLED_BACK') {
    const rollbackProfileVersionId = gateway.rolledBackToProfileVersionId;
    const rollbackProfileChecksum = gateway.rolledBackToProfileChecksum;
    if (!(typeof rollbackProfileVersionId === 'string'
      && typeof rollbackProfileChecksum === 'string'
      && /^[a-f0-9]{64}$/.test(rollbackProfileChecksum)
      && gateway.appliedProfileVersionId === rollbackProfileVersionId
      && gateway.appliedProfileChecksum === rollbackProfileChecksum
      && deployment.rolledBackToProfileVersionId === rollbackProfileVersionId
      && deployment.rolledBackToProfileChecksum === rollbackProfileChecksum
      && (input.status !== 'ROLLED_BACK'
        || (input.rollbackProfileVersionId === rollbackProfileVersionId
          && input.rollbackProfileChecksum === rollbackProfileChecksum)))) return 'MISMATCH';
  }

  return transitionDisposition(committedStatus, input.status, 'gateway') === 'STALE_NOOP'
    ? 'STALE_NOOP'
    : 'RETRY';
}

async function committedQuarantineMatches(input: {
  tenantId: string;
  gatewayId: string;
  thingName: string;
  certificateId: string;
  certificatePrincipal: string;
  generation: number;
  profileVersionId: string;
  operationId: string;
  descriptor: Item;
  dependencies: DeviceStatusDependencies;
}): Promise<boolean> {
  const tenantKey = tenantPk(input.tenantId);
  const [gateway, deployment, operation] = await Promise.all([
    input.dependencies.getItem({ PK: tenantKey, SK: gatewaySk(input.gatewayId) }),
    input.dependencies.getItem({ PK: tenantKey, SK: deploymentSk(input.gatewayId, input.generation) }),
    input.dependencies.getItem({ PK: tenantKey, SK: operationSk(input.operationId) }),
  ]);
  if (!gateway || !deployment || !operation) return false;
  let descriptorMatches = false;
  try {
    descriptorMatches = isRecord(deployment.descriptor)
      && canonicalJson(deployment.descriptor) === canonicalJson(input.descriptor);
  } catch {
    return false;
  }
  return gateway.entityType === 'GATEWAY'
    && gateway.PK === tenantKey
    && gateway.SK === gatewaySk(input.gatewayId)
    && gateway.tenantId === input.tenantId
    && gateway.gatewayId === input.gatewayId
    && gateway.thingName === input.thingName
    && gateway.certificateId === input.certificateId
    && gateway.certificatePrincipal === input.certificatePrincipal
    && gateway.certificateStatus === 'ACTIVE'
    && gateway.desiredGeneration === input.generation
    && gateway.operationId === input.operationId
    && gateway.state === 'QUARANTINED'
    && gateway.health === 'DEGRADED'
    && gateway.desiredProfileVersionId == null
    && gateway.signedDescriptor == null
    && deployment.entityType === 'DEPLOYMENT'
    && deployment.PK === tenantKey
    && deployment.SK === deploymentSk(input.gatewayId, input.generation)
    && deployment.tenantId === input.tenantId
    && deployment.gatewayId === input.gatewayId
    && deployment.generation === input.generation
    && deployment.profileVersionId === input.profileVersionId
    && deployment.operationId === input.operationId
    && deployment.status === 'FAILED'
    && descriptorMatches
    && operation.entityType === 'OPERATION'
    && operation.PK === tenantKey
    && operation.SK === operationSk(input.operationId)
    && operation.tenantId === input.tenantId
    && operation.operationId === input.operationId
    && operation.gatewayId === input.gatewayId
    && operation.profileVersionId === input.profileVersionId
    && operation.deploymentGeneration === input.generation
    && operation.state === 'FAILED'
    && isRecord(operation.failure)
    && operation.failure.code === 'ROLLBACK_ATTESTATION_FAILED';
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
  descriptor: Item;
  gatewayState: string;
  deploymentStatus: string;
  operationId: string;
  operationState: string;
  detail: string;
  now: string;
  context: Context;
  dependencies: DeviceStatusDependencies;
}): Promise<void> {
  const outboxId = `rollback_quarantine_${input.context.awsRequestId}`;
  const leaseExpiry = Math.floor(input.dependencies.now().getTime() / 1000) + 60;
  const auditId = `iot_${input.context.awsRequestId}`;
  await input.dependencies.transactWrite([
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: input.tenantKey, SK: gatewaySk(input.gatewayId) },
        UpdateExpression: 'SET #state = :quarantined, health = :degraded, lastError = :error, rollbackRecoveryRequiredAt = :now, dispatchLeaseId = :leaseId, dispatchLeaseGeneration = :generation, dispatchLeaseExpiresAtEpoch = :leaseExpiry, updatedAt = :now REMOVE desiredProfileVersionId, signedDescriptor',
        ConditionExpression: 'entityType = :gateway AND tenantId = :tenantId AND gatewayId = :gatewayId AND #state = :current AND thingName = :thingName AND certificateId = :certificateId AND certificatePrincipal = :principal AND certificateStatus = :active AND desiredGeneration = :generation AND desiredProfileVersionId = :profileVersionId AND operationId = :operationId AND signedDescriptor = :descriptor',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY', ':current': input.gatewayState, ':quarantined': 'QUARANTINED',
          ':tenantId': input.tenantId, ':gatewayId': input.gatewayId,
          ':degraded': 'DEGRADED', ':error': 'Rollback target did not match the last known applied profile.',
          ':thingName': input.thingName, ':certificateId': input.certificateId,
          ':principal': input.certificatePrincipal, ':active': 'ACTIVE', ':generation': input.generation,
          ':profileVersionId': input.profileVersionId, ':operationId': input.operationId,
          ':descriptor': input.descriptor,
          ':leaseId': outboxId, ':leaseExpiry': leaseExpiry, ':now': input.now,
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: input.tenantKey, SK: deploymentSk(input.gatewayId, input.generation) },
        UpdateExpression: 'SET #status = :failed, #error = :error, rollbackRecoveryRequiredAt = :now, updatedAt = :now',
        ConditionExpression: 'entityType = :deployment AND tenantId = :tenantId AND #status = :current AND gatewayId = :gatewayId AND generation = :generation AND profileVersionId = :profileVersionId AND operationId = :operationId AND #descriptor = :descriptor',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error', '#descriptor': 'descriptor' },
        ExpressionAttributeValues: {
          ':deployment': 'DEPLOYMENT', ':current': input.deploymentStatus, ':failed': 'FAILED',
          ':tenantId': input.tenantId, ':gatewayId': input.gatewayId, ':generation': input.generation,
          ':profileVersionId': input.profileVersionId, ':operationId': input.operationId,
          ':descriptor': input.descriptor,
          ':error': 'Rollback target attestation failed; recovery is required.', ':now': input.now,
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: input.tenantKey, SK: operationSk(input.operationId) },
        UpdateExpression: 'SET operationStatus = :failed, #state = :failed, failure = :failure, updatedAt = :now, timeline = list_append(if_not_exists(timeline, :empty), :events)',
        ConditionExpression: 'entityType = :operation AND tenantId = :tenantId AND operationId = :operationId AND #state = :current AND gatewayId = :gatewayId AND profileVersionId = :profileVersionId AND deploymentGeneration = :generation',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':operation': 'OPERATION', ':current': input.operationState, ':gatewayId': input.gatewayId,
          ':tenantId': input.tenantId, ':operationId': input.operationId,
          ':profileVersionId': input.profileVersionId, ':generation': input.generation,
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
  ]);
}

async function gatewayForThing(thingName: string, dependencies: DeviceStatusDependencies): Promise<Item> {
  const matches = await dependencies.queryGatewayByThing(thingName);
  if (matches.length !== 1) throw new DeviceStatusAuthorizationError();
  const located = matches[0];
  if (!located || located.entityType !== 'GATEWAY') {
    throw new DeviceStatusAuthorizationError();
  }
  // The MQTT adapter keeps its broker-authoritative legacy lookup behavior.
  // HTTP callers must dereference the GSI locator with a strongly consistent
  // base-table read before any certificate or deployment-state decision.
  if (dependencies.consistentGatewayRead === false) return located;
  if (typeof located.PK !== 'string'
    || typeof located.SK !== 'string'
    || located.GSI1PK !== `THING#${thingName}`) {
    throw new DeviceStatusAuthorizationError();
  }
  const gateway = await dependencies.getItem({ PK: located.PK, SK: located.SK });
  if (!gateway
    || gateway.entityType !== 'GATEWAY'
    || gateway.PK !== located.PK
    || gateway.SK !== located.SK) {
    throw new DeviceStatusAuthorizationError();
  }
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

  set('identity', 'complete', 'Permanent device certificate authenticated.');
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
  const earlyStates = EARLY_STATES_BY_ENTITY[entity as TransitionEntity];
  if (!earlyStates) throw new Error(`Unknown transition entity ${entity}`);
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

function isValidEarlyStateAdvancement(
  entity: TransitionEntity,
  observed: string,
  reread: unknown,
): boolean {
  if (typeof reread !== 'string') return false;
  const earlyStates = EARLY_STATES_BY_ENTITY[entity];
  if (!earlyStates.has(observed) || !earlyStates.has(reread)) return false;
  const order = EARLY_STATE_ORDER_BY_ENTITY[entity];
  return order.indexOf(reread) >= order.indexOf(observed);
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
