import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
} from 'aws-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ARTIFACT_BUCKET, TABLE_NAME } from './shared/config.js';
import { tenantContext, requireRole } from './shared/auth.js';
import {
  auditSk,
  ConflictError,
  ddb,
  deploymentSk,
  gatewaySk,
  idempotencySk,
  InputError,
  normalizeIdentifier,
  NotFoundError,
  operationSk,
  outboxSk,
  profileSk,
  profileVersionSk,
  serialPk,
  tenantPk,
} from './shared/ddb.js';
import { errorResponse, idempotencyKey, json, parseJsonBody } from './shared/http.js';
import { newId, sha256 } from './shared/crypto.js';
import {
  canonicalJson,
  signGatewayConfigurationClaim,
  signManifest,
  validateProfile,
} from './shared/profile.js';
import { INITIAL_OPERATION_STEPS, publicOperation } from './shared/models.js';
import { validateUiProfileParameters } from './shared/ui-profile.js';
import { assertProfileCompatibility, assertProfileLineageModel } from './shared/compatibility.js';
import { normalizePresentedSerial } from './shared/manufacturing-credentials.js';

const s3 = new S3Client({});
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const VERIFICATION_TTL_SECONDS = 15 * 60;
const ASSIGNABLE_GATEWAY_STATES = new Set(['APPLIED_HEALTHY', 'ROLLED_BACK']);

interface LegacyAssignmentMigration {
  descriptor: Record<string, unknown>;
  operationId: string;
  profileVersionId: string;
}

interface IdempotencyRecord extends Record<string, unknown> {
  requestHash?: string;
  response?: unknown;
  statusCode?: number;
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const requestId = event.requestContext.requestId;
  try {
    const context = tenantContext(event);
    const routeKey = event.routeKey;
    switch (routeKey) {
      case 'GET /api/onboarding/snapshot':
        return json(200, await snapshot(context.tenantId));
      case 'POST /api/onboarding/claims/verify':
        requireRole(context, 'platform_admin', 'tenant_admin', 'operator');
        return await verifyDevice(event, context);
      case 'POST /api/onboarding/profiles':
        requireRole(context, 'platform_admin', 'tenant_admin');
        return await createUiProfileVersion(event, context);
      case 'POST /api/onboarding/operations':
        requireRole(context, 'platform_admin', 'tenant_admin', 'operator');
        return await createOperation(event, context);
      case 'GET /api/onboarding/operations/{operationId}':
        return await getOperation(event, context.tenantId);
      case 'POST /api/onboarding/gateways/{gatewayId}/decommission':
        requireRole(context, 'platform_admin', 'tenant_admin');
        return await decommissionGateway(event, context);
      case 'GET /profiles':
        return json(200, { profiles: (await queryTenantEntityPrefix(context.tenantId, 'PROFILE#', 'PROFILE', 500)).map(publicProfile) });
      case 'POST /profiles':
        requireRole(context, 'platform_admin', 'tenant_admin');
        return await createProfile(event, context);
      case 'POST /profiles/{profileId}/versions':
        requireRole(context, 'platform_admin', 'tenant_admin');
        return await createProfileVersion(event, context);
      case 'POST /gateways/{gatewayId}/assignments':
      case 'POST /api/onboarding/gateways/{gatewayId}/assignments':
        requireRole(context, 'platform_admin', 'tenant_admin', 'operator');
        return await assignProfile(event, context);
      default:
        return json(404, { error: 'Route not found', requestId });
    }
  } catch (error) {
    return errorResponse(error, requestId);
  }
};

async function snapshot(tenantId: string): Promise<Record<string, unknown>> {
  const tenantKey = tenantPk(tenantId);
  const [tenantResult, sites, gatewayModels, profiles, gateways, recentOperations] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: tenantKey, SK: 'METADATA' }, ConsistentRead: true })),
    queryTenantEntityPrefix(tenantId, 'SITE#', 'SITE', 250),
    queryTenantEntityPrefix(tenantId, 'MODEL#', 'GATEWAY_MODEL', 100),
    queryTenantEntityPrefix(tenantId, 'PROFILE_VERSION#', 'PROFILE_VERSION', 500),
    queryTenantEntityPrefix(tenantId, 'GATEWAY#', 'GATEWAY', 250),
    recentTenantOperations(tenantId, 100),
  ]);
  const activeOperations = await operationsById(
    tenantId,
    gateways.map((gateway) => gateway.operationId).filter((id): id is string => typeof id === 'string'),
  );
  const operationMap = new Map<string, Record<string, unknown>>();
  for (const operation of [...recentOperations, ...activeOperations]) {
    if (typeof operation.operationId === 'string') operationMap.set(operation.operationId, operation);
  }
  const tenant = tenantResult.Item;
  return {
    generatedAt: new Date().toISOString(),
    mode: 'aws',
    tenant: { id: tenantId, name: tenant?.name ?? tenantId },
    gatewayModels: gatewayModels.map(publicGatewayModel),
    gateways: gateways.map(publicGateway),
    profiles: profiles.map(publicUiProfileVersion),
    sites: sites.map(publicSite),
    operations: [...operationMap.values()].map(publicOperation),
  };
}

async function verifyDevice(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  context: ReturnType<typeof tenantContext>,
) {
  const body = parseJsonBody<Record<string, unknown>>(event, 32 * 1024);
  const serialNumber = normalizePresentedSerial(body.serialNumber);
  const key = idempotencyKey(event);
  const requestHash = sha256(canonicalJson({ route: event.routeKey, serialNumber }));
  const existing = await existingIdempotency(context.tenantId, event.routeKey, key, requestHash);
  if (existing) return json(existing.statusCode ?? 200, existing.response);

  const manufacturingResult = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: serialPk(serialNumber), SK: 'MANUFACTURING' },
    ConsistentRead: true,
  }));
  const record = manufacturingResult.Item;
  if (!record) throw new NotFoundError('Gateway identity was not found in manufacturing inventory');
  const bootstrapCertificateId = requirePreloadedBootstrap(record);
  if (!['AVAILABLE', 'CLAIMABLE', 'RESERVED'].includes(String(record.state))) throw new ConflictError('Gateway identity is not available for verification');
  const allowedTenantIds = Array.isArray(record.allowedTenantIds) ? record.allowedTenantIds : [];
  const tenantAuthorized = record.tenantId === context.tenantId
    || (record.tenantId === undefined && allowedTenantIds.includes(context.tenantId));
  if (!tenantAuthorized) {
    throw new NotFoundError('Gateway identity was not found in manufacturing inventory');
  }
  if (record.state === 'RESERVED' && Number(record.verificationExpiresAtEpoch ?? 0) >= Math.floor(Date.now() / 1000)) {
    throw new ConflictError('Gateway identity already has an active one-time reservation');
  }

  const sites = await queryTenantEntityPrefix(context.tenantId, 'SITE#', 'SITE', 250);
  const allowedSiteIds = Array.isArray(record.allowedSiteIds) ? record.allowedSiteIds as string[] : sites.map((site) => String(site.siteId));
  const allowedSites = sites.filter((site) => allowedSiteIds.includes(String(site.siteId))).map(publicSite);
  if (allowedSites.length === 0) throw new ConflictError('No authorized site is available for this gateway');

  const verificationId = newId('ver');
  const now = new Date().toISOString();
  const nowEpoch = Math.floor(Date.now() / 1000);
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + VERIFICATION_TTL_SECONDS;
  const response = {
    verificationId,
    identity: {
      serialNumber,
      modelId: record.modelId ?? record.model,
      hardwareRevision: record.hardwareRevision ?? 'UNKNOWN',
      manufacturingBatch: record.manufacturingBatch ?? 'UNKNOWN',
    },
    allowedSites,
    expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
  };
  const idem = idempotencyItem(context.tenantId, event.routeKey, key, requestHash, response, 201);

  await ddb.send(new TransactWriteCommand({ TransactItems: [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: serialPk(serialNumber), SK: 'MANUFACTURING' },
        UpdateExpression: 'SET #state = :reserved, tenantId = :tenantId, verificationId = :verificationId, verificationExpiresAtEpoch = :expires, updatedAt = :now',
        ConditionExpression: [
          'entityType = :manufacturing',
          'serialNumber = :serialNumber',
          '(tenantId = :tenantId OR (attribute_not_exists(tenantId) AND contains(allowedTenantIds, :tenantId)))',
          'claimMechanism = :claimMechanism',
          'bootstrapCertificateId = :bootstrapCertificateId',
          'bootstrapCertificateStatus = :bootstrapCertificateActive',
          '(#state = :available OR #state = :claimable OR (#state = :reserved AND tenantId = :tenantId AND verificationExpiresAtEpoch < :nowEpoch))',
        ].join(' AND '),
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':available': 'AVAILABLE', ':claimable': 'CLAIMABLE', ':reserved': 'RESERVED', ':tenantId': context.tenantId,
          ':manufacturing': 'MANUFACTURING', ':serialNumber': serialNumber,
          ':claimMechanism': 'PRELOADED_UNIQUE_BOOTSTRAP', ':bootstrapCertificateId': bootstrapCertificateId,
          ':bootstrapCertificateActive': 'ACTIVE',
          ':verificationId': verificationId, ':expires': expiresAtEpoch, ':now': now, ':nowEpoch': nowEpoch,
        },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: tenantPk(context.tenantId), SK: `VERIFICATION#${verificationId}`, entityType: 'VERIFICATION',
          tenantId: context.tenantId, verificationId, serialNumber, allowedSiteIds,
          createdAt: now, expiresAt: response.expiresAt, expiresAtEpoch,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    { Put: { TableName: TABLE_NAME, Item: idem, ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(context, 'GATEWAY_SERIAL_RESERVED', serialNumber, now), ConditionExpression: 'attribute_not_exists(PK)' } },
  ] }));
  return json(201, response);
}

