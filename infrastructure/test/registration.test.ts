import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { IoTClient, CreateKeysAndCertificateCommand, AttachPolicyCommand } from '@aws-sdk/client-iot';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';

process.env.TABLE_NAME = 'registration-test';
process.env.SIGNING_KEY_ID = 'test-key';
process.env.AWS_REGION = 'us-east-1';
process.env.BOOTSTRAP_POLICY_NAME = 'test-bootstrap';
process.env.IOT_DATA_ENDPOINT = 'example.iot.us-east-1.amazonaws.com';
process.env.IOT_CREDENTIAL_PROVIDER_ENDPOINT = 'example.credentials.iot.us-east-1.amazonaws.com';
process.env.FLEET_PROVISIONING_TEMPLATE_NAME = 'test-template';
process.env.GATEWAY_CONFIG_ROLE_ALIAS_NAME = 'test-role';
process.env.DEVICE_CONFIGURATION_URL_TEMPLATE = 'https://example.com/device/{thingName}/{certificateId}/configuration';
process.env.DEVICE_STATUS_URL_TEMPLATE = 'https://example.com/device/{thingName}/{certificateId}/status';

const { handler } = await import('../lambda/api-handler.js');
const { ddb } = await import('../lambda/shared/ddb.js');
const { registrationCredentialCondition } = await import('../lambda/shared/registration.js');
const profile = {
  PK: 'TENANT#tenant-a', SK: 'PROFILE_VERSION#profile-a#0000000001',
  entityType: 'PROFILE_VERSION', tenantId: 'tenant-a', profileVersionId: 'profile-v1',
  profileId: 'profile-a', modelId: 'model-a', version: 1, schemaVersion: 2,
  documentHash: 'c'.repeat(64), objectKey: 'profile.json', manifestKey: 'manifest.json',
};
const site = { entityType: 'SITE', tenantId: 'tenant-a', siteId: 'site-a', name: 'Lab' };
const model = { entityType: 'GATEWAY_MODEL', tenantId: 'tenant-a', modelId: 'model-a' };

function setup(context: TestContext, initial?: Record<string, unknown>) {
  const records = new Map<string, Record<string, unknown>>();
  const writes: TransactWriteCommand[] = [];
  if (initial) records.set(`${initial.PK}|MANUFACTURING`, initial);
  context.mock.method(ddb, 'send', async (command: unknown) => {
    if (command instanceof GetCommand) {
      const { PK, SK } = command.input.Key!;
      if (SK === 'METADATA') return { Item: { entityType: 'TENANT', tenantId: 'tenant-a' } };
      if (SK === 'MODEL#model-a') return { Item: model };
      if (SK === 'SITE#site-a') return { Item: site };
      return { Item: records.get(`${PK}|${SK}`) };
    }
    if (command instanceof QueryCommand) {
      return { Items: command.input.IndexName === 'GSI2' ? [profile] : [site] };
    }
    assert.ok(command instanceof TransactWriteCommand);
    writes.push(command);
    for (const item of command.input.TransactItems!) {
      if (item.Put) records.set(`${item.Put.Item!.PK}|${item.Put.Item!.SK}`, structuredClone(item.Put.Item!));
    }
    return {};
  });
  context.mock.method(KMSClient.prototype, 'send', async (command: unknown) => {
    assert.ok(command instanceof SignCommand);
    return { Signature: Buffer.from('test-signature') };
  });
  return { records, writes };
}

