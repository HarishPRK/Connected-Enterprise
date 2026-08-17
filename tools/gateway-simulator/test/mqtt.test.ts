import assert from 'node:assert/strict';
import test from 'node:test';
import { persistBeforeRegisterThing } from '../src/mqtt.js';

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
