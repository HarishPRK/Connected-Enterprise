import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  Context,
} from 'aws-lambda';
import type { DeviceConfigurationDependencies } from '../lambda/device-config-http-handler.js';

process.env.TABLE_NAME = 'connected-enterprise-onboarding-unit-test';
process.env.ARTIFACT_BUCKET = 'connected-enterprise-artifacts-unit-test';
process.env.SIGNING_KEY_ID = 'arn:aws:kms:us-east-1:111122223333:key/profile-signing-key';
process.env.AWS_ACCOUNT_ID = '111122223333';
process.env.AWS_REGION = 'us-east-1';
process.env.GATEWAY_CONFIG_ROLE_NAME = 'connected-enterprise-onboarding-dev-gateway-config-pull';

const CERTIFICATE_ID = 'a'.repeat(64);
const THING_NAME = 'gw-device-a';
const TENANT_ID = 'tenant-a';
const GATEWAY_ID = 'gateway-a';
const OPERATION_ID = 'operation-a';
const PROFILE_VERSION_ID = 'pv-1';
const GENERATION = 2;
const TENANT_KEY = `TENANT#${TENANT_ID}`;
const GATEWAY_KEY = `GATEWAY#${GATEWAY_ID}`;
const DEPLOYMENT_KEY = `DEPLOYMENT#${GATEWAY_ID}#${String(GENERATION).padStart(12, '0')}`;
const OPERATION_KEY = `OPERATION#${OPERATION_ID}`;
const SIGNING_KEY_ID = process.env.SIGNING_KEY_ID;

type Item = Record<string, unknown>;

function assignmentDescriptor(): Item {
  return {
    kind: 'gateway-profile-assignment',
    tenantId: TENANT_ID,
    gatewayId: GATEWAY_ID,
    thingName: THING_NAME,
    generation: GENERATION,
    profileId: 'profile-a',
    profileVersionId: PROFILE_VERSION_ID,
    profileVersion: 1,
    schemaVersion: '1.0',
    profileSha256: 'b'.repeat(64),
    objectKey: `tenants/${TENANT_ID}/profiles/profile-a/versions/1/profile.json`,
    manifestKey: `tenants/${TENANT_ID}/profiles/profile-a/versions/1/manifest.json`,
    issuedAt: '2026-08-17T12:00:00.000Z',
    expiresAt: '2099-08-17T12:00:00.000Z',
    signingKeyId: SIGNING_KEY_ID,
    signature: 'AQID',
    signingAlgorithm: 'ECDSA_SHA_256',
  };
}

function records() {
  const descriptor = assignmentDescriptor();
  const gateway: Item = {
    PK: TENANT_KEY,
    SK: GATEWAY_KEY,
    GSI1PK: `THING#${THING_NAME}`,
    GSI1SK: TENANT_KEY,
    entityType: 'GATEWAY',
    tenantId: TENANT_ID,
    gatewayId: GATEWAY_ID,
    thingName: THING_NAME,
    certificateId: CERTIFICATE_ID,
    certificatePrincipal: `arn:aws:iot:us-east-1:111122223333:cert/${CERTIFICATE_ID}`,
    certificateStatus: 'ACTIVE',
    state: 'PROFILE_AVAILABLE',
    desiredGeneration: GENERATION,
    desiredProfileVersionId: PROFILE_VERSION_ID,
    operationId: OPERATION_ID,
    signedDescriptor: descriptor,
  };
  const deployment: Item = {
    PK: TENANT_KEY,
    SK: DEPLOYMENT_KEY,
    entityType: 'DEPLOYMENT',
    tenantId: TENANT_ID,
    gatewayId: GATEWAY_ID,
    generation: GENERATION,
    profileVersionId: PROFILE_VERSION_ID,
    operationId: OPERATION_ID,
    status: 'PROFILE_AVAILABLE',
    descriptor,
  };
  const operation: Item = {
    PK: TENANT_KEY,
    SK: OPERATION_KEY,
    entityType: 'OPERATION',
    tenantId: TENANT_ID,
    operationId: OPERATION_ID,
    gatewayId: GATEWAY_ID,
    profileVersionId: PROFILE_VERSION_ID,
    deploymentGeneration: GENERATION,
    state: 'OPERATIONAL_IDENTITY_ISSUED',
    operationStatus: 'IN_PROGRESS',
  };
  return { descriptor, gateway, deployment, operation };
}

