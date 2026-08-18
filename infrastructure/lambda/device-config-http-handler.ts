import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import {
  ARTIFACT_BUCKET,
  AWS_ACCOUNT_ID,
  AWS_REGION_NAME,
  SIGNING_KEY_ID,
  TABLE_NAME,
} from './shared/config.js';
import {
  auditSk,
  ddb,
  deploymentSk,
  gatewaySk,
  operationSk,
  tenantPk,
} from './shared/ddb.js';
import { sha256 } from './shared/crypto.js';
import {
  canonicalJson,
  type GatewayConfigurationClaimInput,
} from './shared/profile.js';
import {
  finalizePermanentIdentity,
  PermanentIdentityFinalizationError,
  type PermanentIdentityFinalizationDependencies,
} from './shared/permanent-identity.js';

const ROUTE_KEY = 'GET /device/v1/things/{thingName}/certificates/{certificateId}/configuration';
const GATEWAY_CONFIG_ROLE_NAME = process.env.GATEWAY_CONFIG_ROLE_NAME?.trim() ?? '';
const MAX_PROFILE_BYTES = 1024 * 1024;
const THING_NAME_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const CERTIFICATE_ID_PATTERN = /^[a-f0-9]{64}$/i;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const ACTIVE_GATEWAY_STATES = new Set([
  'PERMANENT_IDENTITY_ACTIVE',
  'PROFILE_AVAILABLE',
  'PROFILE_DELIVERED',
  'APPLYING',
  'HEALTH_CHECK',
  'APPLIED_HEALTHY',
  'FAILED',
  'ROLLING_BACK',
  'ROLLED_BACK',
]);
const DELIVERY_GATEWAY_STATES = new Set([
  'PERMANENT_IDENTITY_ACTIVE',
  'PROFILE_AVAILABLE',
]);
const DELIVERY_DEPLOYMENT_STATES = new Set([
  'WAITING_FOR_DEVICE',
  'PROFILE_AVAILABLE',
]);
const FORWARD_DELIVERY_STATES = new Set([
  'PROFILE_DELIVERED',
  'APPLYING',
  'HEALTH_CHECK',
  'APPLIED_HEALTHY',
  'FAILED',
  'ROLLING_BACK',
  'ROLLED_BACK',
]);
const ACTIVE_OPERATION_STATES = new Set([
  'CLAIM_ACCEPTED',
  'CSR_VERIFIED',
  'OPERATIONAL_IDENTITY_ISSUED',
  'PROFILE_STAGED',
  'APPLYING',
  'HEALTH_CHECK',
  'APPLIED_HEALTHY',
  'FAILED',
  'ROLLING_BACK',
  'ROLLED_BACK',
]);
const DELIVERY_OPERATION_STATES = new Set([
  'CSR_VERIFIED',
  'OPERATIONAL_IDENTITY_ISSUED',
]);

type Item = Record<string, unknown>;
type TransactItems = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']>;

export interface DeviceConfigurationDependencies extends PermanentIdentityFinalizationDependencies {
  queryGatewayByThing(thingName: string): Promise<Item[]>;
  loadProfileArtifact(key: string): Promise<Uint8Array>;
}

interface AuthorizedRequest {
  thingName: string;
  certificateId: string;
  generation: number;
  requestId: string;
}

interface ConfigurationAuthority {
  gateway: Item;
  deployment: Item;
  operation: Item;
  tenantId: string;
  gatewayId: string;
  operationId: string;
  certificatePrincipal: string;
  generation: number;
  profileVersionId: string;
  descriptor: Item;
  objectKey: string;
}