async function createOperation(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  context: ReturnType<typeof tenantContext>,
) {
  const body = parseJsonBody<Record<string, unknown>>(event, 64 * 1024);
  const verificationId = normalizeIdentifier(body.verificationId, 'verificationId');
  const siteId = normalizeIdentifier(body.siteId, 'siteId');
  const profileVersionId = normalizeIdentifier(body.profileVersionId, 'profileVersionId');
  const deliveryMode = body.deliveryMode === 'JOB' ? 'JOB' : 'SHADOW';
  const key = idempotencyKey(event);
  const requestHash = sha256(canonicalJson({ route: event.routeKey, verificationId, siteId, profileVersionId, deliveryMode }));
  const existing = await existingIdempotency(context.tenantId, event.routeKey, key, requestHash);
  if (existing) return json(existing.statusCode ?? 202, existing.response);

  const verification = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tenantPk(context.tenantId), SK: `VERIFICATION#${verificationId}` },
    ConsistentRead: true,
  }));
  if (!verification.Item || verification.Item.entityType !== 'VERIFICATION') throw new ConflictError('Gateway verification is missing or expired');
  const serialNumber = normalizePresentedSerial(verification.Item.serialNumber);
  if ((Number(verification.Item.expiresAtEpoch) || 0) < Math.floor(Date.now() / 1000)) throw new ConflictError('Gateway verification expired');

  const [manufacturing, site, profileVersion] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: serialPk(serialNumber), SK: 'MANUFACTURING' }, ConsistentRead: true })),
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: tenantPk(context.tenantId), SK: `SITE#${siteId}` }, ConsistentRead: true })),
    profileVersionById(context.tenantId, profileVersionId),
  ]);
  const record = manufacturing.Item;
  if (!record || record.state !== 'RESERVED' || record.tenantId !== context.tenantId || record.verificationId !== verificationId) {
    throw new ConflictError('Gateway verification is missing, expired, or belongs to another tenant');
  }
  if ((Number(record.verificationExpiresAtEpoch) || 0) < Math.floor(Date.now() / 1000)) throw new ConflictError('Gateway verification expired');
  const bootstrapCertificateId = requirePreloadedBootstrap(record);
  if (!site.Item || site.Item.entityType !== 'SITE') throw new NotFoundError('Site not found');
  if (!profileVersion) throw new NotFoundError('Profile version not found');
  const authoritativeModelId = String(record.modelId ?? record.model ?? '');
  assertProfileCompatibility(authoritativeModelId, profileVersion.modelId);
  const allowedSiteIds = Array.isArray(record.allowedSiteIds) ? record.allowedSiteIds as string[] : undefined;
  if (allowedSiteIds && !allowedSiteIds.includes(siteId)) throw new ConflictError('Gateway is not authorized for the selected site');

  const gatewayId = `gw_${sha256(serialNumber).slice(0, 24)}`;
  const thingName = `gw-${sha256(serialNumber).slice(0, 24)}`;
  const operationId = newId('op');
  const now = new Date().toISOString();
  const nowEpoch = Math.floor(Date.now() / 1000);
  const steps = INITIAL_OPERATION_STEPS.map((step, index) => index === 0 ? { ...step, timestamp: now } : step);
  const signedDescriptor = await signAssignmentDescriptor({
    tenantId: context.tenantId,
    gatewayId,
    thingName,
    gatewayMetadata: configurationGatewayMetadata({
      gatewayId,
      thingName,
      serialNumber,
      modelId: authoritativeModelId,
      hardwareRevision: record.hardwareRevision ?? 'UNKNOWN',
      siteId,
    }),
    generation: 1,
    profileVersion,
    issuedAt: now,
  });
  const operation = {
    PK: tenantPk(context.tenantId), SK: operationSk(operationId), entityType: 'OPERATION', tenantId: context.tenantId,
    operationId, gatewayId, serialNumber, siteId, profileVersionId, deliveryMode,
    type: 'ONBOARD', operationStatus: 'IN_PROGRESS', state: 'CLAIM_ACCEPTED', deploymentGeneration: 1,
    timeline: [{ state: 'CLAIM_ACCEPTED', at: now, detail: 'An authenticated operator reserved the tenant-bound serial inventory record.' }],
    status: 'WAITING_FOR_DEVICE', steps, createdAt: now, updatedAt: now,
    GSI3PK: `${tenantPk(context.tenantId)}#OPERATION`, GSI3SK: `${now}#${operationId}`,
  };
  const deploymentId = newId('dep');
  const deployment = {
    PK: tenantPk(context.tenantId), SK: deploymentSk(gatewayId, 1),
    entityType: 'DEPLOYMENT', tenantId: context.tenantId, deploymentId, gatewayId, generation: 1,
    profileVersionId, operationId, status: 'WAITING_FOR_DEVICE', descriptor: signedDescriptor,
    deliveryMode, createdAt: now, updatedAt: now,
  };
  const response = publicOperation(operation);
  const idem = idempotencyItem(context.tenantId, event.routeKey, key, requestHash, response, 202);
  const verificationExpiry = Number(record.verificationExpiresAtEpoch);

  await ddb.send(new TransactWriteCommand({ TransactItems: [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: serialPk(serialNumber), SK: 'MANUFACTURING' },
        UpdateExpression: 'SET #state = :enrollmentPending, gatewayId = :gatewayId, operationId = :operationId, siteId = :siteId, profileVersionId = :profileVersionId, deliveryMode = :deliveryMode, thingName = :thingName, signedDescriptor = :descriptor, enrollmentAuthorizedAt = :now, updatedAt = :now REMOVE verificationExpiresAtEpoch',
        ConditionExpression: '#state = :reserved AND tenantId = :tenantId AND verificationId = :verificationId AND verificationExpiresAtEpoch = :expires AND verificationExpiresAtEpoch >= :nowEpoch AND claimMechanism = :claimMechanism AND bootstrapCertificateId = :bootstrapCertificateId AND bootstrapCertificateStatus = :bootstrapCertificateActive',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':reserved': 'RESERVED', ':enrollmentPending': 'ENROLLMENT_PENDING', ':tenantId': context.tenantId,
          ':verificationId': verificationId, ':expires': verificationExpiry, ':gatewayId': gatewayId,
          ':nowEpoch': nowEpoch,
          ':operationId': operationId, ':siteId': siteId, ':profileVersionId': profileVersionId,
          ':claimMechanism': 'PRELOADED_UNIQUE_BOOTSTRAP', ':bootstrapCertificateId': bootstrapCertificateId,
          ':bootstrapCertificateActive': 'ACTIVE',
          ':deliveryMode': deliveryMode, ':thingName': thingName, ':descriptor': signedDescriptor, ':now': now,
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantPk(context.tenantId), SK: `VERIFICATION#${verificationId}` },
        UpdateExpression: 'SET #state = :consumed, consumedAt = :now',
        ConditionExpression: 'entityType = :verification AND serialNumber = :serialNumber AND expiresAtEpoch = :expires',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':verification': 'VERIFICATION', ':consumed': 'CONSUMED', ':serialNumber': serialNumber,
          ':expires': verificationExpiry, ':now': now,
        },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: tenantPk(context.tenantId), SK: gatewaySk(gatewayId), entityType: 'GATEWAY', tenantId: context.tenantId,
          gatewayId, thingName, serialNumber, manufacturer: record.manufacturer,
          model: record.model, modelId: record.modelId ?? record.model, hardwareRevision: record.hardwareRevision ?? 'UNKNOWN',
          siteId, state: 'PENDING', certificateState: 'PENDING', health: 'UNKNOWN', generation: 1, desiredGeneration: 1,
          desiredProfileVersionId: profileVersionId, operationId, signedDescriptor, createdAt: now, updatedAt: now,
          GSI1PK: `THING#${thingName}`, GSI1SK: tenantPk(context.tenantId),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    { Put: { TableName: TABLE_NAME, Item: operation, ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: deployment, ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: idem, ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(context, 'ONBOARDING_OPERATION_CREATED', operationId, now), ConditionExpression: 'attribute_not_exists(PK)' } },
  ] }));
  return json(202, response);
}

