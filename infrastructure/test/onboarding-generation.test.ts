import assert from 'node:assert/strict';
import test from 'node:test';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';

process.env.TABLE_NAME = 'onboarding-generation-test';
process.env.SIGNING_KEY_ID = 'arn:aws:kms:us-east-1:111122223333:key/test';
process.env.AWS_ACCOUNT_ID = '111122223333';
process.env.AWS_REGION = 'us-east-1';
process.env.PROVISIONING_TEMPLATE_ARN = 'arn:aws:iot:us-east-1:111122223333:provisioningtemplate/Test';
process.env.BOOTSTRAP_CLIENT_ID_PREFIX = 'claim-';

const { ddb } = await import('../lambda/shared/ddb.js');
const { handler: api } = await import('../lambda/api-handler.js');
const { handler: provision } = await import('../lambda/pre-provision-hook.js');
const { canonicalJson } = await import('../lambda/shared/profile.js');
const { sha256 } = await import('../lambda/shared/crypto.js');
const serialNumber = 'TEST-GENERATION-5';
const bootstrapCertificateId = 'a'.repeat(64);
const reservation = {
  entityType: 'MANUFACTURING', state: 'ENROLLMENT_PENDING',
  serialNumber, tenantId: 'tenant-a', gatewayId: 'gateway-a', operationId: 'operation-a',
  siteId: 'site-a', profileVersionId: 'profile-v3', deliveryMode: 'SHADOW',
  verificationId: 'verification-a', enrollmentAuthorizedAt: '2026-09-02T12:00:00.000Z',
  claimMechanism: 'PRELOADED_UNIQUE_BOOTSTRAP', bootstrapCertificateId,
  bootstrapCertificateStatus: 'ACTIVE', thingName: 'gw-generation-test',
  signedDescriptor: { generation: 5 },
};
const provisionEvent = {
  templateArn: process.env.PROVISIONING_TEMPLATE_ARN,
  claimCertificateId: bootstrapCertificateId, certificateId: 'b'.repeat(64),
  clientId: `claim-${serialNumber}`, parameters: { SerialNumber: serialNumber, Generation: '1' },
};

