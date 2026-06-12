import { useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card } from '../Card';
import type { Device } from '../../types';
import { useThemeColors, type ThemeColors } from '../../ui/Theme';
import {
  Activity, Gauge, Radio, Signal, Wifi,
} from 'lucide-react';

/* ─────────── helpers ─────────── */

const HOURS = 24;

/** Deterministic id → integer hash. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h * 31) + id.charCodeAt(i)) >>> 0;
  return h;
}

/** Hour labels ending at the current hour, e.g. "13:00". */
function hourLabels(): string[] {
  const now = new Date().getHours();
  return Array.from({ length: HOURS }, (_, i) => {
    const h = (now - (HOURS - 1) + i + 24) % 24;
    return `${String(h).padStart(2, '0')}:00`;
  });
}

/** Deterministic wave + noise around a baseline. */
function wave(seed: number, i: number, baseline: number, amp: number): number {
  const s = ((seed * 16807) + i * 48271) % 2147483647;
  const noise = (s / 2147483647 - 0.5) * 2;
  const w = Math.sin((i / HOURS) * Math.PI * 2 + (seed % 7));
  return baseline + w * amp * 0.6 + noise * amp * 0.4;
}

const connLabel: Record<Device['conn'], string> = {
  wifi: 'Wi-Fi', wired: 'Wired', poe: 'PoE', thread: 'Thread',
};

/* ─────────── live telemetry history (measured, from the server) ─────────── */

interface HistoryPoint {
  t: number;
  rxMbps?: number;
  txMbps?: number;
  rssiDbm?: number;
  apowerW?: number;
  rxBytes?: number;
  txBytes?: number;
  /** Derived client-side: cumulative MB moved since the session started. */
  transferredMB?: number;
}

/** Bucket per-device history into 15s bins → recharts rows keyed by device
 *  name. Only devices present in the current filter are charted. */
