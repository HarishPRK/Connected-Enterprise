import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  Context,
} from 'aws-lambda';
import type {
  AuthoritativeDeviceIdentity,
  DeviceStatus,
  DeviceStatusDependencies,
  DeviceStatusRecordDisposition,
  DeviceStatusReport,
} from '../lambda/iot-status-handler.js';
import type { DeviceStatusHttpDependencies } from '../lambda/device-status-http-handler.js';

process.env.TABLE_NAME = 'connected-enterprise-onboarding-unit-test';
process.env.AWS_ACCOUNT_ID = '111122223333';
process.env.AWS_REGION = 'us-east-1';
process.env.GATEWAY_CONFIG_ROLE_NAME = 'connected-enterprise-onboarding-dev-gateway-config-pull';

const THING_NAME = 'gw-device-a';
const CERTIFICATE_ID = 'a'.repeat(64);
const PROFILE_VERSION_ID = 'pv-1';
const PROFILE_CHECKSUM = 'b'.repeat(64);
const GENERATION = 2;
const ROUTE_KEY = 'POST /device/v1/things/{thingName}/certificates/{certificateId}/status';
const PATH = `/device/v1/things/${THING_NAME}/certificates/${CERTIFICATE_ID}/status`;
const context = { awsRequestId: 'lambda-status-request-1' } as Context;

interface RecordedCall {
  identity: AuthoritativeDeviceIdentity;
  report: DeviceStatusReport;
}

function dependencies(disposition: DeviceStatusRecordDisposition = 'APPLIED') {
  const calls: RecordedCall[] = [];
  const value: DeviceStatusHttpDependencies = {
    async recordStatus(identity, report) {
      calls.push({ identity, report });
      return disposition;
    },
  };
  return { calls, value };
}

function statusBody(status: DeviceStatus): Record<string, unknown> {
  return {
    generation: GENERATION,
    status,
    detail: `Gateway reported ${status}.`,
    ...((status === 'APPLIED_HEALTHY' || status === 'ROLLED_BACK') ? {
      profileVersionId: PROFILE_VERSION_ID,
      profileChecksum: PROFILE_CHECKSUM,
    } : {}),
  };
}

function event(
  body: Record<string, unknown> | string = statusBody('APPLYING'),
  overrides: Partial<APIGatewayProxyEventV2WithIAMAuthorizer> = {},
): APIGatewayProxyEventV2WithIAMAuthorizer {
  return {
    version: '2.0',
    routeKey: ROUTE_KEY,
    rawPath: PATH,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: '111122223333',
      apiId: 'api-id',
      domainName: 'api.example.test',
      domainPrefix: 'api',
      http: {
        method: 'POST',
        path: PATH,
        protocol: 'HTTP/1.1',
        sourceIp: '192.0.2.1',
        userAgent: 'unit-test',
      },
      requestId: 'api-status-request-1',
      routeKey: ROUTE_KEY,
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
    isBase64Encoded: false,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...overrides,
  };
}

test('HTTP status adapter accepts every supported status and forwards the authoritative identity', async () => {
  const { createDeviceStatusHttpHandler } = await import('../lambda/device-status-http-handler.js');
  const setup = dependencies();
  const handler = createDeviceStatusHttpHandler(setup.value);
  const statuses: DeviceStatus[] = [
    'APPLYING',
    'HEALTH_CHECK',
    'APPLIED_HEALTHY',
    'FAILED',
    'ROLLING_BACK',
    'ROLLED_BACK',
  ];

  for (const status of statuses) {
    const response = await handler(event(statusBody(status)), context);
    assert.equal(response.statusCode, 200, status);
    assert.equal(response.headers?.['cache-control'], 'no-store');
    const body = JSON.parse(String(response.body)) as Record<string, unknown>;
    assert.equal(body.accepted, true);
    assert.equal(body.status, status);
    assert.equal(body.generation, GENERATION);
  }

  assert.equal(setup.calls.length, statuses.length);
  assert.ok(setup.calls.every((call) => call.identity.thingName === THING_NAME));
  assert.ok(setup.calls.every((call) => call.identity.certificateId === CERTIFICATE_ID));
  assert.equal(setup.calls[2]?.report.profileVersionId, PROFILE_VERSION_ID);
  assert.equal(setup.calls[5]?.report.profileChecksum, PROFILE_CHECKSUM);
});