class DeviceConfigurationError extends Error {
  constructor(
    readonly statusCode: 400 | 403 | 409,
    readonly code: 'INVALID_REQUEST' | 'DEVICE_NOT_AUTHORIZED' | 'CONFIGURATION_NOT_AVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

const s3 = new S3Client({});

const productionDependencies: DeviceConfigurationDependencies = {
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
  async loadProfileArtifact(key) {
    if (!ARTIFACT_BUCKET) throw new Error('Artifact bucket is not configured');
    const result = await s3.send(new GetObjectCommand({
      Bucket: ARTIFACT_BUCKET,
      Key: key,
    }));
    if (!result.Body) throw new Error('Profile artifact has no body');
    if (typeof result.ContentLength === 'number' && result.ContentLength > MAX_PROFILE_BYTES) {
      throw unavailable();
    }
    return result.Body.transformToByteArray();
  },
  now: () => new Date(),
};

export function createDeviceConfigurationHandler(
  dependencies: DeviceConfigurationDependencies = productionDependencies,
) {
  return async (
    event: APIGatewayProxyEventV2WithIAMAuthorizer,
    context: Context,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const requestId = safeRequestId(event.requestContext?.requestId) ?? context.awsRequestId;
    try {
      const request = authorizedRequest(event, requestId);
      const authority = await configurationAuthority(request, dependencies);
      const profileBytes = await dependencies.loadProfileArtifact(authority.objectKey);
      const configuration = verifiedProfileDocument(profileBytes, authority);
      const gateway = publicGatewayConfiguration(authority.gateway, authority);
      const integrity = compactConfigurationClaim(authority, gateway);

      await recordHttpDelivery(authority, request, context, dependencies);

      return json(200, {
        type: 'GATEWAY_CONFIGURATION',
        responseVersion: 1,
        requestId,
        gateway,
        assignment: publicAssignment(authority),
        configuration,
        integrity,
      }, requestId);
    } catch (error) {
      if (error instanceof DeviceConfigurationError) {
        return json(error.statusCode, {
          error: error.message,
          code: error.code,
          requestId,
        }, requestId);
      }
      // Never log the event, SigV4 headers, temporary credentials, or signed URLs.
      console.error(JSON.stringify({
        level: 'error',
        requestId,
        error: error instanceof Error ? error.name : 'UnknownError',
      }));
      return json(500, {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        requestId,
      }, requestId);
    }
  };
}

export const handler = createDeviceConfigurationHandler();

function authorizedRequest(
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
  requestId: string,
): AuthorizedRequest {
  if (event.routeKey !== ROUTE_KEY
    || event.requestContext?.routeKey !== ROUTE_KEY
    || event.requestContext?.http?.method !== 'GET') {
    throw invalidRequest('Route not found');
  }
  const iam = event.requestContext?.authorizer?.iam;
  if (!iam || typeof iam.userArn !== 'string' || !iam.userArn || typeof iam.accessKey !== 'string' || !iam.accessKey) {
    throw unauthorized();
  }
  if (AWS_ACCOUNT_ID && iam.accountId !== AWS_ACCOUNT_ID) throw unauthorized();
  const expectedRolePrefix = `arn:aws:sts::${AWS_ACCOUNT_ID}:assumed-role/${GATEWAY_CONFIG_ROLE_NAME}/`;
  if (!AWS_ACCOUNT_ID
    || !GATEWAY_CONFIG_ROLE_NAME
    || !iam.userArn.startsWith(expectedRolePrefix)
    || iam.userArn.length <= expectedRolePrefix.length) {
    throw unauthorized();
  }

  const thingName = event.pathParameters?.thingName;
  const certificateId = event.pathParameters?.certificateId;
  if (typeof thingName !== 'string' || !THING_NAME_PATTERN.test(thingName)) {
    throw invalidRequest('Invalid device configuration request');
  }
  if (typeof certificateId !== 'string' || !CERTIFICATE_ID_PATTERN.test(certificateId)) {
    throw invalidRequest('Invalid device configuration request');
  }
  const expectedPath = `/device/v1/things/${thingName}/certificates/${certificateId}/configuration`;
  if (event.rawPath !== expectedPath || event.requestContext.http.path !== expectedPath) {
    throw invalidRequest('Invalid device configuration request');
  }

  const queryEntries = [...new URLSearchParams(event.rawQueryString).entries()];
  if (queryEntries.length !== 1 || queryEntries[0]?.[0] !== 'generation') {
    throw invalidRequest('Exactly one generation query parameter is required');
  }
  const generationText = queryEntries[0][1];
  if (event.queryStringParameters?.generation !== generationText) {
    throw invalidRequest('Exactly one generation query parameter is required');
  }
  if (typeof generationText !== 'string' || !/^[1-9][0-9]{0,11}$/.test(generationText)) {
    throw invalidRequest('A positive generation query parameter is required');
  }
  const generation = Number(generationText);
  if (!Number.isSafeInteger(generation)) throw invalidRequest('A positive generation query parameter is required');

  return { thingName, certificateId, generation, requestId };
}

async function configurationAuthority(
  request: AuthorizedRequest,
  dependencies: DeviceConfigurationDependencies,
): Promise<ConfigurationAuthority> {
  const matches = await dependencies.queryGatewayByThing(request.thingName);
  if (matches.length !== 1) throw unauthorized();
  const located = matches[0];
  if (!located
    || located.entityType !== 'GATEWAY'
    || typeof located.PK !== 'string'
    || typeof located.SK !== 'string'
    || located.GSI1PK !== `THING#${request.thingName}`) {
    throw unauthorized();
  }

  // GSI reads are eventually consistent. Always authorize against a fresh,
  // strongly consistent base-table read so decommissioning takes effect here.
  let gateway = await dependencies.getItem({ PK: located.PK, SK: located.SK });
  if (!gateway || gateway.entityType !== 'GATEWAY') throw unauthorized();

  if (gateway.state === 'IDENTITY_PROVISIONING' || gateway.certificateStatus === 'PENDING_ACTIVATION') {
    try {
      gateway = await finalizePermanentIdentity(gateway, {
        thingName: request.thingName,
        certificateId: request.certificateId,
        requestId: request.requestId,
        channel: 'IOT_CREDENTIAL_PROVIDER',
      }, dependencies);
    } catch (error) {
      if (error instanceof PermanentIdentityFinalizationError) throw unauthorized();
      throw error;
    }
  }

  const tenantId = requiredStoredString(gateway.tenantId, unauthorized);
  const gatewayId = requiredStoredString(gateway.gatewayId, unauthorized);
  const certificatePrincipal = requiredStoredString(gateway.certificatePrincipal, unauthorized);
  const expectedPk = tenantPk(tenantId);
  const expectedSk = gatewaySk(gatewayId);
  const expectedPrincipal = `arn:aws:iot:${AWS_REGION_NAME}:${AWS_ACCOUNT_ID}:cert/${request.certificateId}`;
  if (gateway.PK !== expectedPk
    || gateway.SK !== expectedSk
    || gateway.thingName !== request.thingName
    || gateway.certificateId !== request.certificateId
    || certificatePrincipal !== expectedPrincipal
    || gateway.certificateStatus !== 'ACTIVE'
    || !ACTIVE_GATEWAY_STATES.has(String(gateway.state))) {
    throw unauthorized();
  }

  const desiredGeneration = positiveStoredInteger(gateway.desiredGeneration, unavailable);
  if (desiredGeneration !== request.generation) throw unavailable();
  const desiredProfileVersionId = requiredStoredString(gateway.desiredProfileVersionId, unavailable);
  const descriptor = assignmentDescriptor(gateway.signedDescriptor, {
    tenantId,
    gatewayId,
    thingName: request.thingName,
    generation: request.generation,
    profileVersionId: desiredProfileVersionId,
  });
  const objectKey = artifactKey(descriptor.objectKey, tenantId);
  // The manifest stays control-plane-only, but an assigned descriptor must
  // still reference a well-scoped immutable manifest.
  artifactKey(descriptor.manifestKey, tenantId);

  const deployment = await dependencies.getItem({
    PK: expectedPk,
    SK: deploymentSk(gatewayId, request.generation),
  });
  const operationId = requiredStoredString(deployment?.operationId, unavailable);
  if (!deployment
    || deployment.entityType !== 'DEPLOYMENT'
    || deployment.PK !== expectedPk
    || deployment.SK !== deploymentSk(gatewayId, request.generation)
    || deployment.tenantId !== tenantId
    || deployment.gatewayId !== gatewayId
    || deployment.generation !== request.generation
    || deployment.profileVersionId !== desiredProfileVersionId
    || gateway.operationId !== operationId
    || !isRecord(deployment.descriptor)
    || canonicalJson(deployment.descriptor) !== canonicalJson(descriptor)) {
    throw unavailable();
  }

  const operation = await dependencies.getItem({ PK: expectedPk, SK: operationSk(operationId) });
  if (!operation
    || operation.entityType !== 'OPERATION'
    || operation.PK !== expectedPk
    || operation.SK !== operationSk(operationId)
    || operation.tenantId !== tenantId
    || operation.operationId !== operationId
    || operation.gatewayId !== gatewayId
    || operation.profileVersionId !== desiredProfileVersionId
    || operation.deploymentGeneration !== request.generation
    || !ACTIVE_OPERATION_STATES.has(String(operation.state))) {
    throw unavailable();
  }

  return {
    gateway,
    deployment,
    operation,
    tenantId,
    gatewayId,
    operationId,
    certificatePrincipal,
    generation: request.generation,
    profileVersionId: desiredProfileVersionId,
    descriptor,
    objectKey,
  };
}

function verifiedProfileDocument(
  profileBytes: Uint8Array,
  authority: ConfigurationAuthority,
): Item {
  if (!(profileBytes instanceof Uint8Array)
    || profileBytes.byteLength === 0
    || profileBytes.byteLength > MAX_PROFILE_BYTES
    || sha256(profileBytes) !== authority.descriptor.profileSha256) {
    throw unavailable();
  }

  const raw = Buffer.from(profileBytes);
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) throw unavailable();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unavailable();
  }
  if (!isRecord(parsed)) throw unavailable();

