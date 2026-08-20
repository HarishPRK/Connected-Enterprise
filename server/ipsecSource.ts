/**
 * IPsec metrics MQTT subscriber.
 *
 * Connects to AWS IoT Core over MQTT-WebSocket with SigV4 auth (uses
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN from the
 * environment, same as the rest of our AWS plumbing). Subscribes to the
 * gateway's configured IPsec metrics topics and decodes the protobuf
 * payload in-process — no IoT Rule needed. JSON payloads are also accepted as
 * a fallback in case an upstream rule starts publishing decoded JSON later.
 *
 * Maintains the latest decoded `IpsecMetrics` per gateway in an in-memory
 * `Map<gatewayName, IpsecGatewayState>` and exposes:
 *   • `getSnapshot()` — synchronous read of all gateways' latest state
 *   • `onUpdate(listener)` — subscribe to live updates (Express SSE uses this)
 */

import { mqtt, iot, auth } from 'aws-iot-device-sdk-v2';
import { EventEmitter } from 'node:events';
import type { DeviceTelemetry, IpsecGatewayState, IpsecMetrics, IpsecWifiClient } from '../src/types.js';
import { decodeIpsecMetrics } from './ipsecProto.js';
import {
  decodeFlow, decodeTunnel, decodeRoute, decodeDecision,
  type AarFlow, type AarTunnel, type AarRoute, type AarDecision, type AarSnapshot,
} from './aarProto.js';
import { gatewayTwinSource } from './gatewayTwinSource.js';
import {
  advanceWanTrafficRate,
  type WanCounterSample,
} from './wanTrafficRate.js';

const ENDPOINT  = process.env.IOT_ENDPOINT ?? 'alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com';
const REGION    = process.env.IOT_REGION   ?? process.env.AWS_REGION ?? 'us-east-1';
const CLIENT_ID = process.env.IOT_CLIENT_ID ?? `ce-server-${Math.random().toString(36).slice(2, 10)}`;
const SUBSCRIBE_MAX_ATTEMPTS = 3;
const SUBSCRIBE_RETRY_BASE_MS = 250;
const GATEWAY_TWIN_RETRY_MS = 5_000;

// We subscribe to one topic per gateway family. Defaults cover Plano (rdk),
// the original McKinney topic (prpl), and the QDR McKinney topic (prplhome).
// Override the whole list with `IOT_IPSEC_TOPICS` as a comma-separated string.
// `IOT_IPSEC_TOPIC` (singular) is honoured for backwards compatibility.
export const DEFAULT_IPSEC_TOPICS = [
  'rdk/ipsec/metrics',
  'prpl/ipsec/metrics',
  'prplhome/ipsec/metrics',
] as const;

/** Parse a comma-separated topic setting. Empty values are treated as unset so
 *  a copied `.env.example` cannot silently disable an entire live feed. */
