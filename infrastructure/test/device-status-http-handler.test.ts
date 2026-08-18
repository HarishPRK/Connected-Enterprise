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

interface CoreHarnessOptions {
  gatewayState?: string;
  deploymentStatus?: string;
  operationState?: string;
  includeDesiredGeneration?: boolean;
  onTransact?: (
    items: unknown[],
    records: {
      gateway: Record<string, unknown>;
      deployment: Record<string, unknown>;
      operation: Record<string, unknown>;
    },
  ) => Promise<void>;
}

function coreHarness(options: CoreHarnessOptions = {}) {
  const tenantId = 'tenant-a';
  const gatewayId = 'gateway-a';
  const operationId = 'operation-a';
  const tenantKey = `TENANT#${tenantId}`;
  const gatewayKey = `GATEWAY#${gatewayId}`;
  const deploymentKey = `DEPLOYMENT#${gatewayId}#${String(GENERATION).padStart(12, '0')}`;
  const operationKey = `OPERATION#${operationId}`;
  const descriptor = { profileSha256: PROFILE_CHECKSUM };
  const gateway: Record<string, unknown> = {
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
    ...(options.includeDesiredGeneration === false ? {} : { desiredGeneration: GENERATION }),
    desiredProfileVersionId: PROFILE_VERSION_ID,
    operationId,
    signedDescriptor: descriptor,
    state: options.gatewayState ?? 'PROFILE_DELIVERED',
  };
  const deployment: Record<string, unknown> = {
    PK: tenantKey,
    SK: deploymentKey,
    entityType: 'DEPLOYMENT',
    tenantId,
    gatewayId,
    generation: GENERATION,
    profileVersionId: PROFILE_VERSION_ID,
    operationId,
    status: options.deploymentStatus ?? 'PROFILE_DELIVERED',
    descriptor,
  };
  const operation: Record<string, unknown> = {
    PK: tenantKey,
    SK: operationKey,
    entityType: 'OPERATION',
    tenantId,
    operationId,
    gatewayId,
    profileVersionId: PROFILE_VERSION_ID,
    deploymentGeneration: GENERATION,
    state: options.operationState ?? 'PROFILE_STAGED',
    steps: [],
  };
  const records = { gateway, deployment, operation };
  const gatewayLocator = {
    PK: tenantKey,
    SK: gatewayKey,
    GSI1PK: `THING#${THING_NAME}`,
    entityType: 'GATEWAY',
  };
  const items = new Map<string, Record<string, unknown>>([
    [`${tenantKey}|${gatewayKey}`, gateway],
    [`${tenantKey}|${deploymentKey}`, deployment],
    [`${tenantKey}|${operationKey}`, operation],
  ]);
  const readKeys: Array<{ PK: string; SK: string }> = [];
  const transactions: unknown[][] = [];
  const value: DeviceStatusDependencies = {
    async queryGatewayByThing() {
      return [gatewayLocator];
    },
    async getItem(key) {
      readKeys.push(key);
      return items.get(`${key.PK}|${key.SK}`);
    },
    async transactWrite(itemsToWrite) {
      const captured = itemsToWrite as unknown[];
      transactions.push(captured);
      await options.onTransact?.(captured, records);
    },
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  };
  return {
    value,
    records,
    readKeys,
    transactions,
    tenantKey,
    gatewayKey,
    deploymentKey,
    operationKey,
  };
}

