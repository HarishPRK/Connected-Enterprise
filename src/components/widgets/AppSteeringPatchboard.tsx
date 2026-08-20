/**
 * Application Steering Patchboard — clients (left) each carry one application
 * as a glass bubble with a rotating activity ring and a bobbing app badge;
 * a glowing GATEWAY BUS runs down the middle (the real topology: client →
 * gateway → tunnel); IPsec tunnel jacks (right) show live latency, a rolling
 * sparkline, and a load ring. Every client hangs off a living patch wire:
 * a dense music-seekbar ripple travels along it and packet dots stream at a
 * speed inversely proportional to the tunnel's latency. Wires enter the bus
 * at a port LED and re-emerge sorted toward their tunnel; packets re-color
 * from the app's brand hue to the tunnel family hue as they pass through.
 *
 * Re-patching (drag the wire/plug/bubble onto another jack, click-then-click,
 * or keyboard) encodes a proto3 AppRouteCommand (proto/app_route.proto) and
 * publishes it to `<source>/approute/control` via POST /api/approute/publish.
 * A successful publish surges that wire's packets for ~2s. The wire-tap
 * console shows the exact JSON → proto3 hex → topic. While a wire hovers a
 * jack, a what-if HUD previews the latency delta before you commit.
 *
 * DATA SOURCES (best available wins, per branch):
 *   • AAR feed (proto/aar.proto, routing/*): tunnels from routing/tunnel,
 *     current bindings from routing/decision (McKinney/prpl only).
 *   • else <source>/ipsec/metrics tunnels + policy-preview bindings.
 *   • else a clearly-labelled simulated board.
 * Location scoping stays STRICT — Plano (rdk) and McKinney (prpl) never mix.
 *
 * PERFORMANCE: wave geometry, packets, LEDs, and the dragged plug are animated
 * by one rAF loop that writes SVG attributes imperatively through refs — no
 * React re-render per frame or per pointer-move. Reduced motion renders
 * static wires (no wave/packets/ring/surge) with every interaction intact.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Laptop, Monitor, Printer, CreditCard, Server, PhoneCall,
  Flame, Wind, DoorClosed, Smartphone, Tablet, Cpu, Plug, HelpCircle,
  Video, Clapperboard, Mail, Briefcase, Globe, Activity, Gauge,
  Sparkles, RefreshCw, X, Lock, Unlock,
} from 'lucide-react';
import type { Device, IpsecTunnelMetric, AppCategoryId } from '../../types';
import { useIpsecMetrics } from '../../ui/useIpsecMetrics';
import { useDevices } from '../../ui/useDevices';
import { matchesDeviceInventory } from '../../ui/deviceInventory';
import { useAarRouting } from '../../ui/useAarRouting';
import { useTheme, useThemeColors } from '../../ui/Theme';
import { useToast } from '../../ui/Toast';
import { BRANCH_TO_DEVICE_TOPIC, BRANCH_TO_IPSEC_SOURCE, BRANCH_TO_FAILOVER_TOPIC, appCategories } from '../../data/mock';
import { encodeAppRouteCommand, toHex, ROUTE_ORIGIN, type AppRouteCommand } from '../../proto/appRoute';

/* The AAR plugin publishes on unprefixed routing/* topics; we associate it with
 * McKinney (prpl), matching "either these topics or prpl/ipsec/metrics". */
const AAR_BRANCH_SOURCE = 'prpl';

const kindIcon: Record<Device['kind'], React.ComponentType<{ size?: number }>> = {
  laptop: Laptop, desktop: Monitor, printer: Printer, payment: CreditCard,
  server: Server, confphone: PhoneCall,
  fire_sensor: Flame, smoke_sensor: Wind, door_lock: DoorClosed,
  phone: Smartphone, tablet: Tablet, matter: Cpu, shelly: Plug, generic: HelpCircle,
};

const LOCATION_LABEL: Record<string, string> = { rdk: 'Plano', prpl: 'McKinney' };
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

interface AppDef {
  name: string;
  cat: AppCategoryId;
  icon: React.ComponentType<{ size?: number }>;
  /** The app's own brand hue — carried by its wire, badge, and label. */
  color: string;
  /** Wire thickness ~ traffic intensity of the app class. */
  weight: number;
}

// Application palettes (Teams lavender, surveillance red, M365 flame, Salesforce azure…)
// use recognizable hues at shades that read on both themes.
const IT_APPS: AppDef[] = [
  { name: 'Microsoft Teams', cat: 'video',    icon: Video,        color: '#7B83EB', weight: 2.6 },
  { name: 'Surveillance',    cat: 'video',    icon: Clapperboard, color: '#E50914', weight: 2.8 },
  { name: 'Microsoft 365',   cat: 'business', icon: Mail,         color: '#D83B01', weight: 2.1 },
  { name: 'VoIP',            cat: 'voice',    icon: PhoneCall,    color: '#06B6D4', weight: 2.3 },
  { name: 'Salesforce',      cat: 'business', icon: Briefcase,    color: '#00A1E0', weight: 2.1 },
  { name: 'Web browsing',    cat: 'web',      icon: Globe,        color: '#A855F7', weight: 1.9 },
];
const OT_APPS: AppDef[] = [
  { name: 'OT Telemetry',  cat: 'iot',      icon: Activity,   color: '#EF4444', weight: 2.0 },
  { name: 'POS Payments',  cat: 'business', icon: CreditCard, color: '#84CC16', weight: 2.0 },
  { name: 'Sensor Stream', cat: 'iot',      icon: Gauge,      color: '#F59E0B', weight: 1.9 },
];

function catColor(id: AppCategoryId): string {
  return appCategories.find((c) => c.id === id)?.color ?? '#a855f7';
}
function hexRgb(hex: string): string {
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}
/** Mix a hex toward white (amt > 0) or black (amt < 0). Brand hues are tuned
 *  for wires; small label text needs a lighter shade on dark / darker on light
 *  to clear contrast. */
function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const target = amt < 0 ? 0 : 255;
  const a = Math.abs(amt);
  const f = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - a) + target * a);
  return `rgb(${f(0)},${f(2)},${f(4)})`;
}

/* ───────── fallbacks when a branch has no live feed yet ───────── */

const SIM_TUNNELS: IpsecTunnelMetric[] = [
  { ifname: 'vti-fiber1', present: true, reachable: true, latency_ms: 4,  loss_percent: 0.02, rx_bytes: 0, tx_bytes: 0 },
  { ifname: 'vti-fiber2', present: true, reachable: true, latency_ms: 5,  loss_percent: 0.05, rx_bytes: 0, tx_bytes: 0 },
  { ifname: 'vti-cell1',  present: true, reachable: true, latency_ms: 38, loss_percent: 0.40, rx_bytes: 0, tx_bytes: 0 },
  { ifname: 'vti-cell2',  present: true, reachable: true, latency_ms: 46, loss_percent: 0.80, rx_bytes: 0, tx_bytes: 0 },
];

interface SimClient { id: string; name: string; kind: Device['kind']; domain: 'IT' | 'OT'; app: AppDef; }
const SIM_CLIENTS: SimClient[] = [
  { id: 'aa:bb:cc:00:00:01', name: 'front-desk',   kind: 'laptop',    domain: 'IT', app: IT_APPS[0] },
  { id: 'aa:bb:cc:00:00:02', name: 'back-office',  kind: 'desktop',   domain: 'IT', app: IT_APPS[1] },
  { id: 'aa:bb:cc:00:00:03', name: 'meeting-room', kind: 'confphone', domain: 'IT', app: IT_APPS[3] },
  { id: 'aa:bb:cc:00:00:04', name: 'kitchen-pos',  kind: 'payment',   domain: 'OT', app: OT_APPS[1] },
  { id: 'aa:bb:cc:00:00:05', name: 'dock-door',    kind: 'door_lock', domain: 'OT', app: OT_APPS[0] },
];

/* ───────── helpers ───────── */

type TunnelFamily = 'fiber' | 'cell';

function familyOf(ifname: string): TunnelFamily {
  const n = (ifname || '').toLowerCase();
  return n.includes('cell') || n.includes('5g') || n.includes('lte') || n.includes('wwan') ? 'cell' : 'fiber';
}
function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
function shortIp(ip: string): string {
  return ip.length > 15 ? `${ip.slice(0, 14)}…` : ip;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface NormTunnel { ifname: string; reachable: boolean; latency_ms: number; loss_percent: number; active: boolean; }
interface TunnelSlot extends NormTunnel { family: TunnelFamily; y: number; color: string; }

interface PatchClient {
  id: string;
  name: string;
  appLabel: string;
  app: string;
  AppIcon: React.ComponentType<{ size?: number }>;
  DevIcon: React.ComponentType<{ size?: number }>;
  domain: 'IT' | 'OT';
  appColor: string;
  weight: number;
  currentIfname?: string;
  meta?: string;
  y: number;
}

function defaultSlotIdx(c: { id: string; domain: 'IT' | 'OT' }, slots: TunnelSlot[]): number {
  if (slots.length === 0) return -1;
  const fam: TunnelFamily = c.domain === 'IT' ? 'fiber' : 'cell';
  const pick = (pool: number[]) => pool[idHash(c.id) % pool.length];
  const idx = (pred: (s: TunnelSlot) => boolean) => slots.map((s, i) => ({ s, i })).filter(({ s }) => pred(s)).map(({ i }) => i);
  const pref = idx((s) => s.family === fam && s.reachable);
  if (pref.length) return pick(pref);
  const reach = idx((s) => s.reachable);
  if (reach.length) return pick(reach);
  return pick(slots.map((_, i) => i));
}

/** Latency → health color, thresholds per underlay family. */
function latencyHealth(ms: number, family: TunnelFamily): 'ok' | 'warn' | 'err' {
  if (family === 'fiber') return ms < 12 ? 'ok' : ms < 28 ? 'warn' : 'err';
  return ms < 48 ? 'ok' : ms < 75 ? 'warn' : 'err';
}

/* ───────── wave-wire geometry ─────────
 * Base curve: cubic bezier with horizontal tangents. On top rides a dense
 * traveling ripple in the music-seekbar style: many uniform peaks and dips,
 * with amplitude ramping in/out only right at the anchors. */

const SAMPLES = 44; // per segment (two segments per wire)

function bezierPoint(t: number, x0: number, y0: number, cx1: number, cy1: number, cx2: number, cy2: number, x1: number, y1: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * x0 + b * cx1 + c * cx2 + d * x1, a * y0 + b * cy1 + c * cy2 + d * y1];
}

