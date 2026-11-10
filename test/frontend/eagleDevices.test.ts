import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEagleDevicesResponse } from '../../src/ui/useEagleDevices';

test('accepts an empty catalog and normalizes real serials without inventing options', () => {
  assert.deepEqual(parseEagleDevicesResponse({ devices: [] }), []);
  assert.deepEqual(parseEagleDevicesResponse({ devices: ['B-2', 'A:1', 'B-2'] }), ['A:1', 'B-2']);
});

test('invalid catalogs are errors rather than plausible empty or incomplete lists', () => {
  for (const value of [null, {}, { devices: 'A' }, { devices: ['A', 1] }, { devices: ['${Device}'] }]) {
    assert.throws(() => parseEagleDevicesResponse(value), /invalid list/);
  }
});
