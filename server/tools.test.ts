import assert from 'node:assert/strict';
import test from 'node:test';
import { askTools, tools } from './tools.js';

test('Ask AI exposes only request-time read-only live tools', () => {
  assert.deepEqual(
    askTools.map((tool) => tool.name),
    ['get_live_branch_wan', 'get_live_branch_devices'],
  );
});

test('legacy agent flows retain their existing demo and guarded write tools', () => {
  const names = new Set(tools.map((tool) => tool.name));
  assert.ok(names.has('get_device'));
  assert.ok(names.has('query_alerts'));
  assert.ok(names.has('get_wan_status'));
  assert.ok(names.has('request_human_approval'));
  assert.ok(names.has('force_dhcp_renew'));
  assert.ok(!names.has('get_live_branch_wan'));
  assert.ok(!names.has('get_live_branch_devices'));
});