function requirePreloadedBootstrap(record: Record<string, unknown>): string {
  if (record.claimMechanism !== 'PRELOADED_UNIQUE_BOOTSTRAP') {
    throw new ConflictError('Gateway does not have a preloaded unique bootstrap identity');
  }
  if (record.bootstrapCertificateStatus !== 'ACTIVE') {
    throw new ConflictError('Gateway bootstrap certificate is not active');
  }
  const certificateId = record.bootstrapCertificateId;
  if (typeof certificateId !== 'string' || !/^[a-f0-9]{64}$/i.test(certificateId)) {
    throw new ConflictError('Gateway bootstrap certificate binding is missing or invalid');
  }
  return certificateId;
}

async function getOperation(event: APIGatewayProxyEventV2WithJWTAuthorizer, tenantId: string) {
  const operationId = normalizeIdentifier(event.pathParameters?.operationId, 'operationId');
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tenantPk(tenantId), SK: operationSk(operationId) },
    ConsistentRead: true,
  }));
  if (!result.Item || result.Item.entityType !== 'OPERATION') throw new NotFoundError('Operation not found');
  return json(200, publicOperation(result.Item));
}

async function createUiProfileVersion(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  context: ReturnType<typeof tenantContext>,
) {
  const body = parseJsonBody<Record<string, unknown>>(event, 96 * 1024);
  const name = requiredText(body.name, 'name', 80);
  const description = requiredText(body.description, 'description', 240);
  const modelId = normalizeIdentifier(body.modelId, 'modelId', 80);
  const changeNote = requiredText(body.changeNote, 'changeNote', 160);
  const baseProfileVersionId = body.baseProfileVersionId == null || body.baseProfileVersionId === ''
    ? undefined
    : normalizeIdentifier(body.baseProfileVersionId, 'baseProfileVersionId');
  const parameters = validateUiProfileParameters(body.parameters);
  const key = idempotencyKey(event);
  const requestHash = sha256(canonicalJson({
    route: event.routeKey, name, description, modelId, changeNote, baseProfileVersionId, parameters,
  }));
  const existing = await existingIdempotency(context.tenantId, event.routeKey, key, requestHash);
  if (existing) return json(existing.statusCode ?? 201, existing.response);

  const model = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tenantPk(context.tenantId), SK: `MODEL#${modelId}` },
    ConsistentRead: true,
  }));
  if (!model.Item || model.Item.entityType !== 'GATEWAY_MODEL') throw new NotFoundError('Gateway model not found');

  let profileId = newId('prof');
  let currentVersion = 0;
  let profileMeta: Record<string, unknown> | undefined;
  if (baseProfileVersionId) {
    const baseVersion = await profileVersionById(context.tenantId, baseProfileVersionId);
    if (!baseVersion) throw new NotFoundError('Base profile version not found');
    assertProfileLineageModel(baseVersion.modelId, modelId);
    profileId = normalizeIdentifier(baseVersion.profileId, 'profileId');
    const meta = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: tenantPk(context.tenantId), SK: profileSk(profileId) },
      ConsistentRead: true,
    }));
    if (!meta.Item || meta.Item.entityType !== 'PROFILE') throw new ConflictError('Profile metadata is missing');
    assertProfileLineageModel(meta.Item.modelId, modelId);
    profileMeta = meta.Item;
    currentVersion = Number(meta.Item.currentVersion ?? 0);
  }

  const version = currentVersion + 1;
  const profileVersionId = newId('pv');
  const now = new Date().toISOString();
  const document = { schemaVersion: 1, modelId, parameters };
  const documentCanonical = canonicalJson(document);
  const documentHash = sha256(documentCanonical);
  const objectPrefix = `tenants/${context.tenantId}/profiles/${profileId}/versions/${String(version).padStart(10, '0')}/${documentHash}`;
  const objectKey = `${objectPrefix}/profile.json`;
  const manifestKey = `${objectPrefix}/manifest.json`;
  const signed = await signManifest({
    kind: 'gateway-profile', schemaVersion: 1, tenantId: context.tenantId, profileId,
    profileVersionId, version, modelId, sha256: documentHash, objectKey, issuedAt: now,
  });
  const storedManifest = { ...signed.manifest, signature: signed.signature, signingAlgorithm: signed.signingAlgorithm };
  if (!ARTIFACT_BUCKET) throw new Error('Artifact bucket is not configured');
  await Promise.all([
    s3.send(new PutObjectCommand({
      Bucket: ARTIFACT_BUCKET, Key: objectKey, Body: Buffer.from(documentCanonical), ContentType: 'application/json',
      IfNoneMatch: '*', Metadata: { tenantid: context.tenantId, profileid: profileId, version: String(version), sha256: documentHash },
    })),
    s3.send(new PutObjectCommand({
      Bucket: ARTIFACT_BUCKET, Key: manifestKey, Body: Buffer.from(canonicalJson(storedManifest)), ContentType: 'application/json',
      IfNoneMatch: '*', Metadata: { tenantid: context.tenantId, profileid: profileId, version: String(version) },
    })),
  ]);

  const versionItem = {
    PK: tenantPk(context.tenantId), SK: profileVersionSk(profileId, version), entityType: 'PROFILE_VERSION', tenantId: context.tenantId,
    profileId, profileVersionId, name, description, modelId, version, schemaVersion: 1, parameters,
    documentHash, contentHash: documentHash, objectKey, manifestKey, signature: signed.signature,
    signingAlgorithm: signed.signingAlgorithm, signingKeyId: signed.manifest.signingKeyId,
    immutable: true, changeNote, createdBy: context.subject,
    createdAt: now, GSI2PK: `PROFILEVERSION#${profileVersionId}`, GSI2SK: tenantPk(context.tenantId),
  };
  const response = publicUiProfileVersion(versionItem);
  const transactItems: ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems'] = [];
  if (profileMeta) {
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantPk(context.tenantId), SK: profileSk(profileId) },
        UpdateExpression: 'SET #name = :name, description = :description, modelId = :modelId, currentVersion = :next, latestProfileVersionId = :versionId, updatedAt = :now',
        ConditionExpression: 'entityType = :profile AND currentVersion = :current',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: {
          ':profile': 'PROFILE', ':current': currentVersion, ':next': version, ':versionId': profileVersionId,
          ':name': name, ':description': description, ':modelId': modelId, ':now': now,
        },
      },
    });
  } else {
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: tenantPk(context.tenantId), SK: profileSk(profileId), entityType: 'PROFILE', tenantId: context.tenantId,
          profileId, name, description, modelId, currentVersion: version, latestProfileVersionId: profileVersionId,
          createdAt: now, updatedAt: now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    });
  }
  transactItems.push(
    { Put: { TableName: TABLE_NAME, Item: versionItem, ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: idempotencyItem(context.tenantId, event.routeKey, key, requestHash, response, 201), ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(context, 'PROFILE_VERSION_CREATED', profileVersionId, now, { documentHash, profileId, version }), ConditionExpression: 'attribute_not_exists(PK)' } },
  );
  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  return json(201, response);
}

