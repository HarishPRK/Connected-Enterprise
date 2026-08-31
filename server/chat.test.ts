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
  assert.match(system[0].text, /no simulated/i);
  assert.match(system[0].text, /Selected Connected Enterprise branch ID: b-mck-03/);
  assert.deepEqual(events, ['chunk', 'done']);
});
