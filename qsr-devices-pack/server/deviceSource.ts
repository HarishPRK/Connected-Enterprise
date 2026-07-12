/**
 * Device inventory source.
 *
 * Serves the Devices page entirely off the API + SSE. Two data sources, in
 * priority order:
 *   1. LIVE — the gateway's `com.rdk.devicediscovery` component publishes a JSON
 *      inventory on `<prefix>/devices/inventory`; ipsecSource forwards it here
 *      via its `inventory` event. Once ANY inventory has been received, the live
 *      list is authoritative (it also reflects departures/offline state).
 *      The Plano gateway's `com.rdk.matter.devicelist` component additionally
 *      publishes the Matter hub's device list on `rdk/matter/devices/list`
 *      (source tag `rdk:matter`) — a PARTIAL inventory covering only the OT
 *      side; the seed's IT devices stay until a full inventory arrives.
 *   2. SEED — until the first live inventory arrives (e.g. dev with no gateway),
 *      a static seed list keeps the page populated.
 *
 * On top of whichever list is active, an operator can re-classify any device
 * IT <-> OT. Overrides are keyed by MAC, persisted to disk, and survive both
 * restarts AND the seed→live switch (same device, same MAC). Re-classifying a
 * device to its own auto-detected domain clears the override.
 *
 * Public interface (stable across Phase 0/1):
 *   • `getSnapshot()`        — synchronous read of the current inventory
 *   • `onUpdate(listener)`   — subscribe to live updates (Express SSE uses this)
 *   • `classify(mac, domain)`— set/clear an operator override, persist + emit
 */

import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Device, DeviceTelemetry, Status } from './types.js';
import { ipsecSource } from './ipsecSource.js';
import { currentRates, recordTelemetry } from './telemetryHistory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Domain = 'IT' | 'OT';
type Kind = Device['kind'];

/** A device plus the provenance the UI needs to show an override badge and to
 *  offer "move back to auto". `domain` is the EFFECTIVE domain (override or
 *  auto); `autoDomain` is what discovery/seed inferred before any override. */
export interface DeviceView extends Device {
  autoDomain: Domain;
  overridden: boolean;
  /** Which gateway location this device was discovered from ('rdk' for Plano,
   *  'prpl' for McKinney). Undefined for seed devices (pre-live-discovery). */
  locationSource?: 'rdk' | 'prpl';
}

export interface DeviceSnapshot {
  devices: DeviceView[];
  receivedAt: number;
  /** 'seed' until the first live inventory arrives, then 'gateway'. */
  source: 'seed' | 'gateway';
  /** For 'gateway': the live IoT link state. For 'seed': always true. */
  connected: boolean;
  /** When the last live inventory was ingested (undefined while on seed). */
  lastInventoryAt?: number;
  /** Current operator overrides, keyed by normalized MAC. */
  overrides: Record<string, Domain>;
}

interface DeviceSourceEvents {
  update: (snapshot: DeviceSnapshot) => void;
}

/**
 * Wire contract for `<prefix>/devices/inventory`. The future
 * `com.rdk.devicediscovery` component produces this; everything except `mac`
 * is optional, and the cloud fills gaps via auto-classification.
 */
interface RawDevice {
  mac: string;
  ip?: string;
  hostname?: string;
  name?: string;
  vendor?: string;            // OUI vendor string, if the gateway resolves it
  conn?: 'wifi' | 'wired' | 'poe' | 'thread';
  online?: boolean;           // reachable right now (default true)
  connectedForHours?: number;
  services?: string[];        // mDNS/SSDP hints, e.g. ['_matter._tcp']
  kind?: string;              // optional device-kind hint
  domain?: Domain;            // optional gateway classification hint
  id?: string;
  power?: boolean;            // relay/switch state for controllable kinds
  telemetry?: DeviceTelemetry; // live electrical readings from the device
  statusHint?: Status;        // explicit status (e.g. from the gateway's wifi health)
}
interface InventoryPayload {
  gateway?: string;
  ts?: number;
  devices: RawDevice[];
  /** True when this list covers only part of the LAN (e.g. the Shelly fleet) —
   *  the seed's IT side is kept while every live source is partial. */
  partial?: boolean;
}

