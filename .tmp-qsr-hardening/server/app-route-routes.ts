import { timingSafeEqual } from 'node:crypto';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { decodeAppRouteCommand, type AppRouteCommand } from './appRouteProto.js';
import { ipsecSource } from './ipsecSource.js';
import { makeLLM } from './llm.js';
import { logAIAudit, newAIRequestId } from './ai-governance.js';

const llm = makeLLM();

function requireRouteControl(req: Request, res: Response, next: NextFunction): void {
  const remoteAddress = req.socket.remoteAddress ?? '';
  const fromLoopback = remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1';
  const proxiedOperator = req.get('x-qsr-operator')?.trim();
  if (fromLoopback && proxiedOperator) {
    next();
    return;
  }

  const expected = process.env.APP_ROUTE_CONTROL_TOKEN?.trim();
  if (!expected) {
    const isDevelopment = process.env.npm_lifecycle_event === 'dev'
      || process.env.QSR_DEV_MODE === '1';
    if (!isDevelopment) {
      res.status(503).json({
        error: 'Application route control requires an authenticated nginx operator or APP_ROUTE_CONTROL_TOKEN.',
      });
      return;
    }
    next();
    return;
  }

  const authorization = req.get('authorization') ?? '';
  const supplied = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  const authorized = expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);

  if (!authorized) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="qsr-app-route-control"');
    res.status(401).json({ error: 'Valid operator authorization is required to change application routes.' });
    return;
  }
  next();
}

