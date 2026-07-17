/**
 * Application Steering Patchboard — clients (left) each carry one application
 * as a floating glass bubble with an orbiting app moon; IPsec tunnels (right)
 * are jacks with live latency + a rolling sparkline. Every client hangs off a
 * living patch wire: a bezier with a traveling sine ripple, along which packet
 * dots flow at a speed inversely proportional to the tunnel's latency (fiber
 * visibly streams faster than 5G — the motion encodes state).
 *
 * Re-patching (drag the wire/plug/bubble onto another jack, click-then-click,
 * or keyboard) encodes a proto3 AppRouteCommand (proto/app_route.proto) and
 * publishes it to `<source>/approute/control` via POST /api/approute/publish.
 * The wire-tap console shows the exact JSON → proto3 hex → topic.
 *
 * DATA SOURCES (best available wins, per branch):
 *   • AAR feed (proto/aar.proto, routing/*): tunnels from routing/tunnel,
 *     current bindings from routing/decision (McKinney/prpl only).
 *   • else <source>/ipsec/metrics tunnels + policy-preview bindings.
 *   • else a clearly-labelled simulated board.
 * Location scoping stays STRICT — Plano (rdk) and McKinney (prpl) never mix.
 *
 * PERFORMANCE: wave geometry, packets, and the dragged plug are animated by a
 * single rAF loop that writes SVG attributes imperatively through refs — no
 * React re-render per frame or per pointer-move. React state changes only on
 * drop-target changes, commits, and feed updates. Reduced motion renders
 * static beziers (no wave/packets/orbit) with every interaction intact.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Laptop, Monitor, Printer, CreditCard, Server, PhoneCall,
  Flame, Wind, DoorClosed, Smartphone, Tablet, Cpu, Plug, HelpCircle,
  Video, Clapperboard, Mail, Briefcase, Globe, Activity, Gauge,
} from 'lucide-react';
import type { Device, IpsecTunnelMetric, AppCategoryId } from '../../types';
import { useIpsecMetrics } from '../../ui/useIpsecMetrics';
import { useDevices } from '../../ui/useDevices';
import { useAarRouting } from '../../ui/useAarRouting';
import { useTheme, useThemeColors } from '../../ui/Theme';
import { useToast } from '../../ui/Toast';
import { BRANCH_TO_IPSEC_SOURCE, appCategories } from '../../data/mock';
import { encodeAppRouteCommand, toHex, type AppRouteCommand } from '../../proto/appRoute';

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

interface AppDef { name: string; cat: AppCategoryId; icon: React.ComponentType<{ size?: number }>; }

const IT_APPS: AppDef[] = [
  { name: 'Microsoft Teams', cat: 'video',    icon: Video },
  { name: 'Netflix',         cat: 'video',    icon: Clapperboard },
  { name: 'Microsoft 365',   cat: 'business', icon: Mail },
  { name: 'VoIP',            cat: 'voice',    icon: PhoneCall },
  { name: 'Salesforce',      cat: 'business', icon: Briefcase },
  { name: 'Web browsing',    cat: 'web',      icon: Globe },
];
const OT_APPS: AppDef[] = [
  { name: 'OT Telemetry',  cat: 'iot',      icon: Activity },
  { name: 'POS Payments',  cat: 'business', icon: CreditCard },
  { name: 'Sensor Stream', cat: 'iot',      icon: Gauge },
];

function catColor(id: AppCategoryId): string {
  return appCategories.find((c) => c.id === id)?.color ?? '#a855f7';
}
function hexRgb(hex: string): string {
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
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
 * Base curve: cubic bezier with horizontal tangents (the Android-Studio wire).
 * Live wires get a perpendicular traveling sine ripple, tapered to zero at
 * both ends so the anchors never tear. Sampled as a polyline (28 segments is
 * visually indistinguishable from a true curve at this scale). */

const SAMPLES = 28;

function bezierPoint(t: number, x0: number, y0: number, cx1: number, cy1: number, cx2: number, cy2: number, x1: number, y1: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * x0 + b * cx1 + c * cx2 + d * x1, a * y0 + b * cy1 + c * cy2 + d * y1];
}