async function decommissionGateway(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  context: ReturnType<typeof tenantContext>,
) {
  const gatewayId = normalizeIdentifier(event.pathParameters?.gatewayId, 'gatewayId');
  const body = parseJsonBody<Record<string, unknown>>(event, 8 * 1024);
  const confirmation = requiredText(body.confirmation, 'confirmation', 128);
  const key = idempotencyKey(event);
  const requestHash = sha256(canonicalJson({ route: event.routeKey, gatewayId, confirmationHash: sha256(confirmation) }));
  const existing = await existingIdempotency(context.tenantId, event.routeKey, key, requestHash);
  if (existing) return json(existing.statusCode ?? 202, existing.response);

  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tenantPk(context.tenantId), SK: gatewaySk(gatewayId) },
    ConsistentRead: true,
  }));
  const gateway = result.Item;
  if (!gateway || gateway.entityType !== 'GATEWAY') throw new NotFoundError('Gateway not found');
  if (confirmation !== gateway.serialNumber) throw new InputError('Type the gateway serial number exactly to confirm decommissioning');
  if (gateway.state === 'DECOMMISSIONED' || gateway.state === 'DECOMMISSIONING') {
    throw new ConflictError('Gateway is already decommissioned or decommissioning');
  }
  if (typeof gateway.certificateId !== 'string' || typeof gateway.thingName !== 'string' || gateway.certificateStatus !== 'ACTIVE') {
    throw new ConflictError('Gateway has no active permanent identity to decommission');
  }
  const nowEpoch = Math.floor(Date.now() / 1000);
  if (Number(gateway.dispatchLeaseExpiresAtEpoch ?? 0) >= nowEpoch) {
    throw new ConflictError('Gateway has an active profile-delivery lease; retry decommissioning after it expires');
  }
  const manufacturing = (await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: serialPk(String(gateway.serialNumber)), SK: 'MANUFACTURING' },
    ConsistentRead: true,
  }))).Item;
  if (!manufacturing
    || manufacturing.state !== 'PROVISIONED'
    || manufacturing.tenantId !== context.tenantId
    || manufacturing.gatewayId !== gatewayId
    || manufacturing.certificateId !== gateway.certificateId
    || manufacturing.thingName !== gateway.thingName) {
    throw new ConflictError('Gateway manufacturing identity is not in a decommissionable active state');
  }

  const operationId = newId('op');
  const outboxId = newId('out');
  const now = new Date().toISOString();
  const generation = Number(gateway.generation ?? 0) + 1;
  const operation = {
    PK: tenantPk(context.tenantId), SK: operationSk(operationId), entityType: 'OPERATION', tenantId: context.tenantId,
    operationId, type: 'DECOMMISSION', operationStatus: 'IN_PROGRESS', state: 'DECOMMISSIONING',
    gatewayId, serialNumber: gateway.serialNumber, siteId: gateway.siteId,
    profileVersionId: gateway.desiredProfileVersionId, deploymentGeneration: generation,
    timeline: [{ state: 'DECOMMISSIONING', at: now, detail: 'Certificate deactivation and MQTT session cleanup were requested.' }],
    createdAt: now, updatedAt: now,
    GSI3PK: `${tenantPk(context.tenantId)}#OPERATION`, GSI3SK: `${now}#${operationId}`,
  };
  const response = publicOperation(operation);
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantPk(context.tenantId), SK: gatewaySk(gatewayId) },
        UpdateExpression: 'SET #state = :decommissioning, certificateStatus = :revoking, generation = :generation, operationId = :operationId, updatedAt = :now',
        ConditionExpression: 'entityType = :gateway AND #state = :currentState AND #state <> :decommissioned AND #state <> :decommissioning AND generation = :current AND certificateStatus = :active AND (attribute_not_exists(dispatchLeaseExpiresAtEpoch) OR dispatchLeaseExpiresAtEpoch < :nowEpoch)',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY', ':decommissioning': 'DECOMMISSIONING', ':decommissioned': 'DECOMMISSIONED',
          ':revoking': 'REVOKING', ':active': 'ACTIVE', ':currentState': gateway.state, ':nowEpoch': nowEpoch,
          ':current': Number(gateway.generation ?? 0), ':generation': generation, ':operationId': operationId, ':now': now,
        },
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: serialPk(String(gateway.serialNumber)), SK: 'MANUFACTURING' },
        UpdateExpression: 'SET #state = :decommissioning, certificateStatus = :revoking, decommissionRequestedAt = :now, updatedAt = :now',
        ConditionExpression: '#state = :provisioned AND tenantId = :tenantId AND gatewayId = :gatewayId AND certificateId = :certificateId AND thingName = :thingName',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':provisioned': 'PROVISIONED', ':decommissioning': 'DECOMMISSIONING', ':revoking': 'REVOKING',
          ':tenantId': context.tenantId, ':gatewayId': gatewayId, ':certificateId': gateway.certificateId,
          ':thingName': gateway.thingName, ':now': now,
        },
      },
    },
    { Put: { TableName: TABLE_NAME, Item: operation, ConditionExpression: 'attribute_not_exists(PK)' } },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: tenantPk(context.tenantId), SK: outboxSk(now, outboxId), entityType: 'OUTBOX', outboxId,
          eventType: 'DECOMMISSION_GATEWAY', state: 'PENDING', tenantId: context.tenantId, gatewayId,
          operationId, serialNumber: gateway.serialNumber, thingName: gateway.thingName, certificateId: gateway.certificateId,
          generation, createdAt: now, updatedAt: now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    { Put: { TableName: TABLE_NAME, Item: idempotencyItem(context.tenantId, event.routeKey, key, requestHash, response, 202), ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(context, 'GATEWAY_DECOMMISSION_REQUESTED', gatewayId, now, { generation }), ConditionExpression: 'attribute_not_exists(PK)' } },
  ] }));
  return json(202, response);
}

