import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Context } from 'aws-lambda';
import {
  ARTIFACT_BUCKET,
  AWS_ACCOUNT_ID,
  AWS_REGION_NAME,
  IOT_DATA_ENDPOINT,
  SIGNING_KEY_ID,
  TABLE_NAME,
} from './shared/config.js';
import { auditSk, ddb, deploymentSk, gatewaySk, operationSk, serialPk, tenantPk } from './shared/ddb.js';

const CONFIG_REQUEST_SUFFIX = '/config/request';
const CONFIG_RESPONSE_SUFFIX = '/config/response';
const TOPIC_PREFIX = 'ce/v1/gateways/';
const URL_TTL_SECONDS = 5 * 60;

const s3 = new S3Client({});
const iotData = new IoTDataPlaneClient({ endpoint: dataEndpoint() });

interface ConfigRequestEvent extends Record<string, unknown> {
  generation?: unknown;
  requestId?: unknown;
  brokerClientId?: unknown;
  brokerPrincipal?: unknown;
  brokerTopic?: unknown;
  brokerTraceId?: unknown;
  brokerReceivedAt?: unknown;
}

export function configBrokerIdentity(event: Record<string, unknown>): {
  brokerClientId: string;
  brokerPrincipal: string;
  brokerTopic: string;
  thingName: string;
} {
  const brokerTopic = requiredBrokerString(event.brokerTopic, 'brokerTopic', 256);
  const thingName = thingNameFromTopic(brokerTopic, CONFIG_REQUEST_SUFFIX);
  const brokerClientId = requiredBrokerString(event.brokerClientId, 'brokerClientId', 128);
  const brokerPrincipal = requiredBrokerString(event.brokerPrincipal, 'brokerPrincipal', 256);
  if (brokerClientId !== thingName) throw new Error('Broker client ID does not match the authoritative thing topic');
  return { brokerClientId, brokerPrincipal, brokerTopic, thingName };
}

/**
 * Handles authenticated configuration requests forwarded by an AWS IoT rule.
 * Device-supplied identity fields are deliberately ignored; the broker-derived
 * topic, client ID, and certificate principal are the only identity inputs.
 */
