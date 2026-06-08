/**
 * IPsec metrics MQTT subscriber.
 *
 * Connects to AWS IoT Core over MQTT-WebSocket with SigV4 auth (uses
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN from the
 * environment, same as the rest of our AWS plumbing). Subscribes to the
 * gateway's raw `rdk/ipsec/metrics` topic and decodes the protobuf payload
 * in-process — no IoT Rule needed. JSON payloads are also accepted as a
 * fallback in case an upstream rule starts publishing decoded JSON later.
 *
 * Maintains the latest decoded `IpsecMetrics` per gateway in an in-memory
 * `Map<gatewayName, IpsecGatewayState>` and exposes:
 *   • `getSnapshot()` — synchronous read of all gateways' latest state
 *   • `onUpdate(listener)` — subscribe to live updates (Express SSE uses this)
 */

import { mqtt, iot, auth } from 'aws-iot-device-sdk-v2';
import { EventEmitter } from 'node:events';
import type { IpsecGatewayState, IpsecMetrics } from '../src/types.js';
import { decodeIpsecMetrics } from './ipsecProto.js';

const ENDPOINT  = process.env.IOT_ENDPOINT ?? 'alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com';
const REGION    = process.env.IOT_REGION   ?? process.env.AWS_REGION ?? 'us-east-1';
const CLIENT_ID = process.env.IOT_CLIENT_ID ?? `ce-server-${Math.random().toString(36).slice(2, 10)}`;

// We subscribe to one topic per gateway family. Defaults cover Plano (rdk)
// and McKinney (prpl). Override the whole list with `IOT_IPSEC_TOPICS` as a
// comma-separated string. `IOT_IPSEC_TOPIC` (singular) is honoured for
// backwards-compat with older deploys.
const SUBSCRIBE_TOPICS: string[] = (() => {
  const single = process.env.IOT_IPSEC_TOPIC;
  const list   = process.env.IOT_IPSEC_TOPICS;
  const raw = list ?? single ?? 'rdk/ipsec/metrics,prpl/ipsec/metrics';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
})();

/** Map the MQTT topic to the gateway-source tag exposed in IpsecGatewayState.
 *  Anything starting with `rdk/` → 'rdk', `prpl/` → 'prpl', else 'other'. */
function topicToSource(topic: string): 'rdk' | 'prpl' | 'other' {
  if (topic.startsWith('rdk/'))  return 'rdk';
  if (topic.startsWith('prpl/')) return 'prpl';
  return 'other';
}

// Path-control: the gateway runs a `com.rdk.pathcontrol` Greengrass component
// subscribed to `<prefix>/path/control`. We publish a command there and listen
// for the gateway's ack on `<prefix>/path/control/result`. Prefixes mirror the
// metric topic families (Plano=rdk, McKinney=prpl).
const PATH_PREFIXES: string[] = (process.env.IOT_PATH_PREFIXES ?? 'rdk,prpl')
  .split(',').map((s) => s.trim()).filter(Boolean);
const pathControlTopic = (prefix: string) => `${prefix}/path/control`;
const pathResultTopic  = (prefix: string) => `${prefix}/path/control/result`;

// Device discovery (Phase 1): the gateway runs a `com.rdk.devicediscovery`
// component that enumerates its LAN clients and publishes a JSON inventory on
// `<prefix>/devices/inventory`. We subscribe and forward the raw payload to
// deviceSource via the `inventory` event — parsing/classification lives there.
const INVENTORY_TOPICS: string[] = (
  process.env.IOT_DEVICE_TOPICS ?? 'rdk/devices/inventory,prpl/devices/inventory'
).split(',').map((s) => s.trim()).filter(Boolean);

export interface PathCommandResult {
  ok: boolean;
  mode?: string;
  httpStatus?: number | null;
  error?: string;
  /** True when we published but never heard an ack within the timeout. */
  timedOut?: boolean;
}