  try {
    // Published profile objects are content-addressed canonical JSON. Requiring
    // the exact encoding keeps the signed checksum meaningful end to end.
    if (canonicalJson(parsed) !== text) throw unavailable();
  } catch {
    throw unavailable();
  }

  const expectedSchemaVersion = profileSchemaVersion(authority.descriptor.schemaVersion);
  if (parsed.schemaVersion !== expectedSchemaVersion) throw unavailable();

  const gatewayModelId = requiredStoredString(authority.gateway.modelId ?? authority.gateway.model, unavailable);
  if (parsed.modelId !== undefined && parsed.modelId !== gatewayModelId) throw unavailable();

  return parsed;
}

function compactConfigurationClaim(
  authority: ConfigurationAuthority,
  gateway: Item,
): Item {
  const input: GatewayConfigurationClaimInput = {
    gatewayId: authority.gatewayId,
    thingName: requiredStoredString(authority.gateway.thingName, unavailable),
    gatewayMetadataSha256: sha256(canonicalJson(gateway)),
    generation: authority.generation,
    profileVersionId: authority.profileVersionId,
    profileSha256: requiredStoredString(authority.descriptor.profileSha256, unavailable),
    issuedAt: requiredStoredString(authority.descriptor.issuedAt, unavailable),
    expiresAt: requiredStoredString(authority.descriptor.expiresAt, unavailable),
  };

  // The control plane signs this compact claim once when the immutable
  // assignment is created. The read path must never mint replacement claims.
  if (!isRecord(authority.descriptor.configurationClaim)) throw unavailable();
  const claim = authority.descriptor.configurationClaim;
  return verifiedConfigurationClaim(claim, input);
}

