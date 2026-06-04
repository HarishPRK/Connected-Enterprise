import { useState } from 'react';
import { Card } from '../Card';
import {
  Cable, Radio, Router, Laptop, CreditCard, PhoneCall,
  DoorClosed, Flame, AlertTriangle,
  Globe, Cloud, Sparkles, Database, Shuffle,
} from 'lucide-react';
import { useTheme, useThemeColors } from '../../ui/Theme';
import { devices } from '../../data/mock';
import type { Device } from '../../types';

/* ────────── Architecture
 *
 *   IT pins ──┐                            ┌─Fiber─┐  ╔══T-1 (Voice·Video)══╗
 *             ├─→ Edge Gateway ─→ underlay ┤       │  ╠══T-2 (Business·Web)═╣
 *   OT pins ──┘                            └──5G───┘  ╠══T-3 (IoT·OT)═══════╣ →→ SD-WAN ─┬─→ Internet
 *                                                    ╚══T-4 (Backup·Bulk)══╝            └─→ AWS Cloud
 *
 * Each pin has its OWN bezier into the Edge Gateway (no trunks). WAN → SD-WAN
 * is modelled as 4 parallel IPsec tunnels (2 per underlay) carrying logically
 * separated traffic classes — matches DPS+AAR architecture where each
 * tunnel is monitored against an SLA and rerouted independently.
 */

const W = 1520;
const H = 460;
const NODE_W = 158;
const NODE_H = 90;

type SystemId = 'gateway' | 'fiber' | '5g' | 'sdwan' | 'internet' | 'aws';
type EdgeId =
  | 'gateway→fiber' | 'gateway→5g'
  | 'sdwan→internet' | 'sdwan→aws';
type Status = 'ok' | 'warn' | 'err';

interface SysNode {
  id: SystemId;
  label: string;
  sub: string;
  icons: React.ComponentType<{ size?: number }>[];
  x: number;
  y: number;
  tint: 'primary' | 'secondary' | 'tertiary';
}

/* ── Pin layout ──────────────────────────────────────────────────────────── */
const FEATURED_IDS = ['d1', 'd6', 'd8', 'o1', 'o6', 'o3'] as const;
const PIN_W = 140;
const PIN_H = 32;
const PIN_X = 20;
const PIN_GAP_Y = 12;
const IT_FIRST_Y = 70;
const OT_FIRST_Y = 264;

const GW_CX = 330;
const GW_CY = 230;
const SDWAN_X = 1020;
const NODES: SysNode[] = [
  {
    id: 'gateway', label: 'Edge Gateway', sub: 'CE-GW-500 · DHCP · L3 · FW',
    icons: [Router],
    x: GW_CX, y: GW_CY - NODE_H / 2, tint: 'primary',
  },
  {
    id: 'fiber', label: 'Fiber', sub: 'ISP-A · 1 Gbps primary',
    icons: [Cable],
    x: 560, y: 60, tint: 'primary',
  },
  {
    id: '5g', label: '5G', sub: 'Carrier · n78 · standby',
    icons: [Radio],
    x: 560, y: H - 60 - NODE_H, tint: 'secondary',
  },
  {
    id: 'sdwan', label: 'SD-WAN', sub: 'multi-WAN · policy steering',
    icons: [Shuffle],
    x: SDWAN_X, y: GW_CY - NODE_H / 2, tint: 'primary',
  },
  {
    id: 'internet', label: 'Internet Public', sub: '1.1.1.1 · 12 ms · TLS / SaaS',
    icons: [Globe],
    x: W - NODE_W - 20, y: 60, tint: 'secondary',
  },
  {
    id: 'aws', label: 'AWS Cloud', sub: 'us-east-1 · Bedrock · S3',
    icons: [Cloud, Sparkles, Database],
    x: W - NODE_W - 20, y: H - 60 - NODE_H, tint: 'tertiary',
  },
];

/* ── Per-node color profile (overrides the global accent palette so each
 *    system node gets its own visual identity). ── */
const NODE_COLOR: Record<SystemId, string> = {
  gateway:  '#7cffd4',  // mint   — IT-themed primary
  fiber:    '#5ac8ff',  // sky    — fiber-optic blue
  '5g':     '#ffa07c',  // peach  — wireless warm
  sdwan:    '#c084fc',  // violet — the brain
  internet: '#a5f3fc',  // cyan   — public reach
  aws:      '#ff9f43',  // orange — AWS brand
};

interface SystemEdge {
  id: EdgeId;
  from: SystemId;
  to: SystemId;
  label: string;
  sub?: string;
}

const SYSTEM_EDGES: SystemEdge[] = [
  { id: 'gateway→fiber',  from: 'gateway',  to: 'fiber',    label: 'WAN-1',        sub: 'underlay' },
  { id: 'gateway→5g',     from: 'gateway',  to: '5g',       label: 'WAN-2',        sub: 'underlay' },
  { id: 'sdwan→internet', from: 'sdwan',    to: 'internet', label: 'WAN egress',   sub: 'public' },
  { id: 'sdwan→aws',      from: 'sdwan',    to: 'aws',      label: 'Cloud OnRamp', sub: 'VPN → TGW' },
];

/* ── IPsec tunnel manifolds — IT and OT, separately ─────────────────────
 * Two stacked racks between the WAN underlays and SD-WAN. The IT manifold
 * (top) holds the IT traffic-class tunnels and is fed by the Fiber underlay;
 * the OT manifold (bottom) holds the OT tunnels and is fed by 5G. This makes
 * the domain split visible at a glance and matches how the gateway actually
 * segregates traffic (different policies, different VLANs, different SLAs). */
const IT_MANIFOLD = { x: 755, y: 158, w: 210, h: 84 };
const OT_MANIFOLD = { x: 755, y: 256, w: 210, h: 84 };
const PILL_W = 184;
const PILL_H = 24;
const PILL_X = IT_MANIFOLD.x + (IT_MANIFOLD.w - PILL_W) / 2;

interface Tunnel {
  id: string;
  domain: 'IT' | 'OT';
  wan: 'fiber' | '5g';
  name: string;
  traffic: string;
  /** Top-Y of the pill rectangle. */
  pillY: number;
  /** Y position at SD-WAN's left edge where this tunnel terminates. */
  sdwanLandingY: number;
}

const SDWAN_TOP = GW_CY - NODE_H / 2;            // 185
const SDWAN_BOT = GW_CY + NODE_H / 2;            // 275

const TUNNELS: Tunnel[] = [
  // IT manifold (top) — fed by Fiber
  { id: 't-it-1',  domain: 'IT', wan: 'fiber', name: 'T-1', traffic: 'Voice · Video',     pillY: 184, sdwanLandingY: SDWAN_TOP + 12 },
  { id: 't-it-2',  domain: 'IT', wan: 'fiber', name: 'T-2', traffic: 'Business · Web',    pillY: 212, sdwanLandingY: SDWAN_TOP + 30 },
  // OT manifold (bottom) — fed by 5G
  { id: 't-ot-1',  domain: 'OT', wan: '5g',    name: 'T-3', traffic: 'IoT telemetry',     pillY: 282, sdwanLandingY: SDWAN_BOT - 30 },
  { id: 't-ot-2',  domain: 'OT', wan: '5g',    name: 'T-4', traffic: 'OT control · alarms', pillY: 310, sdwanLandingY: SDWAN_BOT - 12 },
];

interface Scenario {
  id: string;
  label: string;
  banner: string;
  nodes: Partial<Record<SystemId, Status>>;
  edges: Partial<Record<EdgeId, Status>>;
  /** Which WAN underlay is currently carrying traffic. */
  activeWan: 'fiber' | '5g';
}

