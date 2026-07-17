/**
 * Application Steering Patchboard — clients (left) carry one application each
 * as a glass "planet + app moon"; IPsec tunnels (right) are jacks with live
 * latency from `<source>/ipsec/metrics`. Every client hangs off a curvy
 * Android-Studio-style patch wire. Grab the plug at the tunnel end, drag it
 * into a different jack, and the desired route is encoded as a proto3
 * AppRouteCommand (proto/app_route.proto) and published to
 * `<source>/approute/control` via POST /api/approute/publish. The wire-tap
 * console under the board shows the exact JSON → proto3 hex bytes → topic.
 *
 * Wire color = the app's traffic class (same category palette as the policy
 * table); jack color = underlay family (fiber = accent, 5G = accent-2).
 *
 * Location scoping is STRICT: only devices with locationSource === this
 * branch's source render — Plano (rdk) and McKinney (prpl) never mix. When a
 * branch has no live feed/inventory yet, the board runs on clearly-labelled
 * simulated clients/tunnels so the interaction still demos; publishing is
 * skipped when there is no live gateway to talk to.
 *
 * Accessibility: plugs are focusable — Enter picks the wire up, ↑/↓ choose a
 * tunnel, Enter confirms, Esc cancels. Click-the-plug → click-a-jack works as
 * a pointer fallback for touch. Reduced motion disables the ambient effects
 * but never the interaction.
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
import { useTheme, useThemeColors } from '../../ui/Theme';
import { useToast } from '../../ui/Toast';
import { BRANCH_TO_IPSEC_SOURCE, appCategories } from '../../data/mock';
import { encodeAppRouteCommand, toHex, type AppRouteCommand } from '../../proto/appRoute';

/* ───────── static vocabulary ───────── */

const kindIcon: Record<Device['kind'], React.ComponentType<{ size?: number }>> = {
  laptop: Laptop, desktop: Monitor, printer: Printer, payment: CreditCard,
  server: Server, confphone: PhoneCall,
  fire_sensor: Flame, smoke_sensor: Wind, door_lock: DoorClosed,
  phone: Smartphone, tablet: Tablet, matter: Cpu, shelly: Plug, generic: HelpCircle,
};

const LOCATION_LABEL: Record<string, string> = { rdk: 'Plano', prpl: 'McKinney' };
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

interface AppDef {
  name: string;
  cat: AppCategoryId;
  icon: React.ComponentType<{ size?: number }>;
}

// One application per client. IT clients draw from the SaaS/streaming pool,
// OT from the plant-floor pool; the i-th client (mac-sorted) gets the i-th
// app so a small fleet still shows variety.
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

/* ───────── fallbacks when the branch has no live feed yet ───────── */

const SIM_TUNNELS: IpsecTunnelMetric[] = [
  { ifname: 'vti-fiber1', present: true, reachable: true, latency_ms: 4.2,  loss_percent: 0.02, rx_bytes: 0, tx_bytes: 0 },
  { ifname: 'vti-fiber2', present: true, reachable: true, latency_ms: 5.1,  loss_percent: 0.05, rx_bytes: 0, tx_bytes: 0 },
  { ifname: 'vti-cell1',  present: true, reachable: true, latency_ms: 38.0, loss_percent: 0.40, rx_bytes: 0, tx_bytes: 0 },
  { ifname: 'vti-cell2',  present: true, reachable: true, latency_ms: 46.0, loss_percent: 0.80, rx_bytes: 0, tx_bytes: 0 },
];

interface PatchClientSrc {
  mac: string;
  name: string;
  kind: Device['kind'];
  domain: 'IT' | 'OT';
}

const SIM_CLIENTS: PatchClientSrc[] = [
  { mac: 'aa:bb:cc:00:00:01', name: 'front-desk',   kind: 'laptop',    domain: 'IT' },
  { mac: 'aa:bb:cc:00:00:02', name: 'back-office',  kind: 'desktop',   domain: 'IT' },
  { mac: 'aa:bb:cc:00:00:03', name: 'meeting-room', kind: 'confphone', domain: 'IT' },
  { mac: 'aa:bb:cc:00:00:04', name: 'kitchen-pos',  kind: 'payment',   domain: 'OT' },
  { mac: 'aa:bb:cc:00:00:05', name: 'dock-door',    kind: 'door_lock', domain: 'OT' },
];