/** Point on the waved wire at t. amp 0 = plain bezier (packets share this
 *  function so they ride the exact same ripple as the wire body). */
function wavePoint(t: number, sx: number, sy: number, ex: number, ey: number, amp: number, phase: number, sag = 0): [number, number] {
  const k = Math.max(40, Math.min(170, Math.abs(ex - sx) * 0.45));
  const cx1 = sx + k, cy1 = sy + sag, cx2 = ex - k, cy2 = ey + sag;
  const [px, py] = bezierPoint(t, sx, sy, cx1, cy1, cx2, cy2, ex, ey);
  if (!amp) return [px, py];
  const [qx, qy] = bezierPoint(Math.min(1, t + 0.02), sx, sy, cx1, cy1, cx2, cy2, ex, ey);
  const dx = qx - px, dy = qy - py;
  const len = Math.hypot(dx, dy) || 1;
  const dist = Math.hypot(ex - sx, ey - sy);
  const waves = Math.max(4, Math.min(11, dist / 34));
  // Fast ramp at the ends, flat-topped through the middle — uniform ripple.
  const taper = Math.min(1, 3.5 * Math.sin(Math.PI * t));
  const off = amp * taper * Math.sin(2 * Math.PI * waves * t - phase);
  return [px + (-dy / len) * off, py + (dx / len) * off];
}