function verifiedConfigurationClaim(
  claim: Item,
  expected: GatewayConfigurationClaimInput,
): Item {
  if (claim.kind !== 'gateway-configuration-claim'
    || claim.claimVersion !== 1
    || claim.gatewayId !== expected.gatewayId
    || claim.thingName !== expected.thingName
    || claim.gatewayMetadataSha256 !== expected.gatewayMetadataSha256
    || claim.generation !== expected.generation
    || claim.profileVersionId !== expected.profileVersionId
    || claim.profileSha256 !== expected.profileSha256
    || claim.issuedAt !== expected.issuedAt
    || claim.expiresAt !== expected.expiresAt
    || !SIGNING_KEY_ID
    || claim.signingKeyId !== SIGNING_KEY_ID
    || claim.signingAlgorithm !== 'ECDSA_SHA_256'
    || typeof claim.signature !== 'string'
    || claim.signature.length > 1024
    || !SIGNATURE_PATTERN.test(claim.signature)) {
    throw unavailable();
  }

  // Strictly allowlist the public claim. Unknown descriptor fields, S3
  // locators, tenant IDs, and database metadata never cross the device API.
  return {
    kind: claim.kind,
    claimVersion: claim.claimVersion,
    gatewayId: claim.gatewayId,
    thingName: claim.thingName,
    gatewayMetadataSha256: claim.gatewayMetadataSha256,
    generation: claim.generation,
    profileVersionId: claim.profileVersionId,
    profileSha256: claim.profileSha256,
    issuedAt: claim.issuedAt,
    expiresAt: claim.expiresAt,
    signingKeyId: claim.signingKeyId,
    signingAlgorithm: claim.signingAlgorithm,
    signature: claim.signature,
  };
}

