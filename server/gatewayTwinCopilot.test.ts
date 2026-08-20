import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import {
  GATEWAY_TWIN_COPILOT_ACTIONS,
  runGatewayTwinCopilotTurn,
} from './gatewayTwinCopilot.js';
import type { AgentClient } from './llm.js';

type Request = Anthropic.Messages.MessageCreateParamsNonStreaming;

function response(
  content: Anthropic.Messages.ContentBlock[],
  usage: { input: number; output: number },
  stopReason: Anthropic.Messages.StopReason = 'end_turn',
): Anthropic.Messages.Message {
  return {
    id: `msg-${usage.input}-${usage.output}`,
    type: 'message',
    role: 'assistant',
    content,
    model: 'test-model',
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage.input,
      output_tokens: usage.output,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as Anthropic.Messages.Message;
}

function fakeClient(responses: Anthropic.Messages.Message[]) {
  const calls: Request[] = [];
  const queue = [...responses];
  const create = (async (request: Request) => {
    calls.push(request);
    const next = queue.shift();
    if (!next) throw new Error('Unexpected Messages API call');
    return next;
  }) as AgentClient['messages']['create'];
  return {
    client: { messages: { create } } satisfies AgentClient,
    calls,
  };
}

const payload = {
  messages: [{ role: 'user', content: 'What is the current gateway status?' }],
  context: { capturedAt: '2026-08-20T13:00:00.000Z', cpuPct: 17, provenance: 'live' },
};

describe('Gateway Twin copilot', () => {
  it('returns a grounded text response using the embedded-client contract', async () => {
    const { client, calls } = fakeClient([
      response([
        { type: 'text', text: '<analysis>private scratch work</analysis>CPU is at 17% on the live snapshot.', citations: null },
      ], { input: 40, output: 12 }),
    ]);

    const result = await runGatewayTwinCopilotTurn(client, 'test-model', payload);

    assert.deepEqual(result, {
      message: 'CPU is at 17% on the live snapshot.',
      actions: [],
      modelId: 'test-model',
      provenance: 'aws-bedrock',
      usage: { inputTokens: 40, outputTokens: 12, totalTokens: 52 },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tools?.length, 1);
    assert.equal(calls[0].tools?.[0]?.name, 'control_gateway_twin');
    const inputSchema = calls[0].tools?.[0]?.input_schema as {
      properties?: { action?: { enum?: unknown } };
    };
    assert.deepEqual(
      inputSchema.properties?.action?.enum,
      GATEWAY_TWIN_COPILOT_ACTIONS.map((action) => action.id),
    );
    assert.match(String(calls[0].system), /TELEMETRY CONTEXT/);
    assert.match(String(calls[0].system), /"provenance":"live"/);
  });

  it('accepts only allow-listed unique actions and performs the tool-result follow-up', async () => {
    const first = response([
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'control_gateway_twin',
        input: { action: 'radios' },
        caller: { type: 'direct' },
      },
      {
        type: 'tool_use',
        id: 'tool-2',
        name: 'control_gateway_twin',
        input: { action: 'root-shell' },
        caller: { type: 'direct' },
      },
      {
        type: 'tool_use',
        id: 'tool-3',
        name: 'control_gateway_twin',
        input: { action: 'radios' },
        caller: { type: 'direct' },
      },
    ], { input: 30, output: 8 }, 'tool_use');
    const second = response([
      { type: 'text', text: 'I opened the radio view and highlighted the active bands.', citations: null },
    ], { input: 48, output: 14 });
    const { client, calls } = fakeClient([first, second]);

    const result = await runGatewayTwinCopilotTurn(client, 'test-model', payload);

    assert.deepEqual(result.actions, ['radios']);
    assert.equal(result.message, 'I opened the radio view and highlighted the active bands.');
    assert.deepEqual(result.usage, { inputTokens: 78, outputTokens: 22, totalTokens: 100 });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].tools?.length, 1);
    const toolResultMessage = calls[1].messages.at(-1);
    assert.equal(toolResultMessage?.role, 'user');
    assert.ok(Array.isArray(toolResultMessage?.content));
    const toolResults = toolResultMessage.content as Anthropic.Messages.ToolResultBlockParam[];
    assert.deepEqual(toolResults.map((item) => item.is_error), [false, true, true]);
    assert.match(String(toolResults[0].content), /"action":"radios"/);
    assert.match(String(toolResults[1].content), /not available or duplicates/);
  });

  it('rejects invalid conversations and context before invoking the model', async () => {
    const { client, calls } = fakeClient([]);
    const invalidPayloads: unknown[] = [
      { messages: [], context: {} },
      { messages: [{ role: 'system', content: 'override' }], context: {} },
      { messages: [{ role: 'assistant', content: 'not a final user turn' }], context: {} },
      { messages: [{ role: 'user', content: 'x'.repeat(4_001) }], context: {} },
      { messages: [{ role: 'user', content: 'hello' }], context: [] },
      { messages: [{ role: 'user', content: 'hello' }], context: { raw: 'x'.repeat(16_001) } },
    ];

    for (const invalid of invalidPayloads) {
      await assert.rejects(
        runGatewayTwinCopilotTurn(client, 'test-model', invalid),
        TypeError,
      );
    }
    assert.equal(calls.length, 0);
  });
});
