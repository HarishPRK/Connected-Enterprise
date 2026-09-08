import {
  DeleteCertificateCommand, DeleteThingCommand, DescribeCertificateCommand, DescribeThingCommand,
  DetachPolicyCommand, DetachThingPrincipalCommand, IoTClient, ListAttachedPoliciesCommand,
  ListPrincipalThingsCommand, ListThingPrincipalsCommand, UpdateCertificateCommand,
  ListThingGroupsForThingCommand, RemoveThingFromThingGroupCommand,
  ListJobExecutionsForThingCommand, DescribeJobCommand, DeleteJobCommand,
} from '@aws-sdk/client-iot';
import { DeleteConnectionCommand, DeleteThingShadowCommand, IoTDataPlaneClient, ListNamedShadowsForThingCommand } from '@aws-sdk/client-iot-data-plane';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { TenantContext } from './auth.js';
import { AWS_ACCOUNT_ID, AWS_REGION_NAME, IOT_DATA_ENDPOINT, STAGE, TABLE_NAME } from './config.js';
import { ConflictError, ddb, gatewaySk, operationSk, outboxSk, serialPk, tenantPk } from './ddb.js';
import { newId, sha256 } from './crypto.js';

type Item = Record<string, any>;
type Transaction = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']>;
const iot = new IoTClient({});
const data = new IoTDataPlaneClient(IOT_DATA_ENDPOINT ? { endpoint: `https://${IOT_DATA_ENDPOINT.replace(/^https?:\/\//, '')}` } : {});
const get = async (PK: string, SK: string) => (await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK }, ConsistentRead: true }))).Item;
const put = (Item: Item) => ({ Put: { TableName: TABLE_NAME, Item, ConditionExpression: 'attribute_not_exists(PK)' } });
const certArn = (id: string) => `arn:aws:iot:${AWS_REGION_NAME}:${AWS_ACCOUNT_ID}:cert/${id}`;
const isMissing = (error: unknown) => error instanceof Error && error.name === 'ResourceNotFoundException';
async function absentOkay<T>(call: () => Promise<T>): Promise<T | undefined> {
  try { return await call(); } catch (error) { if (!isMissing(error)) throw error; return undefined; }
}

export function requireResetIdentity(gateway: Item, manufacturing: Item | undefined, tenantId: string): void {
  const digest = sha256(String(gateway.serialNumber)).slice(0, 24);
  const unissued = gateway.certificateId === undefined && manufacturing?.certificateId === undefined
    && gateway.certificatePrincipal === undefined && manufacturing?.certificatePrincipal === undefined;
  if (STAGE !== 'dev' || gateway.entityType !== 'GATEWAY' || gateway.tenantId !== tenantId
    || gateway.gatewayId !== `gw_${digest}` || gateway.thingName !== `gw-${digest}`
    || !manufacturing || manufacturing.entityType !== 'MANUFACTURING'
    || manufacturing.tenantId !== tenantId || manufacturing.gatewayId !== gateway.gatewayId
    || manufacturing.serialNumber !== gateway.serialNumber || manufacturing.thingName !== gateway.thingName
    || manufacturing.certificateId !== gateway.certificateId
    || (!unissued && !/^[a-f0-9]{64}$/.test(String(gateway.certificateId)))
    || !/^[a-f0-9]{64}$/.test(String(manufacturing.bootstrapCertificateId))
    || manufacturing.bootstrapCertificateId === gateway.certificateId
    || manufacturing.claimMechanism !== 'PRELOADED_UNIQUE_BOOTSTRAP') {
    throw new ConflictError('Reset identity does not match this tenant and gateway');
  }
}