const SCENARIOS: Scenario[] = [
  {
    id: 'healthy',
    label: 'All healthy',
    banner: 'All systems nominal · Fiber active, 5G standby',
    nodes: {}, edges: {},
    activeWan: 'fiber',
  },
  {
    id: 'aws-degraded',
    label: 'AWS region degraded',
    banner: 'AWS Bedrock control-plane degraded · internet healthy',
    nodes: { aws: 'warn' },
    edges: { 'sdwan→aws': 'warn' },
    activeWan: 'fiber',
  },
  {
    id: '5g-failover',
    label: '5G failover active',
    banner: 'Fiber down · 5G tunnels carrying all traffic at reduced throughput',
    nodes: { fiber: 'err', '5g': 'warn' },
    edges: { 'gateway→fiber': 'err' },
    activeWan: '5g',
  },
  {
    id: 'isp-outage',
    label: 'Internet ISP outage',
    banner: 'Public ISP unreachable · AWS still routable via overlay',
    nodes: { internet: 'err' },
    edges: { 'sdwan→internet': 'err' },
    activeWan: 'fiber',
  },
];

const DEFAULT_STATUS: Status = 'ok';

const ICON_FOR_KIND: Record<Device['kind'], React.ComponentType<{ size?: number }>> = {
  laptop: Laptop,
  desktop: Laptop,
  printer: Laptop,
  payment: CreditCard,
  server: Laptop,
  confphone: PhoneCall,
  fire_sensor: Flame,
  smoke_sensor: AlertTriangle,
  door_lock: DoorClosed,
  phone: PhoneCall,
  tablet: Laptop,
  matter: AlertTriangle,
  shelly: CreditCard,
  generic: Laptop,
};

interface PinLayout {
  device: Device;
  x: number;
  y: number;
  gatewayLandingY: number;
}

/* ── Inline SVG illustrations for each system node ─────────────────────
 * Each variant draws a small (≈70×34) iconographic illustration in the
 * node's own colour. Lives inside the parent node's <g>, transformed to
 * the icon slot (translate cx, y+55). */
function NodeIllustration({
  id, color, okColor, warnColor,
}: {
  id: SystemId;
  color: string;
  okColor: string;
  warnColor: string;
}) {
  switch (id) {
    case 'gateway':
      return (
        <g>
          {/* antennas */}
          <line x1={-16} y1={-22} x2={-19} y2={-30} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
          <line x1={0}   y1={-22} x2={0}   y2={-32} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
          <line x1={16}  y1={-22} x2={19}  y2={-30} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
          <circle cx={-19} cy={-30} r={1.5} fill={color} />
          <circle cx={0}   cy={-32} r={1.5} fill={color} />
          <circle cx={19}  cy={-30} r={1.5} fill={color} />
          {/* router body */}
          <rect x={-28} y={-22} width={56} height={20} rx={3.5} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={1.2} />
          {/* LEDs */}
          <circle cx={-18} cy={-16} r={1.6} fill={okColor} />
          <circle cx={-9}  cy={-16} r={1.6} fill={okColor} />
          <circle cx={0}   cy={-16} r={1.6} fill={warnColor} />
          <circle cx={9}   cy={-16} r={1.6} fill={okColor} />
          <circle cx={18}  cy={-16} r={1.6} fill={okColor} />
          {/* RJ45 port slots */}
          <rect x={-22} y={-9} width={8} height={3.5} rx={0.6} fill={color} fillOpacity={0.45} />
          <rect x={-12} y={-9} width={8} height={3.5} rx={0.6} fill={color} fillOpacity={0.45} />
          <rect x={-2}  y={-9} width={8} height={3.5} rx={0.6} fill={color} fillOpacity={0.45} />
          <rect x={8}   y={-9} width={8} height={3.5} rx={0.6} fill={color} fillOpacity={0.45} />
        </g>
      );
    case 'fiber':
      return (
        <g>
          {/* SC connector (left) */}
          <rect x={-30} y={-12} width={10} height={10} rx={1} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.2} />
          <rect x={-26} y={-9}  width={6}  height={4}  rx={0.5} fill={color} />
          {/* fiber strand (cable) */}
          <path d="M -20 -7 C -8 -7, -8 -7, 0 -7 S 12 -7, 22 -7"
            stroke={color} strokeWidth={2.4} fill="none" opacity={0.35} />
          <path d="M -20 -7 C -8 -7, -8 -7, 0 -7 S 12 -7, 22 -7"
            stroke={color} strokeWidth={1.1} fill="none" opacity={1} />
          {/* glowing terminator (right) */}
          <circle cx={22} cy={-7} r={5} fill={color} fillOpacity={0.18} />
          <circle cx={22} cy={-7} r={3} fill={color} />
          <circle cx={22} cy={-7} r={1.2} fill="#ffffff" />
        </g>
      );
    case '5g':
      return (
        <g>
          {/* mast */}
          <line x1={0} y1={-30} x2={0} y2={-6} stroke={color} strokeWidth={1.8} />
          <polygon points="-7,-6 7,-6 0,-30" fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.1} />
          <circle cx={0} cy={-30} r={2.5} fill={color} />
          {/* signal waves */}
          <path d="M -10 -30 A 10 10 0 0 1 10 -30" stroke={color} strokeWidth={1.4} fill="none" opacity={0.85} />
          <path d="M -16 -30 A 16 16 0 0 1 16 -30" stroke={color} strokeWidth={1.2} fill="none" opacity={0.55} />
          <path d="M -22 -30 A 22 22 0 0 1 22 -30" stroke={color} strokeWidth={1}   fill="none" opacity={0.3} />
          {/* ground line */}
          <line x1={-12} y1={-4} x2={12} y2={-4} stroke={color} strokeWidth={1} opacity={0.5} />
        </g>
      );
    case 'sdwan':
      return (
        <g>
          {/* central hub */}
          <circle cx={0} cy={-15} r={7} fill={color} fillOpacity={0.20} stroke={color} strokeWidth={1.5} />
          <circle cx={0} cy={-15} r={2.5} fill={color} />
          {/* radiating paths */}
          <path d="M -7 -19 L -22 -26" stroke={color} strokeWidth={1.2} />
          <path d="M  7 -19 L  22 -26" stroke={color} strokeWidth={1.2} />
          <path d="M -7 -11 L -22  -2" stroke={color} strokeWidth={1.2} />
          <path d="M  7 -11 L  22  -2" stroke={color} strokeWidth={1.2} />
          {/* endpoint dots */}
          <circle cx={-22} cy={-26} r={2} fill={color} />
          <circle cx={ 22} cy={-26} r={2} fill={color} />
          <circle cx={-22} cy={ -2} r={2} fill={color} />
          <circle cx={ 22} cy={ -2} r={2} fill={color} />
        </g>
      );
    case 'internet':
      return (
        <g>
          <circle cx={0} cy={-14} r={14} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={1.4} />
          {/* latitude lines */}
          <ellipse cx={0} cy={-14} rx={14} ry={5} fill="none" stroke={color} strokeWidth={0.9} opacity={0.6} />
          <ellipse cx={0} cy={-14} rx={14} ry={9} fill="none" stroke={color} strokeWidth={0.8} opacity={0.4} />
          {/* longitude (centre + 2 curved) */}
          <line x1={0} y1={-28} x2={0} y2={0} stroke={color} strokeWidth={0.9} opacity={0.55} />
          <path d="M -10 -25 Q -14 -14 -10 -3" stroke={color} strokeWidth={0.8} fill="none" opacity={0.45} />
          <path d="M  10 -25 Q  14 -14  10 -3" stroke={color} strokeWidth={0.8} fill="none" opacity={0.45} />
        </g>
      );
    case 'aws':
      return (
        <g>
          {/* cloud shape */}
          <path
            d="M -24 -6
               C -24 -16, -12 -20, -6 -16
               C -2 -22, 8 -22, 12 -16
               C 20 -18, 26 -10, 22 -4
               C 24 0, 18 4, 12 4
               L -12 4
               C -24 4, -28 -2, -24 -6 Z"
            fill={color} fillOpacity={0.14}
            stroke={color} strokeWidth={1.4}
          />
          {/* service "cubes" inside */}
          <rect x={-10} y={-10} width={6} height={6} rx={0.6} fill={color} opacity={0.75} />
          <rect x={-2}  y={-10} width={6} height={6} rx={0.6} fill={color} opacity={0.75} />
          <rect x={6}   y={-10} width={6} height={6} rx={0.6} fill={color} opacity={0.75} />
          {/* small pulsing AWS dot */}
          <circle cx={0} cy={-2} r={1.6} fill="#ffffff" opacity={0.85} />
        </g>
      );
  }
}