function wavePath(sx: number, sy: number, ex: number, ey: number, amp: number, phase: number, sag = 0): string {
  let d = `M ${sx.toFixed(1)} ${sy.toFixed(1)}`;
  for (let i = 1; i <= SAMPLES; i++) {
    const [x, y] = wavePoint(i / SAMPLES, sx, sy, ex, ey, amp, phase, sag);
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

/* ───────── geometry ─────────
 * Rows start well below the eyebrows (y=26) so halos/rings never collide with
 * the header line; the gateway bus owns the middle column. */

const W = 1000, H = 452;
const CL_X = 190, CL_R = 24;          // ~150px label gutter left of the bubbles
const PORT_X = CL_X + CL_R;
const BUS_CX = 488;                    // gateway column center
// Clients, tunnels, and the gateway all sit on ONE vertical band so their
// centers line up exactly; the device caps ~18px beyond the outer rows.
const BAND_TOP = 90, BAND_BOTTOM = 362;
const BAND_CY = (BAND_TOP + BAND_BOTTOM) / 2;
const BUS_TOP = BAND_TOP - 18, BUS_BOTTOM = BAND_BOTTOM + 18;
// Rotatable 3D gateway tower — cables plug into its front-face side edges.
const GW_CX = BUS_CX;
const GW_TOP = BUS_TOP + 6, GW_BOT = BUS_BOTTOM - 4;
const GW_HALF = 52;                    // front-face half-width (widest, spin=0)
const TUN_X = 700, TUN_W = 286, TUN_H = 60;
const PLUG_INSET = 6;
const SPARK_W = 64, SPARK_H = 12, SPARK_N = 24;

interface SelectState { id: string; idx: number }
/** One recommended move from /api/approute/suggest (AI or heuristic).
 *  expected_gain_ms is NET of the server's load model (latency + queueing
 *  pressure from the app weights riding each tunnel), not raw latency. */
interface Suggestion {
  client_id: string;
  client_name: string;
  app: string;
  from_tunnel: string;
  to_tunnel: string;
  expected_gain_ms: number;
  /** App counts before the move (from includes this client; to excludes it). */
  from_apps?: number;
  to_apps?: number;
  reason: string;
}
interface AdvisorState {
  open: boolean;
  loading: boolean;
  /** 'ai' (Bedrock/Anthropic) or 'heuristic' (deterministic fallback). */
  mode?: string;
  note?: string;
  suggestions: Suggestion[];
}
interface PubState {
  seq: number;
  phase: 'publishing' | 'ok' | 'offline' | 'error' | 'nolive';
  label: string; json: string; hex: string; bytes: number; topic: string; error?: string;
}
interface WireEls {
  grad: SVGLinearGradientElement | null;
  glowA: SVGPathElement | null; bodyA: SVGPathElement | null; hitA: SVGPathElement | null;
  glowB: SVGPathElement | null; bodyB: SVGPathElement | null; hitB: SVGPathElement | null;
  led: SVGGElement | null;
  plug: SVGGElement | null;
  packets: (SVGCircleElement | null)[];
}
interface LinkGeom {
  id: string; idx: number; sx: number; sy: number;
  tx: number; ty: number;            // committed socket end
  color: string; slotColor: string; latency: number; family: TunnelFamily; hasSlot: boolean;
  weight: number;
  phase0: number;
}

/* ───────── component ───────── */

export function AppSteeringPatchboard({ branchId, externalAdvisorTrigger = false, advisorHostId }: { branchId: string; externalAdvisorTrigger?: boolean; advisorHostId?: string }) {
  const tc = useThemeColors();
  const { theme } = useTheme();
  const ipsec = useIpsecMetrics();
  const aar = useAarRouting();
  const { devices: allDevices } = useDevices();
  const { push } = useToast();
  const dark = theme === 'dark';
  const surface = dark ? 'rgba(16,14,34,0.96)' : '#ffffff';
  // Gateway device shell tones (white slab, cylinder-shaded edges).
  const gwBright = dark ? '#f2f2fa' : '#ffffff';
  const gwLight = dark ? '#d3d5e5' : '#e9ebf2';
  const gwEdge = dark ? '#6c6f90' : '#b4b8c9';
  const gwTopDark = dark ? '#0d0d15' : '#141420';

  const svgRef = useRef<SVGSVGElement | null>(null);
  const seqRef = useRef(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<SelectState | null>(null);
  const [pub, setPub] = useState<PubState | null>(null);
  const [lastPatched, setLastPatched] = useState<{ id: string; seq: number; toIdx: number } | null>(null);
  const [simTick, setSimTick] = useState(0);

  // Drag lives in refs (the rAF loop consumes it); React only hears about
  // drop-target changes so the wire follows the pointer at frame rate.
  const dragRef = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const plugPos = useRef(new Map<string, { x: number; y: number }>());
  const wireEls = useRef(new Map<string, WireEls>());
  const linksRef = useRef<LinkGeom[]>([]);
  const histRef = useRef(new Map<string, number[]>());
  /** Post-publish packet surge: wire id → performance.now()/1000 deadline. */
  const surgeRef = useRef<{ id: string; until: number } | null>(null);

  // Freeze: per-client routing lock (default OFF). Frozen clients can't be
  // re-patched (drag, click, keyboard, or advisor Apply) until unfrozen.
  const [frozen, setFrozen] = useState<Record<string, boolean>>({});
  /** Bumps a nonce so the denied bubble replays its shake animation. */
  const [shake, setShake] = useState<{ id: string; n: number } | null>(null);

  // AI route advisor + its "guide" overlay (ghost wire to the suggested jack).
  const [advisor, setAdvisor] = useState<AdvisorState>({ open: false, loading: false, suggestions: [] });
  const [guide, setGuide] = useState<{ clientId: string; toIfname: string } | null>(null);
  const [advisorHost, setAdvisorHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!advisorHostId) return;
    setAdvisorHost(document.getElementById(advisorHostId));
  }, [advisorHostId]);

  const source = BRANCH_TO_IPSEC_SOURCE[branchId] as 'rdk' | 'prpl' | undefined;
  const deviceTopic = BRANCH_TO_DEVICE_TOPIC[branchId];
  const topic = BRANCH_TO_FAILOVER_TOPIC[branchId];
  const gw = useMemo(
    () => (topic ? ipsec.list.find((gateway) => gateway.topic === topic) : undefined),
    [ipsec.list, topic],
  );

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const aarEligible = source === AAR_BRANCH_SOURCE || source === undefined;
  const aarLive = aarEligible && aar.receivedAt > 0;

  /* ── Tunnels: AAR → ipsec → sim (sim drifts gently so demos breathe). ── */
  const { tunnels, tunnelSource } = useMemo(() => {
    const liveIpsec = gw?.metrics.tunnels?.length ? gw.metrics.tunnels : null;
    let raw: NormTunnel[];
    let src: 'aar' | 'ipsec' | 'sim';
    if (aarLive && aar.tunnels.length) {
      raw = aar.tunnels.map((t) => ({ ifname: t.iface, reachable: true, latency_ms: t.latency_ms, loss_percent: 0, active: false }));
      src = 'aar';
    } else if (liveIpsec) {
      const act = gw?.metrics.active_tunnel;
      raw = liveIpsec.map((t) => ({ ifname: t.ifname, reachable: t.reachable, latency_ms: t.latency_ms, loss_percent: t.loss_percent, active: act === t.ifname }));
      src = 'ipsec';
    } else {
      raw = SIM_TUNNELS.map((t, i) => ({
        ifname: t.ifname, reachable: t.reachable,
        latency_ms: Math.max(1, Math.round((t.latency_ms + Math.sin(simTick * 0.9 + i * 2.1) * t.latency_ms * 0.14) * 10) / 10),
        loss_percent: t.loss_percent, active: t.ifname === 'vti-fiber1',
      }));
      src = 'sim';
    }
    const sorted = raw.sort((a, b) => (familyOf(a.ifname) === 'cell' ? 1 : 0) - (familyOf(b.ifname) === 'cell' ? 1 : 0) || a.ifname.localeCompare(b.ifname));
    const n = sorted.length;
    const slots: TunnelSlot[] = sorted.map((t, i) => {
      const family = familyOf(t.ifname);
      return { ...t, family, y: n <= 1 ? BAND_CY : BAND_TOP + i * ((BAND_BOTTOM - BAND_TOP) / (n - 1)), color: family === 'fiber' ? tc.accent : tc.accent2 };
    });
    return { tunnels: slots, tunnelSource: src };
  }, [aarLive, aar.tunnels, gw, tc.accent, tc.accent2, simTick]);

  // Sim heartbeat so the demo board's latencies drift like a live one.
  useEffect(() => {
    if (tunnelSource !== 'sim' || reduceMotion) return;
    const iv = setInterval(() => setSimTick((t) => t + 1), 2400);
    return () => clearInterval(iv);
  }, [tunnelSource, reduceMotion]);

  // Rolling latency history per tunnel — feeds the sparklines.
  useEffect(() => {
    for (const t of tunnels) {
      const h = histRef.current.get(t.ifname) ?? [];
      if (h[h.length - 1] !== t.latency_ms) {
        h.push(t.latency_ms);
        if (h.length > SPARK_N) h.splice(0, h.length - SPARK_N);
        histRef.current.set(t.ifname, h);
      }
    }
  }, [tunnels]);

  /* ── Clients: AAR decisions → device inventory → sim. ── */
  const { clients, clientSource, extraCount } = useMemo(() => {
    const mine = allDevices.filter((device) =>
      matchesDeviceInventory(device, source, deviceTopic),
    );
    const place = (rows: Omit<PatchClient, 'y'>[]): PatchClient[] => {
      const n = rows.length;
      return rows.map((r, i) => ({ ...r, y: n <= 1 ? BAND_CY : BAND_TOP + i * ((BAND_BOTTOM - BAND_TOP) / (n - 1)) }));
    };

    if (aarLive && aar.decisions.length) {
      const rows = aar.decisions.slice(0, 6).map((d) => {
        const dev = mine.find((m) => m.ip === d.src_ip);
        const domain = (dev?.domain ?? 'IT') as 'IT' | 'OT';
        return {
          id: d.src_ip,
          name: dev?.name || d.src_ip,
          appLabel: `→ ${shortIp(d.dst_ip)}`,
          app: d.dst_ip,
          AppIcon: Globe,
          DevIcon: kindIcon[dev?.kind ?? 'generic'] ?? HelpCircle,
          domain,
          appColor: catColor('web'),
          weight: 2.1,
          currentIfname: d.tunnel || undefined,
          meta: d.total_latency_ms ? `${d.total_latency_ms} ms e2e` : undefined,
        };
      });
      return { clients: place(rows), clientSource: 'aar' as const, extraCount: aar.decisions.length - rows.length };
    }

    if (mine.length) {
      const it = mine.filter((d) => d.domain === 'IT').sort((a, b) => a.id.localeCompare(b.id)).slice(0, 3);
      const ot = mine.filter((d) => d.domain === 'OT').sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2);
      const mk = (d: typeof mine[number], app: AppDef): Omit<PatchClient, 'y'> => ({
        id: d.mac, name: d.name, appLabel: app.name, app: app.name, AppIcon: app.icon,
        DevIcon: kindIcon[d.kind] ?? HelpCircle, domain: d.domain, appColor: app.color, weight: app.weight,
      });
      const rows = [
        ...it.map((d, i) => mk(d, IT_APPS[i % IT_APPS.length])),
        ...ot.map((d, i) => mk(d, OT_APPS[i % OT_APPS.length])),
      ];
      const total = mine.filter((d) => d.domain === 'IT').length + mine.filter((d) => d.domain === 'OT').length;
      return { clients: place(rows), clientSource: 'devices' as const, extraCount: total - rows.length };
    }

    const rows = SIM_CLIENTS.map((c) => ({
      id: c.id, name: c.name, appLabel: c.app.name, app: c.app.name, AppIcon: c.app.icon,
      DevIcon: kindIcon[c.kind] ?? HelpCircle, domain: c.domain, appColor: c.app.color, weight: c.app.weight,
    }));
    return { clients: place(rows), clientSource: 'sim' as const, extraCount: 0 };
  }, [aarLive, aar.decisions, allDevices, source, deviceTopic]);

  const slotIdxFor = (c: PatchClient): number => {
    const ov = overrides[c.id];
    if (ov) { const i = tunnels.findIndex((s) => s.ifname === ov); if (i >= 0) return i; }
    if (c.currentIfname) { const i = tunnels.findIndex((s) => s.ifname === c.currentIfname); if (i >= 0) return i; }
    return defaultSlotIdx(c, tunnels);
  };

  /* ───────── commit + publish (unchanged pipeline) ───────── */

  function commitPatch(client: PatchClient, targetIdx: number) {
    if (frozen[client.id]) {
      setShake({ id: client.id, n: (shake?.n ?? 0) + 1 });
      push({ kind: 'warn', title: `${client.name} is frozen`, detail: 'Routing is locked for this application — unfreeze it to re-patch.' });
      return;
    }
    const fromIdx = slotIdxFor(client);
    if (targetIdx < 0 || targetIdx >= tunnels.length || targetIdx === fromIdx) return;
    const from = tunnels[fromIdx];
    const to = tunnels[targetIdx];

    setOverrides((prev) => ({ ...prev, [client.id]: to.ifname }));
    // A committed move consumes this client's guide + advisor suggestions.
    setGuide((g) => (g?.clientId === client.id ? null : g));
    setAdvisor((a) => (a.suggestions.some((s) => s.client_id === client.id)
      ? { ...a, suggestions: a.suggestions.filter((s) => s.client_id !== client.id) }
      : a));

    // Tag provenance on the wire: a commit that matches an active advisor
    // suggestion for this client+target (Apply, guided drag, or a plain drag
    // that happens to follow the advice) carries the advisor's origin,
    // reasoning, and promised net gain; everything else is an operator move.
    const sug = advisor.suggestions.find((s) => s.client_id === client.id && s.to_tunnel === to.ifname);
    const origin = sug
      ? (advisor.mode === 'ai' ? ROUTE_ORIGIN.advisorAi : ROUTE_ORIGIN.advisorHeuristic)
      : ROUTE_ORIGIN.operator;

    const seq = publishCmd({
      timestamp_ms: Date.now(),
      source: source ?? 'sim',
      gateway: gw?.metrics.gateway.name ?? 'gateway',
      type: 'user_initiated',
      changes: [{
        client_mac: client.id,
        client_name: client.name,
        current: { application: client.app, tunnel: from.ifname },
        desired: { application: client.app, tunnel: to.ifname },
        origin,
        advisor_reason: sug?.reason,
        expected_gain_ms: sug?.expected_gain_ms,
        // Frozen clients are rejected above, so a published change is always
        // false here — sent explicitly so the key is never missing.
        freeze: !!frozen[client.id],
      }],
    },
    `${client.name} · ${client.appLabel} · ${from.ifname} → ${to.ifname}`,
    `Route published — ${client.appLabel} → ${to.ifname}`);

    setLastPatched({ id: client.id, seq, toIdx: targetIdx });
    surgeRef.current = { id: client.id, until: performance.now() / 1000 + 2.4 };
  }

  /** Encode + publish an AppRouteCommand on `<source>/approute/control`,
   *  driving the wire-tap console and toasts. Returns the publish seq. */
  function publishCmd(cmd: AppRouteCommand, label: string, successTitle: string): number {
    const bytes = encodeAppRouteCommand(cmd);
    const seq = ++seqRef.current;
    const base: Omit<PubState, 'phase'> = {
      seq, label,
      json: JSON.stringify(cmd),
      hex: toHex(bytes),
      bytes: bytes.length,
      topic: `${source ?? 'sim'}/approute/control`,
    };

    if (!source) {
      setPub({ ...base, phase: 'nolive' });
      push({ kind: 'info', title: 'Command encoded (not published)', detail: 'This branch has no live gateway — proto3 payload shown in the wire-tap console.' });
      return seq;
    }

    setPub({ ...base, phase: 'publishing' });
    void (async () => {
      try {
        const res = await fetch(`/api/approute/publish?source=${source}`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes,
        });
        const data = await res.json().catch(() => null) as { ok?: boolean; offline?: boolean; error?: string } | null;
        if (seqRef.current !== seq) return;
        if (res.ok && data?.ok) {
          setPub({ ...base, phase: 'ok' });
          push({ kind: 'success', title: successTitle, detail: `${bytes.length} B proto3 on ${base.topic} (qos1)` });
        } else if (res.status === 503 && data?.offline) {
          setPub({ ...base, phase: 'offline', error: data.error });
          push({ kind: 'warn', title: 'Broker offline — command encoded, not delivered', detail: data.error });
        } else {
          setPub({ ...base, phase: 'error', error: data?.error ?? `HTTP ${res.status}` });
          push({ kind: 'error', title: 'Publish failed', detail: data?.error ?? `HTTP ${res.status}` });
        }
      } catch (err) {
        if (seqRef.current !== seq) return;
        const msg = err instanceof Error ? err.message : String(err);
        setPub({ ...base, phase: 'error', error: msg });
        push({ kind: 'error', title: 'Publish failed', detail: msg });
      }
    })();
    return seq;
  }

  /* ───────── freeze + AI advisor ───────── */

  function toggleFreeze(id: string) {
    const client = clients.find((c) => c.id === id);
    const next = !frozen[id];
    setFrozen((f) => ({ ...f, [id]: next }));
    setGuide((g) => (g?.clientId === id ? null : g)); // frozen clients can't be guided
    if (!client) return;
    // The lock is a routing-control fact the gateway can enforce — publish it
    // on the same approute topic as a freeze-only AppRouteCommand. `tunnel` is
    // what the app is pinned to right now: what the gateway should hold it on.
    const idx = slotIdxFor(client);
    publishCmd({
      timestamp_ms: Date.now(),
      source: source ?? 'sim',
      gateway: gw?.metrics.gateway.name ?? 'gateway',
      type: 'user_initiated',
      changes: [],
      freezes: [{
        client_mac: client.id,
        client_name: client.name,
        application: client.app,
        freeze: next,
        tunnel: idx >= 0 ? tunnels[idx].ifname : '',
      }],
    },
    `${client.name} · ${client.appLabel} · ${next ? 'freeze' : 'unfreeze'} routing`,
    next ? `Freeze published — ${client.name} routing locked` : `Unfreeze published — ${client.name} routing released`);
  }

  /** One-shot advisor run: snapshot the board (minus frozen clients), let the
   *  server compare tunnels (Bedrock, heuristic fallback), render suggestions. */
  async function runAdvisor() {
    const unfrozen = clients.filter((c) => !frozen[c.id]);
    const frozenCount = clients.length - unfrozen.length;
    setGuide(null);
    if (unfrozen.length === 0) {
      setAdvisor({ open: true, loading: false, mode: 'heuristic', note: 'All clients are frozen — nothing to advise on.', suggestions: [] });
      return;
    }
    setAdvisor((a) => ({ ...a, open: true, loading: true, note: undefined, suggestions: [] }));
    // Load = sum of app weights per tunnel (frozen clients still occupy their
    // tunnel, so they count toward load even though they can't be moved).
    const counts = new Array(tunnels.length).fill(0) as number[];
    const loads = new Array(tunnels.length).fill(0) as number[];
    for (const c of clients) {
      const i = slotIdxFor(c);
      if (i >= 0) { counts[i]++; loads[i] += c.weight; }
    }
    const body = {
      source: source ?? 'sim',
      clients: unfrozen.map((c) => {
        const i = slotIdxFor(c);
        return { id: c.id, name: c.name, app: c.app, weight: c.weight, tunnel: i >= 0 ? tunnels[i].ifname : '' };
      }),
      tunnels: tunnels.map((s, i) => ({
        ifname: s.ifname, family: s.family, latency_ms: s.latency_ms,
        loss_percent: s.loss_percent, reachable: s.reachable,
        apps: counts[i], load: Math.round(loads[i] * 10) / 10,
      })),
    };
    try {
      const res = await fetch('/api/approute/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null) as { mode?: string; note?: string; suggestions?: Suggestion[]; error?: string } | null;
      if (!res.ok || !data) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setAdvisor({
        open: true, loading: false, mode: data.mode,
        note: frozenCount > 0
          ? `${frozenCount} frozen client${frozenCount === 1 ? '' : 's'} excluded${data.note ? ` · ${data.note}` : ''}`
          : data.note,
        suggestions: data.suggestions ?? [],
      });
    } catch (err) {
      setAdvisor({ open: true, loading: false, mode: 'error', note: err instanceof Error ? err.message : String(err), suggestions: [] });
    }
  }

  function applySuggestion(s: Suggestion) {
    const client = clients.find((c) => c.id === s.client_id);
    const idx = tunnels.findIndex((t) => t.ifname === s.to_tunnel);
    if (!client || idx < 0) return;
    commitPatch(client, idx); // frozen guard + publish + cleanup live inside
  }

  /* ───────── pointer plumbing ───────── */

  function toSvgXY(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
  }

  function hitTunnel(x: number, y: number): number | null {
    if (x < TUN_X - 110 || x > TUN_X + TUN_W + 20) return null;
    const i = tunnels.findIndex((s) => Math.abs(y - s.y) <= TUN_H / 2 + 18);
    return i >= 0 ? i : null;
  }

  function startDrag(e: React.PointerEvent, id: string) {
    e.preventDefault();
    if (frozen[id]) {
      setShake({ id, n: (shake?.n ?? 0) + 1 });
      const name = clients.find((c) => c.id === id)?.name ?? 'Client';
      push({ kind: 'info', title: `${name} is frozen`, detail: 'Routing is locked for this application — unfreeze it to re-patch.' });
      return;
    }
    setSelected(null);
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const { x, y } = toSvgXY(e);
    dragRef.current = { id, x, y, moved: false };
    setDragId(id);
    setOverIdx(hitTunnel(x, y));
  }

  function onSvgMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = toSvgXY(e);
    if (!d.moved && Math.hypot(x - d.x, y - d.y) > 5) d.moved = true;
    d.x = x; d.y = y;
    const over = hitTunnel(x, y);
    setOverIdx((prev) => (prev === over ? prev : over));
  }

  function endDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    setOverIdx(null);
    if (!d) return;
    const client = clients.find((c) => c.id === d.id);
    if (!client) return;
    if (!d.moved) { setSelected({ id: client.id, idx: slotIdxFor(client) }); return; }
    const over = hitTunnel(d.x, d.y);
    if (over != null) commitPatch(client, over);
  }

  function cancelDrag() {
    dragRef.current = null;
    setDragId(null);
    setOverIdx(null);
  }

  useEffect(() => {
    if (!dragId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelDrag(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragId]);

  function onTunnelClick(idx: number) {
    if (!selected) return;
    const client = clients.find((c) => c.id === selected.id);
    setSelected(null);
    if (client) commitPatch(client, idx);
  }

  function onPlugKey(e: React.KeyboardEvent, client: PatchClient) {
    const cur = slotIdxFor(client);
    if (!selected || selected.id !== client.id) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected({ id: client.id, idx: cur }); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSelected({ id: client.id, idx: (selected.idx + step + tunnels.length) % tunnels.length });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const idx = selected.idx;
      setSelected(null);
      commitPatch(client, idx);
    } else if (e.key === 'Escape') {
      setSelected(null);
    }
  }

  /* ───────── derived render data ───────── */

  const guideClient = guide ? clients.find((c) => c.id === guide.clientId) ?? null : null;
  const guideIdx = guide ? tunnels.findIndex((s) => s.ifname === guide.toIfname) : -1;
  const highlightIdx = overIdx ?? (selected ? selected.idx : guideIdx >= 0 ? guideIdx : null);
  const armed = dragId != null || selected != null;
  const busYOf = (sy: number, ey: number) => clamp((sy + ey) / 2, BUS_TOP + 16, BUS_BOTTOM - 16);

  // Focus mode: while a client is selected, dragged, or advisor-guided, fade
  // the other wires + their packets so the chosen flow stands out.
  const focusedId = dragId ?? selected?.id ?? guideClient?.id ?? null;
  const trafficOpacity = (cid: string) => (focusedId && focusedId !== cid ? 0.15 : 1);

  const links = clients.map((c, i) => {
    const idx = slotIdxFor(c);
    const slot = idx >= 0 ? tunnels[idx] : null;
    const ty = slot?.y ?? c.y;
    return {
      c, i, idx, slot,
      sx: PORT_X + 2, sy: c.y,
      tx: TUN_X - PLUG_INSET, ty,
      busY0: busYOf(c.y, ty),
      pulsing: lastPatched?.id === c.id,
      h: idHash(c.id),
    };
  });

  // Geometry snapshot for the rAF loop (it never touches React state).
  linksRef.current = links.map((l) => ({
    id: l.c.id, idx: l.idx, sx: l.sx, sy: l.sy, tx: l.tx, ty: l.ty,
    color: l.c.appColor, slotColor: l.slot?.color ?? tc.textMuted,
    latency: l.slot?.latency_ms ?? 30, family: l.slot?.family ?? 'fiber', hasSlot: !!l.slot,
    weight: l.c.weight,
    phase0: (l.h % 100) / 100 * Math.PI * 2,
  }));

  /* ───────── the wave engine ───────── */

  useEffect(() => {
    if (reduceMotion) return;
    let raf = 0;
    const tick = () => {
      const now = performance.now() / 1000;
      const edgeL = GW_CX - GW_HALF;   // cables plug into the device's fixed side edges
      const edgeR = GW_CX + GW_HALF;

      const d = dragRef.current;
      for (const g of linksRef.current) {
        const els = wireEls.current.get(g.id);
        if (!els) continue;
        const dragging = d?.id === g.id && d.moved;
        let txT = g.tx, tyT = g.ty;
        if (dragging && d) {
          const over = hitTunnel(d.x, d.y);
          if (over != null) { txT = TUN_X - PLUG_INSET; tyT = tunnels[over].y; } // magnetic snap
          else { txT = d.x; tyT = d.y; }
        }
        const p = plugPos.current.get(g.id) ?? { x: g.tx, y: g.ty };
        p.x += (txT - p.x) * (dragging ? 0.45 : 0.28);
        p.y += (tyT - p.y) * (dragging ? 0.45 : 0.28);
        if (Math.abs(p.x - txT) < 0.4) p.x = txT;
        if (Math.abs(p.y - tyT) < 0.4) p.y = tyT;
        plugPos.current.set(g.id, p);

        const surge = surgeRef.current?.id === g.id && now < (surgeRef.current?.until ?? 0);
        const busY = busYOf(g.sy, p.y);
        const sag = dragging ? Math.min(40, Math.hypot(p.x - edgeR, p.y - busY) * 0.1) : 0;
        const ampA = (dragging ? 3.6 : 2.8) + (surge ? 1 : 0);
        const ampB = (dragging ? 4.4 : 3.2) + (surge ? 1 : 0);
        const phaseA = now * 3.4 + g.phase0;
        const phaseB = phaseA + 1.3;

        const pathA = wavePath(g.sx, g.sy, edgeL, busY, ampA, phaseA);
        const pathB = wavePath(edgeR, busY, p.x, p.y, ampB, phaseB, sag);
        els.bodyA?.setAttribute('d', pathA);
        els.glowA?.setAttribute('d', pathA);
        els.hitA?.setAttribute('d', pathA);
        els.bodyB?.setAttribute('d', pathB);
        els.glowB?.setAttribute('d', pathB);
        els.hitB?.setAttribute('d', pathB);
        els.grad?.setAttribute('x1', edgeR.toFixed(1));
        els.grad?.setAttribute('y1', busY.toFixed(1));
        els.grad?.setAttribute('x2', p.x.toFixed(1));
        els.grad?.setAttribute('y2', p.y.toFixed(1));
        els.led?.setAttribute('transform', `translate(0 ${busY.toFixed(1)})`);
        els.plug?.setAttribute('transform', `translate(${(p.x - g.tx).toFixed(1)} ${(p.y - g.ty).toFixed(1)})`);

        // Packets: client → device (brand color) → tunnel (family color);
        // they vanish inside the device and re-emerge recolored. Speed falls
        // with latency; a fresh publish surges them for ~2s.
        const speed0 = Math.max(0.10, Math.min(0.7, 26 / (g.latency + 8)));
        const speed = surge ? speed0 * 2.6 : speed0;
        els.packets.forEach((pk, i) => {
          if (!pk) return;
          if (dragging || !g.hasSlot) { pk.setAttribute('opacity', '0'); return; }
          const t = (now * speed + i / els.packets.length + g.phase0) % 1;
          let x: number, y: number, fill: string;
          if (t < 0.47) {
            [x, y] = wavePoint(t / 0.47, g.sx, g.sy, edgeL, busY, ampA, phaseA);
            fill = g.color;
          } else if (t > 0.53) {
            [x, y] = wavePoint((t - 0.53) / 0.47, edgeR, busY, p.x, p.y, ampB, phaseB, sag);
            fill = g.slotColor;
          } else {
            pk.setAttribute('opacity', '0'); // inside the gateway
            return;
          }
          pk.setAttribute('cx', x.toFixed(1));
          pk.setAttribute('cy', y.toFixed(1));
          pk.setAttribute('fill', fill);
          pk.setAttribute('r', surge ? '3' : '2.1');
          pk.setAttribute('opacity', t < 0.03 || t > 0.97 ? '0' : surge ? '1' : '0.9');
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, tunnels]);

  const ensureEls = (id: string): WireEls => {
    let e = wireEls.current.get(id);
    if (!e) {
      e = { grad: null, glowA: null, bodyA: null, hitA: null, glowB: null, bodyB: null, hitB: null, led: null, plug: null, packets: [] };
      wireEls.current.set(id, e);
    }
    return e;
  };

  const sourceChip = (s: string) =>
    s === 'aar' ? 'live · routing/*'
      : s === 'ipsec' ? `live · ${source}/ipsec/metrics`
        : s === 'devices' ? 'live · device inventory'
          : 'simulated';
  const fleetLabel = source ? (LOCATION_LABEL[source] ?? source) : 'demo';
  const gwName = gw?.metrics.gateway.name || 'gateway';

  /* ───────── render ───────── */

  return (
    <div style={{ position: 'relative', maxWidth: W, margin: '0 auto' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        role="application"
        aria-label="Application steering patchboard: drag a client's wire onto a tunnel to re-route its application through the gateway"
        onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
        onPointerMove={onSvgMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onKeyDown={(e) => { if (e.key === 'Escape') { setSelected(null); setGuide(null); cancelDrag(); } }}
      >
        <defs>
          <filter id="apb-glow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="4.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="gw-blur" x="-60%" y="-25%" width="220%" height="150%"><feGaussianBlur stdDeviation="5" /></filter>
          <linearGradient id="gw-body" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={gwEdge} />
            <stop offset="18%" stopColor={gwLight} />
            <stop offset="48%" stopColor={gwBright} />
            <stop offset="82%" stopColor={gwLight} />
            <stop offset="100%" stopColor={gwEdge} />
          </linearGradient>
          <linearGradient id="gw-shine" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="50%" stopColor="#fff" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="apb-spec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity={dark ? 0.85 : 0.95} />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          {(['IT', 'OT'] as const).map((dom) => {
            const rgb = hexRgb(dom === 'IT' ? tc.accent : tc.accent2);
            return (
              <g key={dom}>
                <radialGradient id={`apb-sphere-${dom}`} cx="36%" cy="30%" r="75%">
                  <stop offset="0%" stopColor={`rgba(255,255,255,${dark ? 0.5 : 0.9})`} />
                  <stop offset="30%" stopColor={`rgba(${rgb},${dark ? 0.42 : 0.34})`} />
                  <stop offset="72%" stopColor={`rgba(${rgb},${dark ? 0.16 : 0.18})`} />
                  <stop offset="100%" stopColor={`rgba(${rgb},${dark ? 0.3 : 0.24})`} />
                </radialGradient>
                <radialGradient id={`apb-halo-${dom}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={`rgba(${rgb},0.45)`} />
                  <stop offset="100%" stopColor={`rgba(${rgb},0)`} />
                </radialGradient>
              </g>
            );
          })}
          {links.map((l) => (
            <linearGradient key={l.i} id={`apb-w-${l.i}`} gradientUnits="userSpaceOnUse"
              ref={(el) => { ensureEls(l.c.id).grad = el; }}
              x1={GW_CX + GW_HALF} y1={l.busY0} x2={l.tx} y2={l.ty}>
              <stop offset="0%" stopColor={l.c.appColor} stopOpacity={0.95} />
              <stop offset="100%" stopColor={l.slot?.color ?? l.c.appColor} stopOpacity={0.95} />
            </linearGradient>
          ))}
        </defs>

        {/* eyebrows */}
        <text x={CL_X - CL_R} y={26} fontSize="9.5" fontWeight={700} letterSpacing="0.14em" fill={tc.textMuted}>CLIENTS · ONE APP EACH</text>
        <text x={BUS_CX} y={26} textAnchor="middle" fontSize="9.5" fontWeight={700} letterSpacing="0.14em" fill={tc.textMuted}>GATEWAY</text>
        <text x={TUN_X} y={26} fontSize="9.5" fontWeight={700} letterSpacing="0.14em" fill={tc.textMuted}>IPSEC TUNNELS</text>

        {/* ── wires: client → bus (brand color), bus → tunnel (brand→family) ── */}
        {links.map((l) => {
          const dragging = dragId === l.c.id;
          const initialA = wavePath(l.sx, l.sy, GW_CX - GW_HALF, l.busY0, 0, 0);
          const initialB = wavePath(GW_CX + GW_HALF, l.busY0, l.tx, l.ty, 0, 0);
          const packetCount = (l.slot?.family === 'fiber' ? 3 : 2) + (l.c.weight >= 2.5 ? 1 : 0);
          const rgbA = hexRgb(l.c.appColor);
          return (
            <g key={`w-${l.c.id}`} className="apb-dimmable" opacity={trafficOpacity(l.c.id)}>
              {dragging && l.slot && (
                <path d={initialB} fill="none" stroke={tc.textMuted} strokeOpacity={0.2} strokeWidth={1.2} strokeDasharray="4 8" />
              )}
              <path ref={(el) => { ensureEls(l.c.id).glowA = el; }} d={initialA} fill="none"
                stroke={`rgba(${rgbA},1)`} strokeOpacity={0.14} strokeWidth={l.c.weight * 2.6} strokeLinecap="round" />
              <path ref={(el) => { ensureEls(l.c.id).bodyA = el; }} d={initialA} fill="none"
                stroke={`rgba(${rgbA},0.92)`} strokeWidth={l.c.weight} strokeLinecap="round"
                className={l.pulsing ? 'apb-flash' : undefined} />
              <path ref={(el) => { ensureEls(l.c.id).glowB = el; }} d={initialB} fill="none"
                stroke={`url(#apb-w-${l.i})`} strokeOpacity={dragging ? 0.3 : 0.14}
                strokeWidth={l.c.weight * 2.6} strokeLinecap="round" />
              <path ref={(el) => { ensureEls(l.c.id).bodyB = el; }} d={initialB} fill="none"
                stroke={`url(#apb-w-${l.i})`} strokeWidth={dragging ? l.c.weight + 0.7 : l.c.weight} strokeLinecap="round"
                className={l.pulsing ? 'apb-flash' : undefined} />
              {!reduceMotion && Array.from({ length: packetCount }, (_, pi) => (
                <circle key={pi} r={2.1} fill={l.c.appColor} opacity={0}
                  ref={(el) => { ensureEls(l.c.id).packets[pi] = el; }} style={{ pointerEvents: 'none' }} />
              ))}
              {/* grab the wire anywhere along either segment */}
              <path ref={(el) => { ensureEls(l.c.id).hitA = el; }} d={initialA} fill="none"
                stroke="transparent" strokeWidth={18} strokeLinecap="round"
                style={{ cursor: dragging ? 'grabbing' : 'grab', pointerEvents: 'stroke' }}
                onPointerDown={(e) => startDrag(e, l.c.id)} />
              <path ref={(el) => { ensureEls(l.c.id).hitB = el; }} d={initialB} fill="none"
                stroke="transparent" strokeWidth={18} strokeLinecap="round"
                style={{ cursor: dragging ? 'grabbing' : 'grab', pointerEvents: 'stroke' }}
                onPointerDown={(e) => startDrag(e, l.c.id)} />
            </g>
          );
        })}

        {/* ── gateway: the 3D device the whole path threads through ── */}
        <g>
          {/* ground shadow */}
          <ellipse cx={GW_CX} cy={GW_BOT + 5} rx={GW_HALF * 0.8} ry={7} fill="#000"
            opacity={dark ? 0.5 : 0.15} style={{ pointerEvents: 'none' }} />
          {/* device shell */}
          <g>
            <ellipse cx={GW_CX} cy={GW_BOT} rx={GW_HALF} ry={9} fill={gwTopDark} opacity={0.9} />
            <rect x={GW_CX - GW_HALF} y={GW_TOP} width={GW_HALF * 2} height={GW_BOT - GW_TOP} rx={20}
              fill="url(#gw-body)" stroke={gwEdge} strokeOpacity={0.5} strokeWidth={1}>
              <title>Gateway {gwName}</title>
            </rect>
            {/* status light */}
            <circle cx={GW_CX} cy={GW_BOT - 44} r={4} fill={tc.accent3} opacity={0.9} filter="url(#apb-glow)" />
            {/* vented grille cap */}
            <ellipse cx={GW_CX} cy={GW_TOP} rx={GW_HALF - 2} ry={13} fill={gwTopDark} />
            <ellipse cx={GW_CX} cy={GW_TOP} rx={GW_HALF - 11} ry={8.5} fill="none" stroke="#fff" strokeOpacity={0.11} />
            <ellipse cx={GW_CX} cy={GW_TOP} rx={GW_HALF - 22} ry={5} fill="none" stroke="#fff" strokeOpacity={0.1} />
            <ellipse cx={GW_CX} cy={GW_TOP} rx={GW_HALF - 33} ry={2.4} fill="none" stroke="#fff" strokeOpacity={0.08} />
          </g>
          {/* soft edge-lit sheen for a glass finish */}
          <rect x={GW_CX - 15} y={GW_TOP + 18} width={22} height={GW_BOT - GW_TOP - 40} rx={11}
            fill="url(#gw-shine)" opacity={0.26} filter="url(#gw-blur)" style={{ pointerEvents: 'none' }} />
          {/* caption */}
          <text x={GW_CX} y={GW_BOT + 24} textAnchor="middle" fontSize="10.5" fontWeight={700} fill={tc.text}>{gwName}</text>
          <text x={GW_CX} y={GW_BOT + 37} textAnchor="middle" fontSize="9" fill={tc.textMuted} fontFamily={MONO}>
            {source ?? 'sim'} · {fleetLabel}
          </text>
        </g>

        {/* device port LEDs — the plug points; slide vertically with the wire */}
        {links.map((l) => (
          <g key={`led-${l.c.id}`} ref={(el) => { ensureEls(l.c.id).led = el; }}
            className="apb-dimmable" opacity={trafficOpacity(l.c.id)}
            transform={`translate(0 ${l.busY0})`} style={{ pointerEvents: 'none' }}>
            <circle cx={GW_CX - GW_HALF} cy={0} r={2.8} fill={l.c.appColor} />
            <circle cx={GW_CX + GW_HALF} cy={0} r={2.8} fill={l.slot?.color ?? tc.textMuted} />
          </g>
        ))}

        {/* ── tunnel jacks ── */}
        {tunnels.map((s, idx) => {
          const hot = highlightIdx === idx;
          const n = links.filter((l) => l.idx === idx).length;
          const health = latencyHealth(s.latency_ms, s.family);
          const healthColor = health === 'ok' ? tc.ok : health === 'warn' ? tc.warn : tc.err;
          const hist = histRef.current.get(s.ifname) ?? [s.latency_ms];
          const lo = Math.min(...hist), hi = Math.max(...hist);
          const span = Math.max(hi - lo, 1);
          const sparkPts = hist.map((v, i) => {
            const x = TUN_X + TUN_W - 14 - SPARK_W + (i / Math.max(hist.length - 1, 1)) * SPARK_W;
            const y = s.y + 19 - ((v - lo) / span) * SPARK_H;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' ');
          const ripple = lastPatched?.toIdx === idx && pub?.phase === 'ok';
          return (
            <g key={s.ifname} onClick={() => onTunnelClick(idx)} style={{ cursor: selected ? 'pointer' : 'default' }}>
              <rect x={TUN_X} y={s.y - TUN_H / 2} width={TUN_W} height={TUN_H} rx={14}
                fill={hot ? `rgba(${hexRgb(s.color)},0.1)` : surface} stroke={s.color}
                strokeOpacity={s.reachable ? (hot ? 1 : s.active ? 0.9 : 0.5) : 0.25}
                strokeWidth={hot ? 2.2 : s.active ? 1.8 : 1.2}
                filter={hot || s.active ? 'url(#apb-glow)' : undefined}>
                <title>{`${s.ifname} — ${s.reachable ? 'reachable' : 'unreachable'} · ${s.latency_ms} ms · ${s.loss_percent}% loss`}</title>
              </rect>

              {/* load ring — arc share of this branch's apps riding the jack */}
              {n > 0 && (
                <circle cx={TUN_X} cy={s.y} r={15} fill="none" stroke={s.color}
                  strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round"
                  strokeDasharray={`${((n / Math.max(clients.length, 1)) * 2 * Math.PI * 15).toFixed(1)} ${(2 * Math.PI * 15).toFixed(1)}`}
                  transform={`rotate(-90 ${TUN_X} ${s.y})`} />
              )}
              <circle cx={TUN_X} cy={s.y} r={hot ? 12 : 8} fill={surface} stroke={s.color}
                strokeWidth={hot ? 2 : 1.4} strokeOpacity={armed ? 1 : 0.6}
                className={armed && !hot && !reduceMotion ? 'apb-socket' : undefined} />
              {hot && (
                <circle cx={TUN_X} cy={s.y} r={18} fill="none" stroke={s.color} strokeWidth={1.1} strokeDasharray="3 6" opacity={0.9}>
                  {!reduceMotion && <animateTransform attributeName="transform" type="rotate" from={`0 ${TUN_X} ${s.y}`} to={`360 ${TUN_X} ${s.y}`} dur="6s" repeatCount="indefinite" />}
                </circle>
              )}
              {ripple && !reduceMotion && (
                <g key={`rip-${lastPatched?.seq}`}>
                  <circle cx={TUN_X} cy={s.y} r={8} fill="none" stroke={s.color} className="apb-ripple" />
                  <circle cx={TUN_X} cy={s.y} r={8} fill="none" stroke={s.color} className="apb-ripple" style={{ animationDelay: '0.18s' }} />
                </g>
              )}

              <circle cx={TUN_X + 26} cy={s.y - 12} r={3.6} fill={s.reachable ? tc.ok : tc.err} />
              <text x={TUN_X + 38} y={s.y - 8} fontSize="12.5" fontWeight={700} fill={s.color} fontFamily={MONO}>{s.ifname}</text>
              <text x={TUN_X + 38} y={s.y + 12} fontSize="9" fontWeight={700} letterSpacing="0.06em"
                fill={s.family === 'fiber' ? tc.accent : tc.accent2}>
                {s.family === 'fiber' ? 'FIBER' : '5G'}
                <tspan fill={tc.textMuted} fontWeight={500} letterSpacing="0"> · {n} app{n === 1 ? '' : 's'}{s.active ? ' · active' : ''}</tspan>
              </text>
              <text x={TUN_X + TUN_W - 14} y={s.y - 8} textAnchor="end" fontSize="12" fontWeight={600} fill={healthColor} fontFamily={MONO}>
                {s.latency_ms} ms
              </text>
              {hist.length > 1 && (
                <>
                  <polyline points={sparkPts} fill="none" stroke={s.color} strokeOpacity={0.75} strokeWidth={1.2} strokeLinejoin="round" />
                  <circle
                    cx={TUN_X + TUN_W - 14}
                    cy={s.y + 19 - ((hist[hist.length - 1] - lo) / span) * SPARK_H}
                    r={1.8} fill={healthColor}
                  />
                </>
              )}
            </g>
          );
        })}

        {/* ── what-if HUD: latency delta preview while a wire hovers a jack ── */}
        {(() => {
          const activeId = dragId != null && overIdx != null ? dragId : selected?.id;
          const candIdx = dragId != null ? overIdx : selected?.idx;
          if (!activeId || candIdx == null) return null;
          const client = clients.find((c) => c.id === activeId);
          if (!client) return null;
          const fromIdx = slotIdxFor(client);
          if (candIdx === fromIdx) return null;
          const from = tunnels[fromIdx];
          const to = tunnels[candIdx];
          if (!from || !to) return null;
          const delta = Math.round((to.latency_ms - from.latency_ms) * 10) / 10;
          const better = delta < 0;
          const cy = to.y < 100 ? to.y + TUN_H / 2 + 20 : to.y - TUN_H / 2 - 18;
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={TUN_X - 46} y={cy - 12} width={182} height={23} rx={11.5}
                fill={surface} stroke={better ? tc.ok : tc.err} strokeOpacity={0.75} strokeWidth={1.1} />
              <text x={TUN_X - 34} y={cy + 3.5} fontSize="10.5" fontFamily={MONO} fill={tc.textDim}>
                {from.latency_ms} → {to.latency_ms} ms
              </text>
              <text x={TUN_X + 124} y={cy + 3.5} textAnchor="end" fontSize="10.5" fontWeight={700}
                fontFamily={MONO} fill={better ? tc.ok : tc.err}>
                {better ? '' : '+'}{delta} ms
              </text>
            </g>
          );
        })()}

        {/* ── advisor guide: ghost route to the suggested jack ── */}
        {guideClient && guideIdx >= 0 && (() => {
          const t = tunnels[guideIdx];
          const busYT = busYOf(guideClient.y, t.y);
          const ga = wavePath(PORT_X + 2, guideClient.y, GW_CX - GW_HALF, busYT, 0, 0);
          const gb = wavePath(GW_CX + GW_HALF, busYT, TUN_X - PLUG_INSET - 4, t.y, 0, 0);
          return (
            <g style={{ pointerEvents: 'none' }}>
              <path d={ga} fill="none" stroke={tc.accent3} strokeWidth={2} strokeDasharray="7 7"
                strokeLinecap="round" opacity={0.85} className={reduceMotion ? undefined : 'apb-guide'} />
              <path d={gb} fill="none" stroke={tc.accent3} strokeWidth={2} strokeDasharray="7 7"
                strokeLinecap="round" opacity={0.85} className={reduceMotion ? undefined : 'apb-guide'} />
              <polygon points={`${TUN_X - PLUG_INSET - 2},${t.y} ${TUN_X - PLUG_INSET - 13},${t.y - 5.5} ${TUN_X - PLUG_INSET - 13},${t.y + 5.5}`}
                fill={tc.accent3} opacity={0.95} />
            </g>
          );
        })()}

        {/* ── client bubbles ── */}
        {clients.map((c) => {
          const dom = c.domain;
          const domColor = dom === 'IT' ? tc.accent : tc.accent2;
          const label = c.name.length > 15 ? `${c.name.slice(0, 14)}…` : c.name;
          const phase = (idHash(c.id) % 40) / 10;
          const isFrozen = !!frozen[c.id];
          return (
            <g key={c.id}>
              <text x={CL_X - CL_R - 14} y={c.y - 4} textAnchor="end" fontSize="13" fontWeight={600} fill={tc.text}>{label}</text>
              <text x={CL_X - CL_R - 14} y={c.y + 13} textAnchor="end" fontSize="11" fontWeight={600}
                fill={dark ? shade(c.appColor, 0.32) : shade(c.appColor, -0.18)}>{c.appLabel}</text>
              {c.meta && <text x={CL_X - CL_R - 14} y={c.y + 28} textAnchor="end" fontSize="9" fill={tc.textMuted} fontFamily={MONO}>{c.meta}</text>}

              <g key={shake && shake.id === c.id ? `shake-${shake.n}` : 'calm'}
                className={shake?.id === c.id && !reduceMotion ? 'apb-shake' : undefined}>
              {!reduceMotion && (
                <circle cx={CL_X} cy={c.y} r={30} fill={`url(#apb-halo-${dom})`} className="apb-halo"
                  style={{ pointerEvents: 'none', transformBox: 'fill-box', transformOrigin: 'center', animationDelay: `-${phase}s` }} />
              )}
              {/* activity ring — slow rotating dashes say "client alive" */}
              <circle cx={CL_X} cy={c.y} r={CL_R + 6} fill="none" stroke={domColor}
                strokeOpacity={0.32} strokeWidth={1.1} strokeDasharray="3 9"
                className={reduceMotion ? undefined : 'apb-ring'}
                style={reduceMotion ? { pointerEvents: 'none' } : { pointerEvents: 'none', transformBox: 'fill-box', transformOrigin: 'center', animationDelay: `-${phase * 3}s` }} />
              {/* glass sphere — grabbable: dragging from the bubble picks up its wire */}
              <circle cx={CL_X} cy={c.y} r={CL_R} fill={`url(#apb-sphere-${dom})`}
                stroke={isFrozen ? tc.accent3 : domColor} strokeWidth={1.5} strokeOpacity={0.9}
                strokeDasharray={isFrozen ? '5 5' : undefined}
                className={reduceMotion ? undefined : 'apb-breathe'}
                onPointerDown={(e) => startDrag(e, c.id)}
                style={{
                  cursor: isFrozen ? 'not-allowed' : dragId === c.id ? 'grabbing' : 'grab',
                  ...(reduceMotion ? {} : { transformBox: 'fill-box' as const, transformOrigin: 'center', animationDelay: `-${phase}s` }),
                }}>
                <title>{isFrozen
                  ? `${c.name} · ${dom} client · ${c.appLabel} — routing frozen`
                  : `${c.name} · ${dom} client · ${c.appLabel} — drag onto a tunnel to re-route`}</title>
              </circle>
              {/* soft specular highlight (gradient, not a sticker) */}
              <circle cx={CL_X - 8} cy={c.y - 9} r={9} fill="url(#apb-spec)" opacity={0.6} style={{ pointerEvents: 'none' }} />
              <foreignObject x={CL_X - 9} y={c.y - 9} width={18} height={18} style={{ pointerEvents: 'none' }}>
                <div style={{ color: domColor, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><c.DevIcon size={15} /></div>
              </foreignObject>

              {/* app badge — fixed at lower-right (never wanders into labels), gentle bob */}
              <g className={reduceMotion ? undefined : 'apb-bob'}
                style={reduceMotion ? { pointerEvents: 'none' } : { pointerEvents: 'none', animationDelay: `-${phase / 2}s` }}>
                <circle cx={CL_X + 17} cy={c.y + 17} r={10} fill={surface} stroke={c.appColor} strokeWidth={1.4} />
                <circle cx={CL_X + 17} cy={c.y + 17} r={10} fill={`rgba(${hexRgb(c.appColor)},${dark ? 0.26 : 0.16})`} />
                <foreignObject x={CL_X + 17 - 6} y={c.y + 17 - 6} width={12} height={12}>
                  <div style={{ color: c.appColor, height: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><c.AppIcon size={10} /></div>
                </foreignObject>
              </g>

              {/* fixed wire port on the rim */}
              <circle cx={PORT_X} cy={c.y} r={3} fill={domColor} />
              </g>

              {/* freeze toggle — locks this client's routing (OFF by default) */}
              <g role="button" tabIndex={0} aria-pressed={isFrozen}
                aria-label={`${isFrozen ? 'Unfreeze' : 'Freeze'} routing for ${c.name}`}
                onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onClick={(e) => { e.stopPropagation(); toggleFreeze(c.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFreeze(c.id); } }}
                style={{ cursor: 'pointer', outlineOffset: 2 }}>
                <circle cx={CL_X - 17} cy={c.y - 17} r={9} fill={surface}
                  stroke={isFrozen ? tc.accent3 : tc.textMuted}
                  strokeOpacity={isFrozen ? 1 : 0.5} strokeWidth={isFrozen ? 1.6 : 1.1} />
                {isFrozen && <circle cx={CL_X - 17} cy={c.y - 17} r={9} fill={`rgba(${hexRgb(tc.accent3)},0.2)`} />}
                <foreignObject x={CL_X - 22} y={c.y - 22} width={10} height={10} style={{ pointerEvents: 'none' }}>
                  <div style={{ color: isFrozen ? tc.accent3 : tc.textMuted, opacity: isFrozen ? 1 : 0.7, height: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isFrozen ? <Lock size={8} /> : <Unlock size={8} />}
                  </div>
                </foreignObject>
                <title>{isFrozen ? `Routing frozen for ${c.name} — click to unfreeze` : `Freeze routing for ${c.name}`}</title>
              </g>
            </g>
          );
        })}

        {/* ── plugs (top layer; group is translated by the wave engine) ── */}
        {links.map((l) => {
          const plugColor = l.slot?.color ?? tc.textMuted;
          const isSel = selected?.id === l.c.id;
          const dragging = dragId === l.c.id;
          return (
            <g key={`p-${l.c.id}`} ref={(el) => { ensureEls(l.c.id).plug = el; }}
              className="apb-dimmable" opacity={trafficOpacity(l.c.id)}
              style={{ cursor: dragging ? 'grabbing' : 'grab' }} onPointerDown={(e) => startDrag(e, l.c.id)}>
              <circle cx={l.tx} cy={l.ty} r={7.5} fill={surface} stroke={plugColor} strokeWidth={isSel || dragging ? 2.4 : 1.8}
                filter={dragging || isSel ? 'url(#apb-glow)' : undefined} />
              <circle cx={l.tx} cy={l.ty} r={3} fill={plugColor} />
              <circle cx={l.tx} cy={l.ty} r={22} fill="transparent" tabIndex={0} role="button"
                aria-label={`Re-patch ${l.c.appLabel} for ${l.c.name}; currently on ${l.slot?.ifname ?? 'no tunnel'}. Enter to pick up, arrows to choose, Enter to confirm, Escape to cancel.`}
                onKeyDown={(e) => onPlugKey(e, l.c)} style={{ outlineOffset: 3 }} />
            </g>
          );
        })}

        {extraCount > 0 && (
          <text x={CL_X - CL_R} y={H - 8} fontSize="10" fill={tc.textMuted}>+{extraCount} more client{extraCount === 1 ? '' : 's'}</text>
        )}
      </svg>

      {/* ── AI route advisor ── */}
      <button
        data-route-advisor-trigger
        onClick={() => (advisor.open ? (setAdvisor((a) => ({ ...a, open: false })), setGuide(null)) : void runAdvisor())}
        title="Compare tunnels and suggest better routes"
        style={{
          position: 'absolute', top: 0, right: 0, zIndex: 6,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11.5, padding: '5px 10px', borderRadius: 9,
          color: advisor.open ? 'var(--text)' : 'var(--text-dim)',
          ...(externalAdvisorTrigger ? { display: 'none' } : {}),
        }}
      >
        <Sparkles size={13} style={{ color: tc.accent3 }} /> AI advisor
      </button>
      {advisor.open && advisorHost && createPortal(
        <div role="region" aria-label="AI route advisor" style={{
          position: externalAdvisorTrigger ? 'relative' : 'absolute',
          top: externalAdvisorTrigger ? 'auto' : 32,
          right: externalAdvisorTrigger ? 'auto' : 0,
          width: externalAdvisorTrigger ? '100%' : 330,
          zIndex: 6,
          background: dark ? 'rgba(18,16,38,0.97)' : '#ffffff',
          border: '1px solid var(--border)', borderRadius: 12, padding: 12,
          boxShadow: '0 14px 34px rgba(0,0,0,0.4)',
          maxHeight: 330, overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Sparkles size={13} style={{ color: tc.accent3 }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Route advisor</span>
            {advisor.mode && !advisor.loading && (
              <span className="badge" style={{ fontSize: 9.5 }}>
                {advisor.mode === 'ai' ? 'bedrock' : advisor.mode}
              </span>
            )}
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
              <button onClick={() => void runAdvisor()} title="Re-run analysis" disabled={advisor.loading}
                style={{ padding: '3px 6px', borderRadius: 7, display: 'inline-flex' }}>
                <RefreshCw size={12} className={advisor.loading && !reduceMotion ? 'apb-spin' : undefined} />
              </button>
              <button onClick={() => { setAdvisor((a) => ({ ...a, open: false })); setGuide(null); }} title="Close"
                style={{ padding: '3px 6px', borderRadius: 7, display: 'inline-flex' }}>
                <X size={12} />
              </button>
            </span>
          </div>

          {advisor.loading ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '10px 0' }}>
              Comparing live tunnel metrics against each application's route…
            </div>
          ) : (
            <>
              {advisor.note && (
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 8 }}>{advisor.note}</div>
              )}
              {advisor.suggestions.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)', padding: '6px 0' }}>
                  Routing already looks optimal — every application is on its best reachable tunnel.
                </div>
              ) : advisor.suggestions.map((s, i) => {
                const client = clients.find((c) => c.id === s.client_id);
                const toIdx = tunnels.findIndex((t) => t.ifname === s.to_tunnel);
                const blocked = !client || toIdx < 0 || !!(client && frozen[client.id]);
                const active = guide?.clientId === s.client_id && guide?.toIfname === s.to_tunnel;
                const better = s.expected_gain_ms > 0;
                return (
                  <div key={`${s.client_id}-${s.to_tunnel}`} style={{
                    border: '1px solid', borderColor: active ? tc.accent3 : 'var(--border)',
                    background: active ? `rgba(${hexRgb(tc.accent3)},0.07)` : 'transparent',
                    borderRadius: 10, padding: '8px 10px', marginTop: i === 0 ? 0 : 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{s.client_name}</span>
                      <span style={{ fontSize: 10.5, color: client ? (dark ? shade(client.appColor, 0.32) : shade(client.appColor, -0.18)) : 'var(--text-dim)' }}>{s.app}</span>
                      <span title="net gain — measured latency plus modeled load"
                        style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, fontFamily: MONO, color: better ? 'var(--ok)' : 'var(--warn)' }}>
                        {better ? `−${s.expected_gain_ms} ms` : s.expected_gain_ms === 0 ? 'reliability' : `+${-s.expected_gain_ms} ms`}
                      </span>
                    </div>
                    <div style={{ fontSize: 10.5, fontFamily: MONO, color: 'var(--text-dim)', marginTop: 2 }}>
                      {s.from_tunnel} → {s.to_tunnel}
                      {typeof s.from_apps === 'number' && typeof s.to_apps === 'number' && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {' '}· load {s.from_apps} app{s.from_apps === 1 ? '' : 's'} → joins {s.to_apps}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{s.reason}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                      {blocked ? (
                        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Lock size={10} /> {client ? 'frozen — unfreeze to apply' : 'no longer on the board'}
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => { setSelected(null); setGuide(active ? null : { clientId: s.client_id, toIfname: s.to_tunnel }); }}
                            style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 7 }}>
                            {active ? 'Hide guide' : 'Guide me'}
                          </button>
                          <button className="primary" onClick={() => applySuggestion(s)}
                            style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 7 }}>
                            Apply
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>, advisorHost
      )}

      {/* ── wire-tap console ── */}
      <div role="status" aria-live="polite" style={{ marginTop: 8, borderTop: '1px dashed var(--border)', paddingTop: 8, fontFamily: MONO, fontSize: 11, lineHeight: 1.65, minHeight: 74 }}>
        {!pub ? (
          <div style={{ color: 'var(--text-muted)' }}>
            ▍wire-tap · grab a wire, plug, or bubble and patch it into another tunnel — the change is encoded as proto3{' '}
            <span style={{ color: 'var(--text-dim)' }}>AppRouteCommand</span> and published to{' '}
            <span style={{ color: 'var(--text-dim)' }}>{source ?? 'rdk'}/approute/control</span>
          </div>
        ) : (
          <div key={pub.seq}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>Δ {pub.label}</span>
              <span style={{ marginLeft: 'auto', color:
                pub.phase === 'ok' ? 'var(--ok)' : pub.phase === 'publishing' ? 'var(--text-dim)'
                : pub.phase === 'nolive' ? 'var(--text-muted)' : pub.phase === 'offline' ? 'var(--warn)' : 'var(--err)' }}>
                {pub.phase === 'publishing' && '… publishing'}
                {pub.phase === 'ok' && `✓ published · ${pub.topic} · qos1 · ${pub.bytes} B`}
                {pub.phase === 'offline' && `⚠ broker offline — encoded ${pub.bytes} B`}
                {pub.phase === 'nolive' && `encoded ${pub.bytes} B — no live gateway`}
                {pub.phase === 'error' && `✗ ${pub.error ?? 'publish failed'}`}
              </span>
            </div>
            <div title={pub.json} style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>json {pub.json}</div>
            <div style={{ color: 'var(--text-dim)', maxHeight: 34, overflow: 'hidden' }}>
              <span style={{ color: 'var(--text-muted)' }}>proto3 </span>
              {pub.hex.split(' ').map((b, i) => (
                <span key={i} className={reduceMotion ? undefined : 'apb-hex'} style={reduceMotion ? undefined : { animationDelay: `${Math.min(i * 11, 900)}ms` }}>{b}{' '}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* legend + provenance */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
        <LegendDot color={tc.accent} label="fiber jack" />
        <LegendDot color={tc.accent2} label="5G jack" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 16, height: 2, borderRadius: 2, background: `linear-gradient(90deg, #E50914, ${tc.accent})` }} />
          wire = app's brand colour · packets re-color through the gateway · speed = live latency
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Lock size={10} /> freeze locks a client's routing
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          <span className="badge" title="where the tunnel list comes from">tunnels: {sourceChip(tunnelSource)}</span>
          <span className="badge" title="where the client bindings come from">clients: {sourceChip(clientSource)} · {fleetLabel}</span>
        </span>
      </div>

      <style>{`
        .apb-halo { animation: apbHalo 4.4s ease-in-out infinite; }
        @keyframes apbHalo { 0%,100% { transform: scale(0.9); opacity: .35 } 50% { transform: scale(1.12); opacity: .6 } }
        .apb-breathe { animation: apbBreathe 4.8s ease-in-out infinite; }
        @keyframes apbBreathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.035) } }
        .apb-ring { animation: apbRing 26s linear infinite; }
        @keyframes apbRing { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .apb-bob { animation: apbBob 3.4s ease-in-out infinite; }
        @keyframes apbBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2.5px) } }
        .apb-socket { animation: apbSocket 1.5s ease-in-out infinite; }
        @keyframes apbSocket { 0%,100% { stroke-opacity: .45 } 50% { stroke-opacity: 1 } }
        .apb-ripple { animation: apbRipple .9s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        @keyframes apbRipple { from { r: 8; stroke-opacity: .8; stroke-width: 2 } to { r: 34; stroke-opacity: 0; stroke-width: .5 } }
        .apb-flash { animation: apbFlash 1.2s ease-out; }
        @keyframes apbFlash { 0% { filter: drop-shadow(0 0 6px currentColor) } 100% { } }
        .apb-hex { opacity: 0; animation: apbHexIn .45s ease forwards; }
        @keyframes apbHexIn { to { opacity: 1 } }
        .apb-dimmable { transition: opacity 180ms ease; }
        .apb-shake { animation: apbShake .32s ease; }
        @keyframes apbShake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-3px) } 60% { transform: translateX(3px) } }
        .apb-guide { animation: apbGuide .9s linear infinite; }
        @keyframes apbGuide { to { stroke-dashoffset: -14; } }
        .apb-spin { animation: apbSpin 1s linear infinite; }
        @keyframes apbSpin { to { transform: rotate(360deg) } }
        @media (prefers-reduced-motion: reduce) {
          .apb-halo, .apb-breathe, .apb-ring, .apb-bob, .apb-socket, .apb-ripple, .apb-flash, .apb-shake, .apb-guide, .apb-spin { animation: none !important; }
          .apb-hex { opacity: 1; animation: none !important; }
          .apb-dimmable { transition: none !important; }
        }
      `}</style>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />{label}
    </span>
  );
}