export async function handler(event: ConfigRequestEvent, context: Context): Promise<void> {
  const { brokerPrincipal, thingName } = configBrokerIdentity(event);

  const locatedGateway = await gatewayForThing(thingName);
  const gateway = await finalizePermanentIdentity(locatedGateway, thingName, brokerPrincipal);
  const tenantId = requiredStoredString(gateway.tenantId, 'gateway tenantId');
  const gatewayId = requiredStoredString(gateway.gatewayId, 'gateway gatewayId');
  const certificateId = requiredStoredString(gateway.certificateId, 'gateway certificateId');
  const certificatePrincipal = requiredStoredString(gateway.certificatePrincipal, 'gateway certificatePrincipal');
  const expectedCertificatePrincipal = `arn:aws:iot:${AWS_REGION_NAME}:${AWS_ACCOUNT_ID}:cert/${certificateId}`;
  if (certificatePrincipal !== expectedCertificatePrincipal) throw new Error('Stored gateway certificate principal is inconsistent');
  // AWS IoT SQL principal() returns the X.509 certificate thumbprint (the IoT
  // certificate ID), not its ARN.
  if (certificateId !== brokerPrincipal) throw new Error('Broker certificate principal is not authorized for this gateway');
  if (gateway.thingName !== thingName) throw new Error('Gateway thing identity is inconsistent');

  const generation = positiveInteger(gateway.desiredGeneration ?? gateway.generation, 'gateway desiredGeneration');
  if (event.generation != null && positiveInteger(event.generation, 'generation') !== generation) {
    throw new Error('Requested generation is not the authoritative desired generation');
  }

  const descriptor = assignmentDescriptor(gateway.signedDescriptor, {
    tenantId,
    gatewayId,
    thingName,
    generation,
  });
  const profileVersionId = requiredStoredString(descriptor.profileVersionId, 'descriptor profileVersionId');
  const objectKey = artifactKey(descriptor.objectKey, tenantId, 'descriptor objectKey');
  const manifestKey = artifactKey(descriptor.manifestKey, tenantId, 'descriptor manifestKey');
  if (!ARTIFACT_BUCKET) throw new Error('Artifact bucket is not configured');

  const deploymentResult = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tenantPk(tenantId), SK: deploymentSk(gatewayId, generation) },
    ConsistentRead: true,
  }));
  const deployment = deploymentResult.Item;
  if (!deployment
    || deployment.entityType !== 'DEPLOYMENT'
    || deployment.gatewayId !== gatewayId
    || deployment.profileVersionId !== profileVersionId
    || positiveInteger(deployment.generation, 'deployment generation') !== generation) {
    throw new Error('Authoritative deployment record is missing or inconsistent');
  }

  const operationId = requiredStoredString(deployment.operationId, 'deployment operationId');
  const operation = (await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tenantPk(tenantId), SK: operationSk(operationId) },
    ConsistentRead: true,
  }))).Item;
  if (!operation || operation.entityType !== 'OPERATION' || operation.gatewayId !== gatewayId) {
    throw new Error('Deployment operation record is missing or inconsistent');
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + URL_TTL_SECONDS * 1000).toISOString();
  const [profileUrl, manifestUrl] = await Promise.all([
    getSignedUrl(s3, new GetObjectCommand({
      Bucket: ARTIFACT_BUCKET,
      Key: objectKey,
      ResponseContentType: 'application/json',
    }), { expiresIn: URL_TTL_SECONDS }),
    getSignedUrl(s3, new GetObjectCommand({
      Bucket: ARTIFACT_BUCKET,
      Key: manifestKey,
      ResponseContentType: 'application/json',
    }), { expiresIn: URL_TTL_SECONDS }),
  ]);

  const responseTopic = `${TOPIC_PREFIX}${thingName}${CONFIG_RESPONSE_SUFFIX}`;
  const response = {
    type: 'SIGNED_PROFILE_ASSIGNMENT',
    requestId: safeRequestId(event.requestId) ?? context.awsRequestId,
    gatewayId,
    thingName,
    generation,
    profileVersionId,
    descriptor,
    artifacts: {
      profile: {
        url: profileUrl,
        sha256: descriptor.profileSha256,
        expiresAt,
      },
      manifest: {
        url: manifestUrl,
        expiresAt,
      },
    },
    issuedAt: issuedAt.toISOString(),
  };

  // The response destination is calculated from authenticated broker context;
  // no request field can redirect signed URLs to a different topic.
  await iotData.send(new PublishCommand({
    topic: responseTopic,
    qos: 1,
    payload: Buffer.from(JSON.stringify(response)),
    contentType: 'application/json',
  }));

  await recordDelivery({
    gateway,
    deployment,
    operation,
    operationId,
    tenantId,
    gatewayId,
    thingName,
    brokerCertificateId: brokerPrincipal,
    certificatePrincipal,
    generation,
    profileVersionId,
    context,
  });
}

/**
 * Fleet Provisioning invokes its hook before RegisterThing creates and attaches
 * the operational identity. The first authenticated permanent-certificate
 * config request is therefore the proof that activation completed. Finalize
 * the manufacturing, gateway, and onboarding-operation state in one CAS before
 * returning any signed artifact URL.
 */
