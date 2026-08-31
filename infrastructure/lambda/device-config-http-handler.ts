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
  controllerSk,
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
import { INITIAL_OPERATION_STEPS } from './shared/models.js';
import {
  finalizePermanentIdentity,
  PermanentIdentityFinalizationError,
  type PermanentIdentityFinalizationDependencies,
} from './shared/permanent-identity.js';
import {
  storedControllerConfiguration,
  type StoredControllerConfiguration,
} from './shared/controller-configuration.js';

const ROUTE_KEY = 'GET /device/v1/things/{thingName}/certificates/{certificateId}/configuration';
const GATEWAY_CONFIG_ROLE_NAME = process.env.GATEWAY_CONFIG_ROLE_NAME?.trim() ?? '';
const MAX_PROFILE_BYTES = 1024 * 1024;
const THING_NAME_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const CERTIFICATE_ID_PATTERN = /^[a-f0-9]{64}$/i;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const CONTROLLER_REVISION_PATTERN = /^controller_[a-f0-9]{32}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const AUTHENTICATED_CONFIGURATION_PULL = 'AUTHENTICATED_CONFIGURATION_PULL';
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
const ACTIVE_DEPLOYMENT_STATES = new Set([
  ...DELIVERY_DEPLOYMENT_STATES,
  ...FORWARD_DELIVERY_STATES,
]);
const ACTIVE_OPERATION_STATES = new Set([
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
const HTTP_COMPLETE_OPERATION_STATES = new Set([
  'PROFILE_STAGED',
]);
const FORWARD_OPERATION_STATES = new Set([
  'PROFILE_STAGED',
  'APPLYING',
  'HEALTH_CHECK',
  'APPLIED_HEALTHY',
  'FAILED',
  'ROLLING_BACK',
  'ROLLED_BACK',
]);
const OPERATION_TYPES = new Set(['ONBOARD', 'PROFILE_DEPLOY']);
const OPERATION_STATUSES = new Set(['IN_PROGRESS', 'SUCCEEDED', 'FAILED']);
const OPERATION_STEP_STATUSES = new Set(['pending', 'in_progress', 'complete', 'error']);
const OPERATION_TIMELINE_STATES = new Set([
  'CLAIM_ACCEPTED',
  ...ACTIVE_OPERATION_STATES,
]);
const MAX_OPERATION_TIMELINE_EVENTS = 512;

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
  operationType: string;
  operationStatus: string;
  certificatePrincipal: string;
  generation: number;
  profileVersionId: string;
  descriptor: Item;
  objectKey: string;
  controller?: StoredControllerConfiguration;
}

interface ConfigurationDeliverySource {
  kind: 'S3' | 'CONTROLLER';
  checksum: string;
  retrievedAt: string;
  controllerRevision?: string;
  controllerUpdatedAt?: string;
}

interface RecordedConfigurationDelivery {
  kind: 'S3' | 'CONTROLLER';
  generation: number;
  checksum: string;
  controllerRevision?: string;
  controllerUpdatedAt?: string;
}

interface ObservedSourceCondition {
  expression: string;
  values: Item;
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
      if (authority.controller) {
        assertControllerRetrievalAllowed(authority);
        const source: ConfigurationDeliverySource = {
          kind: 'CONTROLLER',
          checksum: authority.controller.configurationChecksum,
          retrievedAt: dependencies.now().toISOString(),
          controllerRevision: authority.controller.revision,
          controllerUpdatedAt: authority.controller.updatedAt,
        };
        assertControllerDeliveryConsistency(authority, source);
        await recordHttpDelivery(authority, request, context, dependencies, source);
        return rawJson(
          200,
          authority.controller.configurationBody,
          requestId,
          configurationResponseHeaders(authority, source.kind),
        );
      }

      const source: ConfigurationDeliverySource = {
        kind: 'S3',
        checksum: requiredStoredString(authority.descriptor.profileSha256, unavailable),
        retrievedAt: dependencies.now().toISOString(),
      };
      assertS3DeliveryConsistency(authority, source);
      const profileBytes = await dependencies.loadProfileArtifact(authority.objectKey);
      const configuration = verifiedProfileDocument(profileBytes, authority);
      const gateway = publicGatewayConfiguration(authority.gateway, authority);
      const integrity = compactConfigurationClaim(authority, gateway);

      await recordHttpDelivery(authority, request, context, dependencies, source);

      return json(200, {
        type: 'GATEWAY_CONFIGURATION',
        responseVersion: 1,
        requestId,
        gateway,
        assignment: publicAssignment(authority),
        configuration,
        integrity,
      }, requestId, configurationResponseHeaders(authority, source.kind));
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
    || !ACTIVE_DEPLOYMENT_STATES.has(String(deployment.status))
    || !isRecord(deployment.descriptor)
    || canonicalJson(deployment.descriptor) !== canonicalJson(descriptor)) {
    throw unavailable();
  }

  const storedOperation = await dependencies.getItem({ PK: expectedPk, SK: operationSk(operationId) });
  const operationType = requiredStoredString(storedOperation?.type, unavailable);
  const operationStatus = requiredStoredString(storedOperation?.operationStatus, unavailable);
  const operationState = requiredStoredString(storedOperation?.state, unavailable);
  if (!storedOperation
    || !OPERATION_TYPES.has(operationType)
    || !validOperationStatus(operationState, operationStatus)
    || !ACTIVE_OPERATION_STATES.has(operationState)) {
    throw unavailable();
  }
  const operation: Item = {
    ...storedOperation,
    steps: canonicalOperationSteps(storedOperation.steps),
    timeline: canonicalOperationTimeline(storedOperation.timeline),
  };
  if (operation.entityType !== 'OPERATION'
    || operation.PK !== expectedPk
    || operation.SK !== operationSk(operationId)
    || operation.tenantId !== tenantId
    || operation.operationId !== operationId
    || operation.gatewayId !== gatewayId
    || operation.profileVersionId !== desiredProfileVersionId
    || operation.deploymentGeneration !== request.generation) {
    throw unavailable();
  }

  const controllerItem = await dependencies.getItem({ PK: expectedPk, SK: controllerSk() });
  let controller: ConfigurationAuthority['controller'];
  if (controllerItem) {
    if (controllerItem.entityType !== 'CONTROLLER_CONFIGURATION'
      || controllerItem.PK !== expectedPk
      || controllerItem.SK !== controllerSk()
      || controllerItem.tenantId !== tenantId) {
      throw unavailable();
    }
    try {
      controller = storedControllerConfiguration(controllerItem);
    } catch {
      throw unavailable();
    }
  }

  return {
    gateway,
    deployment,
    operation,
    tenantId,
    gatewayId,
    operationId,
    operationType,
    operationStatus,
    certificatePrincipal,
    generation: request.generation,
    profileVersionId: desiredProfileVersionId,
    descriptor,
    objectKey,
    ...(controller ? { controller } : {}),
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

function assertControllerDeliveryConsistency(
  authority: ConfigurationAuthority,
  source: ConfigurationDeliverySource,
): void {
  if (source.kind !== 'CONTROLLER'
    || !source.controllerRevision
    || !source.controllerUpdatedAt) throw unavailable();
  const gatewayRecorded = currentGenerationDelivery(authority.gateway, authority.generation);
  const deploymentRecorded = currentGenerationDelivery(authority.deployment, authority.generation);
  if (!gatewayRecorded && !deploymentRecorded) {
    if (!ordinaryFirstControllerDelivery(authority)
      && !exactPreApplyControllerTransition(authority)) throw unavailable();
    return;
  }
  if (!gatewayRecorded
    || !deploymentRecorded
    || !recordedDeliveriesMatch(gatewayRecorded, deploymentRecorded)) throw unavailable();
  if (recordedDeliveryMatchesSource(gatewayRecorded, source)) return;
  if (!exactPreApplyControllerTransition(authority)) throw unavailable();

  if (gatewayRecorded.kind === 'S3') {
    // An explicit tenant Controller activation is allowed to replace the
    // generation's prior S3 delivery. The transaction below fences this exact
    // S3 checksum on both records before installing Controller authority.
    return;
  }

  if (gatewayRecorded.controllerRevision !== source.controllerRevision
    || gatewayRecorded.controllerUpdatedAt !== source.controllerUpdatedAt) {
    // A changed admin-controlled configuration revision may supersede a previous
    // Controller delivery immediately. Payload drift inside one exact revision
    // remains forbidden, so a dynamic Controller cannot silently rewrite an
    // already-delivered generation.
    return;
  }
  throw unavailable();
}

function assertControllerRetrievalAllowed(authority: ConfigurationAuthority): void {
  if (!authority.controller) throw unavailable();
  const gatewayRecorded = currentGenerationDelivery(authority.gateway, authority.generation);
  const deploymentRecorded = currentGenerationDelivery(authority.deployment, authority.generation);
  if (!gatewayRecorded && !deploymentRecorded) {
    if (!ordinaryFirstControllerDelivery(authority)
      && !exactPreApplyControllerTransition(authority)) throw unavailable();
    return;
  }
  if (!gatewayRecorded
    || !deploymentRecorded
    || !recordedDeliveriesMatch(gatewayRecorded, deploymentRecorded)) throw unavailable();
  const sameControllerRevision = gatewayRecorded.kind === 'CONTROLLER'
    && gatewayRecorded.controllerRevision === authority.controller.revision
    && gatewayRecorded.controllerUpdatedAt === authority.controller.updatedAt;
  if (sameControllerRevision) return;
  if (!exactPreApplyControllerTransition(authority)) throw unavailable();
}

function ordinaryFirstControllerDelivery(authority: ConfigurationAuthority): boolean {
  return DELIVERY_GATEWAY_STATES.has(String(authority.gateway.state))
    && DELIVERY_DEPLOYMENT_STATES.has(String(authority.deployment.status))
    && authority.operationStatus === 'IN_PROGRESS'
    && (DELIVERY_OPERATION_STATES.has(String(authority.operation.state))
      || (authority.operationType === 'PROFILE_DEPLOY'
        && HTTP_COMPLETE_OPERATION_STATES.has(String(authority.operation.state))));
}

function exactPreApplyControllerTransition(authority: ConfigurationAuthority): boolean {
  return authority.gateway.state === 'PROFILE_DELIVERED'
    && authority.deployment.status === 'PROFILE_DELIVERED'
    && authority.operation.state === 'PROFILE_STAGED'
    && authority.operationStatus === 'IN_PROGRESS';
}

function assertS3DeliveryConsistency(
  authority: ConfigurationAuthority,
  source: ConfigurationDeliverySource,
): void {
  if (source.kind !== 'S3') throw unavailable();
  const gatewayRecorded = currentGenerationDelivery(authority.gateway, authority.generation);
  const deploymentRecorded = currentGenerationDelivery(authority.deployment, authority.generation);
  if (!gatewayRecorded && !deploymentRecorded) return;
  if (!gatewayRecorded
    || !deploymentRecorded
    || !recordedDeliveriesMatch(gatewayRecorded, deploymentRecorded)
    || gatewayRecorded.kind !== 'S3'
    || !recordedDeliveryMatchesSource(gatewayRecorded, source)) {
    // Controller activation is one-way for a generation. Removing or corrupting
    // the singleton cannot make the device silently fall back to S3.
    throw unavailable();
  }
}

function observedSourceCondition(
  item: Item,
  generation: number,
  prefix: 'gateway' | 'deployment',
): ObservedSourceCondition {
  const recorded = recordedConfigurationDelivery(item, generation);
  if (!recorded) {
    return {
      expression: [
        'attribute_not_exists(deliveredConfigurationGeneration)',
        'attribute_not_exists(configurationSource)',
        'attribute_not_exists(deliveredConfigurationChecksum)',
      ].join(' AND '),
      values: {},
    };
  }
  const generationToken = `:${prefix}ObservedConfigurationGeneration`;
  const sourceToken = `:${prefix}ObservedConfigurationSource`;
  const checksumToken = `:${prefix}ObservedConfigurationChecksum`;
  const revisionToken = `:${prefix}ObservedControllerRevision`;
  const updatedAtToken = `:${prefix}ObservedControllerUpdatedAt`;
  return {
    expression: [
      `deliveredConfigurationGeneration = ${generationToken}`,
      `configurationSource = ${sourceToken}`,
      `deliveredConfigurationChecksum = ${checksumToken}`,
      ...(recorded.kind === 'CONTROLLER' ? [
        `controllerConfigurationRevision = ${revisionToken}`,
        `controllerConfigurationUpdatedAt = ${updatedAtToken}`,
      ] : []),
    ].join(' AND '),
    values: {
      [generationToken]: recorded.generation,
      [sourceToken]: recorded.kind,
      [checksumToken]: recorded.checksum,
      ...(recorded.kind === 'CONTROLLER' ? {
        [revisionToken]: recorded.controllerRevision,
        [updatedAtToken]: recorded.controllerUpdatedAt,
      } : {}),
    },
  };
}

function recordedDeliverySourceMatches(
  item: Item,
  source: ConfigurationDeliverySource,
  generation: number,
): boolean {
  return item.deliveredConfigurationGeneration === generation
    && item.configurationSource === source.kind
    && item.deliveredConfigurationChecksum === source.checksum
    && (source.kind !== 'CONTROLLER'
      || (item.controllerConfigurationRevision === source.controllerRevision
        && item.controllerConfigurationUpdatedAt === source.controllerUpdatedAt));
}

function currentGenerationDelivery(
  item: Item,
  generation: number,
): RecordedConfigurationDelivery | undefined {
  const recorded = recordedConfigurationDelivery(item, generation);
  return recorded?.generation === generation ? recorded : undefined;
}

function recordedConfigurationDelivery(
  item: Item,
  maximumGeneration: number,
): RecordedConfigurationDelivery | undefined {
  const generation = item.deliveredConfigurationGeneration;
  const kind = item.configurationSource;
  const checksum = item.deliveredConfigurationChecksum;
  const corePresent = generation !== undefined || kind !== undefined || checksum !== undefined;
  if (!corePresent) {
    if (item.controllerConfigurationRevision !== undefined
      || item.controllerConfigurationUpdatedAt !== undefined) throw unavailable();
    return undefined;
  }
  if (typeof generation !== 'number'
    || !Number.isSafeInteger(generation)
    || generation < 1
    || generation > maximumGeneration
    || (kind !== 'S3' && kind !== 'CONTROLLER')
    || typeof checksum !== 'string'
    || !CHECKSUM_PATTERN.test(checksum)) throw unavailable();
  if (kind === 'CONTROLLER') {
    const controllerRevision = item.controllerConfigurationRevision;
    const controllerUpdatedAt = item.controllerConfigurationUpdatedAt;
    if (typeof controllerRevision !== 'string'
      || !CONTROLLER_REVISION_PATTERN.test(controllerRevision)
      || typeof controllerUpdatedAt !== 'string'
      || !Number.isFinite(Date.parse(controllerUpdatedAt))) throw unavailable();
    return { kind, generation, checksum, controllerRevision, controllerUpdatedAt };
  }
  return { kind, generation, checksum };
}

function recordedDeliveriesMatch(
  left: RecordedConfigurationDelivery,
  right: RecordedConfigurationDelivery,
): boolean {
  return left.kind === right.kind
    && left.generation === right.generation
    && left.checksum === right.checksum
    && left.controllerRevision === right.controllerRevision
    && left.controllerUpdatedAt === right.controllerUpdatedAt;
}

function recordedDeliveryMatchesSource(
  recorded: RecordedConfigurationDelivery,
  source: ConfigurationDeliverySource,
): boolean {
  return recorded.kind === source.kind
    && recorded.checksum === source.checksum
    && (recorded.kind !== 'CONTROLLER'
      || (recorded.controllerRevision === source.controllerRevision
        && recorded.controllerUpdatedAt === source.controllerUpdatedAt));
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
  source: ConfigurationDeliverySource,
): Promise<void> {
  const now = dependencies.now().toISOString();
  const gatewayState = String(authority.gateway.state);
  const deploymentState = String(authority.deployment.status);
  const transitionGateway = DELIVERY_GATEWAY_STATES.has(gatewayState);
  const transitionDeployment = DELIVERY_DEPLOYMENT_STATES.has(deploymentState);
  const transitionOperation = DELIVERY_OPERATION_STATES.has(String(authority.operation.state));
  const pullConfirmsControllerDeployment = source.kind === 'CONTROLLER'
    && authority.operationStatus === 'IN_PROGRESS'
    && (ordinaryFirstControllerDelivery(authority)
      || exactPreApplyControllerTransition(authority));
  const tenantKey = tenantPk(authority.tenantId);
  const sourceUpdate = [
    'configurationSource = :configurationSource',
    'deliveredConfigurationGeneration = :configurationGeneration',
    'deliveredConfigurationChecksum = :configurationChecksum',
    'configurationRetrievedAt = :configurationRetrievedAt',
    ...(source.kind === 'CONTROLLER' ? [
      'controllerConfigurationRevision = :controllerRevision',
      'controllerConfigurationUpdatedAt = :controllerUpdatedAt',
    ] : []),
  ].join(', ');
  const gatewaySourceCondition = observedSourceCondition(authority.gateway, authority.generation, 'gateway');
  const deploymentSourceCondition = observedSourceCondition(authority.deployment, authority.generation, 'deployment');
  const sourceValues = {
    ':configurationSource': source.kind,
    ':configurationGeneration': authority.generation,
    ':configurationChecksum': source.checksum,
    ':configurationRetrievedAt': source.retrievedAt,
    ...(source.kind === 'CONTROLLER' ? {
      ':controllerRevision': source.controllerRevision,
      ':controllerUpdatedAt': source.controllerUpdatedAt,
    } : {}),
  };

  // Polls of the same authoritative source/revision are read-only. An explicit
  // S3-to-Controller activation or Controller endpoint revision still records
  // the new internal checksum atomically for subsequent status attestation.
  const sourceTransition = source.kind === 'CONTROLLER'
    && (!recordedDeliverySourceMatches(authority.gateway, source, authority.generation)
      || !recordedDeliverySourceMatches(authority.deployment, source, authority.generation));
  if (!transitionGateway
    && !transitionDeployment
    && !transitionOperation
    && !pullConfirmsControllerDeployment
    && !sourceTransition) {
    await fenceReadOnlyDelivery(authority, request, source, tenantKey, dependencies);
    return;
  }

  const transaction: TransactItems = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: gatewaySk(authority.gatewayId) },
        UpdateExpression: pullConfirmsControllerDeployment
          ? `SET #state = :appliedHealthy, health = :pullConfirmedHealth, lastAuthenticatedAt = :now, lastConfigRequestAt = :now, lastSeenAt = :now, updatedAt = :now, appliedGeneration = :generation, appliedProfileVersionId = :profileVersionId, appliedProfileChecksum = :configurationChecksum, configurationConfirmationMethod = :pullConfirmationMethod, configurationConfirmedAt = :now, ${sourceUpdate} REMOVE lastError, healthyAt, profileValidatedAt, dispatchLeaseId, dispatchLeaseGeneration, dispatchLeaseExpiresAtEpoch`
          : transitionGateway
            ? `SET #state = :delivered, lastAuthenticatedAt = :now, lastConfigRequestAt = :now, updatedAt = :now, ${sourceUpdate}`
            : `SET lastAuthenticatedAt = :now, lastConfigRequestAt = :now, updatedAt = :now, ${sourceUpdate}`,
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
          gatewaySourceCondition.expression,
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
          ...sourceValues,
          ...gatewaySourceCondition.values,
          ...(pullConfirmsControllerDeployment ? {
            ':appliedHealthy': 'APPLIED_HEALTHY',
            ':pullConfirmedHealth': 'UNKNOWN',
            ':pullConfirmationMethod': AUTHENTICATED_CONFIGURATION_PULL,
          } : transitionGateway ? { ':delivered': 'PROFILE_DELIVERED' } : {}),
          ':now': now,
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: deploymentSk(authority.gatewayId, authority.generation) },
        UpdateExpression: pullConfirmsControllerDeployment
          ? `SET #status = :appliedHealthy, deliveredAt = if_not_exists(deliveredAt, :now), lastDeliveredAt = :now, completedAt = :now, updatedAt = :now, appliedProfileVersionId = :profileVersionId, appliedProfileChecksum = :configurationChecksum, configurationConfirmationMethod = :pullConfirmationMethod, configurationConfirmedAt = :now, ${sourceUpdate} REMOVE #error, validatedAt`
          : transitionDeployment
            ? `SET #status = :delivered, deliveredAt = if_not_exists(deliveredAt, :now), lastDeliveredAt = :now, updatedAt = :now, ${sourceUpdate}`
            : `SET lastDeliveredAt = :now, updatedAt = :now, ${sourceUpdate}`,
        ConditionExpression: [
          'entityType = :deployment',
          '#status = :observedStatus',
          'gatewayId = :gatewayId',
          'generation = :generation',
          'profileVersionId = :profileVersionId',
          'operationId = :operationId',
          '#descriptor = :descriptor',
          deploymentSourceCondition.expression,
        ].join(' AND '),
        ExpressionAttributeNames: {
          '#descriptor': 'descriptor',
          '#status': 'status',
          ...(pullConfirmsControllerDeployment ? { '#error': 'error' } : {}),
        },
        ExpressionAttributeValues: {
          ':deployment': 'DEPLOYMENT',
          ':observedStatus': deploymentState,
          ':gatewayId': authority.gatewayId,
          ':generation': authority.generation,
          ':profileVersionId': authority.profileVersionId,
          ':operationId': authority.operationId,
          ':descriptor': authority.descriptor,
          ...sourceValues,
          ...deploymentSourceCondition.values,
          ...(pullConfirmsControllerDeployment ? {
            ':appliedHealthy': 'APPLIED_HEALTHY',
            ':pullConfirmationMethod': AUTHENTICATED_CONFIGURATION_PULL,
          } : transitionDeployment ? { ':delivered': 'PROFILE_DELIVERED' } : {}),
          ':now': now,
        },
      },
    },
  ];

  if (transitionOperation || pullConfirmsControllerDeployment) {
    const configurationLabel = source.kind === 'CONTROLLER'
      ? 'Controller configuration'
      : 'Signed profile';
    const operationAppliedByHttp = pullConfirmsControllerDeployment
      ? {
          nextState: 'APPLIED_HEALTHY',
          nextOperationStatus: 'SUCCEEDED',
          timelineState: 'APPLIED_HEALTHY',
          applyDetail: `Authenticated gateway retrieval confirmed Controller configuration and profile assignment generation ${authority.generation}. Apply and health were not reported separately.`,
        }
      : {
          nextState: 'PROFILE_STAGED',
          nextOperationStatus: 'IN_PROGRESS',
          timelineState: 'PROFILE_STAGED',
          applyDetail: `${configurationLabel} generation ${authority.generation} delivered over authenticated HTTPS.`,
        };
    const observedSteps = canonicalOperationSteps(authority.operation.steps);
    const observedTimeline = canonicalOperationTimeline(authority.operation.timeline);
    const nextSteps = observedSteps.map((step) => ({ ...step }));
    nextSteps[1] = {
      key: 'identity',
      label: 'Permanent identity provisioned',
      status: 'complete',
      detail: 'Permanent certificate authenticated by AWS IoT credentials provider.',
      timestamp: now,
    };
    nextSteps[2] = {
      key: 'profile',
      label: 'Signed profile delivered',
      status: 'complete',
      detail: pullConfirmsControllerDeployment
        ? `Controller payload and automatic profile assignment generation ${authority.generation} were retrieved by the authenticated gateway.`
        : `${configurationLabel} generation ${authority.generation} delivered.`,
      timestamp: now,
    };
    if (pullConfirmsControllerDeployment) {
      nextSteps[3] = {
        key: 'apply',
        label: 'Profile applied transactionally',
        status: 'complete',
        detail: 'Authenticated configuration retrieval is accepted as deployment confirmation for this gateway version.',
        timestamp: now,
      };
      nextSteps[4] = {
        key: 'health',
        label: 'Connectivity and service health validated',
        status: 'pending',
        detail: 'No separate device apply or health report is available in authenticated-pull compatibility mode.',
      };
    }
    const nextTimeline = [
      ...observedTimeline.map((entry) => ({ ...entry })),
      {
        state: operationAppliedByHttp.timelineState,
        detail: operationAppliedByHttp.applyDetail,
        operationStatus: operationAppliedByHttp.nextOperationStatus,
        at: now,
      },
    ];
    transaction.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: operationSk(authority.operationId) },
        UpdateExpression: pullConfirmsControllerDeployment
          ? 'SET operationStatus = :nextOperationStatus, #state = :nextOperationState, deploymentGeneration = :generation, updatedAt = :now, #steps = :nextSteps, #timeline = :nextTimeline, configurationSource = :configurationSource, configurationConfirmationMethod = :pullConfirmationMethod, configurationConfirmedAt = :now REMOVE #error, failure'
          : 'SET operationStatus = :nextOperationStatus, #state = :nextOperationState, deploymentGeneration = :generation, updatedAt = :now, #steps = :nextSteps, #timeline = :nextTimeline',
        ConditionExpression: [
          'entityType = :operation',
          'tenantId = :tenantId',
          'operationId = :operationId',
          '#type = :operationType',
          'gatewayId = :gatewayId',
          'profileVersionId = :profileVersionId',
          'deploymentGeneration = :generation',
          'operationStatus = :observedOperationStatus',
          '#state = :observedState',
          '#steps = :observedSteps',
          '#timeline = :observedTimeline',
        ].join(' AND '),
        ExpressionAttributeNames: {
          '#state': 'state',
          '#steps': 'steps',
          '#timeline': 'timeline',
          '#type': 'type',
          ...(pullConfirmsControllerDeployment ? { '#error': 'error' } : {}),
        },
        ExpressionAttributeValues: {
          ':operation': 'OPERATION',
          ':tenantId': authority.tenantId,
          ':operationId': authority.operationId,
          ':operationType': authority.operationType,
          ':gatewayId': authority.gatewayId,
          ':profileVersionId': authority.profileVersionId,
          ':observedState': authority.operation.state,
          ':observedOperationStatus': authority.operationStatus,
          ':observedSteps': observedSteps,
          ':observedTimeline': observedTimeline,
          ':nextOperationStatus': operationAppliedByHttp.nextOperationStatus,
          ':nextOperationState': operationAppliedByHttp.nextState,
          ':generation': authority.generation,
          ':now': now,
          ':nextSteps': nextSteps,
          ':nextTimeline': nextTimeline,
          ...(pullConfirmsControllerDeployment ? {
            ':configurationSource': source.kind,
            ':pullConfirmationMethod': AUTHENTICATED_CONFIGURATION_PULL,
          } : {}),
        },
      },
    });
  }

  transaction.push(deliverySingletonFence(authority, source, tenantKey));

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
        action: source.kind === 'CONTROLLER'
          ? pullConfirmsControllerDeployment
            ? 'CONTROLLER_CONFIGURATION_PULL_CONFIRMED'
            : 'CONTROLLER_CONFIGURATION_DELIVERED_HTTP'
          : 'SIGNED_PROFILE_DELIVERED_HTTP',
        targetId: authority.gatewayId,
        details: {
          generation: authority.generation,
          profileVersionId: authority.profileVersionId,
          configurationSource: source.kind,
          configurationChecksum: source.checksum,
          ...(pullConfirmsControllerDeployment ? {
            configurationConfirmationMethod: AUTHENTICATED_CONFIGURATION_PULL,
            deviceApplyReported: false,
            deviceHealthReported: false,
          } : {}),
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
    if (!isReconcilableTransactionCancellation(error)) throw error;
    // Concurrent pulls can race on the first delivery transition. Accept the
    // loser only if consistent rereads prove this exact assignment moved
    // forward and the certificate is still active.
    const [gateway, deployment, operation, controllerConfiguration] = await Promise.all([
      dependencies.getItem({ PK: tenantKey, SK: gatewaySk(authority.gatewayId) }),
      dependencies.getItem({ PK: tenantKey, SK: deploymentSk(authority.gatewayId, authority.generation) }),
      dependencies.getItem({ PK: tenantKey, SK: operationSk(authority.operationId) }),
      dependencies.getItem({ PK: tenantKey, SK: controllerSk() }),
    ]);
    if (deliveryRaceResolved({
      gateway,
      deployment,
      operation,
      authority,
      request,
      source,
      controllerConfiguration,
      tenantKey,
    })) {
      return;
    }
    throw error;
  }
}