function publicGatewayConfiguration(gateway: Item, authority: ConfigurationAuthority): Item {
  const hardwareRevision = typeof gateway.hardwareRevision === 'string' && gateway.hardwareRevision
    ? gateway.hardwareRevision
    : undefined;
  return {
    gatewayId: authority.gatewayId,
    thingName: requiredStoredString(gateway.thingName, unavailable),
    serialNumber: requiredStoredString(gateway.serialNumber, unavailable),
    modelId: requiredStoredString(gateway.modelId ?? gateway.model, unavailable),
    ...(hardwareRevision ? { hardwareRevision } : {}),
    siteId: requiredStoredString(gateway.siteId, unavailable),
  };
}

function publicAssignment(authority: ConfigurationAuthority): Item {
  return {
    generation: authority.generation,
    profileId: requiredStoredString(authority.descriptor.profileId, unavailable),
    profileVersionId: authority.profileVersionId,
    profileVersion: positiveStoredInteger(authority.descriptor.profileVersion, unavailable),
    schemaVersion: profileSchemaVersion(authority.descriptor.schemaVersion),
    profileChecksum: requiredStoredString(authority.descriptor.profileSha256, unavailable),
  };
}

function profileSchemaVersion(value: unknown): string | number {
  if (typeof value === 'string' && value.length > 0 && value.length <= 32) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) return value;
  throw unavailable();
}