async function finalizePermanentIdentity(
  gateway: Record<string, unknown>,
  thingName: string,
  brokerCertificateId: string,
): Promise<Record<string, unknown>> {
  const tenantId = requiredStoredString(gateway.tenantId, 'gateway tenantId');
  const gatewayId = requiredStoredString(gateway.gatewayId, 'gateway gatewayId');
  const serialNumber = requiredStoredString(gateway.serialNumber, 'gateway serialNumber');
  const operationId = requiredStoredString(gateway.operationId, 'gateway operationId');
  const certificatePrincipal = requiredStoredString(gateway.certificatePrincipal, 'gateway certificatePrincipal');
  if (gateway.certificateId !== brokerCertificateId || gateway.thingName !== thingName) {
    throw new Error('Gateway permanent identity binding is inconsistent');
  }
  if (gateway.state === 'DECOMMISSIONING' || gateway.state === 'DECOMMISSIONED'
    || gateway.certificateStatus === 'DEACTIVATING' || gateway.certificateStatus === 'INACTIVE') {
    throw new Error('Gateway permanent identity is not active');
  }

  const manufacturingKey = { PK: serialPk(serialNumber), SK: 'MANUFACTURING' };
  const manufacturing = (await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: manufacturingKey,
    ConsistentRead: true,
  }))).Item;
  if (!manufacturing
    || manufacturing.tenantId !== tenantId
    || manufacturing.gatewayId !== gatewayId
    || manufacturing.certificateId !== brokerCertificateId
    || manufacturing.thingName !== thingName) {
    throw new Error('Manufacturing identity binding is inconsistent');
  }

  if (manufacturing.state === 'PROVISIONED') {
    if (gateway.certificateStatus !== 'ACTIVE') throw new Error('Provisioned gateway certificate is not active');
    return gateway;
  }
  if (manufacturing.state !== 'PROVISIONING'
    || manufacturing.operationId !== operationId
    || gateway.state !== 'IDENTITY_PROVISIONING'
    || gateway.certificateStatus !== 'PENDING_ACTIVATION') {
    throw new Error('Gateway is not awaiting permanent identity activation');
  }

  const now = new Date().toISOString();
  const tenantKey = tenantPk(tenantId);
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      {
        Update: {
          TableName: TABLE_NAME,
          Key: manufacturingKey,
          UpdateExpression: 'SET #state = :provisioned, certificateStatus = :active, provisionedAt = if_not_exists(provisionedAt, :now), updatedAt = :now',
          ConditionExpression: '#state = :provisioning AND tenantId = :tenantId AND gatewayId = :gatewayId AND operationId = :operationId AND certificateId = :certificateId AND thingName = :thingName',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':provisioning': 'PROVISIONING', ':provisioned': 'PROVISIONED', ':active': 'ACTIVE',
            ':tenantId': tenantId, ':gatewayId': gatewayId, ':operationId': operationId,
            ':certificateId': brokerCertificateId, ':thingName': thingName, ':now': now,
          },
        },
      },
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: tenantKey, SK: gatewaySk(gatewayId) },
          UpdateExpression: 'SET #state = :identityActive, certificateStatus = :active, lastAuthenticatedAt = :now, updatedAt = :now',
          ConditionExpression: 'entityType = :gateway AND #state = :identityProvisioning AND certificateStatus = :pending AND thingName = :thingName AND certificateId = :certificateId AND certificatePrincipal = :certificatePrincipal',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':gateway': 'GATEWAY', ':identityProvisioning': 'IDENTITY_PROVISIONING',
            ':identityActive': 'PERMANENT_IDENTITY_ACTIVE', ':pending': 'PENDING_ACTIVATION', ':active': 'ACTIVE',
            ':thingName': thingName, ':certificateId': brokerCertificateId,
            ':certificatePrincipal': certificatePrincipal, ':now': now,
          },
        },
      },
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: tenantKey, SK: operationSk(operationId) },
          UpdateExpression: 'SET operationStatus = :inProgress, #state = :identityActive, updatedAt = :now, steps[1] = :identityStep, timeline = list_append(if_not_exists(timeline, :empty), :events)',
          ConditionExpression: 'entityType = :operation AND gatewayId = :gatewayId AND #state = :csrVerified',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':operation': 'OPERATION', ':gatewayId': gatewayId, ':csrVerified': 'CSR_VERIFIED',
            ':inProgress': 'IN_PROGRESS', ':identityActive': 'OPERATIONAL_IDENTITY_ISSUED',
            ':now': now, ':empty': [],
            ':events': [{ state: 'OPERATIONAL_IDENTITY_ISSUED', at: now, detail: 'Permanent certificate authenticated by the IoT broker.' }],
            ':identityStep': {
              key: 'identity', label: 'Permanent identity provisioned', status: 'complete',
              detail: 'Permanent certificate authenticated by the IoT broker.', timestamp: now,
            },
          },
        },
      },
    ] }));
  } catch (error) {
    // A duplicate first request can lose the transaction race. Accept it only
    // after a consistent reread proves the exact same identity won the CAS.
    const [freshGateway, freshManufacturing] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: tenantKey, SK: gatewaySk(gatewayId) }, ConsistentRead: true })),
      ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: manufacturingKey, ConsistentRead: true })),
    ]);
    if (freshManufacturing.Item?.state === 'PROVISIONED'
      && freshManufacturing.Item.certificateId === brokerCertificateId
      && freshManufacturing.Item.thingName === thingName
      && freshGateway.Item?.certificateStatus === 'ACTIVE'
      && freshGateway.Item.certificateId === brokerCertificateId
      && freshGateway.Item.thingName === thingName) {
      return freshGateway.Item;
    }
    throw error;
  }

  return {
    ...gateway,
    state: 'PERMANENT_IDENTITY_ACTIVE',
    certificateStatus: 'ACTIVE',
    lastAuthenticatedAt: now,
    updatedAt: now,
  };
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