function deliveryRaceResolved(input: {
  gateway: Item | undefined;
  deployment: Item | undefined;
  operation: Item | undefined;
  authority: ConfigurationAuthority;
  request: AuthorizedRequest;
  source: ConfigurationDeliverySource;
  controllerConfiguration: Item | undefined;
  tenantKey: string;
}): boolean {
  const {
    gateway,
    deployment,
    operation,
    authority,
    request,
    source,
    controllerConfiguration,
    tenantKey,
  } = input;
  try {
    canonicalOperationSteps(operation?.steps);
    canonicalOperationTimeline(operation?.timeline);
  } catch {
    return false;
  }
  const pullConfirmationWasRequired = source.kind === 'CONTROLLER'
    && authority.operationStatus === 'IN_PROGRESS'
    && (ordinaryFirstControllerDelivery(authority)
      || exactPreApplyControllerTransition(authority));
  const pullConfirmationMatches = !pullConfirmationWasRequired || (
    gateway?.state === 'APPLIED_HEALTHY'
      && gateway.health === 'UNKNOWN'
      && gateway.appliedGeneration === authority.generation
      && gateway.appliedProfileVersionId === authority.profileVersionId
      && gateway.appliedProfileChecksum === source.checksum
      && gateway.configurationConfirmationMethod === AUTHENTICATED_CONFIGURATION_PULL
      && typeof gateway.configurationConfirmedAt === 'string'
      && Number.isFinite(Date.parse(gateway.configurationConfirmedAt))
      && deployment?.status === 'APPLIED_HEALTHY'
      && deployment.appliedProfileVersionId === authority.profileVersionId
      && deployment.appliedProfileChecksum === source.checksum
      && deployment.configurationConfirmationMethod === AUTHENTICATED_CONFIGURATION_PULL
      && typeof deployment.configurationConfirmedAt === 'string'
      && Number.isFinite(Date.parse(deployment.configurationConfirmedAt))
      && operation?.state === 'APPLIED_HEALTHY'
      && operation.operationStatus === 'SUCCEEDED'
      && operation.configurationSource === 'CONTROLLER'
      && operation.configurationConfirmationMethod === AUTHENTICATED_CONFIGURATION_PULL
      && typeof operation.configurationConfirmedAt === 'string'
      && Number.isFinite(Date.parse(operation.configurationConfirmedAt))
  );
  return pullConfirmationMatches
      && singletonFenceMatches(controllerConfiguration, authority, source, tenantKey)
      && gateway?.entityType === 'GATEWAY'
      && gateway.PK === tenantKey
      && gateway.SK === gatewaySk(authority.gatewayId)
      && gateway.tenantId === authority.tenantId
      && gateway.gatewayId === authority.gatewayId
      && gateway.certificateStatus === 'ACTIVE'
      && gateway.certificateId === request.certificateId
      && gateway.thingName === request.thingName
      && gateway.desiredGeneration === authority.generation
      && gateway.desiredProfileVersionId === authority.profileVersionId
      && gateway.operationId === authority.operationId
      && isRecord(gateway.signedDescriptor)
      && canonicalJson(gateway.signedDescriptor) === canonicalJson(authority.descriptor)
      && recordedDeliverySourceMatches(gateway, source, authority.generation)
      && FORWARD_DELIVERY_STATES.has(String(gateway.state))
      && deployment?.entityType === 'DEPLOYMENT'
      && deployment.PK === tenantKey
      && deployment.SK === deploymentSk(authority.gatewayId, authority.generation)
      && deployment.tenantId === authority.tenantId
      && deployment.gatewayId === authority.gatewayId
      && deployment.generation === authority.generation
      && deployment.profileVersionId === authority.profileVersionId
      && deployment.operationId === authority.operationId
      && isRecord(deployment.descriptor)
      && canonicalJson(deployment.descriptor) === canonicalJson(authority.descriptor)
      && recordedDeliverySourceMatches(deployment, source, authority.generation)
      && FORWARD_DELIVERY_STATES.has(String(deployment.status))
      && operation?.entityType === 'OPERATION'
      && operation.PK === tenantKey
      && operation.SK === operationSk(authority.operationId)
      && operation.tenantId === authority.tenantId
      && operation.operationId === authority.operationId
      && operation.type === authority.operationType
      && operation.gatewayId === authority.gatewayId
      && operation.profileVersionId === authority.profileVersionId
      && operation.deploymentGeneration === authority.generation
      && OPERATION_STATUSES.has(String(operation.operationStatus))
      && validOperationStatus(String(operation.state), String(operation.operationStatus))
      && FORWARD_OPERATION_STATES.has(String(operation.state));
}