async function createProfile(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  context: ReturnType<typeof tenantContext>,
) {
  const body = parseJsonBody<Record<string, unknown>>(event, 32 * 1024);
  const name = requiredText(body.name, 'name', 120);
  const description = optionalText(body.description, 'description', 500);
  const key = idempotencyKey(event);
  const requestHash = sha256(canonicalJson({ route: event.routeKey, name, description }));
  const existing = await existingIdempotency(context.tenantId, event.routeKey, key, requestHash);
  if (existing) return json(existing.statusCode ?? 201, existing.response);
  const profileId = newId('prof');
  const now = new Date().toISOString();
  const item = {
    PK: tenantPk(context.tenantId), SK: profileSk(profileId), entityType: 'PROFILE', tenantId: context.tenantId,
    profileId, name, description, currentVersion: 0, createdAt: now, updatedAt: now,
  };
  const response = { profile: publicProfile(item) };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: item, ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: idempotencyItem(context.tenantId, event.routeKey, key, requestHash, response, 201), ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(context, 'PROFILE_CREATED', profileId, now), ConditionExpression: 'attribute_not_exists(PK)' } },
  ] }));
  return json(201, response);
}

async function createProfileVersion(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  context: ReturnType<typeof tenantContext>,
) {
  const profileId = normalizeIdentifier(event.pathParameters?.profileId, 'profileId');
  const body = parseJsonBody<Record<string, unknown>>(event);
  validateProfile(body.document);
  const key = idempotencyKey(event);
  const documentCanonical = canonicalJson(body.document);
  const documentHash = sha256(documentCanonical);
  const changelog = optionalText(body.changelog, 'changelog', 1000);
  const requestHash = sha256(canonicalJson({ route: event.routeKey, profileId, documentHash, changelog }));
  const existing = await existingIdempotency(context.tenantId, event.routeKey, key, requestHash);
  if (existing) return json(existing.statusCode ?? 201, existing.response);

  const meta = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tenantPk(context.tenantId), SK: profileSk(profileId) },
    ConsistentRead: true,
  }));
  if (!meta.Item || meta.Item.entityType !== 'PROFILE') throw new NotFoundError('Profile not found');
  const currentVersion = Number(meta.Item.currentVersion ?? 0);
  const version = currentVersion + 1;
  const profileVersionId = newId('pv');
  const now = new Date().toISOString();
  const objectPrefix = `tenants/${context.tenantId}/profiles/${profileId}/versions/${String(version).padStart(10, '0')}/${documentHash}`;
  const objectKey = `${objectPrefix}/profile.json`;
  const manifestKey = `${objectPrefix}/manifest.json`;
  const signed = await signManifest({
    kind: 'gateway-profile', schemaVersion: '1.0', tenantId: context.tenantId, profileId,
    profileVersionId, version, sha256: documentHash, objectKey, issuedAt: now,
  });
  const storedManifest = { ...signed.manifest, signature: signed.signature, signingAlgorithm: signed.signingAlgorithm };
  if (!ARTIFACT_BUCKET) throw new Error('Artifact bucket is not configured');
  await Promise.all([
    s3.send(new PutObjectCommand({
      Bucket: ARTIFACT_BUCKET, Key: objectKey, Body: Buffer.from(documentCanonical), ContentType: 'application/json',
      IfNoneMatch: '*', Metadata: { tenantid: context.tenantId, profileid: profileId, version: String(version), sha256: documentHash },
    })),
    s3.send(new PutObjectCommand({
      Bucket: ARTIFACT_BUCKET, Key: manifestKey, Body: Buffer.from(canonicalJson(storedManifest)), ContentType: 'application/json',
      IfNoneMatch: '*', Metadata: { tenantid: context.tenantId, profileid: profileId, version: String(version), sha256: sha256(canonicalJson(storedManifest)) },
    })),
  ]);

  const versionItem = {
    PK: tenantPk(context.tenantId), SK: profileVersionSk(profileId, version), entityType: 'PROFILE_VERSION', tenantId: context.tenantId,
    profileId, profileVersionId, version, schemaVersion: '1.0', documentHash, objectKey, manifestKey,
    signature: signed.signature, signingAlgorithm: signed.signingAlgorithm,
    signingKeyId: signed.manifest.signingKeyId, changelog, createdBy: context.subject,
    createdAt: now, GSI2PK: `PROFILEVERSION#${profileVersionId}`, GSI2SK: tenantPk(context.tenantId),
  };
  const response = { profileVersion: publicProfileVersion(versionItem) };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantPk(context.tenantId), SK: profileSk(profileId) },
        UpdateExpression: 'SET currentVersion = :next, latestProfileVersionId = :versionId, updatedAt = :now',
        ConditionExpression: 'entityType = :profile AND currentVersion = :current',
        ExpressionAttributeValues: { ':profile': 'PROFILE', ':current': currentVersion, ':next': version, ':versionId': profileVersionId, ':now': now },
      },
    },
    { Put: { TableName: TABLE_NAME, Item: versionItem, ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: idempotencyItem(context.tenantId, event.routeKey, key, requestHash, response, 201), ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(context, 'PROFILE_VERSION_CREATED', profileVersionId, now, { documentHash, profileId, version }), ConditionExpression: 'attribute_not_exists(PK)' } },
  ] }));
  return json(201, response);
}

