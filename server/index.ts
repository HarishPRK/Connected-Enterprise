import { config as loadDotenv } from 'dotenv';
// `override: true` — the project's .env is the source of truth. Without this,
// dotenv won't replace pre-set shell vars (incl. an *empty* AWS_ACCESS_KEY_ID
// left behind by `aws configure`, or a stale AWS_BEARER_TOKEN_BEDROCK from a
// previous shell session). Both have bitten us in dev.
loadDotenv({ override: true });
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { makeLLM } from './llm.js';
import { runAgent } from './agent.js';
import { runChat, type ChatMessage } from './chat.js';
import { ipsecSource } from './ipsecSource.js';
import { decodeAppRouteCommand, type AppRouteCommand } from './appRouteProto.js';
import { deviceSource } from './deviceSource.js';
import { historySeries } from './telemetryHistory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(cors());

// gzip everything compressible (the built JS bundle is ~1.2 MB → ~350 KB on the
// wire, CSS ~89 KB → ~16 KB). CRITICAL: never compress the Server-Sent-Events
// streams — the compressor buffers until its threshold, which stalls the live
// snapshot/telemetry feeds. We skip any response whose Content-Type is
// text/event-stream; the MJPEG video proxy (multipart/x-mixed-replace) and the
// `no-transform` streams are already non-compressible / opted out, but the
// explicit guard keeps SSE safe regardless of default heuristics.
app.use(compression({
  filter: (req, res) => {
    const ct = String(res.getHeader('Content-Type') ?? '');
    if (ct.includes('text/event-stream')) return false;
    return compression.filter(req, res);
  },
}));

app.use(express.json({ limit: '256kb' }));

const llm = makeLLM();

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: llm.provider,
    keyConfigured: !!llm.client,
    authMode: llm.authMode ?? null,
    model: llm.model,
    reason: llm.reason ?? null,
  });
});