/** Reserve the serial until the outbox has verified AWS cleanup. */
export async function requestGatewayReset(context: TenantContext, gateway: Item, idempotency: (response: Item) => Item): Promise<Item> {
  const PK = tenantPk(context.tenantId);
  const manufacturing = await get(serialPk(gateway.serialNumber), 'MANUFACTURING');
  requireResetIdentity(gateway, manufacturing, context.tenantId);
  const nowEpoch = Math.floor(Date.now() / 1000);
  const retry = typeof gateway.resetOperationId === 'string';
  const pendingEnrollment = manufacturing!.state === 'ENROLLMENT_PENDING' && gateway.state === 'PENDING'
    && gateway.certificateState === 'PENDING' && gateway.certificateId === undefined;
  if ((!retry && !pendingEnrollment && (!['PROVISIONED', 'DECOMMISSIONED'].includes(manufacturing!.state)
    || !['ACTIVE', 'REVOKED', 'INACTIVE'].includes(gateway.certificateStatus)))
    || manufacturing!.bootstrapCertificateStatus === 'DEACTIVATING'
    || Number(gateway.dispatchLeaseExpiresAtEpoch ?? 0) >= nowEpoch
    || Number(gateway.resetLeaseExpiresAtEpoch ?? 0) >= nowEpoch) {
    throw new ConflictError('Gateway identity or cleanup is still busy. Wait for the current step, then retry reset.');
  }
  const now = new Date().toISOString();
  const operationId = retry ? gateway.resetOperationId : newId('op');
  const previous = retry ? await get(PK, operationSk(operationId)) : undefined;
  if (retry && (!previous?.resetError || previous.registrationReleased)) {
    throw new ConflictError('Reset is already running. Open View progress to follow it.');
  }
  const operation: Item = previous ?? {
    PK, SK: operationSk(operationId), entityType: 'OPERATION', tenantId: context.tenantId,
    operationId, type: 'DECOMMISSION', operationStatus: 'IN_PROGRESS', state: 'DECOMMISSIONING',
    resetForOnboarding: true, gatewayId: gateway.gatewayId, serialNumber: gateway.serialNumber,
    siteId: gateway.siteId, deploymentGeneration: gateway.generation,
    timeline: [{ state: 'DECOMMISSIONING', at: now, detail: 'AWS identity cleanup requested; the serial stays reserved until cleanup succeeds.' }],
    createdAt: now, updatedAt: now, GSI3PK: `${PK}#OPERATION`, GSI3SK: `${now}#${operationId}`,
  };
  const outboxId = newId('out');
  // Compete atomically with the pre-provision hook. If it issues an identity
  // first, this reservation fails before any certificate is touched.
  const certCondition = gateway.certificateId === undefined
    ? 'attribute_not_exists(certificateId) AND attribute_not_exists(certificatePrincipal)' : 'certificateId = :cert';
  const certValues = gateway.certificateId === undefined ? {} : { ':cert': gateway.certificateId };
  const transaction: Transaction = [
    { Update: { TableName: TABLE_NAME, Key: { PK, SK: gateway.SK },
      UpdateExpression: 'SET #state = :retiring, certificateStatus = :revoking, resetOperationId = :op, operationId = :op, updatedAt = :now',
      ConditionExpression: `tenantId = :tenant AND ${certCondition} AND #state = :oldState AND operationId = :oldOp AND (attribute_not_exists(dispatchLeaseExpiresAtEpoch) OR dispatchLeaseExpiresAtEpoch < :epoch) AND (attribute_not_exists(resetLeaseExpiresAtEpoch) OR resetLeaseExpiresAtEpoch < :epoch)`,
      ExpressionAttributeNames: { '#state': 'state' }, ExpressionAttributeValues: {
        ':retiring': 'DECOMMISSIONING', ':revoking': 'REVOKING', ':op': operationId, ':now': now,
        ':tenant': context.tenantId, ...certValues, ':oldState': gateway.state, ':oldOp': gateway.operationId, ':epoch': nowEpoch,
      } } },
    { Update: { TableName: TABLE_NAME, Key: { PK: serialPk(gateway.serialNumber), SK: 'MANUFACTURING' },
      UpdateExpression: 'SET #state = :retiring, certificateStatus = :revoking, resetOperationId = :op, updatedAt = :now',
      ConditionExpression: `tenantId = :tenant AND gatewayId = :gateway AND ${certCondition} AND bootstrapCertificateId = :bootstrap AND #state = :oldState AND bootstrapCertificateStatus = :oldBootstrap`,
      ExpressionAttributeNames: { '#state': 'state' }, ExpressionAttributeValues: {
        ':retiring': 'DECOMMISSIONING', ':revoking': 'REVOKING', ':op': operationId, ':now': now,
        ':tenant': context.tenantId, ':gateway': gateway.gatewayId, ...certValues,
        ':bootstrap': manufacturing!.bootstrapCertificateId, ':oldState': manufacturing!.state, ':oldBootstrap': manufacturing!.bootstrapCertificateStatus,
      } } },
    put({ PK, SK: outboxSk(now, outboxId), entityType: 'OUTBOX', eventType: 'RESET_GATEWAY_REGISTRATION',
      state: 'PENDING', outboxId, tenantId: context.tenantId, gatewayId: gateway.gatewayId,
      operationId, serialNumber: gateway.serialNumber, thingName: gateway.thingName,
      certificateId: gateway.certificateId, bootstrapCertificateId: manufacturing!.bootstrapCertificateId, createdAt: now, updatedAt: now }),
    put(idempotency(operation)),
    put({ PK, SK: `AUDIT#${now}#${outboxId}`, entityType: 'AUDIT', tenantId: context.tenantId,
      actorSubject: context.subject, actorRole: context.role, action: retry ? 'GATEWAY_RESET_RETRIED' : 'GATEWAY_RESET_REQUESTED',
      targetId: gateway.gatewayId, createdAt: now, outcome: 'SUCCESS' }),
  ];
  if (retry) transaction.push({ Update: { TableName: TABLE_NAME, Key: { PK, SK: operation.SK },
    UpdateExpression: 'SET updatedAt = :now REMOVE resetError',
    ConditionExpression: 'resetForOnboarding = :yes AND attribute_exists(resetError)',
    ExpressionAttributeValues: { ':now': now, ':yes': true } } });
  else transaction.push(put(operation));
  await ddb.send(new TransactWriteCommand({ TransactItems: transaction }));
  return operation;
}