async function assignProfile(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  context: ReturnType<typeof tenantContext>,
) {
  const gatewayId = normalizeIdentifier(event.pathParameters?.gatewayId, 'gatewayId');
  const body = parseJsonBody<Record<string, unknown>>(event, 32 * 1024);
  const profileVersionId = normalizeIdentifier(body.profileVersionId, 'profileVersionId');
  const deliveryMode = body.deliveryMode === 'JOB' ? 'JOB' : 'SHADOW';
  const key = idempotencyKey(event);
  const requestHash = sha256(canonicalJson({ route: event.routeKey, gatewayId, profileVersionId, deliveryMode }));
  const existing = await existingIdempotency(context.tenantId, event.routeKey, key, requestHash);
  if (existing) return json(existing.statusCode ?? 202, existing.response);
  const [gatewayResult, profileVersion] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: tenantPk(context.tenantId), SK: gatewaySk(gatewayId) }, ConsistentRead: true })),
    profileVersionById(context.tenantId, profileVersionId),
  ]);
  const gateway = gatewayResult.Item;
  if (!gateway || gateway.entityType !== 'GATEWAY') throw new NotFoundError('Gateway not found');
  if (!profileVersion) throw new NotFoundError('Profile version not found');
  assertProfileCompatibility(gateway.modelId, profileVersion.modelId);
  if (typeof gateway.thingName !== 'string'
    || typeof gateway.certificateId !== 'string'
    || gateway.certificateStatus !== 'ACTIVE') {
    throw new ConflictError('Gateway permanent identity is not active');
  }
  const currentGeneration = Number(gateway.generation ?? 0);
  const currentGatewayState = String(gateway.state ?? '');
  const assignmentNowEpoch = Math.floor(Date.now() / 1000);
  if (Number(gateway.dispatchLeaseExpiresAtEpoch ?? 0) >= assignmentNowEpoch) {
    throw new ConflictError('Gateway has an active profile-delivery lease');
  }
  let legacyMigration: LegacyAssignmentMigration | undefined;
  if (currentGatewayState === 'PROFILE_DELIVERED') {
    if (!Number.isSafeInteger(currentGeneration) || currentGeneration < 1
      || typeof gateway.operationId !== 'string' || !gateway.operationId) {
      throw new ConflictError('Legacy profile assignment cannot be migrated safely');
    }
    const [deploymentResult, operationResult] = await Promise.all([
      ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: tenantPk(context.tenantId), SK: deploymentSk(gatewayId, currentGeneration) },
        ConsistentRead: true,
      })),
      ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: tenantPk(context.tenantId), SK: operationSk(gateway.operationId) },
        ConsistentRead: true,
      })),
    ]);
    legacyMigration = legacyAssignmentMigrationAuthority(
      gateway,
      deploymentResult.Item ?? {},
      operationResult.Item ?? {},
      assignmentNowEpoch,
    );
  } else if (!ASSIGNABLE_GATEWAY_STATES.has(currentGatewayState)) {
    throw new ConflictError('Gateway is not in a stable state that permits profile assignment');
  }
  const generation = currentGeneration + 1;
  const now = new Date().toISOString();
  const deploymentId = newId('dep');
  const operationId = newId('op');
  const outboxId = newId('out');
  const descriptor = await signAssignmentDescriptor({
    tenantId: context.tenantId,
    gatewayId,
    thingName: gateway.thingName,
    gatewayMetadata: configurationGatewayMetadata({
      gatewayId,
      thingName: gateway.thingName,
      serialNumber: gateway.serialNumber,
      modelId: gateway.modelId ?? gateway.model,
      hardwareRevision: gateway.hardwareRevision,
      siteId: gateway.siteId,
    }),
    generation,
    profileVersion,
    issuedAt: now,
  });
  const deployment = {
    PK: tenantPk(context.tenantId), SK: deploymentSk(gatewayId, generation),
    entityType: 'DEPLOYMENT', tenantId: context.tenantId, deploymentId, gatewayId, generation,
    profileVersionId, operationId, status: 'PROFILE_AVAILABLE', descriptor, deliveryMode, createdAt: now, updatedAt: now,
  };
  const operationSteps = INITIAL_OPERATION_STEPS.map((step) => {
    if (step.key === 'ownership' || step.key === 'identity') return { ...step, status: 'complete' as const, timestamp: now };
    if (step.key === 'profile') return { ...step, status: 'in_progress' as const, detail: 'Signed descriptor is queued for delivery.', timestamp: now };
    return step;
  });
  const operation = {
    PK: tenantPk(context.tenantId), SK: operationSk(operationId), entityType: 'OPERATION', tenantId: context.tenantId,
    operationId, type: 'PROFILE_DEPLOY', operationStatus: 'IN_PROGRESS', state: 'PROFILE_STAGED',
    gatewayId, serialNumber: gateway.serialNumber, siteId: gateway.siteId, profileVersionId,
    previousProfileVersionId: gateway.appliedProfileVersionId, deploymentGeneration: generation,
    timeline: [{ state: 'PROFILE_STAGED', at: now, detail: `Signed profile generation ${generation} is queued for delivery.` }],
    steps: operationSteps, createdAt: now, updatedAt: now,
    GSI3PK: `${tenantPk(context.tenantId)}#OPERATION`, GSI3SK: `${now}#${operationId}`,
  };
  const response = { deployment: publicDeployment(deployment), operation: publicOperation(operation) };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: tenantPk(context.tenantId), SK: gatewaySk(gatewayId) },
        UpdateExpression: 'SET generation = :generation, desiredGeneration = :generation, desiredProfileVersionId = :versionId, signedDescriptor = :descriptor, operationId = :operationId, #state = :available, health = :applying, updatedAt = :now',
        ConditionExpression: legacyMigration
          ? 'entityType = :gateway AND generation = :current AND desiredGeneration = :current AND desiredProfileVersionId = :legacyProfileVersionId AND operationId = :legacyOperationId AND signedDescriptor = :legacyDescriptor AND #state = :currentState AND certificateStatus = :active AND (attribute_not_exists(dispatchLeaseExpiresAtEpoch) OR dispatchLeaseExpiresAtEpoch < :nowEpoch)'
          : 'entityType = :gateway AND generation = :current AND #state = :currentState AND #state IN (:healthy, :rolledBack) AND certificateStatus = :active AND (attribute_not_exists(dispatchLeaseExpiresAtEpoch) OR dispatchLeaseExpiresAtEpoch < :nowEpoch)',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
          ':gateway': 'GATEWAY', ':current': currentGeneration, ':currentState': currentGatewayState,
          ':generation': generation, ':versionId': profileVersionId, ':descriptor': descriptor,
          ':operationId': operationId, ':available': 'PROFILE_AVAILABLE', ':applying': 'APPLYING', ':now': now,
          ':active': 'ACTIVE', ':nowEpoch': assignmentNowEpoch,
          ...(legacyMigration ? {
            ':legacyProfileVersionId': legacyMigration.profileVersionId,
            ':legacyOperationId': legacyMigration.operationId,
            ':legacyDescriptor': legacyMigration.descriptor,
          } : {
            ':healthy': 'APPLIED_HEALTHY',
            ':rolledBack': 'ROLLED_BACK',
          }),
        },
      },
    },
    ...(legacyMigration ? [
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: tenantPk(context.tenantId), SK: deploymentSk(gatewayId, currentGeneration) },
          UpdateExpression: 'SET #status = :superseded, supersededAt = :now, supersededByGeneration = :nextGeneration, supersededByOperationId = :nextOperationId, updatedAt = :now',
          ConditionExpression: 'entityType = :deployment AND gatewayId = :gatewayId AND generation = :generation AND profileVersionId = :profileVersionId AND operationId = :operationId AND descriptor = :descriptor AND #status = :delivered',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':deployment': 'DEPLOYMENT', ':gatewayId': gatewayId, ':generation': currentGeneration,
            ':profileVersionId': legacyMigration.profileVersionId, ':operationId': legacyMigration.operationId,
            ':descriptor': legacyMigration.descriptor, ':delivered': 'PROFILE_DELIVERED',
            ':superseded': 'SUPERSEDED', ':nextGeneration': generation, ':nextOperationId': operationId, ':now': now,
          },
        },
      },
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { PK: tenantPk(context.tenantId), SK: operationSk(legacyMigration.operationId) },
          UpdateExpression: 'SET operationStatus = :failed, #state = :failed, supersededAt = :now, supersededByGeneration = :nextGeneration, supersededByOperationId = :nextOperationId, failure = :failure, updatedAt = :now, timeline = list_append(if_not_exists(timeline, :empty), :events)',
          ConditionExpression: 'entityType = :operation AND operationId = :operationId AND gatewayId = :gatewayId AND deploymentGeneration = :generation AND profileVersionId = :profileVersionId AND operationStatus = :inProgress AND #state = :profileStaged',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':operation': 'OPERATION', ':operationId': legacyMigration.operationId, ':gatewayId': gatewayId,
            ':generation': currentGeneration, ':profileVersionId': legacyMigration.profileVersionId,
            ':inProgress': 'IN_PROGRESS', ':profileStaged': 'PROFILE_STAGED', ':failed': 'FAILED',
            ':nextGeneration': generation, ':nextOperationId': operationId, ':now': now, ':empty': [],
            ':failure': {
              code: 'LEGACY_ASSIGNMENT_SUPERSEDED',
              message: 'Legacy assignment was superseded by a signed inline-configuration assignment.',
              rolledBack: false,
            },
            ':events': [{
              state: 'FAILED',
              at: now,
              detail: `Legacy generation ${currentGeneration} was superseded by generation ${generation}.`,
            }],
          },
        },
      },
    ] : []),
    { Put: { TableName: TABLE_NAME, Item: deployment, ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: operation, ConditionExpression: 'attribute_not_exists(PK)' } },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: tenantPk(context.tenantId), SK: outboxSk(now, outboxId), entityType: 'OUTBOX', outboxId,
          eventType: deliveryMode === 'JOB' ? 'CREATE_JOB' : 'UPDATE_CONFIG_SHADOW', state: 'PENDING',
          tenantId: context.tenantId, gatewayId, thingName: gateway.thingName, generation, profileVersionId,
          operationId, deploymentId, descriptor, createdAt: now, updatedAt: now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    { Put: { TableName: TABLE_NAME, Item: idempotencyItem(context.tenantId, event.routeKey, key, requestHash, response, 202), ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(context, 'PROFILE_ASSIGNED', deploymentId, now, {
      gatewayId, generation, profileVersionId, deliveryMode,
      ...(legacyMigration ? { supersededLegacyGeneration: currentGeneration } : {}),
    }), ConditionExpression: 'attribute_not_exists(PK)' } },
  ] }));
  return json(202, response);
}

