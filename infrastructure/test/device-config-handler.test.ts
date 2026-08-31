import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const SERIAL_NUMBER = 'SNA8C2463D4248';
const BOOTSTRAP_CERTIFICATE_ID = 'c'.repeat(64);
const TENANT_KEY = `TENANT#${TENANT_ID}`;
const GATEWAY_KEY = `GATEWAY#${GATEWAY_ID}`;
const DEPLOYMENT_KEY = `DEPLOYMENT#${GATEWAY_ID}#${String(GENERATION).padStart(12, '0')}`;
const OPERATION_KEY = `OPERATION#${OPERATION_ID}`;
const MANUFACTURING_KEY = `SERIAL#${SERIAL_NUMBER}`;
const BOOTSTRAP_BINDING_KEY = `BOOTSTRAPCERT#${BOOTSTRAP_CERTIFICATE_ID}`;
const SIGNING_KEY_ID = process.env.SIGNING_KEY_ID;
const PROFILE_DOCUMENT = {
  schemaVersion: 1,
  modelId: 'ce-gateway-v1',
  parameters: {
    dnsCacheEntries: 1000,
    dnsTcpEnabled: true,
    lanIpAddress: '10.10.10.1',
    lanPrefixLength: 24,
    wanMtu: 1500,
  },
};
const PROFILE_CANONICAL = '{"modelId":"ce-gateway-v1","parameters":{"dnsCacheEntries":1000,"dnsTcpEnabled":true,"lanIpAddress":"10.10.10.1","lanPrefixLength":24,"wanMtu":1500},"schemaVersion":1}';
const PROFILE_BYTES = Buffer.from(PROFILE_CANONICAL);
const PROFILE_SHA256 = createHash('sha256').update(PROFILE_BYTES).digest('hex');
const CONTROLLER_UPDATED_AT = '2026-08-17T11:30:00.000Z';
const OLD_CONTROLLER_UPDATED_AT = '2026-08-16T11:30:00.000Z';
const CONTROLLER_REVISION = `controller_${'b'.repeat(32)}`;
const OLD_CONTROLLER_REVISION = `controller_${'a'.repeat(32)}`;
const UPDATED_CONTROLLER_REVISION = `controller_${'c'.repeat(32)}`;
const CONTROLLER_RESPONSE_BODY = '{"usp":{"controller_endpoint_id":"proto::Controller-ip-172-31-2-12","mtp":"MQTT","mqtt":{"broker":"broker.hivemq.com","port":1883,"protocol_version":"5.0","transport":"TCP/IP","controller_topic":"controller/proto::Controller-ip-172-31-2-12"}}}';
const CONTROLLER_CONFIGURATION = JSON.parse(CONTROLLER_RESPONSE_BODY) as Item;
const CONTROLLER_CONFIGURATION_SHA256 = createHash('sha256')
  .update(CONTROLLER_RESPONSE_BODY)
  .digest('hex');
const UPDATED_CONTROLLER_RESPONSE_BODY = '{"usp":{"controller_endpoint_id":"proto::Controller-ip-172-31-2-13","mtp":"MQTT","mqtt":{"broker":"broker.hivemq.com","port":1883,"protocol_version":"5.0","transport":"TCP/IP","controller_topic":"controller/proto::Controller-ip-172-31-2-13"}}}';
const UPDATED_CONTROLLER_CONFIGURATION = JSON.parse(UPDATED_CONTROLLER_RESPONSE_BODY) as Item;
const UPDATED_CONTROLLER_CONFIGURATION_SHA256 = createHash('sha256')
  .update(UPDATED_CONTROLLER_RESPONSE_BODY)
  .digest('hex');
const GATEWAY_METADATA = {
  gatewayId: GATEWAY_ID,
  thingName: THING_NAME,
  serialNumber: SERIAL_NUMBER,
  modelId: 'ce-gateway-v1',
  hardwareRevision: 'rev-a',
  siteId: 'site-a',
};
const GATEWAY_METADATA_CANONICAL = `{"gatewayId":"${GATEWAY_ID}","hardwareRevision":"rev-a","modelId":"ce-gateway-v1","serialNumber":"${SERIAL_NUMBER}","siteId":"site-a","thingName":"${THING_NAME}"}`;
const GATEWAY_METADATA_SHA256 = createHash('sha256').update(GATEWAY_METADATA_CANONICAL).digest('hex');

type Item = Record<string, unknown>;

function operationSteps(): Item[] {
  return [
    { key: 'ownership', label: 'Ownership verified', status: 'complete' },
    {
      key: 'identity',
      label: 'Permanent identity provisioned',
      status: 'complete',
      detail: 'Permanent certificate authenticated by AWS IoT credentials provider.',
      timestamp: '2026-08-17T11:59:00.000Z',
    },
    { key: 'profile', label: 'Signed profile delivered', status: 'pending' },
    { key: 'apply', label: 'Profile applied transactionally', status: 'pending' },
    { key: 'health', label: 'Connectivity and service health validated', status: 'pending' },
  ];
}

function operationTimeline(): Item[] {
  return [
    {
      state: 'CLAIM_ACCEPTED',
      at: '2026-08-17T11:57:00.000Z',
      detail: 'An authenticated operator reserved the tenant-bound serial inventory record.',
    },
    {
      state: 'CSR_VERIFIED',
      at: '2026-08-17T11:58:00.000Z',
      detail: 'The operational certificate request and reserved serial were accepted.',
    },
    {
      state: 'OPERATIONAL_IDENTITY_ISSUED',
      at: '2026-08-17T11:59:00.000Z',
      detail: 'Permanent certificate authenticated by AWS IoT credentials provider.',
    },
  ];
}