/** Build the waved path. `phase` advances with time; amp 0 = plain bezier. */
function wavePath(sx: number, sy: number, ex: number, ey: number, amp: number, phase: number, sag = 0): string {
  const k = Math.max(60, Math.min(180, Math.abs(ex - sx) * 0.45));
  const cx1 = sx + k, cy1 = sy + sag, cx2 = ex - k, cy2 = ey + sag;
  const dist = Math.hypot(ex - sx, ey - sy);
  const waves = Math.max(2, Math.min(5, dist / 110));
  let d = `M ${sx.toFixed(1)} ${sy.toFixed(1)}`;
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const [px, py] = bezierPoint(t, sx, sy, cx1, cy1, cx2, cy2, ex, ey);
    // Perpendicular direction from a small forward difference.
    const [qx, qy] = bezierPoint(Math.min(1, t + 0.02), sx, sy, cx1, cy1, cx2, cy2, ex, ey);
    const dx = qx - px, dy = qy - py;
    const len = Math.hypot(dx, dy) || 1;
    const off = amp * Math.sin(2 * Math.PI * waves * t - phase) * Math.sin(Math.PI * t);
    d += ` L ${(px + (-dy / len) * off).toFixed(1)} ${(py + (dx / len) * off).toFixed(1)}`;
  }
  return d;
}

/** Point on the plain bezier at t (packets ride the base curve). */
function basePoint(t: number, sx: number, sy: number, ex: number, ey: number, sag = 0): [number, number] {
  const k = Math.max(60, Math.min(180, Math.abs(ex - sx) * 0.45));
  return bezierPoint(t, sx, sy, sx + k, sy + sag, ex - k, ey + sag, ex, ey);
}

/* ───────── geometry (compact) ───────── */

const W = 760, H = 392;
const CL_X = 120, CL_R = 22;
const PORT_X = CL_X + CL_R;
const TUN_X = 508, TUN_W = 214, TUN_H = 56;
const PLUG_INSET = 6;
const SPARK_W = 54, SPARK_H = 12, SPARK_N = 24;

interface SelectState { id: string; idx: number }
interface PubState {
  seq: number;
  phase: 'publishing' | 'ok' | 'offline' | 'error' | 'nolive';
  label: string; json: string; hex: string; bytes: number; topic: string; error?: string;
}
interface WireEls {
  grad: SVGLinearGradientElement | null;
  glow: SVGPathElement | null;
  body: SVGPathElement | null;
  hit: SVGPathElement | null;
  plug: SVGGElement | null;
  packets: (SVGCircleElement | null)[];
}
interface LinkGeom {
  id: string; idx: number; sx: number; sy: number;
  tx: number; ty: number;            // committed socket end
  color: string; slotColor: string; latency: number; family: TunnelFamily; hasSlot: boolean;
  phase0: number;
}

/* ───────── component ───────── */