app.post('/api/agent/run', async (req, res) => {
  const incident = req.body?.incident;
  // eslint-disable-next-line no-console
  console.log(`[agent-run] incoming · incident=${incident?.id} title="${incident?.title}"`);

  if (!llm.client) {
    // eslint-disable-next-line no-console
    console.log(`[agent-run] 503 — LLM not configured (${llm.provider}): ${llm.reason}`);
    res.status(503).json({
      error: `LLM not configured (${llm.provider}): ${llm.reason ?? 'unknown'}. Check your .env and restart the server.`,
    });
    return;
  }

  if (!incident?.id || !incident?.title) {
    res.status(400).json({ error: 'Body must include { incident: { id, title, branchId, severity, agentName? } }' });
    return;
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Critical for SSE: disable Nagle's algorithm so each small res.write() is
  // flushed to the wire immediately. Without this Node buffers small writes
  // and the client only sees the response when the buffer fills (often never
  // for short SSE streams).
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true);

  // Use res.writable (true while the response stream is still open) instead of
  // req.on('close') — in Express 5 / modern Node the request 'close' event
  // fires as soon as the request body is fully consumed, NOT when the client
  // disconnects, so it's the wrong signal for an SSE response.
  const emit = (event: string, data: Record<string, unknown>) => {
    if (!res.writable || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, 'utf8');
  };

  // Heartbeat so corp proxies don't time us out
  const hb = setInterval(() => {
    if (res.writable && !res.writableEnded) res.write(': hb\n\n');
  }, 15_000);
  res.on('close', () => clearInterval(hb));

  try {
    await runAgent(llm.client, llm.model, {
      incident,
      emit: (e, d) => {
        emit(e, d);
        // eslint-disable-next-line no-console
        if (e === 'error') console.error('[agent-run] emit error:', d);
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[agent-run] done · incident=${incident.id}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[agent-run] uncaught:', err);
    emit('error', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    clearInterval(hb);
    if (!res.writableEnded) res.end();
  }
});

/** POST /api/gateway/path — flips the gateway's active WAN path by publishing
 *  to AWS IoT Core, where the `com.rdk.pathcontrol` Greengrass component on the
 *  gateway picks it up and calls its local `:8090/api/path`. We can't reach the
 *  gateway's NAT'd LAN over HTTP from the cloud, so MQTT is the transport.
 *
 *  Body: `{ mode: 'auto'|'fiber'|'5g', source?: 'rdk'|'prpl' }`
 *  `source` selects the topic family — Plano gateways listen on `rdk/...`,
 *  McKinney on `prpl/...`. Defaults to `rdk` for backwards-compat. */
app.post('/api/gateway/path', async (req, res) => {
  const mode = req.body?.mode;
  const source = req.body?.source ?? 'rdk';
  // Optional tunnel pin (e.g. "vti-fiber1"), kept for backwards-compat. The UI
  // no longer sends it — Force-Fiber / Force-5G publish the mode alone and the
  // Greengrass component picks the tunnel within the chosen underlay.
  const tunnel = typeof req.body?.tunnel === 'string' && req.body.tunnel.trim()
    ? req.body.tunnel.trim()
    : undefined;
  const VALID_MODES = ['auto', 'fiber', '5g', 'tunnel1', 'tunnel2', 'tunnel3', 'tunnel4'];
  if (!VALID_MODES.includes(mode)) {
    res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(', ')} (got ${JSON.stringify(mode)})` });
    return;
  }
  if (source !== 'rdk' && source !== 'prpl') {
    res.status(400).json({ error: `source must be one of: rdk, prpl (got ${JSON.stringify(source)})` });
    return;
  }

  const result = await ipsecSource.sendPathCommand(source, mode, 6000, tunnel);
  if (result.ok) {
    res.json({ ok: true, mode, source, tunnel, httpStatus: result.httpStatus });
  } else if (result.timedOut) {
    // Command was published but no ack arrived — the gateway component may be
    // offline. 202 = accepted-but-not-confirmed so the UI can soften the toast.
    res.status(202).json({ ok: false, mode, source, tunnel, pending: true, error: result.error });
  } else {
    res.status(502).json({ ok: false, mode, source, tunnel, error: result.error ?? 'path command failed' });
  }
});

/** POST /api/approute/publish?source=rdk|prpl — relays a binary proto3
 *  AppRouteCommand (see proto/app_route.proto) from the Application Steering
 *  Patchboard to `<source>/approute/control` over AWS IoT Core. The browser
 *  encodes the payload (src/proto/appRoute.ts); we decode it here to validate
 *  and log what's going on the wire, then publish the ORIGINAL bytes verbatim.
 *  Fire-and-forget: no gateway component subscribes to this topic yet, so 200
 *  means "accepted by the broker", not "applied on the gateway". */
app.post(
  '/api/approute/publish',
  express.raw({ type: 'application/octet-stream', limit: '64kb' }),
  async (req, res) => {
    const source = req.query.source;
    if (source !== 'rdk' && source !== 'prpl') {
      res.status(400).json({ error: `source must be one of: rdk, prpl (got ${JSON.stringify(source)})` });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Body must be a non-empty application/octet-stream proto3 AppRouteCommand' });
      return;
    }

    let decoded: AppRouteCommand;
    try {
      decoded = decodeAppRouteCommand(req.body);
    } catch (err) {
      res.status(400).json({ error: `payload is not a valid AppRouteCommand: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    if (decoded.changes.length === 0 || decoded.changes.some((c) => !c.desired.tunnel || !c.current.tunnel)) {
      res.status(400).json({ error: 'AppRouteCommand must carry at least one change with current and desired tunnels set' });
      return;
    }

    for (const c of decoded.changes) {
      // eslint-disable-next-line no-console
      console.log(`[approute] ${source}: ${c.client_name || c.client_mac} · ${c.desired.application} · ${c.current.tunnel} → ${c.desired.tunnel}`);
    }

    const topic = `${source}/approute/control`;
    const result = await ipsecSource.publishAppRoute(source, req.body);
    if (result.ok) {
      res.json({ ok: true, topic, bytes: req.body.length, decoded });
    } else {
      // Encoded fine but the broker is unreachable — let the UI soften the toast.
      res.status(503).json({ ok: false, offline: true, topic, bytes: req.body.length, error: result.error, decoded });
    }
  },
);

/** POST /api/ipsec/insight — Bedrock Claude reads the current IPsec snapshot
 *  and streams a network-ops analysis back as SSE `chunk` events. */
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

  // SSE setup (same shape as /api/ask)
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

  const userMessage = `Latest IPsec gateway telemetry (decoded from the protobuf \
on \`rdk/ipsec/metrics\`). Server received it ${Math.round((Date.now() - snap.receivedAt) / 1000)} s ago.

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

/** POST /api/insight — generic Bedrock-Claude analysis for any page.
 *  Body: `{ topic: 'it-devices' | 'ot-devices' | 'connectivity' | 'fleet' | 'app-routing',
 *           data:  <any JSON the page wants analysed> }`
 *  The server picks a topic-appropriate system prompt and streams the response. */
// Style rules common to every topic. Kept in one place so all insight cards
// produce the same crisp output: max 3 bullets, ≤ 20 words each, no preamble,
// no closing sentence, no headers.
const INSIGHT_STYLE = `Style — be ruthlessly brief:
- Exactly 3 bullets, max 20 words each. No more, no less.
- No preamble ("Based on the data…"), no closing sentence, no headers.
- Use **bold** for key terms and \`code\` for IDs / IPs / interface names.
- Don't restate the JSON. Interpret it. If everything is fine, say so in 1 bullet.`;

const INSIGHT_PROMPTS: Record<string, string> = {
  'it-devices': `Senior IT-ops engineer reading an enterprise branch's endpoint inventory.
Focus: offline/degraded endpoints, connection-mix anomalies, security risks.
${INSIGHT_STYLE}`,

  'ot-devices': `Senior OT/IoT engineer reading industrial sensor inventory for a branch.
Focus: safety-critical sensors offline (flag as HIGH), coverage gaps, VLAN issues.
${INSIGHT_STYLE}`,

  'connectivity': `Senior network engineer reading branch WAN health.
Focus: branches at risk, active WAN choice, throughput anomalies.
${INSIGHT_STYLE}`,

  'fleet': `Network-ops manager writing a 3-line CIO-level readout.
Focus: bottom-line health %, biggest fleet risk, capacity trend.
${INSIGHT_STYLE}`,

  'app-routing': `Network architect reading app-aware-routing policies and per-app traffic.
Focus: critical apps off intended path, surprising splits, optimisation wins.
${INSIGHT_STYLE}`,
};

app.post('/api/insight', async (req, res) => {
  if (!llm.client) {
    res.status(503).json({ error: `LLM not configured (${llm.provider}): ${llm.reason ?? 'unknown'}.` });
    return;
  }

  const topic = req.body?.topic;
  const data  = req.body?.data;
  if (typeof topic !== 'string' || !INSIGHT_PROMPTS[topic]) {
    res.status(400).json({
      error: `Body must include { topic, data }. Topic must be one of: ${Object.keys(INSIGHT_PROMPTS).join(', ')}`,
    });
    return;
  }
  if (data == null) {
    res.status(400).json({ error: 'Body must include { data }.' });
    return;
  }

  // SSE setup (mirrors /api/ask, /api/ipsec/insight)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true);
  const emit = (event: string, payload: Record<string, unknown>) => {
    if (!res.writable || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`, 'utf8');
  };
  const hb = setInterval(() => {
    if (res.writable && !res.writableEnded) res.write(': hb\n\n');
  }, 15_000);
  res.on('close', () => clearInterval(hb));

  // Keep the JSON we send to the model small — truncate if huge.
  const dataJson = JSON.stringify(data, null, 2);
  const trimmed = dataJson.length > 16_000
    ? dataJson.slice(0, 16_000) + '\n\n…[truncated for brevity]'
    : dataJson;

  const SYSTEM    = INSIGHT_PROMPTS[topic];
  const userBlock = `Here is the latest ${topic.replace('-', ' ')} data from this page:\n\n\`\`\`json\n${trimmed}\n\`\`\`\n\nAnalyse the current state.`;

  try {
    const response = await llm.client.messages.create({
      model: llm.model,
      max_tokens: 260,
      system:   [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: userBlock }] }],
    });
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        emit('chunk', { text: block.text });
      }
    }
    emit('done', { usage: response.usage, topic });
  } catch (err) {
    emit('error', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    clearInterval(hb);
    if (!res.writableEnded) res.end();
  }
});

app.post('/api/ask', async (req, res) => {
  // eslint-disable-next-line no-console
  console.log(`[ask] incoming · ${(req.body?.messages ?? []).length} messages`);

  if (!llm.client) {
    res.status(503).json({
      error: `LLM not configured (${llm.provider}): ${llm.reason ?? 'unknown'}.`,
    });
    return;
  }

  const messages = req.body?.messages as ChatMessage[] | undefined;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'Body must include { messages: [{role, content}, ...] }' });
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

  try {
    await runChat(llm.client, llm.model, { messages, emit });
    // eslint-disable-next-line no-console
    console.log('[ask] done');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ask] uncaught:', err);
    emit('error', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    clearInterval(hb);
    if (!res.writableEnded) res.end();
  }
});