function assertExactExpressionBindings(transaction: unknown[]): void {
  transaction.forEach((action, index) => {
    const statement = (action as {
      Update?: {
        UpdateExpression?: string;
        ConditionExpression?: string;
        ExpressionAttributeNames?: Record<string, string>;
        ExpressionAttributeValues?: Record<string, unknown>;
      };
      ConditionCheck?: {
        ConditionExpression?: string;
        ExpressionAttributeNames?: Record<string, string>;
        ExpressionAttributeValues?: Record<string, unknown>;
      };
    }).Update ?? (action as {
      ConditionCheck?: {
        ConditionExpression?: string;
        ExpressionAttributeNames?: Record<string, string>;
        ExpressionAttributeValues?: Record<string, unknown>;
      };
    }).ConditionCheck;
    if (!statement) return;
    const expression = `${'UpdateExpression' in statement ? statement.UpdateExpression ?? '' : ''} ${statement.ConditionExpression ?? ''}`;
    const referencedValues = [...new Set(expression.match(/:[A-Za-z0-9_]+/g) ?? [])].sort();
    const suppliedValues = Object.keys(statement.ExpressionAttributeValues ?? {}).sort();
    assert.deepEqual(
      suppliedValues,
      referencedValues,
      `transaction update ${index} must supply every value token exactly once and no unused values`,
    );
    const referencedNames = [...new Set(expression.match(/#[A-Za-z0-9_]+/g) ?? [])].sort();
    const suppliedNames = Object.keys(statement.ExpressionAttributeNames ?? {}).sort();
    assert.deepEqual(
      suppliedNames,
      referencedNames,
      `transaction update ${index} must supply every name token exactly once and no unused names`,
    );
  });
}

function assignmentDescriptor(): Item {
  const descriptor: Item = {
    kind: 'gateway-profile-assignment',
    tenantId: TENANT_ID,
    gatewayId: GATEWAY_ID,
    thingName: THING_NAME,
    generation: GENERATION,
    profileId: 'profile-a',
    profileVersionId: PROFILE_VERSION_ID,
    profileVersion: 1,
    schemaVersion: 1,
    profileSha256: PROFILE_SHA256,
    objectKey: `tenants/${TENANT_ID}/profiles/profile-a/versions/1/profile.json`,
    manifestKey: `tenants/${TENANT_ID}/profiles/profile-a/versions/1/manifest.json`,
    issuedAt: '2026-08-17T12:00:00.000Z',
    expiresAt: '2099-08-17T12:00:00.000Z',
    signingKeyId: SIGNING_KEY_ID,
    signature: 'AQID',
    signingAlgorithm: 'ECDSA_SHA_256',
  };
  descriptor.configurationClaim = configurationClaim();
  return descriptor;
}

function configurationClaim(overrides: Item = {}): Item {
  return {
    kind: 'gateway-configuration-claim',
    claimVersion: 1,
    gatewayId: GATEWAY_ID,
    thingName: THING_NAME,
    gatewayMetadataSha256: GATEWAY_METADATA_SHA256,
    generation: GENERATION,
    profileVersionId: PROFILE_VERSION_ID,
    profileSha256: PROFILE_SHA256,
    issuedAt: '2026-08-17T12:00:00.000Z',
    expiresAt: '2099-08-17T12:00:00.000Z',
    signingKeyId: SIGNING_KEY_ID,
    signature: 'AQID',
    signingAlgorithm: 'ECDSA_SHA_256',
    ...overrides,
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
    serialNumber: SERIAL_NUMBER,
    thingName: THING_NAME,
    modelId: 'ce-gateway-v1',
    hardwareRevision: 'rev-a',
    siteId: 'site-a',
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
    type: 'ONBOARD',
    gatewayId: GATEWAY_ID,
    profileVersionId: PROFILE_VERSION_ID,
    deploymentGeneration: GENERATION,
    state: 'OPERATIONAL_IDENTITY_ISSUED',
    operationStatus: 'IN_PROGRESS',
    steps: operationSteps(),
    timeline: operationTimeline(),
  };
  return { descriptor, gateway, deployment, operation };
}

function controllerRecord(overrides: Item = {}): Item {
  return {
    PK: TENANT_KEY,
    SK: 'CONTROLLER',
    entityType: 'CONTROLLER_CONFIGURATION',
    tenantId: TENANT_ID,
    configuration: CONTROLLER_CONFIGURATION,
    configurationBody: CONTROLLER_RESPONSE_BODY,
    configurationChecksum: CONTROLLER_CONFIGURATION_SHA256,
    revision: CONTROLLER_REVISION,
    updatedAt: CONTROLLER_UPDATED_AT,
    updatedBy: 'admin-a',
    ...overrides,
  };
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
  firstUse?: boolean;
  profileArtifact?: Uint8Array;
  controller?: Item;
  mutateDescriptor?: (descriptor: Item) => void;
  mutateGateway?: (gateway: Item) => void;
  mutateDeployment?: (deployment: Item) => void;
  mutateOperation?: (operation: Item) => void;
  mutateManufacturing?: (manufacturing: Item) => void;
  mutateBootstrapBinding?: (bootstrapBinding: Item) => void;
} = {}) {
  const state = records();
  const manufacturing: Item = {
    PK: MANUFACTURING_KEY,
    SK: 'MANUFACTURING',
    entityType: 'MANUFACTURING',
    state: 'PROVISIONING',
    tenantId: TENANT_ID,
    gatewayId: GATEWAY_ID,
    operationId: OPERATION_ID,
    serialNumber: SERIAL_NUMBER,
    thingName: THING_NAME,
    certificateId: CERTIFICATE_ID,
    certificatePrincipal: `arn:aws:iot:us-east-1:111122223333:cert/${CERTIFICATE_ID}`,
    certificateStatus: 'PENDING_ACTIVATION',
    claimMechanism: 'PRELOADED_UNIQUE_BOOTSTRAP',
    bootstrapCertificateId: BOOTSTRAP_CERTIFICATE_ID,
    bootstrapCertificateStatus: 'ACTIVE',
  };
  const bootstrapBinding: Item = {
    PK: BOOTSTRAP_BINDING_KEY,
    SK: 'BINDING',
    entityType: 'BOOTSTRAP_CERTIFICATE_BINDING',
    bootstrapCertificateId: BOOTSTRAP_CERTIFICATE_ID,
    serialNumber: SERIAL_NUMBER,
    tenantId: TENANT_ID,
    status: 'ACTIVE',
  };
  if (options.firstUse) {
    state.gateway.state = 'IDENTITY_PROVISIONING';
    state.gateway.certificateStatus = 'PENDING_ACTIVATION';
    state.deployment.status = 'WAITING_FOR_DEVICE';
    state.operation.state = 'CSR_VERIFIED';
    (state.operation.steps as Item[])[1] = {
      key: 'identity',
      label: 'Permanent identity provisioned',
      status: 'in_progress',
      detail: 'Certificate registered; waiting for the permanent mTLS reconnect.',
      timestamp: '2026-08-17T11:58:00.000Z',
    };
    state.operation.timeline = operationTimeline().slice(0, 2);
  }
  options.mutateDescriptor?.(state.descriptor);
  options.mutateGateway?.(state.gateway);
  options.mutateDeployment?.(state.deployment);
  options.mutateOperation?.(state.operation);
  options.mutateManufacturing?.(manufacturing);
  options.mutateBootstrapBinding?.(bootstrapBinding);
  const items = new Map<string, Item>([
    [`${TENANT_KEY}|${GATEWAY_KEY}`, state.gateway],
    [`${TENANT_KEY}|${DEPLOYMENT_KEY}`, state.deployment],
    [`${TENANT_KEY}|${OPERATION_KEY}`, state.operation],
  ]);
  if (options.controller) items.set(`${TENANT_KEY}|CONTROLLER`, options.controller);
  if (options.firstUse) {
    items.set(`${MANUFACTURING_KEY}|MANUFACTURING`, manufacturing);
    items.set(`${BOOTSTRAP_BINDING_KEY}|BINDING`, bootstrapBinding);
  }
  const transactions: unknown[][] = [];
  const loadedProfileKeys: string[] = [];
  const callOrder: string[] = [];
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
      const serialized = JSON.stringify(transaction);
      if (serialized.includes('DEACTIVATE_BOOTSTRAP_CERTIFICATE')) {
        callOrder.push('finalize-identity');
        state.gateway.state = 'PERMANENT_IDENTITY_ACTIVE';
        state.gateway.certificateStatus = 'ACTIVE';
        state.operation.state = 'OPERATIONAL_IDENTITY_ISSUED';
        manufacturing.state = 'PROVISIONED';
        manufacturing.certificateStatus = 'ACTIVE';
        manufacturing.bootstrapCertificateStatus = 'DEACTIVATING';
        bootstrapBinding.status = 'DEACTIVATING';
      } else {
        callOrder.push('record-delivery');
      }
    },
    async loadProfileArtifact(key) {
      loadedProfileKeys.push(key);
      callOrder.push(`load-profile:${key}`);
      return options.profileArtifact ?? PROFILE_BYTES;
    },
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  };
  return {
    dependencies,
    transactions,
    loadedProfileKeys,
    callOrder,
    manufacturing,
    bootstrapBinding,
    ...state,
  };
}