async function recordHttpDelivery(
  authority: ConfigurationAuthority,
  request: AuthorizedRequest,
  context: Context,
  dependencies: DeviceConfigurationDependencies,
): Promise<void> {
  const now = dependencies.now().toISOString();
  const gatewayState = String(authority.gateway.state);
  const deploymentState = String(authority.deployment.status);
  const transitionGateway = DELIVERY_GATEWAY_STATES.has(gatewayState);
  const transitionDeployment = DELIVERY_DEPLOYMENT_STATES.has(deploymentState);
  const transitionOperation = DELIVERY_OPERATION_STATES.has(String(authority.operation.state));
  const tenantKey = tenantPk(authority.tenantId);

  // Once this exact generation has been delivered, later polls are read-only.
  // This avoids permanent audit growth and DDB write amplification across a
  // large fleet while the strong reads above still reauthorize every request.
  if (!transitionGateway && !transitionDeployment && !transitionOperation) return;

  const transaction: TransactItems = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: gatewaySk(authority.gatewayId) },
        UpdateExpression: transitionGateway
          ? 'SET #state = :delivered, lastAuthenticatedAt = :now, lastConfigRequestAt = :now, updatedAt = :now'
          : 'SET lastAuthenticatedAt = :now, lastConfigRequestAt = :now, updatedAt = :now',
        ConditionExpression: [
          'entityType = :gateway',
          '#state = :observedState',
          'certificateStatus = :active',
          'thingName = :thingName',
          'certificateId = :certificateId',
          'certificatePrincipal = :certificatePrincipal',
          'desiredGeneration = :generation',
          'desiredProfileVersionId = :profileVersionId',
          'operationId = :operationId',
          'signedDescriptor = :descriptor',
        ].join(' AND '),
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY',
          ':observedState': gatewayState,
          ':active': 'ACTIVE',
          ':thingName': request.thingName,
          ':certificateId': request.certificateId,
          ':certificatePrincipal': authority.certificatePrincipal,
          ':generation': authority.generation,
          ':profileVersionId': authority.profileVersionId,
          ':operationId': authority.operationId,
          ':descriptor': authority.descriptor,
          ':delivered': 'PROFILE_DELIVERED',
          ':now': now,
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: deploymentSk(authority.gatewayId, authority.generation) },
        UpdateExpression: transitionDeployment
          ? 'SET #status = :delivered, deliveredAt = if_not_exists(deliveredAt, :now), lastDeliveredAt = :now, updatedAt = :now'
          : 'SET lastDeliveredAt = :now, updatedAt = :now',
        ConditionExpression: [
          'entityType = :deployment',
          '#status = :observedStatus',
          'gatewayId = :gatewayId',
          'generation = :generation',
          'profileVersionId = :profileVersionId',
          'operationId = :operationId',
          'descriptor = :descriptor',
        ].join(' AND '),
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':deployment': 'DEPLOYMENT',
          ':observedStatus': deploymentState,
          ':gatewayId': authority.gatewayId,
          ':generation': authority.generation,
          ':profileVersionId': authority.profileVersionId,
          ':operationId': authority.operationId,
          ':descriptor': authority.descriptor,
          ':delivered': 'PROFILE_DELIVERED',
          ':now': now,
        },
      },
    },
  ];

  if (transitionOperation) {
    transaction.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: operationSk(authority.operationId) },
        UpdateExpression: 'SET operationStatus = :inProgress, #state = :profileStaged, deploymentGeneration = :generation, updatedAt = :now, steps[1] = :identityStep, steps[2] = :profileStep, timeline = list_append(if_not_exists(timeline, :empty), :events)',
        ConditionExpression: 'entityType = :operation AND gatewayId = :gatewayId AND profileVersionId = :profileVersionId AND #state = :observedState',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':operation': 'OPERATION',
          ':gatewayId': authority.gatewayId,
          ':profileVersionId': authority.profileVersionId,
          ':observedState': authority.operation.state,
          ':inProgress': 'IN_PROGRESS',
          ':profileStaged': 'PROFILE_STAGED',
          ':generation': authority.generation,
          ':now': now,
          ':empty': [],
          ':events': [{
            state: 'PROFILE_STAGED',
            detail: `Signed profile generation ${authority.generation} delivered over authenticated HTTPS.`,
            at: now,
          }],
          ':identityStep': {
            key: 'identity',
            label: 'Permanent identity provisioned',
            status: 'complete',
            detail: 'Permanent certificate authenticated by AWS IoT credentials provider.',
            timestamp: now,
          },
          ':profileStep': {
            key: 'profile',
            label: 'Signed profile delivered',
            status: 'complete',
            detail: `Signed profile generation ${authority.generation} delivered.`,
            timestamp: now,
          },
        },
      },
    });
  }

  const auditId = `http_${context.awsRequestId}`.slice(0, 160);
  transaction.push({
    Put: {
      TableName: TABLE_NAME,
      Item: {
        PK: tenantKey,
        SK: auditSk(now, auditId),
        entityType: 'AUDIT',
        auditId,
        tenantId: authority.tenantId,
        actorSubject: authority.certificatePrincipal,
        actorRole: 'DEVICE',
        action: 'SIGNED_PROFILE_DELIVERED_HTTP',
        targetId: authority.gatewayId,
        details: {
          generation: authority.generation,
          profileVersionId: authority.profileVersionId,
          thingName: request.thingName,
        },
        outcome: 'SUCCESS',
        createdAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    },
  });

  try {
    await dependencies.transactWrite(transaction);
  } catch (error) {
    // Concurrent pulls can race on the first delivery transition. Accept the
    // loser only if consistent rereads prove this exact assignment moved
    // forward and the certificate is still active.
    const [gateway, deployment] = await Promise.all([
      dependencies.getItem({ PK: tenantKey, SK: gatewaySk(authority.gatewayId) }),
      dependencies.getItem({ PK: tenantKey, SK: deploymentSk(authority.gatewayId, authority.generation) }),
    ]);
    if (gateway?.certificateStatus === 'ACTIVE'
      && gateway.certificateId === request.certificateId
      && gateway.thingName === request.thingName
      && gateway.desiredGeneration === authority.generation
      && gateway.desiredProfileVersionId === authority.profileVersionId
      && gateway.operationId === authority.operationId
      && isRecord(gateway.signedDescriptor)
      && canonicalJson(gateway.signedDescriptor) === canonicalJson(authority.descriptor)
      && FORWARD_DELIVERY_STATES.has(String(gateway.state))
      && deployment?.gatewayId === authority.gatewayId
      && deployment.generation === authority.generation
      && deployment.profileVersionId === authority.profileVersionId
      && deployment.operationId === authority.operationId
      && isRecord(deployment.descriptor)
      && canonicalJson(deployment.descriptor) === canonicalJson(authority.descriptor)
      && FORWARD_DELIVERY_STATES.has(String(deployment.status))) {
      return;
    }
    throw error;
  }
}