/** One entry of the Matter hub CGI's GET_DEVICES_LIST reply, published
 *  verbatim by `com.rdk.matter.devicelist` on `<prefix>/matter/devices/list`. */
interface MatterHubDevice {
  deviceName?: string;
  nodeId?: number | string;
  radioType?: number;
  onboardingTime?: number;   // epoch seconds
  endPoints?: unknown[];
}

/**
 * Deterministic locally-administered MAC for a Matter node (0x0E = local
 * unicast, 4D = "M"). The hub reports nodeIds, not MACs, and the whole
 * override/dedup machinery is MAC-keyed — a stable synthetic MAC lets Matter
 * devices flow through it unchanged. Matter nodeIds are u64, so the four id
 * octets come from an FNV-1a hash of the full decimal string rather than a
 * truncation (which would collide ids sharing low bits).
 */
function matterMac(nodeId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < nodeId.length; i++) {
    h ^= nodeId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hex = h.toString(16).padStart(8, '0').toUpperCase();
  return `0E:4D:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}`;
}

/** OnOff state from the hub's endpoint/cluster dump, when present. */
function matterPower(entry: MatterHubDevice): boolean | undefined {
  if (!Array.isArray(entry.endPoints)) return undefined;
  for (const ep of entry.endPoints as { clusters?: { onOff?: { onOff?: unknown } }[] }[]) {
    for (const cl of ep?.clusters ?? []) {
      const v = cl?.onOff?.onOff;
      if (typeof v === 'string') return v.toUpperCase() === 'ON';
    }
  }
  return undefined;
}

/**
 * Optional nodeId → real-MAC aliases (`IOT_MATTER_MAC_ALIASES="32768=F0:09:0D:8C:B5:7C,..."`).
 * A Matter device that is also a Wi-Fi client appears in BOTH feeds under
 * different identities — the hub reports a nodeId, the gateway reports the
 * MAC — so there's no shared key to merge on. Aliasing the nodeId to the real
 * MAC collapses the two rows into one device carrying the Matter control id
 * AND the Wi-Fi telemetry. Default covers the Tapo P125M plug (node 32768).
 */
const MATTER_MAC_ALIASES: Record<string, string> = Object.fromEntries(
  (process.env.IOT_MATTER_MAC_ALIASES ?? '32768=F0:09:0D:8C:B5:7C')
    .split(',')
    .map((pair) => pair.split('=').map((x) => x.trim()))
    .filter((kv): kv is [string, string] => kv.length === 2 && !!kv[0] && !!kv[1])
    .map(([nodeId, mac]) => [nodeId, mac.toUpperCase()]),
);
/** Reverse view: real MAC → Matter nodeId. Lets a device discovered only via
 *  the Wi-Fi feed (e.g. the Tapo P125M) carry its Matter control identity —
 *  and therefore the power button — even when the hub list isn't flowing. */
const MAC_TO_NODEID: Record<string, string> = Object.fromEntries(
  Object.entries(MATTER_MAC_ALIASES).map(([nodeId, mac]) => [mac, nodeId]),
);

/**
 * Recognize a Matter hub device list (`{ result, mc_response: { Devices } }`,
 * with `mc_response` sometimes double-encoded as a JSON string) and convert it
 * to the inventory contract. Returns null when the payload isn't a Matter list.
 */
function fromMatterList(payload: unknown): InventoryPayload | null {
  if (payload == null || typeof payload !== 'object') return null;
  let mc = (payload as { mc_response?: unknown }).mc_response;
  if (typeof mc === 'string') {
    try { mc = JSON.parse(mc); } catch { return null; }
  }
  const list = (mc as { Devices?: unknown } | undefined)?.Devices;
  if (!Array.isArray(list)) return null;
  const nowSec = Date.now() / 1000;
  const devices: RawDevice[] = [];
  for (const entry of list as MatterHubDevice[]) {
    // Accept only a positive-integer nodeId (number or decimal string) —
    // Number() coercion would turn null/''/[] into a phantom node 0.
    const raw = entry?.nodeId;
    const nodeId =
      typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? String(raw)
      : typeof raw === 'string' && /^[0-9]+$/.test(raw) && !/^0+$/.test(raw) ? raw
      : null;
    if (!nodeId) continue;
    const onboarded = Number(entry.onboardingTime);
    devices.push({
      id: `matter-${nodeId}`,
      mac: MATTER_MAC_ALIASES[nodeId] ?? matterMac(nodeId),
      name: entry.deviceName || `matter-${nodeId}`,
      kind: 'matter',
      services: ['_matter._tcp'],
      // The hub reports the device's radio: Thread devices (e.g. Onvis sensors)
      // come in as radioType 2, Wi-Fi devices (e.g. the Tapo plug) as 1.
      conn: entry.radioType === 2 ? 'thread' : 'wifi',
      online: true,
      power: matterPower(entry),
      connectedForHours: Number.isFinite(onboarded) && onboarded > 0
        ? Math.max(0, (nowSec - onboarded) / 3600)
        : 0,
    });
  }
  return { devices };
}