test('secured device configuration GET returns only device-ready gateway and profile JSON', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture();
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['cache-control'], 'no-store');
  assert.equal(response.headers?.['x-request-id'], 'api-request-1');
  assert.equal(response.headers?.['x-ce-configuration-source'], 'S3');
  assert.equal(response.headers?.['x-ce-generation'], String(GENERATION));
  assert.equal(response.headers?.['x-ce-profile-version-id'], PROFILE_VERSION_ID);
  const body = JSON.parse(String(response.body)) as Record<string, unknown>;
  assert.equal(body.type, 'GATEWAY_CONFIGURATION');
  assert.equal(body.responseVersion, 1);
  assert.deepEqual(body.gateway, GATEWAY_METADATA);
  assert.deepEqual(body.assignment, {
    generation: GENERATION,
    profileId: 'profile-a',
    profileVersionId: PROFILE_VERSION_ID,
    profileVersion: 1,
    schemaVersion: 1,
    profileChecksum: PROFILE_SHA256,
  });
  assert.deepEqual(body.configuration, PROFILE_DOCUMENT);
  assert.deepEqual(body.integrity, configurationClaim());
  assert.deepEqual(setup.loadedProfileKeys, [setup.descriptor.objectKey]);

  const serializedBody = JSON.stringify(body);
  assert.doesNotMatch(serializedBody, /tenantId|certificateId|certificatePrincipal|operationId|objectKey|manifestKey|artifacts|presigned/i);

  assert.equal(setup.transactions.length, 1);
  const transaction = setup.transactions[0];
  assert.ok(transaction);
  assert.equal(transaction.length, 5,
    'gateway, deployment, operation, Controller-absence fence, and audit are committed together');
  const deploymentUpdate = (transaction[1] as {
    Update?: {
      ConditionExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
    };
  }).Update;
  assert.ok(deploymentUpdate);
  assert.match(
    deploymentUpdate.ConditionExpression ?? '',
    /(?:^| AND )#descriptor = :descriptor(?: AND|$)/,
  );
  assert.equal(deploymentUpdate.ExpressionAttributeNames?.['#descriptor'], 'descriptor');
  const serialized = JSON.stringify(transaction);
  assert.match(serialized, /certificateStatus = :active/);
  assert.match(serialized, /signedDescriptor = :descriptor/);
  assert.match(serialized, /SIGNED_PROFILE_DELIVERED_HTTP/);
  const controllerAbsenceFence = (transaction[3] as {
    ConditionCheck?: { Key?: Item; ConditionExpression?: string };
  }).ConditionCheck;
  assert.deepEqual(controllerAbsenceFence?.Key, { PK: TENANT_KEY, SK: 'CONTROLLER' });
  assert.equal(controllerAbsenceFence?.ConditionExpression, 'attribute_not_exists(PK)');
  assertExactExpressionBindings(transaction);

  const operationUpdate = (transaction[2] as {
    Update?: {
      UpdateExpression?: string;
      ConditionExpression?: string;
      ExpressionAttributeValues?: Record<string, unknown>;
    };
  }).Update;
  assert.ok(operationUpdate);
  assert.doesNotMatch(operationUpdate.UpdateExpression ?? '', /steps\[|list_append/);
  assert.match(operationUpdate.UpdateExpression ?? '', /#steps = :nextSteps/);
  assert.match(operationUpdate.UpdateExpression ?? '', /#timeline = :nextTimeline/);
  assert.match(operationUpdate.ConditionExpression ?? '', /operationId = :operationId/);
  assert.match(operationUpdate.ConditionExpression ?? '', /deploymentGeneration = :generation/);
  assert.match(operationUpdate.ConditionExpression ?? '', /operationStatus = :observedOperationStatus/);
  assert.match(operationUpdate.ConditionExpression ?? '', /#steps = :observedSteps/);
  assert.match(operationUpdate.ConditionExpression ?? '', /#timeline = :observedTimeline/);
  assert.deepEqual(operationUpdate.ExpressionAttributeValues?.[':observedSteps'], setup.operation.steps);
  assert.deepEqual(operationUpdate.ExpressionAttributeValues?.[':observedTimeline'], setup.operation.timeline);
});

test('configured controller returns its JSON object as the exact top-level device response', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture({ controller: controllerRecord() });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['content-type'], 'application/json; charset=utf-8');
  assert.equal(response.headers?.['cache-control'], 'no-store');
  assert.equal(response.headers?.['x-ce-configuration-source'], 'CONTROLLER');
  assert.equal(response.headers?.['x-ce-confirmation-method'], 'AUTHENTICATED_CONFIGURATION_PULL');
  assert.equal(response.headers?.['x-ce-generation'], String(GENERATION));
  assert.equal(response.headers?.['x-ce-profile-version-id'], PROFILE_VERSION_ID);
  assert.equal(response.body, CONTROLLER_RESPONSE_BODY,
    'the representative Controller payload formatting and key order are preserved byte-for-byte');
  const body = JSON.parse(String(response.body)) as Item;
  for (const controlPlaneField of [
    'type',
    'responseVersion',
    'requestId',
    'gateway',
    'assignment',
    'configuration',
    'source',
    'integrity',
    'configurationChecksum',
  ]) assert.equal(body[controlPlaneField], undefined, `${controlPlaneField} is not injected into controller JSON`);
  assert.deepEqual(setup.loadedProfileKeys, [], 'the controller path does not read the S3 profile object');

  assert.equal(setup.transactions.length, 1);
  const transaction = setup.transactions[0];
  assert.ok(transaction);
  assert.equal(transaction.length, 5,
    'gateway, deployment, operation, controller revision fence, and audit commit atomically');
  assertExactExpressionBindings(transaction);
  const controllerFence = (transaction[3] as {
    ConditionCheck?: { Key?: Item; ConditionExpression?: string; ExpressionAttributeValues?: Item };
  }).ConditionCheck;
  assert.deepEqual(controllerFence?.Key, { PK: TENANT_KEY, SK: 'CONTROLLER' });
  assert.match(String(controllerFence?.ConditionExpression), /configurationBody = :controllerBody/);
  assert.match(String(controllerFence?.ConditionExpression), /configurationChecksum = :controllerChecksum/);
  assert.match(String(controllerFence?.ConditionExpression), /revision = :controllerRevision/);
  assert.equal(controllerFence?.ExpressionAttributeValues?.[':controllerBody'], CONTROLLER_RESPONSE_BODY);
  assert.equal(controllerFence?.ExpressionAttributeValues?.[':controllerChecksum'], CONTROLLER_CONFIGURATION_SHA256);
  assert.equal(controllerFence?.ExpressionAttributeValues?.[':controllerRevision'], CONTROLLER_REVISION);
  const serializedTransaction = JSON.stringify(transaction);
  assert.match(serializedTransaction, /CONTROLLER_CONFIGURATION_PULL_CONFIRMED/);
  assert.match(serializedTransaction, /AUTHENTICATED_CONFIGURATION_PULL/);
  assert.match(serializedTransaction, /"deviceApplyReported":false/);
  assert.match(serializedTransaction, /"deviceHealthReported":false/);
  assert.match(serializedTransaction, new RegExp(CONTROLLER_CONFIGURATION_SHA256));
  const gatewayValues = (transaction[0] as {
    Update?: { ExpressionAttributeValues?: Item };
  }).Update?.ExpressionAttributeValues;
  assert.equal(gatewayValues?.[':configurationChecksum'], CONTROLLER_CONFIGURATION_SHA256,
    'the recorded authority hashes the exact raw body returned to the gateway');
  assert.equal(gatewayValues?.[':controllerRevision'], CONTROLLER_REVISION);
  assert.equal(gatewayValues?.[':appliedHealthy'], 'APPLIED_HEALTHY');
  assert.equal(gatewayValues?.[':pullConfirmedHealth'], 'UNKNOWN');
  assert.equal(gatewayValues?.[':pullConfirmationMethod'], 'AUTHENTICATED_CONFIGURATION_PULL');
  const deploymentValues = (transaction[1] as {
    Update?: { ExpressionAttributeValues?: Item };
  }).Update?.ExpressionAttributeValues;
  assert.equal(deploymentValues?.[':appliedHealthy'], 'APPLIED_HEALTHY');
  assert.equal(deploymentValues?.[':pullConfirmationMethod'], 'AUTHENTICATED_CONFIGURATION_PULL');
  const operationValues = (transaction[2] as {
    Update?: { ExpressionAttributeValues?: Item };
  }).Update?.ExpressionAttributeValues;
  assert.equal(operationValues?.[':nextOperationState'], 'APPLIED_HEALTHY');
  assert.equal(operationValues?.[':nextOperationStatus'], 'SUCCEEDED');
  assert.equal(operationValues?.[':configurationSource'], 'CONTROLLER');
  assert.equal(operationValues?.[':pullConfirmationMethod'], 'AUTHENTICATED_CONFIGURATION_PULL');
  const nextSteps = operationValues?.[':nextSteps'] as Item[];
  assert.equal(nextSteps[2]?.status, 'complete');
  assert.equal(nextSteps[3]?.status, 'complete');
  assert.equal(nextSteps[4]?.status, 'pending', 'pull confirmation does not invent a health report');
  const nextTimeline = operationValues?.[':nextTimeline'] as Item[];
  assert.equal(nextTimeline.at(-1)?.state, 'APPLIED_HEALTHY');
  assert.match(String(nextTimeline.at(-1)?.detail), /Apply and health were not reported separately/);
  assert.doesNotMatch(String(nextTimeline.at(-1)?.detail), /passed health|health-validated|gateway reported/i);
});

test('a staged profile deployment becomes pull-confirmed when its Controller generation is retrieved', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture({
    controller: controllerRecord(),
    mutateOperation: (operation) => {
      operation.type = 'PROFILE_DEPLOY';
      operation.state = 'PROFILE_STAGED';
      operation.timeline = [{
        state: 'PROFILE_STAGED',
        at: '2026-08-17T11:59:00.000Z',
        detail: `Signed profile generation ${GENERATION} is queued for delivery.`,
      }];
      const steps = operation.steps as Item[];
      steps[2] = {
        key: 'profile',
        label: 'Signed profile delivered',
        status: 'in_progress',
        detail: 'Signed descriptor is queued for delivery.',
        timestamp: '2026-08-17T11:59:00.000Z',
      };
    },
  });

  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, CONTROLLER_RESPONSE_BODY);
  assert.equal(setup.transactions.length, 1);
  const transaction = setup.transactions[0];
  assert.equal(transaction?.length, 5,
    'gateway, deployment, operation, Controller fence, and audit become consistent atomically');
  assertExactExpressionBindings(transaction ?? []);
  const operationValues = (transaction?.[2] as {
    Update?: { ExpressionAttributeValues?: Item };
  }).Update?.ExpressionAttributeValues;
  assert.equal(operationValues?.[':observedState'], 'PROFILE_STAGED');
  assert.equal(operationValues?.[':nextOperationState'], 'APPLIED_HEALTHY');
  assert.equal(operationValues?.[':nextOperationStatus'], 'SUCCEEDED');
  assert.equal(operationValues?.[':pullConfirmationMethod'], 'AUTHENTICATED_CONFIGURATION_PULL');
  assert.match(JSON.stringify(transaction), /CONTROLLER_CONFIGURATION_PULL_CONFIRMED/);
});