function deliverySingletonFence(
  authority: ConfigurationAuthority,
  source: ConfigurationDeliverySource,
  tenantKey: string,
): TransactItems[number] {
  if (source.kind === 'CONTROLLER' && authority.controller) {
    return {
      ConditionCheck: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: controllerSk() },
        ConditionExpression: 'entityType = :controller AND tenantId = :tenantId AND configuration = :controllerConfiguration AND configurationBody = :controllerBody AND configurationChecksum = :controllerChecksum AND revision = :controllerRevision AND updatedAt = :controllerUpdatedAt',
        ExpressionAttributeValues: {
          ':controller': 'CONTROLLER_CONFIGURATION',
          ':tenantId': authority.tenantId,
          ':controllerConfiguration': authority.controller.configuration,
          ':controllerBody': authority.controller.configurationBody,
          ':controllerChecksum': authority.controller.configurationChecksum,
          ':controllerRevision': authority.controller.revision,
          ':controllerUpdatedAt': authority.controller.updatedAt,
        },
      },
    };
  }
  if (source.kind !== 'S3') throw unavailable();
  return {
    ConditionCheck: {
      TableName: TABLE_NAME,
      Key: { PK: tenantKey, SK: controllerSk() },
      ConditionExpression: 'attribute_not_exists(PK)',
    },
  };
}

