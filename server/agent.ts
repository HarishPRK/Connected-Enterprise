import type Anthropic from '@anthropic-ai/sdk';
import { tools, executeTool } from './tools.js';
import { pickPersona } from './prompts.js';
import type { AgentClient } from './llm.js';

export interface RunOptions {
  incident: {
    id: string;
    title: string;
    branchId: string;
    severity: string;
    agentName?: string;
  };
  /** Called for every emit (thought, tool_call, tool_result, system, done, error). */
  emit: (event: string, data: Record<string, unknown>) => void;
}

const MAX_ITER = 8;

/** Same loop works against either Anthropic direct API or Bedrock — the client
 *  type differs only in construction. The Messages API surface is identical. */
export async function runAgent(client: AgentClient, model: string, opts: RunOptions): Promise<void> {
  const { incident, emit } = opts;
  const persona = pickPersona(incident.agentName);

  emit('system', { content: `Agent attached · model ${model} · persona "${incident.agentName ?? 'default'}"` });

  // Set used to track which write actions have been approved (mock approval flow).
  const approvedActions = new Set<string>();

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `Incident ${incident.id}\n` +
            `Title: ${incident.title}\n` +
            `Branch: ${incident.branchId}\n` +
            `Severity: ${incident.severity}\n\n` +
            `Investigate, diagnose, and propose remediation. Use tools as needed. ` +
            `If you want to perform a write action, request human approval first.`,
        },
      ],
    },
  ];

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let response: Anthropic.Messages.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 1500,
        system: [
          { type: 'text', text: persona, cache_control: { type: 'ephemeral' } },
        ],
        tools,
        messages,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit('error', { message: msg });
      return;
    }

    // Emit any text blocks as agent "thought" steps.
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        emit('thought', { content: block.text.trim() });
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

      const toolResultsForApi: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const t of toolUseBlocks) {
        emit('tool_call', { id: t.id, tool: t.name, args: t.input });

        const result = await executeTool(
          t.name,
          (t.input ?? {}) as Record<string, unknown>,
          approvedActions,
        );

        const ok = !(typeof result === 'object' && result !== null && 'error' in (result as object));
        emit('tool_result', { id: t.id, tool: t.name, ok, result });

        // If the agent just requested approval, surface a "proposal" event for the UI
        // and stop the loop. The UI's approve button will need to call back in to
        // resume — for now, we simulate by terminating the run.
        if (t.name === 'request_human_approval') {
          emit('proposal', { tool: t.name, args: t.input });
          emit('done', { reason: 'awaiting_approval', iterations: iter + 1, usage: response.usage });
          return;
        }

        toolResultsForApi.push({
          type: 'tool_result',
          tool_use_id: t.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResultsForApi });
      continue;
    }

    // Anything else (max_tokens, stop_sequence, etc.) — bail.
    emit('done', { reason: response.stop_reason ?? 'unknown', iterations: iter + 1, usage: response.usage });
    return;
  }

  emit('done', { reason: 'max_iterations', iterations: MAX_ITER });
}