test('corrupt stored Controller documents fail closed without falling back to S3', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  for (const controller of [
    controllerRecord({ configurationBody: '{"tampered":true}' }),
    controllerRecord({ configurationChecksum: 'f'.repeat(64) }),
    controllerRecord({ revision: 0 }),
    controllerRecord({ configuration: { usp: { mtp: 'HTTP' } } }),
  ]) {
    const setup = fixture({ controller });
    const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
    assert.equal(response.statusCode, 409);
    assert.equal((JSON.parse(String(response.body)) as Item).code, 'CONFIGURATION_NOT_AVAILABLE');
    assert.deepEqual(setup.loadedProfileKeys, []);
    assert.deepEqual(setup.transactions, []);
  }
});

test('saving a controller immediately replaces a same-generation S3 delivery under exact fences', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const recordS3Delivery = (item: Item) => {
    item.configurationSource = 'S3';
    item.deliveredConfigurationGeneration = GENERATION;
    item.deliveredConfigurationChecksum = PROFILE_SHA256;
  };
  const setup = fixture({
    controller: controllerRecord(),
    mutateGateway: (gateway) => {
      gateway.state = 'PROFILE_DELIVERED';
      recordS3Delivery(gateway);
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'PROFILE_DELIVERED';
      recordS3Delivery(deployment);
    },
    mutateOperation: (operation) => { operation.state = 'PROFILE_STAGED'; },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, CONTROLLER_RESPONSE_BODY);
  assert.deepEqual(setup.loadedProfileKeys, []);
  const transaction = setup.transactions[0];
  assert.ok(transaction);
  assert.equal(transaction.length, 5, 'gateway, deployment, operation, controller fence, and audit switch atomically');
  assertExactExpressionBindings(transaction);
  for (const action of transaction.slice(0, 2)) {
    const update = (action as {
      Update?: { ConditionExpression?: string; ExpressionAttributeValues?: Item };
    }).Update;
    assert.match(String(update?.ConditionExpression), /ObservedConfigurationSource/);
    assert.ok(Object.values(update?.ExpressionAttributeValues ?? {}).includes('S3'));
    assert.ok(Object.values(update?.ExpressionAttributeValues ?? {}).includes(PROFILE_SHA256));
    assert.equal(update?.ExpressionAttributeValues?.[':configurationSource'], 'CONTROLLER');
    assert.equal(update?.ExpressionAttributeValues?.[':configurationChecksum'], CONTROLLER_CONFIGURATION_SHA256);
  }
});

test('an explicit saved configuration revision immediately replaces an older same-generation controller delivery', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const oldPayloadChecksum = 'e'.repeat(64);
  const recordOldControllerDelivery = (item: Item) => {
    item.configurationSource = 'CONTROLLER';
    item.deliveredConfigurationGeneration = GENERATION;
    item.deliveredConfigurationChecksum = oldPayloadChecksum;
    item.controllerConfigurationRevision = OLD_CONTROLLER_REVISION;
    item.controllerConfigurationUpdatedAt = OLD_CONTROLLER_UPDATED_AT;
  };
  const setup = fixture({
    controller: controllerRecord(),
    mutateGateway: (gateway) => {
      gateway.state = 'PROFILE_DELIVERED';
      recordOldControllerDelivery(gateway);
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'PROFILE_DELIVERED';
      recordOldControllerDelivery(deployment);
    },
    mutateOperation: (operation) => { operation.state = 'PROFILE_STAGED'; },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, CONTROLLER_RESPONSE_BODY);
  const transaction = setup.transactions[0];
  assert.ok(transaction);
  assert.equal(transaction.length, 5);
  assertExactExpressionBindings(transaction);
  for (const action of transaction.slice(0, 2)) {
    const values = (action as { Update?: { ExpressionAttributeValues?: Item } })
      .Update?.ExpressionAttributeValues ?? {};
    assert.ok(Object.values(values).includes(oldPayloadChecksum));
    assert.ok(Object.values(values).includes(OLD_CONTROLLER_REVISION));
    assert.ok(Object.values(values).includes(OLD_CONTROLLER_UPDATED_AT));
    assert.equal(values[':controllerRevision'], CONTROLLER_REVISION);
    assert.equal(values[':controllerUpdatedAt'], CONTROLLER_UPDATED_AT);
    assert.equal(values[':configurationChecksum'], CONTROLLER_CONFIGURATION_SHA256);
  }
});

test('controller source transitions are rejected once apply has started', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const cases = [
    {
      label: 'S3 to Controller after apply succeeded',
      gatewayState: 'APPLIED_HEALTHY',
      deploymentState: 'APPLIED_HEALTHY',
      operationState: 'APPLIED_HEALTHY',
      operationStatus: 'SUCCEEDED',
      recordDelivery(item: Item) {
        item.configurationSource = 'S3';
        item.deliveredConfigurationGeneration = GENERATION;
        item.deliveredConfigurationChecksum = PROFILE_SHA256;
      },
    },
    {
      label: 'Controller revision change while applying',
      gatewayState: 'APPLYING',
      deploymentState: 'APPLYING',
      operationState: 'APPLYING',
      operationStatus: 'IN_PROGRESS',
      recordDelivery(item: Item) {
        item.configurationSource = 'CONTROLLER';
        item.deliveredConfigurationGeneration = GENERATION;
        item.deliveredConfigurationChecksum = 'e'.repeat(64);
        item.controllerConfigurationRevision = OLD_CONTROLLER_REVISION;
        item.controllerConfigurationUpdatedAt = OLD_CONTROLLER_UPDATED_AT;
      },
    },
  ];

  for (const blocked of cases) {
    const setup = fixture({
      controller: controllerRecord(),
      mutateGateway: (gateway) => {
        gateway.state = blocked.gatewayState;
        blocked.recordDelivery(gateway);
      },
      mutateDeployment: (deployment) => {
        deployment.status = blocked.deploymentState;
        blocked.recordDelivery(deployment);
      },
      mutateOperation: (operation) => {
        operation.state = blocked.operationState;
        operation.operationStatus = blocked.operationStatus;
      },
    });
    const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

    assert.equal(response.statusCode, 409, blocked.label);
    assert.equal((JSON.parse(String(response.body)) as Item).code, 'CONFIGURATION_NOT_AVAILABLE');
    assert.deepEqual(setup.loadedProfileKeys, [], blocked.label);
    assert.deepEqual(setup.transactions, [], blocked.label);
  }
});