function event(overrides: Partial<APIGatewayProxyEventV2WithIAMAuthorizer> = {}): APIGatewayProxyEventV2WithIAMAuthorizer {
  return {
    version: '2.0',
    routeKey: 'GET /device/v1/things/{thingName}/certificates/{certificateId}/configuration',
    rawPath: `/device/v1/things/${THING_NAME}/certificates/${CERTIFICATE_ID}/configuration`,
    rawQueryString: `generation=${GENERATION}`,
    headers: {},
    requestContext: {
      accountId: '111122223333',
      apiId: 'api-id',
      domainName: 'api.example.test',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: `/device/v1/things/${THING_NAME}/certificates/${CERTIFICATE_ID}/configuration`,
        protocol: 'HTTP/1.1',
        sourceIp: '192.0.2.1',
        userAgent: 'unit-test',
      },
      requestId: 'api-request-1',
      routeKey: 'GET /device/v1/things/{thingName}/certificates/{certificateId}/configuration',
      stage: '$default',
      time: '17/Aug/2026:12:00:00 +0000',
      timeEpoch: 1_787_137_200_000,
      authorizer: {
        iam: {
          accessKey: 'ASIATEST',
          accountId: '111122223333',
          callerId: 'caller-id',
          cognitoIdentity: null,
          principalOrgId: '',
          userArn: 'arn:aws:sts::111122223333:assumed-role/connected-enterprise-onboarding-dev-gateway-config-pull/device-session',
          userId: 'role-id:device-session',
        },
      },
    },
    pathParameters: { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    queryStringParameters: { generation: String(GENERATION) },
    isBase64Encoded: false,
    ...overrides,
  };
}

const context = { awsRequestId: 'lambda-request-1' } as Context;

function fixture(options: {
  mutateGateway?: (gateway: Item) => void;
  mutateDeployment?: (deployment: Item) => void;
  mutateOperation?: (operation: Item) => void;
} = {}) {
  const state = records();
  options.mutateGateway?.(state.gateway);
  options.mutateDeployment?.(state.deployment);
  options.mutateOperation?.(state.operation);
  const items = new Map<string, Item>([
    [`${TENANT_KEY}|${GATEWAY_KEY}`, state.gateway],
    [`${TENANT_KEY}|${DEPLOYMENT_KEY}`, state.deployment],
    [`${TENANT_KEY}|${OPERATION_KEY}`, state.operation],
  ]);
  const transactions: unknown[][] = [];
  const presignedKeys: string[] = [];
  const dependencies: DeviceConfigurationDependencies = {
    async queryGatewayByThing() {
      return [{
        PK: TENANT_KEY,
        SK: GATEWAY_KEY,
        GSI1PK: `THING#${THING_NAME}`,
        entityType: 'GATEWAY',
      }];
    },
    async getItem(key) {
      return items.get(`${key.PK}|${key.SK}`);
    },
    async transactWrite(transaction) {
      transactions.push(transaction);
    },
    async presignArtifact(key) {
      presignedKeys.push(key);
      return `https://artifacts.example.test/${encodeURIComponent(key)}?signature=redacted`;
    },
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  };
  return { dependencies, transactions, presignedKeys, ...state };
}

test('secured device configuration GET returns the existing signed assignment contract', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture();
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['cache-control'], 'no-store');
  assert.equal(response.headers?.['x-request-id'], 'api-request-1');
  const body = JSON.parse(String(response.body)) as Record<string, unknown>;
  assert.equal(body.type, 'SIGNED_PROFILE_ASSIGNMENT');
  assert.equal(body.thingName, THING_NAME);
  assert.equal(body.gatewayId, GATEWAY_ID);
  assert.equal(body.generation, GENERATION);
  assert.equal(body.profileVersionId, PROFILE_VERSION_ID);
  assert.deepEqual(body.descriptor, setup.descriptor);
  assert.deepEqual(setup.presignedKeys, [
    setup.descriptor.objectKey,
    setup.descriptor.manifestKey,
  ]);

  assert.equal(setup.transactions.length, 1);
  const transaction = setup.transactions[0];
  assert.ok(transaction);
  assert.equal(transaction.length, 4, 'gateway, deployment, operation, and audit are committed together');
  const serialized = JSON.stringify(transaction);
  assert.match(serialized, /certificateStatus = :active/);
  assert.match(serialized, /signedDescriptor = :descriptor/);
  assert.match(serialized, /SIGNED_PROFILE_DELIVERED_HTTP/);
});