/* ── Path-tracer + click-to-inspect types ──────────────────────────────── */

type SelectedElement =
  | { kind: 'pin'; id: string }
  | { kind: 'node'; id: SystemId }
  | { kind: 'tunnel'; id: string }
  | null;

interface TraceHop {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Cubic bezier d-string for this hop (so highlight matches the existing
   *  edge curves). */
  d: string;
  label: string;
  /** Cumulative latency at the end of this hop. */
  latencyMs: number;
  /** Per-hop incremental latency. */
  hopMs: number;
}

interface TracedPath {
  source: string;     // device id
  destId: 'internet' | 'aws';
  tunnelId: string;
  hops: TraceHop[];
  totalMs: number;
  /** Full concatenated path d-string used to animate the particle through
   *  the whole route in one continuous motion. */
  fullD: string;
}

const TRACE_COLOR = '#facc15';   // golden yellow — stands out from mint/pink/violet

export function Topology({ autoScenarioId }: { autoScenarioId?: string | null } = {}) {
  const c = useThemeColors();
  const { theme } = useTheme();
  // `manualScenarioId` is the user's explicit chip pick. When it's `null`,
  // we follow `autoScenarioId` from live data (or default to 'healthy').
  const [manualScenarioId, setManualScenarioId] = useState<string | null>(null);
  const scenarioId = manualScenarioId ?? autoScenarioId ?? 'healthy';
  const setScenarioId = setManualScenarioId;
  const [selected, setSelected] = useState<SelectedElement>(null);
  const [traceSrc, setTraceSrc] = useState<string>('d1');         // Lap-John default
  const [traceDest, setTraceDest] = useState<'internet' | 'aws'>('aws');
  const [tracedPath, setTracedPath] = useState<TracedPath | null>(null);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const nodeStatus = (id: SystemId): Status => scenario.nodes[id] ?? DEFAULT_STATUS;
  const edgeStatus = (id: EdgeId): Status => scenario.edges[id] ?? 'ok';

  // With IT/OT domain-separated tunnels, BOTH underlays are independently
  // active in normal operation (IT goes via Fiber, OT goes via 5G). An
  // underlay edge is only "standby" when its WAN node is degraded or down.
  const isActiveWanEdge = (e: EdgeId): boolean => {
    if (e === 'gateway→fiber') return nodeStatus('fiber') === 'ok';
    if (e === 'gateway→5g')    return nodeStatus('5g')    === 'ok';
    return false;
  };
  const isStandbyWanEdge = (e: EdgeId): boolean => {
    if (e === 'gateway→fiber') return nodeStatus('fiber') === 'warn';
    if (e === 'gateway→5g')    return nodeStatus('5g')    === 'warn';
    return false;
  };

  const surface    = theme === 'dark' ? 'rgba(14,12,32,0.95)' : '#ffffff';
  const subSurface = theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)';
  const groupBg    = theme === 'dark' ? 'rgba(255,255,255,0.025)' : 'rgba(15,23,42,0.025)';
  const groupStroke= theme === 'dark' ? 'rgba(255,255,255,0.08)'  : 'rgba(15,23,42,0.08)';

  const byId = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<SystemId, SysNode>;

  const colorFor = (s: Status) => (s === 'ok' ? c.ok : s === 'warn' ? c.warn : c.err);
  // Each system node gets its own brand colour from NODE_COLOR (defined at
  // module scope). The result is a more varied palette than the previous
  // 3-accent rotation — fiber=sky, 5G=peach, SD-WAN=violet, AWS=orange, etc.
  const tintForSys = (n: SysNode) => NODE_COLOR[n.id];

  const rightOf = (n: SysNode) => ({ x: n.x + NODE_W, y: n.y + NODE_H / 2 });
  const leftOf  = (n: SysNode) => ({ x: n.x,          y: n.y + NODE_H / 2 });

  /* ── Pins ──────────────────────────────────────────────────────────── */
  const featured = FEATURED_IDS.map((id) => devices.find((d) => d.id === id)).filter(
    (d): d is Device => Boolean(d),
  );
  const itDevices = featured.filter((d) => d.domain === 'IT');
  const otDevices = featured.filter((d) => d.domain === 'OT');

  const gw = byId.gateway;
  const gwLeft = leftOf(gw);
  const FAN_BAND_HALF = 32;
  const itLandTopY = gw.y + NODE_H / 2 - FAN_BAND_HALF;
  const itLandBotY = gw.y + NODE_H / 2 - FAN_BAND_HALF / 4;
  const otLandTopY = gw.y + NODE_H / 2 + FAN_BAND_HALF / 4;
  const otLandBotY = gw.y + NODE_H / 2 + FAN_BAND_HALF;

  const itLandY = (i: number, n: number) =>
    n === 1 ? (itLandTopY + itLandBotY) / 2
    : itLandTopY + ((itLandBotY - itLandTopY) * i) / (n - 1);
  const otLandY = (i: number, n: number) =>
    n === 1 ? (otLandTopY + otLandBotY) / 2
    : otLandTopY + ((otLandBotY - otLandTopY) * i) / (n - 1);

  const itPins: PinLayout[] = itDevices.map((d, i) => ({
    device: d,
    x: PIN_X,
    y: IT_FIRST_Y + i * (PIN_H + PIN_GAP_Y),
    gatewayLandingY: itLandY(i, itDevices.length),
  }));
  const otPins: PinLayout[] = otDevices.map((d, i) => ({
    device: d,
    x: PIN_X,
    y: OT_FIRST_Y + i * (PIN_H + PIN_GAP_Y),
    gatewayLandingY: otLandY(i, otDevices.length),
  }));

  const groupBoxX = PIN_X - 10;
  const groupBoxW = PIN_W + 24;
  const itBoxY    = IT_FIRST_Y - 32;
  const itBoxH    = itPins.length * (PIN_H + PIN_GAP_Y) + 38;
  const otBoxY    = OT_FIRST_Y - 32;
  const otBoxH    = otPins.length * (PIN_H + PIN_GAP_Y) + 38;

  const durFor = (status: Status, role: 'active' | 'standby' | 'egress' | 'access'): string | undefined => {
    if (status === 'err') return undefined;
    if (status === 'warn') return '2.6s';
    switch (role) {
      case 'active':   return '1.0s';
      case 'standby':  return '4.0s';
      case 'egress':   return '1.4s';
      case 'access':   return '2.0s';
    }
  };

  /* ── Path tracer ── */

  // Build a smooth cubic bezier between two points using horizontal control
  // handles (matches the visual style of the existing edge curves).
  const beziD = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const cx1 = a.x + (b.x - a.x) * 0.55;
    const cx2 = a.x + (b.x - a.x) * 0.45;
    return `M ${a.x} ${a.y} C ${cx1} ${a.y}, ${cx2} ${b.y}, ${b.x} ${b.y}`;
  };

  function computeTrace(sourceId: string, dest: 'internet' | 'aws'): TracedPath | null {
    const pin = [...itPins, ...otPins].find((p) => p.device.id === sourceId);
    if (!pin) return null;

    // Pick which tunnel carries this traffic — domain + kind drive the policy.
    let tunnelId: string;
    if (pin.device.domain === 'IT') {
      // Voice/Video class for confphone, otherwise Business/Web
      tunnelId = pin.device.kind === 'confphone' ? 't-it-1' : 't-it-2';
    } else {
      // Door locks → OT control (T-4); sensors → IoT telemetry (T-3)
      tunnelId = pin.device.kind === 'door_lock' ? 't-ot-2' : 't-ot-1';
    }
    const tunnel = TUNNELS.find((t) => t.id === tunnelId);
    if (!tunnel) return null;

    const underlay = byId[tunnel.wan];
    const sdwan = byId.sdwan;
    const destNode = byId[dest];

    const pinRight = { x: pin.x + PIN_W, y: pin.y + PIN_H / 2 };
    const gwIn = { x: gwLeft.x, y: pin.gatewayLandingY };
    const gwOut = rightOf(gw);
    const ulIn = leftOf(underlay);
    const ulOut = rightOf(underlay);
    const tunLeft = { x: PILL_X, y: tunnel.pillY + PILL_H / 2 };
    const tunRight = { x: PILL_X + PILL_W, y: tunnel.pillY + PILL_H / 2 };
    const sdwanIn = { x: SDWAN_X, y: tunnel.sdwanLandingY };
    const sdwanOut = rightOf(sdwan);
    const destIn = leftOf(destNode);

    // Per-hop latency budget (realistic-ish ms numbers)
    const hopLat = {
      h1: 0.4,    // LAN
      h2: 0.6,    // gateway → underlay (internal)
      h3: tunnel.wan === 'fiber' ? 3.5 : 7.0,  // underlay carrier + IPsec encap
      h4: 1.2,    // overlay tunnel → sdwan controller
      h5: dest === 'aws' ? 9.5 : 7.0,           // egress to destination
    };

    const hops: TraceHop[] = [
      { id: 'h1', from: pinRight, to: gwIn,    d: beziD(pinRight, gwIn),
        label: pin.device.domain === 'IT' ? 'LAN' : 'OT VLAN 20',
        hopMs: hopLat.h1, latencyMs: hopLat.h1 },
      { id: 'h2', from: gwOut,    to: ulIn,    d: beziD(gwOut, ulIn),
        label: tunnel.wan === 'fiber' ? 'WAN-1 (Fiber)' : 'WAN-2 (5G)',
        hopMs: hopLat.h2, latencyMs: hopLat.h1 + hopLat.h2 },
      { id: 'h3', from: ulOut,    to: tunLeft, d: beziD(ulOut, tunLeft),
        label: `${tunnel.name} · ${tunnel.traffic}`,
        hopMs: hopLat.h3, latencyMs: hopLat.h1 + hopLat.h2 + hopLat.h3 },
      { id: 'h4', from: tunRight, to: sdwanIn, d: beziD(tunRight, sdwanIn),
        label: 'overlay → SD-WAN',
        hopMs: hopLat.h4, latencyMs: hopLat.h1 + hopLat.h2 + hopLat.h3 + hopLat.h4 },
      { id: 'h5', from: sdwanOut, to: destIn,  d: beziD(sdwanOut, destIn),
        label: dest === 'aws' ? 'Cloud OnRamp → AWS' : 'WAN egress → Internet',
        hopMs: hopLat.h5, latencyMs: hopLat.h1 + hopLat.h2 + hopLat.h3 + hopLat.h4 + hopLat.h5 },
    ];

    // Concatenate hops into one continuous path so a single particle can flow
    // through the whole route. Use the SAME M-prefix per segment — animateMotion
    // will hop between segment ends (which coincide with node entries / exits),
    // visually equivalent to the particle traversing the node.
    const fullD = hops.map((h) => h.d).join(' ');

    return {
      source: sourceId,
      destId: dest,
      tunnelId,
      hops,
      totalMs: hops[hops.length - 1].latencyMs,
      fullD,
    };
  }

  function runTrace() {
    const trace = computeTrace(traceSrc, traceDest);
    setTracedPath(trace);
    // Clicking trace also surfaces a "trace" inspector view, but to keep
    // things consistent we just close any other selection.
    setSelected(null);
  }

  function clearTrace() {
    setTracedPath(null);
  }

  return (
    <Card
      title="Network Topology"
      sub={`IT/OT endpoints → Edge Gateway → underlays (Fiber+5G) → IPsec tunnels → SD-WAN → {Internet, AWS} · ${scenario.banner}`}
      right={<span className="badge"><span className="dot ok" /> Streaming</span>}
    >
      {/* Scenario chip group.
          The first "Auto" chip is special: it tracks live IPsec state when
          `autoScenarioId` is supplied. Picking any other chip locks in a
          manual override; clicking "Auto" again clears that override. */}
      <div className="toolbar" style={{ marginTop: -2, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginRight: 4 }}>
          Scenario
        </span>
        {autoScenarioId != null && (
          <button
            key="auto"
            onClick={() => setScenarioId(null)}
            title={`Auto · tracking live (${autoScenarioId})`}
            style={manualScenarioId == null
              ? { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }
              : undefined}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="dot ok" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)' }} />
              Auto · live
            </span>
          </button>
        )}
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => setScenarioId(s.id)}
            style={s.id === scenarioId && manualScenarioId != null
              ? { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }
              : undefined}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Path tracer controls */}
      <div className="toolbar" style={{ alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          Trace path
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>from</span>
        <select
          value={traceSrc}
          onChange={(e) => setTraceSrc(e.target.value)}
          style={{ minWidth: 160, fontSize: 12.5, padding: '4px 8px' }}
        >
          {[...itPins, ...otPins].map((p) => (
            <option key={p.device.id} value={p.device.id}>
              {p.device.name} ({p.device.domain})
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>to</span>
        <select
          value={traceDest}
          onChange={(e) => setTraceDest(e.target.value as 'internet' | 'aws')}
          style={{ minWidth: 140, fontSize: 12.5, padding: '4px 8px' }}
        >
          <option value="aws">AWS Cloud</option>
          <option value="internet">Internet Public</option>
        </select>
        <button
          onClick={runTrace}
          className="primary"
          style={{ padding: '5px 12px', fontSize: 12.5 }}
        >
          Trace
        </button>
        {tracedPath && (
          <button onClick={clearTrace} style={{ padding: '5px 12px', fontSize: 12.5 }}>
            Clear
          </button>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', maxHeight: 480, display: 'block' }}
      >
        <defs>
          {(['ok', 'warn', 'err'] as Status[]).map((s) => (
            <marker
              key={`arr-${s}`}
              id={`arr-${s}`}
              viewBox="0 0 10 10"
              refX="9" refY="5"
              markerWidth="6" markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={colorFor(s)} />
            </marker>
          ))}
          <filter id="node-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="soft-glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ── Group bounding rectangles ── */}
        <rect
          x={groupBoxX} y={itBoxY}
          width={groupBoxW} height={itBoxH}
          rx={12} fill={groupBg}
          stroke={groupStroke} strokeDasharray="4 4" strokeWidth={1}
        />
        <rect
          x={groupBoxX} y={otBoxY}
          width={groupBoxW} height={otBoxH}
          rx={12} fill={groupBg}
          stroke={groupStroke} strokeDasharray="4 4" strokeWidth={1}
        />

        <g transform={`translate(${groupBoxX + 12} ${itBoxY + 18})`}>
          <rect x={-4} y={-11} width={26} height={16} rx={4} fill={c.accent} opacity={0.16} />
          <text fontSize="11.5" fontWeight={700} fill={c.accent} y={1}>IT</text>
          <text fontSize="10" fill={c.textMuted} x={32} y={1}>
            {itDevices.length} endpoints
          </text>
        </g>
        <g transform={`translate(${groupBoxX + 12} ${otBoxY + 18})`}>
          <rect x={-4} y={-11} width={26} height={16} rx={4} fill={c.accent2} opacity={0.16} />
          <text fontSize="11.5" fontWeight={700} fill={c.accent2} y={1}>OT</text>
          <text fontSize="10" fill={c.textMuted} x={32} y={1}>
            {otDevices.length} sensors / locks
          </text>
        </g>

        {/* ── Pin → Edge Gateway (one bezier per pin) ─────────────────── */}
        {[...itPins, ...otPins].map((p) => {
          const isIT = p.device.domain === 'IT';
          const tint = isIT ? c.accent : c.accent2;
          const isErr = p.device.status === 'err';
          const isWarn = p.device.status === 'warn';
          const stroke = isErr ? c.err : isWarn ? c.warn : tint;
          const dur = durFor(isErr ? 'err' : isWarn ? 'warn' : 'ok', 'access');

          const start = { x: p.x + PIN_W, y: p.y + PIN_H / 2 };
          const end   = { x: gwLeft.x,    y: p.gatewayLandingY };
          const cx1 = start.x + (end.x - start.x) * 0.55;
          const cx2 = start.x + (end.x - start.x) * 0.45;
          const d = `M ${start.x} ${start.y} C ${cx1} ${start.y}, ${cx2} ${end.y}, ${end.x} ${end.y}`;

          return (
            <g key={`fanin-${p.device.id}`}>
              <path
                d={d}
                stroke={stroke} strokeWidth={1.6} fill="none"
                opacity={isErr ? 0.4 : 0.75}
                strokeDasharray={isErr ? '3 5' : undefined}
              />
              {dur && (
                <path
                  d={d}
                  stroke={stroke} strokeWidth={1.2} fill="none"
                  strokeDasharray="3 6" opacity={0.6}
                >
                  <animate attributeName="stroke-dashoffset" values="0;-18" dur={dur} repeatCount="indefinite" />
                </path>
              )}
              {dur && !isErr && (
                <circle r="3" fill={stroke} opacity={0.9} filter="url(#node-glow)">
                  <animateMotion dur={dur} repeatCount="indefinite" path={d} />
                </circle>
              )}
              <circle cx={end.x} cy={end.y} r={2.5} fill={stroke} opacity={isErr ? 0.5 : 0.9} />
            </g>
          );
        })}

        {/* ── Device pins ─────────────────────────────────────────────── */}
        {[...itPins, ...otPins].map((p) => {
          const isIT = p.device.domain === 'IT';
          const tint = isIT ? c.accent : c.accent2;
          const statusColor = colorFor(p.device.status === 'off' ? 'err' : p.device.status);
          const Icon = ICON_FOR_KIND[p.device.kind] ?? Laptop;
          const isSelected = selected?.kind === 'pin' && selected.id === p.device.id;
          return (
            <g key={`pin-${p.device.id}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelected(isSelected ? null : { kind: 'pin', id: p.device.id })}
            >
              {p.device.status !== 'ok' && (
                <rect
                  x={p.x - 3} y={p.y - 3}
                  width={PIN_W + 6} height={PIN_H + 6}
                  rx={9} fill={statusColor} opacity={0.14} filter="url(#soft-glow)"
                />
              )}
              {isSelected && (
                <rect
                  x={p.x - 4} y={p.y - 4}
                  width={PIN_W + 8} height={PIN_H + 8}
                  rx={10} fill="none" stroke={tint} strokeWidth={2} opacity={0.95}
                />
              )}
              <rect
                x={p.x} y={p.y}
                width={PIN_W} height={PIN_H}
                rx={7}
                fill={surface}
                stroke={p.device.status === 'ok' ? groupStroke : statusColor}
                strokeWidth={p.device.status === 'ok' ? 1 : 1.4}
              />
              <rect
                x={p.x + 1} y={p.y + 1}
                width={3} height={PIN_H - 2}
                rx={1.5} fill={tint} opacity={0.85}
              />
              <g transform={`translate(${p.x + 14} ${p.y + PIN_H / 2})`}>
                <circle r={9} fill={subSurface} />
                <foreignObject x={-7} y={-7} width="14" height="14">
                  <div style={{ color: tint, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={12} />
                  </div>
                </foreignObject>
              </g>
              <text
                x={p.x + 30} y={p.y + PIN_H / 2 + 3.5}
                fontSize="11" fontWeight={600} fill={c.text}
              >
                {p.device.name}
              </text>
              <g transform={`translate(${p.x + PIN_W - 10} ${p.y + PIN_H / 2})`}>
                <circle r={3} fill={statusColor}>
                  {p.device.status !== 'ok' && (
                    <animate attributeName="opacity" values="1;0.35;1" dur="1.4s" repeatCount="indefinite" />
                  )}
                </circle>
              </g>
              <title>{p.device.name} · {p.device.kind} · {p.device.ip} · {p.device.status}</title>
            </g>
          );
        })}

        {/* ── System edges (gateway→fiber, gateway→5g, sdwan→internet, sdwan→aws) ── */}
        {SYSTEM_EDGES.map((e) => {
          const A = byId[e.from], B = byId[e.to];
          const start = rightOf(A);
          const end   = leftOf(B);
          const status = edgeStatus(e.id);
          const isActive  = isActiveWanEdge(e.id);
          const isStandby = isStandbyWanEdge(e.id);
          const role: 'active' | 'standby' | 'egress' | 'access' =
            isActive ? 'active' : isStandby ? 'standby' : 'egress';

          const stroke = colorFor(status);
          const dur = durFor(status, role);
          const strokeW =
            status === 'err'  ? 1.8 :
            isActive          ? 3.2 :
            isStandby         ? 1.5 :
                                2.5;
          const baseOpacity =
            status === 'err'  ? 0.55 :
            isStandby         ? 0.45 :
                                0.95;

          const cx1 = start.x + (end.x - start.x) * 0.55;
          const cx2 = start.x + (end.x - start.x) * 0.45;
          const d = `M ${start.x} ${start.y} C ${cx1} ${start.y}, ${cx2} ${end.y}, ${end.x} ${end.y}`;

          const dy = end.y - start.y;
          const labelX = (start.x + end.x) / 2;
          const labelY =
            Math.abs(dy) < 4
              ? start.y - 18
              : (start.y + end.y) / 2 + (dy > 0 ? -3 : 3);

          const charW = 5.6;
          const padX = 10;
          const labelLen = e.label.length;
          const subLen = (e.sub ?? '').length;
          const innerW = Math.max(labelLen, subLen) * charW;
          const badgeW = innerW + padX * 2;
          const badgeH = e.sub ? 30 : 22;

          return (
            <g key={e.id}>
              <path
                d={d}
                stroke={stroke} strokeWidth={strokeW} fill="none"
                opacity={baseOpacity}
                markerEnd={`url(#arr-${status})`}
              />
              {dur && (
                <path
                  d={d}
                  stroke={stroke} strokeWidth={1.5} fill="none"
                  strokeDasharray="4 6"
                  opacity={isActive ? 0.85 : 0.55}
                >
                  <animate attributeName="stroke-dashoffset" values="0;-20" dur={dur} repeatCount="indefinite" />
                </path>
              )}
              {dur && status === 'ok' && (
                <circle
                  r={isActive ? 4.5 : 3.5}
                  fill={stroke}
                  opacity={isActive ? 0.95 : 0.75}
                  filter="url(#node-glow)"
                >
                  <animateMotion dur={dur} repeatCount="indefinite" path={d} />
                </circle>
              )}
              {dur && status === 'warn' && (
                <circle r="3.5" fill={stroke} opacity={0.7}>
                  <animateMotion dur={dur} repeatCount="indefinite" path={d} />
                </circle>
              )}
              <g transform={`translate(${labelX} ${labelY})`}>
                <rect
                  x={-badgeW / 2} y={-badgeH / 2}
                  width={badgeW} height={badgeH}
                  rx={badgeH / 2}
                  fill={surface} stroke={stroke} strokeWidth={1} opacity={0.97}
                />
                <text
                  x={0} y={e.sub ? -2 : 4}
                  textAnchor="middle"
                  fontSize="10.5" fontWeight={600} fill={c.text}
                >
                  {e.label}
                </text>
                {e.sub && (
                  <text x={0} y={11} textAnchor="middle" fontSize="9" fill={c.textMuted}>
                    {e.sub}
                  </text>
                )}
              </g>
              <title>{e.id} · {status}{isActive ? ' · active' : isStandby ? ' · standby' : ''}</title>
            </g>
          );
        })}

        {/* ── IPsec tunnel manifolds: IT (top, fed by Fiber) and OT (bottom, fed by 5G) ── */}
        {([
          { manifold: IT_MANIFOLD, domain: 'IT' as const, tintColor: c.accent  },
          { manifold: OT_MANIFOLD, domain: 'OT' as const, tintColor: c.accent2 },
        ]).map(({ manifold, domain, tintColor }) => (
          <g key={`manifold-${domain}`}>
            <rect
              x={manifold.x} y={manifold.y}
              width={manifold.w} height={manifold.h}
              rx={12}
              fill={groupBg}
              stroke={groupStroke}
              strokeDasharray="4 4"
              strokeWidth={1}
            />
            <g transform={`translate(${manifold.x + 10} ${manifold.y + 14})`}>
              <rect x={-4} y={-11} width={26} height={16} rx={4} fill={tintColor} opacity={0.18} />
              <text fontSize="11.5" fontWeight={700} fill={tintColor} y={1}>{domain}</text>
              <text fontSize="9.5" fill={c.textMuted} x={30} y={1}>
                IPSEC TUNNELS · {domain === 'IT' ? 'via Fiber' : 'via 5G'}
              </text>
            </g>
          </g>
        ))}

        {/* ── Incoming segments: WAN underlay → tunnel pill ─────────────── */}
        {TUNNELS.map((t) => {
          const wanNode = byId[t.wan];
          const status = nodeStatus(t.wan);
          const isActive  = status === 'ok';
          const stroke = colorFor(status);
          const dur = durFor(status, isActive ? 'active' : 'standby');

          const start = { x: wanNode.x + NODE_W, y: wanNode.y + NODE_H / 2 };
          const end   = { x: PILL_X,             y: t.pillY + PILL_H / 2 };
          const cx1 = start.x + (end.x - start.x) * 0.55;
          const cx2 = start.x + (end.x - start.x) * 0.45;
          const d = `M ${start.x} ${start.y} C ${cx1} ${start.y}, ${cx2} ${end.y}, ${end.x} ${end.y}`;
          const opacity =
            status === 'err' ? 0.5 :
            isActive         ? 0.95 :
                               0.55;

          return (
            <g key={`in-${t.id}`}>
              <path
                d={d}
                stroke={stroke}
                strokeWidth={isActive ? 2.2 : 1.5}
                fill="none"
                opacity={opacity}
                strokeDasharray={status === 'err' ? '4 5' : undefined}
              />
              {dur && (
                <path
                  d={d}
                  stroke={stroke} strokeWidth={1.1} fill="none"
                  strokeDasharray="3 6"
                  opacity={isActive ? 0.85 : 0.5}
                >
                  <animate attributeName="stroke-dashoffset" values="0;-18" dur={dur} repeatCount="indefinite" />
                </path>
              )}
              {dur && status === 'ok' && (
                <circle r={isActive ? 3 : 2} fill={stroke} opacity={isActive ? 0.95 : 0.7} filter="url(#node-glow)">
                  <animateMotion dur={dur} repeatCount="indefinite" path={d} />
                </circle>
              )}
              {dur && status === 'warn' && (
                <circle r="2" fill={stroke} opacity={0.65}>
                  <animateMotion dur={dur} repeatCount="indefinite" path={d} />
                </circle>
              )}
            </g>
          );
        })}

        {/* ── Tunnel pills (the manifold rack) ─────────────────────────── */}
        {TUNNELS.map((t) => {
          const status = nodeStatus(t.wan);
          const isActive = status === 'ok';
          const stroke = colorFor(status);
          // Tint by domain (IT/OT) so the manifold's visual grouping is
          // reinforced at the pill level too.
          const tint = t.domain === 'IT' ? c.accent : c.accent2;
          const isSelected = selected?.kind === 'tunnel' && selected.id === t.id;
          return (
            <g key={`pill-${t.id}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelected(isSelected ? null : { kind: 'tunnel', id: t.id })}
            >
              {isSelected && (
                <rect
                  x={PILL_X - 4} y={t.pillY - 4}
                  width={PILL_W + 8} height={PILL_H + 8}
                  rx={PILL_H / 2 + 4}
                  fill="none" stroke={tint} strokeWidth={2} opacity={0.95}
                />
              )}
              <rect
                x={PILL_X} y={t.pillY}
                width={PILL_W} height={PILL_H}
                rx={PILL_H / 2}
                fill={surface}
                stroke={status === 'err' ? c.err : isActive ? stroke : tint}
                strokeWidth={isActive ? 1.5 : 1}
                opacity={status === 'err' ? 0.7 : 1}
              />
              {/* tint bar on the left of the pill */}
              <rect
                x={PILL_X + 4} y={t.pillY + 4}
                width={3} height={PILL_H - 8}
                rx={1.5}
                fill={tint}
                opacity={0.85}
              />
              <text
                x={PILL_X + 14} y={t.pillY + PILL_H / 2 + 3.5}
                fontSize="10.5" fontWeight={700} fill={c.text}
              >
                {t.name}
              </text>
              <text
                x={PILL_X + 38} y={t.pillY + PILL_H / 2 + 3.5}
                fontSize="9.5" fill={c.textMuted}
              >
                {t.traffic}
              </text>
              {/* Active/standby chip on the right */}
              <g transform={`translate(${PILL_X + PILL_W - 8} ${t.pillY + PILL_H / 2})`}>
                <circle r={3} fill={isActive ? c.ok : status === 'err' ? c.err : c.textMuted}>
                  {isActive && status === 'ok' && (
                    <animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite" />
                  )}
                </circle>
              </g>
              <title>{t.name} · {t.domain} · {t.traffic} · via {t.wan.toUpperCase()} · {isActive ? 'active' : 'standby'} · {status}</title>
            </g>
          );
        })}

        {/* ── Outgoing segments: tunnel pill → SD-WAN ──────────────────── */}
        {TUNNELS.map((t) => {
          const status = nodeStatus(t.wan);
          const isActive = status === 'ok';
          const stroke = colorFor(status);
          const dur = durFor(status, isActive ? 'active' : 'standby');

          const start = { x: PILL_X + PILL_W, y: t.pillY + PILL_H / 2 };
          const end   = { x: SDWAN_X,         y: t.sdwanLandingY };
          const cx1 = start.x + (end.x - start.x) * 0.55;
          const cx2 = start.x + (end.x - start.x) * 0.45;
          const d = `M ${start.x} ${start.y} C ${cx1} ${start.y}, ${cx2} ${end.y}, ${end.x} ${end.y}`;
          const opacity =
            status === 'err' ? 0.5 :
            isActive         ? 0.95 :
                               0.55;

          return (
            <g key={`out-${t.id}`}>
              <path
                d={d}
                stroke={stroke}
                strokeWidth={isActive ? 2.2 : 1.5}
                fill="none"
                opacity={opacity}
                strokeDasharray={status === 'err' ? '4 5' : undefined}
              />
              {dur && (
                <path
                  d={d}
                  stroke={stroke} strokeWidth={1.1} fill="none"
                  strokeDasharray="3 6"
                  opacity={isActive ? 0.85 : 0.5}
                >
                  <animate attributeName="stroke-dashoffset" values="0;-18" dur={dur} repeatCount="indefinite" />
                </path>
              )}
              {dur && status === 'ok' && (
                <circle r={isActive ? 3 : 2} fill={stroke} opacity={isActive ? 0.95 : 0.7} filter="url(#node-glow)">
                  <animateMotion dur={dur} repeatCount="indefinite" path={d} />
                </circle>
              )}
              {dur && status === 'warn' && (
                <circle r="2" fill={stroke} opacity={0.65}>
                  <animateMotion dur={dur} repeatCount="indefinite" path={d} />
                </circle>
              )}
              {/* SD-WAN entry port */}
              <circle cx={end.x} cy={end.y} r={2.5} fill={stroke} opacity={status === 'err' ? 0.5 : 0.9} />
            </g>
          );
        })}

        {/* ── Traced path overlay (highlights + golden particle + hop labels) ── */}
        {tracedPath && (
          <g>
            {/* Highlight each hop with a thick golden line */}
            {tracedPath.hops.map((h) => (
              <g key={`trace-${h.id}`}>
                <path
                  d={h.d}
                  stroke={TRACE_COLOR}
                  strokeWidth={5}
                  fill="none"
                  opacity={0.18}
                  strokeLinecap="round"
                />
                <path
                  d={h.d}
                  stroke={TRACE_COLOR}
                  strokeWidth={2.4}
                  fill="none"
                  opacity={0.9}
                  strokeLinecap="round"
                />
                {/* Per-hop latency label */}
                {(() => {
                  const midX = (h.from.x + h.to.x) / 2;
                  const midY = (h.from.y + h.to.y) / 2 - 12;
                  const text = `+${h.hopMs.toFixed(1)} ms`;
                  const w = text.length * 5.2 + 12;
                  return (
                    <g transform={`translate(${midX} ${midY})`}>
                      <rect
                        x={-w / 2} y={-8}
                        width={w} height={16}
                        rx={8}
                        fill={surface}
                        stroke={TRACE_COLOR}
                        strokeWidth={1}
                      />
                      <text textAnchor="middle" y={3.5} fontSize="9.5" fontWeight={700} fill={TRACE_COLOR}>
                        {text}
                      </text>
                    </g>
                  );
                })()}
              </g>
            ))}
            {/* The single golden particle traversing the whole path */}
            <circle r={6.5} fill={TRACE_COLOR} opacity={0.95} filter="url(#node-glow)">
              <animateMotion
                dur={`${Math.max(2.4, tracedPath.totalMs / 4)}s`}
                repeatCount="indefinite"
                path={tracedPath.fullD}
                rotate="auto"
              />
            </circle>
            {/* A trailing dimmer particle, slightly behind */}
            <circle r={4} fill={TRACE_COLOR} opacity={0.5}>
              <animateMotion
                dur={`${Math.max(2.4, tracedPath.totalMs / 4)}s`}
                repeatCount="indefinite"
                path={tracedPath.fullD}
                begin="-0.25s"
              />
            </circle>
          </g>
        )}

        {/* ── System nodes ─────────────────────────────────────────────── */}
        {NODES.map((n) => {
          const status = nodeStatus(n.id);
          const statusColor = colorFor(status);
          const tint = tintForSys(n);
          const cx = n.x + NODE_W / 2;
          const isSelected = selected?.kind === 'node' && selected.id === n.id;

          return (
            <g key={n.id}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelected(isSelected ? null : { kind: 'node', id: n.id })}
            >
              <rect
                x={n.x - 6} y={n.y - 6}
                width={NODE_W + 12} height={NODE_H + 12}
                rx={16}
                fill={statusColor} opacity={0.10} filter="url(#node-glow)"
              />
              {isSelected && (
                <rect
                  x={n.x - 8} y={n.y - 8}
                  width={NODE_W + 16} height={NODE_H + 16}
                  rx={18}
                  fill="none" stroke={tint} strokeWidth={2.5} opacity={0.95}
                />
              )}
              <rect
                x={n.x} y={n.y}
                width={NODE_W} height={NODE_H}
                rx={12}
                fill={surface}
                stroke={statusColor}
                strokeWidth={status === 'ok' ? 1.4 : 2}
              />
              <rect
                x={n.x + 1} y={n.y + 1}
                width={NODE_W - 2} height={3}
                rx={2} fill={tint} opacity={0.7}
              />

              <text
                x={cx} y={n.y + 22}
                textAnchor="middle"
                fontSize="12.5" fontWeight={700} fill={c.text}
              >
                {n.label}
              </text>

              {/* Custom inline illustration — drawn fresh per node type
                  so each system has its own visual identity. */}
              <g transform={`translate(${cx} ${n.y + 55})`}>
                <NodeIllustration id={n.id} color={tint} okColor={c.ok} warnColor={c.warn} />
              </g>

              <text
                x={cx} y={n.y + NODE_H - 10}
                textAnchor="middle"
                fontSize="9.5" fill={c.textMuted}
              >
                {n.sub}
              </text>

              {status !== 'ok' && (
                <g transform={`translate(${n.x + NODE_W - 10} ${n.y + 10})`}>
                  <circle r={5} fill={statusColor}>
                    <animate attributeName="opacity" values="1;0.4;1" dur="1.4s" repeatCount="indefinite" />
                  </circle>
                </g>
              )}

              <title>{n.label} · {status} · {n.sub}</title>
            </g>
          );
        })}
      </svg>

      {/* Inspector panel — shows path trace summary, or details for the
          element currently clicked on the diagram. */}
      <TopologyInspector
        tracedPath={tracedPath}
        selected={selected}
        pins={[...itPins, ...otPins]}
        nodes={NODES}
        tunnels={TUNNELS}
        scenario={scenario}
        nodeStatus={nodeStatus}
        onClose={() => setSelected(null)}
      />

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 18, fontSize: 11, color: 'var(--text-muted)',
        paddingTop: 4, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, height: 2, background: 'var(--ok)' }} />
          healthy · active path
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, height: 2, background: 'var(--ok)', opacity: 0.45 }} />
          standby tunnel
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, height: 2, background: 'var(--warn)' }} />
          degraded
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 18, height: 2,
            backgroundImage: 'repeating-linear-gradient(90deg, var(--err) 0 4px, transparent 4px 8px)',
          }} />
          unreachable
        </span>
        <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>
          Routing: IT <strong style={{ color: 'var(--accent)' }}>Fiber</strong> · OT <strong style={{ color: 'var(--accent-2)' }}>5G</strong>
        </span>
      </div>
    </Card>
  );
}

/* ────────── Inspector panel ──────────────────────────────────────────────
 * Sits below the SVG. Three modes:
 *   1. Tracedpath present → show route summary with per-hop chips + totals.
 *   2. selected element present → show element-specific telemetry.
 *   3. Idle → friendly hint prompting the user to interact.                */

function TopologyInspector({
  tracedPath, selected, pins, nodes, tunnels, scenario, nodeStatus, onClose,
}: {
  tracedPath: TracedPath | null;
  selected: SelectedElement;
  pins: PinLayout[];
  nodes: SysNode[];
  tunnels: Tunnel[];
  scenario: Scenario;
  nodeStatus: (id: SystemId) => Status;
  onClose: () => void;
}) {
  if (tracedPath) {
    const pin = pins.find((p) => p.device.id === tracedPath.source);
    const tunnel = tunnels.find((t) => t.id === tracedPath.tunnelId);
    return (
      <div className="topo-inspector trace-mode">
        <div className="topo-inspector-head">
          <span className="badge" style={{ color: TRACE_COLOR, borderColor: TRACE_COLOR }}>PATH TRACE</span>
          <strong style={{ fontSize: 13, color: 'var(--text)' }}>
            {pin?.device.name ?? tracedPath.source}
          </strong>
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <strong style={{ fontSize: 13, color: 'var(--text)' }}>
            {tracedPath.destId === 'aws' ? 'AWS Cloud' : 'Internet Public'}
          </strong>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            via <strong style={{ color: TRACE_COLOR }}>{tunnel?.name}</strong> ({tunnel?.traffic})
            · <strong style={{ color: TRACE_COLOR, fontVariantNumeric: 'tabular-nums' }}>{tracedPath.totalMs.toFixed(1)} ms</strong> total
          </span>
        </div>
        <div className="topo-hop-row">
          {tracedPath.hops.map((h, i) => (
            <div key={h.id} className="topo-hop">
              <div className="topo-hop-num" style={{ color: TRACE_COLOR, borderColor: TRACE_COLOR }}>{i + 1}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {h.label}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  +{h.hopMs.toFixed(1)} ms · cum {h.latencyMs.toFixed(1)} ms
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (selected?.kind === 'pin') {
    const p = pins.find((x) => x.device.id === selected.id);
    if (!p) return <InspectorEmpty />;
    const d = p.device;
    const statusBadge = d.status === 'ok' ? 'ok' : d.status === 'warn' ? 'warn' : 'err';
    return (
      <div className="topo-inspector">
        <div className="topo-inspector-head">
          <span className="badge" style={{ color: 'var(--accent)' }}>{d.domain} DEVICE</span>
          <strong style={{ fontSize: 13, color: 'var(--text)' }}>{d.name}</strong>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {d.kind.replace('_', ' ')}</span>
          <span className={`badge ${statusBadge}`} style={{ marginLeft: 'auto' }}>
            <span className={`dot ${statusBadge}`} />{d.status.toUpperCase()}
          </span>
          <button onClick={onClose} style={{ padding: '2px 8px', fontSize: 11 }}>Close</button>
        </div>
        <div className="topo-stat-row">
          <Stat label="IP"        value={d.ip}  mono />
          <Stat label="MAC"       value={d.mac} mono />
          <Stat label="Connection" value={d.conn === 'wifi' ? 'Wi-Fi' : d.conn === 'poe' ? 'PoE' : 'Wired'} />
          <Stat label="Connected" value={`${d.connectedForHours} h`} />
        </div>
      </div>
    );
  }

  if (selected?.kind === 'node') {
    const n = nodes.find((x) => x.id === selected.id);
    if (!n) return <InspectorEmpty />;
    const status = nodeStatus(n.id);
    const sBadge = status === 'ok' ? 'ok' : status === 'warn' ? 'warn' : 'err';
    const stats = NODE_TELEMETRY[n.id];
    return (
      <div className="topo-inspector">
        <div className="topo-inspector-head">
          <span className="badge" style={{ color: NODE_COLOR[n.id], borderColor: NODE_COLOR[n.id] }}>SYSTEM</span>
          <strong style={{ fontSize: 13, color: 'var(--text)' }}>{n.label}</strong>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {n.sub}</span>
          <span className={`badge ${sBadge}`} style={{ marginLeft: 'auto' }}>
            <span className={`dot ${sBadge}`} />{status.toUpperCase()}
          </span>
          <button onClick={onClose} style={{ padding: '2px 8px', fontSize: 11 }}>Close</button>
        </div>
        <div className="topo-stat-row">
          {stats.map((s) => <Stat key={s.label} label={s.label} value={s.value} mono={s.mono} />)}
        </div>
      </div>
    );
  }

  if (selected?.kind === 'tunnel') {
    const t = tunnels.find((x) => x.id === selected.id);
    if (!t) return <InspectorEmpty />;
    const ulStatus = nodeStatus(t.wan);
    const sBadge = ulStatus === 'ok' ? 'ok' : ulStatus === 'warn' ? 'warn' : 'err';
    const sla = TUNNEL_SLA[t.id];
    return (
      <div className="topo-inspector">
        <div className="topo-inspector-head">
          <span className="badge" style={{ color: t.domain === 'IT' ? 'var(--accent)' : 'var(--accent-2)', borderColor: t.domain === 'IT' ? 'var(--accent)' : 'var(--accent-2)' }}>
            {t.domain} IPSEC
          </span>
          <strong style={{ fontSize: 13, color: 'var(--text)' }}>{t.name} · {t.traffic}</strong>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· underlay {t.wan === 'fiber' ? 'Fiber' : '5G'}</span>
          <span className={`badge ${sBadge}`} style={{ marginLeft: 'auto' }}>
            <span className={`dot ${sBadge}`} />{ulStatus.toUpperCase()}
          </span>
          <button onClick={onClose} style={{ padding: '2px 8px', fontSize: 11 }}>Close</button>
        </div>
        <div className="topo-stat-row">
          <Stat label="Latency"    value={`${sla.latency} ms`} />
          <Stat label="Jitter"     value={`${sla.jitter} ms`} />
          <Stat label="Loss"       value={`${sla.loss}%`} />
          <Stat label="MOS"        value={sla.mos.toFixed(1)} />
          <Stat label="Throughput" value={`${sla.tput} Mbps`} />
          <Stat label="Sessions"   value={sla.sessions.toString()} />
        </div>
      </div>
    );
  }

  // Idle
  return (
    <div className="topo-inspector idle">
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        Click any node, tunnel, or device pin for live telemetry — or use the trace controls above to highlight a packet's full path.
      </span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
        Scenario: <strong style={{ color: 'var(--text)' }}>{scenario.label}</strong>
      </span>
    </div>
  );
}

function InspectorEmpty() {
  return (
    <div className="topo-inspector idle">
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Selection not found.</span>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="topo-stat">
      <div className="topo-stat-label">{label}</div>
      <div className={`topo-stat-value ${mono ? 'mono' : ''}`}>{value}</div>
    </div>
  );
}

/* ── Mock telemetry shown by the inspector. Values are deterministic so the
 *    same node always shows the same numbers — easy to reason about during
 *    demo. */

const NODE_TELEMETRY: Record<SystemId, { label: string; value: string; mono?: boolean }[]> = {
  gateway:  [
    { label: 'CPU',         value: '23%' },
    { label: 'Memory',      value: '1.4 / 4 GB' },
    { label: 'Sessions',    value: '2,847' },
    { label: 'Throughput',  value: '463 Mbps' },
    { label: 'Last config', value: '3h 12m ago' },
  ],
  fiber:    [
    { label: 'Link speed',  value: '1 Gbps · full duplex' },
    { label: 'Optical Rx',  value: '-14.2 dBm' },
    { label: 'FCS errors',  value: '4 / hr' },
    { label: 'MTU',         value: '1500' },
    { label: 'Uptime',      value: '312 h' },
  ],
  '5g':     [
    { label: 'RSSI',        value: '-78 dBm' },
    { label: 'SINR',        value: '14 dB' },
    { label: 'Band',        value: 'n78' },
    { label: 'Cell ID',     value: 'eNB-3014/14', mono: true },
    { label: 'Uptime',      value: '312 h' },
  ],
  sdwan:    [
    { label: 'Active tunnels', value: '4 / 4' },
    { label: 'Steering hits',  value: '1.2 / s' },
    { label: 'Last flip',      value: '7m ago' },
    { label: 'Policy version', value: 'v 32' },
    { label: 'Controller',     value: 'OK · 12 ms' },
  ],
  internet: [
    { label: '1.1.1.1 ping',    value: '12 ms' },
    { label: '8.8.8.8 ping',    value: '14 ms' },
    { label: 'TLS success',     value: '99.97%' },
    { label: 'Egress IP',       value: '203.0.113.42', mono: true },
    { label: 'ASN',             value: 'AS7018' },
  ],
  aws:      [
    { label: 'Region',          value: 'us-east-1' },
    { label: 'Bedrock RTT',     value: '41 ms' },
    { label: 'S3 RTT',          value: '38 ms' },
    { label: 'IAM auth',        value: 'OK' },
    { label: 'Cloud OnRamp',    value: 'VPN → TGW · UP' },
  ],
};

const TUNNEL_SLA: Record<string, {
  latency: number; jitter: number; loss: number; mos: number; tput: number; sessions: number;
}> = {
  't-it-1':  { latency: 14, jitter: 2, loss: 0.0,  mos: 4.3, tput: 180, sessions: 24 },
  't-it-2':  { latency: 16, jitter: 3, loss: 0.1,  mos: 4.2, tput: 240, sessions: 312 },
  't-ot-1':  { latency: 22, jitter: 4, loss: 0.05, mos: 4.0, tput: 12,  sessions: 6 },
  't-ot-2':  { latency: 24, jitter: 5, loss: 0.1,  mos: 4.0, tput: 3,   sessions: 4 },
};
