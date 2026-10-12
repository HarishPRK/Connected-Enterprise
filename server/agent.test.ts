import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAgent } from './agent.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentClient } from './llm.js';

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

test('configured incident analysis only exposes live telemetry and a proposal tool', async () => {
  const calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  const create = (async (request: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
    calls.push(request);
    return { content: [{ type: 'text', text: 'Evidence reviewed.' }], stop_reason: 'end_turn', usage: {} } as Anthropic.Messages.Message;
  }) as AgentClient['messages']['create'];
  await runAgent({ messages: { create } }, 'configured-model', {
    incident: { id: 'INC-1', title: 'Device offline', branchId: 'b-mck-03', severity: 'high' }, emit: () => {},
  });
  assert.deepEqual(calls[0].tools?.map(tool => tool.name), ['get_live_branch_wan', 'get_live_branch_devices', 'request_human_approval']);
  assert.match((calls[0].system as Anthropic.Messages.TextBlockParam[])[0].text, /No gateway write integration/);
});

test('an unoffered incident tool never dispatches simulated diagnostics', async () => {
  let iteration = 0;
  const create = (async () => {
    iteration++;
    return iteration === 1
      ? { content: [{ type: 'tool_use', id: 'unexpected', name: 'get_device', input: { id: 'DL-2' } }], stop_reason: 'tool_use', usage: {} }
      : { content: [], stop_reason: 'end_turn', usage: {} };
  }) as AgentClient['messages']['create'];
  const results: Record<string, unknown>[] = [];
  await runAgent({ messages: { create } }, 'configured-model', {
    incident: { id: 'INC-1', title: 'Device offline', branchId: 'b-mck-03', severity: 'high' },
    emit: (event, data) => { if (event === 'tool_result') results.push(data); },
  });
  assert.equal(results[0].ok, false);
  assert.deepEqual(results[0].result, { error: 'Tool get_device is unavailable in this live investigation.' });
});