function readOnlyDeliveryFences(
  authority: ConfigurationAuthority,
  request: AuthorizedRequest,
  source: ConfigurationDeliverySource,
  tenantKey: string,
): TransactItems {
  const gatewaySource = observedSourceCondition(authority.gateway, authority.generation, 'gateway');
  const deploymentSource = observedSourceCondition(authority.deployment, authority.generation, 'deployment');
  return [
    {
      ConditionCheck: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: gatewaySk(authority.gatewayId) },
        ConditionExpression: [
          'entityType = :gateway',
          'tenantId = :tenantId',
          'gatewayId = :gatewayId',
          '#state = :observedState',
          'certificateStatus = :active',
          'thingName = :thingName',
          'certificateId = :certificateId',
          'certificatePrincipal = :certificatePrincipal',
          'desiredGeneration = :generation',
          'desiredProfileVersionId = :profileVersionId',
          'operationId = :operationId',
          'signedDescriptor = :descriptor',
          gatewaySource.expression,
        ].join(' AND '),
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY',
          ':tenantId': authority.tenantId,
          ':gatewayId': authority.gatewayId,
          ':observedState': authority.gateway.state,
          ':active': 'ACTIVE',
          ':thingName': request.thingName,
          ':certificateId': request.certificateId,
          ':certificatePrincipal': authority.certificatePrincipal,
          ':generation': authority.generation,
          ':profileVersionId': authority.profileVersionId,
          ':operationId': authority.operationId,
          ':descriptor': authority.descriptor,
          ...gatewaySource.values,
        },
      },
    },
    {
      ConditionCheck: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: deploymentSk(authority.gatewayId, authority.generation) },
        ConditionExpression: [
          'entityType = :deployment',
          'tenantId = :tenantId',
          'gatewayId = :gatewayId',
          '#status = :observedStatus',
          'generation = :generation',
          'profileVersionId = :profileVersionId',
          'operationId = :operationId',
          '#descriptor = :descriptor',
          deploymentSource.expression,
        ].join(' AND '),
        ExpressionAttributeNames: {
          '#descriptor': 'descriptor',
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':deployment': 'DEPLOYMENT',
          ':tenantId': authority.tenantId,
          ':gatewayId': authority.gatewayId,
          ':observedStatus': authority.deployment.status,
          ':generation': authority.generation,
          ':profileVersionId': authority.profileVersionId,
          ':operationId': authority.operationId,
          ':descriptor': authority.descriptor,
          ...deploymentSource.values,
        },
      },
    },
    {
      ConditionCheck: {
        TableName: TABLE_NAME,
        Key: { PK: tenantKey, SK: operationSk(authority.operationId) },
        ConditionExpression: [
          'entityType = :operation',
          'tenantId = :tenantId',
          'operationId = :operationId',
          '#type = :operationType',
          'gatewayId = :gatewayId',
          'profileVersionId = :profileVersionId',
          'deploymentGeneration = :generation',
          'operationStatus = :operationStatus',
          '#state = :observedState',
        ].join(' AND '),
        ExpressionAttributeNames: {
          '#state': 'state',
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':operation': 'OPERATION',
          ':tenantId': authority.tenantId,
          ':operationId': authority.operationId,
          ':operationType': authority.operationType,
          ':gatewayId': authority.gatewayId,
          ':profileVersionId': authority.profileVersionId,
          ':generation': authority.generation,
          ':operationStatus': authority.operationStatus,
          ':observedState': authority.operation.state,
        },
      },
    },
    deliverySingletonFence(authority, source, tenantKey),
  ];
}