export function legacyAssignmentMigrationAuthority(
  gateway: Record<string, unknown>,
  deployment: Record<string, unknown>,
  operation: Record<string, unknown>,
  nowEpoch: number,
): LegacyAssignmentMigration {
  const conflict = (): never => {
    throw new ConflictError('Legacy profile assignment cannot be migrated safely');
  };
  const gatewayId = typeof gateway.gatewayId === 'string' && gateway.gatewayId ? gateway.gatewayId : conflict();
  const thingName = typeof gateway.thingName === 'string' && gateway.thingName ? gateway.thingName : conflict();
  const operationId = typeof gateway.operationId === 'string' && gateway.operationId ? gateway.operationId : conflict();
  const profileVersionId = typeof gateway.desiredProfileVersionId === 'string' && gateway.desiredProfileVersionId
    ? gateway.desiredProfileVersionId
    : conflict();
  const generation = Number(gateway.generation);
  const desiredGeneration = Number(gateway.desiredGeneration);
  const leaseValue = gateway.dispatchLeaseExpiresAtEpoch;
  const leaseExpiresAtEpoch = Number(leaseValue ?? 0);
  const descriptor = gateway.signedDescriptor;
  if (gateway.state !== 'PROFILE_DELIVERED'
    || gateway.certificateStatus !== 'ACTIVE'
    || !Number.isSafeInteger(generation) || generation < 1
    || desiredGeneration !== generation
    || (leaseValue != null && !Number.isSafeInteger(leaseExpiresAtEpoch))
    || leaseExpiresAtEpoch >= nowEpoch
    || descriptor == null || typeof descriptor !== 'object' || Array.isArray(descriptor)
    || Object.hasOwn(descriptor, 'configurationClaim')) {
    return conflict();
  }
  const signedDescriptor = descriptor as Record<string, unknown>;
  if (signedDescriptor.gatewayId !== gatewayId
    || signedDescriptor.thingName !== thingName
    || Number(signedDescriptor.generation) !== generation
    || signedDescriptor.profileVersionId !== profileVersionId) {
    return conflict();
  }
  if (deployment.entityType !== 'DEPLOYMENT'
    || deployment.gatewayId !== gatewayId
    || Number(deployment.generation) !== generation
    || deployment.profileVersionId !== profileVersionId
    || deployment.operationId !== operationId
    || deployment.status !== 'PROFILE_DELIVERED'
    || deployment.descriptor == null || typeof deployment.descriptor !== 'object' || Array.isArray(deployment.descriptor)
    || canonicalJson(deployment.descriptor) !== canonicalJson(signedDescriptor)) {
    return conflict();
  }
  if (operation.entityType !== 'OPERATION'
    || operation.operationId !== operationId
    || operation.gatewayId !== gatewayId
    || Number(operation.deploymentGeneration) !== generation
    || operation.profileVersionId !== profileVersionId
    || operation.operationStatus !== 'IN_PROGRESS'
    || operation.state !== 'PROFILE_STAGED') {
    return conflict();
  }
  return { descriptor: signedDescriptor, operationId, profileVersionId };
}

async function queryTenantEntityPrefix(
  tenantId: string,
  prefix: string,
  entityType: string,
  maxItems: number,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'entityType = :entityType',
      ExpressionAttributeValues: { ':pk': tenantPk(tenantId), ':prefix': prefix, ':entityType': entityType },
      ExclusiveStartKey: lastKey,
      Limit: Math.min(100, maxItems - items.length),
      ConsistentRead: true,
    }));
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && items.length < maxItems);
  return items;
}

async function recentTenantOperations(tenantId: string, maxItems: number): Promise<Record<string, unknown>[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI3',
    KeyConditionExpression: 'GSI3PK = :pk',
    ExpressionAttributeValues: { ':pk': `${tenantPk(tenantId)}#OPERATION` },
    ScanIndexForward: false,
    Limit: maxItems,
  }));
  return (result.Items ?? []).filter((item) => item.entityType === 'OPERATION');
}

async function operationsById(tenantId: string, operationIds: string[]): Promise<Record<string, unknown>[]> {
  const unique = [...new Set(operationIds)].slice(0, 250);
  const operations: Record<string, unknown>[] = [];
  for (let index = 0; index < unique.length; index += 100) {
    const keys = unique.slice(index, index + 100).map((operationId) => ({ PK: tenantPk(tenantId), SK: operationSk(operationId) }));
    const result = await ddb.send(new BatchGetCommand({
      RequestItems: { [TABLE_NAME]: { Keys: keys, ConsistentRead: true } },
    }));
    operations.push(...(result.Responses?.[TABLE_NAME] ?? []).filter((item) => item.entityType === 'OPERATION'));
    if (Object.keys(result.UnprocessedKeys ?? {}).length > 0) throw new Error('Active operation batch read was throttled');
  }
  return operations;
}

async function profileVersionById(tenantId: string, profileVersionId: string): Promise<Record<string, unknown> | undefined> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK = :tenant',
    ExpressionAttributeValues: { ':pk': `PROFILEVERSION#${profileVersionId}`, ':tenant': tenantPk(tenantId) },
    Limit: 1,
  }));
  return result.Items?.[0];
}

async function existingIdempotency(
  tenantId: string,
  route: string,
  key: string,
  requestHash: string,
): Promise<IdempotencyRecord | undefined> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tenantPk(tenantId), SK: idempotencySk(route, key) },
    ConsistentRead: true,
  }));
  if (!result.Item) return undefined;
  const item = result.Item as IdempotencyRecord;
  if (item.requestHash !== requestHash) throw new ConflictError('Idempotency-Key was already used with a different request');
  return item;
}