test('same controller revision remains a read-only pull after apply is healthy', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const recordControllerDelivery = (item: Item) => {
    item.configurationSource = 'CONTROLLER';
    item.deliveredConfigurationGeneration = GENERATION;
    item.deliveredConfigurationChecksum = CONTROLLER_CONFIGURATION_SHA256;
    item.controllerConfigurationRevision = CONTROLLER_REVISION;
    item.controllerConfigurationUpdatedAt = CONTROLLER_UPDATED_AT;
  };
  const setup = fixture({
    controller: controllerRecord(),
    mutateGateway: (gateway) => {
      gateway.state = 'APPLIED_HEALTHY';
      recordControllerDelivery(gateway);
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'APPLIED_HEALTHY';
      recordControllerDelivery(deployment);
    },
    mutateOperation: (operation) => {
      operation.state = 'APPLIED_HEALTHY';
      operation.operationStatus = 'SUCCEEDED';
    },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, CONTROLLER_RESPONSE_BODY);
  assert.equal(setup.transactions.length, 1);
  const transaction = setup.transactions[0];
  assert.equal(transaction?.length, 4,
    'repeat pulls fence gateway, deployment, operation, and Controller revision together');
  assertExactExpressionBindings(transaction ?? []);
  const gatewayCondition = (transaction?.[0] as {
    ConditionCheck?: { ConditionExpression?: string; ExpressionAttributeValues?: Item };
  }).ConditionCheck;
  assert.match(String(gatewayCondition?.ConditionExpression), /certificateStatus = :active/);
  assert.match(String(gatewayCondition?.ConditionExpression), /signedDescriptor = :descriptor/);
  assert.match(String(gatewayCondition?.ConditionExpression), /configurationSource = :gatewayObservedConfigurationSource/);
  const condition = (transaction?.[3] as {
    ConditionCheck?: { ConditionExpression?: string; ExpressionAttributeValues?: Item };
  }).ConditionCheck;
  assert.match(String(condition?.ConditionExpression), /configurationBody = :controllerBody/);
  assert.equal(condition?.ExpressionAttributeValues?.[':controllerBody'], CONTROLLER_RESPONSE_BODY);
  assert.equal(condition?.ExpressionAttributeValues?.[':controllerChecksum'], CONTROLLER_CONFIGURATION_SHA256);
  assert.equal(condition?.ExpressionAttributeValues?.[':controllerRevision'], CONTROLLER_REVISION);
  assert.equal(condition?.ExpressionAttributeValues?.[':controllerUpdatedAt'], CONTROLLER_UPDATED_AT);
});

test('a read-only Controller pull cannot return an old revision after an admin update wins', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const recordControllerDelivery = (item: Item) => {
    item.configurationSource = 'CONTROLLER';
    item.deliveredConfigurationGeneration = GENERATION;
    item.deliveredConfigurationChecksum = CONTROLLER_CONFIGURATION_SHA256;
    item.controllerConfigurationRevision = CONTROLLER_REVISION;
    item.controllerConfigurationUpdatedAt = CONTROLLER_UPDATED_AT;
  };
  const setup = fixture({
    controller: controllerRecord(),
    mutateGateway: (gateway) => {
      gateway.state = 'APPLIED_HEALTHY';
      recordControllerDelivery(gateway);
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'APPLIED_HEALTHY';
      recordControllerDelivery(deployment);
    },
    mutateOperation: (operation) => {
      operation.state = 'APPLIED_HEALTHY';
      operation.operationStatus = 'SUCCEEDED';
    },
  });
  const originalGetItem = setup.dependencies.getItem;
  let controllerUpdated = false;
  setup.dependencies.getItem = async (key) => {
    if (key.PK === TENANT_KEY && key.SK === 'CONTROLLER' && controllerUpdated) {
      return {
        ...controllerRecord(),
        configuration: UPDATED_CONTROLLER_CONFIGURATION,
        configurationBody: UPDATED_CONTROLLER_RESPONSE_BODY,
        configurationChecksum: UPDATED_CONTROLLER_CONFIGURATION_SHA256,
        revision: UPDATED_CONTROLLER_REVISION,
        updatedAt: '2026-08-18T11:30:00.000Z',
      };
    }
    return originalGetItem(key);
  };
  setup.dependencies.transactWrite = async (transaction) => {
    setup.transactions.push(transaction);
    controllerUpdated = true;
    throw Object.assign(new Error('Controller revision update won'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });
  };

  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 500);
  assert.equal((JSON.parse(String(response.body)) as Item).code, 'INTERNAL_ERROR');
  assert.notEqual(response.body, CONTROLLER_RESPONSE_BODY);
  assert.equal(setup.transactions.length, 1);
  const condition = (setup.transactions[0]?.[3] as {
    ConditionCheck?: { ExpressionAttributeValues?: Item };
  }).ConditionCheck;
  assert.equal(condition?.ExpressionAttributeValues?.[':controllerBody'], CONTROLLER_RESPONSE_BODY);
  assert.equal(condition?.ExpressionAttributeValues?.[':controllerChecksum'], CONTROLLER_CONFIGURATION_SHA256);
  assert.equal(condition?.ExpressionAttributeValues?.[':controllerRevision'], CONTROLLER_REVISION);
  assert.equal(condition?.ExpressionAttributeValues?.[':controllerUpdatedAt'], CONTROLLER_UPDATED_AT);
});

test('a read-only Controller pull fails closed when decommissioning wins the authorization fence', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const recordControllerDelivery = (item: Item) => {
    item.configurationSource = 'CONTROLLER';
    item.deliveredConfigurationGeneration = GENERATION;
    item.deliveredConfigurationChecksum = CONTROLLER_CONFIGURATION_SHA256;
    item.controllerConfigurationRevision = CONTROLLER_REVISION;
    item.controllerConfigurationUpdatedAt = CONTROLLER_UPDATED_AT;
  };
  const setup = fixture({
    controller: controllerRecord(),
    mutateGateway: (gateway) => {
      gateway.state = 'APPLIED_HEALTHY';
      recordControllerDelivery(gateway);
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'APPLIED_HEALTHY';
      recordControllerDelivery(deployment);
    },
    mutateOperation: (operation) => {
      operation.state = 'APPLIED_HEALTHY';
      operation.operationStatus = 'SUCCEEDED';
    },
  });
  setup.dependencies.transactWrite = async (transaction) => {
    setup.transactions.push(transaction);
    setup.gateway.certificateStatus = 'INACTIVE';
    setup.gateway.state = 'DECOMMISSIONED';
    throw Object.assign(new Error('decommission won'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });
  };

  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 500);
  assert.equal((JSON.parse(String(response.body)) as Item).code, 'INTERNAL_ERROR');
  assert.notEqual(response.body, CONTROLLER_RESPONSE_BODY);
  const gatewayCondition = (setup.transactions[0]?.[0] as {
    ConditionCheck?: { ConditionExpression?: string };
  }).ConditionCheck;
  assert.match(String(gatewayCondition?.ConditionExpression), /certificateStatus = :active/);
});