test('HTTP status adapter requires the exact configured assumed role and canonical route', async () => {
  const { createDeviceStatusHttpHandler } = await import('../lambda/device-status-http-handler.js');
  const setup = dependencies();
  const handler = createDeviceStatusHttpHandler(setup.value);

  const missingIam = event();
  (missingIam.requestContext as { authorizer?: unknown }).authorizer = undefined;
  assert.equal((await handler(missingIam, context)).statusCode, 403);

  const wrongRole = event();
  wrongRole.requestContext.authorizer.iam.userArn =
    'arn:aws:sts::111122223333:assumed-role/connected-enterprise-onboarding-dev-gateway-config-pull-attacker/device-session';
  assert.equal((await handler(wrongRole, context)).statusCode, 403);

  const wrongAccount = event();
  wrongAccount.requestContext.authorizer.iam.accountId = '444455556666';
  assert.equal((await handler(wrongAccount, context)).statusCode, 403);

  const nonCanonicalPath = event(statusBody('APPLYING'), { rawPath: `${PATH}/` });
  assert.equal((await handler(nonCanonicalPath, context)).statusCode, 400);

  const queryParameter = event(statusBody('APPLYING'), {
    rawQueryString: 'debug=true',
    queryStringParameters: { debug: 'true' },
  });
  assert.equal((await handler(queryParameter, context)).statusCode, 400);
  assert.deepEqual(setup.calls, []);
});

test('HTTP status adapter enforces a narrow, status-specific JSON schema', async () => {
  const { createDeviceStatusHttpHandler } = await import('../lambda/device-status-http-handler.js');
  const setup = dependencies();
  const handler = createDeviceStatusHttpHandler(setup.value);
  const invalidEvents = [
    event('{not-json'),
    event('[]'),
    event({ generation: 0, status: 'APPLYING' }),
    event({ generation: GENERATION, status: 'UNKNOWN' }),
    event({ generation: GENERATION, status: 'APPLYING', profileChecksum: PROFILE_CHECKSUM }),
    event({ generation: GENERATION, status: 'APPLIED_HEALTHY' }),
    event({
      generation: GENERATION,
      status: 'APPLIED_HEALTHY',
      profileVersionId: PROFILE_VERSION_ID,
      profileChecksum: PROFILE_CHECKSUM.toUpperCase(),
    }),
    event({ generation: GENERATION, status: 'FAILED', detail: 'line one\nline two' }),
    event({ generation: GENERATION, status: 'FAILED', detail: 'hidden\u0085control' }),
    event({ generation: GENERATION, status: 'FAILED', detail: ' failure ' }),
    event({ generation: GENERATION, status: 'FAILED', debug: true }),
    event(statusBody('APPLYING'), { headers: { 'content-type': 'text/plain' } }),
  ];

  for (const invalid of invalidEvents) {
    const response = await handler(invalid, context);
    assert.equal(response.statusCode, 400, String(response.body));
    assert.equal((JSON.parse(String(response.body)) as { code: string }).code, 'INVALID_REQUEST');
  }
  assert.deepEqual(setup.calls, []);
});

test('HTTP status adapter supports canonical API Gateway base64 JSON only', async () => {
  const { createDeviceStatusHttpHandler } = await import('../lambda/device-status-http-handler.js');
  const setup = dependencies();
  const handler = createDeviceStatusHttpHandler(setup.value);
  const encoded = Buffer.from(JSON.stringify(statusBody('HEALTH_CHECK'))).toString('base64');
  const accepted = await handler(event(encoded, { isBase64Encoded: true }), context);
  assert.equal(accepted.statusCode, 200);

  const rejected = await handler(event('not base64!', { isBase64Encoded: true }), context);
  assert.equal(rejected.statusCode, 400);
  assert.equal(setup.calls.length, 1);
});

