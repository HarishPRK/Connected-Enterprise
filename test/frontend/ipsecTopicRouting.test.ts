import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRANCH_TO_DEVICE_TOPIC,
  BRANCH_TO_FAILOVER_TOPIC,
  BRANCH_TO_WAN_TOPIC,
} from '../../src/data/mock';

test('McKinney routes only Overview WAN traffic to the prplhome feed', () => {
  assert.equal(BRANCH_TO_FAILOVER_TOPIC['b-mck-03'], 'prpl/ipsec/metrics');
  assert.equal(BRANCH_TO_WAN_TOPIC['b-mck-03'], 'prplhome/ipsec/metrics');
  assert.equal(BRANCH_TO_DEVICE_TOPIC['b-mck-03'], 'prplhome/ipsec/metrics');
});

test('Plano keeps all IPsec surfaces on its rdk feed', () => {
  assert.equal(BRANCH_TO_FAILOVER_TOPIC['b-pln-01'], 'rdk/ipsec/metrics');
  assert.equal(BRANCH_TO_WAN_TOPIC['b-pln-01'], 'rdk/ipsec/metrics');
  assert.equal(BRANCH_TO_DEVICE_TOPIC['b-pln-01'], 'rdk/ipsec/metrics');
});
