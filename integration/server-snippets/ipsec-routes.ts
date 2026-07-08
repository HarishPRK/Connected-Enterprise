/**
 * IPsec routes — registers /api/ipsec/snapshot, /api/ipsec/stream, and
 * /api/gateway/path on the Express app passed in. Requires `ipsecSource.ts`
 * + `ipsecProto.ts` to live alongside this file (or wherever, just fix the
 * import).
 *
 * Usage in your server entry:
 *
 *   import { registerIpsecRoutes } from './ipsec-routes.js';
 *   registerIpsecRoutes(app);
 *
 * Env vars consumed:
 *   GATEWAY_PATH_HOST   — base URL of the gateway's path-control API (default
 *                          http://192.168.1.201:8090). Forwarded to from
 *                          /api/gateway/path so the browser can flip the
 *                          active underlay (Force Fiber / 5G / Auto).
 */

import type { Express } from 'express';
import { ipsecSource } from './ipsecSource.js';

const GATEWAY_PATH_HOST = process.env.GATEWAY_PATH_HOST ?? 'http://192.168.10.254:8090';

export function registerIpsecRoutes(app: Express): void {
  /** Current cached snapshot (hydrate-on-mount). */
  app.get('/api/ipsec/snapshot', (_req, res) => {
    res.json(ipsecSource.getSnapshot());
  });

  /** SSE stream — pushes every fresh update + a heartbeat. */
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

  /** POST /api/gateway/path — proxies the DPS Auto / Force-Fiber / Force-5G
   *  button to the gateway's path-control HTTP API at `:8090/api/path`.
   *  Browser can't reach the gateway directly (different network, CORS),
   *  so this same-origin proxy posts the JSON body verbatim. */
  app.post('/api/gateway/path', async (req, res) => {
    const mode = req.body?.mode;
    if (mode !== 'auto' && mode !== 'fiber' && mode !== '5g') {
      res.status(400).json({ error: `mode must be one of: auto, fiber, 5g (got ${JSON.stringify(mode)})` });
      return;
    }
    try {
      const upstream = await fetch(`${GATEWAY_PATH_HOST}/api/path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const text = await upstream.text();
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      res.status(upstream.status).send(text);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[gateway-path] upstream error:', err);
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
        upstream: GATEWAY_PATH_HOST,
      });
    }
  });
}