function assignmentDescriptor(
  value: unknown,
  expected: {
    tenantId: string;
    gatewayId: string;
    thingName: string;
    generation: number;
    profileVersionId: string;
  },
): Item {
  if (!isRecord(value)) throw unavailable();
  const descriptor = value;
  if (descriptor.kind !== 'gateway-profile-assignment'
    || descriptor.tenantId !== expected.tenantId
    || descriptor.gatewayId !== expected.gatewayId
    || descriptor.thingName !== expected.thingName
    || descriptor.generation !== expected.generation
    || descriptor.profileVersionId !== expected.profileVersionId
    || typeof descriptor.profileSha256 !== 'string'
    || !CHECKSUM_PATTERN.test(descriptor.profileSha256)
    || typeof descriptor.signature !== 'string'
    || !SIGNATURE_PATTERN.test(descriptor.signature)
    || descriptor.signingAlgorithm !== 'ECDSA_SHA_256'
    || !SIGNING_KEY_ID
    || descriptor.signingKeyId !== SIGNING_KEY_ID) {
    throw unavailable();
  }
  const issuedAt = typeof descriptor.issuedAt === 'string' ? Date.parse(descriptor.issuedAt) : Number.NaN;
  const expiresAt = typeof descriptor.expiresAt === 'string' ? Date.parse(descriptor.expiresAt) : Number.NaN;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || issuedAt >= expiresAt) {
    throw unavailable();
  }
  return descriptor;
}

function artifactKey(value: unknown, tenantId: string): string {
  if (typeof value !== 'string' || !value) throw unavailable();
  const expectedPrefix = `tenants/${tenantId}/profiles/`;
  if (!value.startsWith(expectedPrefix)
    || value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part === '..')) {
    throw unavailable();
  }
  return value;
}

function requiredStoredString(
  value: unknown,
  errorFactory: () => DeviceConfigurationError,
): string {
  if (typeof value !== 'string' || !value) throw errorFactory();
  return value;
}

function positiveStoredInteger(
  value: unknown,
  errorFactory: () => DeviceConfigurationError,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw errorFactory();
  return value;
}

function isRecord(value: unknown): value is Item {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidRequest(message: string): DeviceConfigurationError {
  return new DeviceConfigurationError(400, 'INVALID_REQUEST', message);
}

function unauthorized(): DeviceConfigurationError {
  return new DeviceConfigurationError(403, 'DEVICE_NOT_AUTHORIZED', 'Device is not authorized');
}

function unavailable(): DeviceConfigurationError {
  return new DeviceConfigurationError(409, 'CONFIGURATION_NOT_AVAILABLE', 'Configuration is not available');
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function json(statusCode: number, body: unknown, requestId: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'x-request-id': requestId,
    },
    body: JSON.stringify(body),
  };
}
