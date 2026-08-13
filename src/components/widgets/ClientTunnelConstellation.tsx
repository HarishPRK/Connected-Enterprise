/**
 * Traffic Constellation — clients → gateway → IPsec tunnels, as a planetary
 * system. The branch gateway (Plano=rdk, McKinney=prpl) is the pulsing core;
 * live clients orbit it on concentric rings (IT upper-left arc, OT lower-left,
 * matching the app's IT=mint / OT=pink language). Each client's traffic is a
 * comet trail that swings through the core and out along its assigned tunnel
 * corridor (fiber1/fiber2/cell1/cell2, fiber-first) toward the cloud transit.
 *
 * Location scoping is STRICT: only devices with locationSource === this
 * branch's source render — Plano (rdk) and McKinney (prpl) never mix.
 *
 * Client↔tunnel assignment: the gateway's protobuf does not yet carry a
 * per-client tunnel binding, so until it does we derive a stable policy
 * preview — IT prefers fiber tunnels, OT prefers 5G, spread per-MAC across
 * reachable tunnels.
 * TODO(protobuf): when `metrics.wifi.clients[].tunnel_ifname` (or equivalent)
 * lands, replace `assignTunnel()` with the wire value.
 */

import { useMemo } from 'react';
import {
  Laptop, Monitor, Printer, CreditCard, Server, PhoneCall,
  Flame, Wind, DoorClosed, Smartphone, Tablet, Cpu, Plug, HelpCircle, Router,
} from 'lucide-react';
import type { Device, IpsecTunnelMetric } from '../../types';
import { useIpsecMetrics } from '../../ui/useIpsecMetrics';
import { useDevices, type DeviceView } from '../../ui/useDevices';
import { useTheme, useThemeColors } from '../../ui/Theme';
import { BRANCH_TO_IPSEC_SOURCE, BRANCH_TO_FAILOVER_TOPIC } from '../../data/mock';

const kindIcon: Record<Device['kind'], React.ComponentType<{ size?: number }>> = {
  laptop: Laptop, desktop: Monitor, printer: Printer, payment: CreditCard,
  server: Server, confphone: PhoneCall,
  fire_sensor: Flame, smoke_sensor: Wind, door_lock: DoorClosed,
  phone: Smartphone, tablet: Tablet, matter: Cpu, shelly: Plug, generic: HelpCircle,
};

const LOCATION_LABEL: Record<string, string> = { rdk: 'Plano', prpl: 'McKinney' };

type TunnelFamily = 'fiber' | 'cell';

interface TunnelSlot {
  t: IpsecTunnelMetric;
  family: TunnelFamily;
  active: boolean;
  y: number;
  color: string;
  clients: number;
}

/** Underlay family from the tunnel ifname (mirrors DynamicPathSelection). */
function familyOf(ifname: string): TunnelFamily {
  const n = (ifname || '').toLowerCase();
  return n.includes('cell') || n.includes('5g') || n.includes('lte') || n.includes('wwan')
    ? 'cell' : 'fiber';
}

/** Stable small hash for per-MAC particle timing + tunnel spread. */
function macHash(mac: string): number {
  let h = 0;
  for (let i = 0; i < mac.length; i++) h = (h * 31 + mac.charCodeAt(i)) >>> 0;
  return h;
}

/** Policy-preview tunnel assignment: IT rides fiber, OT rides 5G, spread
 *  per-MAC across the family's reachable tunnels. Falls back to any reachable
 *  tunnel, then any tunnel. TODO(protobuf): replace with the wire binding. */
function assignTunnel(d: DeviceView, slots: TunnelSlot[]): TunnelSlot | null {
  if (slots.length === 0) return null;
  const fam: TunnelFamily = d.domain === 'IT' ? 'fiber' : 'cell';
  const preferred = slots.filter((s) => s.family === fam && s.t.reachable);
  const reachable = preferred.length ? preferred : slots.filter((s) => s.t.reachable);
  const pool = reachable.length ? reachable : slots;
  return pool[macHash(d.mac) % pool.length];
}