async function fenceReadOnlyDelivery(
  authority: ConfigurationAuthority,
  request: AuthorizedRequest,
  source: ConfigurationDeliverySource,
  tenantKey: string,
  dependencies: DeviceConfigurationDependencies,
): Promise<void> {
  await dependencies.transactWrite(readOnlyDeliveryFences(authority, request, source, tenantKey));
}

function singletonFenceMatches(
  controllerConfiguration: Item | undefined,
  authority: ConfigurationAuthority,
  source: ConfigurationDeliverySource,
  tenantKey: string,
): boolean {
  if (source.kind === 'S3') return controllerConfiguration === undefined;
  if (!authority.controller
    || controllerConfiguration?.PK !== tenantKey
    || controllerConfiguration.SK !== controllerSk()
    || controllerConfiguration.entityType !== 'CONTROLLER_CONFIGURATION'
    || controllerConfiguration.tenantId !== authority.tenantId) return false;
  try {
    const stored = storedControllerConfiguration(controllerConfiguration);
    return stored.configurationBody === authority.controller.configurationBody
      && stored.configurationChecksum === authority.controller.configurationChecksum
      && stored.revision === authority.controller.revision
      && stored.updatedAt === authority.controller.updatedAt;
  } catch {
    return false;
  }
}

function isReconcilableTransactionCancellation(error: unknown): boolean {
  if (!isRecord(error) || error.name !== 'TransactionCanceledException') return false;
  const reasons = error.CancellationReasons;
  if (reasons === undefined) return false;
  if (!Array.isArray(reasons)) return false;
  let hasRaceReason = false;
  for (const reason of reasons) {
    if (!isRecord(reason) || typeof reason.Code !== 'string') return false;
    if (reason.Code === 'None') continue;
    if (reason.Code === 'ConditionalCheckFailed' || reason.Code === 'TransactionConflict') {
      hasRaceReason = true;
      continue;
    }
    return false;
  }
  return hasRaceReason;
}

