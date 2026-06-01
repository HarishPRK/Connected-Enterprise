/**
 * IPsec AI insight — registers POST /api/ipsec/insight on the Express app.
 * The route reads the current IPsec snapshot and asks Bedrock Claude to
 * summarise it, streaming the response back as SSE `chunk` events.
 *
 * Requires:
 *   - server/ipsecSource.ts (the snapshot cache)
 *   - server/llm.ts         (Bedrock client factory)
 *   - server/bedrockBearer.ts (only if you use the ABSK long-term key path)
 *   - AWS_BEARER_TOKEN_BEDROCK (or AWS_ACCESS_KEY_ID/SECRET) env var
 *
 * Usage:
 *   import { registerIpsecInsightRoute } from './ipsec-insight-route.js';
 *   registerIpsecInsightRoute(app);
 */

import type { Express } from 'express';
import { ipsecSource } from './ipsecSource.js';
import { makeLLM } from './llm.js';

const llm = makeLLM();

export function registerIpsecInsightRoute(app: Express): void {
  app.post('/api/ipsec/insight', async (_req, res) => {
    if (!llm.client) {
      res.status(503).json({
        error: `LLM not configured (${llm.provider}): ${llm.reason ?? 'unknown'}.`,
      });
      return;
    }

    const snap = ipsecSource.getSnapshot();
    const gateways = Object.values(snap.gateways);
    if (gateways.length === 0) {
      res.status(409).json({ error: 'No IPsec payload received yet — try again once the gateway is streaming.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.socket?.setNoDelay(true);
    res.socket?.setKeepAlive(true);
    const emit = (event: string, data: Record<string, unknown>) => {
      if (!res.writable || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, 'utf8');
    };
    const hb = setInterval(() => {
      if (res.writable && !res.writableEnded) res.write(': hb\n\n');
    }, 15_000);
    res.on('close', () => clearInterval(hb));

    const SYSTEM = `Senior network-ops engineer reading live SD-WAN gateway telemetry.

Style — be ruthlessly brief:
- Exactly 3 bullets, max 20 words each.
- No preamble, no closing sentence, no headers.
- Use **bold** for key terms and \`code\` for interface names like \`vti-cell1\`.
- Interpret, don't restate. If healthy, say so in 1 bullet.

Priority: active path health → underlay availability → concerning signs (latency >150ms, loss >3%, unreachable tunnels).`;

    const userMessage = `Latest IPsec gateway telemetry (decoded from the protobuf on \`rdk/ipsec/metrics\`). Server received it ${Math.round((Date.now() - snap.receivedAt) / 1000)} s ago.

\`\`\`json
${JSON.stringify(snap, null, 2)}
\`\`\`

Analyze the current state.`;

    try {
      const response = await llm.client.messages.create({
        model: llm.model,
        max_tokens: 260,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: [{ type: 'text', text: userMessage }] }],
      });
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          emit('chunk', { text: block.text });
        }
      }
      emit('done', { usage: response.usage });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit('error', { message: msg });
    } finally {
      clearInterval(hb);
      if (!res.writableEnded) res.end();
    }
  });
}