export function AppSteeringPatchboard({ branchId }: { branchId: string }) {
  const tc = useThemeColors();
  const { theme } = useTheme();
  const ipsec = useIpsecMetrics();
  const aar = useAarRouting();
  const { devices: allDevices } = useDevices();
  const { push } = useToast();
  const dark = theme === 'dark';
  const surface = dark ? 'rgba(16,14,34,0.96)' : '#ffffff';

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

  const source = BRANCH_TO_IPSEC_SOURCE[branchId] as 'rdk' | 'prpl' | undefined;
  const gw = useMemo(
    () => (source ? ipsec.list.find((g) => g.source === source) : undefined),
    [ipsec.list, source],
  );

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const aarEligible = source === AAR_BRANCH_SOURCE || source === undefined;
  const aarLive = aarEligible && aar.receivedAt > 0;

  /* ── Tunnels: AAR → ipsec → sim (sim gets a gentle deterministic jitter so
   *    the sparkline + packet speeds breathe in demos — still labelled sim). ── */
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
      return { ...t, family, y: n <= 1 ? H / 2 : 62 + i * ((H - 128) / (n - 1)), color: family === 'fiber' ? tc.accent : tc.accent2 };
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
    const mine = source ? allDevices.filter((d) => d.locationSource === source) : [];
    const place = (rows: Omit<PatchClient, 'y'>[]): PatchClient[] => {
      const n = rows.length;
      return rows.map((r, i) => ({ ...r, y: n <= 1 ? H / 2 : 54 + i * ((H - 108) / (n - 1)) }));
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
        DevIcon: kindIcon[d.kind] ?? HelpCircle, domain: d.domain, appColor: catColor(app.cat),
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
      DevIcon: kindIcon[c.kind] ?? HelpCircle, domain: c.domain, appColor: catColor(c.app.cat),
    }));
    return { clients: place(rows), clientSource: 'sim' as const, extraCount: 0 };
  }, [aarLive, aar.decisions, allDevices, source]);

  const slotIdxFor = (c: PatchClient): number => {
    const ov = overrides[c.id];
    if (ov) { const i = tunnels.findIndex((s) => s.ifname === ov); if (i >= 0) return i; }
    if (c.currentIfname) { const i = tunnels.findIndex((s) => s.ifname === c.currentIfname); if (i >= 0) return i; }
    return defaultSlotIdx(c, tunnels);
  };

  /* ───────── commit + publish (unchanged pipeline) ───────── */

  function commitPatch(client: PatchClient, targetIdx: number) {
    const fromIdx = slotIdxFor(client);
    if (targetIdx < 0 || targetIdx >= tunnels.length || targetIdx === fromIdx) return;
    const from = tunnels[fromIdx];
    const to = tunnels[targetIdx];

    setOverrides((prev) => ({ ...prev, [client.id]: to.ifname }));

    const cmd: AppRouteCommand = {
      timestamp_ms: Date.now(),
      source: source ?? 'sim',
      gateway: gw?.metrics.gateway.name ?? 'gateway',
      changes: [{
        client_mac: client.id,
        client_name: client.name,
        current: { application: client.app, tunnel: from.ifname },
        desired: { application: client.app, tunnel: to.ifname },
      }],
    };
    const bytes = encodeAppRouteCommand(cmd);
    const seq = ++seqRef.current;
    setLastPatched({ id: client.id, seq, toIdx: targetIdx });

    const base: Omit<PubState, 'phase'> = {
      seq,
      label: `${client.name} · ${client.appLabel} · ${from.ifname} → ${to.ifname}`,
      json: JSON.stringify(cmd),
      hex: toHex(bytes),
      bytes: bytes.length,
      topic: `${source ?? 'sim'}/approute/control`,
    };

    if (!source) {
      setPub({ ...base, phase: 'nolive' });
      push({ kind: 'info', title: 'Route encoded (not published)', detail: 'This branch has no live gateway — proto3 payload shown in the wire-tap console.' });
      return;
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
          push({ kind: 'success', title: `Route published — ${client.appLabel} → ${to.ifname}`, detail: `${bytes.length} B proto3 on ${base.topic} (qos1)` });
        } else if (res.status === 503 && data?.offline) {
          setPub({ ...base, phase: 'offline', error: data.error });
          push({ kind: 'warn', title: 'Broker offline — route encoded, not delivered', detail: data.error });
        } else {
          setPub({ ...base, phase: 'error', error: data?.error ?? `HTTP ${res.status}` });
          push({ kind: 'error', title: 'Route publish failed', detail: data?.error ?? `HTTP ${res.status}` });
        }
      } catch (err) {
        if (seqRef.current !== seq) return;
        const msg = err instanceof Error ? err.message : String(err);
        setPub({ ...base, phase: 'error', error: msg });
        push({ kind: 'error', title: 'Route publish failed', detail: msg });
      }
    })();
  }

  /* ───────── pointer plumbing ───────── */

  function toSvgXY(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
  }

  // Generous drop zone: anywhere from just right of mid-board over a jack row.
  function hitTunnel(x: number, y: number): number | null {
    if (x < TUN_X - 110 || x > TUN_X + TUN_W + 20) return null;
    const i = tunnels.findIndex((s) => Math.abs(y - s.y) <= TUN_H / 2 + 18);
    return i >= 0 ? i : null;
  }

  function startDrag(e: React.PointerEvent, id: string) {
    e.preventDefault();
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
    setOverIdx((prev) => (prev === over ? prev : over)); // re-render only on change
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

  // Escape cancels a drag even when focus is elsewhere.
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

  const highlightIdx = overIdx ?? (selected ? selected.idx : null);
  const armed = dragId != null || selected != null;

  const links = clients.map((c, i) => {
    const idx = slotIdxFor(c);
    const slot = idx >= 0 ? tunnels[idx] : null;
    return {
      c, i, idx, slot,
      sx: PORT_X + 2, sy: c.y,
      tx: TUN_X - PLUG_INSET, ty: slot?.y ?? c.y,
      pulsing: lastPatched?.id === c.id,
      h: idHash(c.id),
    };
  });

  // Geometry snapshot for the rAF loop (it never touches React state).
  linksRef.current = links.map((l) => ({
    id: l.c.id, idx: l.idx, sx: l.sx, sy: l.sy, tx: l.tx, ty: l.ty,
    color: l.c.appColor, slotColor: l.slot?.color ?? tc.textMuted,
    latency: l.slot?.latency_ms ?? 30, family: l.slot?.family ?? 'fiber', hasSlot: !!l.slot,
    phase0: (l.h % 100) / 100 * Math.PI * 2,
  }));

  /* ───────── the wave engine ───────── */

  useEffect(() => {
    if (reduceMotion) return;
    let raf = 0;
    const tick = () => {
      const now = performance.now() / 1000;
      const d = dragRef.current;
      for (const g of linksRef.current) {
        const els = wireEls.current.get(g.id);
        if (!els) continue;
        const dragging = d?.id === g.id && d.moved;
        // Endpoint: pointer while dragging (snapping onto a hovered socket),
        // else the committed socket. The plug eases toward it every frame.
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

        const sag = dragging ? Math.min(46, Math.hypot(p.x - g.sx, p.y - g.sy) * 0.1) : 0;
        const amp = dragging ? 3.8 : 2.4;
        const phase = now * 2.6 + g.phase0;
        const path = wavePath(g.sx, g.sy, p.x, p.y, amp, phase, sag);
        els.body?.setAttribute('d', path);
        els.glow?.setAttribute('d', path);
        els.hit?.setAttribute('d', path);
        els.grad?.setAttribute('x2', String(p.x));
        els.grad?.setAttribute('y2', String(p.y));
        els.plug?.setAttribute('transform', `translate(${p.x - g.tx} ${p.y - g.ty})`);

        // Packets ride the base curve; speed falls with latency (state → motion).
        const speed = Math.max(0.10, Math.min(0.7, 26 / (g.latency + 8)));
        els.packets.forEach((pk, i) => {
          if (!pk) return;
          if (dragging || !g.hasSlot) { pk.setAttribute('opacity', '0'); return; }
          const t = (now * speed + i / els.packets.length + g.phase0) % 1;
          const [px, py] = basePoint(t, g.sx, g.sy, p.x, p.y, sag);
          pk.setAttribute('cx', px.toFixed(1));
          pk.setAttribute('cy', py.toFixed(1));
          // Hide right at the endpoints so packets appear to enter/leave the nodes.
          pk.setAttribute('opacity', t < 0.05 || t > 0.95 ? '0' : '0.9');
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
    if (!e) { e = { grad: null, glow: null, body: null, hit: null, plug: null, packets: [] }; wireEls.current.set(id, e); }
    return e;
  };

  const sourceChip = (s: string) =>
    s === 'aar' ? 'live · routing/*'
      : s === 'ipsec' ? `live · ${source}/ipsec/metrics`
        : s === 'devices' ? 'live · device inventory'
          : 'simulated';
  const fleetLabel = source ? (LOCATION_LABEL[source] ?? source) : 'demo';

  /* ───────── render ───────── */

  return (
    <div style={{ position: 'relative', maxWidth: W, margin: '0 auto' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        role="application"
        aria-label="Application steering patchboard: drag a client's wire onto a tunnel to re-route its application"
        onPointerMove={onSvgMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onKeyDown={(e) => { if (e.key === 'Escape') { setSelected(null); cancelDrag(); } }}
      >
        <defs>
          <filter id="apb-glow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="4.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {(['IT', 'OT'] as const).map((dom) => {
            const rgb = hexRgb(dom === 'IT' ? tc.accent : tc.accent2);
            return (
              <g key={dom}>
                <radialGradient id={`apb-sphere-${dom}`} cx="36%" cy="30%" r="72%">
                  <stop offset="0%" stopColor={`rgba(255,255,255,${dark ? 0.9 : 0.98})`} />
                  <stop offset="24%" stopColor={`rgba(${rgb},${dark ? 0.6 : 0.5})`} />
                  <stop offset="62%" stopColor={`rgba(${rgb},${dark ? 0.26 : 0.3})`} />
                  <stop offset="100%" stopColor={`rgba(${rgb},${dark ? 0.1 : 0.16})`} />
                </radialGradient>
                <radialGradient id={`apb-halo-${dom}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={`rgba(${rgb},0.5)`} />
                  <stop offset="100%" stopColor={`rgba(${rgb},0)`} />
                </radialGradient>
              </g>
            );
          })}
          {links.map((l) => (
            <linearGradient key={l.i} id={`apb-w-${l.i}`} gradientUnits="userSpaceOnUse"
              ref={(el) => { ensureEls(l.c.id).grad = el; }}
              x1={l.sx} y1={l.sy} x2={l.tx} y2={l.ty}>
              <stop offset="0%" stopColor={l.c.appColor} stopOpacity={0.95} />
              <stop offset="100%" stopColor={l.slot?.color ?? l.c.appColor} stopOpacity={0.95} />
            </linearGradient>
          ))}
        </defs>

        {/* eyebrows */}
        <text x={CL_X - CL_R} y={26} fontSize="9.5" fontWeight={700} letterSpacing="0.14em" fill={tc.textMuted}>CLIENTS · ONE APP EACH</text>
        <text x={TUN_X} y={26} fontSize="9.5" fontWeight={700} letterSpacing="0.14em" fill={tc.textMuted}>IPSEC TUNNELS</text>

        {/* ── wires (rAF-driven waved paths; initial d is the static bezier) ── */}
        {links.map((l) => {
          const dragging = dragId === l.c.id;
          const initial = wavePath(l.sx, l.sy, l.tx, l.ty, 0, 0);
          const packetCount = l.slot?.family === 'fiber' ? 3 : 2;
          return (
            <g key={`w-${l.c.id}`}>
              {/* committed-socket ghost while its plug is in hand */}
              {dragging && l.slot && (
                <path d={initial} fill="none" stroke={tc.textMuted} strokeOpacity={0.2} strokeWidth={1.2} strokeDasharray="4 8" />
              )}
              <path ref={(el) => { ensureEls(l.c.id).glow = el; }} d={initial} fill="none"
                stroke={`url(#apb-w-${l.i})`} strokeOpacity={dragging ? 0.3 : 0.15} strokeWidth={6} strokeLinecap="round" />
              <path ref={(el) => { ensureEls(l.c.id).body = el; }} d={initial} fill="none"
                stroke={`url(#apb-w-${l.i})`} strokeWidth={dragging ? 2.6 : 2} strokeLinecap="round"
                className={l.pulsing ? 'apb-flash' : undefined} />
              {/* packets — animated by the wave engine */}
              {!reduceMotion && Array.from({ length: packetCount }, (_, pi) => (
                <circle key={pi} r={2.1} fill={l.slot?.color ?? l.c.appColor} opacity={0}
                  ref={(el) => { ensureEls(l.c.id).packets[pi] = el; }} style={{ pointerEvents: 'none' }} />
              ))}
              {/* grab the wire anywhere along its length */}
              <path ref={(el) => { ensureEls(l.c.id).hit = el; }} d={initial} fill="none"
                stroke="transparent" strokeWidth={18} strokeLinecap="round"
                style={{ cursor: dragging ? 'grabbing' : 'grab', pointerEvents: 'stroke' }}
                onPointerDown={(e) => startDrag(e, l.c.id)} />
            </g>
          );
        })}

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
            const y = s.y + 17 - ((v - lo) / span) * SPARK_H;
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

              {/* socket + drop affordances */}
              <circle cx={TUN_X} cy={s.y} r={hot ? 12 : 8} fill={surface} stroke={s.color}
                strokeWidth={hot ? 2 : 1.4} strokeOpacity={armed ? 1 : 0.6}
                className={armed && !hot && !reduceMotion ? 'apb-socket' : undefined} />
              {hot && (
                <circle cx={TUN_X} cy={s.y} r={18} fill="none" stroke={s.color} strokeWidth={1.1} strokeDasharray="3 6" opacity={0.9}>
                  {!reduceMotion && <animateTransform attributeName="transform" type="rotate" from={`0 ${TUN_X} ${s.y}`} to={`360 ${TUN_X} ${s.y}`} dur="6s" repeatCount="indefinite" />}
                </circle>
              )}
              {/* publish success ripple */}
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
              {/* rolling latency sparkline */}
              {hist.length > 1 && (
                <>
                  <polyline points={sparkPts} fill="none" stroke={s.color} strokeOpacity={0.75} strokeWidth={1.2} strokeLinejoin="round" />
                  <circle
                    cx={TUN_X + TUN_W - 14}
                    cy={s.y + 17 - ((hist[hist.length - 1] - lo) / span) * SPARK_H}
                    r={1.8} fill={healthColor}
                  />
                </>
              )}
            </g>
          );
        })}

        {/* ── client bubbles ── */}
        {clients.map((c) => {
          const dom = c.domain;
          const domColor = dom === 'IT' ? tc.accent : tc.accent2;
          const label = c.name.length > 15 ? `${c.name.slice(0, 14)}…` : c.name;
          const phase = (idHash(c.id) % 40) / 10;
          return (
            <g key={c.id}>
              <text x={CL_X - CL_R - 12} y={c.y - 4} textAnchor="end" fontSize="12.5" fontWeight={600} fill={tc.text}>{label}</text>
              <text x={CL_X - CL_R - 12} y={c.y + 12} textAnchor="end" fontSize="10.5" fontWeight={600} fill={c.appColor}>{c.appLabel}</text>
              {c.meta && <text x={CL_X - CL_R - 12} y={c.y + 26} textAnchor="end" fontSize="9" fill={tc.textMuted} fontFamily={MONO}>{c.meta}</text>}

              {!reduceMotion && (
                <circle cx={CL_X} cy={c.y} r={30} fill={`url(#apb-halo-${dom})`} className="apb-halo"
                  style={{ transformBox: 'fill-box', transformOrigin: 'center', animationDelay: `-${phase}s` }} />
              )}
              {/* glass sphere — grabbable: dragging from the bubble picks up its wire */}
              <circle cx={CL_X} cy={c.y} r={CL_R} fill={`url(#apb-sphere-${dom})`} stroke={domColor} strokeWidth={1.4} strokeOpacity={0.85}
                className={reduceMotion ? undefined : 'apb-breathe'}
                onPointerDown={(e) => startDrag(e, c.id)}
                style={{
                  cursor: dragId === c.id ? 'grabbing' : 'grab',
                  ...(reduceMotion ? {} : { transformBox: 'fill-box' as const, transformOrigin: 'center', animationDelay: `-${phase}s` }),
                }}>
                <title>{`${c.name} · ${dom} client · ${c.appLabel} — drag onto a tunnel to re-route`}</title>
              </circle>
              <ellipse cx={CL_X - 7} cy={c.y - 8} rx={6} ry={3.6} fill="#fff" opacity={dark ? 0.75 : 0.9}
                style={{ pointerEvents: 'none' }}
                className={reduceMotion ? undefined : 'apb-glint'} />
              <foreignObject x={CL_X - 9} y={c.y - 9} width={18} height={18} style={{ pointerEvents: 'none' }}>
                <div style={{ color: domColor, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><c.DevIcon size={14} /></div>
              </foreignObject>

              {/* app moon — orbits the client; counter-rotated so the glyph stays
                  upright. Attribute transforms position; CSS only rotates. The
                  invisible r=40 circle pins each group's fill-box center to the
                  bubble center so transform-origin:center is exact. Reduced
                  motion parks the moon at 45° via attribute transforms. */}
              <g transform={`translate(${CL_X} ${c.y})${reduceMotion ? ' rotate(45)' : ''}`} style={{ pointerEvents: 'none' }}>
                <g className={reduceMotion ? undefined : 'apb-orbit'}
                  style={reduceMotion ? undefined : { transformBox: 'fill-box', transformOrigin: 'center', animationDelay: `-${(phase * 4) % 16}s` }}>
                  <circle r={40} fill="none" stroke="none" />
                  <g transform={`translate(${CL_R + 7} 0)${reduceMotion ? ' rotate(-45)' : ''}`}>
                    <g className={reduceMotion ? undefined : 'apb-orbit-c'}
                      style={reduceMotion ? undefined : { transformBox: 'fill-box', transformOrigin: 'center', animationDelay: `-${(phase * 4) % 16}s` }}>
                      <circle r={9} fill={`rgba(${hexRgb(c.appColor)},${dark ? 0.3 : 0.22})`} stroke={c.appColor} strokeWidth={1.3} />
                      <circle cx={-2.6} cy={-2.6} r={2} fill="#fff" opacity={0.85} />
                      <foreignObject x={-5.5} y={-5.5} width={11} height={11}>
                        <div style={{ color: c.appColor, height: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><c.AppIcon size={9} /></div>
                      </foreignObject>
                    </g>
                  </g>
                </g>
              </g>

              {/* fixed wire port on the rim */}
              <circle cx={PORT_X} cy={c.y} r={3} fill={domColor} />
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
          <span style={{ width: 16, height: 2, borderRadius: 2, background: `linear-gradient(90deg, ${catColor('video')}, ${tc.accent})` }} />
          packet speed = live latency
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
        .apb-glint { animation: apbGlint 5.2s ease-in-out infinite; }
        @keyframes apbGlint { 0%,100% { opacity: .5 } 50% { opacity: .95 } }
        .apb-orbit { animation: apbOrbit 16s linear infinite; }
        @keyframes apbOrbit { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .apb-orbit-c { animation: apbOrbitC 16s linear infinite; }
        @keyframes apbOrbitC { from { transform: rotate(0deg) } to { transform: rotate(-360deg) } }
        .apb-socket { animation: apbSocket 1.5s ease-in-out infinite; }
        @keyframes apbSocket { 0%,100% { stroke-opacity: .45 } 50% { stroke-opacity: 1 } }
        .apb-ripple { animation: apbRipple .9s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        @keyframes apbRipple { from { r: 8; stroke-opacity: .8; stroke-width: 2 } to { r: 34; stroke-opacity: 0; stroke-width: .5 } }
        .apb-flash { animation: apbFlash 1.2s ease-out; }
        @keyframes apbFlash { 0% { stroke-opacity: 1; filter: drop-shadow(0 0 6px currentColor) } 100% { stroke-opacity: 1 } }
        .apb-hex { opacity: 0; animation: apbHexIn .45s ease forwards; }
        @keyframes apbHexIn { to { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .apb-halo, .apb-breathe, .apb-glint, .apb-orbit, .apb-orbit-c, .apb-socket, .apb-ripple, .apb-flash { animation: none !important; }
          .apb-hex { opacity: 1; animation: none !important; }
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