function transactionCanceled(...codes: string[]): Error {
  return Object.assign(new Error('transaction canceled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
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
  const setup = coreHarness();

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    { generation: GENERATION, status: 'APPLYING', detail: 'Applying candidate.' },
    context,
    setup.value,
  );
  assert.equal(disposition, 'APPLIED');
  assert.deepEqual(setup.readKeys[0], { PK: setup.tenantKey, SK: setup.gatewayKey },
    'the eventual GSI locator is reauthorized through a consistent base-record read');
  assert.equal(setup.transactions.length, 1);
  assert.equal(setup.transactions[0]?.length, 4, 'gateway, deployment, operation, and audit remain atomic');
  const gatewayUpdate = setup.transactions[0]?.[0] as {
    Update?: { ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
  };
  assert.match(String(gatewayUpdate.Update?.ConditionExpression), /certificateStatus = :active/);
  assert.match(String(gatewayUpdate.Update?.ConditionExpression), /signedDescriptor = :descriptor/);
  assert.match(String(gatewayUpdate.Update?.ConditionExpression), /operationId = :operationId/);
  assert.equal(gatewayUpdate.Update?.ExpressionAttributeValues?.[':active'], 'ACTIVE');

  await assert.rejects(
    recordAuthoritativeDeviceStatus(
      { thingName: THING_NAME, certificateId: 'c'.repeat(64) },
      { generation: GENERATION, status: 'APPLYING' },
      context,
      setup.value,
    ),
    DeviceStatusAuthorizationError,
  );
  assert.equal(setup.transactions.length, 1);
});

test('authoritative status core fails closed when desiredGeneration is missing', async () => {
  const {
    recordAuthoritativeDeviceStatus,
    DeviceStatusConflictError,
  } = await import('../lambda/iot-status-handler.js');
  const setup = coreHarness({ includeDesiredGeneration: false });

  await assert.rejects(
    recordAuthoritativeDeviceStatus(
      { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
      { generation: GENERATION, status: 'APPLYING' },
      context,
      setup.value,
    ),
    DeviceStatusConflictError,
  );
  assert.equal(setup.transactions.length, 0);
});

test('authoritative status core converges mixed states without rewriting records already at the target', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  const setup = coreHarness({
    gatewayState: 'HEALTH_CHECK',
    deploymentStatus: 'APPLYING',
    operationState: 'APPLYING',
  });

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    { generation: GENERATION, status: 'HEALTH_CHECK' },
    context,
    setup.value,
  );
  assert.equal(disposition, 'APPLIED');
  const transaction = setup.transactions[0] as Array<{
    Update?: {
      Key?: { SK?: string };
      ConditionExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
    };
  }>;
  const updatedKeys = transaction.flatMap((item) => item.Update?.Key?.SK ? [item.Update.Key.SK] : []);
  assert.deepEqual(updatedKeys, [setup.deploymentKey, setup.operationKey]);
  const deploymentUpdate = transaction.find((item) => item.Update?.Key?.SK === setup.deploymentKey)?.Update;
  const operationUpdate = transaction.find((item) => item.Update?.Key?.SK === setup.operationKey)?.Update;
  assert.match(String(deploymentUpdate?.ConditionExpression), /tenantId = :tenantId/);
  assert.match(String(deploymentUpdate?.ConditionExpression), /profileVersionId = :profileVersionId/);
  assert.match(String(deploymentUpdate?.ConditionExpression), /#descriptor = :descriptor/);
  assert.equal(deploymentUpdate?.ExpressionAttributeNames?.['#descriptor'], 'descriptor');
  assert.match(String(operationUpdate?.ConditionExpression), /operationId = :operationId/);
  assert.match(String(operationUpdate?.ConditionExpression), /deploymentGeneration = :generation/);
});

test('authoritative status core accepts an exact concurrent duplicate after a conditional race', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  const setup = coreHarness({
    async onTransact(_items, records) {
      records.gateway.state = 'APPLYING';
      records.deployment.status = 'APPLYING';
      records.operation.state = 'APPLYING';
      throw transactionCanceled('None', 'TransactionConflict', 'None');
    },
  });

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    { generation: GENERATION, status: 'APPLYING' },
    context,
    setup.value,
  );
  assert.equal(disposition, 'STALE_NOOP');
  assert.equal(setup.transactions.length, 1);
  assert.equal(setup.readKeys.length, 6, 'the loser proves the exact committed result with three consistent rereads');
});

test('a pure transaction conflict retries once when no competing status writer commits', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  let attempts = 0;
  const setup = coreHarness({
    async onTransact() {
      attempts += 1;
      if (attempts === 1) throw transactionCanceled('TransactionConflict');
    },
  });

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    { generation: GENERATION, status: 'APPLYING' },
    context,
    setup.value,
  );
  assert.equal(disposition, 'APPLIED');
  assert.equal(setup.transactions.length, 2);
  assert.equal(setup.readKeys.length, 9,
    'the conflict reread and bounded retry each reauthorize all three authoritative records');
});