/** Re-entrant cleanup. A gateway-wide lease outlives the Lambda timeout, preventing
 * duplicate stream deliveries from touching a later registration of the serial. */
export async function resetGatewayRegistration(outbox: Item, leaseId: string): Promise<void> {
  const PK = tenantPk(outbox.tenantId);
  const gatewayKey = { PK, SK: gatewaySk(outbox.gatewayId) };
  const manufacturingKey = { PK: serialPk(outbox.serialNumber), SK: 'MANUFACTURING' };
  const operation = await get(PK, operationSk(outbox.operationId));
  if (operation?.registrationReleased === true) {
    await ddb.send(new UpdateCommand({ TableName: TABLE_NAME, Key: { PK: outbox.PK, SK: outbox.SK },
      UpdateExpression: 'SET #state = :sent', ExpressionAttributeNames: { '#state': 'state' }, ExpressionAttributeValues: { ':sent': 'SENT' } }));
    return;
  }
  const [gateway, manufacturing, binding] = await Promise.all([
    get(PK, gatewayKey.SK), get(manufacturingKey.PK, manufacturingKey.SK), get(`BOOTSTRAPCERT#${outbox.bootstrapCertificateId}`, 'BINDING'),
  ]);
  requireResetIdentity(gateway ?? {}, manufacturing, outbox.tenantId);
  if (gateway!.resetOperationId !== outbox.operationId || gateway!.state !== 'DECOMMISSIONING'
    || manufacturing!.resetOperationId !== outbox.operationId || manufacturing!.state !== 'DECOMMISSIONING'
    || gateway!.certificateId !== outbox.certificateId || manufacturing!.bootstrapCertificateId !== outbox.bootstrapCertificateId
    || gateway!.thingName !== outbox.thingName || gateway!.serialNumber !== outbox.serialNumber
    || !binding || binding.entityType !== 'BOOTSTRAP_CERTIFICATE_BINDING'
    || binding.tenantId !== outbox.tenantId || binding.serialNumber !== outbox.serialNumber
    || binding.bootstrapCertificateId !== outbox.bootstrapCertificateId) throw new Error('Reset reservation or bootstrap binding changed');
  const epoch = Math.floor(Date.now() / 1000);
  const certCondition = outbox.certificateId === undefined
    ? 'attribute_not_exists(certificateId) AND attribute_not_exists(certificatePrincipal)' : 'certificateId = :cert';
  const certValues = outbox.certificateId === undefined ? {} : { ':cert': outbox.certificateId };
  await ddb.send(new UpdateCommand({ TableName: TABLE_NAME, Key: gatewayKey,
    UpdateExpression: 'SET resetLeaseId = :lease, resetLeaseExpiresAtEpoch = :expires',
    ConditionExpression: `resetOperationId = :op AND ${certCondition} AND (attribute_not_exists(resetLeaseExpiresAtEpoch) OR resetLeaseExpiresAtEpoch < :epoch)`,
    ExpressionAttributeValues: { ':lease': leaseId, ':expires': epoch + 150, ':op': outbox.operationId, ...certValues, ':epoch': epoch } }));
  const lock = (): Transaction[number] => ({ ConditionCheck: { TableName: TABLE_NAME, Key: gatewayKey,
    ConditionExpression: 'resetOperationId = :op AND resetLeaseId = :lease',
    ExpressionAttributeValues: { ':op': outbox.operationId, ':lease': leaseId } } });
  try {
    await cleanupGatewayIdentity(outbox);
    const now = new Date().toISOString();
    // Archive all generations, not just the current one, so generation 5 is reusable.
    let cursor: Item | undefined;
    do {
      const page: QueryCommandOutput = await ddb.send(new QueryCommand({ TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': PK, ':prefix': `DEPLOYMENT#${outbox.gatewayId}#` },
        ConsistentRead: true, ...(cursor ? { ExclusiveStartKey: cursor } : {}) }));
      for (const item of page.Items ?? []) {
        if (item.gatewayId !== outbox.gatewayId || item.tenantId !== outbox.tenantId) throw new Error('Deployment ownership mismatch');
        await ddb.send(new TransactWriteCommand({ TransactItems: [lock(), archive(item, outbox.operationId, now),
          { Delete: { TableName: TABLE_NAME, Key: { PK, SK: item.SK }, ConditionExpression: 'operationId = :op', ExpressionAttributeValues: { ':op': item.operationId } } },
        ] }));
      }
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    // Existing operation/audit records stay available as history. Active old
    // operations are closed so they cannot appear to keep onboarding after reset.
    cursor = undefined;
    do {
      const page: QueryCommandOutput = await ddb.send(new QueryCommand({ TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': PK, ':prefix': 'OPERATION#' }, ConsistentRead: true,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}) }));
      for (const old of page.Items ?? []) if (old.gatewayId === outbox.gatewayId && old.operationId !== outbox.operationId && old.operationStatus === 'IN_PROGRESS') {
        await ddb.send(new TransactWriteCommand({ TransactItems: [lock(), { Update: {
          TableName: TABLE_NAME, Key: { PK, SK: old.SK },
          UpdateExpression: 'SET operationStatus = :failed, #state = :failed, failure = :failure, updatedAt = :now',
          ExpressionAttributeNames: { '#state': 'state' }, ExpressionAttributeValues: {
            ':failed': 'FAILED', ':now': now, ':failure': { code: 'GATEWAY_RESET', message: 'Registration was reset by an operator.', rolledBack: false },
          },
        } }] }));
      }
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      archive(gateway!, outbox.operationId, now), archive(manufacturing!, outbox.operationId, now),
      { Delete: { TableName: TABLE_NAME, Key: gatewayKey,
        ConditionExpression: 'resetOperationId = :op AND resetLeaseId = :lease', ExpressionAttributeValues: { ':op': outbox.operationId, ':lease': leaseId } } },
      { Delete: { TableName: TABLE_NAME, Key: manufacturingKey,
        ConditionExpression: `resetOperationId = :op AND ${certCondition}`, ExpressionAttributeValues: { ':op': outbox.operationId, ...certValues } } },
      { Update: { TableName: TABLE_NAME, Key: { PK: binding.PK, SK: binding.SK },
        UpdateExpression: 'SET #status = :inactive, certificateDeletedAt = :now',
        ConditionExpression: 'tenantId = :tenant AND serialNumber = :serial', ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':inactive': 'INACTIVE', ':now': now, ':tenant': outbox.tenantId, ':serial': outbox.serialNumber } } },
      { Update: { TableName: TABLE_NAME, Key: { PK, SK: operationSk(outbox.operationId) },
        UpdateExpression: 'SET operationStatus = :success, #state = :retired, registrationReleased = :yes, updatedAt = :now, timeline = list_append(timeline, :events) REMOVE resetError',
        ConditionExpression: 'resetForOnboarding = :yes', ExpressionAttributeNames: { '#state': 'state' }, ExpressionAttributeValues: {
          ':success': 'SUCCEEDED', ':retired': 'DECOMMISSIONED', ':yes': true, ':now': now,
          ':events': [{ state: 'DECOMMISSIONED', at: now, detail: 'AWS Thing, certificates and shadows removed. Serial released for a new bootstrap package and generation-5 onboarding.' }],
        } } },
      { Update: { TableName: TABLE_NAME, Key: { PK: outbox.PK, SK: outbox.SK }, UpdateExpression: 'SET #state = :sent, sentAt = :now REMOVE lastError',
        ExpressionAttributeNames: { '#state': 'state' }, ExpressionAttributeValues: { ':sent': 'SENT', ':now': now } } },
      put({ PK, SK: `AUDIT#${now}#${outbox.outboxId}`, entityType: 'AUDIT', tenantId: outbox.tenantId,
        action: 'GATEWAY_REGISTRATION_RELEASED', targetId: outbox.gatewayId, actorSubject: 'SYSTEM#OUTBOX', actorRole: 'SYSTEM', outcome: 'SUCCESS', createdAt: now }),
    ] }));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 350) : 'AWS cleanup failed';
    // Keep the serial blocked and make a retry available without losing history.
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: TABLE_NAME, Key: gatewayKey, UpdateExpression: 'REMOVE resetLeaseId, resetLeaseExpiresAtEpoch',
        ConditionExpression: 'resetOperationId = :op AND resetLeaseId = :lease', ExpressionAttributeValues: { ':op': outbox.operationId, ':lease': leaseId } } },
      { Update: { TableName: TABLE_NAME, Key: { PK, SK: operationSk(outbox.operationId) },
        UpdateExpression: 'SET resetError = :error', ExpressionAttributeValues: { ':error': message } } },
    ] }));
    throw error;
  }
}