test('HTTP status adapter maps authoritative rejection without exposing ledger details', async () => {
  const {
    createDeviceStatusHttpHandler,
  } = await import('../lambda/device-status-http-handler.js');
  const {
    DeviceStatusAuthorizationError,
    DeviceStatusConflictError,
  } = await import('../lambda/iot-status-handler.js');

  const unauthorized = createDeviceStatusHttpHandler({
    async recordStatus() {
      throw new DeviceStatusAuthorizationError();
    },
  });
  const unauthorizedResponse = await unauthorized(event(), context);
  assert.equal(unauthorizedResponse.statusCode, 403);
  assert.equal((JSON.parse(String(unauthorizedResponse.body)) as { error: string }).error, 'Device is not authorized');

  const conflict = createDeviceStatusHttpHandler({
    async recordStatus() {
      throw new DeviceStatusConflictError('sensitive authoritative detail');
    },
  });
  const conflictResponse = await conflict(event(), context);
  assert.equal(conflictResponse.statusCode, 409);
  assert.doesNotMatch(String(conflictResponse.body), /sensitive authoritative detail/);
});

test('authoritative status core can be called directly without MQTT broker fields', async () => {
  const {
    recordAuthoritativeDeviceStatus,
    DeviceStatusAuthorizationError,
  } = await import('../lambda/iot-status-handler.js');
  const tenantId = 'tenant-a';
  const gatewayId = 'gateway-a';
  const operationId = 'operation-a';
  const tenantKey = `TENANT#${tenantId}`;
  const deploymentKey = `DEPLOYMENT#${gatewayId}#${String(GENERATION).padStart(12, '0')}`;
  const operationKey = `OPERATION#${operationId}`;
  const gatewayKey = `GATEWAY#${gatewayId}`;
  const gateway = {
    PK: tenantKey,
    SK: gatewayKey,
    GSI1PK: `THING#${THING_NAME}`,
    entityType: 'GATEWAY',
    tenantId,
    gatewayId,
    thingName: THING_NAME,
    certificateId: CERTIFICATE_ID,
    certificatePrincipal: `arn:aws:iot:us-east-1:111122223333:cert/${CERTIFICATE_ID}`,
    certificateStatus: 'ACTIVE',
    desiredGeneration: GENERATION,
    desiredProfileVersionId: PROFILE_VERSION_ID,
    state: 'PROFILE_DELIVERED',
  };
  const gatewayLocator = {
    PK: tenantKey,
    SK: gatewayKey,
    GSI1PK: `THING#${THING_NAME}`,
    entityType: 'GATEWAY',
  };
  const readKeys: Array<{ PK: string; SK: string }> = [];
  const transactions: unknown[][] = [];
  const items = new Map<string, Record<string, unknown>>([
    [`${tenantKey}|${gatewayKey}`, gateway],
    [`${tenantKey}|${deploymentKey}`, {
      entityType: 'DEPLOYMENT',
      gatewayId,
      generation: GENERATION,
      profileVersionId: PROFILE_VERSION_ID,
      operationId,
      status: 'PROFILE_DELIVERED',
      descriptor: { profileSha256: PROFILE_CHECKSUM },
    }],
    [`${tenantKey}|${operationKey}`, {
      entityType: 'OPERATION',
      gatewayId,
      state: 'PROFILE_STAGED',
      steps: [],
    }],
  ]);
  const coreDependencies: DeviceStatusDependencies = {
    async queryGatewayByThing() {
      return [gatewayLocator];
    },
    async getItem(key: { PK: string; SK: string }) {
      readKeys.push(key);
      return items.get(`${key.PK}|${key.SK}`);
    },
    async transactWrite(value) {
      transactions.push(value as unknown[]);
    },
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  };

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    { generation: GENERATION, status: 'APPLYING', detail: 'Applying candidate.' },
    context,
    coreDependencies,
  );
  assert.equal(disposition, 'APPLIED');
  assert.deepEqual(readKeys[0], { PK: tenantKey, SK: gatewayKey },
    'the eventual GSI locator is reauthorized through a consistent base-record read');
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0]?.length, 4, 'gateway, deployment, operation, and audit remain atomic');
  const gatewayUpdate = transactions[0]?.[0] as {
    Update?: { ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
  };
  assert.match(String(gatewayUpdate.Update?.ConditionExpression), /certificateStatus = :active/);
  assert.equal(gatewayUpdate.Update?.ExpressionAttributeValues?.[':active'], 'ACTIVE');

  await assert.rejects(
    recordAuthoritativeDeviceStatus(
      { thingName: THING_NAME, certificateId: 'c'.repeat(64) },
      { generation: GENERATION, status: 'APPLYING' },
      context,
      coreDependencies,
    ),
    DeviceStatusAuthorizationError,
  );
  assert.equal(transactions.length, 1);
});