test('secured device configuration GET requires exact IAM context, path identity, and generation', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture();
  const handler = createDeviceConfigurationHandler(setup.dependencies);

  const missingGeneration = await handler(event({ queryStringParameters: {} }), context);
  assert.equal(missingGeneration.statusCode, 400);
  assert.equal((JSON.parse(String(missingGeneration.body)) as { code: string }).code, 'INVALID_REQUEST');

  const missingIam = event();
  // The cast builds a deliberately malformed API Gateway event for the fail-closed test.
  (missingIam.requestContext as { authorizer?: unknown }).authorizer = undefined;
  const unauthorized = await handler(missingIam, context);
  assert.equal(unauthorized.statusCode, 403);
  assert.equal((JSON.parse(String(unauthorized.body)) as { code: string }).code, 'DEVICE_NOT_AUTHORIZED');

  const wrongRole = event();
  const wrongRoleIam = wrongRole.requestContext.authorizer.iam;
  wrongRoleIam.userArn = 'arn:aws:sts::111122223333:assumed-role/unrelated-admin-role/device-session';
  const wrongRoleResponse = await handler(wrongRole, context);
  assert.equal(wrongRoleResponse.statusCode, 403);
  assert.equal((JSON.parse(String(wrongRoleResponse.body)) as { code: string }).code, 'DEVICE_NOT_AUTHORIZED');

  assert.deepEqual(setup.presignedKeys, []);
  assert.deepEqual(setup.transactions, []);
});

test('secured device configuration GET rejects duplicate and unknown query parameters', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture();
  const handler = createDeviceConfigurationHandler(setup.dependencies);

  const duplicate = await handler(event({
    rawQueryString: `generation=${GENERATION}&generation=${GENERATION}`,
    queryStringParameters: { generation: `${GENERATION},${GENERATION}` },
  }), context);
  assert.equal(duplicate.statusCode, 400);

  const unknown = await handler(event({
    rawQueryString: `generation=${GENERATION}&debug=true`,
    queryStringParameters: { generation: String(GENERATION), debug: 'true' },
  }), context);
  assert.equal(unknown.statusCode, 400);
  assert.deepEqual(setup.presignedKeys, []);
  assert.deepEqual(setup.transactions, []);
});

test('secured device configuration GET reauthorizes against the consistent gateway record', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture({
    mutateGateway: (gateway) => {
      gateway.certificateStatus = 'INACTIVE';
      gateway.state = 'DECOMMISSIONED';
    },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 403);
  const body = JSON.parse(String(response.body)) as { code: string; error: string };
  assert.equal(body.code, 'DEVICE_NOT_AUTHORIZED');
  assert.equal(body.error, 'Device is not authorized');
  assert.deepEqual(setup.presignedKeys, []);
  assert.deepEqual(setup.transactions, []);
});

test('secured device configuration GET rejects inconsistent deployment authority before signing URLs', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture({
    mutateDeployment: (deployment) => {
      deployment.profileVersionId = 'pv-attacker';
    },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 409);
  const body = JSON.parse(String(response.body)) as { code: string; error: string };
  assert.equal(body.code, 'CONFIGURATION_NOT_AVAILABLE');
  assert.equal(body.error, 'Configuration is not available');
  assert.deepEqual(setup.presignedKeys, []);
  assert.deepEqual(setup.transactions, []);
});

test('an applied healthy gateway may repeat a pull read-only without regressing operation state', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture({
    mutateGateway: (gateway) => {
      gateway.state = 'APPLIED_HEALTHY';
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'APPLIED_HEALTHY';
    },
    mutateOperation: (operation) => {
      operation.state = 'APPLIED_HEALTHY';
      operation.operationStatus = 'SUCCEEDED';
    },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(setup.transactions, [], 'unchanged-generation repeat pulls do not amplify DDB writes or audits');
});
