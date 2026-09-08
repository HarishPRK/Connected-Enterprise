import { createServer, type IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { commandSchema, type CommandAck, type ServerMessage, type Telemetry } from '../shared/telemetry.js';
import type { ServiceOptions } from './config.js';
import { MqttHardwareAdapter } from './hardware.js';
import { CoolerSimulator } from './simulator.js';

interface ClientState {
  alive: boolean;
  requests: number;
  windowStart: number;
  acknowledgements: Map<string, CommandAck>;
  pending: Set<string>;
}

/** Single-device edge gateway. Fan out many gateways through an authenticated broker for fleets. */
export function createTelemetryService(options: ServiceOptions) {
  const app = express();
  app.disable('x-powered-by');
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const clients = new Map<WebSocket, ClientState>();
  const simulator = options.source === 'simulator' ? new CoolerSimulator(options.deviceId) : undefined;
  let latest = simulator?.snapshot();
  let lastReceivedAt = latest ? Date.now() : 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closing = false;

  const send = (ws: WebSocket, packet: ServerMessage) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Close stalled clients before an unbounded queue consumes the edge device's RAM.
    if (ws.bufferedAmount > 256 * 1024) { ws.close(1013, 'Slow consumer; reconnect for latest telemetry'); return; }
    ws.send(JSON.stringify(packet));
  };
  const broadcast = (data: Telemetry) => {
    latest = data;
    // A newly delivered but old hardware sample must not look like a fresh sensor reading.
    lastReceivedAt = Math.min(Date.now(), Date.parse(data.timestamp));
    for (const ws of clients.keys()) send(ws, { type: 'telemetry', data });
  };
  const hardware = options.source === 'hardware' ? new MqttHardwareAdapter({
    url: options.mqttUrl!, deviceId: options.deviceId, username: options.mqttUsername,
    password: options.mqttPassword, commandsEnabled: options.hardwareCommandsEnabled,
    onTelemetry: broadcast, onStatus: (message) => console.info(`[telemetry] ${message}`),
  }) : undefined;

  app.use((request, response, next) => {
    const origin = request.headers.origin;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (origin && !options.allowedOrigins.includes(origin)) { response.status(403).json({ error: 'Origin is not allowed' }); return; }
    if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
    next();
  });
  app.get('/api/health', (_request, response) => {
    const stale = !latest || Date.now() - lastReceivedAt > 5000;
    response.status(stale ? 503 : 200).json({
      status: stale ? 'awaiting-telemetry' : 'ok', source: options.source, deviceId: options.deviceId,
      schemaVersion: 1, clients: clients.size, telemetryAgeMs: latest ? Date.now() - lastReceivedAt : null,
      mqttConnected: hardware?.connected ?? null, rejectedPackets: hardware?.rejectedPackets ?? 0,
      simulationTimeScale: simulator ? options.timeScale : null,
    });
  });
  app.get('/api/telemetry', (_request, response) => {
    if (!latest) { response.status(503).json({ error: 'Waiting for physical device telemetry' }); return; }
    if (Date.now() - lastReceivedAt > 5000) response.setHeader('Warning', '110 - "Telemetry is stale"');
    response.json(latest);
  });

  // A built client and telemetry share one origin in production: npm run build && npm start.
  const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
  const appHtml = fileURLToPath(new URL('../dist/index.html', import.meta.url));
  if (existsSync(appHtml)) {
    app.use(express.static(distDirectory, {
      setHeaders(response, path) {
        response.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }));
    app.get(/.*/, (request, response) => {
      if (request.path.startsWith('/api/') || request.path === '/ws' || /\.[a-zA-Z0-9]+$/.test(request.path)) { response.status(404).json({ error: 'Not found' }); return; }
      response.sendFile(appHtml);
    });
  }

  const rejectUpgrade = (socket: import('node:stream').Duplex, status: number, message: string) => {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };
  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    if (closing || clients.size >= 100) { rejectUpgrade(socket, 503, 'Service Unavailable'); return; }
    if (request.url?.split('?')[0] !== '/ws') { rejectUpgrade(socket, 404, 'Not Found'); return; }
    if (request.headers.origin && !options.allowedOrigins.includes(request.headers.origin)) { rejectUpgrade(socket, 403, 'Forbidden'); return; }
    // The service binds to loopback. Expose through an authenticated TLS reverse proxy only.
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (ws) => {
    const state: ClientState = { alive: true, requests: 0, windowStart: Date.now(), acknowledgements: new Map(), pending: new Set() };
    clients.set(ws, state);
    if (latest) send(ws, { type: 'telemetry', data: latest });
    ws.on('pong', () => { state.alive = true; });
    ws.on('error', () => { ws.terminate(); });
    ws.on('close', () => { clients.delete(ws); });
    ws.on('message', async (raw: RawData, isBinary) => {
      if (isBinary) { ws.close(1003, 'JSON text messages required'); return; }
      if (Date.now() - state.windowStart > 10_000) { state.windowStart = Date.now(); state.requests = 0; }
      if (++state.requests > 40) { ws.close(1008, 'Command rate limit exceeded'); return; }
      let payload: unknown;
      try { payload = JSON.parse(raw.toString()); } catch { send(ws, { type: 'ack', id: 'invalid', ok: false, error: 'Malformed JSON' }); return; }
      const parsed = commandSchema.safeParse(payload);
      if (!parsed.success) {
        const candidate = payload as { id?: unknown } | null;
        const id = typeof candidate?.id === 'string' && candidate.id.length > 0 && candidate.id.length <= 80 ? candidate.id : 'invalid';
        send(ws, { type: 'ack', id, ok: false, error: 'Invalid command or value outside allowed bounds' });
        return;
      }
      const command = parsed.data;
      const previous = state.acknowledgements.get(command.id);
      if (previous) { send(ws, previous); return; }
      if (state.pending.has(command.id)) return;
      state.pending.add(command.id);
      let ack: CommandAck;
      try {
        if (simulator) {
          const data = simulator.command(command);
          ack = { type: 'ack', id: command.id, ok: true };
          broadcast(data);
        } else {
          ack = await hardware!.command(command);
        }
      } catch {
        ack = { type: 'ack', id: command.id, ok: false, error: 'Command could not be completed' };
      }
      state.pending.delete(command.id);
      state.acknowledgements.set(command.id, ack);
      if (state.acknowledgements.size > 100) state.acknowledgements.delete(state.acknowledgements.keys().next().value!);
      send(ws, ack);
    });
  });

  return {
    app, server,
    async start() {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.host, () => { server.off('error', reject); resolve(); });
      });
      hardware?.start();
      let previousTime = performance.now();
      timer = setInterval(() => {
        const currentTime = performance.now();
        // Cap catch-up after a suspended laptop, avoiding a burst of thousands of integration steps.
        const elapsed = Math.min((currentTime - previousTime) / 1000 * options.timeScale, 60);
        previousTime = currentTime;
        if (simulator) broadcast(simulator.tick(elapsed));
      }, 1000);
      timer.unref();
      heartbeat = setInterval(() => {
        for (const [ws, state] of clients) {
          if (!state.alive) { ws.terminate(); continue; }
          state.alive = false;
          if (ws.readyState === WebSocket.OPEN) ws.ping();
        }
      }, 15_000);
      heartbeat.unref();
      const address = server.address();
      return typeof address === 'object' && address ? address.port : options.port;
    },
    async stop() {
      closing = true;
      if (timer) clearInterval(timer);
      if (heartbeat) clearInterval(heartbeat);
      for (const ws of clients.keys()) ws.terminate();
      clients.clear();
      await hardware?.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
