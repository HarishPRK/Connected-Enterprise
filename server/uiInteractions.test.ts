import assert from 'node:assert/strict';
import test from 'node:test';
import { orderCommandItems } from '../src/ui/commandResults.js';
import { csvCell } from '../src/ui/download.js';
import { matchesDeviceInventory } from '../src/ui/deviceInventory.js';

test('command result indexes match visual groups when navigation resumes after operations', () => {
  const input = [
    { group: 'Navigate', id: 'home' },
    { group: 'Operate', id: 'incidents' },
    { group: 'Navigate', id: 'ask-ai' },
    { group: 'Navigate', id: 'settings' },
    { group: 'Switch branch', id: 'mckinney' },
  ];
  const results = orderCommandItems(input);
  assert.deepEqual(results.map((item) => item.id), ['home', 'ask-ai', 'settings', 'incidents', 'mckinney']);
  assert.equal(results[1].id, 'ask-ai');
  assert.equal(input[1].id, 'incidents', 'grouping does not mutate source commands');
});

test('unmapped branches cannot display another site’s live inventory', () => {
  const device = { locationSource: 'prpl' as const, inventoryTopics: ['prplhome/ipsec/metrics'] };
  assert.equal(matchesDeviceInventory(device), false);
  assert.equal(matchesDeviceInventory(device, 'prpl', 'prplhome/ipsec/metrics'), true);
  assert.equal(matchesDeviceInventory(device, 'rdk', 'rdk/ipsec/metrics'), false);
});

test('CSV exports preserve quotes and lines without executing inventory formulas', () => {
  assert.equal(csvCell('printer,"north"\nwing'), '"printer,""north""\nwing"');
  for (const input of ['=HYPERLINK("https://example.test")', '+cmd', '@SUM(A1)', '\t=SUM(A1)', '-5+7']) {
    assert.equal(csvCell(input).startsWith('"\''), true);
  }
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(0), '"0"');
  assert.equal(csvCell(-92), '"-92"');
});
