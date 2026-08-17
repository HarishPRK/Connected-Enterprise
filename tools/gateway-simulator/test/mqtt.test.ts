import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLAIM_CLIENT_ID_PREFIX,
  createClaimClientId,
  persistBeforeRegisterThing,
  registrationParameters,
} from '../src/mqtt.js';

test('bootstrap session client IDs use the gateway-compatible claim prefix', () => {
  const first = createClaimClientId();
  const second = createClaimClientId();
  assert.equal(CLAIM_CLIENT_ID_PREFIX, 'claim-');
  assert.match(first, /^claim-[0-9a-f]{32}$/);
  assert.match(second, /^claim-[0-9a-f]{32}$/);
  assert.notEqual(first, second);
});

test('RegisterThing parameters contain only the server-authorized serial number', () => {
  assert.deepEqual(registrationParameters('SNA8C2463D4248'), { SerialNumber: 'SNA8C2463D4248' });
});

test('issued certificate persistence completes before RegisterThing and excludes the ownership token', async () => {
  const certificatePem = 'issued-operational-certificate';
  const ownershipToken = 'memory-only-ownership-token';
  const calls: string[] = [];
  let persistedValue: string | undefined;

  const result = await persistBeforeRegisterThing(
    certificatePem,
    async function persist(value) {
      calls.push('persist');
      persistedValue = value;
      assert.equal(arguments.length, 1);
    },
    async () => {
      calls.push('register');
      assert.equal(persistedValue, certificatePem);
      assert.equal(ownershipToken, 'memory-only-ownership-token');
      return { thingName: 'gw-test' };
    },
  );

  assert.deepEqual(calls, ['persist', 'register']);
  assert.equal(persistedValue, certificatePem);
  assert.notEqual(persistedValue, ownershipToken);
  assert.equal(result.thingName, 'gw-test');
});
