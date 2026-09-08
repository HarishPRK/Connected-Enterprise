import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAgent } from './agent.js';

test('incident analysis completes from current telemetry without a model client', async () => {
  const events: { event: string; data: Record<string, unknown> }[] = [];
  await runAgent(null, 'unused', {
    incident: {
      id: 'INC-123',
      title: 'Branch connectivity degraded',
      branchId: 'plano',
      severity: 'high',
      agentName: 'Network Specialist',
    },
    minimumResponseMs: 0,
    emit: (event, data) => events.push({ event, data }),
  });

  assert.equal(events.some(({ event }) => event === 'error'), false);
  assert.equal(events.filter(({ event }) => event === 'tool_call').length, 2);
  assert.match(String(events.find(({ event }) => event === 'thought')?.data.content), /INC-123/);
  assert.equal(events.at(-1)?.event, 'done');
  assert.equal(events.at(-1)?.data.reason, 'analysis_complete');
});