/* ───────── helpers ───────── */

type TunnelFamily = 'fiber' | 'cell';

/** Underlay family from the tunnel ifname (mirrors the constellation). */
function familyOf(ifname: string): TunnelFamily {
  const n = (ifname || '').toLowerCase();
  return n.includes('cell') || n.includes('5g') || n.includes('lte') || n.includes('wwan')
    ? 'cell' : 'fiber';
}

/** Stable small hash for per-MAC assignment + animation phase. */
function macHash(mac: string): number {
  let h = 0;
  for (let i = 0; i < mac.length; i++) h = (h * 31 + mac.charCodeAt(i)) >>> 0;
  return h;
}

interface TunnelSlot {
  t: IpsecTunnelMetric;
  family: TunnelFamily;
  active: boolean;
  y: number;
  color: string;
}

interface PatchClient extends PatchClientSrc {
  app: AppDef;
  y: number;
}

/** Default binding, same policy preview the constellation uses: IT rides
 *  fiber, OT rides 5G, spread per-MAC across the family's reachable tunnels. */
function defaultSlotIdx(c: PatchClientSrc, slots: TunnelSlot[]): number {
  if (slots.length === 0) return -1;
  const fam: TunnelFamily = c.domain === 'IT' ? 'fiber' : 'cell';
  const pick = (pool: number[]) => pool[macHash(c.mac) % pool.length];
  const preferred = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.family === fam && s.t.reachable).map(({ i }) => i);
  if (preferred.length) return pick(preferred);
  const reachable = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.t.reachable).map(({ i }) => i);
  if (reachable.length) return pick(reachable);
  return pick(slots.map((_, i) => i));
}

/** M/C bezier with horizontal tangents — the Android-Studio wire. `sag` bows
 *  the belly down while a plug is in hand so the wire feels like a cable. */
function wirePath(sx: number, sy: number, tx: number, ty: number, sag = 0): string {
  const k = Math.max(80, Math.min(240, Math.abs(tx - sx) * 0.42));
  return `M ${sx} ${sy} C ${sx + k} ${sy + sag}, ${tx - k} ${ty + sag}, ${tx} ${ty}`;
}

/* ───────── geometry ───────── */

const W = 1200, H = 580;
const CL_X = 205;                      // client planet center
const TUN_X = 780, TUN_W = 310, TUN_H = 78;
const PLUG_INSET = 9;                  // wire ends just inside the socket ring

interface DragState { mac: string; x: number; y: number; overIdx: number | null; moved: boolean }
interface SelectState { mac: string; idx: number }

interface PubState {
  seq: number;
  phase: 'publishing' | 'ok' | 'offline' | 'error' | 'nolive';
  label: string;       // "kitchen-pos · Netflix · vti-fiber1 → vti-cell1"
  json: string;
  hex: string;
  bytes: number;
  topic: string;
  error?: string;
}

/* ───────── component ───────── */

