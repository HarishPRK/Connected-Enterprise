import type Anthropic from '@anthropic-ai/sdk';
import { tools, executeTool } from './tools.js';
import type { AgentClient } from './llm.js';

const SYSTEM_PROMPT = `
You are the Ask-AI assistant inside Connected Enterprise — a cloud dashboard for
SD-WAN gateways across multiple branches. The user manages those gateways and
asks you questions about network state, devices, alerts, traffic, and policy.

You have access to read-only diagnostic tools. When a question requires current
state, USE the tools — never speculate. If a question is about how the product
works (rather than current state), answer directly.

Style:
- Be concise. 2-4 short paragraphs maximum.
- Use markdown: **bold** for key terms, bullet lists for enumerations,
  \`inline code\` for IDs / IPs / values from tool output.
- Always cite the tool you used in parentheses, e.g. "(per get_device)".
- Don't write a "Recommendation:" or "Post-mortem:" header unless asked.
`.trim();

const MAX_ITER = 5;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRunOptions {
  messages: ChatMessage[];
  emit: (event: string, data: Record<string, unknown>) => void;
}

/** Multi-turn chat loop with tool use, used by /api/ask. Streams chunked text
 *  back to the client in `chunk` events; surfaces tool activity as `tool_using`
 *  events so the UI can show a status line while we're calling the gateway. */
export async function runChat(client: AgentClient, model: string, opts: ChatRunOptions): Promise<void> {
  const { messages, emit } = opts;

  // Convert chat history to Anthropic Messages API format.
  const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: [{ type: 'text', text: m.content }],
  }));

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let response: Anthropic.Messages.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools,
        messages: apiMessages,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit('error', { message: msg });
      return;
    }

    // Emit any text blocks as chunks (the client appends them to the streaming bubble).
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        emit('chunk', { text: block.text });
      }
    }

    if (response.stop_reason === 'end_turn') {
      emit('done', { iterations: iter + 1, usage: response.usage });
      return;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      const approved = new Set<string>(); // not used in chat — write tools always blocked

      for (const t of toolUseBlocks) {
        emit('tool_using', { tool: t.name, args: t.input });
        const result = await executeTool(t.name, (t.input ?? {}) as Record<string, unknown>, approved);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: t.id,
          content: JSON.stringify(result),
        });
      }
      apiMessages.push({ role: 'assistant', content: response.content });
      apiMessages.push({ role: 'user', content: toolResults });
      continue;
    }

    emit('done', { reason: response.stop_reason ?? 'unknown', iterations: iter + 1, usage: response.usage });
    return;
  }

  emit('done', { reason: 'max_iterations', iterations: MAX_ITER });
}
