import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { runChat } from './chat.js';
import type { AgentClient } from './llm.js';

type Request = Anthropic.Messages.MessageCreateParamsNonStreaming;

function endTurn(): Anthropic.Messages.Message {
  return {
    id: 'msg-live-only',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Live telemetry checked.', citations: null }],
    model: 'test-model',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 4,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as Anthropic.Messages.Message;
}

test('Ask chat sends only live read-only tools and the selected branch context', async () => {
  const calls: Request[] = [];
  const create = (async (request: Request) => {
    calls.push(request);
    return endTurn();
  }) as AgentClient['messages']['create'];
  const events: string[] = [];

  await runChat(
    { messages: { create } },
    'test-model',
    {
      branchId: 'b-mck-03',
      messages: [{ role: 'user', content: 'What are the WAN RX and TX rates right now?' }],
      emit: (event) => events.push(event),
    },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].tools?.map((tool) => tool.name),
    ['get_live_branch_wan', 'get_live_branch_devices'],
  );
  const system = calls[0].system as Anthropic.Messages.TextBlockParam[];
  assert.match(system[0].text, /no demo/i);
  assert.match(system[0].text, /Selected Connected Enterprise branch ID: b-mck-03/);
  assert.deepEqual(events, ['chunk', 'done']);
});

test('Ask chat applies the saved response style and cancels before calling a provider', async () => {
  const calls: Request[] = [];
  const create = (async (request: Request) => { calls.push(request); return endTurn(); }) as AgentClient['messages']['create'];
  const opts = {
    branchId: 'b-mck-03', messages: [{ role: 'user' as const, content: 'Explain the gateway.' }], emit: () => {},
    preferences: { model: 'haiku' as const, tone: 'detailed' as const, timeZone: 'UTC' as const },
  };
  await runChat({ messages: { create } }, 'configured-model', opts);
  assert.equal(calls[0].model, 'configured-model');
  assert.equal(calls[0].max_tokens, 2048);
  assert.match((calls[0].system as Anthropic.Messages.TextBlockParam[])[0].text, /detailed explanation/);
  assert.match((calls[0].system as Anthropic.Messages.TextBlockParam[])[0].text, /Use UTC/);
  await runChat({ messages: { create } }, 'configured-model', { ...opts, signal: AbortSignal.abort() });
  assert.equal(calls.length, 1);
});

test('an unoffered Ask tool cannot fall through to demo diagnostics', async () => {
  const calls: Request[] = [];
  const create = (async (request: Request) => {
    calls.push(request);
    return calls.length === 1
      ? { ...endTurn(), content: [{ type: 'tool_use', id: 'unexpected', name: 'get_wan_status', input: {} }], stop_reason: 'tool_use' }
      : endTurn();
  }) as AgentClient['messages']['create'];
  await runChat({ messages: { create } }, 'configured-model', {
    branchId: 'b-mck-03', messages: [{ role: 'user', content: 'Check WAN.' }], emit: () => {},
  });
  const result = calls[1].messages.at(-1)?.content as Anthropic.Messages.ToolResultBlockParam[];
  assert.match(String(result[0].content), /unavailable in this read-only chat/);
  assert.doesNotMatch(String(result[0].content), /active.*Fiber/);
});

test('Ask chat uses a direct live response when the LLM fails', async () => {
  const create = (async () => {
    throw new Error('Bedrock 400 Bad Request: Error 002');
  }) as AgentClient['messages']['create'];
  const events: { event: string; data: Record<string, unknown> }[] = [];

  await runChat(
    { messages: { create } },
    'test-model',
    {
      branchId: 'b-pln-01',
      messages: [{ role: 'user', content: 'Are any IPsec tunnels unreachable right now?' }],
      emit: (event, data) => events.push({ event, data }),
      minimumResponseMs: 0,
    },
  );

  assert.ok(!events.some(({ event }) => event === 'error'));
  assert.ok(events.some(({ event }) => event === 'tool_using'));
  assert.match(String(events.find(({ event }) => event === 'chunk')?.data.text), /^\*\*WAN\/IPsec/);
  assert.equal(events.find(({ event }) => event === 'done')?.data.mode, 'live-telemetry');
});

test('Ask chat uses a direct live response when no LLM is configured', async () => {
  const events: { event: string; data: Record<string, unknown> }[] = [];

  await runChat(
    null,
    'unused-model',
    {
      branchId: 'b-pln-01',
      messages: [{ role: 'user', content: 'How many devices are healthy or offline right now?' }],
      emit: (event, data) => events.push({ event, data }),
      minimumResponseMs: 0,
    },
  );

  assert.ok(!events.some(({ event }) => event === 'error'));
  assert.equal(events.find(({ event }) => event === 'done')?.data.mode, 'live-telemetry');
});
