/**
 * Device inventory (IT/OT) routes — lifted verbatim from the main app's
 * server/index.ts and wrapped in a registrar so a host Express app can mount
 * them with a single call: `registerDevicesRoutes(app)`.
 */

import type { Express } from 'express';
import { deviceSource } from './deviceSource.js';
import { ipsecSource } from './ipsecSource.js';
import { historySeries } from './telemetryHistory.js';

export function registerDevicesRoutes(app: Express): void {
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
}