async function call(body: object, key = 'registration-test-key', route = 'claims/verify', role = 'operator', tenant = 'tenant-a') {
  const result = await handler({
    version: '2.0', routeKey: `POST /api/onboarding/${route}`,
    headers: { 'idempotency-key': key }, body: JSON.stringify(body),
    requestContext: { requestId: key, authorizer: { jwt: { claims: {
      token_use: 'access', sub: 'operator-a', tenant_id: tenant, tenant_role: role,
    } } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer, {} as Context, () => {});
  assert.ok(result && typeof result === 'object');
  return { status: result.statusCode, body: result.isBase64Encoded ? result.body : JSON.parse(result.body!), result };
}

test('custom real/mock IDs create inventory on demand with a validated model', async (context) => {
  const { writes } = setup(context);
  const response = await call({ serialNumber: ' ce-gw-mck-001 ', modelId: 'model-a' });
  assert.equal(response.status, 201);
  assert.equal(response.body.identity.serialNumber, 'CE-GW-MCK-001');
  assert.deepEqual(response.body.allowedSites.map((item: { id: string }) => item.id), ['site-a']);
  const manufacturing = writes[0]!.input.TransactItems!.find((item) => item.Put?.Item?.entityType === 'MANUFACTURING')!.Put!;
  assert.equal(manufacturing.Item!.claimMechanism, 'OPERATOR_REGISTERED');
  assert.equal(manufacturing.Item!.bootstrapCertificateId, undefined);
  assert.equal(manufacturing.ConditionExpression, 'attribute_not_exists(PK)');
  assert.ok(writes[0]!.input.TransactItems!.some((item) => item.ConditionCheck?.Key?.SK === 'MODEL#model-a'));
});

test('blank IDs are generated once, replayed on retries, and cannot change model with the same key', async (context) => {
  const { writes } = setup(context);
  const first = await call({ modelId: 'model-a' });
  const replay = await call({ serialNumber: '   ', modelId: 'model-a' });
  assert.equal(first.status, 201);
  assert.match(first.body.identity.serialNumber, /^CE-GW-[A-F0-9]{16}$/);
  assert.deepEqual(replay.body, first.body);
  assert.equal(writes.length, 1);
  assert.equal((await call({ modelId: 'model-b' })).status, 409);
});

test('invalid inputs, unauthorized models, and auditors cannot register', async (context) => {
  const { writes } = setup(context);
  for (const serialNumber of ['A', 'bad id', 'X'.repeat(129), 123]) {
    assert.equal((await call({ serialNumber, modelId: 'model-a' })).status, 400);
  }
  assert.equal((await call({ serialNumber: 'CUSTOM-001' })).status, 400);
  assert.equal((await call({ serialNumber: 'CUSTOM-001', modelId: 'missing' })).status, 404);
  assert.equal((await call({ modelId: 'model-a' }, 'auditor-registration', 'claims/verify', 'auditor')).status, 403);
  assert.equal(writes.length, 0);
});

test('active reservations and other tenants cannot take an existing ID', async (context) => {
  const { writes } = setup(context);
  const body = { serialNumber: 'CUSTOM-001', modelId: 'model-a' };
  assert.equal((await call(body)).status, 201);
  assert.equal((await call(body, 'second-registration')).status, 409);
  assert.equal((await call(body, 'other-tenant-key', 'claims/verify', 'operator', 'tenant-b')).status, 409);
  assert.equal(writes.length, 1);
});

test('concurrent registration conflicts return an actionable conflict', async (context) => {
  setup(context);
  const original = ddb.send.bind(ddb);
  context.mock.method(ddb, 'send', async (command: unknown) => {
    if (command instanceof TransactWriteCommand) {
      throw Object.assign(new Error('conditional conflict'), { name: 'TransactionCanceledException' });
    }
    return original(command as GetCommand);
  });
  assert.equal((await call({ modelId: 'model-a' })).status, 409);
});

test('registration can start generation 5 before device credentials exist', async (context) => {
  const { writes } = setup(context);
  const registration = await call({ modelId: 'model-a' });
  const operation = await call({
    verificationId: registration.body.verificationId, siteId: 'site-a', profileVersionId: 'profile-v1',
  }, 'activate-unbound-gateway', 'operations');
  assert.equal(operation.status, 202, JSON.stringify(operation.body));
  assert.equal(operation.body.deploymentGeneration, 5);
  assert.equal(operation.body.state, 'CLAIM_ACCEPTED');
  assert.equal(operation.body.status, 'IN_PROGRESS');
  const update = writes[1]!.input.TransactItems!.find((item) => item.Update?.Key?.SK === 'MANUFACTURING')!.Update!;
  assert.equal(update.ExpressionAttributeValues![':claimMechanism'], 'OPERATOR_REGISTERED');
  assert.match(update.ConditionExpression!, /attribute_not_exists\(bootstrapCertificateId\)/);
});

test('prebound real devices retain their model and exact active certificate requirement', async (context) => {
  const record = {
    PK: 'SERIAL#REAL-001', entityType: 'MANUFACTURING', serialNumber: 'REAL-001',
    tenantId: 'tenant-a', modelId: 'real-model', state: 'CLAIMABLE',
    claimMechanism: 'PRELOADED_UNIQUE_BOOTSTRAP', bootstrapCertificateId: 'a'.repeat(64), bootstrapCertificateStatus: 'ACTIVE',
  };
  const { writes } = setup(context, record);
  const response = await call({ serialNumber: 'REAL-001', modelId: 'model-a' });
  assert.equal(response.status, 201);
  assert.equal(response.body.identity.modelId, 'real-model');
  const update = writes[0]!.input.TransactItems![0]!.Update!;
  assert.equal(update.ExpressionAttributeValues![':bootstrapCertificateId'], 'a'.repeat(64));
  assert.throws(() => registrationCredentialCondition({ ...record, bootstrapCertificateStatus: 'INACTIVE' }));
  assert.throws(() => registrationCredentialCondition({ claimMechanism: 'OPERATOR_REGISTERED', bootstrapCertificateId: 'a'.repeat(64) }));
});

test('bootstrap issuance binds a registered gateway without losing its pending assignment', async (context) => {
  const pending = {
    PK: 'SERIAL#MOCK-001', SK: 'MANUFACTURING', entityType: 'MANUFACTURING',
    serialNumber: 'MOCK-001', tenantId: 'tenant-a', modelId: 'model-a',
    siteId: 'site-a', profileVersionId: 'profile-v1', allowedSiteIds: ['site-a'],
    state: 'ENROLLMENT_PENDING', claimMechanism: 'OPERATOR_REGISTERED',
    verificationId: 'verification-a', gatewayId: 'gateway-a', operationId: 'operation-a',
    thingName: 'thing-a', signedDescriptor: { generation: 5 }, enrollmentAuthorizedAt: '2026-09-17T12:00:00Z',
    createdAt: '2026-09-17T12:00:00Z', updatedAt: '2026-09-17T12:00:00Z',
  };
  const { writes } = setup(context, pending);
  const iotCalls: unknown[] = [];
  context.mock.method(IoTClient.prototype, 'send', async (command: unknown) => {
    iotCalls.push(command);
    if (command instanceof CreateKeysAndCertificateCommand) return {
      certificateId: 'b'.repeat(64), certificateArn: `arn:aws:iot:us-east-1:111122223333:cert/${'b'.repeat(64)}`,
      certificatePem: 'test-certificate', keyPair: { PrivateKey: 'test-private-key' },
    };
    assert.ok(command instanceof AttachPolicyCommand);
    return {};
  });
  const body = { serialNumber: 'MOCK-001', modelId: 'model-a', siteId: 'site-a', profileVersionId: 'profile-v1', acknowledgeOneTimePrivateKey: true };
  const response = await call(body, 'bind-registered-mock', 'bootstrap-packages', 'tenant_admin');
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const item = writes[0]!.input.TransactItems!.find((item) => item.Put?.Item?.entityType === 'MANUFACTURING')!.Put!;
  assert.equal(item.Item!.claimMechanism, 'PRELOADED_UNIQUE_BOOTSTRAP');
  assert.equal(item.Item!.state, 'ENROLLMENT_PENDING');
  assert.equal(item.Item!.operationId, pending.operationId);
  assert.deepEqual(item.Item!.signedDescriptor, pending.signedDescriptor);
  assert.equal(item.Item!.enrollmentAuthorizedAt, pending.enrollmentAuthorizedAt);
  assert.match(item.ConditionExpression!, /attribute_not_exists\(bootstrapCertificateId\)/);
  assert.equal((await call(body, 'cannot-reissue-key', 'bootstrap-packages', 'tenant_admin')).status, 409);
  assert.equal(iotCalls.length, 2, 'no new credentials on retry');
});
