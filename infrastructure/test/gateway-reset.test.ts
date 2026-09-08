import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IoTClient } from '@aws-sdk/client-iot';
import { IoTDataPlaneClient } from '@aws-sdk/client-iot-data-plane';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';

process.env.TABLE_NAME = 'reset-test';
process.env.AWS_ACCOUNT_ID = '111122223333';
process.env.AWS_REGION = 'us-east-1';
process.env.STAGE = 'dev';
const { ddb } = await import('../lambda/shared/ddb.js');
const { cleanupGatewayIdentity, requestGatewayReset, resetGatewayRegistration } = await import('../lambda/shared/gateway-reset.js');
const serialNumber = 'CE-RESET-TEST';
const digest = createHash('sha256').update(serialNumber).digest('hex').slice(0, 24);
const PK = 'TENANT#tenant-a';
const identity = { tenantId: 'tenant-a', serialNumber, gatewayId: `gw_${digest}`, thingName: `gw-${digest}`,
  certificateId: 'a'.repeat(64), bootstrapCertificateId: 'b'.repeat(64) };
const outbox = { ...identity, PK, SK: 'OUTBOX#test', outboxId: 'out-test', operationId: 'op-reset' };
const arn = (id: string) => `arn:aws:iot:us-east-1:111122223333:cert/${id}`;
type Item = Record<string, any>;

function fixture(context: TestContext, options: { pending?: boolean; missing?: boolean; foreignCertificate?: boolean; cloudFailure?: boolean; leaseBusy?: boolean; released?: boolean } = {}) {
  const gateway: Item = { ...identity, PK, SK: `GATEWAY#${identity.gatewayId}`, entityType: 'GATEWAY',
    state: 'DECOMMISSIONING', certificateStatus: 'REVOKING', generation: 5, siteId: 'lab',
    operationId: 'op-reset', resetOperationId: 'op-reset' };
  const manufacturing: Item = { ...identity, PK: `SERIAL#${serialNumber}`, SK: 'MANUFACTURING', entityType: 'MANUFACTURING',
    state: 'DECOMMISSIONING', operationId: 'op-onboard', resetOperationId: 'op-reset',
    claimMechanism: 'PRELOADED_UNIQUE_BOOTSTRAP', bootstrapCertificateStatus: 'INACTIVE' };
  const binding = { PK: `BOOTSTRAPCERT#${identity.bootstrapCertificateId}`, SK: 'BINDING', entityType: 'BOOTSTRAP_CERTIFICATE_BINDING',
    tenantId: identity.tenantId, serialNumber, bootstrapCertificateId: identity.bootstrapCertificateId };
  const operation: Item = { PK, SK: 'OPERATION#op-reset', entityType: 'OPERATION', resetForOnboarding: true,
    ...(options.released ? { registrationReleased: true } : {}) };
  const transactions: Item[][] = [];
  const cloud: string[] = [];
  const writes: Item[] = [];
  if (options.pending) { delete gateway.certificateId; delete manufacturing.certificateId; }
  let thingExists = !options.missing && !options.pending;
  const certificates = new Set(options.missing ? [] : options.pending ? [identity.bootstrapCertificateId] : [identity.certificateId, identity.bootstrapCertificateId]);
  const missing = () => { throw Object.assign(new Error('absent'), { name: 'ResourceNotFoundException' }); };
  context.mock.method(ddb, 'send', async (command: any) => {
    if (command instanceof GetCommand) {
      const key = command.input.Key!;
      if (key.SK === gateway.SK) return { Item: gateway };
      if (key.SK === 'MANUFACTURING') return { Item: manufacturing };
      if (key.SK === 'BINDING') return { Item: binding };
      if (key.SK === operation.SK) return { Item: operation };
      if (key.SK === outbox.SK) return { Item: outbox };
      throw new Error(`Unexpected key ${key.SK}`);
    }
    if (command instanceof QueryCommand) {
      if (String(command.input.ExpressionAttributeValues?.[':prefix']).startsWith('DEPLOYMENT#')) return { Items: [5, 6].map((generation) => ({
        PK, SK: `DEPLOYMENT#${identity.gatewayId}#${String(generation).padStart(12, '0')}`, entityType: 'DEPLOYMENT',
        tenantId: identity.tenantId, gatewayId: identity.gatewayId, generation, operationId: `op-${generation}`,
      })) };
      return { Items: [] };
    }
    if (command instanceof TransactWriteCommand) { transactions.push(command.input.TransactItems!); return {}; }
    assert.ok(command instanceof UpdateCommand);
    writes.push(command.input);
    if (options.leaseBusy && command.input.UpdateExpression?.includes('resetLeaseId =')) {
      throw Object.assign(new Error('lease held'), { name: 'ConditionalCheckFailedException' });
    }
    return {};
  });
  context.mock.method(IoTClient.prototype, 'send', async (command: any) => {
    const name = command.constructor.name;
    cloud.push(name);
    if (name === 'DescribeThingCommand') return thingExists ? { attributes: { serialNumber, tenantId: identity.tenantId, gatewayId: identity.gatewayId }, thingTypeName: 'ConnectedEnterpriseGateway-dev' } : missing();
    if (name === 'DescribeCertificateCommand') return certificates.has(command.input.certificateId) ? { certificateDescription: { status: 'ACTIVE' } } : missing();
    if (name === 'ListThingPrincipalsCommand') return { principals: thingExists ? [arn(identity.certificateId)] : [] };
    if (name === 'ListPrincipalThingsCommand') return { things: options.foreignCertificate ? ['another-gateway'] : [] };
    if (name === 'ListAttachedPoliciesCommand') return { policies: [{ policyName: 'ConnectedEnterpriseGatewayOperational-dev-v1' }] };
    if (name === 'ListThingGroupsForThingCommand') return { thingGroups: [] };
    if (name === 'ListJobExecutionsForThingCommand') return { executionSummaries: [] };
    if (name === 'DeleteCertificateCommand') {
      if (options.cloudFailure) throw Object.assign(new Error('Access denied'), { name: 'AccessDeniedException' });
      certificates.delete(command.input.certificateId);
    }
    if (name === 'DeleteThingCommand') thingExists = false;
    return {};
  });
  context.mock.method(IoTDataPlaneClient.prototype, 'send', async (command: any) => {
    cloud.push(command.constructor.name);
    return command.constructor.name === 'ListNamedShadowsForThingCommand' ? { results: ['configuration'] } : {};
  });
  return { gateway, manufacturing, operation, transactions, cloud, writes };
}