function canonicalOperationSteps(value: unknown): Item[] {
  if (!Array.isArray(value) || value.length !== INITIAL_OPERATION_STEPS.length) throw unavailable();
  return value.map((candidate, index) => {
    const template = INITIAL_OPERATION_STEPS[index];
    if (!template || !isRecord(candidate)
      || candidate.key !== template.key
      || candidate.label !== template.label
      || typeof candidate.status !== 'string'
      || !OPERATION_STEP_STATUSES.has(candidate.status)
      || !hasOnlyKeys(candidate, ['key', 'label', 'status', 'detail', 'timestamp'])) {
      throw unavailable();
    }
    const detail = optionalBoundedString(candidate.detail, 2048);
    const timestamp = optionalIsoTimestamp(candidate.timestamp);
    return {
      key: template.key,
      label: template.label,
      status: candidate.status,
      ...(detail ? { detail } : {}),
      ...(timestamp ? { timestamp } : {}),
    };
  });
}

function canonicalOperationTimeline(value: unknown): Item[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_OPERATION_TIMELINE_EVENTS) {
    throw unavailable();
  }
  return value.map((candidate) => {
    if (!isRecord(candidate)
      || typeof candidate.state !== 'string'
      || !OPERATION_TIMELINE_STATES.has(candidate.state)
      || !hasOnlyKeys(candidate, ['state', 'at', 'detail', 'operationStatus'])) {
      throw unavailable();
    }
    const at = requiredIsoTimestamp(candidate.at);
    const detail = requiredBoundedString(candidate.detail, 4096);
    const operationStatus = candidate.operationStatus === undefined
      ? undefined
      : requiredBoundedString(candidate.operationStatus, 32);
    if (operationStatus && !OPERATION_STATUSES.has(operationStatus)) throw unavailable();
    return {
      state: candidate.state,
      at,
      detail,
      ...(operationStatus ? { operationStatus } : {}),
    };
  });
}

