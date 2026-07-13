/**
 * IPsec gateway routes — lifted verbatim from the main app's server/index.ts
 * and wrapped in a registrar so a host Express app can mount them with a
 * single call: `registerIpsecRoutes(app)`.
 *
 * Routes:
 *   • POST /api/gateway/path   — flip the gateway's active WAN path over MQTT
 *   • GET  /api/ipsec/snapshot — latest decoded payload for every gateway
 *   • GET  /api/ipsec/stream   — SSE stream of live updates + status
 */

import type { Express } from 'express';
import { ipsecSource } from './ipsecSource.js';

export function registerIpsecRoutes(app: Express): void {
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
}