async function recordDelivery(input: {
  gateway: Record<string, unknown>;
  deployment: Record<string, unknown>;
  operation?: Record<string, unknown>;
  operationId?: string;
  tenantId: string;
  gatewayId: string;
  thingName: string;
  brokerCertificateId: string;
  certificatePrincipal: string;
  generation: number;
  profileVersionId: string;
  context: Context;
}): Promise<void> {
  const now = new Date().toISOString();
  const earlyDeliveryStates = new Set([
    'WAITING_FOR_DEVICE',
    'IDENTITY_PROVISIONING',
    'PERMANENT_IDENTITY_ACTIVE',
    'PROFILE_AVAILABLE',
    'PROFILE_DELIVERED',
  ]);
  const tenantKey = tenantPk(input.tenantId);
  const gatewayState = requiredStoredString(input.gateway.state, 'gateway state');
  const deploymentStatus = requiredStoredString(input.deployment.status, 'deployment status');
  const updateGatewayState = earlyDeliveryStates.has(gatewayState);
  const updateDeploymentState = earlyDeliveryStates.has(deploymentStatus);

  const gatewayUpdateExpression = updateGatewayState
    ? 'SET #state = :delivered, lastAuthenticatedAt = :now, lastConfigRequestAt = :now, updatedAt = :now'
    : 'SET lastAuthenticatedAt = :now, lastConfigRequestAt = :now, updatedAt = :now';
  const gatewayCondition = updateGatewayState
    ? 'entityType = :gateway AND thingName = :thingName AND certificateId = :certificateId AND certificatePrincipal = :certificatePrincipal AND desiredGeneration = :generation AND #state = :observedState'
    : 'entityType = :gateway AND thingName = :thingName AND certificateId = :certificateId AND certificatePrincipal = :certificatePrincipal AND desiredGeneration = :generation';

  const deploymentUpdateExpression = updateDeploymentState
    ? 'SET #status = :delivered, deliveredAt = if_not_exists(deliveredAt, :now), lastDeliveredAt = :now, updatedAt = :now'
    : 'SET lastDeliveredAt = :now, updatedAt = :now';
  const deploymentCondition = updateDeploymentState
    ? 'entityType = :deployment AND gatewayId = :gatewayId AND generation = :generation AND #status = :observedStatus'
    : 'entityType = :deployment AND gatewayId = :gatewayId AND generation = :generation';

  const transaction: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: gatewaySk(input.gatewayId) },
        UpdateExpression: gatewayUpdateExpression,
        ConditionExpression: gatewayCondition,
        ExpressionAttributeNames: updateGatewayState ? { '#state': 'state' } : undefined,
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY',
          ':thingName': input.thingName,
          ':certificateId': input.brokerCertificateId,
          ':certificatePrincipal': input.certificatePrincipal,
          ':generation': input.generation,
          ':now': now,
          ...(updateGatewayState ? { ':delivered': 'PROFILE_DELIVERED', ':observedState': gatewayState } : {}),
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: deploymentSk(input.gatewayId, input.generation) },
        UpdateExpression: deploymentUpdateExpression,
        ConditionExpression: deploymentCondition,
        ExpressionAttributeNames: updateDeploymentState ? { '#status': 'status' } : undefined,
        ExpressionAttributeValues: {
          ':deployment': 'DEPLOYMENT',
          ':gatewayId': input.gatewayId,
          ':generation': input.generation,
          ':now': now,
          ...(updateDeploymentState ? { ':delivered': 'PROFILE_DELIVERED', ':observedStatus': deploymentStatus } : {}),
        },
      },
    },
  ];

  if (input.operation && input.operationId) {
    const operationState = requiredStoredString(input.operation.state, 'operation state');
    const stageableOperationStates = new Set([
      'CLAIM_ACCEPTED',
      'CSR_VERIFIED',
      'OPERATIONAL_IDENTITY_ISSUED',
    ]);
    if (stageableOperationStates.has(operationState)) {
      transaction.push({
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: tenantKey, SK: operationSk(input.operationId) },
          UpdateExpression: 'SET operationStatus = :inProgress, #state = :profileStaged, deploymentGeneration = :generation, updatedAt = :now, steps[1] = :identityStep, steps[2] = :profileStep, timeline = list_append(if_not_exists(timeline, :empty), :events)',
          ConditionExpression: 'entityType = :operation AND gatewayId = :gatewayId AND #state = :observedState',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':operation': 'OPERATION',
            ':gatewayId': input.gatewayId,
            ':observedState': operationState,
            ':inProgress': 'IN_PROGRESS',
            ':profileStaged': 'PROFILE_STAGED',
            ':generation': input.generation,
            ':now': now,
            ':empty': [],
            ':events': [
              ...(operationState === 'OPERATIONAL_IDENTITY_ISSUED' ? [] : [{
                state: 'OPERATIONAL_IDENTITY_ISSUED',
                detail: 'Permanent certificate authenticated by the IoT broker.',
                at: now,
              }]),
              {
                state: 'PROFILE_STAGED',
                detail: `Signed profile generation ${input.generation} delivered.`,
                at: now,
              },
            ],
            ':identityStep': {
              key: 'identity',
              label: 'Permanent identity provisioned',
              status: 'complete',
              detail: 'Permanent certificate authenticated by the IoT broker.',
              timestamp: now,
            },
            ':profileStep': {
              key: 'profile',
              label: 'Signed profile delivered',
              status: 'complete',
              detail: `Signed profile generation ${input.generation} delivered.`,
              timestamp: now,
            },
          },
        },
      });
    }
  }

  const auditId = `iot_${input.context.awsRequestId}`;
  transaction.push({
    Put: {
      TableName: TABLE_NAME,
      Item: {
        PK: tenantKey,
        SK: auditSk(now, auditId),
        entityType: 'AUDIT',
        auditId,
        tenantId: input.tenantId,
        actorSubject: input.certificatePrincipal,
        actorRole: 'DEVICE',
        action: 'SIGNED_PROFILE_DELIVERED',
        targetId: input.gatewayId,
        details: {
          generation: input.generation,
          profileVersionId: input.profileVersionId,
          thingName: input.thingName,
        },
        outcome: 'SUCCESS',
        createdAt: now,
      },
    },
  });

  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: transaction }));
  } catch (error) {
    // The response publish happens before bookkeeping, so an authenticated
    // status Lambda may advance the same generation first. Treat that exact
    // forward state as delivery already observed; never overwrite it with the
    // older PROFILE_DELIVERED state.
    const [freshGateway, freshDeployment] = await Promise.all([
      ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: gatewaySk(input.gatewayId) },
        ConsistentRead: true,
      })),
      ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: deploymentSk(input.gatewayId, input.generation) },
        ConsistentRead: true,
      })),
    ]);
    const forwardStates = new Set(['PROFILE_DELIVERED', 'APPLYING', 'HEALTH_CHECK', 'APPLIED_HEALTHY', 'FAILED', 'ROLLING_BACK', 'ROLLED_BACK']);
    if (freshGateway.Item?.certificateId === input.brokerCertificateId
      && freshGateway.Item.thingName === input.thingName
      && freshGateway.Item.desiredGeneration === input.generation
      && forwardStates.has(String(freshGateway.Item.state))
      && freshDeployment.Item?.gatewayId === input.gatewayId
      && freshDeployment.Item.generation === input.generation
      && forwardStates.has(String(freshDeployment.Item.status))) {
      return;
    }
    throw error;
  }
}