test('reset removes dedicated identities and archives all generations before releasing the serial', async (context) => {
  const f = fixture(context);
  await resetGatewayRegistration(outbox, 'lease-test');
  assert.ok(f.cloud.indexOf('UpdateCertificateCommand') < f.cloud.indexOf('DeleteConnectionCommand'));
  assert.ok(f.cloud.indexOf('DetachPolicyCommand') < f.cloud.indexOf('DeleteCertificateCommand'));
  assert.equal(f.cloud.filter((name) => name === 'DeleteCertificateCommand').length, 2);
  assert.equal(f.transactions.length, 3, 'two generation archives and final release');
  for (const transaction of f.transactions.slice(0, 2)) {
    assert.match(transaction[0]!.ConditionCheck.ConditionExpression, /resetLeaseId/);
    assert.equal(transaction[1]!.Put.Item.entityType, 'GATEWAY_RESET_ARCHIVE');
  }
  const final = f.transactions.at(-1)!;
  assert.equal(final.filter((item) => item.Delete).length, 2);
  assert.ok(final.some((item) => item.Update?.UpdateExpression.includes('registrationReleased')));
  assert.ok(final.some((item) => item.Put?.Item.action === 'GATEWAY_REGISTRATION_RELEASED'));
});

test('partial AWS failure keeps the serial reserved and exposes a retry', async (context) => {
  const f = fixture(context, { cloudFailure: true });
  await assert.rejects(resetGatewayRegistration(outbox, 'lease-test'), /Access denied/);
  assert.equal(f.transactions.flat().some((item) => item.Delete), false);
  assert.ok(f.transactions.flat().some((item) => item.Update?.UpdateExpression.includes('resetError')));
});

test('a retry accepts already absent AWS resources and completes the fenced release', async (context) => {
  const f = fixture(context, { missing: true });
  await resetGatewayRegistration(outbox, 'lease-test');
  assert.equal(f.cloud.includes('DeleteCertificateCommand'), false);
  assert.ok(f.transactions.at(-1)!.some((item) => item.Delete?.Key.SK === 'MANUFACTURING'));
});

test('completed stream replay never touches a later AWS registration', async (context) => {
  const f = fixture(context, { released: true });
  await resetGatewayRegistration(outbox, 'lease-test');
  assert.deepEqual(f.cloud, []);
  assert.deepEqual(f.transactions, []);
});