/** Where operator overrides are persisted. Kept out of git (see .gitignore).
 *  Override with DEVICE_OVERRIDES_PATH for container/EC2 deploys. */
const OVERRIDES_PATH =
  process.env.DEVICE_OVERRIDES_PATH ??
  path.join(__dirname, '.data', 'device-overrides.json');

const normalizeMac = (mac: string) => mac.trim().toUpperCase();

/**
 * Friendly display names for known devices, keyed by normalized MAC. The
 * McKinney (prpl) Shelly appliances are discovered via the gateway's Wi-Fi feed
 * carrying only their raw hostname (e.g. `shellyplus1pm-c049ef8ce640`); a
 * Shelly's id suffix IS its MAC (c049ef8ce640 → C0:49:EF:8C:E6:40), so we map
 * that MAC to the human name. The names live in the smart-home DynamoDB
 * `Devices` table (a separate backend the dashboard doesn't read), mirrored
 * here. Extend/override WITHOUT a code change via
 * IOT_DEVICE_NAMES="AA:BB:..=Name,CC:DD:..=Name".
 */
const DEVICE_NAME_ALIASES: Record<string, string> = Object.fromEntries(
  (process.env.IOT_DEVICE_NAMES ??
    [
      'C0:49:EF:8C:E6:40=Grinder',
      'C0:49:EF:8C:B0:F4=Air Fryer',
      'C0:49:EF:8C:B7:5C=Mixer',
      '90:38:0C:34:CD:74=Instant Pot',
      'C0:49:EF:8C:93:24=Coffee Brewer',
      '90:38:0C:36:95:A8=Exhaust',
      'C0:49:EF:8C:E5:C4=Kettle',
    ].join(','))
    .split(',')
    .map((pair) => pair.split('=').map((x) => x.trim()))
    .filter((kv): kv is [string, string] => kv.length === 2 && !!kv[0] && !!kv[1])
    .map(([mac, name]) => [normalizeMac(mac), name]),
);

const KNOWN_KINDS = new Set<Kind>([
  'laptop', 'desktop', 'printer', 'payment', 'server', 'confphone',
  'fire_sensor', 'smoke_sensor', 'door_lock',
  'phone', 'tablet', 'matter', 'shelly', 'generic',
]);

/**
 * Seed inventory — a server-side mirror of `src/data/mock.ts`'s `devices`,
 * used only until the first live inventory arrives. Each device's `domain` here
 * is its AUTO domain; operator overrides are layered on at read time.
 */