test('same-generation controller payload drift fails closed without overwriting delivery authority', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const recordDelivery = (item: Item) => {
    item.configurationSource = 'CONTROLLER';
    item.deliveredConfigurationGeneration = GENERATION;
    item.deliveredConfigurationChecksum = 'd'.repeat(64);
    item.controllerConfigurationRevision = CONTROLLER_REVISION;
    item.controllerConfigurationUpdatedAt = CONTROLLER_UPDATED_AT;
  };
  const setup = fixture({
    controller: controllerRecord(),
    mutateGateway: (gateway) => {
      gateway.state = 'PROFILE_DELIVERED';
      recordDelivery(gateway);
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'PROFILE_DELIVERED';
      recordDelivery(deployment);
    },
    mutateOperation: (operation) => { operation.state = 'PROFILE_STAGED'; },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 409);
  assert.equal((JSON.parse(String(response.body)) as Item).code, 'CONFIGURATION_NOT_AVAILABLE');
  assert.deepEqual(setup.loadedProfileKeys, []);
  assert.deepEqual(setup.transactions, []);
});

test('removing a configured controller never falls back to S3 for a controller-delivered generation', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const recordControllerDelivery = (item: Item) => {
    item.configurationSource = 'CONTROLLER';
    item.deliveredConfigurationGeneration = GENERATION;
    item.deliveredConfigurationChecksum = CONTROLLER_CONFIGURATION_SHA256;
    item.controllerConfigurationRevision = CONTROLLER_REVISION;
    item.controllerConfigurationUpdatedAt = CONTROLLER_UPDATED_AT;
  };
  const setup = fixture({
    mutateGateway: (gateway) => {
      gateway.state = 'PROFILE_DELIVERED';
      recordControllerDelivery(gateway);
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'PROFILE_DELIVERED';
      recordControllerDelivery(deployment);
    },
    mutateOperation: (operation) => { operation.state = 'PROFILE_STAGED'; },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 409);
  assert.equal((JSON.parse(String(response.body)) as Item).code, 'CONFIGURATION_NOT_AVAILABLE');
  assert.deepEqual(setup.loadedProfileKeys, [], 'S3 is not read after controller authority was recorded');
  assert.deepEqual(setup.transactions, []);
});

test('configuration delivery transactions remain valid across partial forward-state retries', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const cases = [
    {
      label: 'gateway already delivered',
      mutateGateway: (gateway: Item) => { gateway.state = 'PROFILE_DELIVERED'; },
      mutateDeployment: () => {},
      gatewayUsesDelivered: false,
      deploymentUsesDelivered: true,
    },
    {
      label: 'deployment already delivered',
      mutateGateway: () => {},
      mutateDeployment: (deployment: Item) => { deployment.status = 'PROFILE_DELIVERED'; },
      gatewayUsesDelivered: true,
      deploymentUsesDelivered: false,
    },
  ];

  for (const retryCase of cases) {
    const setup = fixture({
      mutateGateway: retryCase.mutateGateway,
      mutateDeployment: retryCase.mutateDeployment,
      mutateOperation: (operation) => { operation.state = 'PROFILE_STAGED'; },
    });
    const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
    assert.equal(response.statusCode, 200, retryCase.label);
    assert.equal(setup.transactions.length, 1, retryCase.label);
    const transaction = setup.transactions[0];
    assert.ok(transaction);
    assert.equal(transaction.length, 4,
      `${retryCase.label}: gateway, deployment, Controller-absence fence, and audit remain atomic`);
    assertExactExpressionBindings(transaction);

    const gatewayUpdate = (transaction[0] as {
      Update?: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
    }).Update;
    const deploymentUpdate = (transaction[1] as {
      Update?: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
    }).Update;
    assert.ok(gatewayUpdate);
    assert.ok(deploymentUpdate);
    assert.equal(gatewayUpdate.UpdateExpression?.includes(':delivered'), retryCase.gatewayUsesDelivered, retryCase.label);
    assert.equal(':delivered' in (gatewayUpdate.ExpressionAttributeValues ?? {}), retryCase.gatewayUsesDelivered, retryCase.label);
    assert.equal(deploymentUpdate.UpdateExpression?.includes(':delivered'), retryCase.deploymentUsesDelivered, retryCase.label);
    assert.equal(':delivered' in (deploymentUpdate.ExpressionAttributeValues ?? {}), retryCase.deploymentUsesDelivered, retryCase.label);
  }
});

test('generation-two PROFILE_AVAILABLE records deliver without regressing an already staged profile operation', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture({
    mutateOperation: (operation) => {
      operation.type = 'PROFILE_DEPLOY';
      operation.state = 'PROFILE_STAGED';
      operation.timeline = [{
        state: 'PROFILE_STAGED',
        at: '2026-08-17T11:59:00.000Z',
        detail: `Signed profile generation ${GENERATION} is queued for delivery.`,
      }];
      const steps = operation.steps as Item[];
      steps[2] = {
        key: 'profile',
        label: 'Signed profile delivered',
        status: 'in_progress',
        detail: 'Signed descriptor is queued for delivery.',
        timestamp: '2026-08-17T11:59:00.000Z',
      };
    },
  });

  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
  assert.equal(response.statusCode, 200);
  assert.equal(setup.transactions.length, 1);
  const transaction = setup.transactions[0];
  assert.ok(transaction);
  assert.equal(transaction.length, 4,
    'gateway, deployment, Controller-absence fence, and audit update without completing apply');
  assert.ok((transaction[2] as { ConditionCheck?: unknown }).ConditionCheck);
  assert.doesNotMatch(JSON.stringify(transaction), /"SUCCEEDED"|"APPLIED_HEALTHY"/);
  assert.equal(setup.operation.state, 'PROFILE_STAGED');
  assert.equal(setup.operation.operationStatus, 'IN_PROGRESS');
  assertExactExpressionBindings(transaction);
});

test('first IAM-authenticated configuration GET finalizes the permanent identity before exposing the profile', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture({ firstUse: true });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 200);
  assert.equal(setup.transactions.length, 2, 'identity activation and profile delivery use separate atomic transitions');

  const finalization = setup.transactions[0];
  assert.ok(finalization);
  assert.equal(finalization.length, 5, 'bootstrap binding, manufacturing, gateway, operation, and outbox move together');
  const serializedFinalization = JSON.stringify(finalization);
  assert.match(serializedFinalization, /DEACTIVATE_BOOTSTRAP_CERTIFICATE/);
  assert.match(serializedFinalization, /PRELOADED_UNIQUE_BOOTSTRAP/);
  assert.match(serializedFinalization, /PENDING_ACTIVATION/);
  assert.match(serializedFinalization, /OPERATIONAL_IDENTITY_ISSUED/);
  assert.match(serializedFinalization, /AWS IoT credentials provider/);
  assert.match(serializedFinalization, new RegExp(BOOTSTRAP_CERTIFICATE_ID));
  assert.match(serializedFinalization, new RegExp(CERTIFICATE_ID));

  assert.equal(setup.callOrder[0], 'finalize-identity', 'profile bytes are not exposed before identity activation');
  assert.deepEqual(setup.callOrder.slice(1), [
    `load-profile:${setup.descriptor.objectKey}`,
    'record-delivery',
  ]);
});

test('first configuration GET fails closed when the bootstrap binding is not owned by the gateway tenant', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture({
    firstUse: true,
    mutateBootstrapBinding: (binding) => {
      binding.tenantId = 'tenant-attacker';
    },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 403);
  assert.equal((JSON.parse(String(response.body)) as { code: string }).code, 'DEVICE_NOT_AUTHORIZED');
  assert.deepEqual(setup.transactions, []);
  assert.deepEqual(setup.loadedProfileKeys, []);
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

  assert.deepEqual(setup.loadedProfileKeys, []);
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
  assert.deepEqual(setup.loadedProfileKeys, []);
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
  assert.deepEqual(setup.loadedProfileKeys, []);
  assert.deepEqual(setup.transactions, []);
});

