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

const ENDPOINT       = process.env.IOT_ENDPOINT       ?? 'alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com';
const REGION         = process.env.IOT_REGION         ?? process.env.AWS_REGION ?? 'us-east-1';
const SUBSCRIBE_TOPIC = process.env.IOT_IPSEC_TOPIC   ?? 'rdk/ipsec/metrics';
const CLIENT_ID      = process.env.IOT_CLIENT_ID      ?? `ce-server-${Math.random().toString(36).slice(2, 10)}`;

interface IpsecSourceEvents {
  update: (snapshot: { gatewayKey: string; state: IpsecGatewayState }) => void;
  status: (status: { connected: boolean; reason?: string }) => void;
}

class IpsecSource extends EventEmitter {
  private gateways = new Map<string, IpsecGatewayState>();
  private connection?: mqtt.MqttClientConnection;
  private started = false;
  private connected = false;
  private lastError?: string;

  /** Returns true if the SDK is wired up + AWS creds appear present. */
  hasCredentials(): boolean {
    return !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    if (!this.hasCredentials()) {
      // eslint-disable-next-line no-console
      console.warn('[ipsec] No AWS credentials in env (AWS_ACCESS_KEY_ID / AWS_PROFILE) — skipping IoT subscription. The dashboard will return an empty snapshot.');
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
        console.log(`[ipsec] connected to ${ENDPOINT} as ${CLIENT_ID}, subscribing to "${SUBSCRIBE_TOPIC}"`);
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

      await this.connection.subscribe(
        SUBSCRIBE_TOPIC,
        mqtt.QoS.AtMostOnce,
        (topic, payload) => this.handleMessage(topic, payload),
      );
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

      const gatewayKey = (normalised.gateway.name || normalised.gateway.mac || 'unknown').toLowerCase();
      const state: IpsecGatewayState = { metrics: normalised, receivedAt: Date.now() };
      this.gateways.set(gatewayKey, state);
      this.emit('update', { gatewayKey, state });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[ipsec] failed to parse payload on "${topic}":`, err);
    }
  }

  getSnapshot() {
    return {
      gateways: Object.fromEntries(this.gateways.entries()),
      receivedAt: Date.now(),
      connected: this.connected,
      lastError: this.lastError,
      subscribedTopic: SUBSCRIBE_TOPIC,
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
}

export const ipsecSource = new IpsecSource();