export function AppSteeringPatchboard({ branchId }: { branchId: string }) {
  const tc = useThemeColors();
  const { theme } = useTheme();
  const ipsec = useIpsecMetrics();
  const { devices: allDevices } = useDevices();
  const { push } = useToast();
  const surface = theme === 'dark' ? 'rgba(14,12,32,0.96)' : '#ffffff';

  const svgRef = useRef<SVGSVGElement | null>(null);
  const seqRef = useRef(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selected, setSelected] = useState<SelectState | null>(null);
  const [pub, setPub] = useState<PubState | null>(null);
  const [lastPatched, setLastPatched] = useState<{ mac: string; seq: number } | null>(null);

  const source = BRANCH_TO_IPSEC_SOURCE[branchId] as 'rdk' | 'prpl' | undefined;
  const gw = useMemo(
    () => (source ? ipsec.list.find((g) => g.source === source) : undefined),
    [ipsec.list, source],
  );

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // ── Tunnels: live when the gateway publishes, canonical sim jacks until then.
  const liveTunnels = gw?.metrics.tunnels?.length ? gw.metrics.tunnels : null;
  const tunnels: TunnelSlot[] = useMemo(() => {
    const list = [...(liveTunnels ?? SIM_TUNNELS)].sort((a, b) => {
      const fa = familyOf(a.ifname) === 'cell' ? 1 : 0;
      const fb = familyOf(b.ifname) === 'cell' ? 1 : 0;
      return fa - fb || a.ifname.localeCompare(b.ifname);
    });
    const n = list.length;
    const active = gw?.metrics.active_tunnel ?? (liveTunnels ? '' : 'vti-fiber1');
    return list.map((t, i) => {
      const family = familyOf(t.ifname);
      return {
        t,
        family,
        active: active === t.ifname,
        y: n <= 1 ? H / 2 : 96 + i * ((H - 192) / (n - 1)),
        color: family === 'fiber' ? tc.accent : tc.accent2,
      };
    });
  }, [liveTunnels, gw, tc.accent, tc.accent2]);

  // ── Clients: STRICT location filter (Plano/McKinney never mix). Sim fleet
  //    only when this branch has no live inventory at all.
  const { clients, liveClients, extraCount } = useMemo(() => {
    const mine = source ? allDevices.filter((d) => d.locationSource === source) : [];
    const pool: PatchClientSrc[] = mine.length ? mine : SIM_CLIENTS;
    const it = pool.filter((d) => d.domain === 'IT').sort((a, b) => a.mac.localeCompare(b.mac));
    const ot = pool.filter((d) => d.domain === 'OT').sort((a, b) => a.mac.localeCompare(b.mac));
    const chosen = [
      ...it.slice(0, 3).map((d, i) => ({ ...d, app: IT_APPS[i % IT_APPS.length] })),
      ...ot.slice(0, 2).map((d, i) => ({ ...d, app: OT_APPS[i % OT_APPS.length] })),
    ];
    const n = chosen.length;
    const placed: PatchClient[] = chosen.map((c, i) => ({
      ...c,
      y: n <= 1 ? H / 2 : 76 + i * ((H - 152) / (n - 1)),
    }));
    return {
      clients: placed,
      liveClients: mine.length > 0,
      extraCount: it.length + ot.length - n,
    };
  }, [allDevices, source]);

  // ── Effective wiring: user patches override the policy preview.
  const slotIdxFor = (c: PatchClientSrc): number => {
    const ov = overrides[c.mac];
    if (ov) {
      const i = tunnels.findIndex((s) => s.t.ifname === ov);
      if (i >= 0) return i;
    }
    return defaultSlotIdx(c, tunnels);
  };

  /* ───────── commit + publish ───────── */

  function commitPatch(client: PatchClient, targetIdx: number) {
    const fromIdx = slotIdxFor(client);
    if (targetIdx < 0 || targetIdx >= tunnels.length || targetIdx === fromIdx) return;
    const from = tunnels[fromIdx];
    const to = tunnels[targetIdx];

    setOverrides((prev) => ({ ...prev, [client.mac]: to.t.ifname }));

    const cmd: AppRouteCommand = {
      timestamp_ms: Date.now(),
      source: source ?? 'sim',
      gateway: gw?.metrics.gateway.name ?? 'gateway',
      changes: [{
        client_mac: client.mac,
        client_name: client.name,
        current: { application: client.app.name, tunnel: from.t.ifname },
        desired: { application: client.app.name, tunnel: to.t.ifname },
      }],
    };
    const bytes = encodeAppRouteCommand(cmd);
    const seq = ++seqRef.current;
    setLastPatched({ mac: client.mac, seq });

    const base: Omit<PubState, 'phase'> = {
      seq,
      label: `${client.name} · ${client.app.name} · ${from.t.ifname} → ${to.t.ifname}`,
      json: JSON.stringify(cmd),
      hex: toHex(bytes),
      bytes: bytes.length,
      topic: `${source ?? 'sim'}/approute/control`,
    };

    if (!source) {
      setPub({ ...base, phase: 'nolive' });
      push({ kind: 'info', title: 'Route encoded (not published)', detail: 'This branch has no live gateway feed — proto3 payload shown in the wire-tap console.' });
      return;
    }

    setPub({ ...base, phase: 'publishing' });
    void (async () => {
      try {
        const res = await fetch(`/api/approute/publish?source=${source}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
        });
        const data = await res.json().catch(() => null) as { ok?: boolean; offline?: boolean; error?: string } | null;
        if (seqRef.current !== seq) return; // superseded by a newer patch
        if (res.ok && data?.ok) {
          setPub({ ...base, phase: 'ok' });
          push({
            kind: 'success',
            title: `Route published — ${client.app.name} → ${to.t.ifname}`,
            detail: `${bytes.length} bytes of proto3 on ${base.topic} (qos1)`,
          });
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
    const scale = W / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  }

  function hitTunnel(x: number, y: number): number | null {
    if (x < TUN_X - 70 || x > TUN_X + TUN_W + 24) return null;
    const i = tunnels.findIndex((s) => Math.abs(y - s.y) <= TUN_H / 2 + 16);
    return i >= 0 ? i : null;
  }

  function onPlugDown(e: React.PointerEvent, mac: string) {
    e.preventDefault();
    setSelected(null);
    // Capture can throw for an already-released pointer — losing capture only
    // costs us move events outside the SVG, so never let it kill the grab.
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const { x, y } = toSvgXY(e);
    setDrag({ mac, x, y, overIdx: hitTunnel(x, y), moved: false });
  }

  function onSvgMove(e: React.PointerEvent) {
    if (!drag) return;
    const { x, y } = toSvgXY(e);
    const moved = drag.moved || Math.hypot(x - drag.x, y - drag.y) > 6;
    setDrag({ ...drag, x, y, overIdx: hitTunnel(x, y), moved });
  }

  function onSvgUp() {
    if (!drag) return;
    const client = clients.find((c) => c.mac === drag.mac);
    setDrag(null);
    if (!client) return;
    if (!drag.moved) {
      // A tap, not a drag → arm click-to-rewire mode.
      setSelected({ mac: client.mac, idx: slotIdxFor(client) });
      return;
    }
    if (drag.overIdx != null) commitPatch(client, drag.overIdx);
  }

  function onTunnelClick(idx: number) {
    if (!selected) return;
    const client = clients.find((c) => c.mac === selected.mac);
    setSelected(null);
    if (client) commitPatch(client, idx);
  }

  function onPlugKey(e: React.KeyboardEvent, client: PatchClient) {
    const cur = slotIdxFor(client);
    if (!selected || selected.mac !== client.mac) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setSelected({ mac: client.mac, idx: cur });
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setSelected({ mac: client.mac, idx: (selected.idx + d + tunnels.length) % tunnels.length });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const idx = selected.idx;
      setSelected(null);
      commitPatch(client, idx);
    } else if (e.key === 'Escape') {
      setSelected(null);
    }
  }

  /* ───────── render ───────── */

  const highlightIdx = drag?.overIdx ?? (selected ? selected.idx : null);
  const armed = drag?.moved || selected != null; // sockets flare while a wire is in hand

  const links = clients.map((c, i) => {
    const idx = slotIdxFor(c);
    const slot = idx >= 0 ? tunnels[idx] : null;
    const appColor = catColor(c.app.cat);
    const sx = CL_X + 44, sy = c.y + 20; // app moon's edge
    const dragging = drag?.mac === c.mac && drag.moved;
    const ex = dragging ? drag.x : TUN_X - PLUG_INSET;
    const ey = dragging ? drag.y : (slot?.y ?? c.y);
    const sag = dragging ? Math.min(70, Math.hypot(ex - sx, ey - sy) * 0.12) : 0;
    return {
      c, i, idx, slot, appColor, sx, sy, ex, ey, dragging,
      path: wirePath(sx, sy, ex, ey, sag),
      ghostPath: dragging && slot ? wirePath(sx, sy, TUN_X - PLUG_INSET, slot.y) : null,
      pulsing: lastPatched?.mac === c.mac,
      h: macHash(c.mac),
    };
  });

  const feedChip = liveTunnels ? `live · ${source}/ipsec/metrics` : 'simulated feed';
  const fleetChip = liveClients ? `${source ? LOCATION_LABEL[source] ?? source : ''} fleet` : 'simulated clients';

  return (
    <div style={{ position: 'relative' }}>
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
          <filter id="apb-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {links.map((l) => (
            <linearGradient
              key={l.i} id={`apb-g-${l.i}`} gradientUnits="userSpaceOnUse"
              x1={l.sx} y1={l.sy} x2={l.ex} y2={l.ey}
            >
              <stop offset="0%" stopColor={l.appColor} stopOpacity={0.9} />
              <stop offset="100%" stopColor={l.slot?.color ?? l.appColor} stopOpacity={0.9} />
            </linearGradient>
          ))}
        </defs>

        {/* column eyebrows */}
        <text x={CL_X - 44} y={34} fontSize="10" fontWeight={700} letterSpacing="0.14em" fill={tc.textMuted}>
          CLIENTS · ONE APP EACH
        </text>
        <text x={TUN_X} y={34} fontSize="10" fontWeight={700} letterSpacing="0.14em" fill={tc.textMuted}>
          IPSEC TUNNELS
        </text>

        {/* ── wires (under everything so plugs sit in the sockets) ── */}
        {links.map((l) => (
          <g key={`w-${l.c.mac}`}>
            {/* the abandoned run, shown faint while its plug is in hand */}
            {l.ghostPath && (
              <path d={l.ghostPath} fill="none" stroke={tc.textMuted} strokeOpacity={0.22}
                strokeWidth={1.4} strokeDasharray="4 8" />
            )}
            {/* soft under-glow */}
            <path d={l.path} fill="none" stroke={`url(#apb-g-${l.i})`} strokeOpacity={l.dragging ? 0.28 : 0.16}
              strokeWidth={7} strokeLinecap="round" />
            {/* wire body */}
            <path d={l.path} fill="none" stroke={`url(#apb-g-${l.i})`}
              strokeWidth={l.dragging ? 2.6 : 2.2} strokeLinecap="round" />
            {/* packet flow */}
            {!reduceMotion && !l.dragging && l.slot && (
              <path d={l.path} fill="none" stroke={l.slot.color} strokeOpacity={0.85}
                strokeWidth={2.2} strokeLinecap="round" strokeDasharray="3 15"
                className="apb-dash" style={{ animationDuration: `${1.4 + (l.h % 10) / 10}s` }} />
            )}
            {/* one-shot confirmation pulse after a re-patch */}
            {!reduceMotion && l.pulsing && !l.dragging && l.slot && (
              <circle r={4} fill={l.slot.color} opacity={0.95} key={`pulse-${lastPatched?.seq}`}>
                <animateMotion dur="0.9s" repeatCount="3" path={l.path} />
              </circle>
            )}
          </g>
        ))}

        {/* ── tunnel jacks ── */}
        {tunnels.map((s, idx) => {
          const hot = highlightIdx === idx;
          return (
            <g key={s.t.ifname} onClick={() => onTunnelClick(idx)}
              style={{ cursor: selected ? 'pointer' : 'default' }}>
              <rect x={TUN_X} y={s.y - TUN_H / 2} width={TUN_W} height={TUN_H} rx={16}
                fill={hot ? `${s.color}14` : surface}
                stroke={s.color}
                strokeOpacity={s.t.reachable ? (hot ? 1 : s.active ? 0.9 : 0.5) : 0.25}
                strokeWidth={hot ? 2.2 : s.active ? 1.8 : 1.2}
                filter={hot || s.active ? 'url(#apb-glow)' : undefined}>
                <title>{`${s.t.ifname} — ${s.t.reachable ? 'reachable' : 'unreachable'} · ${Math.round(s.t.latency_ms * 10) / 10} ms · ${s.t.loss_percent}% loss`}</title>
              </rect>

              {/* socket ring on the left edge */}
              <circle cx={TUN_X} cy={s.y} r={hot ? 13 : 9} fill={surface}
                stroke={s.color} strokeWidth={hot ? 2 : 1.4}
                strokeOpacity={armed ? 1 : 0.6}
                className={armed && !hot && !reduceMotion ? 'apb-socket' : undefined} />
              {hot && (
                <circle cx={TUN_X} cy={s.y} r={19} fill="none" stroke={s.color}
                  strokeWidth={1.2} strokeDasharray="3 6" opacity={0.9}>
                  {!reduceMotion && (
                    <animateTransform attributeName="transform" type="rotate"
                      from={`0 ${TUN_X} ${s.y}`} to={`360 ${TUN_X} ${s.y}`} dur="6s" repeatCount="indefinite" />
                  )}
                </circle>
              )}

              <circle cx={TUN_X + 30} cy={s.y - 12} r={4}
                fill={s.t.reachable ? tc.ok : tc.err} opacity={0.95} />
              <text x={TUN_X + 42} y={s.y - 8} fontSize="13.5" fontWeight={700}
                fill={s.color} fontFamily={MONO}>
                {s.t.ifname}
              </text>
              <text x={TUN_X + 42} y={s.y + 12} fontSize="10.5" fill={tc.textMuted}>
                {links.filter((l) => l.idx === idx).length} app{links.filter((l) => l.idx === idx).length === 1 ? '' : 's'}
                {s.active ? ' · active path' : ''}
              </text>
              <text x={TUN_X + TUN_W - 16} y={s.y - 8} textAnchor="end" fontSize="12.5"
                fill={tc.textDim} fontFamily={MONO}>
                {Math.round(s.t.latency_ms * 10) / 10} ms
              </text>
              <text x={TUN_X + TUN_W - 16} y={s.y + 12} textAnchor="end" fontSize="9.5"
                fill={s.family === 'fiber' ? tc.accent : tc.accent2} fontWeight={700} letterSpacing="0.08em">
                {s.family === 'fiber' ? 'FIBER' : '5G'} · {s.t.loss_percent}% loss
              </text>
            </g>
          );
        })}

        {/* ── client planets + app moons ── */}
        {clients.map((c) => {
          const Icon = kindIcon[c.kind] ?? HelpCircle;
          const AppIcon = c.app.icon;
          const appColor = catColor(c.app.cat);
          const domainColor = c.domain === 'IT' ? tc.accent : tc.accent2;
          const label = c.name.length > 16 ? `${c.name.slice(0, 15)}…` : c.name;
          return (
            <g key={c.mac} className="apb-client">
              {/* breathing halo — the "floating" feel without moving the wire anchor */}
              {!reduceMotion && (
                <circle cx={CL_X} cy={c.y} r={44} fill={appColor} opacity={0.05}
                  className="apb-breathe" style={{ animationDelay: `-${(macHash(c.mac) % 40) / 10}s` }} />
              )}
              <text x={CL_X - 52} y={c.y - 4} textAnchor="end" fontSize="13" fontWeight={600} fill={tc.text}>
                {label}
              </text>
              <text x={CL_X - 52} y={c.y + 13} textAnchor="end" fontSize="10.5" fill={appColor} fontWeight={600}>
                {c.app.name}
              </text>
              <circle cx={CL_X} cy={c.y} r={30} fill={surface} stroke={domainColor}
                strokeWidth={1.5} strokeOpacity={0.85}>
                <title>{`${c.name} · ${c.domain} client · runs ${c.app.name}`}</title>
              </circle>
              <foreignObject x={CL_X - 10} y={c.y - 10} width={20} height={20} style={{ pointerEvents: 'none' }}>
                <div style={{ color: domainColor, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={15} />
                </div>
              </foreignObject>
              {/* app moon — the wire hangs off the application, not the device */}
              <circle cx={CL_X + 27} cy={c.y + 19} r={15} fill={surface} stroke={appColor} strokeWidth={1.6}>
                <title>{c.app.name}</title>
              </circle>
              <foreignObject x={CL_X + 27 - 8} y={c.y + 19 - 8} width={16} height={16} style={{ pointerEvents: 'none' }}>
                <div style={{ color: appColor, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon size={12} />
                </div>
              </foreignObject>
            </g>
          );
        })}

        {/* ── plugs (top layer, the grab handles) ── */}
        {links.map((l) => {
          const plugColor = l.slot?.color ?? tc.textMuted;
          const isSelected = selected?.mac === l.c.mac;
          return (
            <g key={`p-${l.c.mac}`}
              style={{ cursor: l.dragging ? 'grabbing' : 'grab' }}
              onPointerDown={(e) => onPlugDown(e, l.c.mac)}>
              <circle cx={l.ex} cy={l.ey} r={8} fill={surface} stroke={plugColor}
                strokeWidth={isSelected ? 2.4 : 1.8}
                filter={l.dragging || isSelected ? 'url(#apb-glow)' : undefined} />
              <circle cx={l.ex} cy={l.ey} r={3.2} fill={plugColor} />
              {/* fat invisible hit target + keyboard handle */}
              <circle cx={l.ex} cy={l.ey} r={17} fill="transparent"
                tabIndex={0} role="button"
                aria-label={`Re-patch ${l.c.app.name} for ${l.c.name}; currently on ${l.slot?.t.ifname ?? 'no tunnel'}. Press Enter to pick up, arrow keys to choose a tunnel, Enter to confirm, Escape to cancel.`}
                onKeyDown={(e) => onPlugKey(e, l.c)}
                style={{ outlineOffset: 4 }} />
            </g>
          );
        })}

        {/* overflow note */}
        {extraCount > 0 && (
          <text x={CL_X - 44} y={H - 14} fontSize="10.5" fill={tc.textMuted}>
            +{extraCount} more client{extraCount === 1 ? '' : 's'} not shown
          </text>
        )}
      </svg>

      {/* ── wire-tap console: JSON → proto3 bytes → topic ── */}
      <div role="status" aria-live="polite" style={{
        marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 10,
        fontFamily: MONO, fontSize: 11.5, lineHeight: 1.7, minHeight: 88,
      }}>
        {!pub ? (
          <div style={{ color: 'var(--text-muted)' }}>
            ▍wire-tap · grab a plug and patch it into another tunnel — the change is encoded as
            proto3 <span style={{ color: 'var(--text-dim)' }}>AppRouteCommand</span> and published to{' '}
            <span style={{ color: 'var(--text-dim)' }}>{source ?? 'rdk'}/approute/control</span>
          </div>
        ) : (
          <div key={pub.seq}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>Δ {pub.label}</span>
              <span style={{ marginLeft: 'auto', color:
                pub.phase === 'ok' ? 'var(--ok)'
                : pub.phase === 'publishing' ? 'var(--text-dim)'
                : pub.phase === 'nolive' ? 'var(--text-muted)'
                : pub.phase === 'offline' ? 'var(--warn)' : 'var(--err)' }}>
                {pub.phase === 'publishing' && '… publishing'}
                {pub.phase === 'ok' && `✓ published · ${pub.topic} · qos1 · ${pub.bytes} B`}
                {pub.phase === 'offline' && `⚠ broker offline — encoded ${pub.bytes} B, not delivered`}
                {pub.phase === 'nolive' && `encoded ${pub.bytes} B — no live gateway on this branch`}
                {pub.phase === 'error' && `✗ ${pub.error ?? 'publish failed'}`}
              </span>
            </div>
            <div title={pub.json} style={{
              color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              json {pub.json}
            </div>
            <div style={{ color: 'var(--text-dim)', maxHeight: 40, overflow: 'hidden' }}>
              <span style={{ color: 'var(--text-muted)' }}>proto3 </span>
              {pub.hex.split(' ').map((b, i) => (
                <span key={i} className={reduceMotion ? undefined : 'apb-hex'}
                  style={reduceMotion ? undefined : { animationDelay: `${Math.min(i * 12, 1100)}ms` }}>
                  {b}{' '}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* legend + provenance */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16,
        marginTop: 8, fontSize: 11, color: 'var(--text-muted)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, height: 2, borderRadius: 2, background: `linear-gradient(90deg, ${catColor('video')}, ${tc.accent})` }} />
          wire color = app's traffic class → tunnel family
        </span>
        <LegendDot color={tc.accent} label="fiber jack" />
        <LegendDot color={tc.accent2} label="5G jack" />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10 }}>
          <span className="badge">{feedChip}</span>
          <span className="badge">{fleetChip}</span>
        </span>
      </div>

      <style>{`
        .apb-dash { animation-name: apbDash; animation-timing-function: linear; animation-iteration-count: infinite; }
        @keyframes apbDash { to { stroke-dashoffset: -36; } }
        .apb-breathe { animation: apbBreathe 4.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        @keyframes apbBreathe { 0%,100% { transform: scale(1); opacity: .04 } 50% { transform: scale(1.12); opacity: .09 } }
        .apb-socket { animation: apbSocket 1.6s ease-in-out infinite; }
        @keyframes apbSocket { 0%,100% { stroke-opacity: .45 } 50% { stroke-opacity: 1 } }
        .apb-hex { opacity: 0; animation: apbHexIn .5s ease forwards; }
        @keyframes apbHexIn { from { opacity: 0 } to { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .apb-dash, .apb-breathe, .apb-socket { animation: none !important; }
          .apb-hex { opacity: 1; animation: none !important; }
        }
      `}</style>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}