function thingNameFromTopic(topic: string, suffix: string): string {
  if (!topic.startsWith(TOPIC_PREFIX) || !topic.endsWith(suffix)) throw new Error('Broker topic is not an authoritative gateway topic');
  const thingName = topic.slice(TOPIC_PREFIX.length, -suffix.length);
  if (!thingName || thingName.includes('/') || !/^[A-Za-z0-9:_-]{1,128}$/.test(thingName)) {
    throw new Error('Broker topic contains an invalid thing name');
  }
  if (topic !== `${TOPIC_PREFIX}${thingName}${suffix}`) throw new Error('Broker topic is not canonical');
  return thingName;
}

function assignmentDescriptor(
  value: unknown,
  expected: { tenantId: string; gatewayId: string; thingName: string; generation: number },
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Signed assignment descriptor is missing');
  const descriptor = value as Record<string, unknown>;
  if (descriptor.kind !== 'gateway-profile-assignment'
    || descriptor.tenantId !== expected.tenantId
    || descriptor.gatewayId !== expected.gatewayId
    || descriptor.thingName !== expected.thingName
    || positiveInteger(descriptor.generation, 'descriptor generation') !== expected.generation
    || typeof descriptor.profileSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(descriptor.profileSha256)
    || typeof descriptor.signature !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(descriptor.signature)
    || descriptor.signingAlgorithm !== 'ECDSA_SHA_256'
    || !SIGNING_KEY_ID
    || descriptor.signingKeyId !== SIGNING_KEY_ID) {
    throw new Error('Signed assignment descriptor is inconsistent with the gateway identity');
  }
  const expiresAt = typeof descriptor.expiresAt === 'string' ? Date.parse(descriptor.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Signed assignment descriptor is expired or has no valid expiry');
  return descriptor;
}

function artifactKey(value: unknown, tenantId: string, label: string): string {
  const key = requiredStoredString(value, label);
  const expectedPrefix = `tenants/${tenantId}/profiles/`;
  if (!key.startsWith(expectedPrefix)
    || key.startsWith('/')
    || key.includes('\\')
    || key.split('/').some((part) => part === '..')) {
    throw new Error(`${label} is outside the tenant artifact namespace`);
  }
  return key;
}

function dataEndpoint(): string {
  if (!IOT_DATA_ENDPOINT) throw new Error('IoT data endpoint is not configured');
  return /^https:\/\//i.test(IOT_DATA_ENDPOINT) ? IOT_DATA_ENDPOINT : `https://${IOT_DATA_ENDPOINT}`;
}

function requiredBrokerString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maxLength || hasControlCharacters(value)) {
    throw new Error(`Missing or invalid broker field ${label}`);
  }
  return value;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function requiredStoredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function safeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : undefined;
}
