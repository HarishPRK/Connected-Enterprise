import type Anthropic from '@anthropic-ai/sdk';
import { askTools, tools, executeTool } from './tools.js';
import { pickPersona } from './prompts.js';
import type { AgentClient } from './llm.js';
import { formatLiveDeviceAnswer, formatLiveWanAnswer } from './askLiveResponse.js';
import { waitForResponseWindow } from './liveInsights.js';
import { aiStylePrompt, type AiPreferences } from './aiPreferences.js';

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
  /** Test-only override for the direct-response loading window. */
  minimumResponseMs?: number;
  preferences?: AiPreferences;
  signal?: AbortSignal;
}

const MAX_ITER = 8;
const incidentTools = [...askTools, ...tools.filter(tool => tool.name === 'request_human_approval')];
const incidentToolNames = new Set(incidentTools.map(tool => tool.name));
const LIVE_INCIDENT_CONTRACT = `\n\nThis investigation has only live, read-only branch tools and an approval-request tool. Gather current WAN and device evidence using get_live_branch_wan and get_live_branch_devices. No gateway write integration is available here. You may propose remediation for an operator, but never claim it ran, infer a root cause without evidence, or claim an incident is resolved. If telemetry is absent or stale, say so. An approval request is only a proposal for review.`;

async function runDirectIncidentAnalysis(opts: RunOptions, startedAt: number): Promise<void> {
  const { incident, emit } = opts;
  const toolsUsed = ['get_live_branch_wan', 'get_live_branch_devices'] as const;
  const results: unknown[] = [];
  for (const tool of toolsUsed) {
    emit('tool_call', { tool, args: {} });
    const result = await executeTool(tool, {}, new Set<string>(), { branchId: incident.branchId });
    results.push(result);
    emit('tool_result', { tool, ok: true, result });
  }
  await waitForResponseWindow(startedAt, { minimumResponseMs: opts.minimumResponseMs }, 1_600);
  emit('thought', {
    content: [
      `**${incident.severity.toUpperCase()} incident ${incident.id}:** ${incident.title}`,
      formatLiveWanAnswer(results[0]),
      formatLiveDeviceAnswer(results[1]),
      'The current telemetry review is complete; no configuration changes were made.',
    ].join('\n\n'),
  });
  emit('done', { reason: 'analysis_complete', tools: toolsUsed });
}

/** Runs the incident investigation against the configured model when possible,
 * and keeps the read-only telemetry investigation available at all times. */
export async function runAgent(client: AgentClient | null, model: string, opts: RunOptions): Promise<void> {
  const { incident, emit } = opts;
  const persona = pickPersona(incident.agentName);
  if (opts.signal?.aborted) return;
  const startedAt = Date.now();

  emit('system', { content: `Operational analysis attached · persona "${incident.agentName ?? 'default'}"` });

  if (!client) {
    await runDirectIncidentAnalysis(opts, startedAt);
    return;
  }

  // Requests can propose an action, but this analysis has no gateway write tool.
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
    if (opts.signal?.aborted) return;
    let response: Anthropic.Messages.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 1500,
        system: [
          { type: 'text', text: persona + LIVE_INCIDENT_CONTRACT + aiStylePrompt(opts.preferences), cache_control: { type: 'ephemeral' } },
        ],
        tools: incidentTools,
        messages,
      }, { signal: opts.signal });
    } catch (err) {
      if (opts.signal?.aborted) return;
      console.warn('[agent] model path failed; using the direct incident analysis:', err instanceof Error ? err.message : err);
      await runDirectIncidentAnalysis(opts, startedAt);
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
        if (opts.signal?.aborted) return;
        emit('tool_call', { id: t.id, tool: t.name, args: t.input });

        const result = incidentToolNames.has(t.name) ? await executeTool(
          t.name,
          (t.input ?? {}) as Record<string, unknown>,
          approvedActions,
          { branchId: incident.branchId },
        ) : { error: `Tool ${t.name} is unavailable in this live investigation.` };

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