const SEED: Device[] = [
  // IT
  { id: 'd1', name: 'Lap-John', kind: 'laptop', domain: 'IT', ip: '10.10.1.12', mac: 'AA:11:22:33:44:55', status: 'ok', connectedForHours: 32, conn: 'wifi' },
  { id: 'd2', name: 'Lap-Priya', kind: 'laptop', domain: 'IT', ip: '10.10.1.13', mac: 'AA:11:22:33:44:56', status: 'ok', connectedForHours: 4, conn: 'wifi' },
  { id: 'd3', name: 'Desk-Recep', kind: 'desktop', domain: 'IT', ip: '10.10.1.20', mac: 'AA:11:22:33:44:57', status: 'ok', connectedForHours: 214, conn: 'wired' },
  { id: 'd4', name: 'HP-Printer', kind: 'printer', domain: 'IT', ip: '10.10.1.30', mac: 'AA:11:22:33:44:58', status: 'ok', connectedForHours: 680, conn: 'wired' },
  { id: 'd5', name: 'POS-01', kind: 'payment', domain: 'IT', ip: '10.10.1.41', mac: 'AA:11:22:33:44:59', status: 'ok', connectedForHours: 112, conn: 'wifi' },
  { id: 'd6', name: 'POS-02', kind: 'payment', domain: 'IT', ip: '10.10.1.42', mac: 'AA:11:22:33:44:5A', status: 'warn', connectedForHours: 1, conn: 'wifi' },
  { id: 'd7', name: 'Srv-Local', kind: 'server', domain: 'IT', ip: '10.10.1.50', mac: 'AA:11:22:33:44:5B', status: 'ok', connectedForHours: 1022, conn: 'wired' },
  { id: 'd8', name: 'Conf-Phone-1', kind: 'confphone', domain: 'IT', ip: '10.10.1.60', mac: 'AA:11:22:33:44:5C', status: 'ok', connectedForHours: 440, conn: 'poe' },
  // OT
  { id: 'o1', name: 'Fire-01', kind: 'fire_sensor', domain: 'OT', ip: '10.20.1.11', mac: 'BB:11:22:33:44:01', status: 'ok', connectedForHours: 2100, conn: 'wifi' },
  { id: 'o2', name: 'Fire-02', kind: 'fire_sensor', domain: 'OT', ip: '10.20.1.12', mac: 'BB:11:22:33:44:02', status: 'ok', connectedForHours: 2100, conn: 'wifi' },
  { id: 'o3', name: 'Smoke-01', kind: 'smoke_sensor', domain: 'OT', ip: '10.20.1.21', mac: 'BB:11:22:33:44:03', status: 'ok', connectedForHours: 2100, conn: 'wifi' },
  { id: 'o4', name: 'Smoke-02', kind: 'smoke_sensor', domain: 'OT', ip: '10.20.1.22', mac: 'BB:11:22:33:44:04', status: 'ok', connectedForHours: 2100, conn: 'wifi' },
  { id: 'o5', name: 'DL-1-MainGate', kind: 'door_lock', domain: 'OT', ip: '10.20.1.31', mac: 'BB:11:22:33:44:05', status: 'ok', connectedForHours: 1500, conn: 'wifi' },
  { id: 'o6', name: 'DL-2-Server', kind: 'door_lock', domain: 'OT', ip: '10.20.1.32', mac: 'BB:11:22:33:44:06', status: 'err', connectedForHours: 0, conn: 'wifi' },
  { id: 'o7', name: 'DL-3-Backdoor', kind: 'door_lock', domain: 'OT', ip: '10.20.1.33', mac: 'BB:11:22:33:44:07', status: 'ok', connectedForHours: 1500, conn: 'wifi' },
];

/** Lowercased haystack of every identifying string on a raw device, for the
 *  keyword heuristics below. */