export function resolveTopicList(
  configured: string | undefined,
  defaults: readonly string[],
): string[] {
  const topics = (configured ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return topics.length > 0 ? topics : [...defaults];
}

const SUBSCRIBE_TOPICS: string[] = (() => {
  const list = process.env.IOT_IPSEC_TOPICS?.trim();
  const single = process.env.IOT_IPSEC_TOPIC?.trim();
  return resolveTopicList(list || single, DEFAULT_IPSEC_TOPICS);
})();

// Only these IPsec topics are authoritative device/Wi-Fi inventory sources.
// In McKinney, `prpl/ipsec/metrics` owns failover/WAN telemetry while
// `prplhome/ipsec/metrics` owns IT/OT client inventory.
export const DEFAULT_IPSEC_DEVICE_TOPICS = [
  'rdk/ipsec/metrics',
  'prplhome/ipsec/metrics',
] as const;
const IPSEC_DEVICE_TOPICS = new Set(
  resolveTopicList(process.env.IOT_IPSEC_DEVICE_TOPICS, DEFAULT_IPSEC_DEVICE_TOPICS),
);

// Application-Aware Routing telemetry topics (proto/aar.proto). The AAR plugin
// publishes on unprefixed `routing/*` topics. Override with IOT_AAR_TOPICS.
const AAR_TOPICS: string[] = (
  process.env.IOT_AAR_TOPICS ?? 'routing/flow,routing/tunnel,routing/route,routing/decision'
).split(',').map((s) => s.trim()).filter(Boolean);

/** Map the MQTT topic to the gateway-source tag exposed in IpsecGatewayState.
 *  `prplhome` is the QDR/McKinney alias and routes to the same `prpl` branch
 *  used by IT/OT Devices and Dynamic Failover. */
function topicToSource(topic: string): 'rdk' | 'prpl' | 'other' {
  if (topic.startsWith('rdk/'))  return 'rdk';
  if (topic.startsWith('prpl/') || topic.startsWith('prplhome/')) return 'prpl';
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
  process.env.IOT_DEVICE_TOPICS ?? 'rdk/devices/inventory'
).split(',').map((s) => s.trim()).filter(Boolean);

// Matter device list: the Plano gateway's `com.rdk.matter.devicelist` component
// publishes the Matter hub's GET_DEVICES_LIST reply VERBATIM on
// `rdk/matter/devices/list` every 30s. We forward it through the same
// `inventory` event under a distinct `<prefix>:matter` source tag so it never
// clobbers a full LAN inventory from `<prefix>/devices/inventory`; deviceSource
// recognizes the hub shape and treats it as a partial (OT-only) inventory.
const MATTER_TOPICS: string[] = (
  process.env.IOT_MATTER_TOPICS ?? 'rdk/matter/devices/list'
).split(',').map((s) => s.trim()).filter(Boolean);

// Matter device control: the Plano gateway's `com.rdk.matter.devicecontrol`
// component (v2+) subscribes to the control topic via the gateway's local
// broker + clientdevices.mqtt.Bridge (same transport as com.rdk.pathcontrol),
// forwards the command to the Matter hub CGI with axios, and acks on the
// result topic.
const MATTER_CONTROL_TOPIC = process.env.IOT_MATTER_CONTROL_TOPIC ?? 'rdk/matter/device/control';
const MATTER_RESULT_TOPIC = process.env.IOT_MATTER_RESULT_TOPIC ?? 'rdk/matter/device/control/result';
// Poking this topic makes the devicelist component (v2+) re-fetch the hub
// device list and republish it on `rdk/matter/devices/list` — an on-demand
// refresh so the cloud doesn't need a redeploy for a fresh Matter inventory.
const MATTER_REFRESH_TOPIC = process.env.IOT_MATTER_REFRESH_TOPIC ?? 'rdk/matter/devices/refresh';
// CGI branch the component posts to. The Plano hub firmware's CONTROL_DEVICE
// branch is broken (its parser needs jq, which the matter_bundle image doesn't
// ship), so we ride the UPDATE_DEVICE branch — it forwards the POST body
// verbatim to the same Matter backend, which dispatches on the JSON's own
// `cmd` field. Set IOT_MATTER_QUERY_CMD=CONTROL_DEVICE once the firmware is
// fixed.
const MATTER_QUERY_CMD = process.env.IOT_MATTER_QUERY_CMD ?? 'UPDATE_DEVICE';

// Shelly Gen2+ devices connected DIRECTLY to IoT Core over MQTT (no gateway in
// the path). Each device publishes RPC notifications on `<id>/events/rpc` and
// a retained online flag on `<id>/online`; commands go to `<id>/rpc` with a
// `src` reply prefix the device answers on (`<src>/rpc`). The fleet is
// env-driven — add ids with IOT_SHELLY_DEVICES (comma-separated).
const SHELLY_DEVICE_IDS: string[] = (
  process.env.IOT_SHELLY_DEVICES ?? [
    'shellyplus1pm-cc7b5c844c18', // existing Coffee Brewer / lab device
    'shellyplus1pm-c049ef8ce640', // Grinder
    'shellyplus1pm-c049ef8cb0f4', // Air Fryer
    'shellyplus1pm-c049ef8cb75c', // Mixer
    'shellyplus1pm-90380c34cd74', // Instant Pot
    'shellyplus1pm-c049ef8c9324', // Coffee Brewer
    'shellyplus1pm-90380c3695a8', // Exhaust
    'shellyplus1pm-c049ef8ce5c4', // Kettle
  ].join(',')
).split(',').map((s) => s.trim()).filter(Boolean);
const SHELLY_REPLY_SRC = process.env.IOT_SHELLY_REPLY_SRC ?? 'rdk/shelly/ce-server';

/** Shelly ids embed the device MAC as their 12-hex-char suffix
 *  (shellyplus1pm-cc7b5c844c18 → CC:7B:5C:84:4C:18); fall back to a
 *  deterministic locally-administered MAC for non-conforming ids. */
function shellyMac(id: string): string {
  const suffix = id.slice(id.lastIndexOf('-') + 1);
  if (/^[0-9a-fA-F]{12}$/.test(suffix)) {
    return suffix.toUpperCase().replace(/(..)(?=.)/g, '$1:');
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hex = h.toString(16).padStart(8, '0').toUpperCase();
  return `0E:53:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}`;
}

export interface PathCommandResult {
  ok: boolean;
  mode?: string;
  httpStatus?: number | null;
  error?: string;
  /** True when we published but never heard an ack within the timeout. */
  timedOut?: boolean;
}

export interface MatterCommandResult {
  ok: boolean;
  requestId?: string;
  /** The Matter hub CGI's reply, relayed verbatim by the gateway component. */
  hubResponse?: unknown;
  error?: string;
  /** True when we published but never heard an ack within the timeout. */
  timedOut?: boolean;
}

interface ShellyState {
  online: boolean;
  output?: boolean;
  firstSeenAt: number;
  uptimeSec?: number;
  telemetry?: DeviceTelemetry;
}

/** The `switch:0` component shape from a Shelly Gen2 NotifyStatus / status
 *  dump. Notifications are partial — only changed fields are present. */
interface ShellySwitchPayload {
  output?: boolean;
  apower?: number;
  voltage?: number;
  current?: number;
  aenergy?: { total?: number };
  temperature?: { tC?: number };
}

export interface ShellyCommandResult {
  ok: boolean;
  requestId?: number;
  /** The device's RPC `result` (or `error`) payload. */
  response?: unknown;
  error?: string;
  /** True when we published but never heard the device's reply in time. */
  timedOut?: boolean;
}

interface IpsecSourceEvents {
  update: (snapshot: { gatewayKey: string; state: IpsecGatewayState }) => void;
  status: (status: { connected: boolean; reason?: string }) => void;
  /** Raw device-inventory payload from a gateway, tagged with its source
   *  (`rdk` / `prpl` / `other`, or `<prefix>:matter` for Matter hub lists). */
  inventory: (msg: { source: string; payload: unknown }) => void;
  /** Aggregated Application-Aware Routing state after every `routing/*` message. */
  aar: (snapshot: AarSnapshot) => void;
}

/** Map a gateway Wi-Fi client to the device-inventory wire shape consumed by
 *  deviceSource (telemetry + a status hint from the gateway's own verdict). */
function wifiClientToRawDevice(c: IpsecWifiClient): Record<string, unknown> {
  // Status reflects reachability only — the gateway's link-health verdict
  // (high_retrans / tx_errors / weak RSSI) is surfaced separately in the
  // device's telemetry and diagnostics, NOT as a Degraded badge.
  const status: 'ok' | 'err' = !c.active || !c.authenticated ? 'err' : 'ok';
  return {
    id: `wifi-${c.mac}`,
    mac: c.mac,
    ip: c.ip || undefined,
    hostname: c.hostname || undefined,
    name: c.hostname || undefined,
    conn: 'wifi',
    online: c.active !== false,
    statusHint: status,
    telemetry: {
      rssiDbm: c.rssi,
      snrDb: c.snr || undefined,
      // The gateway reports link rates in kbps (e.g. 54000 = 54 Mbps).
      linkDownMbps: c.downlink_rate ? c.downlink_rate / 1000 : undefined,
      linkUpMbps: c.uplink_rate ? c.uplink_rate / 1000 : undefined,
      wifiStandard: c.standard || undefined,
      wifiHealth: c.health || undefined,
      wifiApIndex: Number.isFinite(c.ap_index) ? c.ap_index : undefined,
      rxBytes: c.rx_bytes || undefined,
      txBytes: c.tx_bytes || undefined,
    },
  };
}

export class IpsecSource extends EventEmitter {
  private gateways = new Map<string, IpsecGatewayState>();
  /** One latest cumulative-counter baseline per exact WAN stream. Keeping it
   * server-side means a dashboard reload can use the already-derived rate. */
  private wanCounterBaselines = new Map<string, WanCounterSample>();
  private connection?: mqtt.MqttClientConnection;
  private started = false;
  private connected = false;
  private lastError?: string;
  private gatewayTwinSubscribed = false;
  private gatewayTwinSubscribedTopics = new Set<string>();
  private gatewayTwinSubscriptionGeneration = 0;
  private gatewayTwinRetryTimer?: NodeJS.Timeout;
  /** Serializes full subscription refreshes so a reconnect cannot race the
   *  initial registration pass or another resume event. */
  private subscriptionRefresh: Promise<void> = Promise.resolve();
  /** Reconnects re-register Shelly topics, but must not create another poller. */
  private shellyStatusPoll?: NodeJS.Timeout;
  /** In-flight path-control commands keyed by correlation id. */
  private pendingPathCmds = new Map<string, (r: PathCommandResult) => void>();
  /** In-flight Matter control commands keyed by requestId. */
  private pendingMatterCmds = new Map<string, (r: MatterCommandResult) => void>();
  /** In-flight Shelly RPCs keyed by their numeric rpc id. */
  private pendingShellyCmds = new Map<number, (r: ShellyCommandResult) => void>();
  /** In-flight Shelly.GetStatus polls: rpc id → device id. */
  private pendingStatusReqs = new Map<number, string>();
  private shellyCmdSeq = 1;
  /** Last known state per Shelly device id (fed into the device inventory). */
  private shellyStates = new Map<string, ShellyState>();
  /** First time each Wi-Fi client MAC was seen this session — the gateway
   *  doesn't report association time, so "connected for" grows from here. */
  private wifiFirstSeen = new Map<string, number>();

  /** Latest AAR telemetry, keyed so repeats replace rather than accumulate:
   *  tunnels by iface, decisions/routes by their subject IP, flows as a
   *  bounded recent list. */
  private aarTunnels = new Map<string, AarTunnel & { updatedAt: number }>();
  private aarDecisions = new Map<string, AarDecision & { updatedAt: number }>();
  private aarRoutes = new Map<string, AarRoute & { updatedAt: number }>();
  private aarFlows: (AarFlow & { updatedAt: number })[] = [];
  private aarLastAt = 0;

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
    gatewayTwinSource.setEndpoint(ENDPOINT);

    if (!this.hasCredentials()) {
      // eslint-disable-next-line no-console
      console.warn('[ipsec] No AWS credentials (set AWS_ACCESS_KEY_ID / AWS_PROFILE, or AWS_USE_INSTANCE_ROLE=1 on EC2) — skipping IoT subscription. The dashboard will return an empty snapshot.');
      this.lastError = 'no-aws-credentials';
      gatewayTwinSource.setConnectionState('offline', this.lastError);
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
        gatewayTwinSource.setConnectionState('connecting');
        // eslint-disable-next-line no-console
        console.log(`[ipsec] connected to ${ENDPOINT} as ${CLIENT_ID}, subscribing to [${SUBSCRIBE_TOPICS.join(', ')}]`);
        this.emit('status', { connected: true });
      });
      this.connection.on('interrupt', (err) => {
        this.connected = false;
        this.lastError = err?.error ?? String(err);
        this.resetGatewayTwinSubscriptions();
        gatewayTwinSource.setConnectionState('reconnecting', this.lastError);
        // eslint-disable-next-line no-console
        console.warn('[ipsec] connection interrupted:', this.lastError);
        this.emit('status', { connected: false, reason: this.lastError });
      });
      this.connection.on('resume', (_returnCode, sessionPresent) => {
        this.connected = true;
        this.lastError = undefined;
        // A clean session returns without any broker-side subscriptions.
        // Re-register every topic family (not just the Gateway Twin) so IPsec,
        // path control, inventory, AAR, Matter, and Shelly feeds all recover.
        if (!sessionPresent) {
          this.resetGatewayTwinSubscriptions();
          gatewayTwinSource.setConnectionState('connecting');
          void this.refreshSubscriptions();
        } else if (this.gatewayTwinSubscribed) {
          gatewayTwinSource.setConnectionState('connected');
        } else {
          void this.subscribeGatewayTwinTopics();
        }
        // eslint-disable-next-line no-console
        console.log('[ipsec] connection resumed');
        this.emit('status', { connected: true });
      });
      this.connection.on('disconnect', () => {
        this.connected = false;
        this.resetGatewayTwinSubscriptions();
        gatewayTwinSource.setConnectionState('offline');
        // eslint-disable-next-line no-console
        console.log('[ipsec] disconnected');
        this.emit('status', { connected: false });
      });
      this.connection.on('error', (err) => {
        gatewayTwinSource.setConnectionState(
          'error',
          err instanceof Error ? err.message : String(err),
        );
        // eslint-disable-next-line no-console
        console.error('[ipsec] mqtt error:', err);
      });

      await this.connection.connect();
      await this.refreshSubscriptions();
    } catch (err) {
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[ipsec] failed to connect/subscribe:', err);
      this.emit('status', { connected: false, reason: this.lastError });
      if (!this.gatewayTwinSubscribed) {
        gatewayTwinSource.setConnectionState('error', this.lastError);
      }
    }
  }

  /** Queue a complete subscription pass. A resume can arrive while the startup
   *  pass is still unwinding after an interruption; serializing guarantees the
   *  resumed connection gets a fresh pass without duplicate concurrent SUBSCRIBE
   *  requests for the same topic. */
  private refreshSubscriptions(): Promise<void> {
    const refresh = this.subscriptionRefresh.then(
      () => this.subscribeAllTopics(),
      () => this.subscribeAllTopics(),
    );
    this.subscriptionRefresh = refresh;
    return refresh;
  }

  /** Register every callback used by the shared clean-session MQTT connection.
   *  Topic failures are isolated so one rejected SUBACK cannot prevent unrelated
   *  feeds later in the pass from recovering. */
  private async subscribeAllTopics(): Promise<void> {
    if (!this.connection) {
      gatewayTwinSource.setConnectionState('error', 'AWS IoT connection is not initialized');
      return;
    }

    const failures: string[] = [];
    const subscribe = async (
      scope: string,
      topic: string,
      qos: mqtt.QoS,
      onMessage: mqtt.OnMessageCallback,
    ): Promise<void> => {
      try {
        await this.subscribeTopicWithRetry(scope, topic, qos, onMessage);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        failures.push(`${scope}:${topic} (${detail})`);
        console.error(`[${scope}] failed to subscribe to ${topic}:`, err);
      }
    };

    // Each gateway payload carries its own name. The callback tags cached state
    // with the topic family so Plano (`rdk/...`) and McKinney (`prpl/...`) remain
    // independently routable after both startup and reconnect.
    for (const topic of SUBSCRIBE_TOPICS) {
      await subscribe(
        'ipsec',
        topic,
        mqtt.QoS.AtMostOnce,
        (t, payload) => this.handleMessage(t, payload),
      );
    }

    // The Gateway Twin shares this exact connection. It owns decoding, history,
    // and SSE state, but never creates a second MQTT client.
    await this.subscribeGatewayTwinTopics();

    for (const prefix of PATH_PREFIXES) {
      const topic = pathResultTopic(prefix);
      await subscribe(
        'path-control',
        topic,
        mqtt.QoS.AtLeastOnce,
        (t, payload) => this.handlePathResult(t, payload),
      );
    }

    for (const topic of INVENTORY_TOPICS) {
      await subscribe(
        'inventory',
        topic,
        mqtt.QoS.AtLeastOnce,
        (t, payload) => this.handleInventory(t, payload, `${t}:inventory`),
      );
    }

    for (const topic of AAR_TOPICS) {
      await subscribe(
        'aar',
        topic,
        mqtt.QoS.AtMostOnce,
        (t, payload) => this.handleAarMessage(t, payload),
      );
    }

    for (const topic of MATTER_TOPICS) {
      await subscribe(
        'matter-inventory',
        topic,
        mqtt.QoS.AtLeastOnce,
        (t, payload) => this.handleInventory(t, payload, `${topicToSource(t)}:matter`),
      );
    }

    await subscribe(
      'matter-control',
      MATTER_RESULT_TOPIC,
      mqtt.QoS.AtLeastOnce,
      (t, payload) => this.handleMatterResult(t, payload),
    );

    for (const id of SHELLY_DEVICE_IDS) {
      await subscribe(
        'shelly',
        `${id}/events/rpc`,
        mqtt.QoS.AtLeastOnce,
        (_t, payload) => this.handleShellyEvent(id, payload),
      );
      await subscribe(
        'shelly',
        `${id}/online`,
        mqtt.QoS.AtLeastOnce,
        (_t, payload) => this.handleShellyOnline(id, payload),
      );
      await subscribe(
        'shelly',
        `${id}/status`,
        mqtt.QoS.AtLeastOnce,
        (_t, payload) => this.handleShellyStatus(id, payload),
      );
      await subscribe(
        'shelly',
        `${id}/status/switch:0`,
        mqtt.QoS.AtLeastOnce,
        (_t, payload) => this.handleShellyStatus(id, payload),
      );
    }

    if (SHELLY_DEVICE_IDS.length > 0) {
      await subscribe(
        'shelly',
        `${SHELLY_REPLY_SRC}/rpc`,
        mqtt.QoS.AtLeastOnce,
        (t, payload) => this.handleShellyReply(t, payload),
      );

      // NotifyStatus only carries deltas, so pull a complete snapshot on each
      // connection. Keep a single minute poller across any number of resumes.
      for (const id of SHELLY_DEVICE_IDS) this.requestShellyStatus(id);
      if (!this.shellyStatusPoll) {
        this.shellyStatusPoll = setInterval(() => {
          for (const id of SHELLY_DEVICE_IDS) this.requestShellyStatus(id);
        }, 60_000);
      }
    }

    if (failures.length > 0) {
      console.error(`[ipsec] subscription refresh completed with ${failures.length} failure(s): ${failures.join('; ')}`);
    } else {
      console.log('[ipsec] all shared MQTT subscriptions are active');
    }
  }

  /** Subscribe with bounded exponential backoff. The AWS CRT promise normally
   *  rejects for a failed SUBACK, but the explicit error-code check also covers
   *  alternate SDK implementations and mocks. */
  private async subscribeTopicWithRetry(
    scope: string,
    topic: string,
    qos: mqtt.QoS,
    onMessage: mqtt.OnMessageCallback,
  ): Promise<void> {
    let lastError = 'unknown subscription error';

    for (let attempt = 1; attempt <= SUBSCRIBE_MAX_ATTEMPTS; attempt += 1) {
      try {
        if (!this.connection) throw new Error('AWS IoT connection is not initialized');
        const granted = await this.connection.subscribe(topic, qos, onMessage);
        if (granted.error_code) {
          throw new Error(`AWS IoT rejected the SUBACK (error ${granted.error_code})`);
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt === SUBSCRIBE_MAX_ATTEMPTS) break;

        const retryMs = SUBSCRIBE_RETRY_BASE_MS * (2 ** (attempt - 1));
        console.warn(
          `[${scope}] subscribe to ${topic} failed (${lastError}); retrying in ${retryMs}ms `
          + `(${attempt + 1}/${SUBSCRIBE_MAX_ATTEMPTS})`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, retryMs));
      }
    }

    throw new Error(`subscription failed after ${SUBSCRIBE_MAX_ATTEMPTS} attempts: ${lastError}`);
  }

  private resetGatewayTwinSubscriptions(): void {
    this.gatewayTwinSubscriptionGeneration += 1;
    this.gatewayTwinSubscribed = false;
    this.gatewayTwinSubscribedTopics.clear();
    if (this.gatewayTwinRetryTimer) {
      clearTimeout(this.gatewayTwinRetryTimer);
      this.gatewayTwinRetryTimer = undefined;
    }
  }

  /** Keep retrying only the missing Twin topics after a bounded subscription
   *  pass is exhausted. This repairs transient/policy-rollout failures without
   *  waiting for another MQTT disconnect to trigger the next attempt. */
  private scheduleGatewayTwinRetry(): void {
    if (this.gatewayTwinRetryTimer || !this.connected) return;

    this.gatewayTwinRetryTimer = setTimeout(() => {
      this.gatewayTwinRetryTimer = undefined;
      if (!this.connected) return;

      const missingTopics = gatewayTwinSource.getSubscriptionTopics()
        .filter((topic) => !this.gatewayTwinSubscribedTopics.has(topic));
      if (missingTopics.length > 0) {
        void this.subscribeGatewayTwinTopics(missingTopics);
      }
    }, GATEWAY_TWIN_RETRY_MS);
    this.gatewayTwinRetryTimer.unref?.();
  }

  private async subscribeGatewayTwinTopics(topicsToSubscribe?: readonly string[]): Promise<void> {
    if (!this.connection) {
      gatewayTwinSource.setConnectionState('error', 'AWS IoT connection is not initialized');
      return;
    }

    const generation = this.gatewayTwinSubscriptionGeneration;
    const expectedTopics = gatewayTwinSource.getSubscriptionTopics();
    const topics = topicsToSubscribe ?? expectedTopics;
    const failures: string[] = [];

    // Treat every Twin topic independently. A policy or transient failure on
    // one topic must not prevent later telemetry topics from being registered.
    for (const topic of topics) {
      try {
        await this.subscribeTopicWithRetry(
          'gateway-twin',
          topic,
          mqtt.QoS.AtLeastOnce,
          (t, payload, duplicate) => gatewayTwinSource.ingest(t, payload, duplicate),
        );
        if (generation !== this.gatewayTwinSubscriptionGeneration) return;
        this.gatewayTwinSubscribedTopics.add(topic);
      } catch (err) {
        if (generation !== this.gatewayTwinSubscriptionGeneration) return;
        failures.push(`${topic}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (generation !== this.gatewayTwinSubscriptionGeneration) return;
    const missingTopics = expectedTopics
      .filter((topic) => !this.gatewayTwinSubscribedTopics.has(topic));

    if (missingTopics.length === 0) {
      this.gatewayTwinSubscribed = true;
      gatewayTwinSource.setConnectionState('connected');
      if (this.gatewayTwinRetryTimer) {
        clearTimeout(this.gatewayTwinRetryTimer);
        this.gatewayTwinRetryTimer = undefined;
      }
      console.log(`[gateway-twin] subscribed to [${expectedTopics.join(', ')}] on the shared IoT connection`);
    } else {
      this.gatewayTwinSubscribed = false;
      const detail = failures.length > 0
        ? failures.join('; ')
        : `missing SUBACK for ${missingTopics.join(', ')}`;
      gatewayTwinSource.setConnectionState('error', `AWS IoT subscription failed: ${detail}`);
      // Do not fail the IPsec/device subscriptions if only the Twin topic policy
      // is missing; the rest of Connected Enterprise remains operational.
      console.error(
        `[gateway-twin] ${missingTopics.length}/${expectedTopics.length} topic(s) are not subscribed: ${detail}`,
      );
      this.scheduleGatewayTwinRetry();
    }
  }

  private handleMessage(topic: string, payload: ArrayBuffer): void {
    try {
      const bytes = new Uint8Array(payload);

      // Gateways publish raw protobuf bytes on the configured metrics topics,
      // including `prplhome/ipsec/metrics` for the QDR/McKinney feed.
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

      const source = topicToSource(topic);

      // ── Identity ────────────────────────────────────────────────────────
      // proto3 omits empty strings, so `?? 'unknown'` never fires for a field
      // the gateway simply didn't send. Resolve identity against what we
      // already track for this exact topic rather than forking a phantom
      // entry or merging two topics that happen to publish the same identity.
      const inName = String(metrics.gateway?.name ?? '').trim();
      const inMac  = String(metrics.gateway?.mac  ?? '').trim();
      let gatewayKey: string;
      let prev: IpsecGatewayState | undefined;
      if (inName || inMac) {
        gatewayKey = `${topic}:${(inName || inMac).toLowerCase()}`;
        prev = this.gateways.get(gatewayKey);
      } else {
        const latest = [...this.gateways.entries()]
          .filter(([, state]) => state.topic === topic)
          .sort((a, b) => b[1].receivedAt - a[1].receivedAt)[0];
        gatewayKey = latest?.[0] ?? `${topic}:unknown`;
        prev = latest?.[1];
      }
      const prevM = prev?.metrics;

      // ── Merge, don't clobber ────────────────────────────────────────────
      // The gateway publishes every ~10s and not every payload carries every
      // section. An ABSENT section means "not reported this cycle", so we
      // carry the last known value forward instead of writing zeros — that
      // clobbering is what made the Dynamic Failover page flash 0 ms / 0-of-0
      // tunnels between payloads. A section that IS reported always wins,
      // including tunnels present but `reachable: false`, so a genuine
      // outage still surfaces immediately.
      const hasTunnels = Array.isArray(metrics.tunnels) && metrics.tunnels.length > 0;
      const tunnels = hasTunnels
        ? metrics.tunnels.map((t) => ({
            ifname:       String(t.ifname ?? ''),
            present:      Boolean(t.present),
            reachable:    Boolean(t.reachable),
            latency_ms:   Number(t.latency_ms ?? 0),
            loss_percent: Number(t.loss_percent ?? 0),
            rx_bytes:     Number(t.rx_bytes ?? 0),
            tx_bytes:     Number(t.tx_bytes ?? 0),
          }))
        : (prevM?.tunnels ?? []);
      if (!hasTunnels && (prevM?.tunnels.length ?? 0) > 0) {
        // eslint-disable-next-line no-console
        console.log(`[ipsec] ${gatewayKey}: payload carried no tunnels — retaining last known ${prevM!.tunnels.length}`);
      }

      const hasWan = !!(metrics.wan && (metrics.wan.ifname || metrics.wan.rx_bytes || metrics.wan.tx_bytes));
      const wan = hasWan
        ? {
            ifname:     String(metrics.wan?.ifname ?? '') || prevM?.wan.ifname || '',
            link_up:    Boolean(metrics.wan?.link_up),
            rx_bytes:   Number(metrics.wan?.rx_bytes   ?? 0),
            tx_bytes:   Number(metrics.wan?.tx_bytes   ?? 0),
            rx_packets: Number(metrics.wan?.rx_packets ?? 0),
            tx_packets: Number(metrics.wan?.tx_packets ?? 0),
          }
        : (prevM?.wan ?? { ifname: '', link_up: false, rx_bytes: 0, tx_bytes: 0, rx_packets: 0, tx_packets: 0 });

      const normalised: IpsecMetrics = {
        timestamp_ms: Number(metrics.timestamp_ms ?? 0) || prevM?.timestamp_ms || 0,
        // Only trust an empty active_tunnel when this payload actually
        // reported tunnels (then "none active" is the real state).
        active_tunnel: hasTunnels
          ? String(metrics.active_tunnel ?? '')
          : (String(metrics.active_tunnel ?? '') || prevM?.active_tunnel || ''),
        tunnel_count: Number(metrics.tunnel_count ?? 0) || tunnels.length,
        tunnels,
        wan,
        gateway: {
          name:        inName || prevM?.gateway.name || 'unknown',
          mac:         inMac  || prevM?.gateway.mac  || '',
          prim_wan_ip: String(metrics.gateway?.prim_wan_ip ?? '') || prevM?.gateway.prim_wan_ip || '',
          sec_wan_ip:  String(metrics.gateway?.sec_wan_ip  ?? '') || prevM?.gateway.sec_wan_ip  || '',
        },
        wifi: metrics.wifi ? {
          total_clients:        Number(metrics.wifi.total_clients ?? 0),
          active_clients:       Number(metrics.wifi.active_clients ?? 0),
          weak_signal_clients:  Number(metrics.wifi.weak_signal_clients ?? 0),
          clients_with_errors:  Number(metrics.wifi.clients_with_errors ?? 0),
          high_retrans_clients: Number(metrics.wifi.high_retrans_clients ?? 0),
          clients: Array.isArray(metrics.wifi.clients) && metrics.wifi.clients.length > 0
            ? metrics.wifi.clients
            : (prevM?.wifi?.clients ?? []),
        } : prevM?.wifi,
        cellular: metrics.cellular ?? prevM?.cellular,
      };

      const receivedAt = Date.now();
      let wanRate = prev?.wanRate;
      if (hasWan) {
        const rateKey = `${gatewayKey}:${normalised.wan.ifname}`;
        if (!normalised.wan.link_up) {
          this.wanCounterBaselines.delete(rateKey);
          wanRate = undefined;
        } else {
          const update = advanceWanTrafficRate(this.wanCounterBaselines.get(rateKey), {
            key: rateKey,
            sourceTimestampMs: Number(metrics.timestamp_ms ?? 0),
            observedAt: receivedAt,
            rxBytes: normalised.wan.rx_bytes,
            txBytes: normalised.wan.tx_bytes,
          });
          if (update.accepted) {
            if (update.baseline) this.wanCounterBaselines.set(rateKey, update.baseline);
            else this.wanCounterBaselines.delete(rateKey);
          }
          if (update.reset) wanRate = undefined;
          if (update.rate) wanRate = update.rate;
        }
      }

      const state: IpsecGatewayState = {
        metrics: normalised,
        receivedAt,
        source,
        topic,
        wanRate,
      };
      this.gateways.set(gatewayKey, state);
      this.emit('update', { gatewayKey, state });

      // The per-client Wi-Fi block is a live LAN inventory + link telemetry —
      // forward it to deviceSource as a full source so real clients (laptops,
      // the Shelly, …) populate the Devices pages with measured RSSI/health.
      if (IPSEC_DEVICE_TOPICS.has(topic)
        && metrics.wifi
        && Array.isArray(metrics.wifi.clients)) {
        // eslint-disable-next-line no-console
        console.log(metrics.wifi.clients.length > 0
          ? '[wifi] ' + metrics.wifi.clients.map((c) =>
              `${c.hostname || c.mac}: rssi=${c.rssi}dBm snr=${c.snr}dB health=${c.health || 'ok'}`).join(' | ')
          : `[wifi] no clients reported on ${topic}`);
        const now = Date.now();
        this.emit('inventory', {
          // Keep inventories from legacy `prpl` and QDR `prplhome` publishers
          // separate. deviceSource still maps both prefixes to McKinney and
          // de-duplicates clients by MAC, so one feed cannot clobber the other.
          source: `${topic}:wifi`,
          payload: {
            devices: metrics.wifi.clients.map((c) => {
              const key = c.mac.toUpperCase();
              let first = this.wifiFirstSeen.get(key);
              if (first == null) {
                first = now;
                this.wifiFirstSeen.set(key, first);
              }
              return { ...wifiClientToRawDevice(c), connectedForHours: (now - first) / 3_600_000 };
            }),
          },
        });
      }
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

  /** Matter result-topic handler — matches the gateway component's ack
   *  (`{ requestId, success, hubResponse }`) back to its pending command. */
  private handleMatterResult(topic: string, payload: ArrayBuffer): void {
    try {
      const text = new TextDecoder().decode(new Uint8Array(payload));
      const msg = JSON.parse(text) as { requestId?: string; success?: boolean; hubResponse?: unknown };
      // eslint-disable-next-line no-console
      console.log(`[matterctl] result on "${topic}":`, text);
      if (msg.requestId && this.pendingMatterCmds.has(msg.requestId)) {
        const resolve = this.pendingMatterCmds.get(msg.requestId)!;
        this.pendingMatterCmds.delete(msg.requestId);
        resolve({ ok: !!msg.success, requestId: msg.requestId, hubResponse: msg.hubResponse });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[matterctl] failed to parse result on "${topic}":`, err);
    }
  }

  private shellyState(id: string): ShellyState {
    let st = this.shellyStates.get(id);
    if (!st) {
      st = { online: true, firstSeenAt: Date.now() };
      this.shellyStates.set(id, st);
    }
    return st;
  }

  /** Merge a `switch:0` payload (output + live metering) into a device's
   *  state. Notifications are partial, so only present fields are applied —
   *  the rest carry over from the previous message. */
  private applyShellySwitch(st: ShellyState, sw: ShellySwitchPayload | undefined): void {
    if (!sw) return;
    if (typeof sw.output === 'boolean') st.output = sw.output;
    const t = st.telemetry ?? (st.telemetry = {});
    if (typeof sw.apower === 'number') t.apowerW = sw.apower;
    if (typeof sw.voltage === 'number') t.voltageV = sw.voltage;
    if (typeof sw.current === 'number') t.currentA = sw.current;
    if (typeof sw.aenergy?.total === 'number') t.energyWhTotal = sw.aenergy.total;
    if (typeof sw.temperature?.tC === 'number') t.tempC = sw.temperature.tC;
  }

  /** Forward the current Shelly fleet to deviceSource as a partial (OT-only)
   *  inventory, same contract as the Matter list. */
  private emitShellyInventory(): void {
    const now = Date.now();
    const devices = [...this.shellyStates.entries()].map(([id, st]) => ({
      id,
      mac: shellyMac(id),
      name: id,
      kind: 'shelly',
      services: ['_shelly._tcp'],
      conn: 'wifi',
      online: st.online,
      power: st.output,
      telemetry: st.telemetry,
      connectedForHours: st.uptimeSec != null
        ? st.uptimeSec / 3600
        : (now - st.firstSeenAt) / 3_600_000,
    }));
    this.emit('inventory', { source: 'rdk:shelly', payload: { partial: true, devices } });
  }

  /** Retained `<id>/online` flag — payload is the string "true"/"false". */
  private handleShellyOnline(id: string, payload: ArrayBuffer): void {
    const text = new TextDecoder().decode(new Uint8Array(payload)).trim();
    this.shellyState(id).online = text !== 'false';
    this.emitShellyInventory();
  }

  /** `<id>/events/rpc` NotifyStatus — track relay state + live metering
   *  (apower / current / voltage / energy) as the device reports them. */
  private handleShellyEvent(id: string, payload: ArrayBuffer): void {
    try {
      const text = new TextDecoder().decode(new Uint8Array(payload));
      const msg = JSON.parse(text) as { params?: Record<string, unknown> };
      const st = this.shellyState(id);
      st.online = true;
      this.applyShellySwitch(st, msg.params?.['switch:0'] as ShellySwitchPayload | undefined);
      this.emitShellyInventory();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[shelly] failed to parse event from "${id}":`, err);
    }
  }

  /** Poll a device's full status via RPC: Shelly.GetStatus to `<id>/rpc`; the
   *  reply (correlated by rpc id) is folded into state by handleShellyReply.
   *  Requires "RPC over MQTT" to be enabled in the device's MQTT settings. */
  private requestShellyStatus(deviceId: string): void {
    if (!this.connection || !this.connected) return;
    const id = this.shellyCmdSeq++;
    this.pendingStatusReqs.set(id, deviceId);
    setTimeout(() => this.pendingStatusReqs.delete(id), 15_000);
    const rpc = { id, src: SHELLY_REPLY_SRC, method: 'Shelly.GetStatus' };
    this.connection.publish(`${deviceId}/rpc`, JSON.stringify(rpc), mqtt.QoS.AtLeastOnce)
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[shelly] status poll publish failed for "${deviceId}":`, err);
      });
  }

  /** Full status dump on `<id>/status` (response to a `status_update` command,
   *  or pushed by firmwares with generic status updates enabled). */
  private handleShellyStatus(id: string, payload: ArrayBuffer): void {
    try {
      const text = new TextDecoder().decode(new Uint8Array(payload));
      const msg = JSON.parse(text) as Record<string, unknown>;
      const st = this.shellyState(id);
      st.online = true;
      // Full dump nests the relay under "switch:0"; the per-component topic
      // delivers the switch object itself.
      const sw = (msg['switch:0'] ?? (typeof msg.output === 'boolean' ? msg : undefined)) as
        ShellySwitchPayload | undefined;
      this.applyShellySwitch(st, sw);
      const sys = msg.sys as { uptime?: number } | undefined;
      if (sys && typeof sys.uptime === 'number') st.uptimeSec = sys.uptime;
      // eslint-disable-next-line no-console
      console.log(`[shelly] ${id} status: output=${st.output} apower=${st.telemetry?.apowerW}W voltage=${st.telemetry?.voltageV}V uptime=${st.uptimeSec}s`);
      this.emitShellyInventory();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[shelly] failed to parse status from "${id}":`, err);
    }
  }

  /** RPC reply on `<SHELLY_REPLY_SRC>/rpc` — correlated by numeric rpc id. */
  private handleShellyReply(topic: string, payload: ArrayBuffer): void {
    try {
      const text = new TextDecoder().decode(new Uint8Array(payload));
      const msg = JSON.parse(text) as {
        id?: number;
        result?: unknown;
        error?: { code?: number; message?: string };
      };

      // A full-status poll reply — fold the snapshot into the device state.
      if (typeof msg.id === 'number' && this.pendingStatusReqs.has(msg.id)) {
        const devId = this.pendingStatusReqs.get(msg.id)!;
        this.pendingStatusReqs.delete(msg.id);
        const status = msg.result as Record<string, unknown> | undefined;
        if (status) {
          const st = this.shellyState(devId);
          st.online = true;
          this.applyShellySwitch(st, status['switch:0'] as ShellySwitchPayload | undefined);
          const sys = status.sys as { uptime?: number } | undefined;
          if (sys && typeof sys.uptime === 'number') st.uptimeSec = sys.uptime;
          // eslint-disable-next-line no-console
          console.log(`[shelly] ${devId} status: output=${st.output} apower=${st.telemetry?.apowerW}W uptime=${st.uptimeSec}s`);
          this.emitShellyInventory();
        }
        return;
      }
      // eslint-disable-next-line no-console
      console.log(`[shelly] reply on "${topic}":`, text);
      if (typeof msg.id === 'number' && this.pendingShellyCmds.has(msg.id)) {
        const resolve = this.pendingShellyCmds.get(msg.id)!;
        this.pendingShellyCmds.delete(msg.id);
        if (msg.error) {
          resolve({ ok: false, requestId: msg.id, error: msg.error.message ?? `rpc error ${msg.error.code}`, response: msg.error });
        } else {
          resolve({ ok: true, requestId: msg.id, response: msg.result });
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[shelly] failed to parse reply on "${topic}":`, err);
    }
  }

  /** Inventory-topic handler — decodes the JSON device list and forwards it.
   *  Parsing/classification is deviceSource's job; we just deliver the payload
   *  tagged with the gateway source. */
  private handleInventory(topic: string, payload: ArrayBuffer, sourceTag?: string): void {
    try {
      const text = new TextDecoder().decode(new Uint8Array(payload));
      const parsed = JSON.parse(text) as unknown;
      this.emit('inventory', { source: sourceTag ?? topicToSource(topic), payload: parsed });
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
    void tunnel;
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

  /** Relay a binary app-route steering command (proto3 AppRouteCommand, see
   *  proto/app_route.proto) to `<prefix>/approute/control`. Fire-and-forget:
   *  no gateway component acks this topic yet, so resolving means "handed to
   *  the broker", not "applied on the gateway". */
  async publishAppRoute(prefix: string, payload: Uint8Array): Promise<{ ok: boolean; error?: string }> {
    if (!this.connection || !this.connected) {
      return { ok: false, error: 'MQTT not connected — cannot reach the gateway' };
    }
    const topic = `${prefix}/approute/control`;
    try {
      await this.connection.publish(topic, payload, mqtt.QoS.AtLeastOnce);
      // eslint-disable-next-line no-console
      console.log(`[approute] published ${payload.byteLength} bytes to "${topic}"`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Poke the gateway to re-fetch and republish the Matter device list. The
   * fresh list arrives on the existing `rdk/matter/devices/list` subscription
   * (→ deviceSource → SSE), so this is fire-and-forget. Returns false if MQTT
   * isn't connected.
   */
  async requestMatterRefresh(): Promise<boolean> {
    if (!this.connection || !this.connected) return false;
    try {
      await this.connection.publish(
        MATTER_REFRESH_TOPIC,
        JSON.stringify({ ts: Date.now() }),
        mqtt.QoS.AtLeastOnce,
      );
      // eslint-disable-next-line no-console
      console.log(`[matterctl] published refresh poke to "${MATTER_REFRESH_TOPIC}"`);
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[matterctl] failed to publish refresh poke:', err);
      return false;
    }
  }

  /**
   * Send a Matter OnOff command by publishing to the control topic and
   * waiting for the gateway component's ack on the result topic (correlated
   * by requestId). Everything except `requestId` passes through to the hub
   * CGI verbatim. Hub grammar: clusterId 6 = OnOff, commandId 0 = Off,
   * 1 = On.
   */
  async sendMatterCommand(
    nodeId: number,
    action: 'On' | 'Off',
    endpointId = 1,
    timeoutMs = 20_000,
  ): Promise<MatterCommandResult> {
    if (!this.connection || !this.connected) {
      return { ok: false, error: 'MQTT not connected — cannot reach the gateway' };
    }
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const ackPromise = new Promise<MatterCommandResult>((resolve) => {
      this.pendingMatterCmds.set(requestId, resolve);
      setTimeout(() => {
        if (this.pendingMatterCmds.has(requestId)) {
          this.pendingMatterCmds.delete(requestId);
          resolve({ ok: false, timedOut: true, requestId, error: 'No ack from gateway within timeout' });
        }
      }, timeoutMs);
    });

    const command = {
      requestId,
      queryCmd: MATTER_QUERY_CMD,
      cmd: 'CONTROL_DEVICE',
      nodeId,
      clusterId: 6,
      commandId: action === 'On' ? 1 : 0,
      endpointId,
    };

    try {
      await this.connection.publish(
        MATTER_CONTROL_TOPIC,
        JSON.stringify(command),
        mqtt.QoS.AtLeastOnce,
      );
      // eslint-disable-next-line no-console
      console.log(`[matterctl] published ${JSON.stringify(command)} to "${MATTER_CONTROL_TOPIC}"`);
    } catch (err) {
      this.pendingMatterCmds.delete(requestId);
      return { ok: false, requestId, error: err instanceof Error ? err.message : String(err) };
    }

    return ackPromise;
  }

  /**
   * Drive a Shelly relay over RPC-over-MQTT: publish Switch.Set to
   * `<deviceId>/rpc` and await the device's reply on `<SHELLY_REPLY_SRC>/rpc`
   * (correlated by the numeric rpc id). Requires "RPC over MQTT" enabled in
   * the device's MQTT settings — a timeout here means it isn't.
   */
  async sendShellyCommand(
    deviceId: string,
    action: 'On' | 'Off',
    timeoutMs = 10_000,
  ): Promise<ShellyCommandResult> {
    if (!this.connection || !this.connected) {
      return { ok: false, error: 'MQTT not connected — cannot reach the device' };
    }
    const requestId = this.shellyCmdSeq++;

    const ackPromise = new Promise<ShellyCommandResult>((resolve) => {
      this.pendingShellyCmds.set(requestId, resolve);
      setTimeout(() => {
        if (this.pendingShellyCmds.has(requestId)) {
          this.pendingShellyCmds.delete(requestId);
          resolve({
            ok: false,
            timedOut: true,
            requestId,
            error: 'No RPC reply from the device — is "RPC over MQTT" enabled in its MQTT settings?',
          });
        }
      }, timeoutMs);
    });

    const rpc = { id: requestId, src: SHELLY_REPLY_SRC, method: 'Switch.Set', params: { id: 0, on: action === 'On' } };

    try {
      await this.connection.publish(`${deviceId}/rpc`, JSON.stringify(rpc), mqtt.QoS.AtLeastOnce);
      // eslint-disable-next-line no-console
      console.log(`[shelly] published ${JSON.stringify(rpc)} to "${deviceId}/rpc"`);
    } catch (err) {
      this.pendingShellyCmds.delete(requestId);
      return { ok: false, requestId, error: err instanceof Error ? err.message : String(err) };
    }

    const res = await ackPromise;
    if (res.ok) {
      this.shellyState(deviceId).output = action === 'On';
      this.emitShellyInventory();
      // Pull fresh metering shortly after the relay settles.
      setTimeout(() => this.requestShellyStatus(deviceId), 1500);
    }
    return res;
  }

  /** Decode one `routing/<kind>` message and fold it into the AAR state. The
   *  gateway publishes binary proto3; a JSON payload is accepted as a fallback
   *  (mirrors handleMessage) in case an upstream rule pre-decodes it. */
  private handleAarMessage(topic: string, payload: ArrayBuffer): void {
    const kind = topic.split('/').pop() ?? '';
    try {
      const bytes = new Uint8Array(payload);
      const looksLikeJson = bytes.length > 0 && (bytes[0] === 0x7b || bytes[0] === 0x5b);
      const now = Date.now();

      if (kind === 'flow') {
        const f: AarFlow = looksLikeJson ? JSON.parse(new TextDecoder().decode(bytes)) : decodeFlow(bytes);
        this.aarFlows.unshift({ ...f, updatedAt: now });
        if (this.aarFlows.length > 100) this.aarFlows.length = 100;
      } else if (kind === 'tunnel') {
        const t: AarTunnel = looksLikeJson ? JSON.parse(new TextDecoder().decode(bytes)) : decodeTunnel(bytes);
        this.aarTunnels.set(t.iface, { ...t, updatedAt: now });
      } else if (kind === 'route') {
        const r: AarRoute = looksLikeJson ? JSON.parse(new TextDecoder().decode(bytes)) : decodeRoute(bytes);
        this.aarRoutes.set(r.dst_ip, { ...r, updatedAt: now });
        if (this.aarRoutes.size > 200) this.aarRoutes.delete(this.aarRoutes.keys().next().value as string);
      } else if (kind === 'decision') {
        const d: AarDecision = looksLikeJson ? JSON.parse(new TextDecoder().decode(bytes)) : decodeDecision(bytes);
        this.aarDecisions.set(d.src_ip, { ...d, updatedAt: now });
      } else {
        return;
      }

      this.aarLastAt = now;
      this.emit('aar', this.buildAarSnapshot());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[aar] failed to decode "${topic}":`, err);
    }
  }

  private buildAarSnapshot(): AarSnapshot {
    return {
      tunnels: [...this.aarTunnels.values()].sort((a, b) => a.iface.localeCompare(b.iface)),
      decisions: [...this.aarDecisions.values()].sort((a, b) => a.src_ip.localeCompare(b.src_ip)),
      routes: [...this.aarRoutes.values()],
      flows: this.aarFlows.slice(0, 50),
      connected: this.connected,
      receivedAt: this.aarLastAt,
    };
  }

  getAarSnapshot(): AarSnapshot {
    return this.buildAarSnapshot();
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

  onAar(listener: IpsecSourceEvents['aar']): () => void {
    this.on('aar', listener);
    return () => this.off('aar', listener);
  }
}

export const ipsecSource = new IpsecSource();