/** Complete Application Traffic Routing control and advisor API. */
export function registerAppRouteRoutes(app: Express): void {
  /** POST /api/approute/publish?source=rdk|prpl — relays a binary proto3
   *  AppRouteCommand (see proto/app_route.proto) from the Application Steering
   *  Patchboard to `<source>/approute/control` over AWS IoT Core. The browser
   *  encodes the payload (src/proto/appRoute.ts); we decode it here to validate
   *  and log what's going on the wire, then publish the ORIGINAL bytes verbatim.
   *  Fire-and-forget: no gateway component subscribes to this topic yet, so 200
   *  means "accepted by the broker", not "applied on the gateway". */
  app.post(
    '/api/approute/publish',
    requireRouteControl,
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
      if (decoded.changes.length === 0 && decoded.freezes.length === 0) {
        res.status(400).json({ error: 'AppRouteCommand must carry at least one route change or freeze toggle' });
        return;
      }
      if (decoded.changes.some((c) => !c.desired.tunnel || !c.current.tunnel)) {
        res.status(400).json({ error: 'Every route change must carry current and desired tunnels' });
        return;
      }

      const ORIGIN_LABEL: Record<number, string> = { 1: 'operator', 2: 'advisor-ai', 3: 'advisor-heuristic' };
      for (const c of decoded.changes) {
        // eslint-disable-next-line no-console
        console.log(`[approute] ${source}: ${c.client_name || c.client_mac} · ${c.desired.application} · ${c.current.tunnel} → ${c.desired.tunnel}${c.origin ? ` · ${ORIGIN_LABEL[c.origin] ?? c.origin}` : ''}`);
      }
      for (const f of decoded.freezes) {
        // eslint-disable-next-line no-console
        console.log(`[approute] ${source}: ${f.client_name || f.client_mac} · ${f.application}${f.tunnel ? ` on ${f.tunnel}` : ''} · ${f.freeze ? 'FREEZE' : 'UNFREEZE'} routing (freeze=${f.freeze})${decoded.type ? ` · ${decoded.type}` : ''}`);
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

  /** POST /api/approute/suggest — AI route advisor for the Application Steering
   *  Patchboard. Body: { source, clients: [{id,name,app,tunnel}], tunnels:
   *  [{ifname,family,latency_ms,loss_percent,reachable,apps}] } (frozen clients
   *  are excluded by the UI before calling). One non-streaming Bedrock/Anthropic
   *  call returns up to 3 recommended moves as strict JSON; a deterministic
   *  lowest-latency heuristic answers when the LLM is unconfigured, times out,
   *  or replies with something unparseable — the advisor always answers.
   *  Suggestions are re-validated against the submitted board and gains are
   *  recomputed from the data, so a hallucinated tunnel can't reach the UI. */
  app.post('/api/approute/suggest', async (req, res) => {
    const startedAt = Date.now();
    const requestId = newAIRequestId();
    res.setHeader('X-AI-Request-ID', requestId);
    interface SClient { id: string; name: string; app: string; tunnel: string; weight?: number }
    interface STunnel { ifname: string; family: string; latency_ms: number; loss_percent: number; reachable: boolean; apps: number; load?: number }
    interface OutSuggestion {
      client_id: string; client_name: string; app: string;
      from_tunnel: string; to_tunnel: string;
      expected_gain_ms: number; from_apps: number; to_apps: number; reason: string;
    }
    const clients: SClient[] = Array.isArray(req.body?.clients) ? req.body.clients : [];
    const tunnels: STunnel[] = Array.isArray(req.body?.tunnels) ? req.body.tunnels : [];
    if (!clients.length || !tunnels.length) {
      res.status(400).json({ error: 'Body must include non-empty clients[] and tunnels[]' });
      return;
    }

    const byName = new Map(tunnels.map((t) => [t.ifname, t]));

    // Load model: each unit of concurrent app weight adds ~2ms of effective
    // queueing latency on its tunnel, so effective(t) = latency + 2 * load(t).
    // "obviously tunnel 1 is better" by raw latency stops being true once three
    // heavy apps are already riding it.
    const LOAD_MS_PER_WEIGHT = 2;
    const wOf = (c: SClient) => (typeof c.weight === 'number' && c.weight > 0 ? c.weight : 2);

    /** Working copy of per-tunnel load + app counts. Every candidate batch is
     *  simulated SEQUENTIALLY against it, so suggestion #2 sees the world after
     *  suggestion #1 — a batch can never collectively dogpile one fast tunnel. */
    const makeWorld = () => {
      const load = new Map(tunnels.map((t) => [t.ifname, typeof t.load === 'number' ? t.load : t.apps * 2]));
      const apps = new Map(tunnels.map((t) => [t.ifname, t.apps]));
      const effective = (t: STunnel, l: number) => t.latency_ms + LOAD_MS_PER_WEIGHT * l;
      /** Net effective gain of moving c → to under the CURRENT working loads
       *  (c's weight leaves `from` and lands on `to` before comparing). */
      const netGain = (c: SClient, from: STunnel, to: STunnel) =>
        effective(from, load.get(from.ifname) ?? 0) - effective(to, (load.get(to.ifname) ?? 0) + wOf(c));
      const effectiveFrom = (from: STunnel) => effective(from, load.get(from.ifname) ?? 0);
      const move = (c: SClient, from: STunnel, to: STunnel) => {
        load.set(from.ifname, Math.max(0, (load.get(from.ifname) ?? 0) - wOf(c)));
        load.set(to.ifname, (load.get(to.ifname) ?? 0) + wOf(c));
        apps.set(from.ifname, Math.max(0, (apps.get(from.ifname) ?? 1) - 1));
        apps.set(to.ifname, (apps.get(to.ifname) ?? 0) + 1);
      };
      return { load, apps, netGain, effectiveFrom, move };
    };

    /** A move is worth surfacing if the current tunnel is down, or the net
     *  effective gain is ≥2ms (validator) — the heuristic additionally wants
     *  ≥15% relative improvement before it volunteers one. */
    const accepts = (from: STunnel, gain: number) => !from.reachable || gain >= 2;

    /** Clamp the AI's raw list to the board and RE-PRICE each move under the
     *  load model — a suggestion that only looks good on raw latency (or that a
     *  prior suggestion in the same batch just crowded out) is dropped. */
    const validate = (raw: { client_id?: unknown; to_tunnel?: unknown; reason?: unknown }[]) => {
      const world = makeWorld();
      const moved = new Set<string>();
      const out: OutSuggestion[] = [];
      for (const r of raw) {
        const c = clients.find((x) => x.id === r.client_id);
        const to = typeof r.to_tunnel === 'string' ? byName.get(r.to_tunnel) : undefined;
        const from = c ? byName.get(c.tunnel) : undefined;
        if (!c || !to || !from || !to.reachable || to.ifname === from.ifname || moved.has(c.id)) continue;
        const gain = world.netGain(c, from, to);
        if (!accepts(from, gain)) continue;
        out.push({
          client_id: c.id, client_name: c.name, app: c.app,
          from_tunnel: from.ifname, to_tunnel: to.ifname,
          expected_gain_ms: Math.round(gain * 10) / 10,
          from_apps: world.apps.get(from.ifname) ?? 0,
          to_apps: world.apps.get(to.ifname) ?? 0,
          reason: String(r.reason ?? '').slice(0, 200) || 'Better effective latency once load is priced in.',
        });
        world.move(c, from, to);
        moved.add(c.id);
        if (out.length >= 3) break;
      }
      return out;
    };

    /** Greedy load-aware fallback: repeatedly take the single best net-gain
     *  move, commit it to the working world, and re-evaluate. Stops when the
     *  best remaining move is marginal (<2ms or <15% of effective latency). */
    const heuristic = () => {
      const world = makeWorld();
      const moved = new Set<string>();
      const out: OutSuggestion[] = [];
      while (out.length < 3) {
        let best: { c: SClient; from: STunnel; to: STunnel; gain: number } | null = null;
        for (const c of clients) {
          if (moved.has(c.id)) continue;
          const from = byName.get(c.tunnel);
          if (!from) continue;
          for (const to of tunnels) {
            if (!to.reachable || to.ifname === from.ifname) continue;
            const gain = world.netGain(c, from, to);
            if (!best || gain > best.gain) best = { c, from, to, gain };
          }
        }
        if (!best || !accepts(best.from, best.gain)) break;
        if (best.from.reachable && best.gain / Math.max(world.effectiveFrom(best.from), 1) < 0.15) break;
        const fromApps = world.apps.get(best.from.ifname) ?? 0;
        const toApps = world.apps.get(best.to.ifname) ?? 0;
        out.push({
          client_id: best.c.id, client_name: best.c.name, app: best.c.app,
          from_tunnel: best.from.ifname, to_tunnel: best.to.ifname,
          expected_gain_ms: Math.round(best.gain * 10) / 10,
          from_apps: fromApps, to_apps: toApps,
          reason: `${best.to.ifname} measures ${best.to.latency_ms} ms carrying ${toApps} app${toApps === 1 ? '' : 's'} vs ${best.from.ifname} at ${best.from.latency_ms} ms with ${fromApps} — ~${Math.round(best.gain)} ms better once load is priced in.`,
        });
        world.move(best.c, best.from, best.to);
        moved.add(best.c.id);
      }
      return out;
    };

    if (!llm.client || llm.provider !== 'bedrock') {
      logAIAudit({
        requestId,
        route: '/api/approute/suggest',
        useCase: 'application-route-advisor',
        provider: llm.provider,
        model: llm.model,
        outcome: 'fallback',
        startedAt,
        removedFields: ['clients[].id', 'clients[].name'],
        reason: llm.reason ?? 'Governed Bedrock client unavailable',
      });
      res.json({ mode: 'heuristic', note: `LLM not configured (${llm.reason ?? 'unknown'})`, suggestions: heuristic() });
      return;
    }

    try {
      // The model receives request-local pseudonyms, never stable client IDs or names.
      const modelClientMap = new Map<string, SClient>();
      const modelClients = clients.map((client, index) => {
        const pseudonym = `client-${index + 1}`;
        modelClientMap.set(pseudonym, client);
        return {
          id: pseudonym,
          app: client.app,
          tunnel: client.tunnel,
          weight: wOf(client),
        };
      });
      const prompt =
        'You are the route advisor for an SD-WAN application steering board. Each client runs ONE application ' +
        'pinned to ONE IPsec tunnel. Recommend up to 3 moves that measurably improve application performance. ' +
        'LOAD MODEL (use it, do not just compare raw latency): every tunnel carries `load` (sum of the app weights ' +
        `riding it) and each client has \`weight\`; effective_latency(tunnel) = latency_ms + ${LOAD_MS_PER_WEIGHT} * load, ` +
        'where a move first removes the client\'s weight from its current tunnel and adds it to the target — the ' +
        'raw-fastest tunnel is often the WRONG target when it is already crowded. Consider your suggestions in ' +
        'sequence: an earlier move changes the load the next one sees. ' +
        'Rules: never target an unreachable tunnel; realtime apps (voice/video/Teams/VoIP) care most about latency; ' +
        'bulk/telemetry tolerates 5G; prefer balanced placements over dogpiling; only suggest a move when the NET ' +
        'effective gain is meaningful (>=2ms and roughly >=15%), or the current tunnel is unreachable or clearly lossy. ' +
        `TUNNELS: ${JSON.stringify(tunnels)} CLIENTS: ${JSON.stringify(modelClients)} ` +
        'Reply with ONLY minified JSON, no prose, no code fences: ' +
        '{"suggestions":[{"client_id":"<id>","to_tunnel":"<ifname>","reason":"<max 160 chars, cite latency AND load numbers>"}]} ' +
        '(empty array if routing is already optimal).';

      const create = llm.client.messages.create({
        model: llm.model,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }) as Promise<{ content?: { type: string; text?: string }[] }>;
      const msg = await Promise.race([
        create,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('advisor LLM timed out (20s)')), 20_000)),
      ]);

      const text = (msg.content ?? []).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('');
      const stripped = text.replace(/^[\s\S]*?(\{)/, '$1').replace(/\}[^}]*$/, '}');
      const parsed = JSON.parse(stripped) as { suggestions?: unknown };
      const rawSuggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions as Record<string, unknown>[]
        : [];
      const mappedSuggestions = rawSuggestions.map((suggestion) => {
        const sourceClient = typeof suggestion.client_id === 'string'
          ? modelClientMap.get(suggestion.client_id)
          : undefined;
        return { ...suggestion, client_id: sourceClient?.id };
      });
      const suggestions = validate(mappedSuggestions);
      logAIAudit({
        requestId,
        route: '/api/approute/suggest',
        useCase: 'application-route-advisor',
        provider: llm.provider,
        model: llm.model,
        outcome: 'success',
        startedAt,
        removedFields: ['clients[].id', 'clients[].name'],
        inputChars: prompt.length,
        outputChars: text.length,
      });
      res.json({
        mode: 'ai',
        model: llm.model,
        suggestions,
        governance: { advisoryOnly: true, provider: llm.provider, requestId },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[approute-suggest] LLM path failed, serving heuristic:', err instanceof Error ? err.message : err);
      logAIAudit({
        requestId,
        route: '/api/approute/suggest',
        useCase: 'application-route-advisor',
        provider: llm.provider,
        model: llm.model,
        outcome: 'fallback',
        startedAt,
        removedFields: ['clients[].id', 'clients[].name'],
        reason: err instanceof Error ? err.message : String(err),
      });
      res.json({ mode: 'heuristic', note: 'AI unavailable — deterministic comparison shown', suggestions: heuristic() });
    }
  });
}