/* ─────────── Agentic AI proxy ───────────
 * Browser → /api/agentic/* (same-origin, no CORS) → this Express server
 * → upstream LangGraph service at AGENTIC_UPSTREAM. Streams pass through
 * untouched so SSE works end-to-end. */

const AGENTIC_UPSTREAM       = process.env.AGENTIC_UPSTREAM       ?? 'http://192.168.10.160:5006';
// Smart-home / device-control LangGraph agent — listens on :5005 on the same
// box as the network agent. Used by the "Agentic AI" page's last 3 quick
// prompts (camera + ambience scenarios).
const AGENTIC_SMART_UPSTREAM = process.env.AGENTIC_SMART_UPSTREAM ?? 'http://192.168.10.160:5005';

/** Real upstream-health check. Replaces the bogus `mode: no-cors` ping the
 *  browser was doing — that one resolved on any TCP-reachable host. */
app.get('/api/agentic/health', async (_req, res) => {
  try {
    const upstream = await fetch(AGENTIC_UPSTREAM, { method: 'HEAD' });
    res.json({ ok: upstream.status < 500, upstream: AGENTIC_UPSTREAM, status: upstream.status });
  } catch (err) {
    res.status(502).json({
      ok: false,
      upstream: AGENTIC_UPSTREAM,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** POST /api/agentic/chat → forwards JSON body verbatim, returns JSON. */
app.post('/api/agentic/chat', async (req, res) => {
  try {
    const upstream = await fetch(`${AGENTIC_UPSTREAM}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
    const text = await upstream.text();
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.status(upstream.status).send(text);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[agentic-chat] upstream error:', err);
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Generic SSE pass-through. Streams bytes from upstream to the client, lets
 *  the client abort cleanly via req 'close'. */
async function proxyAgenticSSE(upstreamUrl: string, req: express.Request, res: express.Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true);

  const ctrl = new AbortController();
  const onClose = () => ctrl.abort();
  req.on('close', onClose);

  try {
    const upstream = await fetch(upstreamUrl, { signal: ctrl.signal });
    if (!upstream.ok || !upstream.body) {
      if (res.writable && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: `upstream ${upstream.status}` })}\n\n`);
      }
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (!ctrl.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (res.writable && !res.writableEnded) res.write(chunk);
    }
  } catch (err) {
    if ((err as { name?: string }).name !== 'AbortError') {
      // eslint-disable-next-line no-console
      console.error('[agentic-sse] upstream error:', err);
      if (res.writable && !res.writableEnded) {
        const msg = err instanceof Error ? err.message : String(err);
        res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
      }
    }
  } finally {
    req.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
}

app.get('/api/agentic/thoughts/:id', (req, res) => {
  void proxyAgenticSSE(
    `${AGENTIC_UPSTREAM}/thoughts/${encodeURIComponent(req.params.id)}`,
    req, res,
  );
});

app.get('/api/agentic/response/:id', (req, res) => {
  void proxyAgenticSSE(
    `${AGENTIC_UPSTREAM}/response/${encodeURIComponent(req.params.id)}`,
    req, res,
  );
});

/* ─────────── Smart-home agentic proxy (parallel routes → :5005) ───────────
 * The "Agentic AI" page sends the last 3 quick prompts (camera + ambience)
 * to this set instead of the network agent above. Same shapes, different
 * upstream — selected client-side by the upstream='smart' flag. */

app.get('/api/agentic-smart/health', async (_req, res) => {
  try {
    const upstream = await fetch(AGENTIC_SMART_UPSTREAM, { method: 'HEAD' });
    res.json({ ok: upstream.status < 500, upstream: AGENTIC_SMART_UPSTREAM, status: upstream.status });
  } catch (err) {
    res.status(502).json({
      ok: false,
      upstream: AGENTIC_SMART_UPSTREAM,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post('/api/agentic-smart/chat', async (req, res) => {
  try {
    const upstream = await fetch(`${AGENTIC_SMART_UPSTREAM}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
    const text = await upstream.text();
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.status(upstream.status).send(text);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[agentic-smart-chat] upstream error:', err);
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/agentic-smart/thoughts/:id', (req, res) => {
  void proxyAgenticSSE(
    `${AGENTIC_SMART_UPSTREAM}/thoughts/${encodeURIComponent(req.params.id)}`,
    req, res,
  );
});

app.get('/api/agentic-smart/response/:id', (req, res) => {
  void proxyAgenticSSE(
    `${AGENTIC_SMART_UPSTREAM}/response/${encodeURIComponent(req.params.id)}`,
    req, res,
  );
});

/* ─────────── IPsec metrics (AWS IoT Core → memory cache → SSE) ─────────── */

// Kick off the MQTT subscription as soon as the server boots. Idempotent.
void ipsecSource.start();

/** Snapshot of the latest decoded payload for every gateway we've seen. */
app.get('/api/ipsec/snapshot', (_req, res) => {
  res.json(ipsecSource.getSnapshot());
});

/** Server-Sent Events stream — pushes every fresh update + a heartbeat. */
app.get('/api/ipsec/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true);

  const emit = (event: string, data: Record<string, unknown>) => {
    if (!res.writable || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Send the current cache up-front so clients hydrate immediately.
  emit('snapshot', ipsecSource.getSnapshot());

  const offUpdate = ipsecSource.onUpdate((u) => emit('update', u as unknown as Record<string, unknown>));
  const offStatus = ipsecSource.onStatus((s) => emit('status', s as unknown as Record<string, unknown>));

  const hb = setInterval(() => {
    if (res.writable && !res.writableEnded) res.write(': hb\n\n');
  }, 15_000);

  req.on('close', () => {
    offUpdate();
    offStatus();
    clearInterval(hb);
    if (!res.writableEnded) res.end();
  });
});

/* ─────────── Application-Aware Routing (AAR) telemetry ───────────
 * The gateway's AAR plugin publishes proto3 on routing/{flow,tunnel,route,
 * decision}; ipsecSource decodes + aggregates them. These endpoints expose the
 * aggregated state to the Application Steering Patchboard, mirroring the ipsec
 * snapshot/stream pair. */

/** Snapshot of the current aggregated AAR routing state. */
app.get('/api/aar/snapshot', (_req, res) => {
  res.json(ipsecSource.getAarSnapshot());
});

/** SSE stream — hydrates with the snapshot, then pushes the full snapshot on
 *  every fresh routing/* message. */
app.get('/api/aar/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true);

  const emit = (event: string, data: Record<string, unknown>) => {
    if (!res.writable || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  emit('snapshot', ipsecSource.getAarSnapshot() as unknown as Record<string, unknown>);
  const offAar = ipsecSource.onAar((s) => emit('update', s as unknown as Record<string, unknown>));

  const hb = setInterval(() => {
    if (res.writable && !res.writableEnded) res.write(': hb\n\n');
  }, 15_000);

  req.on('close', () => {
    offAar();
    clearInterval(hb);
    if (!res.writableEnded) res.end();
  });
});

/* ─────────── Device inventory (IT/OT) ───────────
 * Phase 0: served from the static seed in deviceSource.ts so the Devices page
 * runs off the API + SSE with no gateway changes. IT/OT is an editable,
 * persisted attribute (auto-seed + operator override). Phase 1 swaps the seed
 * for live `rdk/devices/inventory` MQTT data behind the same endpoints. */

/** Snapshot of the current device inventory (effective IT/OT applied). */
app.get('/api/devices/snapshot', (_req, res) => {
  res.json(deviceSource.getSnapshot());
});

/** SSE stream — hydrates with the current snapshot, then pushes one on every
 *  reclassify. Mirrors /api/ipsec/stream. */
app.get('/api/devices/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true);

  const emit = (event: string, data: Record<string, unknown>) => {
    if (!res.writable || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  emit('snapshot', deviceSource.getSnapshot() as unknown as Record<string, unknown>);

  const offUpdate = deviceSource.onUpdate((snap) =>
    emit('snapshot', snap as unknown as Record<string, unknown>),
  );

  const hb = setInterval(() => {
    if (res.writable && !res.writableEnded) res.write(': hb\n\n');
  }, 15_000);

  req.on('close', () => {
    offUpdate();
    clearInterval(hb);
    if (!res.writableEnded) res.end();
  });
});

/** POST /api/devices/classify — move a device between IT and OT. Body:
 *  `{ mac: string, domain: 'IT'|'OT' }`. Reclassifying to the device's own auto
 *  domain clears the override. Persists, then the SSE stream pushes the new
 *  snapshot to every connected client. */
app.post('/api/devices/classify', (req, res) => {
  const mac = typeof req.body?.mac === 'string' ? req.body.mac.trim() : '';
  const domain = req.body?.domain;
  if (!mac) {
    res.status(400).json({ error: 'mac is required' });
    return;
  }
  if (domain !== 'IT' && domain !== 'OT') {
    res.status(400).json({ error: `domain must be 'IT' or 'OT' (got ${JSON.stringify(domain)})` });
    return;
  }
  const ok = deviceSource.classify(mac, domain);
  if (!ok) {
    res.status(404).json({ error: `no device with mac ${mac}` });
    return;
  }
  res.json({ ok: true, mac, domain });
});

/** GET /api/devices/telemetry/history — rolling per-device telemetry series
 *  (real throughput from byte-counter deltas, RSSI, power draw) keyed by MAC.
 *  Session-scoped; powers the live dashboard charts. */
app.get('/api/devices/telemetry/history', (_req, res) => {
  res.json({ series: historySeries(), receivedAt: Date.now() });
});

/** POST /api/devices/matter/refresh — poke the gateway to re-fetch the Matter
 *  hub device list and republish it. The fresh list arrives over the live
 *  inventory stream, so this just confirms the poke was sent. */
app.post('/api/devices/matter/refresh', async (_req, res) => {
  const ok = await ipsecSource.requestMatterRefresh();
  if (ok) {
    res.json({ ok: true });
  } else {
    res.status(503).json({ ok: false, error: 'MQTT not connected — cannot reach the gateway' });
  }
});

/** POST /api/devices/matter/control — drive a Matter device (OnOff cluster)
 *  through the gateway's `com.rdk.matter.devicecontrol` component. We write the
 *  RDKMatterControl shadow over MQTT; the component forwards the command to the
 *  Matter hub on the gateway LAN and acks on `rdk/matter/device/control/result`.
 *  Body: `{ nodeId: number, action: 'On'|'Off', endpointId?: number }`. */
app.post('/api/devices/matter/control', async (req, res) => {
  const nodeId = Number(req.body?.nodeId);
  const action = req.body?.action;
  const endpointId = Number.isInteger(req.body?.endpointId) ? (req.body.endpointId as number) : 1;
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    res.status(400).json({ error: `nodeId must be a positive integer (got ${JSON.stringify(req.body?.nodeId)})` });
    return;
  }
  if (action !== 'On' && action !== 'Off') {
    res.status(400).json({ error: `action must be one of: On, Off (got ${JSON.stringify(action)})` });
    return;
  }

  const result = await ipsecSource.sendMatterCommand(nodeId, action, endpointId);
  // The component's `success` only means "the hub replied with valid JSON" —
  // the hub signals its own rejection inside the reply (`result: "false"`).
  const hub = result.hubResponse as { result?: string; reason?: string } | undefined;
  const hubRejected = typeof hub === 'object' && hub != null && hub.result === 'false';
  if (result.ok && !hubRejected) {
    res.json({ ok: true, nodeId, action, hubResponse: result.hubResponse });
  } else if (result.timedOut) {
    // Command was written to the shadow but no ack arrived — the gateway
    // component may be offline. 202 = accepted-but-not-confirmed.
    res.status(202).json({ ok: false, nodeId, action, pending: true, error: result.error });
  } else {
    res.status(502).json({
      ok: false,
      nodeId,
      action,
      error: hubRejected
        ? `Matter hub rejected the command: ${hub?.reason ?? 'unknown reason'}`
        : (result.error ?? 'matter command failed'),
      hubResponse: result.hubResponse,
    });
  }
});

/** POST /api/devices/shelly/control — drive a Shelly relay (Switch.Set) over
 *  its direct MQTT connection to IoT Core; the device replies on our RPC
 *  reply topic. Body: `{ deviceId: string, action: 'On'|'Off' }`. */
app.post('/api/devices/shelly/control', async (req, res) => {
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
  const action = req.body?.action;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(deviceId)) {
    res.status(400).json({ error: `deviceId must be a topic-safe Shelly id (got ${JSON.stringify(req.body?.deviceId)})` });
    return;
  }
  if (action !== 'On' && action !== 'Off') {
    res.status(400).json({ error: `action must be one of: On, Off (got ${JSON.stringify(action)})` });
    return;
  }

  const result = await ipsecSource.sendShellyCommand(deviceId, action);
  if (result.ok) {
    res.json({ ok: true, deviceId, action, response: result.response });
  } else if (result.timedOut) {
    res.status(202).json({ ok: false, deviceId, action, pending: true, error: result.error });
  } else {
    res.status(502).json({ ok: false, deviceId, action, error: result.error ?? 'shelly command failed' });
  }
});

/* ─────────── Video analytics proxy ───────────
 * MJPEG streams from inference nodes on a private LAN. Browser hits
 * `/api/video/<id>` same-origin; Express pipes the multipart byte stream
 * straight through. Upstreams resolved (in order):
 *   1. VIDEO_UPSTREAM_<ID_UPPER_SNAKE>   — full URL override per stream
 *   2. VIDEO_BASE_NVIDIA / VIDEO_BASE_HAILO   — group base URL, suffixed by path
 *   3. The hardcoded defaults below (private LAN IPs).
 *
 * On EC2 with Tailscale: set VIDEO_BASE_NVIDIA / VIDEO_BASE_HAILO to the
 * tailnet IPs of the inference nodes — no code change needed.
 */

const VIDEO_DEFAULT_BASES = {
  nvidia: 'http://192.168.10.100:5000',
  hailo:  'http://192.168.10.160:5000',
} as const;

const VIDEO_STREAM_PATHS: Record<string, { base: keyof typeof VIDEO_DEFAULT_BASES; path: string }> = {
  'nv-nanoowl':  { base: 'nvidia', path: '/nanoowl_feed' },
  'nv-violence': { base: 'nvidia', path: '/violence_feed' },
  'nv-fall':     { base: 'nvidia', path: '/fall_feed' },
  'nv-ppe':      { base: 'nvidia', path: '/ppe_feed' },
  'nv-table':    { base: 'nvidia', path: '/table_feed' },
  'nv-weapon':   { base: 'nvidia', path: '/weapon_feed' },
  'nv-parking':  { base: 'nvidia', path: '/parking_feed' },
  'ha-anpd':     { base: 'hailo',  path: '/anpd_feed' },
  'ha-intruder': { base: 'hailo',  path: '/intruder_feed' },
  'ha-hairnet':  { base: 'hailo',  path: '/hairnetmonitor_feed' },
  'ha-fire':     { base: 'hailo',  path: '/firedetection_feed' },
  'ha-crowd':    { base: 'hailo',  path: '/crowd_feed' },
  'ha-drive':    { base: 'hailo',  path: '/drive_thru_monitor_stream' },
};

function getVideoUpstream(id: string): string | null {
  const envKey = `VIDEO_UPSTREAM_${id.replace(/-/g, '_').toUpperCase()}`;
  const direct = process.env[envKey];
  if (direct) return direct;
  const def = VIDEO_STREAM_PATHS[id];
  if (!def) return null;
  const baseKey = `VIDEO_BASE_${def.base.toUpperCase()}`;
  const base = process.env[baseKey] ?? VIDEO_DEFAULT_BASES[def.base];
  return `${base.replace(/\/+$/, '')}${def.path}`;
}

/** List of configured streams + their resolved upstreams. Handy for debugging. */
app.get('/api/video', (_req, res) => {
  res.json(
    Object.keys(VIDEO_STREAM_PATHS).map((id) => ({
      id,
      upstream: getVideoUpstream(id),
    })),
  );
});

app.get('/api/video/:id', async (req, res) => {
  const upstream = getVideoUpstream(req.params.id);
  if (!upstream) {
    res.status(404).json({ error: `Unknown stream id: ${req.params.id}` });
    return;
  }

  const ctrl = new AbortController();
  const onClose = () => ctrl.abort();
  req.on('close', onClose);

  try {
    const r = await fetch(upstream, { signal: ctrl.signal });
    if (!r.ok || !r.body) {
      if (!res.headersSent) res.status(502).json({ error: `upstream ${r.status}` });
      return;
    }

    // MJPEG = multipart/x-mixed-replace. Pass content-type and boundary verbatim.
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'no-cache, no-transform, no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // bypass nginx buffering if fronted
    res.flushHeaders?.();
    res.socket?.setNoDelay(true);
    res.socket?.setKeepAlive(true);

    const reader = r.body.getReader();
    while (!ctrl.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.writable || res.writableEnded) break;
      res.write(value);
    }
  } catch (err) {
    if ((err as { name?: string }).name !== 'AbortError') {
      // eslint-disable-next-line no-console
      console.error(`[video-proxy:${req.params.id}] upstream error:`, err);
      if (!res.headersSent) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    req.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
});

/* ─────────── Static frontend (production) ───────────
 * In production we run a single Node process that serves both `/api/*` and
 * the Vite-built static SPA from `dist/`. In dev, Vite serves the SPA on
 * port 5173 and proxies API calls here — so we just skip the static block
 * when `dist/` doesn't exist. */
const distDir = path.resolve(__dirname, '..', 'dist');
const indexHtml = path.join(distDir, 'index.html');
const hasBuild = existsSync(indexHtml);

if (hasBuild) {
  // Long cache for hashed assets; SPA shell stays uncached so deploys roll out.
  app.use('/assets', express.static(path.join(distDir, 'assets'), {
    maxAge: '30d',
    immutable: true,
  }));
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));

  // SPA fallback — every non-API GET serves index.html so React Router routes
  // (e.g. /security, /naas, /incidents) deep-link correctly.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

const PORT = Number(process.env.PORT ?? process.env.AGENT_SERVER_PORT ?? 3001);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[ce-server] listening on http://0.0.0.0:${PORT} · static=${hasBuild ? 'yes (dist/)' : 'no (dev mode)'}`);
  // eslint-disable-next-line no-console
  console.log(`[ce-server] provider=${llm.provider} authMode=${llm.authMode ?? 'none'} model=${llm.model} ${llm.client ? '✓' : `(NOT CONFIGURED: ${llm.reason})`}`);
});