test('a status transaction retries after config delivery advances only the early gateway records', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  let attempts = 0;
  const setup = coreHarness({
    gatewayState: 'PROFILE_AVAILABLE',
    deploymentStatus: 'PROFILE_AVAILABLE',
    operationState: 'PROFILE_STAGED',
    async onTransact(_items, records) {
      attempts += 1;
      if (attempts !== 1) return;
      records.gateway.state = 'PROFILE_DELIVERED';
      records.deployment.status = 'PROFILE_DELIVERED';
      throw transactionCanceled('TransactionConflict');
    },
  });

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    { generation: GENERATION, status: 'APPLYING' },
    context,
    setup.value,
  );
  assert.equal(disposition, 'APPLIED');
  assert.equal(setup.transactions.length, 2);
  assert.equal(setup.readKeys.length, 9);
  const retry = setup.transactions[1] as Array<{
    Update?: { Key?: { SK?: string }; ExpressionAttributeValues?: Record<string, unknown> };
  }>;
  assert.equal(retry.find((item) => item.Update?.Key?.SK === setup.gatewayKey)
    ?.Update?.ExpressionAttributeValues?.[':current'], 'PROFILE_DELIVERED');
  assert.equal(retry.find((item) => item.Update?.Key?.SK === setup.deploymentKey)
    ?.Update?.ExpressionAttributeValues?.[':current'], 'PROFILE_DELIVERED');
  assert.equal(retry.find((item) => item.Update?.Key?.SK === setup.operationKey)
    ?.Update?.ExpressionAttributeValues?.[':current'], 'PROFILE_STAGED');
});

test('an APPLYING report becomes stale when a concurrent HEALTH_CHECK report wins', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  const setup = coreHarness({
    async onTransact(_items, records) {
      records.gateway.state = 'HEALTH_CHECK';
      records.deployment.status = 'HEALTH_CHECK';
      records.operation.state = 'HEALTH_CHECK';
      throw transactionCanceled('ConditionalCheckFailed');
    },
  });

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    { generation: GENERATION, status: 'APPLYING' },
    context,
    setup.value,
  );
  assert.equal(disposition, 'STALE_NOOP');
  assert.equal(setup.transactions.length, 1);
});

test('a HEALTH_CHECK report retries once when a concurrent APPLYING report wins first', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  let attempts = 0;
  const setup = coreHarness({
    async onTransact(_items, records) {
      attempts += 1;
      if (attempts !== 1) return;
      records.gateway.state = 'APPLYING';
      records.deployment.status = 'APPLYING';
      records.operation.state = 'APPLYING';
      throw transactionCanceled('ConditionalCheckFailed');
    },
  });

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    { generation: GENERATION, status: 'HEALTH_CHECK' },
    context,
    setup.value,
  );
  assert.equal(disposition, 'APPLIED');
  assert.equal(setup.transactions.length, 2);
  const retryGateway = setup.transactions[1]?.[0] as {
    Update?: { ExpressionAttributeValues?: Record<string, unknown> };
  };
  assert.equal(retryGateway.Update?.ExpressionAttributeValues?.[':current'], 'APPLYING');
  assert.equal(retryGateway.Update?.ExpressionAttributeValues?.[':next'], 'HEALTH_CHECK');
});

test('a HEALTH_CHECK report becomes stale when an attested APPLIED_HEALTHY report wins', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  const setup = coreHarness({
    async onTransact(_items, records) {
      records.gateway.state = 'APPLIED_HEALTHY';
      records.gateway.appliedGeneration = GENERATION;
      records.gateway.appliedProfileVersionId = PROFILE_VERSION_ID;
      records.gateway.appliedProfileChecksum = PROFILE_CHECKSUM;
      records.deployment.status = 'APPLIED_HEALTHY';
      records.deployment.appliedProfileVersionId = PROFILE_VERSION_ID;
      records.deployment.appliedProfileChecksum = PROFILE_CHECKSUM;
      records.operation.state = 'APPLIED_HEALTHY';
      throw transactionCanceled('ConditionalCheckFailed');
    },
  });

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    { generation: GENERATION, status: 'HEALTH_CHECK' },
    context,
    setup.value,
  );
  assert.equal(disposition, 'STALE_NOOP');
  assert.equal(setup.transactions.length, 1);
});

test('authoritative status core accepts an exact concurrent rollback quarantine', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  const setup = coreHarness({
    async onTransact(_items, records) {
      records.gateway.state = 'QUARANTINED';
      records.gateway.health = 'DEGRADED';
      delete records.gateway.desiredProfileVersionId;
      delete records.gateway.signedDescriptor;
      records.deployment.status = 'FAILED';
      records.operation.state = 'FAILED';
      records.operation.failure = { code: 'ROLLBACK_ATTESTATION_FAILED' };
      throw transactionCanceled('ConditionalCheckFailed');
    },
  });

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    {
      generation: GENERATION,
      status: 'ROLLED_BACK',
      profileVersionId: 'pv-untrusted',
      profileChecksum: 'c'.repeat(64),
    },
    context,
    setup.value,
  );
  assert.equal(disposition, 'QUARANTINED');
  assert.equal(setup.readKeys.length, 6);
});

