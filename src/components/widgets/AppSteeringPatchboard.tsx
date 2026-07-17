/**
 * Application Steering Patchboard — clients (left) each carry one application
 * as a floating glass bubble; IPsec tunnels (right) are jacks with live
 * latency. Every client hangs off a curvy Android-Studio-style patch wire.
 * Grab the plug at the tunnel end, drag it into a different jack, and the
 * desired route is encoded as a proto3 AppRouteCommand (proto/app_route.proto)
 * and published to `<source>/approute/control` via POST /api/approute/publish.
 * The wire-tap console shows the exact JSON → proto3 hex → topic.
 *
 * DATA SOURCES (best available wins, per branch):
 *   • Application-Aware Routing feed (proto/aar.proto, `routing/*` topics) —
 *     tunnels from routing/tunnel, current client→tunnel bindings from
 *     routing/decision. Treated as the McKinney (prpl) plugin's feed.
 *   • else prpl|rdk/ipsec/metrics tunnels + a policy-preview binding.
 *   • else a clearly-labelled simulated board so the interaction always demos.
 *
 * Location scoping stays STRICT: only devices with locationSource === this
 * branch's source resolve, and AAR data is only consumed on its own branch —
 * Plano (rdk) and McKinney (prpl) never mix.
 *
 * Accessibility: plugs are focusable — Enter picks the wire up, ↑/↓ choose a
 * tunnel, Enter confirms, Esc cancels; click-plug → click-jack is the pointer
 * fallback. Reduced motion disables ambient effects, never the interaction.
 */

import { useMemo, useRef, useState } from 'react';
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
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

interface AppDef { name: string; cat: AppCategoryId; icon: React.ComponentType<{ size?: number }>; }

// One application per client (used for the device/sim board — the live AAR
// board labels each client by its actual destination flow instead).
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
  id: string;            // override key: mac or src_ip
  name: string;
  appLabel: string;      // display under the name
  app: string;           // value put in the AppRouteCommand
  AppIcon: React.ComponentType<{ size?: number }>;
  DevIcon: React.ComponentType<{ size?: number }>;
  domain: 'IT' | 'OT';
  appColor: string;
  currentIfname?: string; // explicit live binding (AAR); else derived
  meta?: string;          // small extra line (e.g. end-to-end latency)
  y: number;
}

/** Policy-preview binding when no live one exists: IT rides fiber, OT rides
 *  5G, spread per-id across the family's reachable tunnels. */
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

/** M/C bezier with horizontal tangents — the Android-Studio wire. `sag` bows
 *  the belly while a plug is in hand so it reads as a cable. */
function wirePath(sx: number, sy: number, tx: number, ty: number, sag = 0): string {
  const k = Math.max(60, Math.min(180, Math.abs(tx - sx) * 0.45));
  return `M ${sx} ${sy} C ${sx + k} ${sy + sag}, ${tx - k} ${ty + sag}, ${tx} ${ty}`;
}

/* ───────── geometry (compact) ───────── */

const W = 760, H = 384;
const CL_X = 120, CL_R = 22;
const PORT_X = CL_X + CL_R;               // fixed wire anchor on the bubble rim
const TUN_X = 508, TUN_W = 214, TUN_H = 52;
const PLUG_INSET = 6;

interface DragState { id: string; x: number; y: number; overIdx: number | null; moved: boolean }
interface SelectState { id: string; idx: number }
interface PubState {
  seq: number;
  phase: 'publishing' | 'ok' | 'offline' | 'error' | 'nolive';
  label: string; json: string; hex: string; bytes: number; topic: string; error?: string;
}

/* ───────── component ───────── */

