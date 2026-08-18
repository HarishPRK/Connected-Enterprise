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
    const update = (action as {
      Update?: {
        UpdateExpression?: string;
        ConditionExpression?: string;
        ExpressionAttributeNames?: Record<string, string>;
        ExpressionAttributeValues?: Record<string, unknown>;
      };
    }).Update;
    if (!update) return;
    const expression = `${update.UpdateExpression ?? ''} ${update.ConditionExpression ?? ''}`;
    const referencedValues = [...new Set(expression.match(/:[A-Za-z0-9_]+/g) ?? [])].sort();
    const suppliedValues = Object.keys(update.ExpressionAttributeValues ?? {}).sort();
    assert.deepEqual(
      suppliedValues,
      referencedValues,
      `transaction update ${index} must supply every value token exactly once and no unused values`,
    );
    const referencedNames = [...new Set(expression.match(/#[A-Za-z0-9_]+/g) ?? [])].sort();
    const suppliedNames = Object.keys(update.ExpressionAttributeNames ?? {}).sort();
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
  assert.equal(transaction.length, 4, 'gateway, deployment, operation, and audit are committed together');
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

test('configuration delivery transactions remain valid across partial forward-state retries', async () => {
  const { createDeviceConfigurationHandler } = await import('../lambda/device-config-http-handler.js');
  const cases = [
    {
      label: 'gateway already delivered',
      mutateGateway: (gateway: Item) => { gateway.state = 'PROFILE_DELIVERED'; },
      mutateDeployment: (_deployment: Item) => {},
      gatewayUsesDelivered: false,
      deploymentUsesDelivered: true,
    },
    {
      label: 'deployment already delivered',
      mutateGateway: (_gateway: Item) => {},
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
    assert.equal(transaction.length, 3, `${retryCase.label}: gateway, deployment, and audit remain atomic`);
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
  assert.equal(transaction.length, 3, 'gateway, deployment, and audit update without regressing the staged operation');
  assert.doesNotMatch(JSON.stringify(transaction), new RegExp(OPERATION_KEY));
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
    assert.equal(getCount, 3, `${errorName} must not trigger race-reconciliation rereads`);
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
    assert.equal(getCount, 3, 'non-race cancellation must not trigger reconciliation rereads');
  }
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