function buildLiveRows(
  history: Record<string, HistoryPoint[]>,
  macToName: Map<string, string>,
  field: (p: HistoryPoint) => number | undefined,
): { rows: Record<string, string | number>[]; names: string[] } {
  const BIN = 15_000;
  const byBin = new Map<number, Record<string, string | number>>();
  const names = new Set<string>();
  for (const [mac, points] of Object.entries(history)) {
    const name = macToName.get(mac.toUpperCase());
    if (!name) continue;
    for (const p of points) {
      const v = field(p);
      if (v == null) continue;
      const bin = Math.floor(p.t / BIN) * BIN;
      let row = byBin.get(bin);
      if (!row) {
        row = {
          ts: bin,
          hour: new Date(bin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };
        byBin.set(bin, row);
      }
      row[name] = v;
      names.add(name);
    }
  }
  const rows = [...byBin.values()].sort((a, b) => (a.ts as number) - (b.ts as number));
  return { rows, names: [...names] };
}

const kindLabel: Record<Device['kind'], string> = {
  laptop: 'Laptop', desktop: 'Desktop', printer: 'Printer', payment: 'Payment',
  server: 'Server', confphone: 'ConfPhone',
  fire_sensor: 'Fire sensor', smoke_sensor: 'Smoke sensor', door_lock: 'Door lock',
  phone: 'Phone', tablet: 'Tablet', matter: 'Matter', shelly: 'Shelly', generic: 'Device',
};

/* ─────────── main component ─────────── */

export function DevicesDashboard({ devices }: { devices: Device[] }) {
  const c = useThemeColors();

  // ── Live telemetry history (measured throughput / RSSI from the server) ──
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({});
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch('/api/devices/telemetry/history')
        .then((r) => r.json())
        .then((j) => { if (!stop) setHistory(j.series ?? {}); })
        .catch(() => { /* keep last */ });
    load();
    const t = setInterval(load, 10_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const macToName = useMemo(
    () => new Map(devices.map((d) => [d.mac.toUpperCase(), d.name])),
    [devices],
  );
  // Cumulative data moved per device since the session started — always
  // visibly climbing (devices keep chatting with IoT Core), unlike the
  // instantaneous rate which is ~0 for idle IoT devices.
  const liveTransfer = useMemo(() => {
    const derived: Record<string, HistoryPoint[]> = {};
    for (const [mac, pts] of Object.entries(history)) {
      const first = pts.find((p) => p.rxBytes != null || p.txBytes != null);
      if (!first) continue;
      const base = (first.rxBytes ?? 0) + (first.txBytes ?? 0);
      derived[mac] = pts.map((p) => ({
        ...p,
        transferredMB: p.rxBytes != null || p.txBytes != null
          ? Math.max(0, +((((p.rxBytes ?? 0) + (p.txBytes ?? 0)) - base) / 1e6).toFixed(3))
          : undefined,
      }));
    }
    return derived;
  }, [history]);
  const liveThroughput = useMemo(
    () => buildLiveRows(liveTransfer, macToName, (p) => p.transferredMB),
    [liveTransfer, macToName],
  );
  const liveRssi = useMemo(
    () => buildLiveRows(history, macToName, (p) => p.rssiDbm),
    [history, macToName],
  );
  const hasLiveThroughput = liveThroughput.rows.length >= 2 && liveThroughput.names.length > 0;
  const hasLiveRssi = liveRssi.rows.length >= 2 && liveRssi.names.length > 0;

  // ── KPI numbers ──
  const total      = devices.length;
  const healthy    = devices.filter((d) => d.status === 'ok').length;
  const degraded   = devices.filter((d) => d.status === 'warn').length;
  const offline    = devices.filter((d) => d.status === 'err').length;

  const wifi = devices.filter((d) => d.conn === 'wifi' && d.status !== 'err');
  // Real measured RSSI when devices report it; synthetic only as fallback.
  const realRssis = devices
    .map((d) => d.telemetry?.rssiDbm)
    .filter((x): x is number => typeof x === 'number');
  const wifiRssis = realRssis.length > 0 ? realRssis : wifi.map((d) => {
    const seed = hashId(d.id);
    const base = d.status === 'warn' ? -80 : -60;
    const amp  = d.status === 'warn' ? 4 : 5;
    return wave(seed, HOURS - 1, base, amp);
  });
  const avgRssi = wifiRssis.length
    ? Math.round(wifiRssis.reduce((s, x) => s + x, 0) / wifiRssis.length)
    : null;

  const uptimes = devices.map((d) => d.connectedForHours);
  const avgUptimeH = uptimes.length
    ? Math.round(uptimes.reduce((s, x) => s + x, 0) / uptimes.length)
    : 0;

  // ── Sparkline data (last 12 ticks) for stat panels ──
  const labels = useMemo(() => hourLabels(), []);
  const sparkLen = 12;
  const totalSpark = labels.slice(-sparkLen).map((_, i) => ({
    t: i, v: Math.max(0, Math.round(total + Math.sin(i / 3) * 0.4)),
  }));
  const offlineSpark = labels.slice(-sparkLen).map((_, i) => ({
    t: i, v: Math.max(0, Math.round(offline + (Math.sin(i / 2 + 1) > 0.4 ? 1 : 0))),
  }));
  // RSSI sparkline from real history when present; synthetic fallback.
  const rssiSpark = hasLiveRssi
    ? liveRssi.rows.slice(-sparkLen).map((row, i) => {
        const vals = liveRssi.names.map((n) => row[n]).filter((v): v is number => typeof v === 'number');
        return { t: i, v: vals.length ? Math.round(vals.reduce((s, x) => s + x, 0) / vals.length) : (avgRssi ?? -65) };
      })
    : labels.slice(-sparkLen).map((_, i) => ({
        t: i,
        v: Math.round(wave(7, i + (HOURS - sparkLen), avgRssi ?? -65, 3)),
      }));
  const uptimeSpark = labels.slice(-sparkLen).map((_, i) => ({
    t: i, v: avgUptimeH + Math.round(Math.sin(i / 4) * 2),
  }));

  // ── Link-quality time-series — pivoted by device ──
  // Unified 0-100 % score so wired, Wi-Fi and PoE devices all sit on the same chart.
  //   Wi-Fi: f(RSSI)             healthy ≈ 80-95, warn ≈ 30-55
  //   Wired: f(FCS errors/loss)  healthy ≈ 95-100, warn ≈ 50-70
  //   PoE:   f(power budget)     healthy ≈ 95-100, warn ≈ 55-80
  //   Offline: drops near 0 with small jitter.
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const linkSeries = useMemo(() => {
    return labels.map((hour, i) => {
      const row: Record<string, string | number> = { hour };
      for (const d of devices) {
        const seed = hashId(d.id);
        let v: number;
        if (d.status === 'err') {
          v = clamp(wave(seed, i, 6, 5), 0, 18);
        } else if (d.conn === 'wifi') {
          v = d.status === 'warn'
            ? clamp(wave(seed, i, 42, 8), 22, 60)
            : clamp(wave(seed, i, 86, 5), 68, 99);
        } else if (d.conn === 'wired') {
          v = d.status === 'warn'
            ? clamp(wave(seed, i, 62, 8), 42, 78)
            : clamp(wave(seed, i, 97, 2), 92, 100);
        } else { // PoE
          v = d.status === 'warn'
            ? clamp(wave(seed, i, 66, 6), 52, 82)
            : clamp(wave(seed, i, 96, 2.5), 91, 100);
        }
        row[d.name] = +v.toFixed(1);
      }
      return row;
    });
  }, [labels, devices]);

  // ── Throughput time-series — stacked area by device kind ──
  const kinds = useMemo(() => {
    const set = new Set<Device['kind']>();
    devices.forEach((d) => set.add(d.kind));
    return Array.from(set);
  }, [devices]);

  const throughputSeries = useMemo(() => {
    return labels.map((hour, i) => {
      const row: Record<string, string | number> = { hour };
      for (const kind of kinds) {
        const ofKind = devices.filter((d) => d.kind === kind && d.status !== 'err');
        const sum = ofKind.reduce((acc, d) => {
          const seed = hashId(d.id);
          const baseline = d.conn === 'wired' ? 220 : d.conn === 'wifi' ? 60 : 30;
          const amp      = d.conn === 'wired' ? 80  : d.conn === 'wifi' ? 25 : 8;
          return acc + Math.max(0, wave(seed, i, baseline, amp));
        }, 0);
        row[kindLabel[kind]] = +(sum).toFixed(1);
      }
      return row;
    });
  }, [labels, devices, kinds]);

  // ── Connection mix donut ──
  const connMix = (['wifi', 'wired', 'poe'] as const).map((k) => ({
    key: k,
    name: connLabel[k],
    value: devices.filter((d) => d.conn === k).length,
    color: k === 'wifi' ? c.accent : k === 'wired' ? c.accent3 : c.warn,
  })).filter((x) => x.value > 0);

  // ── Status × device-kind stacked bar ──
  const statusByKind = useMemo(() => {
    return kinds.map((kind) => {
      const ofKind = devices.filter((d) => d.kind === kind);
      return {
        kind: kindLabel[kind],
        Healthy:  ofKind.filter((d) => d.status === 'ok').length,
        Degraded: ofKind.filter((d) => d.status === 'warn').length,
        Offline:  ofKind.filter((d) => d.status === 'err').length,
      };
    });
  }, [devices, kinds]);

  // Theme-aware palette for per-device series — enough distinct hues for a typical fleet.
  const seriesPalette = [
    c.accent, c.accent2, c.accent3, c.ok, c.warn,
    '#67e8f9', '#fb7185', '#a78bfa', '#facc15', '#34d399', '#60a5fa', '#f472b6',
  ];

  return (
    <div className="grid" style={{ marginBottom: 12 }}>
      {/* ── stat strip ── */}
      <div className="col-12">
        <div className="dev-stats">
          <StatPanel
            label="Devices monitored"
            big={total}
            sub={`${healthy} healthy · ${degraded} degraded · ${offline} offline`}
            icon={Activity}
            color={c.accent}
            spark={totalSpark}
            sparkColor={c.accent}
          />
          <StatPanel
            label="Avg Wi-Fi RSSI"
            big={avgRssi == null ? '—' : `${avgRssi} dBm`}
            sub={avgRssi == null
              ? 'no Wi-Fi devices'
              : `${wifi.length} client${wifi.length === 1 ? '' : 's'} · target > −75 dBm`}
            icon={Wifi}
            color={avgRssi != null && avgRssi > -75 ? c.ok : avgRssi != null && avgRssi > -82 ? c.warn : c.err}
            spark={rssiSpark}
            sparkColor={c.accent2}
            unit=" dBm"
          />
          <StatPanel
            label="Avg uptime"
            big={fmtDur(avgUptimeH)}
            sub="rolling mean across selected devices"
            icon={Gauge}
            color={c.accent3}
            spark={uptimeSpark}
            sparkColor={c.accent3}
            unit=" h"
          />
          <StatPanel
            label="Offline now"
            big={offline}
            sub={offline === 0 ? 'all reachable' : `${offline} unreachable — check incidents`}
            icon={Signal}
            color={offline === 0 ? c.ok : c.err}
            spark={offlineSpark}
            sparkColor={offline === 0 ? c.ok : c.err}
          />
        </div>
      </div>

      {/* ── Link quality — measured RSSI when live history exists, else the
             simulated 24h view ── */}
      <div className="col-8">
        <Card
          title={hasLiveRssi ? 'Wi-Fi signal · live' : 'Link quality · 24 h'}
          sub={hasLiveRssi
            ? 'Measured per-device RSSI (dBm) streamed from the gateway. Dashed lines mark warn / err thresholds.'
            : 'Per-device link health (0 – 100 %). Wi-Fi derives from RSSI · wired from FCS / loss · PoE from power budget. Dashed lines mark warn / err thresholds.'}
          right={<RangeBadge label={hasLiveRssi ? 'live · measured' : '24 h · simulated'} />}
        >
          <div style={{ height: 260 }}>
            {devices.length === 0 ? (
              <EmptyPanel msg="No devices in the current filter." />
            ) : hasLiveRssi ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={liveRssi.rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" />
                  <XAxis dataKey="hour" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis
                    stroke={c.textMuted}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    domain={[-90, -30]}
                    ticks={[-90, -80, -70, -60, -50, -40, -30]}
                    tickFormatter={(v) => `${v}`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle(c)}
                    labelStyle={{ color: c.textDim, marginBottom: 4 }}
                    cursor={{ stroke: c.chartCursor, strokeWidth: 1 }}
                    formatter={(v: unknown, n: unknown) => [`${v} dBm`, String(n)]}
                  />
                  <ReferenceLine y={-70} stroke={c.warn} strokeDasharray="4 4" strokeOpacity={0.7}
                    label={{ value: 'warn −70', position: 'insideTopRight', fill: c.warn, fontSize: 10 }} />
                  <ReferenceLine y={-80} stroke={c.err} strokeDasharray="4 4" strokeOpacity={0.7}
                    label={{ value: 'err −80', position: 'insideBottomRight', fill: c.err, fontSize: 10 }} />
                  {liveRssi.names.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={seriesPalette[i % seriesPalette.length]}
                      strokeWidth={1.7}
                      dot={false}
                      connectNulls
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={linkSeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" />
                  <XAxis dataKey="hour" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} interval={3} />
                  <YAxis
                    stroke={c.textMuted}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle(c)}
                    labelStyle={{ color: c.textDim, marginBottom: 4 }}
                    cursor={{ stroke: c.chartCursor, strokeWidth: 1 }}
                    formatter={(v: unknown, n: unknown) => [`${typeof v === 'number' ? v.toFixed(0) : v}%`, String(n)]}
                  />
                  <ReferenceLine y={60} stroke={c.warn} strokeDasharray="4 4" strokeOpacity={0.7}
                    label={{ value: 'warn 60%', position: 'insideTopRight', fill: c.warn, fontSize: 10 }} />
                  <ReferenceLine y={30} stroke={c.err} strokeDasharray="4 4" strokeOpacity={0.7}
                    label={{ value: 'err 30%', position: 'insideBottomRight', fill: c.err, fontSize: 10 }} />
                  {devices.map((d, i) => (
                    <Line
                      key={d.id}
                      type="monotone"
                      dataKey={d.name}
                      stroke={seriesPalette[i % seriesPalette.length]}
                      strokeWidth={1.7}
                      dot={false}
                      activeDot={{ r: 4 }}
                      isAnimationActive
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          {devices.length > 0 && (
            <LegendStrip items={(hasLiveRssi
              ? liveRssi.names.map((name, i) => ({ label: name, color: seriesPalette[i % seriesPalette.length] }))
              : devices.map((d, i) => ({
                  label: `${d.name} · ${connLabel[d.conn]}`,
                  color: seriesPalette[i % seriesPalette.length],
                })))} />
          )}
        </Card>
      </div>

      {/* ── Connection mix donut ── */}
      <div className="col-4">
        <Card
          title="Connection mix"
          sub="How clients reach the network — by transport"
          right={<RangeBadge label="live" />}
        >
          <div style={{ height: 260, position: 'relative' }}>
            {connMix.length === 0 ? (
              <EmptyPanel msg="No devices in the current filter." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={connMix}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={92}
                    paddingAngle={2}
                    stroke="transparent"
                  >
                    {connMix.map((m) => <Cell key={m.key} fill={m.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle(c)}
                    labelStyle={{ color: c.textDim, marginBottom: 4 }}
                    formatter={(v: unknown, n: unknown) => [`${v} device${v === 1 ? '' : 's'}`, String(n)]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            {/* center label */}
            {connMix.length > 0 && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
              }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: c.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{total}</div>
                <div style={{ fontSize: 10, color: c.textMuted, letterSpacing: '0.08em', marginTop: 4 }}>DEVICES</div>
              </div>
            )}
          </div>
          <LegendStrip items={connMix.map((m) => ({ label: `${m.name} · ${m.value}`, color: m.color }))} />
        </Card>
      </div>

      {/* ── Data transferred — measured cumulative MB when live history exists ── */}
      <div className="col-8">
        <Card
          title={hasLiveThroughput ? 'Data transferred · live' : 'Throughput · 24 h'}
          sub={hasLiveThroughput
            ? 'Cumulative MB per device this session (rx + tx) — measured from the gateway’s byte counters'
            : 'Sum of avg Mbps per device, stacked by device type'}
          right={<RangeBadge label={hasLiveThroughput ? 'live · measured' : '24 h · simulated'} />}
        >
          <div style={{ height: 260 }}>
            {kinds.length === 0 ? (
              <EmptyPanel msg="No devices in the current filter." />
            ) : hasLiveThroughput ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={liveThroughput.rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <defs>
                    {liveThroughput.names.map((name, i) => {
                      const color = seriesPalette[i % seriesPalette.length];
                      return (
                        <linearGradient key={name} id={`dev-live-th-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor={color} stopOpacity={0.55} />
                          <stop offset="100%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="hour" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false}
                    tickFormatter={(v) => `${typeof v === 'number' && v < 10 ? v : Math.round(Number(v))}`} />
                  <Tooltip
                    contentStyle={tooltipStyle(c)}
                    labelStyle={{ color: c.textDim, marginBottom: 4 }}
                    cursor={{ stroke: c.chartCursor, strokeWidth: 1 }}
                    formatter={(v: unknown, n: unknown) => [`${typeof v === 'number' ? v.toFixed(2) : v} MB`, String(n)]}
                  />
                  {liveThroughput.names.map((name, i) => (
                    <Area
                      key={name}
                      type="monotone"
                      stackId="1"
                      dataKey={name}
                      stroke={seriesPalette[i % seriesPalette.length]}
                      fill={`url(#dev-live-th-${i})`}
                      strokeWidth={1.6}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={throughputSeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <defs>
                    {kinds.map((k, i) => {
                      const color = seriesPalette[i % seriesPalette.length];
                      return (
                        <linearGradient key={k} id={`dev-th-${k}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor={color} stopOpacity={0.55} />
                          <stop offset="100%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="hour" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} interval={3} />
                  <YAxis stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v)}`} />
                  <Tooltip
                    contentStyle={tooltipStyle(c)}
                    labelStyle={{ color: c.textDim, marginBottom: 4 }}
                    cursor={{ stroke: c.chartCursor, strokeWidth: 1 }}
                    formatter={(v: unknown, n: unknown) => [`${typeof v === 'number' ? v.toFixed(0) : v} Mbps`, String(n)]}
                  />
                  {kinds.map((k, i) => (
                    <Area
                      key={k}
                      type="monotone"
                      stackId="1"
                      dataKey={kindLabel[k]}
                      stroke={seriesPalette[i % seriesPalette.length]}
                      fill={`url(#dev-th-${k})`}
                      strokeWidth={1.6}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <LegendStrip items={(hasLiveThroughput
            ? liveThroughput.names.map((name, i) => ({ label: name, color: seriesPalette[i % seriesPalette.length] }))
            : kinds.map((k, i) => ({ label: kindLabel[k], color: seriesPalette[i % seriesPalette.length] })))} />
        </Card>
      </div>

      {/* ── Status by device kind ── */}
      <div className="col-4">
        <Card
          title="Health by device type"
          sub="Stacked count per kind — anything not green needs attention"
          right={<RangeBadge label="live" />}
        >
          <div style={{ height: 260 }}>
            {statusByKind.length === 0 ? (
              <EmptyPanel msg="No devices in the current filter." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={statusByKind}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  barCategoryGap={6}
                >
                  <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="kind"
                    width={88}
                    stroke={c.textMuted}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle(c)}
                    labelStyle={{ color: c.text, marginBottom: 4, fontWeight: 600 }}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <Bar dataKey="Healthy"  stackId="s" fill={c.ok}   radius={[3, 0, 0, 3]} />
                  <Bar dataKey="Degraded" stackId="s" fill={c.warn} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Offline"  stackId="s" fill={c.err}  radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <LegendStrip items={[
            { label: 'Healthy',  color: c.ok },
            { label: 'Degraded', color: c.warn },
            { label: 'Offline',  color: c.err },
          ]} />
        </Card>
      </div>
    </div>
  );
}

/* ─────────── Stat panel with sparkline ─────────── */

function StatPanel({
  label, big, sub, icon: Icon, color, spark, sparkColor, unit,
}: {
  label: string;
  big: React.ReactNode;
  sub: string;
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  spark: { t: number; v: number }[];
  sparkColor: string;
  unit?: string;
}) {
  return (
    <div className="dev-stat">
      <div className="dev-stat-top">
        <span className="dev-stat-icon" style={{ color, background: `linear-gradient(135deg, ${color}33, transparent)` }}>
          <Icon size={14} />
        </span>
        <span className="dev-stat-label">{label}</span>
      </div>
      <div className="dev-stat-mid">
        <span className="dev-stat-big" style={{ color }}>
          {big}{unit && typeof big === 'number' ? <span style={{ fontSize: '0.55em', color: 'var(--text-muted)', marginLeft: 4 }}>{unit.trim()}</span> : null}
        </span>
        <div className="dev-stat-spark">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`sp-${label.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} fill={`url(#sp-${label.replace(/\s+/g, '-')})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="dev-stat-sub">{sub}</div>
    </div>
  );
}

/* ─────────── Small helpers ─────────── */

function RangeBadge({ label }: { label: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '4px 8px', borderRadius: 6, color: 'var(--text-muted)',
      border: '1px solid var(--border)', background: 'var(--surface-1)',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <Radio size={10} />
      {label}
    </span>
  );
}

function EmptyPanel({ msg }: { msg: string }) {
  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-muted)', fontSize: 12,
    }}>{msg}</div>
  );
}

function LegendStrip({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="dev-legend">
      {items.map((it) => (
        <span key={it.label} className="dev-legend-item">
          <span className="dev-legend-swatch" style={{ background: it.color, boxShadow: `0 0 6px ${it.color}88` }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function tooltipStyle(c: ThemeColors) {
  return {
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    borderRadius: 10,
    fontSize: 12,
    padding: '8px 10px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.20)',
    backdropFilter: 'blur(10px)',
  } as const;
}

function fmtDur(h: number): string {
  if (h <= 0) return '—';
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