function haystack(r: RawDevice): string {
  return [r.hostname, r.name, r.vendor, r.kind, ...(r.services ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Best-effort device kind from the gateway's hints. Honours an explicit,
 *  known `kind`; otherwise matches keywords; falls back to 'generic'. */
function inferKind(r: RawDevice): Kind {
  if (r.kind && KNOWN_KINDS.has(r.kind as Kind)) return r.kind as Kind;
  const h = haystack(r);
  if (/matter|_matter|_matterc|thread/.test(h)) return 'matter';
  if (/shelly|shellies|tasmota/.test(h)) return 'shelly';
  // Tablet before phone: "Galaxy Tab" is a tablet, but 'galaxy' also matches the
  // phone heuristic — the more specific "tab"/"ipad" signal should win.
  if (/ipad|tablet|\btab\b/.test(h)) return 'tablet';
  if (/iphone|android|pixel|galaxy|oneplus|\bphone\b/.test(h)) return 'phone';
  if (/macbook|laptop|thinkpad|latitude|notebook|elitebook/.test(h)) return 'laptop';
  if (/imac|desktop|workstation|optiplex/.test(h)) return 'desktop';
  if (/printer|laserjet|officejet|epson|canon/.test(h)) return 'printer';
  if (/door[\s_-]?lock|deadbolt|smartlock/.test(h)) return 'door_lock';
  if (/smoke/.test(h)) return 'smoke_sensor';
  if (/fire/.test(h)) return 'fire_sensor';
  return 'generic';
}

const OT_HINTS = /matter|_matter|shelly|tasmota|_hap|homekit|_coap|zigbee|zwave|z-wave|espressif|sensor|\block\b|deadbolt|camera|thermostat|\bplc\b|modbus|bacnet|sprinkler|hvac/;

/** Auto IT/OT classification. Honours an explicit gateway `domain` hint; else
 *  flags OT when the device looks like operational tech (Matter/Shelly/sensors/
 *  locks/cameras/industrial), otherwise IT. */
function classifyDomain(r: RawDevice, kind: Kind): Domain {
  if (r.domain === 'IT' || r.domain === 'OT') return r.domain;
  const otKinds: Kind[] = ['matter', 'shelly', 'fire_sensor', 'smoke_sensor', 'door_lock'];
  if (otKinds.includes(kind)) return 'OT';
  return OT_HINTS.test(haystack(r)) ? 'OT' : 'IT';
}

const isWifiId = (id?: string) => (id ?? '').startsWith('wifi-');
const realIp = (ip?: string) => (ip && ip !== '—' ? ip : undefined);
const nonZero = (n?: number) => (typeof n === 'number' && n > 0 ? n : undefined);
const SPECIFIC_KINDS = new Set<string>([
  'matter', 'shelly', 'fire_sensor', 'smoke_sensor', 'door_lock',
  'laptop', 'desktop', 'printer', 'payment', 'server', 'confphone', 'phone', 'tablet',
]);
const specificKind = (k?: string) => (k && SPECIFIC_KINDS.has(k) ? k : undefined);
const STATUS_RANK: Record<Status, number> = { ok: 0, off: 0, warn: 1, err: 2 };
function worseStatus(a?: Status, b?: Status): Status | undefined {
  if (!a) return b;
  if (!b) return a;
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/** A seed device as a raw record, so it merges/maps through the same path. */
function seedToRaw(d: Device): RawDevice {
  return {
    id: d.id, mac: d.mac, name: d.name, kind: d.kind, domain: d.domain,
    ip: d.ip, conn: d.conn, connectedForHours: d.connectedForHours,
    online: d.status !== 'err', statusHint: d.status,
  };
}

/**
 * Merge two raw records for the same MAC seen across sources — e.g. the Shelly
 * reported both via its MQTT power telemetry and the gateway's Wi-Fi block.
 * The non-Wi-Fi source is "primary" (it carries the control id, power state and
 * specific kind); the Wi-Fi source contributes link telemetry. Telemetry from
 * both is unioned, so a device ends up with power AND signal readings.
 */
function mergeRaw(a: RawDevice, b: RawDevice): RawDevice {
  const [p, s] = isWifiId(a.id) && !isWifiId(b.id) ? [b, a] : [a, b];
  return {
    mac: p.mac,
    id: p.id ?? s.id,
    name: p.name ?? s.name,
    hostname: p.hostname ?? s.hostname,
    ip: realIp(p.ip) ?? realIp(s.ip),
    vendor: p.vendor ?? s.vendor,
    conn: p.conn ?? s.conn,
    kind: specificKind(p.kind) ?? specificKind(s.kind) ?? p.kind ?? s.kind,
    domain: p.domain ?? s.domain,
    online: (p.online !== false) || (s.online !== false),
    statusHint: worseStatus(p.statusHint, s.statusHint),
    // Take the larger duration: a source that just (re)emitted reports a tiny
    // session age, while the other may carry real uptime / a longer timer.
    connectedForHours: nonZero(Math.max(p.connectedForHours ?? 0, s.connectedForHours ?? 0)),
    services: [...(p.services ?? []), ...(s.services ?? [])],
    power: typeof p.power === 'boolean' ? p.power : s.power,
    telemetry: { ...(s.telemetry ?? {}), ...(p.telemetry ?? {}) },
  };
}

/** Map a raw gateway device → the app's Device shape + its auto domain. */
function toDevice(r: RawDevice): { device: Device; autoDomain: Domain } {
  const mac = normalizeMac(r.mac);
  // A MAC with a known Matter nodeId IS a Matter device (e.g. the Tapo plug
  // seen only through the Wi-Fi feed) — give it the controllable identity.
  const aliasNodeId = MAC_TO_NODEID[mac];
  const kind = aliasNodeId ? 'matter' : inferKind(r);
  // A Shelly discovered only via the Wi-Fi feed: its hostname IS its MQTT
  // device id, so use it as the row id to keep the relay controllable.
  const wifiShellyId = kind === 'shelly' && (!r.id || isWifiId(r.id)) && /^shelly/i.test(r.hostname ?? '')
    ? r.hostname
    : undefined;
  const autoDomain = classifyDomain(r, kind);
  const device: Device = {
    id: aliasNodeId ? `matter-${aliasNodeId}` : (wifiShellyId ?? r.id ?? `gw-${mac}`),
    // A friendly-name alias (keyed by MAC) wins over the gateway's raw hostname.
    name: DEVICE_NAME_ALIASES[mac] ?? r.name ?? r.hostname ?? r.vendor ?? mac,
    kind,
    domain: autoDomain, // effective override is applied later
    ip: r.ip ?? '—',
    mac,
    status: r.online === false ? 'err' : (r.statusHint ?? 'ok'),
    // Keep fractional hours — the UI renders sub-hour precision (m/s).
    connectedForHours: Math.max(0, r.connectedForHours ?? 0),
    conn: r.conn ?? 'wifi',
    power: typeof r.power === 'boolean' ? r.power : undefined,
    telemetry: (() => {
      // Attach the live throughput computed from the device's byte counters.
      const rates = currentRates(mac);
      if (r.telemetry) return { ...r.telemetry, ...rates };
      return rates.rxMbps != null || rates.txMbps != null ? rates : undefined;
    })(),
  };
  return { device, autoDomain };
}

class DeviceSource extends EventEmitter {
  /** Operator overrides, keyed by normalized MAC. Persisted to disk. */
  private overrides = new Map<string, Domain>();
  /** Latest live devices per gateway source. Empty until inventory arrives. */
  private liveBySource = new Map<string, RawDevice[]>();
  /** Sources whose inventory is PARTIAL (Matter hub lists cover only the OT
   *  side of the LAN). While ALL live sources are partial, the seed's IT
   *  devices stay on the page; a full inventory replaces the seed entirely. */
  private partialSources = new Set<string>();
  /** True once ANY live inventory has been ingested (even an empty list). */
  private receivedInventory = false;
  private lastInventoryAt?: number;

  constructor() {
    super();
    this.loadOverrides();
    // Consume inventory forwarded by the MQTT subscriber.
    ipsecSource.onInventory(({ source, payload }) => this.ingest(source, payload));
  }

  /** Best-effort load of the persisted override map. Missing/corrupt → empty. */
  private loadOverrides(): void {
    try {
      const raw = readFileSync(OVERRIDES_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, string>;
      for (const [mac, domain] of Object.entries(parsed)) {
        if (domain === 'IT' || domain === 'OT') this.overrides.set(normalizeMac(mac), domain);
      }
    } catch {
      // No file yet (first run) or unreadable — start with no overrides.
    }
  }

  /** Best-effort persist. Failure is logged but never throws into a request. */
  private saveOverrides(): void {
    try {
      mkdirSync(path.dirname(OVERRIDES_PATH), { recursive: true });
      const obj = Object.fromEntries(this.overrides.entries());
      writeFileSync(OVERRIDES_PATH, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[devices] failed to persist overrides:', err);
    }
  }

  /** Ingest a raw inventory payload from a gateway source, then emit an update.
   *  Accepts both the inventory contract and the Matter hub's list shape. */
  private ingest(source: string, payload: unknown): void {
    const matter = fromMatterList(payload);
    const devices = (matter ?? (payload as InventoryPayload | undefined))?.devices;
    if (!Array.isArray(devices)) {
      // eslint-disable-next-line no-console
      console.warn(`[devices] inventory from "${source}" had no devices[] — ignoring`);
      return;
    }
    // Mark partial-ness only for payloads that actually ingest — a malformed
    // hub reply must not un-mark a source whose last good list is still live.
    if (matter || (payload as InventoryPayload).partial === true) this.partialSources.add(source);
    else this.partialSources.delete(source);
    const valid = devices.filter((d) => d && typeof d.mac === 'string' && d.mac.trim());
    // Feed the rolling telemetry history (throughput/RSSI/power charts).
    for (const d of valid) recordTelemetry(normalizeMac(d.mac), d.telemetry);
    this.liveBySource.set(source, valid);
    this.receivedInventory = true;
    this.lastInventoryAt = Date.now();
    // eslint-disable-next-line no-console
    console.log(`[devices] ingested ${valid.length} device(s) from "${source}"`);
    this.emit('update', this.getSnapshot());
  }

  /** The active base inventory (live once received, else seed), each paired with
   *  its auto domain and the location source it was discovered from. Live
   *  devices are de-duped by MAC across sources. */
  private activeBase(): { device: Device; autoDomain: Domain; locationSource?: 'rdk' | 'prpl' }[] {
    if (!this.receivedInventory) {
      return SEED.map((d) => ({ device: d, autoDomain: d.domain, locationSource: undefined }));
    }
    // Merge raw records by MAC across sources, THEN map — so a device seen by
    // more than one source (e.g. the Shelly via MQTT power + the gateway's
    // Wi-Fi block) becomes one row carrying both sets of telemetry.
    const rawByMac = new Map<string, RawDevice>();
    // Track which location (rdk/prpl) each MAC belongs to. A device source like
    // "rdk:wifi" or "rdk:matter" or "rdk:shelly" → location 'rdk'; "prpl:wifi" → 'prpl'.
    const macLocation = new Map<string, 'rdk' | 'prpl'>();
    // While the only live data is partial (Matter lists are OT-only), keep the
    // seed's IT side so the IT page stays populated until real LAN discovery.
    const onlyPartial = [...this.liveBySource.keys()].every((k) => this.partialSources.has(k));
    if (onlyPartial) {
      for (const d of SEED) {
        if (d.domain === 'IT') rawByMac.set(normalizeMac(d.mac), seedToRaw(d));
      }
    }
    for (const [source, list] of this.liveBySource.entries()) {
      const loc: 'rdk' | 'prpl' | undefined = source.startsWith('rdk') ? 'rdk'
        : source.startsWith('prpl') ? 'prpl' : undefined;
      for (const raw of list) {
        const key = normalizeMac(raw.mac);
        const existing = rawByMac.get(key);
        rawByMac.set(key, existing ? mergeRaw(existing, raw) : raw);
        if (loc) macLocation.set(key, loc);
      }
    }
    return [...rawByMac.entries()].map(([mac, raw]) => {
      const { device, autoDomain } = toDevice(raw);
      return { device, autoDomain, locationSource: macLocation.get(mac) };
    });
  }

  getSnapshot(): DeviceSnapshot {
    const devices: DeviceView[] = this.activeBase().map(({ device, autoDomain, locationSource }) => {
      const override = this.overrides.get(device.mac);
      const domain = override ?? autoDomain;
      return { ...device, domain, autoDomain, overridden: override != null && override !== autoDomain, locationSource };
    });
    return {
      devices,
      receivedAt: Date.now(),
      source: this.receivedInventory ? 'gateway' : 'seed',
      connected: this.receivedInventory ? ipsecSource.isConnected() : true,
      lastInventoryAt: this.lastInventoryAt,
      overrides: Object.fromEntries(this.overrides.entries()),
    };
  }

  /**
   * Set or clear an operator override for a device. Re-classifying a device to
   * its own auto domain CLEARS the override (so it tracks discovery again).
   * Returns false if the MAC isn't in the current inventory.
   */
  classify(mac: string, domain: Domain): boolean {
    const key = normalizeMac(mac);
    const match = this.activeBase().find((b) => b.device.mac === key);
    if (!match) {
      // Device not currently reporting (e.g. a flapping Wi-Fi client) — store
      // the override anyway so it applies the moment the device reappears.
      this.overrides.set(key, domain);
      this.saveOverrides();
      this.emit('update', this.getSnapshot());
      return true;
    }
    if (domain === match.autoDomain) {
      this.overrides.delete(key);
    } else {
      this.overrides.set(key, domain);
    }
    this.saveOverrides();
    this.emit('update', this.getSnapshot());
    return true;
  }

  onUpdate(listener: DeviceSourceEvents['update']): () => void {
    this.on('update', listener);
    return () => this.off('update', listener);
  }
}

export const deviceSource = new DeviceSource();