test('secured device configuration GET rejects inconsistent deployment authority before reading the profile', async () => {
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
  assert.deepEqual(setup.loadedProfileKeys, []);
  assert.deepEqual(setup.transactions, []);
});

test('secured device configuration GET rejects unknown deployment and pre-certificate operation states', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const cases = [
    fixture({ mutateDeployment: (deployment) => { deployment.status = 'UNRECOGNIZED'; } }),
    fixture({ mutateOperation: (operation) => { operation.state = 'CLAIM_ACCEPTED'; } }),
  ];

  for (const setup of cases) {
    const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
    assert.equal(response.statusCode, 409);
    assert.equal((JSON.parse(String(response.body)) as { code: string }).code, 'CONFIGURATION_NOT_AVAILABLE');
    assert.deepEqual(setup.loadedProfileKeys, []);
    assert.deepEqual(setup.transactions, []);
  }
});

test('secured device configuration GET rejects corrupt operation steps and timeline shapes', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const cases = [
    fixture({ mutateOperation: (operation) => { operation.steps = { 0: 'not-a-list' }; } }),
    fixture({
      mutateOperation: (operation) => {
        const steps = operation.steps as Item[];
        steps[2] = { ...steps[2], key: 'identity' };
      },
    }),
    fixture({ mutateOperation: (operation) => { operation.timeline = 'not-a-list'; } }),
    fixture({
      mutateOperation: (operation) => {
        (operation.timeline as Item[])[0] = {
          ...(operation.timeline as Item[])[0],
          unexpected: true,
        };
      },
    }),
  ];

  for (const setup of cases) {
    const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
    assert.equal(response.statusCode, 409);
    assert.equal((JSON.parse(String(response.body)) as { code: string }).code, 'CONFIGURATION_NOT_AVAILABLE');
    assert.deepEqual(setup.loadedProfileKeys, []);
    assert.deepEqual(setup.transactions, []);
  }
});

test('a genuine first-delivery transaction race returns the configuration after all records win forward', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture();
  setup.dependencies.transactWrite = async (transaction) => {
    setup.transactions.push(transaction);
    setup.gateway.state = 'PROFILE_DELIVERED';
    setup.deployment.status = 'PROFILE_DELIVERED';
    for (const record of [setup.gateway, setup.deployment]) {
      record.configurationSource = 'S3';
      record.deliveredConfigurationGeneration = GENERATION;
      record.deliveredConfigurationChecksum = PROFILE_SHA256;
    }
    setup.operation.state = 'PROFILE_STAGED';
    const operationUpdate = (transaction[2] as {
      Update?: { ExpressionAttributeValues?: Record<string, unknown> };
    }).Update;
    setup.operation.steps = operationUpdate?.ExpressionAttributeValues?.[':nextSteps'];
    setup.operation.timeline = operationUpdate?.ExpressionAttributeValues?.[':nextTimeline'];
    throw Object.assign(new Error('concurrent conditional write lost'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });
  };

  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
  assert.equal(response.statusCode, 200);
  assert.equal(setup.transactions.length, 1);
});

test('an S3 delivery race cannot be reconciled after a Controller save wins', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture();
  const originalGetItem = setup.dependencies.getItem;
  let controllerSaved = false;
  setup.dependencies.getItem = async (key) => {
    if (key.PK === TENANT_KEY && key.SK === 'CONTROLLER' && controllerSaved) return controllerRecord();
    return originalGetItem(key);
  };
  setup.dependencies.transactWrite = async (transaction) => {
    setup.transactions.push(transaction);
    // Even if an unrelated concurrent S3 pull advanced all lifecycle records,
    // this request must not return its S3 body after Controller activation.
    setup.gateway.state = 'PROFILE_DELIVERED';
    setup.deployment.status = 'PROFILE_DELIVERED';
    for (const record of [setup.gateway, setup.deployment]) {
      record.configurationSource = 'S3';
      record.deliveredConfigurationGeneration = GENERATION;
      record.deliveredConfigurationChecksum = PROFILE_SHA256;
    }
    setup.operation.state = 'PROFILE_STAGED';
    const operationUpdate = (transaction[2] as {
      Update?: { ExpressionAttributeValues?: Record<string, unknown> };
    }).Update;
    setup.operation.steps = operationUpdate?.ExpressionAttributeValues?.[':nextSteps'];
    setup.operation.timeline = operationUpdate?.ExpressionAttributeValues?.[':nextTimeline'];
    controllerSaved = true;
    throw Object.assign(new Error('Controller save won the serializable transaction'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });
  };

  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
  assert.equal(response.statusCode, 500);
  assert.equal((JSON.parse(String(response.body)) as Item).code, 'INTERNAL_ERROR');
  assert.equal(setup.transactions.length, 1);
});

test('delivery-race reconciliation rejects a mismatched recorded S3 checksum', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture();
  setup.dependencies.transactWrite = async (transaction) => {
    setup.transactions.push(transaction);
    setup.gateway.state = 'PROFILE_DELIVERED';
    setup.deployment.status = 'PROFILE_DELIVERED';
    for (const record of [setup.gateway, setup.deployment]) {
      record.configurationSource = 'S3';
      record.deliveredConfigurationGeneration = GENERATION;
      record.deliveredConfigurationChecksum = 'f'.repeat(64);
    }
    setup.operation.state = 'PROFILE_STAGED';
    const operationUpdate = (transaction[2] as {
      Update?: { ExpressionAttributeValues?: Record<string, unknown> };
    }).Update;
    setup.operation.steps = operationUpdate?.ExpressionAttributeValues?.[':nextSteps'];
    setup.operation.timeline = operationUpdate?.ExpressionAttributeValues?.[':nextTimeline'];
    throw Object.assign(new Error('a different S3 authority won'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });
  };

  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
  assert.equal(response.statusCode, 500);
  assert.equal((JSON.parse(String(response.body)) as Item).code, 'INTERNAL_ERROR');
});

test('a delivery race fails closed when the operation did not advance with the assignment', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture();
  setup.dependencies.transactWrite = async (transaction) => {
    setup.transactions.push(transaction);
    setup.gateway.state = 'PROFILE_DELIVERED';
    setup.deployment.status = 'PROFILE_DELIVERED';
    throw Object.assign(new Error('concurrent conditional write lost'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });
  };

  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
  assert.equal(response.statusCode, 500);
  assert.equal((JSON.parse(String(response.body)) as { code: string }).code, 'INTERNAL_ERROR');
});

test('access and validation failures are never reclassified as successful delivery races', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  for (const errorName of ['AccessDeniedException', 'ValidationException']) {
    const setup = fixture();
    const originalGetItem = setup.dependencies.getItem;
    let getCount = 0;
    setup.dependencies.getItem = async (key) => {
      getCount += 1;
      return originalGetItem(key);
    };
    setup.dependencies.transactWrite = async (transaction) => {
      setup.transactions.push(transaction);
      // Even a misleading forward-looking reread must not hide a non-race failure.
      setup.gateway.state = 'PROFILE_DELIVERED';
      setup.deployment.status = 'PROFILE_DELIVERED';
      setup.operation.state = 'PROFILE_STAGED';
      throw Object.assign(new Error(errorName), { name: errorName });
    };

    const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
    assert.equal(response.statusCode, 500, errorName);
    assert.equal(getCount, 4, `${errorName} must not trigger race-reconciliation rereads`);
  }
});

test('transaction cancellations without an explicit race reason fail closed', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const cancellationReasons = [
    undefined,
    [{ Code: 'None' }],
    [{ Code: 'ConditionalCheckFailed' }, { Code: 'ValidationError' }],
    [{ Code: 'ProvisionedThroughputExceeded' }],
    [{ Code: 'ThrottlingError' }],
  ];

  for (const reasons of cancellationReasons) {
    const setup = fixture();
    const originalGetItem = setup.dependencies.getItem;
    let getCount = 0;
    setup.dependencies.getItem = async (key) => {
      getCount += 1;
      return originalGetItem(key);
    };
    setup.dependencies.transactWrite = async (transaction) => {
      setup.transactions.push(transaction);
      setup.gateway.state = 'PROFILE_DELIVERED';
      setup.deployment.status = 'PROFILE_DELIVERED';
      setup.operation.state = 'PROFILE_STAGED';
      const error = Object.assign(new Error('non-race transaction cancellation'), {
        name: 'TransactionCanceledException',
      }) as Error & { CancellationReasons?: Array<{ Code: string }> };
      if (reasons !== undefined) error.CancellationReasons = reasons;
      throw error;
    };

    const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);
    assert.equal(response.statusCode, 500);
    assert.equal(getCount, 4, 'non-race cancellation must not trigger reconciliation rereads');
  }
});