export function ClientTunnelConstellation({ branchId }: { branchId: string }) {
  const tc = useThemeColors();
  const { theme } = useTheme();
  const ipsec = useIpsecMetrics();
  const { devices: allDevices } = useDevices();
  const surface = theme === 'dark' ? 'rgba(14,12,32,0.96)' : '#ffffff';

  const source = BRANCH_TO_IPSEC_SOURCE[branchId] as 'rdk' | 'prpl' | undefined;
  const failoverTopic = BRANCH_TO_FAILOVER_TOPIC[branchId];
  const gw = useMemo(
    () => (failoverTopic
      ? ipsec.list.find((gateway) => gateway.topic === failoverTopic)
      : ipsec.list[0]),
    [failoverTopic, ipsec.list],
  );

  // STRICT location filter — this branch's fleet only (see memory: Plano/McKinney never mix).
  const clients = useMemo(() => {
    const mine = source ? allDevices.filter((d) => d.locationSource === source) : allDevices;
    // Cap per domain so the orbits stay legible; overflow is summarized.
    return {
      it: mine.filter((d) => d.domain === 'IT').slice(0, 6),
      ot: mine.filter((d) => d.domain === 'OT').slice(0, 4),
      itTotal: mine.filter((d) => d.domain === 'IT').length,
      otTotal: mine.filter((d) => d.domain === 'OT').length,
    };
  }, [allDevices, source]);

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // ── Geometry ─────────────────────────────────────────────────────────────
  const W = 900, H = 424;
  const GW = { x: 322, y: 214 };
  const TUN_X = 620, TUN_W = 202, TUN_H = 46;
  const CLOUD = { x: 866, y: GW.y };
  const ORBIT_IN = 168, ORBIT_OUT = 214;

  const tunnels: TunnelSlot[] = useMemo(() => {
    const list = [...(gw?.metrics.tunnels ?? [])].sort((a, b) => {
      const fa = familyOf(a.ifname) === 'cell' ? 1 : 0;
      const fb = familyOf(b.ifname) === 'cell' ? 1 : 0;
      return fa - fb || a.ifname.localeCompare(b.ifname);
    });
    const n = list.length;
    return list.map((t, i) => {
      const family = familyOf(t.ifname);
      return {
        t,
        family,
        active: !!gw && gw.metrics.active_tunnel === t.ifname,
        y: n <= 1 ? GW.y : 70 + i * ((H - 150) / (n - 1)),
        color: family === 'fiber' ? tc.accent : tc.accent2,
        clients: 0,
      };
    });
  }, [gw, tc.accent, tc.accent2]);

  // Place a domain's clients along an arc around the gateway. SVG angles:
  // 0°=+x, 90°=down — so 188°..262° is the upper-left quadrant, 98°..172° lower-left.
  function arcPlace(list: DeviceView[], startDeg: number, endDeg: number) {
    const n = list.length;
    return list.map((d, i) => {
      const deg = startDeg + ((i + 0.5) * (endDeg - startDeg)) / Math.max(n, 1);
      const rad = (deg * Math.PI) / 180;
      const r = n > 4 && i % 2 === 1 ? ORBIT_OUT : ORBIT_IN; // stagger crowded arcs onto the outer ring
      return { d, x: GW.x + r * Math.cos(rad), y: GW.y + r * Math.sin(rad), r };
    });
  }
  const itNodes = arcPlace(clients.it, 190, 262);
  const otNodes = arcPlace(clients.ot, 98, 170);

  const links = useMemo(() => {
    // Re-zero before assigning — this memo re-runs on every device update while
    // the tunnel slots persist, so counts must be rebuilt, not accumulated.
    for (const s of tunnels) s.clients = 0;
    return [...itNodes, ...otNodes].map((n, i) => {
      const slot = assignTunnel(n.d, tunnels);
      if (slot) slot.clients += 1;
      const h = macHash(n.d.mac);
      // Comet path: device → swing through the core → out to the tunnel mouth.
      const midX = (GW.x + 50 + TUN_X) / 2;
      const path = slot
        ? `M ${n.x} ${n.y} Q ${(n.x + GW.x) / 2} ${(n.y + GW.y) / 2} ${GW.x} ${GW.y} ` +
          `C ${midX} ${GW.y}, ${midX} ${slot.y}, ${TUN_X} ${slot.y}`
        : `M ${n.x} ${n.y} Q ${(n.x + GW.x) / 2} ${(n.y + GW.y) / 2} ${GW.x} ${GW.y}`;
      return {
        id: `ctc-p${i}`,
        node: n,
        slot,
        path,
        color: slot ? slot.color : tc.textMuted,
        dur: 2.6 + (h % 15) / 10,      // 2.6–4.0s per orbit-to-exit
        delay: -((h % 24) / 8),        // negative begin de-syncs the fleet
      };
    });
  }, [itNodes, otNodes, tunnels, tc.textMuted]);

  // Deterministic starfield (no Math.random — stable across SSE re-renders).
  const stars = useMemo(
    () => Array.from({ length: 42 }, (_, i) => ({
      x: (i * 167 + 89) % W,
      y: (i * 211 + 53) % H,
      r: 0.6 + (i % 3) * 0.45,
      o: 0.05 + ((i * 7) % 9) / 90,
    })),
    [],
  );

  const topic = failoverTopic ?? 'the gateway feed';

  if (!gw) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        padding: '56px 0', color: 'var(--text-muted)', fontSize: 13,
      }}>
        <span className="ctc-wait-dot" aria-hidden style={{
          width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)',
        }} />
        <div style={{ color: 'var(--text-dim)', fontWeight: 600 }}>Waiting for {topic}</div>
        <div>The constellation lights up when this branch's gateway publishes.</div>
        <style>{`
          .ctc-wait-dot { animation: ctcWait 1.8s ease-in-out infinite; }
          @keyframes ctcWait { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
          @media (prefers-reduced-motion: reduce) { .ctc-wait-dot { animation: none } }
        `}</style>
      </div>
    );
  }

  const gwName = gw.metrics.gateway.name || 'gateway';
  const locChip = source ? `${source} · ${LOCATION_LABEL[source] ?? source}` : gw.source ?? '';

  return (
    <div style={{ position: 'relative', maxWidth: W, margin: '0 auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
        aria-label={`Live clients of the ${locChip} gateway and the IPsec tunnel each one rides`}>
        <defs>
          <filter id="ctc-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="ctc-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={tc.accent} stopOpacity="0.35" />
            <stop offset="60%" stopColor={tc.accent3} stopOpacity="0.10" />
            <stop offset="100%" stopColor={tc.accent3} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ctc-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={tc.accent} stopOpacity="0" />
            <stop offset="100%" stopColor={tc.accent} stopOpacity="0.14" />
          </linearGradient>
        </defs>

        {/* Starfield + orbit guides */}
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={tc.text} opacity={s.o} />
        ))}
        {[ORBIT_IN, ORBIT_OUT].map((r) => (
          <circle key={r} cx={GW.x} cy={GW.y} r={r} fill="none"
            stroke={tc.text} strokeOpacity={0.07} strokeDasharray="2 7" />
        ))}

        {/* Radar sweep — a slow wedge orbiting the core */}
        {!reduceMotion && (
          <g opacity={0.9}>
            <path d={`M ${GW.x} ${GW.y} L ${GW.x - 232} ${GW.y - 46} A 236 236 0 0 0 ${GW.x - 232} ${GW.y + 46} Z`}
              fill="url(#ctc-sweep)">
            </path>
            <animateTransform attributeName="transform" type="rotate"
              from={`0 ${GW.x} ${GW.y}`} to={`360 ${GW.x} ${GW.y}`} dur="14s" repeatCount="indefinite" />
          </g>
        )}
        <circle cx={GW.x} cy={GW.y} r={138} fill="url(#ctc-core)" />

        {/* Comet trails: client → core → tunnel corridor */}
        {links.map((l) => (
          <g key={l.id}>
            <path id={l.id} d={l.path} fill="none"
              stroke={l.color} strokeOpacity={0.3} strokeWidth={1.4}
              strokeDasharray="5 9"
              className={reduceMotion ? undefined : 'ctc-flow'}
              style={reduceMotion ? undefined : { animationDuration: `${l.dur * 0.65}s` }} />
            {!reduceMotion && l.slot && (
              <circle r={2.8} fill={l.color} opacity={0.95}>
                <animateMotion dur={`${l.dur}s`} begin={`${l.delay}s`} repeatCount="indefinite" rotate="0">
                  <mpath href={`#${l.id}`} />
                </animateMotion>
              </circle>
            )}
          </g>
        ))}

        {/* Tunnel corridors */}
        {tunnels.map((s) => (
          <g key={s.t.ifname}>
            {/* corridor → cloud transit */}
            <path d={`M ${TUN_X + TUN_W} ${s.y} C ${TUN_X + TUN_W + 40} ${s.y}, ${CLOUD.x - 60} ${CLOUD.y}, ${CLOUD.x - 22} ${CLOUD.y}`}
              fill="none" stroke={s.color} strokeOpacity={s.active ? 0.4 : 0.12} strokeWidth={s.active ? 1.8 : 1} />
            <rect x={TUN_X} y={s.y - TUN_H / 2} width={TUN_W} height={TUN_H} rx={14}
              fill={surface} stroke={s.color}
              strokeOpacity={s.t.reachable ? (s.active ? 1 : 0.55) : 0.25}
              strokeWidth={s.active ? 1.8 : 1.2}
              filter={s.active ? 'url(#ctc-glow)' : undefined}>
              <title>{`${s.t.ifname} — ${s.t.reachable ? 'reachable' : 'unreachable'} · ${s.t.latency_ms} ms · ${s.t.loss_percent}% loss`}</title>
            </rect>
            {s.active && !reduceMotion && (
              <rect x={TUN_X} y={s.y - TUN_H / 2} width={TUN_W} height={TUN_H} rx={14}
                fill="none" stroke={s.color} strokeWidth={1}>
                <animate attributeName="opacity" values="0.15;0.7;0.15" dur="2.4s" repeatCount="indefinite" />
              </rect>
            )}
            <circle cx={TUN_X + 20} cy={s.y - 8} r={4}
              fill={s.t.reachable ? tc.ok : tc.err} opacity={0.95} />
            <text x={TUN_X + 32} y={s.y - 4} fontSize="13" fontWeight={700}
              fill={s.color} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
              {s.t.ifname}
            </text>
            <text x={TUN_X + 32} y={s.y + 14} fontSize="10.5" fill={tc.textMuted}>
              {s.clients} client{s.clients === 1 ? '' : 's'}{s.active ? ' · active path' : ''}
            </text>
            <text x={TUN_X + TUN_W - 14} y={s.y - 4} textAnchor="end" fontSize="11"
              fill={tc.textDim} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
              {s.t.latency_ms} ms · {s.t.loss_percent}%
            </text>
            <text x={TUN_X + TUN_W - 14} y={s.y + 14} textAnchor="end" fontSize="9.5"
              fill={s.family === 'fiber' ? tc.accent : tc.accent2} fontWeight={700}
              letterSpacing="0.08em">
              {s.family === 'fiber' ? 'FIBER' : '5G'}
            </text>
          </g>
        ))}

        {/* Cloud transit terminus */}
        <circle cx={CLOUD.x} cy={CLOUD.y} r={15} fill={surface} stroke={tc.accent3} strokeWidth={1.3} strokeOpacity={0.7} />
        <text x={CLOUD.x} y={CLOUD.y + 4} textAnchor="middle" fontSize="11" fill={tc.accent3}>☁</text>
        <text x={CLOUD.x} y={CLOUD.y + 32} textAnchor="middle" fontSize="9.5" fill={tc.textMuted}>cloud transit</text>

        {/* Client moons */}
        {[...itNodes, ...otNodes].map(({ d, x, y }) => {
          const color = d.domain === 'IT' ? tc.accent : tc.accent2;
          const Icon = kindIcon[d.kind] ?? HelpCircle;
          const label = d.name.length > 14 ? `${d.name.slice(0, 13)}…` : d.name;
          const labelLeft = x < GW.x - 40;
          return (
            <g key={d.id}>
              <circle cx={x} cy={y} r={13} fill={surface} stroke={color}
                strokeWidth={1.3} strokeOpacity={d.status === 'err' ? 0.3 : 0.85}>
                <title>{`${d.name} · ${d.domain} · ${d.ip} · ${d.status}`}</title>
              </circle>
              {d.status !== 'ok' && (
                <circle cx={x + 10} cy={y - 10} r={3} fill={d.status === 'err' ? tc.err : tc.warn} />
              )}
              <foreignObject x={x - 7} y={y - 7} width={14} height={14} style={{ pointerEvents: 'none' }}>
                <div style={{ color, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={10} />
                </div>
              </foreignObject>
              <text x={labelLeft ? x - 18 : x + 18} y={y + 4}
                textAnchor={labelLeft ? 'end' : 'start'} fontSize="10.5" fontWeight={600} fill={tc.textDim}>
                {label}
              </text>
            </g>
          );
        })}

        {/* Overflow chips when the fleet is larger than the orbits show */}
        {clients.itTotal > clients.it.length && (
          <text x={12} y={32} fontSize="9.5" fill={tc.textMuted}>
            +{clients.itTotal - clients.it.length} more IT
          </text>
        )}
        {clients.otTotal > clients.ot.length && (
          <text x={12} y={H - 24} fontSize="9.5" fill={tc.textMuted}>
            +{clients.otTotal - clients.ot.length} more OT
          </text>
        )}

        {/* Gateway core */}
        {!reduceMotion && (
          <circle cx={GW.x} cy={GW.y} r={36} fill="none" stroke={tc.accent} strokeWidth={1}>
            <animate attributeName="r" values="30;42;30" dur="3.2s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.5;0;0.5" dur="3.2s" repeatCount="indefinite" />
          </circle>
        )}
        <circle cx={GW.x} cy={GW.y} r={26} fill={surface} stroke={tc.accent} strokeWidth={1.5} filter="url(#ctc-glow)" />
        <foreignObject x={GW.x - 10} y={GW.y - 10} width={20} height={20} style={{ pointerEvents: 'none' }}>
          <div style={{ color: tc.accent, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Router size={16} />
          </div>
        </foreignObject>
        <text x={GW.x} y={GW.y + 44} textAnchor="middle" fontSize="11.5" fontWeight={700} fill={tc.text}>
          {gwName}
        </text>
        <text x={GW.x} y={GW.y + 58} textAnchor="middle" fontSize="9.5" fill={tc.textMuted}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
          {locChip}
        </text>

        {/* Domain arc labels — parked in the canvas corners so they never
            collide with the node labels on the orbits. */}
        <text x={12} y={18} fontSize="9.5" fontWeight={700} letterSpacing="0.1em" fill={tc.accent} opacity={0.8}>IT ORBIT</text>
        <text x={12} y={H - 10} fontSize="9.5" fontWeight={700} letterSpacing="0.1em" fill={tc.accent2} opacity={0.8}>OT ORBIT</text>
      </svg>

      {/* Legend + provenance */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16,
        marginTop: 4, fontSize: 11, color: 'var(--text-muted)',
      }}>
        <LegendDot color={tc.accent} label="IT client" />
        <LegendDot color={tc.accent2} label="OT client" />
        <LegendDot color={tc.ok} label="tunnel reachable" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, height: 2, borderRadius: 2, background: `linear-gradient(90deg, ${tc.accent}, transparent)` }} />
          traffic comet · rides the assigned tunnel
        </span>
        <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>
          client ↔ tunnel map: policy preview until the gateway publishes per-client bindings
        </span>
      </div>

      <style>{`
        .ctc-flow { animation-name: ctcDash; animation-timing-function: linear; animation-iteration-count: infinite; }
        @keyframes ctcDash { to { stroke-dashoffset: -28; } }
        @media (prefers-reduced-motion: reduce) { .ctc-flow { animation: none !important; } }
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