interface IpsecSourceEvents {
  update: (snapshot: { gatewayKey: string; state: IpsecGatewayState }) => void;
  status: (status: { connected: boolean; reason?: string }) => void;
  /** Raw device-inventory payload from a gateway, tagged with its source. */
  inventory: (msg: { source: 'rdk' | 'prpl' | 'other'; payload: unknown }) => void;
}

class IpsecSource extends EventEmitter {
  private gateways = new Map<string, IpsecGatewayState>();
  private connection?: mqtt.MqttClientConnection;
  private started = false;
  private connected = false;
  private lastError?: string;
  /** In-flight path-control commands keyed by correlation id. */
  private pendingPathCmds = new Map<string, (r: PathCommandResult) => void>();

  /** Returns true if the SDK is wired up + AWS creds appear present. */
  hasCredentials(): boolean {
    return !!(
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      // EC2 instance role / ECS task role: creds come from IMDS (not env vars),
      // so newDefault() resolves them at connect time. Opt in explicitly.
      process.env.AWS_USE_INSTANCE_ROLE === '1' ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    if (!this.hasCredentials()) {
      // eslint-disable-next-line no-console
      console.warn('[ipsec] No AWS credentials (set AWS_ACCESS_KEY_ID / AWS_PROFILE, or AWS_USE_INSTANCE_ROLE=1 on EC2) — skipping IoT subscription. The dashboard will return an empty snapshot.');
      this.lastError = 'no-aws-credentials';
      return;
    }

    try {
      const credentialsProvider = auth.AwsCredentialsProvider.newDefault();
      const builder = iot.AwsIotMqttConnectionConfigBuilder
        .new_with_websockets({
          region: REGION,
          credentials_provider: credentialsProvider,
        });

      builder.with_endpoint(ENDPOINT);
      builder.with_client_id(CLIENT_ID);
      builder.with_clean_session(true);
      builder.with_keep_alive_seconds(60);

      const client = new mqtt.MqttClient();
      this.connection = client.new_connection(builder.build());

      this.connection.on('connect', () => {
        this.connected = true;
        this.lastError = undefined;
        // eslint-disable-next-line no-console
        console.log(`[ipsec] connected to ${ENDPOINT} as ${CLIENT_ID}, subscribing to [${SUBSCRIBE_TOPICS.join(', ')}]`);
        this.emit('status', { connected: true });
      });
      this.connection.on('interrupt', (err) => {
        this.connected = false;
        this.lastError = err?.error ?? String(err);
        // eslint-disable-next-line no-console
        console.warn('[ipsec] connection interrupted:', this.lastError);
        this.emit('status', { connected: false, reason: this.lastError });
      });
      this.connection.on('resume', () => {
        this.connected = true;
        this.lastError = undefined;
        // eslint-disable-next-line no-console
        console.log('[ipsec] connection resumed');
        this.emit('status', { connected: true });
      });
      this.connection.on('disconnect', () => {
        this.connected = false;
        // eslint-disable-next-line no-console
        console.log('[ipsec] disconnected');
        this.emit('status', { connected: false });
      });
      this.connection.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[ipsec] mqtt error:', err);
      });

      await this.connection.connect();

      // Subscribe to every configured topic. Each gateway's payload carries
      // its own `gateway.name`; we tag the cached state with the source so the
      // UI can route Plano (`rdk/...`) and McKinney (`prpl/...`) separately.
      for (const topic of SUBSCRIBE_TOPICS) {
        await this.connection.subscribe(
          topic,
          mqtt.QoS.AtMostOnce,
          (t, payload) => this.handleMessage(t, payload),
        );
      }

      // Subscribe to the path-control result topics so we can correlate acks
      // from the gateway's pathcontrol component back to in-flight commands.
      for (const prefix of PATH_PREFIXES) {
        await this.connection.subscribe(
          pathResultTopic(prefix),
          mqtt.QoS.AtLeastOnce,
          (t, payload) => this.handlePathResult(t, payload),
        );
      }

      // Subscribe to the device-inventory topics. The parsed payload is fanned
      // out via the `inventory` event; deviceSource consumes it.
      for (const topic of INVENTORY_TOPICS) {
        await this.connection.subscribe(
          topic,
          mqtt.QoS.AtLeastOnce,
          (t, payload) => this.handleInventory(t, payload),
        );
      }
    } catch (err) {
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[ipsec] failed to connect/subscribe:', err);
      this.emit('status', { connected: false, reason: this.lastError });
    }
  }

  private handleMessage(topic: string, payload: ArrayBuffer): void {
    try {
      const bytes = new Uint8Array(payload);

      // The gateway publishes raw protobuf bytes on `rdk/ipsec/metrics`.
      // If an upstream IoT Rule ever starts producing JSON instead (e.g. by
      // running `decode(*, 'proto', …)` first), accept that shape too.
      const looksLikeJson = bytes.length > 0 && (bytes[0] === 0x7b /* { */ || bytes[0] === 0x5b /* [ */);

      let metrics: IpsecMetrics;
      if (looksLikeJson) {
        const text = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(text) as IpsecMetrics | { metrics: IpsecMetrics };
        metrics = 'metrics' in parsed && typeof parsed.metrics === 'object'
          ? (parsed as { metrics: IpsecMetrics }).metrics
          : (parsed as IpsecMetrics);
      } else {
        metrics = decodeIpsecMetrics(bytes);
      }

      // Normalise: protobuf3 default values may yield undefined fields when
      // the source omits them. Fill in defaults so the UI doesn't crash.
      const normalised: IpsecMetrics = {
        timestamp_ms: Number(metrics.timestamp_ms ?? 0),
        active_tunnel: String(metrics.active_tunnel ?? ''),
        tunnel_count: Number(metrics.tunnel_count ?? (metrics.tunnels?.length ?? 0)),
        tunnels: Array.isArray(metrics.tunnels) ? metrics.tunnels.map((t) => ({
          ifname:       String(t.ifname ?? ''),
          present:      Boolean(t.present),
          reachable:    Boolean(t.reachable),
          latency_ms:   Number(t.latency_ms ?? 0),
          loss_percent: Number(t.loss_percent ?? 0),
          rx_bytes:     Number(t.rx_bytes ?? 0),
          tx_bytes:     Number(t.tx_bytes ?? 0),
        })) : [],
        wan: {
          ifname:     String(metrics.wan?.ifname ?? ''),
          link_up:    Boolean(metrics.wan?.link_up),
          rx_bytes:   Number(metrics.wan?.rx_bytes   ?? 0),
          tx_bytes:   Number(metrics.wan?.tx_bytes   ?? 0),
          rx_packets: Number(metrics.wan?.rx_packets ?? 0),
          tx_packets: Number(metrics.wan?.tx_packets ?? 0),
        },
        gateway: {
          name:        String(metrics.gateway?.name ?? 'unknown'),
          mac:         String(metrics.gateway?.mac ?? ''),
          prim_wan_ip: String(metrics.gateway?.prim_wan_ip ?? ''),
          sec_wan_ip:  String(metrics.gateway?.sec_wan_ip ?? ''),
        },
      };

      const source = topicToSource(topic);
      // Key by `<source>:<gateway-name>` so the two streams never collide even
      // if both ever publish a gateway with the same name.
      const baseKey = (normalised.gateway.name || normalised.gateway.mac || 'unknown').toLowerCase();
      const gatewayKey = `${source}:${baseKey}`;
      const state: IpsecGatewayState = { metrics: normalised, receivedAt: Date.now(), source };
      this.gateways.set(gatewayKey, state);
      this.emit('update', { gatewayKey, state });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[ipsec] failed to parse payload on "${topic}":`, err);
    }
  }

  /** Result-topic handler — matches the ack back to its pending command by id. */
  private handlePathResult(topic: string, payload: ArrayBuffer): void {
    try {
      const text = new TextDecoder().decode(new Uint8Array(payload));
      const msg = JSON.parse(text) as PathCommandResult & { id?: string };
      // eslint-disable-next-line no-console
      console.log(`[pathctl] result on "${topic}":`, text);
      if (msg.id && this.pendingPathCmds.has(msg.id)) {
        const resolve = this.pendingPathCmds.get(msg.id)!;
        this.pendingPathCmds.delete(msg.id);
        resolve({ ok: !!msg.ok, mode: msg.mode, httpStatus: msg.httpStatus ?? null, error: msg.error });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[pathctl] failed to parse result on "${topic}":`, err);
    }
  }

  /** Inventory-topic handler — decodes the JSON device list and forwards it.
   *  Parsing/classification is deviceSource's job; we just deliver the payload
   *  tagged with the gateway source. */
  private handleInventory(topic: string, payload: ArrayBuffer): void {
    try {
      const text = new TextDecoder().decode(new Uint8Array(payload));
      const parsed = JSON.parse(text) as unknown;
      this.emit('inventory', { source: topicToSource(topic), payload: parsed });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[devices] failed to parse inventory on "${topic}":`, err);
    }
  }

  /** Publish a path-control command to `<prefix>/path/control` and wait for the
   *  gateway's ack on the result topic (correlated by id). Resolves with the
   *  ack, or `{ ok:false, timedOut:true }` if no ack arrives in time.
   *  Optional `tunnel` pins the request to a specific tunnel ifname (e.g.
   *  `vti-fiber1`) — the gateway component can honour it if it knows how. */
  async sendPathCommand(
    prefix: string,
    mode: 'auto' | 'fiber' | '5g' | 'tunnel1' | 'tunnel2' | 'tunnel3' | 'tunnel4',
    timeoutMs = 6000,
    tunnel?: string,
  ): Promise<PathCommandResult> {
    if (!this.connection || !this.connected) {
      return { ok: false, error: 'MQTT not connected — cannot reach the gateway' };
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const topic = pathControlTopic(prefix);

    const ackPromise = new Promise<PathCommandResult>((resolve) => {
      this.pendingPathCmds.set(id, resolve);
      setTimeout(() => {
        if (this.pendingPathCmds.has(id)) {
          this.pendingPathCmds.delete(id);
          resolve({ ok: false, timedOut: true, mode, error: 'No ack from gateway within timeout' });
        }
      }, timeoutMs);
    });

    // The gateway's com.rdk.pathcontrol component only understands `{ id, mode }`.
    // The UI lets the user pick a tunnel (for the optimistic flip + toast), but
    // we intentionally do NOT put `tunnel` on the wire so the published command
    // matches exactly what the component expects. Re-add it here once the
    // gateway gains a tunnel-pinning endpoint.
    const payload: Record<string, unknown> = { id, mode };

    try {
      await this.connection.publish(
        topic,
        JSON.stringify(payload),
        mqtt.QoS.AtLeastOnce,
      );
      // eslint-disable-next-line no-console
      console.log(`[pathctl] published ${JSON.stringify(payload)} to "${topic}"`);
    } catch (err) {
      this.pendingPathCmds.delete(id);
      return { ok: false, mode, error: err instanceof Error ? err.message : String(err) };
    }

    return ackPromise;
  }

  getSnapshot() {
    return {
      gateways: Object.fromEntries(this.gateways.entries()),
      receivedAt: Date.now(),
      connected: this.connected,
      lastError: this.lastError,
      subscribedTopic: SUBSCRIBE_TOPICS.join(', '),
      subscribedTopics: SUBSCRIBE_TOPICS,
      endpoint: ENDPOINT,
    };
  }

  isConnected() {
    return this.connected;
  }

  onUpdate(listener: IpsecSourceEvents['update']): () => void {
    this.on('update', listener);
    return () => this.off('update', listener);
  }

  onStatus(listener: IpsecSourceEvents['status']): () => void {
    this.on('status', listener);
    return () => this.off('status', listener);
  }

  onInventory(listener: IpsecSourceEvents['inventory']): () => void {
    this.on('inventory', listener);
    return () => this.off('inventory', listener);
  }
}

export const ipsecSource = new IpsecSource();