export function AppSteeringPatchboard({ branchId }: { branchId: string }) {
  const tc = useThemeColors();
  const { theme } = useTheme();
  const ipsec = useIpsecMetrics();
  const aar = useAarRouting();
  const { devices: allDevices } = useDevices();
  const { push } = useToast();
  const surface = theme === 'dark' ? 'rgba(16,14,34,0.96)' : '#ffffff';
  const dark = theme === 'dark';

  const svgRef = useRef<SVGSVGElement | null>(null);
  const seqRef = useRef(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selected, setSelected] = useState<SelectState | null>(null);
  const [pub, setPub] = useState<PubState | null>(null);
  const [lastPatched, setLastPatched] = useState<{ id: string; seq: number } | null>(null);

  const source = BRANCH_TO_IPSEC_SOURCE[branchId] as 'rdk' | 'prpl' | undefined;
  const gw = useMemo(
    () => (source ? ipsec.list.find((g) => g.source === source) : undefined),
    [ipsec.list, source],
  );

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // AAR is McKinney's plugin — only consume it on that branch (or an unscoped
  // branch), never on Plano, so the two fleets stay separate.
  const aarEligible = source === AAR_BRANCH_SOURCE || source === undefined;
  const aarLive = aarEligible && aar.receivedAt > 0;

  // ── Tunnels: AAR → ipsec → sim.
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
      raw = SIM_TUNNELS.map((t) => ({ ifname: t.ifname, reachable: t.reachable, latency_ms: t.latency_ms, loss_percent: t.loss_percent, active: t.ifname === 'vti-fiber1' }));
      src = 'sim';
    }
    const sorted = raw.sort((a, b) => (familyOf(a.ifname) === 'cell' ? 1 : 0) - (familyOf(b.ifname) === 'cell' ? 1 : 0) || a.ifname.localeCompare(b.ifname));
    const n = sorted.length;
    const slots: TunnelSlot[] = sorted.map((t, i) => {
      const family = familyOf(t.ifname);
      return { ...t, family, y: n <= 1 ? H / 2 : 58 + i * ((H - 120) / (n - 1)), color: family === 'fiber' ? tc.accent : tc.accent2 };
    });
    return { tunnels: slots, tunnelSource: src };
  }, [aarLive, aar.tunnels, gw, tc.accent, tc.accent2]);

  // ── Clients: AAR decisions → device inventory heuristic → sim.
  const { clients, clientSource, extraCount } = useMemo(() => {
    const mine = source ? allDevices.filter((d) => d.locationSource === source) : [];
    const place = (rows: Omit<PatchClient, 'y'>[]): PatchClient[] => {
      const n = rows.length;
      return rows.map((r, i) => ({ ...r, y: n <= 1 ? H / 2 : 50 + i * ((H - 100) / (n - 1)) }));
    };

    if (aarLive && aar.decisions.length) {
      const rows = aar.decisions.slice(0, 6).map((d) => {
        const dev = mine.find((m) => m.ip === d.src_ip);
        const domain = dev?.domain ?? 'IT';
        return {
          id: d.src_ip,
          name: dev?.name || d.src_ip,
          appLabel: `→ ${shortIp(d.dst_ip)}`,
          app: d.dst_ip,
          AppIcon: Globe,
          DevIcon: kindIcon[dev?.kind ?? 'generic'] ?? HelpCircle,
          domain: domain as 'IT' | 'OT',
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

  /* ───────── commit + publish ───────── */

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
    setLastPatched({ id: client.id, seq });

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

  function hitTunnel(x: number, y: number): number | null {
    if (x < TUN_X - 64 || x > TUN_X + TUN_W + 18) return null;
    const i = tunnels.findIndex((s) => Math.abs(y - s.y) <= TUN_H / 2 + 14);
    return i >= 0 ? i : null;
  }

  function onPlugDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    setSelected(null);
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const { x, y } = toSvgXY(e);
    setDrag({ id, x, y, overIdx: hitTunnel(x, y), moved: false });
  }

  function onSvgMove(e: React.PointerEvent) {
    if (!drag) return;
    const { x, y } = toSvgXY(e);
    const moved = drag.moved || Math.hypot(x - drag.x, y - drag.y) > 5;
    setDrag({ ...drag, x, y, overIdx: hitTunnel(x, y), moved });
  }

  function onSvgUp() {
    if (!drag) return;
    const client = clients.find((c) => c.id === drag.id);
    const d = drag;
    setDrag(null);
    if (!client) return;
    if (!d.moved) { setSelected({ id: client.id, idx: slotIdxFor(client) }); return; }
    if (d.overIdx != null) commitPatch(client, d.overIdx);
  }

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

  const highlightIdx = drag?.overIdx ?? (selected ? selected.idx : null);
  const armed = drag?.moved || selected != null;

  const links = clients.map((c, i) => {
    const idx = slotIdxFor(c);
    const slot = idx >= 0 ? tunnels[idx] : null;
    const dragging = drag?.id === c.id && drag.moved;
    const ex = dragging ? drag.x : TUN_X - PLUG_INSET;
    const ey = dragging ? drag.y : (slot?.y ?? c.y);
    const sag = dragging ? Math.min(54, Math.hypot(ex - PORT_X, ey - c.y) * 0.12) : 0;
    return {
      c, i, idx, slot,
      path: wirePath(PORT_X + 2, c.y, ex, ey, sag),
      ghostPath: dragging && slot ? wirePath(PORT_X + 2, c.y, TUN_X - PLUG_INSET, slot.y) : null,
      ex, ey, dragging,
      pulsing: lastPatched?.id === c.id,
      h: idHash(c.id),
    };
  });

  const sourceChip = (s: string) => (s === 'aar' ? 'live · routing/*' : s === 'ipsec' ? `live · ${source}/ipsec/metrics` : 'simulated');
  const fleetLabel = source ? (LOCATION_LABEL[source] ?? source) : 'demo';

  /* ───────── render ───────── */

  return (
    <div style={{ position: 'relative', maxWidth: W, margin: '0 auto' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        role="application"
        aria-label="Application steering patchboard: drag a client's plug onto a tunnel to re-route its application"
        onPointerMove={onSvgMove}
        onPointerUp={onSvgUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setSelected(null); setDrag(null); } }}
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
              x1={PORT_X} y1={l.c.y} x2={l.ex} y2={l.ey}>
              <stop offset="0%" stopColor={l.c.appColor} stopOpacity={0.95} />
              <stop offset="100%" stopColor={l.slot?.color ?? l.c.appColor} stopOpacity={0.95} />
            </linearGradient>
          ))}
        </defs>

        {/* eyebrows */}
        <text x={CL_X - CL_R} y={26} fontSize="9.5" fontWeight={700} letterSpacing="0.14em" fill={tc.textMuted}>CLIENTS · ONE APP EACH</text>
        <text x={TUN_X} y={26} fontSize="9.5" fontWeight={700} letterSpacing="0.14em" fill={tc.textMuted}>IPSEC TUNNELS</text>

        {/* ── wires (under nodes) ── */}
        {links.map((l) => (
          <g key={`w-${l.c.id}`}>
            {l.ghostPath && <path d={l.ghostPath} fill="none" stroke={tc.textMuted} strokeOpacity={0.22} strokeWidth={1.3} strokeDasharray="4 8" />}
            <path d={l.path} fill="none" stroke={`url(#apb-w-${l.i})`} strokeOpacity={l.dragging ? 0.3 : 0.16} strokeWidth={6} strokeLinecap="round" />
            <path d={l.path} fill="none" stroke={`url(#apb-w-${l.i})`} strokeWidth={l.dragging ? 2.6 : 2.1} strokeLinecap="round" />
            {!reduceMotion && !l.dragging && l.slot && (
              <path d={l.path} fill="none" stroke={l.slot.color} strokeOpacity={0.9} strokeWidth={2.1} strokeLinecap="round"
                strokeDasharray="2.5 14" className="apb-dash" style={{ animationDuration: `${1.3 + (l.h % 10) / 10}s` }} />
            )}
            {!reduceMotion && l.pulsing && !l.dragging && l.slot && (
              <circle r={3.6} fill={l.slot.color} key={`pulse-${lastPatched?.seq}`}>
                <animateMotion dur="0.85s" repeatCount="3" path={l.path} />
              </circle>
            )}
          </g>
        ))}

        {/* ── tunnel jacks ── */}
        {tunnels.map((s, idx) => {
          const hot = highlightIdx === idx;
          const n = links.filter((l) => l.idx === idx).length;
          return (
            <g key={s.ifname} onClick={() => onTunnelClick(idx)} style={{ cursor: selected ? 'pointer' : 'default' }}>
              <rect x={TUN_X} y={s.y - TUN_H / 2} width={TUN_W} height={TUN_H} rx={14}
                fill={hot ? `rgba(${hexRgb(s.color)},0.1)` : surface} stroke={s.color}
                strokeOpacity={s.reachable ? (hot ? 1 : s.active ? 0.9 : 0.5) : 0.25}
                strokeWidth={hot ? 2.2 : s.active ? 1.8 : 1.2}
                filter={hot || s.active ? 'url(#apb-glow)' : undefined}>
                <title>{`${s.ifname} — ${s.reachable ? 'reachable' : 'unreachable'} · ${s.latency_ms} ms · ${s.loss_percent}% loss`}</title>
              </rect>
              <circle cx={TUN_X} cy={s.y} r={hot ? 12 : 8} fill={surface} stroke={s.color}
                strokeWidth={hot ? 2 : 1.4} strokeOpacity={armed ? 1 : 0.6}
                className={armed && !hot && !reduceMotion ? 'apb-socket' : undefined} />
              {hot && (
                <circle cx={TUN_X} cy={s.y} r={18} fill="none" stroke={s.color} strokeWidth={1.1} strokeDasharray="3 6" opacity={0.9}>
                  {!reduceMotion && <animateTransform attributeName="transform" type="rotate" from={`0 ${TUN_X} ${s.y}`} to={`360 ${TUN_X} ${s.y}`} dur="6s" repeatCount="indefinite" />}
                </circle>
              )}
              <circle cx={TUN_X + 26} cy={s.y - 11} r={3.6} fill={s.reachable ? tc.ok : tc.err} />
              <text x={TUN_X + 38} y={s.y - 7} fontSize="12.5" fontWeight={700} fill={s.color} fontFamily={MONO}>{s.ifname}</text>
              <text x={TUN_X + 38} y={s.y + 11} fontSize="10" fill={tc.textMuted}>
                {n} app{n === 1 ? '' : 's'}{s.active ? ' · active' : ''}
              </text>
              <text x={TUN_X + TUN_W - 14} y={s.y - 7} textAnchor="end" fontSize="12" fill={tc.textDim} fontFamily={MONO}>{s.latency_ms} ms</text>
              <text x={TUN_X + TUN_W - 14} y={s.y + 11} textAnchor="end" fontSize="9" fontWeight={700} letterSpacing="0.08em"
                fill={s.family === 'fiber' ? tc.accent : tc.accent2}>
                {s.family === 'fiber' ? 'FIBER' : '5G'}{s.loss_percent ? ` · ${s.loss_percent}%` : ''}
              </text>
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
              {/* labels */}
              <text x={CL_X - CL_R - 12} y={c.y - 4} textAnchor="end" fontSize="12.5" fontWeight={600} fill={tc.text}>{label}</text>
              <text x={CL_X - CL_R - 12} y={c.y + 12} textAnchor="end" fontSize="10.5" fontWeight={600} fill={c.appColor}>{c.appLabel}</text>
              {c.meta && <text x={CL_X - CL_R - 12} y={c.y + 26} textAnchor="end" fontSize="9" fill={tc.textMuted} fontFamily={MONO}>{c.meta}</text>}

              {/* pulsing halo */}
              {!reduceMotion && (
                <circle cx={CL_X} cy={c.y} r={30} fill={`url(#apb-halo-${dom})`} className="apb-halo"
                  style={{ transformBox: 'fill-box', transformOrigin: 'center', animationDelay: `-${phase}s` }} />
              )}
              {/* glass sphere (gentle breathe) */}
              <circle cx={CL_X} cy={c.y} r={CL_R} fill={`url(#apb-sphere-${dom})`} stroke={domColor} strokeWidth={1.4} strokeOpacity={0.85}
                className={reduceMotion ? undefined : 'apb-breathe'}
                style={reduceMotion ? undefined : { transformBox: 'fill-box', transformOrigin: 'center', animationDelay: `-${phase}s` }}>
                <title>{`${c.name} · ${dom} client · ${c.appLabel}`}</title>
              </circle>
              {/* specular highlight (drifting glint) */}
              <ellipse cx={CL_X - 7} cy={c.y - 8} rx={6} ry={3.6} fill="#fff" opacity={dark ? 0.75 : 0.9}
                className={reduceMotion ? undefined : 'apb-glint'} style={reduceMotion ? undefined : { transformBox: 'fill-box', transformOrigin: 'center' }} />
              {/* device glyph */}
              <foreignObject x={CL_X - 9} y={c.y - 9} width={18} height={18} style={{ pointerEvents: 'none' }}>
                <div style={{ color: domColor, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><c.DevIcon size={14} /></div>
              </foreignObject>

              {/* app moon (bobbing) — the visible "floating" motion; not a wire anchor */}
              <g className={reduceMotion ? undefined : 'apb-moon'} style={reduceMotion ? undefined : { transformBox: 'fill-box', transformOrigin: 'center', animationDelay: `-${phase / 2}s` }}>
                <circle cx={CL_X + 16} cy={c.y + 16} r={10} fill={`rgba(${hexRgb(c.appColor)},${dark ? 0.28 : 0.22})`} stroke={c.appColor} strokeWidth={1.4} />
                <circle cx={CL_X + 13} cy={c.y + 13} r={2.4} fill="#fff" opacity={0.85} />
                <foreignObject x={CL_X + 16 - 6} y={c.y + 16 - 6} width={12} height={12} style={{ pointerEvents: 'none' }}>
                  <div style={{ color: c.appColor, height: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><c.AppIcon size={10} /></div>
                </foreignObject>
              </g>

              {/* fixed wire port on the rim */}
              <circle cx={PORT_X} cy={c.y} r={3} fill={domColor} />
            </g>
          );
        })}

        {/* ── plugs (top layer) ── */}
        {links.map((l) => {
          const plugColor = l.slot?.color ?? tc.textMuted;
          const isSel = selected?.id === l.c.id;
          return (
            <g key={`p-${l.c.id}`} style={{ cursor: l.dragging ? 'grabbing' : 'grab' }} onPointerDown={(e) => onPlugDown(e, l.c.id)}>
              <circle cx={l.ex} cy={l.ey} r={7.5} fill={surface} stroke={plugColor} strokeWidth={isSel ? 2.4 : 1.8}
                filter={l.dragging || isSel ? 'url(#apb-glow)' : undefined} />
              <circle cx={l.ex} cy={l.ey} r={3} fill={plugColor} />
              <circle cx={l.ex} cy={l.ey} r={16} fill="transparent" tabIndex={0} role="button"
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
            ▍wire-tap · grab a plug and patch it into another tunnel — the change is encoded as proto3{' '}
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
          wire = app class → tunnel
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          <span className="badge" title="where the tunnel list comes from">tunnels: {sourceChip(tunnelSource)}</span>
          <span className="badge" title="where the client bindings come from">clients: {sourceChip(clientSource)} · {fleetLabel}</span>
        </span>
      </div>

      <style>{`
        .apb-dash { animation-name: apbDash; animation-timing-function: linear; animation-iteration-count: infinite; }
        @keyframes apbDash { to { stroke-dashoffset: -33; } }
        .apb-halo { animation: apbHalo 4.4s ease-in-out infinite; }
        @keyframes apbHalo { 0%,100% { transform: scale(0.9); opacity: .35 } 50% { transform: scale(1.12); opacity: .6 } }
        .apb-breathe { animation: apbBreathe 4.8s ease-in-out infinite; }
        @keyframes apbBreathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.035) } }
        .apb-glint { animation: apbGlint 5.2s ease-in-out infinite; }
        @keyframes apbGlint { 0%,100% { transform: translate(0,0); opacity: .55 } 50% { transform: translate(1.6px,1.4px); opacity: .95 } }
        .apb-moon { animation: apbMoon 3.6s ease-in-out infinite; }
        @keyframes apbMoon { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        .apb-hex { opacity: 0; animation: apbHexIn .45s ease forwards; }
        @keyframes apbHexIn { to { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .apb-dash, .apb-halo, .apb-breathe, .apb-glint, .apb-moon { animation: none !important; }
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