test('an applied healthy gateway may repeat a pull read-only without regressing operation state', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const recordS3Delivery = (item: Item) => {
    item.configurationSource = 'S3';
    item.deliveredConfigurationGeneration = GENERATION;
    item.deliveredConfigurationChecksum = PROFILE_SHA256;
  };
  const setup = fixture({
    mutateGateway: (gateway) => {
      gateway.state = 'APPLIED_HEALTHY';
      recordS3Delivery(gateway);
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'APPLIED_HEALTHY';
      recordS3Delivery(deployment);
    },
    mutateOperation: (operation) => {
      operation.state = 'APPLIED_HEALTHY';
      operation.operationStatus = 'SUCCEEDED';
    },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 200);
  assert.equal(setup.transactions.length, 1,
    'unchanged-generation repeat pulls atomically fence their complete delivery authority');
  const transaction = setup.transactions[0];
  assert.equal(transaction?.length, 4);
  assertExactExpressionBindings(transaction ?? []);
  const gatewayCondition = (transaction?.[0] as {
    ConditionCheck?: { ConditionExpression?: string };
  }).ConditionCheck;
  assert.match(String(gatewayCondition?.ConditionExpression), /certificateStatus = :active/);
  assert.match(String(gatewayCondition?.ConditionExpression), /desiredGeneration = :generation/);
  assert.match(String(gatewayCondition?.ConditionExpression), /configurationSource = :gatewayObservedConfigurationSource/);
  const condition = (transaction?.[3] as {
    ConditionCheck?: { Key?: Item; ConditionExpression?: string };
  }).ConditionCheck;
  assert.deepEqual(condition?.Key, { PK: TENANT_KEY, SK: 'CONTROLLER' });
  assert.equal(condition?.ConditionExpression, 'attribute_not_exists(PK)');
});

test('a read-only S3 pull cannot return legacy configuration after a Controller save wins', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const recordS3Delivery = (item: Item) => {
    item.configurationSource = 'S3';
    item.deliveredConfigurationGeneration = GENERATION;
    item.deliveredConfigurationChecksum = PROFILE_SHA256;
  };
  const setup = fixture({
    mutateGateway: (gateway) => {
      gateway.state = 'APPLIED_HEALTHY';
      recordS3Delivery(gateway);
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'APPLIED_HEALTHY';
      recordS3Delivery(deployment);
    },
    mutateOperation: (operation) => {
      operation.state = 'APPLIED_HEALTHY';
      operation.operationStatus = 'SUCCEEDED';
    },
  });
  const originalGetItem = setup.dependencies.getItem;
  let controllerSaved = false;
  setup.dependencies.getItem = async (key) => {
    if (key.PK === TENANT_KEY && key.SK === 'CONTROLLER' && controllerSaved) return controllerRecord();
    return originalGetItem(key);
  };
  setup.dependencies.transactWrite = async (transaction) => {
    setup.transactions.push(transaction);
    controllerSaved = true;
    throw Object.assign(new Error('Controller save won'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });
  };

  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 500);
  assert.equal((JSON.parse(String(response.body)) as Item).code, 'INTERNAL_ERROR');
  assert.equal(setup.loadedProfileKeys.length, 1, 'the immutable object read occurred before the singleton fence');
  assert.equal(setup.transactions.length, 1);
  const condition = (setup.transactions[0]?.[3] as {
    ConditionCheck?: { ConditionExpression?: string };
  }).ConditionCheck;
  assert.equal(condition?.ConditionExpression, 'attribute_not_exists(PK)');
});

test('a read-only S3 pull fails closed when a new profile generation wins the assignment fence', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const recordS3Delivery = (item: Item) => {
    item.configurationSource = 'S3';
    item.deliveredConfigurationGeneration = GENERATION;
    item.deliveredConfigurationChecksum = PROFILE_SHA256;
  };
  const setup = fixture({
    mutateGateway: (gateway) => {
      gateway.state = 'APPLIED_HEALTHY';
      recordS3Delivery(gateway);
    },
    mutateDeployment: (deployment) => {
      deployment.status = 'APPLIED_HEALTHY';
      recordS3Delivery(deployment);
    },
    mutateOperation: (operation) => {
      operation.state = 'APPLIED_HEALTHY';
      operation.operationStatus = 'SUCCEEDED';
    },
  });
  setup.dependencies.transactWrite = async (transaction) => {
    setup.transactions.push(transaction);
    setup.gateway.desiredGeneration = GENERATION + 1;
    setup.gateway.desiredProfileVersionId = 'pv-2';
    setup.gateway.operationId = 'operation-b';
    throw Object.assign(new Error('new assignment won'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });
  };

  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 500);
  assert.equal((JSON.parse(String(response.body)) as Item).code, 'INTERNAL_ERROR');
  const gatewayCondition = (setup.transactions[0]?.[0] as {
    ConditionCheck?: { ConditionExpression?: string };
  }).ConditionCheck;
  assert.match(String(gatewayCondition?.ConditionExpression), /desiredGeneration = :generation/);
  assert.match(String(gatewayCondition?.ConditionExpression), /desiredProfileVersionId = :profileVersionId/);
  assert.match(String(gatewayCondition?.ConditionExpression), /operationId = :operationId/);
});

test('legacy assignments without a persisted compact claim fail closed before delivery', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture({
    mutateDescriptor: (descriptor) => {
      delete descriptor.configurationClaim;
    },
  });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 409);
  const body = JSON.parse(String(response.body)) as Record<string, unknown>;
  assert.equal(body.code, 'CONFIGURATION_NOT_AVAILABLE');
  assert.equal(body.descriptor, undefined);
  assert.equal(body.artifacts, undefined);
  assert.deepEqual(setup.transactions, []);
});

test('secured device configuration GET rejects profile bytes that do not match the signed checksum', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const setup = fixture({ profileArtifact: Buffer.from('{"tampered":true}') });
  const response = await createDeviceConfigurationHandler(setup.dependencies)(event(), context);

  assert.equal(response.statusCode, 409);
  assert.equal((JSON.parse(String(response.body)) as { code: string }).code, 'CONFIGURATION_NOT_AVAILABLE');
  assert.deepEqual(setup.transactions, []);
});

test('secured device configuration GET rejects non-canonical and oversized profile artifacts', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const nonCanonical = Buffer.from(JSON.stringify(PROFILE_DOCUMENT));
  const nonCanonicalHash = createHash('sha256').update(nonCanonical).digest('hex');
  const nonCanonicalSetup = fixture({
    profileArtifact: nonCanonical,
    mutateDescriptor: (descriptor) => {
      descriptor.profileSha256 = nonCanonicalHash;
      (descriptor.configurationClaim as Item).profileSha256 = nonCanonicalHash;
    },
  });
  const nonCanonicalResponse = await createDeviceConfigurationHandler(nonCanonicalSetup.dependencies)(event(), context);
  assert.equal(nonCanonicalResponse.statusCode, 409);
  assert.deepEqual(nonCanonicalSetup.transactions, []);

  const oversizedSetup = fixture({ profileArtifact: Buffer.alloc(1024 * 1024 + 1, 0x20) });
  const oversizedResponse = await createDeviceConfigurationHandler(oversizedSetup.dependencies)(event(), context);
  assert.equal(oversizedResponse.statusCode, 409);
  assert.deepEqual(oversizedSetup.transactions, []);
});