function idempotencyItem(
  tenantId: string,
  route: string,
  key: string,
  requestHash: string,
  response: unknown,
  statusCode: number,
) {
  const now = new Date().toISOString();
  return {
    PK: tenantPk(tenantId), SK: idempotencySk(route, key), entityType: 'IDEMPOTENCY', tenantId,
    requestHash, response, statusCode, createdAt: now,
    expiresAtEpoch: Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS,
  };
}

function auditItem(
  context: ReturnType<typeof tenantContext>,
  action: string,
  targetId: string,
  now: string,
  details: Record<string, unknown> = {},
) {
  const auditId = newId('aud');
  return {
    PK: tenantPk(context.tenantId), SK: auditSk(now, auditId), entityType: 'AUDIT', auditId,
    tenantId: context.tenantId, actorSubject: context.subject, actorRole: context.role,
    action, targetId, details, outcome: 'SUCCESS', createdAt: now,
  };
}

async function signAssignmentDescriptor(input: {
  tenantId: string;
  gatewayId: string;
  thingName: string;
  gatewayMetadata: Record<string, unknown>;
  generation: number;
  profileVersion: Record<string, unknown>;
  issuedAt: string;
}) {
  const expiresAt = new Date(Date.parse(input.issuedAt) + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (input.gatewayMetadata.gatewayId !== input.gatewayId || input.gatewayMetadata.thingName !== input.thingName) {
    throw new Error('Gateway configuration metadata does not match the assignment identity');
  }
  const configurationClaim = await signGatewayConfigurationClaim({
    gatewayId: input.gatewayId,
    thingName: input.thingName,
    gatewayMetadataSha256: sha256(canonicalJson(input.gatewayMetadata)),
    generation: input.generation,
    profileVersionId: String(input.profileVersion.profileVersionId),
    profileSha256: String(input.profileVersion.documentHash),
    issuedAt: input.issuedAt,
    expiresAt,
  });
  const signed = await signManifest({
    kind: 'gateway-profile-assignment', tenantId: input.tenantId, gatewayId: input.gatewayId,
    thingName: input.thingName, generation: input.generation,
    profileId: input.profileVersion.profileId, profileVersionId: input.profileVersion.profileVersionId,
    profileVersion: input.profileVersion.version, schemaVersion: input.profileVersion.schemaVersion,
    profileSha256: input.profileVersion.documentHash, objectKey: input.profileVersion.objectKey,
    manifestKey: input.profileVersion.manifestKey, issuedAt: input.issuedAt, expiresAt,
    configurationClaim,
  });
  return { ...signed.manifest, signature: signed.signature, signingAlgorithm: signed.signingAlgorithm };
}

function configurationGatewayMetadata(input: {
  gatewayId: unknown;
  thingName: unknown;
  serialNumber: unknown;
  modelId: unknown;
  hardwareRevision?: unknown;
  siteId: unknown;
}): Record<string, unknown> {
  const required = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || !value) throw new ConflictError(`Gateway ${label} is missing`);
    return value;
  };
  const hardwareRevision = typeof input.hardwareRevision === 'string' && input.hardwareRevision
    ? input.hardwareRevision
    : undefined;
  return {
    gatewayId: required(input.gatewayId, 'ID'),
    thingName: required(input.thingName, 'Thing name'),
    serialNumber: required(input.serialNumber, 'serial number'),
    modelId: required(input.modelId, 'model ID'),
    ...(hardwareRevision ? { hardwareRevision } : {}),
    siteId: required(input.siteId, 'site ID'),
  };
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new InputError(`${label} is required and must not exceed ${maxLength} characters`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > maxLength) throw new InputError(`${label} must not exceed ${maxLength} characters`);
  return value.trim();
}

export function publicGateway(item: Record<string, unknown>) {
  const rawState = String(item.state ?? 'PENDING');
  const state = rawState === 'DECOMMISSIONED' ? 'DECOMMISSIONED'
    : rawState === 'DECOMMISSIONING' ? 'DECOMMISSIONING'
      : rawState === 'QUARANTINED' || rawState === 'RECOVERY_LOCKED' ? 'QUARANTINED'
      : rawState === 'ROLLED_BACK' ? 'ROLLED_BACK'
      : rawState === 'FAILED' ? 'FAILED'
        : ['ACTIVE', 'APPLIED_HEALTHY', 'PROFILE_AVAILABLE', 'PROFILE_DELIVERED', 'APPLYING', 'HEALTH_CHECK'].includes(rawState) ? 'ACTIVE'
          : 'PENDING';
  const rawCertificateStatus = String(item.certificateStatus ?? item.certificateState ?? 'PENDING');
  const certificateState = rawCertificateStatus === 'ACTIVE' ? 'ACTIVE'
    : ['REVOKING', 'DEACTIVATING'].includes(rawCertificateStatus) ? 'DEACTIVATING'
      : ['INACTIVE', 'REVOKED'].includes(rawCertificateStatus) ? 'INACTIVE'
      : 'PENDING';
  const health = ['PROFILE_AVAILABLE', 'PROFILE_DELIVERED', 'APPLYING', 'HEALTH_CHECK'].includes(rawState)
    ? 'APPLYING'
    : item.health ?? (state === 'ACTIVE' ? 'HEALTHY' : state === 'FAILED' ? 'DEGRADED' : 'UNKNOWN');
  return {
    id: item.gatewayId, thingName: item.thingName, serialNumber: item.serialNumber,
    modelId: item.modelId ?? item.model, hardwareRevision: item.hardwareRevision ?? item.hardwareId,
    siteId: item.siteId, state, certificateState, health,
    deploymentGeneration: item.generation ?? 0,
    profileVersionId: item.appliedProfileVersionId,
    desiredProfileVersionId: item.desiredProfileVersionId,
    appliedProfileChecksum: item.appliedProfileChecksum,
    lastSeenAt: item.lastSeenAt, createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}

function publicGatewayModel(item: Record<string, unknown>) {
  return { id: item.modelId, name: item.name, vendor: item.vendor, description: item.description };
}

function publicProfile(item: Record<string, unknown>) {
  return {
    id: item.profileId, profileId: item.profileId, name: item.name, description: item.description,
    currentVersion: item.currentVersion, latestProfileVersionId: item.latestProfileVersionId,
    createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}

function publicProfileVersion(item: Record<string, unknown>) {
  return {
    id: item.profileVersionId, profileVersionId: item.profileVersionId, profileId: item.profileId,
    version: item.version, schemaVersion: item.schemaVersion, sha256: item.documentHash,
    changelog: item.changelog, createdAt: item.createdAt,
  };
}

function publicUiProfileVersion(item: Record<string, unknown>) {
  return {
    id: item.profileVersionId, profileId: item.profileId, name: item.name, description: item.description,
    modelId: item.modelId, version: Number(item.version), schemaVersion: Number(item.schemaVersion),
    parameters: item.parameters ?? {}, contentHash: item.contentHash ?? item.documentHash,
    immutable: true, createdAt: item.createdAt, createdBy: item.createdBy, changeNote: item.changeNote ?? item.changelog ?? '',
  };
}

function publicSite(item: Record<string, unknown>) {
  return { id: item.siteId, siteId: item.siteId, name: item.name, location: item.location, timezone: item.timezone };
}

function publicDeployment(item: Record<string, unknown>) {
  return {
    id: item.deploymentId, deploymentId: item.deploymentId, gatewayId: item.gatewayId,
    generation: item.generation, profileVersionId: item.profileVersionId, status: item.status,
    deliveryMode: item.deliveryMode, createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}