test('transaction cancellation recovery rejects every non-race cancellation reason without rereading', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  const nonRaceCodes = ['ValidationError', 'ProvisionedThroughputExceeded', 'ThrottlingError'];

  for (const code of nonRaceCodes) {
    const cancellation = transactionCanceled('ConditionalCheckFailed', code, 'None');
    const setup = coreHarness({
      async onTransact(_items, records) {
        records.gateway.state = 'APPLYING';
        records.deployment.status = 'APPLYING';
        records.operation.state = 'APPLYING';
        throw cancellation;
      },
    });

    await assert.rejects(
      recordAuthoritativeDeviceStatus(
        { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
        { generation: GENERATION, status: 'APPLYING' },
        context,
        setup.value,
      ),
      (error: unknown) => error === cancellation,
      code,
    );
    assert.equal(setup.transactions.length, 1, code);
    assert.equal(setup.readKeys.length, 3, `${code} must not enter transaction-race recovery`);
  }
});

test('terminal rollback records accept stale reports after assignment fields are intentionally cleared', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  const setup = coreHarness({
    gatewayState: 'ROLLED_BACK',
    deploymentStatus: 'ROLLED_BACK',
    operationState: 'ROLLED_BACK',
  });
  delete setup.records.gateway.desiredProfileVersionId;
  delete setup.records.gateway.signedDescriptor;

  const disposition = await recordAuthoritativeDeviceStatus(
    { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
    { generation: GENERATION, status: 'APPLYING' },
    context,
    setup.value,
  );
  assert.equal(disposition, 'STALE_NOOP');
  assert.equal(setup.transactions.length, 0);
});

test('authoritative status core never masks nonconditional transaction errors or wrong-lineage winners', async () => {
  const { recordAuthoritativeDeviceStatus } = await import('../lambda/iot-status-handler.js');
  const denied = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
  const deniedSetup = coreHarness({
    async onTransact(_items, records) {
      records.gateway.state = 'APPLYING';
      records.deployment.status = 'APPLYING';
      records.operation.state = 'APPLYING';
      throw denied;
    },
  });
  await assert.rejects(
    recordAuthoritativeDeviceStatus(
      { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
      { generation: GENERATION, status: 'APPLYING' },
      context,
      deniedSetup.value,
    ),
    (error: unknown) => error === denied,
  );
  assert.equal(deniedSetup.readKeys.length, 3, 'nonconditional failures do not enter duplicate recovery');

  const race = transactionCanceled('ConditionalCheckFailed');
  const wrongLineageSetup = coreHarness({
    async onTransact(_items, records) {
      records.gateway.state = 'APPLYING';
      records.deployment.status = 'APPLYING';
      records.operation.state = 'APPLYING';
      records.operation.profileVersionId = 'pv-wrong';
      throw race;
    },
  });
  await assert.rejects(
    recordAuthoritativeDeviceStatus(
      { thingName: THING_NAME, certificateId: CERTIFICATE_ID },
      { generation: GENERATION, status: 'APPLYING' },
      context,
      wrongLineageSetup.value,
    ),
    (error: unknown) => error === race,
  );
});

test('transition fences reject early states belonging to another entity', async () => {
  const { transitionDisposition } = await import('../lambda/iot-status-handler.js');
  assert.equal(transitionDisposition('PROFILE_DELIVERED', 'APPLYING', 'gateway'), 'APPLY');
  assert.equal(transitionDisposition('WAITING_FOR_DEVICE', 'APPLYING', 'deployment'), 'APPLY');
  assert.equal(transitionDisposition('PROFILE_STAGED', 'APPLYING', 'operation'), 'APPLY');
  assert.throws(() => transitionDisposition('WAITING_FOR_DEVICE', 'APPLYING', 'gateway'));
  assert.throws(() => transitionDisposition('PERMANENT_IDENTITY_ACTIVE', 'APPLYING', 'deployment'));
  assert.throws(() => transitionDisposition('CLAIM_ACCEPTED', 'APPLYING', 'operation'));
});