function validOperationStatus(state: string, operationStatus: string): boolean {
  if (!OPERATION_STATUSES.has(operationStatus)) return false;
  if (state === 'APPLIED_HEALTHY') return operationStatus === 'SUCCEEDED';
  if (state === 'FAILED' || state === 'ROLLED_BACK') return operationStatus === 'FAILED';
  return operationStatus === 'IN_PROGRESS';
}

function hasOnlyKeys(value: Item, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function optionalBoundedString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredBoundedString(value, maxLength);
}

function requiredBoundedString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) throw unavailable();
  return value;
}

function optionalIsoTimestamp(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredIsoTimestamp(value);
}

function requiredIsoTimestamp(value: unknown): string {
  const timestamp = requiredBoundedString(value, 64);
  if (!Number.isFinite(Date.parse(timestamp))) throw unavailable();
  return timestamp;
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

function configurationResponseHeaders(
  authority: ConfigurationAuthority,
  source: ConfigurationDeliverySource['kind'],
): Record<string, string> {
  return {
    'x-ce-configuration-source': source,
    'x-ce-generation': String(authority.generation),
    'x-ce-profile-version-id': authority.profileVersionId,
    ...(source === 'CONTROLLER' ? {
      'x-ce-confirmation-method': AUTHENTICATED_CONFIGURATION_PULL,
    } : {}),
  };
}

function json(
  statusCode: number,
  body: unknown,
  requestId: string,
  additionalHeaders: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return rawJson(statusCode, JSON.stringify(body), requestId, additionalHeaders);
}

function rawJson(
  statusCode: number,
  body: string,
  requestId: string,
  additionalHeaders: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'x-request-id': requestId,
      ...additionalHeaders,
    },
    body,
  };
}