function archive(item: Item, operationId: string, now: string): Transaction[number] {
  return put({ PK: tenantPk(item.tenantId), SK: `ARCHIVE#RESET#${operationId}#${item.PK}#${item.SK}`,
    entityType: 'GATEWAY_RESET_ARCHIVE', resetOperationId: operationId, archivedAt: now, original: item });
}

/** Scope cleanup to the serial's two dedicated certificates and deterministic Thing. */
export async function cleanupGatewayIdentity(identity: Item): Promise<void> {
  const thing = await absentOkay(() => iot.send(new DescribeThingCommand({ thingName: identity.thingName })));
  if (thing && (thing.attributes?.serialNumber !== identity.serialNumber || thing.attributes?.tenantId !== identity.tenantId
    || thing.attributes?.gatewayId !== identity.gatewayId || thing.thingTypeName !== `ConnectedEnterpriseGateway-${STAGE}`)) {
    throw new Error('AWS Thing ownership does not match the reset request');
  }
  const certificateIds = [identity.certificateId, identity.bootstrapCertificateId].filter((id): id is string => typeof id === 'string');
  const principals = await absentOkay(() => iot.send(new ListThingPrincipalsCommand({ thingName: identity.thingName })));
  if (principals?.nextToken || principals?.principals?.some((principal) => !certificateIds.map(certArn).includes(principal))) {
    throw new Error('AWS Thing has another identity attached; cleanup stopped');
  }
  const certificates = [];
  const savedOutbox = identity.PK && identity.SK ? await get(identity.PK, identity.SK) : undefined;
  const jobIds = new Set<string>(savedOutbox?.resetJobIds ?? []);
  let jobToken: string | undefined;
  do {
    const jobs = await absentOkay(() => iot.send(new ListJobExecutionsForThingCommand({ thingName: identity.thingName, ...(jobToken ? { nextToken: jobToken } : {}) })));
    for (const execution of jobs?.executionSummaries ?? []) if (execution.jobId) jobIds.add(execution.jobId);
    jobToken = jobs?.nextToken;
  } while (jobToken);
  for (const jobId of jobIds) {
    const job = await absentOkay(() => iot.send(new DescribeJobCommand({ jobId })));
    if (job && (!jobId.startsWith('ce-') || job.job?.targets?.length !== 1
      || job.job.targets[0] !== `arn:aws:iot:${AWS_REGION_NAME}:${AWS_ACCOUNT_ID}:thing/${identity.thingName}`)) {
      throw new Error('Gateway has a shared or externally managed job; cleanup stopped');
    }
  }
  // Validate both certificates before disabling either one.
  for (const certificateId of certificateIds) {
    const certificate = await absentOkay(() => iot.send(new DescribeCertificateCommand({ certificateId })));
    if (!certificate) continue;
    const principal = certArn(certificateId);
    const attachments = await iot.send(new ListPrincipalThingsCommand({ principal }));
    if (attachments.nextToken || attachments.things?.some((name) => name !== identity.thingName)) {
      throw new Error('A certificate is attached to another gateway; cleanup stopped');
    }
    certificates.push({ certificateId, principal, status: certificate.certificateDescription?.status });
  }
  // Persist job IDs before deletion: IoT may hide executions while asynchronous
  // job deletion is still pending, and the next retry must still check those jobs.
  if (jobIds.size && identity.PK && identity.SK) await ddb.send(new UpdateCommand({ TableName: TABLE_NAME,
    Key: { PK: identity.PK, SK: identity.SK }, UpdateExpression: 'SET resetJobIds = :jobs',
    ExpressionAttributeValues: { ':jobs': [...jobIds] } }));
  for (const certificate of certificates) if (certificate.status === 'ACTIVE') {
    await iot.send(new UpdateCertificateCommand({ certificateId: certificate.certificateId, newStatus: 'INACTIVE' }));
  }
  await absentOkay(() => data.send(new DeleteConnectionCommand({ clientId: identity.thingName, cleanSession: true })));
  for (const jobId of jobIds) await absentOkay(() => iot.send(new DeleteJobCommand({ jobId, force: true })));
  for (const certificate of certificates) {
    await absentOkay(() => iot.send(new DetachThingPrincipalCommand({ thingName: identity.thingName, principal: certificate.principal })));
    let marker: string | undefined;
    do {
      const policies = await iot.send(new ListAttachedPoliciesCommand({ target: certificate.principal, ...(marker ? { marker } : {}) }));
      for (const policy of policies.policies ?? []) if (policy.policyName) {
        await iot.send(new DetachPolicyCommand({ target: certificate.principal, policyName: policy.policyName }));
      }
      marker = policies.nextMarker;
    } while (marker);
    await absentOkay(() => iot.send(new DeleteCertificateCommand({ certificateId: certificate.certificateId })));
  }
  let nextToken: string | undefined;
  do {
    const shadows = await absentOkay(() => data.send(new ListNamedShadowsForThingCommand({ thingName: identity.thingName, ...(nextToken ? { nextToken } : {}) })));
    for (const shadowName of shadows?.results ?? []) {
      await absentOkay(() => data.send(new DeleteThingShadowCommand({ thingName: identity.thingName, shadowName })));
    }
    nextToken = shadows?.nextToken;
  } while (nextToken);
  await absentOkay(() => data.send(new DeleteThingShadowCommand({ thingName: identity.thingName })));
  let groupToken: string | undefined;
  do {
    const groups = await absentOkay(() => iot.send(new ListThingGroupsForThingCommand({ thingName: identity.thingName, ...(groupToken ? { nextToken: groupToken } : {}) })));
    for (const group of groups?.thingGroups ?? []) if (group.groupName) {
      await iot.send(new RemoveThingFromThingGroupCommand({ thingName: identity.thingName, thingGroupName: group.groupName }));
    }
    groupToken = groups?.nextToken;
  } while (groupToken);
  await absentOkay(() => iot.send(new DeleteThingCommand({ thingName: identity.thingName })));
  if (await absentOkay(() => iot.send(new DescribeThingCommand({ thingName: identity.thingName })))) throw new Error('AWS Thing deletion is still pending; retry cleanup');
  for (const certificateId of certificateIds) {
    if (await absentOkay(() => iot.send(new DescribeCertificateCommand({ certificateId })))) throw new Error('Certificate deletion is still pending; retry cleanup');
  }
  for (const jobId of jobIds) {
    if (await absentOkay(() => iot.send(new DescribeJobCommand({ jobId })))) throw new Error('AWS job deletion is still pending; retry cleanup');
  }
}