test('another worker holding the lease prevents external cleanup', async (context) => {
  const f = fixture(context, { leaseBusy: true });
  await assert.rejects(resetGatewayRegistration(outbox, 'lease-test'), /lease held/);
  assert.deepEqual(f.cloud, []);
});

test('shared certificates are rejected before disabling either credential', async (context) => {
  const f = fixture(context, { foreignCertificate: true });
  await assert.rejects(cleanupGatewayIdentity(identity), /another gateway/);
  assert.equal(f.cloud.some((name) => name.startsWith('Update') || name.startsWith('Delete') || name.startsWith('Detach')), false);
});

test('cross-tenant or changed certificate bindings cannot reset a gateway', async (context) => {
  const f = fixture(context);
  f.manufacturing.tenantId = 'other-tenant';
  await assert.rejects(resetGatewayRegistration(outbox, 'lease-test'), /does not match/);
  assert.deepEqual(f.cloud, []);
});

test('an already decommissioned gateway can queue an atomic reset without releasing its serial early', async (context) => {
  const f = fixture(context);
  delete f.gateway.resetOperationId;
  f.gateway.state = 'DECOMMISSIONED'; f.gateway.certificateStatus = 'REVOKED'; f.gateway.operationId = 'old-op';
  f.manufacturing.state = 'DECOMMISSIONED';
  const result = await requestGatewayReset({ tenantId: 'tenant-a', subject: 'admin', role: 'tenant_admin' }, f.gateway,
    () => ({ PK, SK: 'IDEMPOTENCY#reset-test', entityType: 'IDEMPOTENCY' }));
  assert.equal(result.resetForOnboarding, true);
  assert.equal(result.operationStatus, 'IN_PROGRESS');
  assert.equal(f.transactions.flat().some((item) => item.Delete), false);
  assert.ok(f.transactions.flat().some((item) => item.Put?.Item.eventType === 'RESET_GATEWAY_REGISTRATION'));
  assert.deepEqual(f.cloud, []);
});

test('pending enrollment can be cancelled before a permanent certificate exists, fenced against concurrent provisioning', async (context) => {
  const f = fixture(context, { pending: true });
  delete f.gateway.resetOperationId;
  f.gateway.state = 'PENDING'; f.gateway.certificateState = 'PENDING'; delete f.gateway.certificateStatus;
  f.manufacturing.state = 'ENROLLMENT_PENDING'; f.manufacturing.bootstrapCertificateStatus = 'ACTIVE';
  const result = await requestGatewayReset({ tenantId: 'tenant-a', subject: 'admin', role: 'tenant_admin' }, f.gateway,
    () => ({ PK, SK: 'IDEMPOTENCY#pending-reset', entityType: 'IDEMPOTENCY' }));
  assert.equal(result.resetForOnboarding, true);
  const fences = f.transactions[0]!.filter((item) => item.Update);
  assert.equal(fences.length, 2);
  for (const item of fences) {
    assert.match(item.Update.ConditionExpression, /attribute_not_exists\(certificateId\)/);
    assert.match(item.Update.ConditionExpression, /attribute_not_exists\(certificatePrincipal\)/);
    assert.equal(':cert' in item.Update.ExpressionAttributeValues, false);
  }
  assert.deepEqual(f.cloud, []);
});

test('pending reset deletes its bootstrap certificate and releases the serial without an IoT Thing', async (context) => {
  const f = fixture(context, { pending: true });
  const { certificateId: unused, ...pendingOutbox } = outbox;
  await resetGatewayRegistration(pendingOutbox, 'lease-pending');
  assert.equal(f.cloud.filter((name) => name === 'DeleteCertificateCommand').length, 1);
  const release = f.transactions.at(-1)!.find((item) => item.Delete?.Key.SK === 'MANUFACTURING');
  assert.match(release!.Delete.ConditionExpression, /attribute_not_exists\(certificateId\)/);
});

test('an identity that changed during enrollment is not treated as a certificate-free reset', async (context) => {
  const f = fixture(context, { pending: true });
  f.manufacturing.certificateId = identity.certificateId;
  const { certificateId: unused, ...pendingOutbox } = outbox;
  await assert.rejects(resetGatewayRegistration(pendingOutbox, 'lease-race'), /does not match/);
  assert.deepEqual(f.cloud, []);
});