test('new AWS enrollment signs and reserves generation 5 consistently across all records', async (context) => {
  const writes: TransactWriteCommand[] = [];
  const digests: string[] = [];
  const expires = Math.floor(Date.now() / 1000) + 900;
  const profile = {
    entityType: 'PROFILE_VERSION', profileVersionId: 'profile-v3', profileId: 'profile-a',
    modelId: 'model-a', version: 3, schemaVersion: 2, documentHash: 'c'.repeat(64),
    objectKey: 'profile.json', manifestKey: 'manifest.json',
  };
  context.mock.method(ddb, 'send', async (command: unknown) => {
    if (command instanceof TransactWriteCommand) { writes.push(command); return {}; }
    if (command instanceof QueryCommand) return { Items: [profile] };
    assert.ok(command instanceof GetCommand);
    const key = command.input.Key!;
    if (String(key.SK).startsWith('IDEMPOTENCY#')) return {};
    if (key.SK === 'VERIFICATION#verification-a') {
      return { Item: { entityType: 'VERIFICATION', serialNumber, expiresAtEpoch: expires } };
    }
    if (key.SK === 'MANUFACTURING') return { Item: {
      ...reservation, state: 'RESERVED', modelId: 'model-a', verificationExpiresAtEpoch: expires,
    } };
    if (key.SK === 'SITE#site-a') return { Item: { entityType: 'SITE' } };
    throw new Error(`Unexpected read ${String(key.SK)}`);
  });
  context.mock.method(KMSClient.prototype, 'send', async (command: unknown) => {
    assert.ok(command instanceof SignCommand);
    digests.push(Buffer.from(command.input.Message!).toString('hex'));
    return { Signature: Buffer.from('test-signature') };
  });
  const event = {
    version: '2.0', routeKey: 'POST /api/onboarding/operations',
    headers: { 'idempotency-key': 'generation-default-test' },
    body: JSON.stringify({ verificationId: 'verification-a', siteId: 'site-a', profileVersionId: 'profile-v3', generation: 1 }),
    requestContext: { requestId: 'request-a', authorizer: { jwt: { claims: {
      token_use: 'access', sub: 'operator-a', tenant_id: 'tenant-a', tenant_role: 'tenant_admin',
    } } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
  const result = await api(event, {} as Context, () => {});
  assert.ok(result && typeof result === 'object');
  assert.equal(result.statusCode, 202, result.body);
  assert.equal(JSON.parse(result.body!).deploymentGeneration, 5);
  assert.equal(writes.length, 1);
  const items = writes[0]!.input.TransactItems!;
  const gateway = items.find((item) => item.Put?.Item?.entityType === 'GATEWAY')!.Put!.Item!;
  const deployment = items.find((item) => item.Put?.Item?.entityType === 'DEPLOYMENT')!.Put!.Item!;
  const operation = items.find((item) => item.Put?.Item?.entityType === 'OPERATION')!.Put!.Item!;
  assert.equal(gateway.generation, 5);
  assert.equal(gateway.desiredGeneration, 5);
  assert.equal(operation.deploymentGeneration, 5);
  assert.equal(deployment.generation, 5);
  assert.match(deployment.SK, /#000000000005$/);
  assert.equal(gateway.signedDescriptor.generation, 5);
  assert.equal(gateway.signedDescriptor.configurationClaim.generation, 5);
  assert.equal(gateway.signedDescriptor.profileVersion, 3, 'profile version stays independent');
  assert.deepEqual(deployment.descriptor, gateway.signedDescriptor);
  const manufacturing = items.find((item) => item.Update?.Key?.SK === 'MANUFACTURING')!.Update!;
  assert.deepEqual(manufacturing.ExpressionAttributeValues![':descriptor'], gateway.signedDescriptor);
  const unsigned = ({ signature: _signature, signingAlgorithm: _algorithm, ...value }: Record<string, unknown>) => value;
  assert.deepEqual(digests, [
    sha256(canonicalJson(unsigned(gateway.signedDescriptor.configurationClaim))),
    sha256(canonicalJson(unsigned(gateway.signedDescriptor))),
  ]);
});

for (const generation of [5, 1]) {
  test(`provisioning follows reserved generation ${generation}, independent of device input`, async (context) => {
    let transaction: TransactWriteCommand | undefined;
    context.mock.method(ddb, 'send', async (command: unknown) => {
      if (command instanceof GetCommand) return { Item: { ...reservation, signedDescriptor: { generation } } };
      assert.ok(command instanceof TransactWriteCommand);
      transaction = command;
      return {};
    });
    const result = await provision(provisionEvent);
    assert.equal(result.allowProvisioning, true);
    assert.ok(transaction);
    const items = transaction.input.TransactItems!;
    const generationFences = items.map((item) => item.Update ?? item.ConditionCheck)
      .filter((item) => item?.ExpressionAttributeValues?.[':generation'] !== undefined);
    assert.equal(generationFences.length, 4);
    for (const item of generationFences) assert.equal(item!.ExpressionAttributeValues![':generation'], generation);
    assert.ok(items.some((item) => item.ConditionCheck?.Key?.SK === `DEPLOYMENT#gateway-a#${String(generation).padStart(12, '0')}`));
    assert.match(items[0]!.Update!.ConditionExpression!, /signedDescriptor.generation = :generation/);
  });
}

test('missing or invalid reserved generation fails before any provisioning write', async (context) => {
  for (const generation of [undefined, '5', 0, -1, 1.5]) {
    const mock = context.mock.method(ddb, 'send', async (command: unknown) => {
      assert.ok(command instanceof GetCommand, 'invalid reservation must not write');
      return { Item: { ...reservation, signedDescriptor: { generation } } };
    });
    assert.equal((await provision(provisionEvent)).allowProvisioning, false);
    mock.mock.restore();
  }
});

test('a concurrent reservation change prevents provisioning', async (context) => {
  context.mock.method(ddb, 'send', async (command: unknown) => {
    if (command instanceof GetCommand) return { Item: reservation };
    assert.ok(command instanceof TransactWriteCommand);
    throw Object.assign(new Error('reservation changed'), { name: 'TransactionCanceledException' });
  });
  assert.equal((await provision(provisionEvent)).allowProvisioning, false);
});
