import { useCallback, useEffect, useRef, useState } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  ReferenceLine,
} from "recharts";
import { PageHeader } from "../components/PageHeader";
import { Card } from "../components/Card";
import { Sparkline } from "../components/widgets/Sparkline";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cpu,
  Wifi,
  Zap,
  Gauge,
  RefreshCcw,
  Settings2,
  Cloud,
  CircleDot,
  Sparkles,
  Loader2,
  Laptop,
  Monitor,
  Printer,
  CreditCard,
  Server,
  PhoneCall,
  Flame,
  AlertTriangle,
  DoorClosed,
  Smartphone,
  Tablet,
  Plug,
  HelpCircle,
} from "lucide-react";
import { pathThresholds, BRANCH_TO_IPSEC_SOURCE } from "../data/mock";
import type {
  IpsecGatewayState,
  IpsecTunnelMetric,
  IpsecWifiClient,
} from "../types";
import { useThemeColors } from "../ui/Theme";
import type { ThemeColors } from "../ui/Theme";
import { useIpsecMetrics } from "../ui/useIpsecMetrics";
import { useDevices, type DeviceView } from "../ui/useDevices";
import { runIpsecInsightSSE } from "../ui/agentClient";
import { RichText } from "../ui/markdown";
import { useToast } from "../ui/Toast";
import { Modal } from "../ui/Modal";

type Metric = "latency" | "jitter" | "loss";

const metricCfg: Record<
  Metric,
  { label: string; unit: string; ref: number; ref2: number }
> = {
  latency: { label: "Latency", unit: "ms", ref: 80, ref2: 150 },
  jitter: { label: "Jitter", unit: "ms", ref: 30, ref2: 60 },
  loss: { label: "Packet loss", unit: "%", ref: 1, ref2: 3 },
};

/** Classify a tunnel into its underlay bucket from the ifname. */
type Underlay = "fiber" | "5g";
function inferUnderlay(ifname: string): Underlay {
  const n = (ifname || "").toLowerCase();
  if (
    n.includes("cell") ||
    n.includes("5g") ||
    n.includes("lte") ||
    n.includes("wwan")
  )
    return "5g";
  return "fiber";
}

/** Order tunnels by the numeric part of their ifname, ascending — so the WAN
 *  list and probe table read vti1, vti2, vti3, vti4 regardless of the order
 *  the gateway happens to report them in. Non-numeric names sort to the front. */
function orderTunnelsByName(
  tunnels: IpsecTunnelMetric[],
): IpsecTunnelMetric[] {
  const numOf = (s: string) => {
    const match = (s || "").match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };
  return [...tunnels].sort((a, b) => numOf(a.ifname) - numOf(b.ifname));
}

/** Turn a raw device hostname (`rdk-bpi4-gateway`) into a friendly title
 *  (`RDK BPI4 Gateway`). Tokens that look like acronyms or model codes — three
 *  letters or fewer, or containing a digit — are upper-cased; the rest are
 *  title-cased. Display-only; the raw hostname is still shown as sub-text. */
function displayGatewayName(raw: string): string {
  const name = (raw || "").trim();
  if (!name) return "";
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((tok) =>
      /\d/.test(tok) || tok.length <= 3
        ? tok.toUpperCase()
        : tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase(),
    )
    .join(" ");
}

function meanBy<T>(arr: T[], key: (t: T) => number): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, t) => sum + key(t), 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const v = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

/** Simple ITU-T G.107 R-factor → MOS approximation. */
function approxMos(latencyMs: number, lossPercent: number): number {
  if (latencyMs <= 0) return 0;
  const latPenalty =
    0.024 * latencyMs + Math.max(0, 0.11 * (latencyMs - 177.3));
  const lossPenalty = 2.5 * lossPercent;
  const R = Math.max(0, Math.min(100, 93.2 - latPenalty - lossPenalty));
  const mos = 1 + 0.035 * R + 7e-6 * R * (R - 60) * (100 - R);
  return Math.max(1, Math.min(5, mos));
}

interface SlaSample {
  ts: number;
  /** Friendly time label, e.g. "12:34:56" — used by the chart x-axis. */
  t: string;
  fiber_latency: number;
  fiber_jitter: number;
  fiber_loss: number;
  fiber_mos: number;
  fiveg_latency: number;
  fiveg_jitter: number;
  fiveg_loss: number;
  fiveg_mos: number;
}

export function DynamicPathSelectionPage({ branchId }: { branchId?: string }) {
  const [metric, setMetric] = useState<Metric>("latency");
  const [showSample, setShowSample] = useState(false);
  const c = useThemeColors();
  const ipsec = useIpsecMetrics();

  // Scope the live list to the current branch's MQTT source — Plano sees
  // `rdk/...` gateways, McKinney sees `prpl/...` gateways. Branches without
  // a mapped source see the unfiltered list (handy during development).
  const branchSource = branchId ? BRANCH_TO_IPSEC_SOURCE[branchId] : undefined;
  const branchList = branchSource
    ? ipsec.list.filter((g) => g.source === branchSource)
    : ipsec.list;

  // Effective IPsec data — either the live snapshot, or the captured sample
  // when the user clicks "Load sample" on the ingest card.
  const effectiveList = showSample ? [SAMPLE_IPSEC_GATEWAY] : branchList;
  const liveState = effectiveList[0];

  // ── Rolling SLA series derived from live IPsec payloads ──────────────
  // We buffer the last ~10 minutes of derived per-underlay metrics so the
  // KPI cards and the SLA-over-time chart show real device data, not mocks.
  // (Jitter is stddev of recent latency samples; MOS is the standard
  // ITU R-factor → MOS approximation from latency + loss.)
  const [slaSeries, setSlaSeries] = useState<SlaSample[]>([]);
  const liveReceived = liveState?.receivedAt;

  useEffect(() => {
    if (!liveState) return;
    const tunnels = liveState.metrics.tunnels;
    const fiberReachable = tunnels.filter(
      (t) => inferUnderlay(t.ifname) === "fiber" && t.reachable,
    );
    const cellReachable = tunnels.filter(
      (t) => inferUnderlay(t.ifname) === "5g" && t.reachable,
    );
    const fiberLat = meanBy(fiberReachable, (t) => t.latency_ms);
    const fiberLoss = meanBy(fiberReachable, (t) => t.loss_percent);
    const cellLat = meanBy(cellReachable, (t) => t.latency_ms);
    const cellLoss = meanBy(cellReachable, (t) => t.loss_percent);

    const now = new Date(liveState.receivedAt);
    const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    setSlaSeries((prev) => {
      // Jitter approximated as stddev of the last 9 latency samples + current.
      const recent = prev.slice(-9);
      const fJit = stddev([...recent.map((s) => s.fiber_latency), fiberLat]);
      const cJit = stddev([...recent.map((s) => s.fiveg_latency), cellLat]);
      return [
        ...prev,
        {
          ts: liveState.receivedAt,
          t,
          fiber_latency: fiberLat,
          fiber_jitter: fJit,
          fiber_loss: fiberLoss,
          fiber_mos: approxMos(fiberLat, fiberLoss),
          fiveg_latency: cellLat,
          fiveg_jitter: cJit,
          fiveg_loss: cellLoss,
          fiveg_mos: approxMos(cellLat, cellLoss),
        },
      ].slice(-60); // ~10 min at the gateway's 10s cadence
    });
  }, [liveReceived, liveState]);

  // ── Enterprise-ops tracking ──
  // Count active_tunnel flips since the page opened (path-stability metric)
  // and remember session-start so we can express the rate per hour.
  const [flipCount, setFlipCount] = useState(0);
  const prevActiveRef = useRef<string>("");
  useEffect(() => {
    if (!liveState) return;
    const a = liveState.metrics.active_tunnel ?? "";
    if (prevActiveRef.current && a && prevActiveRef.current !== a) {
      setFlipCount((c) => c + 1);
    }
    prevActiveRef.current = a;
  }, [liveState?.metrics.active_tunnel, liveState]);
  const sessionStartMs = slaSeries[0]?.ts ?? null;

  // Latest derived values for the KPI strip — fall back to zeros when we
  // haven't received a payload yet (the cards will read as "—").
  const latest = slaSeries[slaSeries.length - 1];
  const fiberLat = latest?.fiber_latency ?? 0;
  const fiberJit = latest?.fiber_jitter ?? 0;
  const fiberLoss = latest?.fiber_loss ?? 0;
  const fiberMos = latest?.fiber_mos ?? 0;
  const cellLat = latest?.fiveg_latency ?? 0;
  const cellJit = latest?.fiveg_jitter ?? 0;
  const cellLoss = latest?.fiveg_loss ?? 0;
  const cellMos = latest?.fiveg_mos ?? 0;

  return (
    <div className="failover-page" style={{ display: "contents" }}>
      <PageHeader
        title="Dynamic Failover"
        subtitle="Real-time SLA-driven failover between Fiber and 5G — sub-second decisions per flow"
        right={
          <div className="toolbar">
            <button>
              <RefreshCcw size={14} />
              Re-probe
            </button>
            <button className="primary">
              <Settings2 size={14} />
              Tune SLA
            </button>
          </div>
        }
      />

      {/* SLA cards: 4 metrics × 2 paths + Wi-Fi RSSI — all live from telemetry */}
      <div
        className="kpi-strip"
        style={{ gridTemplateColumns: "repeat(5, 1fr)" }}
      >
        <SlaCard
          label="Latency"
          unit="ms"
          fiberVal={fiberLat}
          fivegVal={cellLat}
          fiberOk={fiberLat > 0 && fiberLat < 80}
          fivegOk={cellLat > 0 && cellLat < 80}
          series={slaSeries.map((h) => h.fiber_latency)}
        />
        <SlaCard
          label="Jitter"
          unit="ms"
          fiberVal={fiberJit}
          fivegVal={cellJit}
          fiberOk={fiberJit < 30}
          fivegOk={cellJit < 30}
          series={slaSeries.map((h) => h.fiber_jitter)}
          digits={1}
        />
        <SlaCard
          label="Packet loss"
          unit="%"
          fiberVal={fiberLoss}
          fivegVal={cellLoss}
          fiberOk={fiberLoss < 1}
          fivegOk={cellLoss < 1}
          series={slaSeries.map((h) => h.fiber_loss)}
          digits={2}
        />
        <SlaCard
          label="MOS score"
          unit=""
          fiberVal={fiberMos}
          fivegVal={cellMos}
          fiberOk={fiberMos > 3.6}
          fivegOk={cellMos > 3.6}
          series={slaSeries.map((h) => h.fiber_mos)}
          digits={1}
        />
        <RssiCard clients={liveState?.metrics.wifi?.clients ?? []} />
      </div>

      <div className="grid">
        {/* Live IPsec ingest from AWS IoT (protobuf → MQTT → SSE) — this card
            now subsumes the path-selection visual that used to live below. */}
        <div className="col-12">
          <LiveIpsecCard
            ipsec={ipsec}
            showSample={showSample}
            onToggleSample={() => setShowSample((s) => !s)}
            effectiveList={effectiveList}
            branchTopic={branchSource ? `${branchSource}/ipsec/metrics` : null}
          />
        </div>

        {/* Enterprise-operations panel — derived from the same live payload,
            framed in the language enterprise IT / FinOps / CxO want to see. */}
        {liveState && (
          <div className="col-12">
            <EnterpriseOpsCard
              state={liveState}
              slaSeries={slaSeries}
              flipCount={flipCount}
              sessionStartMs={sessionStartMs}
            />
          </div>
        )}

        {/* AI Insight — Bedrock Claude reads the latest IPsec snapshot and
            streams a plain-English analysis. Only shown when we have data. */}
        {liveState && (
          <div className="col-12">
            <IpsecAiInsightsCard receivedAt={liveState.receivedAt} />
          </div>
        )}

        {/* SLA chart — rolling window built live from IPsec payloads.
            X-axis is wall-clock time of arrival, capped at ~10 min of history. */}
        <div className="col-12">
          <Card
            title={
              <span>
                <Activity size={13} /> SLA over time — Fiber vs 5G
              </span>
            }
            sub={
              slaSeries.length > 0
                ? `Live · ${slaSeries.length} samples · ${Math.round((slaSeries[slaSeries.length - 1].ts - slaSeries[0].ts) / 1000)}s window`
                : "Live · waiting for first sample…"
            }
            right={
              <div className="toolbar">
                {(["latency", "jitter", "loss"] as Metric[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    style={
                      m === metric
                        ? {
                            background: "var(--grad-accent-soft)",
                            borderColor: "rgba(124,140,255,0.35)",
                            color: "var(--text)",
                          }
                        : undefined
                    }
                  >
                    {metricCfg[m].label}
                  </button>
                ))}
              </div>
            }
          >
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={slaSeries}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke={c.chartGrid}
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="t"
                    stroke={c.textMuted}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                  />
                  <YAxis
                    stroke={c.textMuted}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    unit={
                      metricCfg[metric].unit ? ` ${metricCfg[metric].unit}` : ""
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: c.tooltipBg,
                      border: `1px solid ${c.tooltipBorder}`,
                      borderRadius: 10,
                      fontSize: 12,
                      backdropFilter: "blur(10px)",
                    }}
                    labelStyle={{ color: c.textDim }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                    iconType="plainline"
                  />
                  <ReferenceLine
                    y={metricCfg[metric].ref}
                    stroke={c.warn}
                    strokeDasharray="4 4"
                    label={{
                      value: "warn",
                      fill: c.warn,
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <ReferenceLine
                    y={metricCfg[metric].ref2}
                    stroke={c.err}
                    strokeDasharray="4 4"
                    label={{
                      value: "fail",
                      fill: c.err,
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey={`fiber_${metric}`}
                    name="Fiber"
                    stroke={c.accent}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey={`fiveg_${metric}`}
                    name="5G"
                    stroke={c.accent2}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Thresholds editor — full-width now that the Active probes card has
            been folded into the per-tunnel rows above (Interval + Success). */}
        <div className="col-12">
          <Card
            title={
              <span>
                <Gauge size={13} /> SLA thresholds
              </span>
            }
            sub="Separate Fiber & 5G bounds — used by the path selector to decide warn / fail"
          >
            {/* Compact metric blocks — laid out across the row so the inputs
                stay small instead of stretching the full card width. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                gap: "14px 24px",
              }}
            >
              {pathThresholds.map((t) => (
                <div key={t.metric}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--text-dim)",
                      textTransform: "capitalize",
                      marginBottom: 6,
                    }}
                  >
                    {t.metric}
                  </div>
                  {/* per-block Warn / Fail headers */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "44px 1fr 1fr",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span />
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "var(--warn)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      Warn
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "var(--err)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      Fail
                    </span>
                  </div>
                  {[
                    { name: "Fiber", color: c.accent, vals: t.fiber },
                    { name: "5G", color: c.accent2, vals: t.fiveg },
                  ].map(({ name, color, vals }) => (
                    <div
                      key={name}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "44px 1fr 1fr",
                        gap: 8,
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color,
                          letterSpacing: "0.04em",
                        }}
                      >
                        {name}
                      </span>
                      <input
                        defaultValue={`${vals.warn}${t.unit}`}
                        className="mono"
                        style={{ padding: "6px 8px", width: "100%", minWidth: 0 }}
                      />
                      <input
                        defaultValue={`${vals.fail}${t.unit}`}
                        className="mono"
                        style={{ padding: "6px 8px", width: "100%", minWidth: 0 }}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}
            >
              Path is marked degraded at{" "}
              <strong style={{ color: "var(--warn)" }}>warn</strong> and
              ineligible at{" "}
              <strong style={{ color: "var(--err)" }}>fail</strong>.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---------- Sub-components ---------- */

/* ───── AI Insight card — streams Bedrock analysis of the live snapshot ─── */
/* ───── Enterprise Operations card ─────
 * Tiles that translate the raw IPsec payload into language enterprise
 * stakeholders care about: availability, path stability, SLA compliance,
 * traffic mix across underlays, and average packet size.
 * Every value is derived from data we already have on the client. */
function EnterpriseOpsCard({
  state,
  slaSeries,
  flipCount,
  sessionStartMs,
}: {
  state: IpsecGatewayState;
  slaSeries: SlaSample[];
  flipCount: number;
  sessionStartMs: number | null;
}) {
  const c = useThemeColors();
  const m = state.metrics;

  // ── Availability — fraction of tunnels currently present + reachable.
  const upTunnels = m.tunnels.filter((t) => t.present && t.reachable).length;
  const availabilityPct =
    m.tunnels.length > 0 ? (upTunnels / m.tunnels.length) * 100 : 0;

  // ── Path stability — flips per hour over the live session window.
  const sessionHrs = sessionStartMs
    ? Math.max(1 / 60, (Date.now() - sessionStartMs) / 3_600_000)
    : 1;
  const flipsPerHour = flipCount / sessionHrs;

  // ── SLA compliance — % of slaSeries samples where the active underlay
  //    satisfied all three thresholds (latency < 80 ms, loss < 1 %, jitter < 30 ms).
  const compliantSamples = slaSeries.filter((s) => {
    // Use whichever underlay has data > 0 (the carrying one).
    const lat = s.fiber_latency > 0 ? s.fiber_latency : s.fiveg_latency;
    const lossV = s.fiber_latency > 0 ? s.fiber_loss : s.fiveg_loss;
    const jit = s.fiber_latency > 0 ? s.fiber_jitter : s.fiveg_jitter;
    return lat > 0 && lat < 80 && lossV < 1 && jit < 30;
  }).length;
  const slaPct =
    slaSeries.length > 0 ? (compliantSamples / slaSeries.length) * 100 : 0;

  // ── Avg packet size on the WAN — operational signal: large = bulk traffic,
  //    small = lots of interactive / control-plane chatter.
  const totalPkts = m.wan.rx_packets + m.wan.tx_packets;
  const totalBytes = m.wan.rx_bytes + m.wan.tx_bytes;
  const avgPktBytes = totalPkts > 0 ? totalBytes / totalPkts : 0;

  // ── Traffic mix — per-underlay share of cumulative tunnel bytes.
  const fiberBytes = m.tunnels
    .filter((t) => inferUnderlay(t.ifname) === "fiber")
    .reduce((s, t) => s + t.rx_bytes + t.tx_bytes, 0);
  const cellBytes = m.tunnels
    .filter((t) => inferUnderlay(t.ifname) === "5g")
    .reduce((s, t) => s + t.rx_bytes + t.tx_bytes, 0);
  const tunnelTotal = fiberBytes + cellBytes;
  const fiberSharePct = tunnelTotal > 0 ? (fiberBytes / tunnelTotal) * 100 : 0;
  const cellSharePct = tunnelTotal > 0 ? (cellBytes / tunnelTotal) * 100 : 0;

  // Session cumulative — show off the audit-ready "every byte logged" angle.
  const fmtSessionBytes =
    totalBytes >= 1e9
      ? `${(totalBytes / 1e9).toFixed(2)} GB`
      : totalBytes >= 1e6
        ? `${(totalBytes / 1e6).toFixed(1)} MB`
        : `${(totalBytes / 1e3).toFixed(0)} KB`;

  return (
    <Card
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Zap size={13} />
          Enterprise operations
        </span>
      }
      sub="Derived live from the IPsec telemetry · framed for IT / FinOps / CxO reporting"
      right={
        <span className="badge ok">
          <span className="dot ok" /> LIVE
        </span>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 10,
        }}
      >
        <EnterpriseTile
          label="Availability"
          value={`${availabilityPct.toFixed(1)}%`}
          sub={`${upTunnels} / ${m.tunnels.length} tunnels reachable`}
          accent={
            availabilityPct >= 99
              ? c.ok
              : availabilityPct >= 75
                ? c.warn
                : c.err
          }
          progress={availabilityPct}
        />
        <EnterpriseTile
          label="Path stability"
          value={flipsPerHour < 0.1 ? "Steady" : `${flipsPerHour.toFixed(1)}/h`}
          sub={`${flipCount} ${flipCount === 1 ? "flip" : "flips"} this session`}
          accent={flipsPerHour < 1 ? c.ok : flipsPerHour < 5 ? c.warn : c.err}
        />
        <EnterpriseTile
          label="SLA compliance"
          value={slaSeries.length > 0 ? `${slaPct.toFixed(0)}%` : "—"}
          sub={`Latency < 80 ms · loss < 1% · jitter < 30 ms`}
          accent={slaPct >= 99 ? c.ok : slaPct >= 90 ? c.warn : c.err}
          progress={slaPct}
        />
        <EnterpriseTile
          label="Traffic mix"
          value={`Fiber ${fiberSharePct.toFixed(0)}%`}
          sub={`5G ${cellSharePct.toFixed(0)}% · load-balanced overlay`}
          accent={c.accent}
          progress={fiberSharePct}
          progressColor={c.accent2}
        />
        <EnterpriseTile
          label="Avg packet size"
          value={
            avgPktBytes > 0 ? `${(avgPktBytes / 1024).toFixed(2)} KB` : "—"
          }
          sub={`${totalPkts.toLocaleString()} packets · ${fmtSessionBytes} session`}
          accent={c.accent3 ?? "#c084fc"}
        />
      </div>

      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          marginTop: 12,
          lineHeight: 1.5,
        }}
      >
        All values derive from the live{" "}
        <span className="mono">rdk/ipsec/metrics</span> protobuf — no synthetic
        data. SLA thresholds match the path-selector defaults above.
      </div>
    </Card>
  );
}

function EnterpriseTile({
  label,
  value,
  sub,
  accent,
  progress,
  progressColor,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
  progress?: number;
  progressColor?: string;
}) {
  return (
    <div
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 19,
          fontWeight: 800,
          color: accent,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{sub}</div>
      {progress != null && (
        <div
          style={{
            marginTop: 4,
            height: 4,
            background: "rgba(255,255,255,0.06)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(100, progress))}%`,
              height: "100%",
              background: progressColor ?? accent,
              transition: "width 0.4s ease",
            }}
          />
        </div>
      )}
    </div>
  );
}

function IpsecAiInsightsCard({ receivedAt }: { receivedAt: number }) {
  const c = useThemeColors();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);

  const generate = useCallback(() => {
    stopRef.current?.();
    const myRun = ++runIdRef.current;
    setText("");
    setError(null);
    setLoading(true);
    setLastRunAt(Date.now());
    stopRef.current = runIpsecInsightSSE({
      onEvent: (e) => {
        if (myRun !== runIdRef.current) return; // ignore a superseded run
        if (e.event === "chunk" && typeof e.data.text === "string") {
          setText((t) => t + (e.data.text as string));
        } else if (e.event === "error" && typeof e.data.message === "string") {
          setError(e.data.message as string);
          setLoading(false);
        }
      },
      onError: (msg) => {
        if (myRun === runIdRef.current) { setError(msg); setLoading(false); }
      },
      onDone: () => { if (myRun === runIdRef.current) setLoading(false); },
    });
  }, []);

  // Auto-generate once the first payload has arrived. The cleanup aborts the
  // stream, so a StrictMode remount re-fires cleanly rather than leaving the
  // only run aborted; it fires once because `hasPayload` flips false→true once.
  const hasPayload = receivedAt > 0;
  useEffect(() => {
    if (!hasPayload) return;
    generate();
    return () => stopRef.current?.();
  }, [hasPayload, generate]);

  return (
    <Card
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={13} style={{ color: c.accent3 }} />
          AI Insight
        </span>
      }
      sub={
        lastRunAt ? (
          <span>
            Analysis grounded in the live IPsec snapshot · last run{" "}
            {fmtAgo(lastRunAt)}
          </span>
        ) : (
          "Bedrock Claude interpreting your gateway telemetry"
        )
      }
      right={
        <button
          onClick={generate}
          disabled={loading}
          style={
            loading
              ? { background: "var(--panel-2)", color: "var(--text-muted)" }
              : {
                  background: "var(--grad-accent-soft)",
                  borderColor: "var(--accent)",
                  color: "var(--text)",
                }
          }
        >
          {loading ? (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Loader2 size={13} className="spin" />
              Analyzing…
            </span>
          ) : (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Sparkles size={13} />
              Regenerate
            </span>
          )}
        </button>
      }
    >
      <div
        style={{
          background:
            "linear-gradient(180deg, rgba(192,132,252,0.04), transparent 60%), var(--panel-2)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "14px 16px",
          minHeight: 120,
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--text-dim)",
        }}
      >
        {error ? (
          <div style={{ color: c.err, fontSize: 12.5 }}>
            <strong>Couldn't generate analysis:</strong> {error}
          </div>
        ) : text ? (
          <RichText text={text} />
        ) : loading ? (
          <div
            style={{
              color: "var(--text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Loader2 size={13} className="spin" />
            Reading the latest payload from{" "}
            <span className="mono">rdk/ipsec/metrics</span>…
          </div>
        ) : (
          <div style={{ color: "var(--text-muted)" }}>
            Click <strong style={{ color: "var(--text)" }}>Regenerate</strong>{" "}
            to analyze the current telemetry.
          </div>
        )}
      </div>
    </Card>
  );
}

function SlaCard({
  label,
  unit,
  fiberVal,
  fivegVal,
  fiberOk,
  fivegOk,
  series,
  digits = 0,
}: {
  label: string;
  unit: string;
  fiberVal: number;
  fivegVal: number;
  fiberOk: boolean;
  fivegOk: boolean;
  series: number[];
  digits?: number;
}) {
  const c = useThemeColors();
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div
          className="kpi-icon"
          style={{
            background:
              "linear-gradient(135deg, rgba(var(--accent-rgb) / 0.22), transparent)",
            color: "var(--accent)",
          }}
        >
          <Activity size={16} />
        </div>
        <div className="kpi-label">{label}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div
            style={{
              fontSize: 10,
              color: c.accent,
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            FIBER
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: fiberOk ? c.text : c.warn,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fiberVal.toFixed(digits)}
            {unit && ` ${unit}`}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: 10,
              color: c.accent2,
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            5G
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: fivegOk ? c.text : c.warn,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fivegVal.toFixed(digits)}
            {unit && ` ${unit}`}
          </div>
        </div>
      </div>
      <div style={{ marginTop: "auto" }}>
        <Sparkline
          values={series}
          width={220}
          height={24}
          stroke={c.accent}
          fill={`rgba(${c.accent === "#7cffd4" ? "124,255,212" : "6,214,160"}, 0.20)`}
        />
      </div>
    </div>
  );
}

/** KPI card: Wi-Fi RSSI for the devices associated to the gateway. Real values
 *  from the payload's `wifi.clients[].rssi` (dBm). Shows the average signal,
 *  client count, and a per-client signal bar list. */
function RssiCard({ clients }: { clients: IpsecWifiClient[] }) {
  const c = useThemeColors();
  const [open, setOpen] = useState(false);
  // A real association has a negative dBm; 0 means "no reading".
  const valid = clients.filter((cl) => cl.rssi < 0);
  const count = valid.length;
  const avg = count
    ? Math.round(valid.reduce((s, x) => s + x.rssi, 0) / count)
    : 0;
  const qcol = (dbm: number) => (dbm >= -55 ? c.ok : dbm >= -67 ? c.warn : c.err);
  // Bucket the fleet by signal quality — constant-size display for any N clients
  // (5 or 50), instead of a per-client list that would overflow the card.
  const strong = valid.filter((cl) => cl.rssi >= -55).length;
  const fair = valid.filter((cl) => cl.rssi < -55 && cl.rssi >= -67).length;
  const weak = valid.filter((cl) => cl.rssi < -67).length;
  // The one client that actually needs attention (lowest signal).
  const worst = valid.reduce<IpsecWifiClient | null>(
    (a, b) => (a && a.rssi <= b.rssi ? a : b),
    null,
  );
  // Full list (weakest first) for the click-through modal.
  const sorted = [...valid].sort((a, b) => a.rssi - b.rssi);
  // Map -90…-30 dBm → 0…100% for the signal bars.
  const pct = (dbm: number) => Math.max(4, Math.min(100, ((dbm + 90) / 60) * 100));
  return (
    <>
    <div
      className="kpi-card"
      onClick={() => count > 0 && setOpen(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && count > 0) setOpen(true);
      }}
      style={{ cursor: count > 0 ? "pointer" : "default" }}
      title={count > 0 ? "View all connected devices" : undefined}
    >
      <div className="kpi-top">
        <div
          className="kpi-icon"
          style={{
            background:
              "linear-gradient(135deg, rgba(var(--accent-rgb) / 0.22), transparent)",
            color: "var(--accent)",
          }}
        >
          <Wifi size={16} />
        </div>
        <div className="kpi-label">Wi-Fi RSSI</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div
            style={{
              fontSize: 10,
              color: c.textMuted,
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            AVERAGE
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: count ? qcol(avg) : c.textMuted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {count ? `${avg} dBm` : "—"}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: 10,
              color: c.textMuted,
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            CLIENTS
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: c.text,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {count}
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {count === 0 ? (
          <div style={{ fontSize: 11, color: c.textMuted }}>
            No Wi-Fi clients connected
          </div>
        ) : (
          <>
            {/* Signal-quality distribution — proportional, so it stays one row
                whether there are 2 clients or 50. */}
            <div
              style={{
                display: "flex",
                height: 6,
                borderRadius: 3,
                overflow: "hidden",
                background: "rgba(255,255,255,0.08)",
              }}
            >
              {[
                { n: strong, color: c.ok },
                { n: fair, color: c.warn },
                { n: weak, color: c.err },
              ].map((seg, i) =>
                seg.n > 0 ? (
                  <span
                    key={i}
                    style={{ width: `${(seg.n / count) * 100}%`, background: seg.color }}
                  />
                ) : null,
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                fontSize: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: c.ok }}>● {strong} strong</span>
              <span style={{ color: c.warn }}>● {fair} fair</span>
              <span style={{ color: c.err }}>● {weak} weak</span>
            </div>
            {worst && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 10.5,
                }}
              >
                <span
                  style={{
                    color: c.textMuted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  Weakest · {worst.hostname || worst.mac}
                </span>
                <span
                  className="mono"
                  style={{ color: qcol(worst.rssi), fontWeight: 600 }}
                >
                  {worst.rssi} dBm
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>

    {/* Click-through: full RSSI list for every connected Wi-Fi client. */}
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={`Wi-Fi RSSI · ${count} connected ${count === 1 ? "device" : "devices"}`}
      width={480}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxHeight: 380,
          overflowY: "auto",
        }}
      >
        {sorted.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: 8 }}>
            No Wi-Fi clients connected to the gateway.
          </div>
        ) : (
          sorted.map((cl) => {
            const col = qcol(cl.rssi);
            return (
              <div
                key={cl.mac}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cl.hostname || cl.mac}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 10.5, color: "var(--text-muted)" }}
                  >
                    {[
                      cl.mac,
                      cl.ip || null,
                      cl.standard ? `802.11${cl.standard}` : null,
                      cl.snr ? `SNR ${cl.snr} dB` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 96 }}>
                  <div
                    className="mono"
                    style={{ fontSize: 14, fontWeight: 700, color: col }}
                  >
                    {cl.rssi} dBm
                  </div>
                  <div
                    style={{
                      width: 80,
                      height: 4,
                      borderRadius: 2,
                      background: "rgba(255,255,255,0.08)",
                      overflow: "hidden",
                      marginTop: 3,
                      marginLeft: "auto",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: `${pct(cl.rssi)}%`,
                        height: "100%",
                        background: col,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
    </>
  );
}

/* ───────────── Live IPsec ingest card ─────────────
 * Shows the latest `IpsecMetrics` per gateway streamed from AWS IoT Core
 * (gateway → MQTT rdk/ipsec/metrics → protobuf decode in our server → SSE).
 * Designed to render gracefully across all states: no creds, not yet
 * connected, connected but no payload yet, one gateway, many gateways. */

function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** A real sample payload captured from the rdk-bpi4-gateway device — used for
 *  the "Load sample" preview button so you can see the UI even without AWS
 *  credentials locally. Values are exact (latency=-1 sentinel, loss=100,
 *  active_tunnel=vti-fiber not matching any physical interface, etc.). */
const SAMPLE_IPSEC_GATEWAY: IpsecGatewayState = {
  receivedAt: Date.now(),
  metrics: {
    timestamp_ms: 1778815945164,
    active_tunnel: "vti-fiber",
    tunnel_count: 0,
    tunnels: [
      {
        ifname: "vti0",
        present: false,
        reachable: false,
        latency_ms: -1,
        loss_percent: 100,
        rx_bytes: 0,
        tx_bytes: 0,
      },
      {
        ifname: "vti1",
        present: false,
        reachable: false,
        latency_ms: -1,
        loss_percent: 100,
        rx_bytes: 0,
        tx_bytes: 0,
      },
      {
        ifname: "vti2",
        present: false,
        reachable: false,
        latency_ms: -1,
        loss_percent: 100,
        rx_bytes: 0,
        tx_bytes: 0,
      },
      {
        ifname: "vti3",
        present: false,
        reachable: false,
        latency_ms: -1,
        loss_percent: 100,
        rx_bytes: 0,
        tx_bytes: 0,
      },
    ],
    wan: {
      ifname: "erouter0",
      link_up: true,
      rx_bytes: 1552669,
      tx_bytes: 924513,
      rx_packets: 11696,
      tx_packets: 6137,
    },
    gateway: {
      name: "rdk-bpi4-gateway",
      mac: "02:01:00:60:53:8b",
      prim_wan_ip: "192.168.1.201",
      sec_wan_ip: "none",
    },
  },
};

function fmtAgo(ms: number) {
  if (!ms) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function LiveIpsecCard({
  ipsec,
  showSample,
  onToggleSample,
  effectiveList,
  branchTopic,
}: {
  ipsec: ReturnType<typeof useIpsecMetrics>;
  showSample: boolean;
  onToggleSample: () => void;
  effectiveList: IpsecGatewayState[];
  /** Topic the current branch is bound to (e.g. `rdk/ipsec/metrics` for
   *  Plano, `prpl/ipsec/metrics` for McKinney). Falls back to the server's
   *  full subscription list when the branch has no live mapping. */
  branchTopic: string | null;
}) {
  const c = useThemeColors();
  const empty = effectiveList.length === 0;

  // Show only the topic this branch actually consumes, not the server's full
  // multi-subscription list. The server still subscribes to both topics; the
  // UI just hides the irrelevant one for this branch.
  const topicLabel = branchTopic ?? ipsec.subscribedTopic ?? "ipsec/metrics";

  // Connection state pill — three states: streaming / waiting / disconnected.
  const pill = showSample ? (
    <span className="badge warn">
      <span className="dot warn" />
      Preview · captured payload
    </span>
  ) : ipsec.connected ? (
    <span className="badge ok">
      <span className="dot ok" />
      {/* Streaming · {topicLabel} */}
      Streaming
    </span>
  ) : ipsec.lastError ? (
    <span className="badge err">
      <span className="dot err" />
      {ipsec.lastError}
    </span>
  ) : (
    <span className="badge warn">
      <span className="dot warn" />
      Connecting…
    </span>
  );

  return (
    <Card
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Cloud size={13} />
          Live IPsec ingest{" "}
          <span
            style={{
              fontSize: 10.5,
              color: "var(--text-muted)",
              fontWeight: 500,
              letterSpacing: 0,
            }}
          >
            (AWS IoT Core)
          </span>
        </span>
      }
      // sub={ipsec.endpoint
      //   ? <span className="mono" style={{ fontSize: 11 }}>{ipsec.endpoint}</span>
      //   : 'protobuf decoded server-side · pushed to the dashboard via SSE'}
      right={
        <div className="toolbar">
          <button
            onClick={onToggleSample}
            title="Render the UI using a captured rdk-bpi4-gateway payload"
            style={
              showSample
                ? {
                    background: "var(--grad-accent-soft)",
                    borderColor: "var(--accent)",
                    color: "var(--text)",
                  }
                : undefined
            }
          >
            {showSample ? "Hide preview" : "Load preview"}
          </button>
          {pill}
        </div>
      }
    >
      {empty ? (
        <div
          style={{
            padding: "24px 12px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            color: "var(--text-muted)",
            fontSize: 12.5,
          }}
        >
          <Activity size={18} />
          <div>
            <div style={{ color: "var(--text-dim)", fontWeight: 600 }}>
              No payload yet on <span className="mono">{topicLabel}</span>
            </div>
            <div style={{ fontSize: 11, marginTop: 2 }}>
              The first decoded message will populate this card automatically —
              or click{" "}
              <strong style={{ color: "var(--text)" }}>Load preview</strong> to
              render with a captured payload.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {effectiveList.map((g) => (
            <GatewayBlock
              key={g.metrics.gateway.name}
              g={g}
              c={c}
              sample={showSample}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/** UI highlight state for the three path-override buttons. */
type ForceMode = "auto" | "fiber" | "5g";

/** Topology view mode: `live` mirrors the device (single active tunnel, IT+OT
 *  share it); `target` shows the application-aware routing policy (IT/OT split
 *  across tunnels) as a roadmap capability. */
type ViewMode = "live" | "target";

/** Device-class colours — shared by the device links, the topology flows, and
 *  the per-tunnel rows so the IT/OT story reads consistently everywhere. */
const IT_COLOR = "#34d399"; // emerald — IT devices
const OT_COLOR = "#ec4899"; // pink — OT devices
const classColorOf = (cls: "it" | "ot") => (cls === "it" ? IT_COLOR : OT_COLOR);

/** Application-aware routing demo policy (hardcoded, mode-aware). Returns which
 *  device class egresses on a given tunnel, where `idx` is the tunnel's position
 *  within its underlay (0 = Tunnel 1/3, 1 = Tunnel 2/4):
 *   • auto       → IT on the first Fiber tunnel, OT on the first 5G tunnel.
 *   • Force Fiber → both on Fiber: IT = Tunnel 1, OT = Tunnel 2 (5G idle).
 *   • Force 5G    → both on 5G:    IT = Tunnel 3, OT = Tunnel 4 (Fiber idle).
 *  Single source of truth for the topology diagram AND the per-tunnel rows. */
function routeClassFor(
  mode: ForceMode,
  underlay: Underlay,
  idx: number,
): "it" | "ot" | null {
  if (mode === "fiber")
    return underlay === "fiber" ? (idx === 0 ? "it" : idx === 1 ? "ot" : null) : null;
  if (mode === "5g")
    return underlay === "5g" ? (idx === 0 ? "it" : idx === 1 ? "ot" : null) : null;
  // auto: IT on the first Fiber tunnel, OT on the first 5G tunnel.
  if (underlay === "fiber") return idx === 0 ? "it" : null;
  return idx === 0 ? "ot" : null;
}

/** The exact `mode` strings the gateway's local path API (`/api/path`) accepts.
 *  `auto` lets the device decide; `tunnel1`/`tunnel2` pin the two Fiber tunnels,
 *  `tunnel3`/`tunnel4` pin the two 5G tunnels. The UI now exposes only two
 *  overrides — Force Fiber pins `tunnel1`, Force 5G pins `tunnel3` — but the
 *  other commands (`tunnel2`/`tunnel4`, `fiber`/`5g`) stay valid on the API. */
type PathCommand =
  | "auto"
  | "fiber"
  | "5g"
  | "tunnel1"
  | "tunnel2"
  | "tunnel3"
  | "tunnel4";

/** Calls the gateway's path-control endpoint via the same-origin proxy
 *  (`server/index.ts → /api/gateway/path`). The server publishes the command
 *  to AWS IoT Core (`<source>/path/control`); the gateway's pathcontrol
 *  Greengrass component applies it locally and acks. Returns whether the
 *  gateway confirmed (ok) or the command was sent but not yet acked (pending). */
async function postGatewayPathMode(
  mode: PathCommand,
  source: "rdk" | "prpl",
): Promise<{ pending: boolean }> {
  const res = await fetch("/api/gateway/path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, source }),
  });
  // 202 = published but no ack yet (component may be offline). Treat as a soft
  // success so the UI keeps the optimistic flip but flags it as unconfirmed.
  if (res.status === 202) return { pending: true };
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `gateway returned ${res.status}`);
  }
  return { pending: false };
}

function GatewayBlock({
  g,
  c,
}: {
  g: IpsecGatewayState;
  c: ThemeColors;
  sample?: boolean;
}) {
  const m = g.metrics;
  const [forceMode, setForceMode] = useState<ForceMode>("auto");
  // Topology view: "live" mirrors the device exactly (single active tunnel, both
  // IT+OT on it); "target" shows the application-aware routing policy (IT/OT
  // steered onto separate tunnels) as a roadmap capability. Default = live.
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [pathBusy, setPathBusy] = useState(false);
  // The specific tunnel ifname the Force button pinned — so the diagram
  // and rows highlight that exact tunnel, not just the first reachable one in
  // the underlay. Null in auto mode (the device decides).
  const [forcedTunnel, setForcedTunnel] = useState<string | null>(null);
  const { push } = useToast();
  // Device presence — gate the per-tunnel rows' IT/OT tags so they match the
  // topology (no IT devices ⇒ no IT tag, same as no IT flow in the diagram).
  const { devices: blockDevices } = useDevices();
  const hasIT = blockDevices.some((d) => d.domain === "IT");
  const hasOT = blockDevices.some((d) => d.domain === "OT");

  // The gateway's topic family — drives which IoT Core topic the command is
  // published to. Falls back to 'rdk' for the captured-sample / unknown case.
  const source: "rdk" | "prpl" = g.source === "prpl" ? "prpl" : "rdk";

  const commandTitle = (cmd: PathCommand) =>
    cmd === "auto"
      ? "Auto path-selection"
      : cmd === "tunnel1"
        ? "Forced to Fiber · Tunnel 1"
        : cmd === "tunnel2"
          ? "Forced to Fiber · Tunnel 2"
          : cmd === "tunnel3"
            ? "Forced to 5G · Tunnel 3"
            : cmd === "tunnel4"
              ? "Forced to 5G · Tunnel 4"
              : cmd === "fiber"
                ? "Forced to Fiber"
                : "Forced to 5G";

  /** Publishes a path-control command to the gateway's Greengrass component over
   *  IoT Core. `highlight` is the button to light up (auto / fiber / 5g); `command`
   *  is the exact `mode` published (auto, or tunnel1–tunnel4). Optimistically flips
   *  the UI and reverts on hard failure; a "pending" ack (component offline) keeps
   *  the flip but flags it as unconfirmed. */
  const applyPathMode = async (
    highlight: ForceMode,
    command: PathCommand,
    tunnelIfname?: string,
  ) => {
    if (pathBusy) return;
    const previous = forceMode;
    const previousTunnel = forcedTunnel;
    setForceMode(highlight);
    setForcedTunnel(highlight === "auto" ? null : (tunnelIfname ?? null));
    setPathBusy(true);
    try {
      const { pending } = await postGatewayPathMode(command, source);
      push(
        pending
          ? {
              kind: "info",
              title: `${commandTitle(command)} — command sent`,
              detail:
                "Published to the gateway, but no ack received yet. It may apply once the gateway reconnects.",
            }
          : {
              kind: "success",
              title: commandTitle(command),
              detail: "Gateway confirmed the mode change.",
            },
      );
    } catch (err) {
      setForceMode(previous);
      setForcedTunnel(previousTunnel);
      push({
        kind: "error",
        title: "Path-change failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPathBusy(false);
    }
  };

  // Compute live WAN throughput + packet rate from successive payloads so the
  // diagram can show a numerical badge along the active path.
  const lastWanRef = useRef<{
    rx: number;
    tx: number;
    rxp: number;
    txp: number;
    ts: number;
  } | null>(null);
  const [wanMbps, setWanMbps] = useState<number | null>(null);
  const [wanPps, setWanPps] = useState<number | null>(null);
  useEffect(() => {
    const ts = g.receivedAt;
    const rx = m.wan.rx_bytes;
    const tx = m.wan.tx_bytes;
    const rxp = m.wan.rx_packets;
    const txp = m.wan.tx_packets;
    const prev = lastWanRef.current;
    if (prev) {
      const dt = (ts - prev.ts) / 1000;
      if (dt > 0.1) {
        const bytes = Math.max(0, rx - prev.rx + (tx - prev.tx));
        const pkts = Math.max(0, rxp - prev.rxp + (txp - prev.txp));
        setWanMbps((bytes * 8) / dt / 1_000_000);
        setWanPps(pkts / dt);
      }
    }
    lastWanRef.current = { rx, tx, rxp, txp, ts };
  }, [
    g.receivedAt,
    m.wan.rx_bytes,
    m.wan.tx_bytes,
    m.wan.rx_packets,
    m.wan.tx_packets,
  ]);

  // ── Per-tunnel time-series: live throughput (Mbps), rolling latency history
  //    (for sparklines + jitter), and active-tunnel failover events. All from
  //    successive real payloads; keyed by ifname so they survive re-renders. ──
  const lastTunnelRef = useRef<Record<string, { bytes: number; ts: number }>>({});
  const prevActiveRef = useRef<string>("");
  const [tunnelRates, setTunnelRates] = useState<Record<string, number>>({});
  const [tunnelHist, setTunnelHist] = useState<Record<string, number[]>>({});
  const [flowEvents, setFlowEvents] = useState<
    { ts: number; kind: "flip" | "breach"; text: string }[]
  >([]);
  useEffect(() => {
    const ts = g.receivedAt;
    // Per-tunnel Mbps from rx+tx byte deltas.
    const rates: Record<string, number> = {};
    for (const t of m.tunnels) {
      const bytes = t.rx_bytes + t.tx_bytes;
      const prev = lastTunnelRef.current[t.ifname];
      if (prev) {
        const dt = (ts - prev.ts) / 1000;
        if (dt > 0.1) {
          rates[t.ifname] = Math.max(0, ((bytes - prev.bytes) * 8) / dt / 1e6);
        }
      }
      lastTunnelRef.current[t.ifname] = { bytes, ts };
    }
    if (Object.keys(rates).length) {
      setTunnelRates((prev) => ({ ...prev, ...rates }));
    }
    // Rolling latency history per tunnel (last 24 samples) for sparkline+jitter.
    setTunnelHist((prev) => {
      const next = { ...prev };
      for (const t of m.tunnels) {
        if (t.reachable && t.latency_ms > 0) {
          next[t.ifname] = [...(prev[t.ifname] ?? []), t.latency_ms].slice(-24);
        }
      }
      return next;
    });
    // Failover events — record active-tunnel flips + SLA breaches this session.
    const a = (m.active_tunnel ?? "").trim();
    const newEvents: { ts: number; kind: "flip" | "breach"; text: string }[] = [];
    if (prevActiveRef.current && a && prevActiveRef.current !== a) {
      newEvents.push({ ts, kind: "flip", text: `${prevActiveRef.current} → ${a}` });
    }
    prevActiveRef.current = a;
    const act = m.tunnels.find((t) => t.ifname === a);
    if (act && act.reachable && (act.latency_ms > 150 || act.loss_percent > 3)) {
      newEvents.push({
        ts,
        kind: "breach",
        text: `${a} ${act.latency_ms > 150 ? `${act.latency_ms.toFixed(0)}ms` : `${act.loss_percent.toFixed(1)}% loss`}`,
      });
    }
    if (newEvents.length) {
      setFlowEvents((e) => [...e, ...newEvents].slice(-40));
    }
  }, [g.receivedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Composite SLA score (0–100) per tunnel: latency + loss + jitter penalties.
  const jitterOf = (ifname: string) => stddev(tunnelHist[ifname] ?? []);
  const slaScoreOf = (t: IpsecTunnelMetric): number => {
    if (!t.reachable || t.latency_ms < 0) return 0;
    const latPen = Math.min(45, (t.latency_ms / 150) * 45);
    const lossPen = Math.min(35, t.loss_percent * (35 / 3));
    const jitPen = Math.min(20, (jitterOf(t.ifname) / 60) * 20);
    return Math.round(Math.max(0, 100 - latPen - lossPen - jitPen));
  };

  // Resolve the "effective" active tunnel: in auto mode, the device decides;
  // in force mode the UI overrides to the exact tunnel the user pinned via the
  // picker (so the diagram + rows highlight *that* tunnel — e.g. Tunnel 4, not
  // just the first reachable one in the underlay). Falls back to the first
  // reachable tunnel in the forced underlay if no specific pin is set.
  // (UI-only override — device behaviour unchanged.)
  const deviceActive = (m.active_tunnel ?? "").trim();
  const effectiveActiveTunnel = (() => {
    if (forceMode === "auto") return deviceActive;
    if (forcedTunnel) return forcedTunnel;
    const pool = m.tunnels.filter(
      (t) =>
        inferUnderlay(t.ifname) === (forceMode === "fiber" ? "fiber" : "5g"),
    );
    const pick = pool.find((t) => t.reachable) ?? pool[0];
    return pick?.ifname ?? deviceActive;
  })();
  const effectiveM =
    forceMode === "auto" ? m : { ...m, active_tunnel: effectiveActiveTunnel };

  // App-aware class each tunnel carries (IT / OT / none) under the current mode
  // — same `routeClassFor` policy the topology diagram uses, so the per-tunnel
  // rows below tag the exact tunnels the diagram lights up. Resolved by the
  // tunnel's position within its underlay (Tunnel 1/3 = idx 0, Tunnel 2/4 = 1).
  const fiberOrdered = orderTunnelsByName(
    m.tunnels.filter((t) => inferUnderlay(t.ifname) === "fiber"),
  );
  const cellOrdered = orderTunnelsByName(
    m.tunnels.filter((t) => inferUnderlay(t.ifname) === "5g"),
  );
  const isTarget = viewMode === "target";
  // In target view a tunnel is tagged with the class it carries (app-aware
  // policy); in live view there are no per-class tags (one active tunnel).
  const tunnelClass = (t: IpsecTunnelMetric): "it" | "ot" | null => {
    if (!isTarget) return null;
    const underlay = inferUnderlay(t.ifname);
    const list = underlay === "fiber" ? fiberOrdered : cellOrdered;
    const idx = list.findIndex((x) => x.ifname === t.ifname);
    const cls = routeClassFor(forceMode, underlay, idx);
    // Drop the tag when that class has no connected devices.
    if (cls === "it" && !hasIT) return null;
    if (cls === "ot" && !hasOT) return null;
    return cls;
  };
  // A row is "active/carrying": in target view, if it carries a class; in live
  // view, if it's the device's single active tunnel.
  const rowActive = (t: IpsecTunnelMetric): boolean =>
    isTarget ? tunnelClass(t) != null : t.ifname === effectiveActiveTunnel;
  // Carrier tunnel names for the gateway header — same policy as the diagram +
  // rows, so the header never disagrees with what's shown below it.
  const itCarrierName = m.tunnels.find((t) => tunnelClass(t) === "it")?.ifname;
  const otCarrierName = m.tunnels.find((t) => tunnelClass(t) === "ot")?.ifname;

  // Force Fiber pins Tunnel 1 (first fiber tunnel, vti1); Force 5G pins Tunnel 3
  // (first 5G tunnel, vti3). We pass the matching ifname so the diagram + rows
  // highlight that exact tunnel. The published command is fixed (tunnel1/tunnel3)
  // and fires even if the tunnel is currently down.
  const fiberTunnelIfname = orderTunnelsByName(
    m.tunnels.filter((t) => inferUnderlay(t.ifname) === "fiber"),
  )[0]?.ifname;
  const cellTunnelIfname = orderTunnelsByName(
    m.tunnels.filter((t) => inferUnderlay(t.ifname) === "5g"),
  )[0]?.ifname;

  const upCount = m.tunnels.filter((t) => t.present && t.reachable).length;

  return (
    <div className="ipsec-gw">
      {/* Header — gateway identity */}
      <div className="ipsec-gw-head">
        <span
          className="ipsec-gw-icon"
          style={{
            color: c.accent3,
            background: `linear-gradient(135deg, ${c.accent3}33, transparent)`,
          }}
        >
          <Cpu size={14} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ipsec-gw-name">
            {displayGatewayName(m.gateway.name) || "Unknown gateway"}
          </div>
          <div className="ipsec-gw-sub mono">
            {[
              m.gateway.name,
              m.gateway.mac,
              m.gateway.prim_wan_ip && `primary ${m.gateway.prim_wan_ip}`,
              m.gateway.sec_wan_ip &&
                m.gateway.sec_wan_ip.toLowerCase() !== "none" &&
                `secondary ${m.gateway.sec_wan_ip}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="ipsec-gw-meta">
          <div className="ipsec-gw-meta-kv">
            <span>TUNNELS UP</span>
            <strong style={{ color: upCount > 0 ? c.ok : c.err }}>
              {upCount} / {m.tunnels.length}
            </strong>
          </div>
          {isTarget ? (
            <div className="ipsec-gw-meta-kv">
              <span>CARRYING</span>
              <strong
                style={{
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 1,
                  lineHeight: 1.2,
                }}
              >
                <span style={{ color: IT_COLOR }}>
                  IT · {itCarrierName ?? "—"}
                </span>
                <span style={{ color: OT_COLOR }}>
                  OT · {otCarrierName ?? "—"}
                </span>
              </strong>
            </div>
          ) : (
            <div className="ipsec-gw-meta-kv">
              <span>ACTIVE</span>
              <strong style={{ color: c.accent3 }}>
                {effectiveActiveTunnel || "—"}
              </strong>
            </div>
          )}
          <div className="ipsec-gw-meta-kv">
            <span>RECEIVED</span>
            <strong>{fmtAgo(g.receivedAt)}</strong>
          </div>
        </div>
      </div>

      {/* Path override controls — Auto / Force Fiber / Force 5G */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "2px 4px",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            letterSpacing: "0.04em",
          }}
        >
          Path override
          {pathBusy && (
            <span
              className="badge"
              style={{
                fontSize: 9,
                padding: "1px 6px",
                marginLeft: 8,
                color: c.accent3,
              }}
            >
              <Loader2 size={9} className="spin" style={{ marginRight: 4 }} />
              Sending…
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {/* View toggle — Live (device truth) vs Target policy (app-aware) */}
          <div className="toolbar">
            {(
              [
                { id: "live", label: "Live" },
                { id: "target", label: "Target policy" },
              ] as { id: ViewMode; label: string }[]
            ).map((v) => (
              <button
                key={v.id}
                onClick={() => setViewMode(v.id)}
                title={
                  v.id === "live"
                    ? "Live device path — single active tunnel from telemetry"
                    : "Application-aware routing policy — IT/OT steered onto separate tunnels"
                }
                style={
                  v.id === viewMode
                    ? {
                        background: "var(--grad-accent-soft)",
                        borderColor: "rgba(124,140,255,0.35)",
                        color: "var(--text)",
                      }
                    : undefined
                }
              >
                {v.label}
              </button>
            ))}
          </div>
          <span
            style={{ width: 1, height: 20, background: "var(--border)" }}
            aria-hidden
          />
          <div className="toolbar">
            {(
              [
                { id: "auto", label: "Auto" },
                { id: "fiber", label: "Force Fiber" },
                { id: "5g", label: "Force 5G" },
              ] as { id: ForceMode; label: string }[]
            ).map((b) => (
              <button
                key={b.id}
                onClick={() =>
                  b.id === "auto"
                    ? applyPathMode("auto", "auto")
                    : b.id === "fiber"
                      ? applyPathMode("fiber", "tunnel1", fiberTunnelIfname)
                      : applyPathMode("5g", "tunnel3", cellTunnelIfname)
                }
                disabled={pathBusy}
                style={
                  b.id === forceMode
                    ? {
                        background: "var(--grad-accent-soft)",
                        borderColor: "rgba(124,140,255,0.35)",
                        color: "var(--text)",
                      }
                    : undefined
                }
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Real-data topology flow */}
      <IpsecFlowSvg
        m={effectiveM}
        c={c}
        wanMbps={wanMbps}
        wanPps={wanPps}
        forceMode={forceMode}
        viewMode={viewMode}
        tunnelRates={tunnelRates}
        tunnelHist={tunnelHist}
      />

      {/* Failover / SLA event ribbon — flips + breaches over the live session */}
      <FlowEventRibbon events={flowEvents} c={c} />

      {/* WAN line — link status + counters */}
      <div className="ipsec-gw-wan">
        <span
          style={{
            color: m.wan.link_up ? c.ok : c.err,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: 0.04,
          }}
        >
          <Wifi size={11} />
          WAN {m.wan.ifname || "unknown"} · {m.wan.link_up ? "UP" : "DOWN"}
        </span>
        <span className="ipsec-gw-wan-counter">
          <ArrowDown size={10} />
          {fmtBytes(m.wan.rx_bytes)}{" "}
          <span className="dim">
            ({m.wan.rx_packets.toLocaleString()} pkts)
          </span>
        </span>
        <span className="ipsec-gw-wan-counter">
          <ArrowUp size={10} />
          {fmtBytes(m.wan.tx_bytes)}{" "}
          <span className="dim">
            ({m.wan.tx_packets.toLocaleString()} pkts)
          </span>
        </span>
      </div>

      {/* Tunnels — one row per */}
      <div className="ipsec-tunnels">
        {m.tunnels.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontStyle: "italic",
              padding: 8,
            }}
          >
            No tunnels reported.
          </div>
        ) : (
          orderTunnelsByName(m.tunnels).map((t) => (
            <TunnelRow
              key={t.ifname}
              t={t}
              // Live view: the device's single active tunnel. Target view: the
              // app-aware carriers. Either way, consistent with the diagram.
              active={rowActive(t)}
              carrierClass={tunnelClass(t)}
              jitter={jitterOf(t.ifname)}
              score={slaScoreOf(t)}
              c={c}
            />
          ))
        )}
      </div>

    </div>
  );
}

/* ───── IPsec topology flow (real-data SVG) ─────
 * Cloud peers on top, vti tunnels mid-top, gateway in the middle,
 * WAN at the bottom. Each tunnel coloured by state; the device-reported
 * `active_tunnel` value (matched by ifname) gets a pulsing border. */
/* ───── IPsec topology — physically-accurate horizontal flow ─────
 * IT/OT devices → Gateway → Fiber & 5G underlays → IPsec tunnels (2 per
 * underlay) → WAN egress (erouter0 → GCP) → Internet (destination).
 * Mirrors the visual idiom of the Overview page's `Topology` widget. */
function IpsecFlowSvg({
  m,
  c,
  wanMbps,
  wanPps,
  forceMode,
  viewMode,
  tunnelRates,
  tunnelHist,
}: {
  m: IpsecGatewayState["metrics"];
  c: ThemeColors;
  /** Live WAN throughput (Mbps) and packet rate (pps), if computed. */
  wanMbps?: number | null;
  wanPps?: number | null;
  /** Live per-tunnel throughput (Mbps), keyed by ifname. */
  tunnelRates: Record<string, number>;
  /** Rolling per-tunnel latency history (ms), keyed by ifname. */
  tunnelHist: Record<string, number[]>;
  /** Active path-override mode — drives the app-aware routing visualisation:
   *  auto → IT rides Fiber / OT rides 5G; fiber → both on Fiber (IT=T1, OT=T2);
   *  5g → both on 5G (IT=T3, OT=T4). */
  forceMode: ForceMode;
  /** `live` mirrors the device (single active tunnel carries IT+OT); `target`
   *  shows the application-aware routing policy (IT/OT split across tunnels). */
  viewMode: ViewMode;
}) {
  // Keep the canvas tight: less dead space = a larger render scale when the
  // SVG is fit to the card width, i.e. bigger, readable labels.
  const W = 1612;
  const H = 480;

  // Live IT/OT device inventory (same feed as the Devices page). Show up to 3
  // per domain as the on-prem endpoints originating traffic into the gateway.
  const { devices: allDevices } = useDevices();
  const itAll = allDevices.filter((d) => d.domain === "IT");
  const otAll = allDevices.filter((d) => d.domain === "OT");
  const itDevices = itAll.slice(0, 3);
  const otDevices = otAll.slice(0, 3);
  // Whether each class actually has connected devices — the topology only draws
  // a class's traffic flow when devices of that class are present.
  const hasIT = itAll.length > 0;
  const hasOT = otAll.length > 0;

  // Hover tooltip — which tunnel is hovered + pointer position within the wrap.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<
    { t: IpsecTunnelMetric; x: number; y: number } | null
  >(null);
  const onTunnelHover = (t: IpsecTunnelMetric) => (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setHover({ t, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  // Column positions — left-to-right physical flow. The IT/OT endpoints sit at
  // the far left and feed the gateway; everything downstream is shifted right to
  // make room (the gateway used to be the leftmost origin).
  const COL_DEVICES = { x: 28, w: 190 };
  const COL_GW = { x: 340, w: 180 };
  const COL_UNDERLAY = { x: 566, w: 160 };
  const COL_MANIFOLD = { x: 772, w: 320 };
  const COL_WAN = { x: 1138, w: 200 };
  const COL_DEST = { x: 1384, w: 200 };

  const GW_H = 120;
  const UNDERLAY_H = 100;
  const DEST_H = 96;
  const WAN_H = 120;

  const ROW_CENTER = H / 2; // 240

  const FIBER_Y = 100; // top of fiber underlay box
  const CELL_Y = H - UNDERLAY_H - 100; // top of 5G underlay box
  // Single destination (Internet) — centred on the GCP egress row.
  const INT_Y = ROW_CENTER - DEST_H / 2;

  const FIBER_COLOR = "#5ac8ff"; // sky blue (Overview's fiber)
  const CELL_COLOR = "#ffa07c"; // peach (Overview's 5G)
  const INT_COLOR = "#a5f3fc"; // cyan
  const GCP_COLOR = "#9aa7ff"; // soft blue-violet (GCP-ish)
  // IT_COLOR / OT_COLOR are module-level (shared with the per-tunnel rows).
  const accentPurple = c.accent3 ?? "#c084fc";

  // Sort within each underlay by name so the pill numbering is stable —
  // Tunnel 1/2 = vti1/vti2 (fiber), Tunnel 3/4 = vti3/vti4 (5G) — matching the
  // tunnel rows and the Force-Fiber/5G picker regardless of payload order.
  const fiberTunnels = orderTunnelsByName(
    m.tunnels.filter((t) => inferUnderlay(t.ifname) === "fiber"),
  );
  const cellTunnels = orderTunnelsByName(
    m.tunnels.filter((t) => inferUnderlay(t.ifname) === "5g"),
  );

  const tunnelColor = (t: IpsecTunnelMetric) => {
    if (!t.present) return c.textMuted;
    if (!t.reachable || t.latency_ms < 0 || t.loss_percent >= 50) return c.err;
    if (t.loss_percent > 3 || t.latency_ms > 150) return c.warn;
    return c.ok;
  };
  const tunnelLabel = (t: IpsecTunnelMetric) => {
    if (!t.present) return "absent";
    if (!t.reachable) return "unreachable";
    if (t.latency_ms < 0) return "no data";
    return `${t.latency_ms.toFixed(0)} ms · ${t.loss_percent.toFixed(1)}%`;
  };

  // Manifold rack layout — grouped Fiber on top, 5G on bottom.
  const MAN_TOP = 60;
  const MAN_H = H - 90;
  const PILL_W = COL_MANIFOLD.w - 32;
  const PILL_H = 44;
  const PILL_X = COL_MANIFOLD.x + (COL_MANIFOLD.w - PILL_W) / 2;
  const FIBER_BAND_Y = MAN_TOP + 32; // header for fiber group
  const FIBER_PILL_START = FIBER_BAND_Y + 22;
  const CELL_BAND_Y = MAN_TOP + MAN_H / 2 + 16;
  const CELL_PILL_START = CELL_BAND_Y + 22;
  const PILL_GAP = 12;
  const fiberPillY = (i: number) => FIBER_PILL_START + i * (PILL_H + PILL_GAP);
  const cellPillY = (i: number) => CELL_PILL_START + i * (PILL_H + PILL_GAP);

  // Bezier with horizontal control handles (Overview's `beziD`).
  const beziD = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const cx1 = a.x + (b.x - a.x) * 0.55;
    const cx2 = a.x + (b.x - a.x) * 0.45;
    return `M ${a.x} ${a.y} C ${cx1} ${a.y}, ${cx2} ${b.y}, ${b.x} ${b.y}`;
  };

  // Anchor points
  const gwLeft = { x: COL_GW.x, y: ROW_CENTER };
  const gwRight = { x: COL_GW.x + COL_GW.w, y: ROW_CENTER };
  const fiberLeft = { x: COL_UNDERLAY.x, y: FIBER_Y + UNDERLAY_H / 2 };
  const fiberRight = {
    x: COL_UNDERLAY.x + COL_UNDERLAY.w,
    y: FIBER_Y + UNDERLAY_H / 2,
  };
  const cellLeft = { x: COL_UNDERLAY.x, y: CELL_Y + UNDERLAY_H / 2 };
  const cellRight = {
    x: COL_UNDERLAY.x + COL_UNDERLAY.w,
    y: CELL_Y + UNDERLAY_H / 2,
  };
  const wanLeft = { x: COL_WAN.x, y: ROW_CENTER };
  const wanRight = { x: COL_WAN.x + COL_WAN.w, y: ROW_CENTER };
  const intLeft = { x: COL_DEST.x, y: INT_Y + DEST_H / 2 };

  const fiberReachable = fiberTunnels.some((t) => t.reachable);
  const cellReachable = cellTunnels.some((t) => t.reachable);
  const anyReachable = fiberReachable || cellReachable;

  // ── Routing visualisation — live vs target-policy ──
  // Live: the device's single active tunnel carries everything ("both"). Target:
  // the app-aware policy splits IT/OT across tunnels (shared `routeClassFor`).
  // `tunnelCarry` is the single source of truth used by every flow leg, pill,
  // row, and badge so the whole page stays consistent.
  const isTarget = viewMode === "target";
  const activeIfname = (m.active_tunnel ?? "").trim();
  const activeUnderlayOf: Underlay | null = activeIfname
    ? inferUnderlay(activeIfname)
    : null;

  // Drop a class when it has no connected devices — no IT devices ⇒ no IT flow.
  const presentClass = (cls: "it" | "ot" | null): "it" | "ot" | null => {
    if (cls === "it") return hasIT ? "it" : null;
    if (cls === "ot") return hasOT ? "ot" : null;
    return null;
  };

  const tunnelCarry = (
    underlay: Underlay,
    idx: number,
    ifname: string,
  ): "it" | "ot" | "both" | null => {
    if (isTarget) return presentClass(routeClassFor(forceMode, underlay, idx));
    // Live: the single active tunnel carries whichever classes are connected.
    if (!ifname || ifname !== activeIfname) return null;
    if (hasIT && hasOT) return "both";
    if (hasIT) return "it";
    if (hasOT) return "ot";
    return null;
  };
  // "both" (live single active tunnel) leads with IT emerald; its trailing
  // particle is OT pink (set per-leg) so one tunnel shows IT+OT together.
  const carryColorOf = (carry: "it" | "ot" | "both") =>
    carry === "it" ? IT_COLOR : carry === "ot" ? OT_COLOR : IT_COLOR;

  // Carrier tunnels for the gateway badge (target = IT/OT carriers, only when
  // that class has devices; live = the single active tunnel).
  const itCarrierTunnel = isTarget && hasIT
    ? (fiberTunnels.find((_t, i) => routeClassFor(forceMode, "fiber", i) === "it") ??
       cellTunnels.find((_t, i) => routeClassFor(forceMode, "5g", i) === "it"))
    : undefined;
  const otCarrierTunnel = isTarget && hasOT
    ? (fiberTunnels.find((_t, i) => routeClassFor(forceMode, "fiber", i) === "ot") ??
       cellTunnels.find((_t, i) => routeClassFor(forceMode, "5g", i) === "ot"))
    : undefined;
  const liveActiveTunnel = isTarget
    ? undefined
    : m.tunnels.find((t) => t.ifname === activeIfname);

  // An underlay reads as "active" only if it carries a *present* class's traffic.
  const fiberActive = fiberTunnels.some(
    (t, i) => tunnelCarry("fiber", i, t.ifname) != null && t.reachable,
  );
  const cellActive = cellTunnels.some(
    (t, i) => tunnelCarry("5g", i, t.ifname) != null && t.reachable,
  );

  // Which underlay each device class is steered into, for the gateway→underlay
  // leg. Target: mode-based split. Live: both classes ride the active underlay.
  const itUnderlay: Underlay = isTarget
    ? forceMode === "5g" ? "5g" : "fiber"
    : activeUnderlayOf ?? "fiber";
  const otUnderlay: Underlay = isTarget
    ? forceMode === "fiber" ? "fiber" : "5g"
    : activeUnderlayOf ?? "fiber";

  // ── Live throughput → reactive flow speed + rate labels ──
  const rateOf = (ifname: string) => tunnelRates[ifname] ?? 0;
  const maxRate = Math.max(
    0,
    ...m.tunnels.filter((t) => t.reachable).map((t) => rateOf(t.ifname)),
  );
  // Busiest carrier ⇒ fastest particles; idle ⇒ slow. Clamped for sanity.
  const flowDur = (ifname: string) => {
    const base = maxRate > 0 ? 1.5 - 0.85 * (rateOf(ifname) / maxRate) : 1.1;
    return Math.max(0.55, Math.min(1.6, base));
  };
  // Carrier stroke width nudges up with relative throughput.
  const flowWidth = (ifname: string) =>
    2.4 + (maxRate > 0 ? (rateOf(ifname) / maxRate) * 1.6 : 0.6);
  const fmtRate = (mbps: number) =>
    mbps >= 1 ? `${mbps.toFixed(1)} Mbps` : `${Math.round(mbps * 1000)} Kbps`;
  // Build a tiny sparkline path inside a box for the latency history.
  const sparkPath = (vals: number[], x: number, y: number, w: number, h: number) => {
    if (vals.length < 2) return "";
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    return vals
      .map((v, i) => {
        const px = x + (i / (vals.length - 1)) * w;
        const py = y + h - ((v - min) / span) * h;
        return `${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`;
      })
      .join(" ");
  };

  // Section title + legend reflect the current view — and only list a class when
  // it actually has connected devices (so the key matches the drawn flows).
  const sectionTitle = isTarget
    ? "Application-aware routing"
    : "Live path · single active tunnel";
  const itLabel = isTarget
    ? forceMode === "fiber"
      ? "IT devices → Fiber · T1"
      : forceMode === "5g"
        ? "IT devices → 5G · T3"
        : "IT devices → Fiber"
    : `IT → ${activeIfname || "active"}`;
  const otLabel = isTarget
    ? forceMode === "fiber"
      ? "OT devices → Fiber · T2"
      : forceMode === "5g"
        ? "OT devices → 5G · T4"
        : "OT devices → 5G"
    : `OT → ${activeIfname || "active"}`;
  const legend: { color: string; label: string }[] = [
    ...(hasIT ? [{ color: IT_COLOR, label: itLabel }] : []),
    ...(hasOT ? [{ color: OT_COLOR, label: otLabel }] : []),
  ];
  if (legend.length === 0) {
    legend.push({ color: c.textMuted, label: "No device traffic" });
  }

  return (
    <div className="ipsec-flow-wrap" ref={wrapRef} style={{ position: "relative" }}>
      {/* App-aware routing legend — colour key for the two concurrent flows */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {sectionTitle}
          {isTarget && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.1em",
                color: c.accent3,
                background: `${c.accent3}1f`,
                border: `1px solid ${c.accent3}55`,
                borderRadius: 999,
                padding: "1px 7px",
              }}
              title="Application-aware routing policy via policy-based routing (fwmark + routing tables) — roadmap capability"
            >
              TARGET POLICY
            </span>
          )}
        </span>
        <span style={{ display: "inline-flex", gap: 16, flexWrap: "wrap" }}>
          {legend.map((l) => (
            <span
              key={l.label}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: l.color,
                  boxShadow: `0 0 6px ${l.color}`,
                }}
              />
              {l.label}
            </span>
          ))}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <defs>
          {/* Live single-active flow carries BOTH classes — emerald (IT) → pink
              (OT) so the one active tunnel visibly shows IT+OT combined. */}
          <linearGradient id="ipsec-flow-active" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={IT_COLOR} />
            <stop offset="100%" stopColor={OT_COLOR} />
          </linearGradient>
          <pattern
            id="ipsec-flow-dotgrid"
            x="0"
            y="0"
            width="22"
            height="22"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="0.9" fill="rgba(255,255,255,0.045)" />
          </pattern>
          <filter id="ipsec-flow-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background dot grid */}
        <rect
          x="0"
          y="0"
          width={W}
          height={H}
          fill="url(#ipsec-flow-dotgrid)"
        />

        {/* Edge-site bounding box — groups Gateway + Underlays + Tunnels as
            "everything that lives on-prem at the branch". */}
        {(() => {
          const EDGE_X = COL_GW.x - 22;
          const EDGE_Y = 48;
          const EDGE_W = COL_MANIFOLD.x + COL_MANIFOLD.w - EDGE_X + 22;
          const EDGE_H = H - EDGE_Y - 24;
          return (
            <g>
              <rect
                x={EDGE_X}
                y={EDGE_Y}
                width={EDGE_W}
                height={EDGE_H}
                rx={20}
                fill="rgba(124,140,255,0.025)"
                stroke="rgba(124,140,255,0.22)"
                strokeDasharray="6 6"
                strokeWidth={1.2}
              />
              <g transform={`translate(${EDGE_X + 18} ${EDGE_Y + 22})`}>
                <rect
                  x={-6}
                  y={-12}
                  width={108}
                  height={20}
                  rx={5}
                  fill="rgba(124,140,255,0.18)"
                />
                <text
                  x={2}
                  y={2}
                  fontSize={12}
                  fontWeight={800}
                  fill="rgba(180,190,255,0.95)"
                  letterSpacing="0.12em"
                >
                  ON-PREM EDGE
                </text>
              </g>
            </g>
          );
        })()}

        {/* Tier labels */}
        {[
          { x: COL_DEVICES.x + COL_DEVICES.w / 2, label: "IT / OT DEVICES" },
          { x: COL_GW.x + COL_GW.w / 2, label: "EDGE GATEWAY" },
          { x: COL_UNDERLAY.x + COL_UNDERLAY.w / 2, label: "WAN UNDERLAYS" },
          { x: COL_MANIFOLD.x + COL_MANIFOLD.w / 2, label: "IPSEC TUNNELS" },
          { x: COL_WAN.x + COL_WAN.w / 2, label: "CLOUD TRANSIT" },
          { x: COL_DEST.x + COL_DEST.w / 2, label: "DESTINATIONS" },
        ].map((t) => (
          <text
            key={t.label}
            x={t.x}
            y={32}
            textAnchor="middle"
            fontSize={11.5}
            fontWeight={700}
            fill={c.textDim}
            letterSpacing="0.14em"
          >
            {t.label}
          </text>
        ))}

        {/* ─── IT/OT endpoints → gateway (on-prem device origins) ─── */}
        <DeviceColumn
          x={COL_DEVICES.x}
          w={COL_DEVICES.w}
          canvasH={H}
          it={itDevices}
          ot={otDevices}
          gwLeft={gwLeft}
          c={c}
          beziD={beziD}
          itColor={IT_COLOR}
          otColor={OT_COLOR}
        />

        {/* ─── Gateway → underlays ───
            Live: both IT+OT merge into the single active tunnel, so draw ONE
            unified active leg (green — matches the flow downstream); the other
            underlay shows as a dim standby in its own colour.
            Target: class-steered split — IT and OT each into their underlay
            (parallel, non-crossing, when they share one). */}
        {(() => {
          // Dim standby links use each underlay's own colour (not alarm-orange).
          const standbyFiber = (
            <NodeConnector a={gwRight} b={fiberLeft} state="ok" c={c} beziD={beziD} accent={FIBER_COLOR} flowing={false} />
          );
          const standbyCell = (
            <NodeConnector a={gwRight} b={cellLeft} state="ok" c={c} beziD={beziD} accent={CELL_COLOR} flowing={false} />
          );

          if (!isTarget) {
            // Live — the connected classes converge on the device's single
            // active tunnel. Only draw a class's line if it has devices; when
            // both are present they run parallel, otherwise the one runs centred.
            const end = activeUnderlayOf === "fiber" ? fiberLeft : cellLeft;
            const both = hasIT && hasOT;
            return (
              <>
                {activeUnderlayOf && hasIT && (
                  <NodeConnector
                    a={{ x: gwRight.x, y: gwRight.y + (both ? -6 : 0) }}
                    b={{ x: end.x, y: end.y + (both ? -8 : 0) }}
                    state="ok"
                    c={c}
                    beziD={beziD}
                    accent={IT_COLOR}
                    flowing
                  />
                )}
                {activeUnderlayOf && hasOT && (
                  <NodeConnector
                    a={{ x: gwRight.x, y: gwRight.y + (both ? 6 : 0) }}
                    b={{ x: end.x, y: end.y + (both ? 8 : 0) }}
                    state="ok"
                    c={c}
                    beziD={beziD}
                    accent={OT_COLOR}
                    flowing
                  />
                )}
                {activeUnderlayOf !== "fiber" && standbyFiber}
                {activeUnderlayOf !== "5g" && standbyCell}
              </>
            );
          }

          // Target — IT/OT split.
          const shared = itUnderlay === otUnderlay;
          const startFor = (u: Underlay, sep: number) => ({
            x: gwRight.x,
            y: gwRight.y + (u === "fiber" ? -10 : 10) + (shared ? sep : 0),
          });
          const endFor = (u: Underlay, sep: number) => {
            const base = u === "fiber" ? fiberLeft : cellLeft;
            return shared ? { x: base.x, y: base.y + sep } : base;
          };
          return (
            <>
              {hasOT && (
                <NodeConnector
                  a={startFor(otUnderlay, -5)}
                  b={endFor(otUnderlay, -8)}
                  state="ok"
                  c={c}
                  beziD={beziD}
                  accent={OT_COLOR}
                  flowing
                />
              )}
              {hasIT && (
                <NodeConnector
                  a={startFor(itUnderlay, 5)}
                  b={endFor(itUnderlay, 8)}
                  state="ok"
                  c={c}
                  beziD={beziD}
                  accent={IT_COLOR}
                  flowing
                />
              )}
              {itUnderlay !== "fiber" && otUnderlay !== "fiber" && standbyFiber}
              {itUnderlay !== "5g" && otUnderlay !== "5g" && standbyCell}
            </>
          );
        })()}

        {/* ─── Underlay → tunnel pills (particles only on active path) ─── */}
        {fiberTunnels.map((t, i) => {
          const col = tunnelColor(t);
          const reachable = t.reachable;
          // What this Fiber tunnel carries in the current view (class / both / none).
          const cls = tunnelCarry("fiber", i, t.ifname);
          const carrying = cls != null && reachable;
          const flowColor = cls ? carryColorOf(cls) : FIBER_COLOR;
          // Live single-active flow shows IT+OT combined (emerald→pink); target
          // class flows stay solid in their own class colour.
          const flowStroke = cls === "both" ? "url(#ipsec-flow-active)" : flowColor;
          const flowDot2 = cls === "both" ? OT_COLOR : flowColor;
          const pid = `ipsec-fiber-in-${i}`;
          const target = { x: PILL_X, y: fiberPillY(i) + PILL_H / 2 };
          const d = beziD(fiberRight, target);
          return (
            <g key={`fiber-in-${i}`}>
              <path
                id={pid}
                d={d}
                fill="none"
                stroke={carrying ? flowStroke : col}
                strokeWidth={carrying ? flowWidth(t.ifname) : reachable ? 1.2 : 0.9}
                strokeDasharray={reachable ? (carrying ? "7 9" : "5 6") : "3 5"}
                opacity={carrying ? 1 : reachable ? 0.32 : 0.22}
                strokeLinecap="round"
              >
                {carrying && (
                  <animate
                    attributeName="stroke-dashoffset"
                    values="0;-32"
                    dur="0.9s"
                    repeatCount="indefinite"
                  />
                )}
              </path>
              {carrying && (
                <>
                  <circle r={4} fill={flowColor} filter="url(#ipsec-flow-glow)">
                    <animateMotion dur={`${flowDur(t.ifname)}s`} repeatCount="indefinite">
                      <mpath href={`#${pid}`} />
                    </animateMotion>
                  </circle>
                  <circle r={2.4} fill={flowDot2} opacity={0.85}>
                    <animateMotion
                      dur={`${flowDur(t.ifname)}s`}
                      begin="0.55s"
                      repeatCount="indefinite"
                    >
                      <mpath href={`#${pid}`} />
                    </animateMotion>
                  </circle>
                </>
              )}
            </g>
          );
        })}
        {cellTunnels.map((t, i) => {
          const col = tunnelColor(t);
          const reachable = t.reachable;
          // What this 5G tunnel carries in the current view (class / both / none).
          const cls = tunnelCarry("5g", i, t.ifname);
          const carrying = cls != null && reachable;
          const flowColor = cls ? carryColorOf(cls) : CELL_COLOR;
          // Live single-active flow shows IT+OT combined (emerald→pink); target
          // class flows stay solid in their own class colour.
          const flowStroke = cls === "both" ? "url(#ipsec-flow-active)" : flowColor;
          const flowDot2 = cls === "both" ? OT_COLOR : flowColor;
          const pid = `ipsec-cell-in-${i}`;
          const target = { x: PILL_X, y: cellPillY(i) + PILL_H / 2 };
          const d = beziD(cellRight, target);
          return (
            <g key={`cell-in-${i}`}>
              <path
                id={pid}
                d={d}
                fill="none"
                stroke={carrying ? flowStroke : col}
                strokeWidth={carrying ? flowWidth(t.ifname) : reachable ? 1.2 : 0.9}
                strokeDasharray={reachable ? (carrying ? "7 9" : "5 6") : "3 5"}
                opacity={carrying ? 1 : reachable ? 0.32 : 0.22}
                strokeLinecap="round"
              >
                {carrying && (
                  <animate
                    attributeName="stroke-dashoffset"
                    values="0;-32"
                    dur="0.9s"
                    repeatCount="indefinite"
                  />
                )}
              </path>
              {carrying && (
                <>
                  <circle r={4} fill={flowColor} filter="url(#ipsec-flow-glow)">
                    <animateMotion dur={`${flowDur(t.ifname)}s`} repeatCount="indefinite">
                      <mpath href={`#${pid}`} />
                    </animateMotion>
                  </circle>
                  <circle r={2.4} fill={flowDot2} opacity={0.85}>
                    <animateMotion
                      dur={`${flowDur(t.ifname)}s`}
                      begin="0.55s"
                      repeatCount="indefinite"
                    >
                      <mpath href={`#${pid}`} />
                    </animateMotion>
                  </circle>
                </>
              )}
            </g>
          );
        })}

        {/* ─── Tunnel pills → WAN (merging; particles only on the active path) ─── */}
        {[
          ...fiberTunnels.map((t, i) => ({
            t,
            i,
            kind: "fiber" as const,
            source: { x: PILL_X + PILL_W, y: fiberPillY(i) + PILL_H / 2 },
          })),
          ...cellTunnels.map((t, i) => ({
            t,
            i,
            kind: "cell" as const,
            source: { x: PILL_X + PILL_W, y: cellPillY(i) + PILL_H / 2 },
          })),
        ].map(({ t, i, kind, source }, idx) => {
          const col = tunnelColor(t);
          const reachable = t.reachable;
          // Same carrier mapping as the inbound leg, colour-matched to what the
          // tunnel carries (IT = emerald, OT = pink, both = IT+OT emerald→pink).
          const cls = tunnelCarry(kind === "fiber" ? "fiber" : "5g", i, t.ifname);
          const carrying = cls != null && reachable;
          const flowColor = cls ? carryColorOf(cls) : col;
          const flowStroke = cls === "both" ? "url(#ipsec-flow-active)" : flowColor;
          const flowDot2 = cls === "both" ? OT_COLOR : flowColor;
          const pid = `ipsec-${kind}-out-${i}`;
          const total = Math.max(1, m.tunnels.length - 1);
          const band = WAN_H / 2 - 22;
          const landY =
            wanLeft.y +
            (idx - m.tunnels.length / 2 + 0.5) * ((band * 2) / total);
          const target = { x: wanLeft.x, y: landY };
          const d = beziD(source, target);
          return (
            <g key={`out-${kind}-${i}`}>
              <path
                id={pid}
                d={d}
                fill="none"
                stroke={carrying ? flowStroke : col}
                strokeWidth={carrying ? flowWidth(t.ifname) : reachable ? 1.2 : 0.9}
                strokeDasharray={reachable ? (carrying ? "7 9" : "5 6") : "3 5"}
                opacity={carrying ? 1 : reachable ? 0.32 : 0.22}
                strokeLinecap="round"
              >
                {carrying && (
                  <animate
                    attributeName="stroke-dashoffset"
                    values="0;-32"
                    dur="0.9s"
                    repeatCount="indefinite"
                  />
                )}
              </path>
              {carrying && (
                <>
                  <circle r={4} fill={flowColor} filter="url(#ipsec-flow-glow)">
                    <animateMotion dur={`${flowDur(t.ifname)}s`} repeatCount="indefinite">
                      <mpath href={`#${pid}`} />
                    </animateMotion>
                  </circle>
                  <circle r={2.4} fill={flowDot2} opacity={0.85}>
                    <animateMotion
                      dur={`${flowDur(t.ifname)}s`}
                      begin="0.55s"
                      repeatCount="indefinite"
                    >
                      <mpath href={`#${pid}`} />
                    </animateMotion>
                  </circle>
                </>
              )}
            </g>
          );
        })}

        {/* ─── GCP transit → Internet (public egress via Cloud NAT, flows
             whenever WAN is up). */}
        <NodeConnector
          a={wanRight}
          b={intLeft}
          state={m.wan.link_up ? "ok" : "err"}
          c={c}
          beziD={beziD}
          accent={INT_COLOR}
          flowing={m.wan.link_up}
        />

        {/* Live throughput badge — single, placed in clear space below the
            GCP node so it doesn't overlap with the merge connectors. */}
        {wanMbps != null && m.wan.link_up && (
          <RateBadge
            x={COL_WAN.x + COL_WAN.w / 2}
            y={ROW_CENTER + WAN_H / 2 + 18}
            mbps={wanMbps}
            pps={wanPps}
            accent={c.ok}
          />
        )}

        {/* ─── Manifold rack (background + group bands) ─── */}
        <rect
          x={COL_MANIFOLD.x}
          y={MAN_TOP}
          width={COL_MANIFOLD.w}
          height={MAN_H}
          rx={14}
          fill="rgba(255,255,255,0.02)"
          stroke="rgba(255,255,255,0.10)"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
        {/* Fiber band header */}
        <rect
          x={COL_MANIFOLD.x + 10}
          y={FIBER_BAND_Y - 14}
          width={50}
          height={20}
          rx={5}
          fill={FIBER_COLOR}
          opacity={0.18}
        />
        <text
          x={COL_MANIFOLD.x + 18}
          y={FIBER_BAND_Y - 1}
          fontSize={13}
          fontWeight={800}
          fill={FIBER_COLOR}
          letterSpacing="0.06em"
        >
          FIBER
        </text>
        <text
          x={COL_MANIFOLD.x + 70}
          y={FIBER_BAND_Y - 1}
          fontSize={12}
          fill={c.textDim}
        >
          {fiberTunnels.filter((t) => t.reachable).length}/{fiberTunnels.length}{" "}
          reachable
        </text>
        {/* 5G band header */}
        <rect
          x={COL_MANIFOLD.x + 10}
          y={CELL_BAND_Y - 14}
          width={50}
          height={20}
          rx={5}
          fill={CELL_COLOR}
          opacity={0.18}
        />
        <text
          x={COL_MANIFOLD.x + 18}
          y={CELL_BAND_Y - 1}
          fontSize={13}
          fontWeight={800}
          fill={CELL_COLOR}
          letterSpacing="0.06em"
        >
          5G
        </text>
        <text
          x={COL_MANIFOLD.x + 70}
          y={CELL_BAND_Y - 1}
          fontSize={12}
          fill={c.textDim}
        >
          {cellTunnels.filter((t) => t.reachable).length}/{cellTunnels.length}{" "}
          reachable
        </text>

        {/* Tunnel pills — generic "Tunnel 1 / Tunnel 2" within each underlay,
            with the actual ifname as a small mono sub-label. */}
        {[
          ...fiberTunnels.map((t, i) => ({
            t,
            py: fiberPillY(i),
            underlay: FIBER_COLOR,
            label: `Tunnel ${i + 1}`,
            uk: "fiber" as Underlay,
            ui: i,
          })),
          ...cellTunnels.map((t, i) => ({
            t,
            py: cellPillY(i),
            underlay: CELL_COLOR,
            // 5G tunnels continue the numbering after Fiber's two: Tunnel 3 / 4.
            label: `Tunnel ${i + 3}`,
            uk: "5g" as Underlay,
            ui: i,
          })),
        ].map(({ t, py, underlay, label, uk, ui }, idx) => {
          const col = tunnelColor(t);
          const reachable = t.reachable;
          // What this tunnel carries in the current view (class / both / none).
          const cls = tunnelCarry(uk, ui, t.ifname);
          const isCarrier = cls != null;
          const carrying = isCarrier && reachable;
          const preferredButDown = isCarrier && !reachable;
          const classLabel =
            cls === "it" ? "IT" : cls === "ot" ? "OT" : "IT+OT";
          const classColor = cls ? carryColorOf(cls) : col;
          // Dim non-carrying tunnels so the eye lands on the active one.
          const dim = !carrying;
          const pillOpacity = carrying ? 1 : reachable ? 0.55 : 0.38;
          // MOS quality grade — derived from latency + loss using the same
          // G.107 approximation we use on the SLA chart. Letter grade so the
          // diagram stays scannable: A toll-quality → E many-dissatisfied.
          const mos =
            reachable && t.latency_ms > 0
              ? approxMos(t.latency_ms, t.loss_percent)
              : 0;
          const mosGrade =
            mos === 0
              ? "—"
              : mos >= 4.3
                ? "A"
                : mos >= 4.0
                  ? "B"
                  : mos >= 3.6
                    ? "C"
                    : mos >= 3.1
                      ? "D"
                      : "E";
          const mosColor =
            mos === 0
              ? c.textMuted
              : mos >= 4.0
                ? c.ok
                : mos >= 3.6
                  ? c.warn
                  : c.err;
          const spark = tunnelHist[t.ifname] ?? [];
          return (
            <g
              key={`pill-${idx}-${t.ifname}`}
              opacity={pillOpacity}
              style={{ cursor: "pointer" }}
              onMouseMove={onTunnelHover(t)}
              onMouseLeave={() => setHover(null)}
            >
              {carrying && (
                <rect
                  x={PILL_X - 4}
                  y={py - 4}
                  width={PILL_W + 8}
                  height={PILL_H + 8}
                  rx={12}
                  fill="none"
                  stroke={classColor}
                  strokeWidth={2.2}
                  strokeDasharray="6 5"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    values="0;-22"
                    dur="1.0s"
                    repeatCount="indefinite"
                  />
                </rect>
              )}
              <rect
                x={PILL_X}
                y={py}
                width={PILL_W}
                height={PILL_H}
                rx={9}
                fill={carrying ? `${col}26` : `${col}10`}
                stroke={col}
                strokeWidth={carrying ? 2 : dim ? 0.9 : 1.3}
                strokeDasharray={t.present ? "0" : "4 4"}
              />
              {/* Faint latency-trend sparkline behind the pill text. */}
              {spark.length > 1 && (
                <path
                  d={sparkPath(spark, PILL_X + 60, py + 8, PILL_W - 120, PILL_H - 16)}
                  fill="none"
                  stroke={col}
                  strokeWidth={1.4}
                  opacity={0.3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {/* Underlay-color left rail */}
              <rect
                x={PILL_X}
                y={py + 5}
                width={4}
                height={PILL_H - 10}
                rx={2}
                fill={underlay}
                opacity={carrying ? 0.95 : 0.5}
              />
              {/* State dot */}
              <circle
                cx={PILL_X + 22}
                cy={py + PILL_H / 2}
                r={4}
                fill={col}
                opacity={reachable ? 1 : 0.65}
              >
                {carrying && (
                  <animate
                    attributeName="opacity"
                    values="0.45;1;0.45"
                    dur="1.0s"
                    repeatCount="indefinite"
                  />
                )}
              </circle>
              {/* Main label "Tunnel N" */}
              <text
                x={PILL_X + 36}
                y={py + PILL_H / 2 - 3}
                fontSize={15}
                fontWeight={carrying ? 800 : 700}
                fill={c.text}
                letterSpacing="0.02em"
              >
                {label}
              </text>
              {/* Sub label: actual ifname */}
              <text
                x={PILL_X + 36}
                y={py + PILL_H / 2 + 12}
                fontSize={11.5}
                fill={c.textDim}
                fontFamily="JetBrains Mono, ui-monospace, monospace"
                letterSpacing="0.04em"
              >
                {t.ifname || "—"}
                {reachable && rateOf(t.ifname) > 0
                  ? ` · ${fmtRate(rateOf(t.ifname))}`
                  : ""}
              </text>
              {/* Top-right: state metric (latency · loss) */}
              <text
                x={PILL_X + PILL_W - 14}
                y={py + PILL_H / 2 - 3}
                fontSize={13}
                fontWeight={700}
                fill={col}
                textAnchor="end"
                letterSpacing="0.04em"
              >
                {tunnelLabel(t).toUpperCase()}
              </text>
              {/* Bottom-right: MOS grade combined with carrying indicator when
                  applicable. Keeps the right column to one element per row so
                  the metric pills stay scannable. */}
              {carrying ? (
                <text
                  x={PILL_X + PILL_W - 14}
                  y={py + PILL_H / 2 + 12}
                  fontSize={11}
                  fontWeight={800}
                  fill={classColor}
                  textAnchor="end"
                  letterSpacing="0.10em"
                >
                  {mos > 0
                    ? `● ${classLabel} · MOS ${mosGrade}`
                    : `● ${classLabel} TRAFFIC`}
                </text>
              ) : preferredButDown ? (
                <text
                  x={PILL_X + PILL_W - 14}
                  y={py + PILL_H / 2 + 12}
                  fontSize={11}
                  fontWeight={800}
                  fill={c.warn}
                  textAnchor="end"
                  letterSpacing="0.10em"
                >
                  ◌ {classLabel} CARRIER · DOWN
                </text>
              ) : mos > 0 ? (
                <g>
                  <rect
                    x={PILL_X + PILL_W - 64}
                    y={py + PILL_H / 2 + 3}
                    width={50}
                    height={14}
                    rx={4}
                    fill={`${mosColor}1f`}
                    stroke={`${mosColor}66`}
                    strokeWidth={0.9}
                  />
                  <text
                    x={PILL_X + PILL_W - 39}
                    y={py + PILL_H / 2 + 13}
                    fontSize={11}
                    fontWeight={800}
                    fill={mosColor}
                    textAnchor="middle"
                    letterSpacing="0.10em"
                  >
                    MOS {mosGrade} · {mos.toFixed(1)}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}

        {/* ─── Node: Edge gateway (origin) ─── */}
        <SysNodeBox
          x={COL_GW.x}
          y={ROW_CENTER - GW_H / 2}
          w={COL_GW.w}
          h={GW_H}
          tint={accentPurple}
          status={anyReachable ? "ok" : "warn"}
          c={c}
          label={displayGatewayName(m.gateway.name) || "gateway"}
          sub={`${m.gateway.mac || "—"} · ${m.gateway.prim_wan_ip || "—"}`}
          illustration={
            <GatewayIllustration
              tint={accentPurple}
              okColor={c.ok}
              warnColor={c.warn}
            />
          }
          haloPulse={anyReachable}
        />
        {/* Carrier badges below the gateway — target view: one per device class
            (IT / OT). Live view: the single active tunnel. */}
        {(itCarrierTunnel || otCarrierTunnel || liveActiveTunnel) && (
          <g
            transform={`translate(${COL_GW.x + COL_GW.w / 2} ${ROW_CENTER + GW_H / 2 + 16})`}
          >
            {(
              (isTarget
                ? [
                    { cls: "IT", t: itCarrierTunnel, color: IT_COLOR },
                    { cls: "OT", t: otCarrierTunnel, color: OT_COLOR },
                  ]
                : [{ cls: "ACTIVE", t: liveActiveTunnel, color: c.ok }]
              ).filter((x) => x.t) as {
                cls: string;
                t: IpsecTunnelMetric;
                color: string;
              }[]
            ).map((x, i) => (
              <g key={x.cls} transform={`translate(0 ${i * 26})`}>
                <rect
                  x={-82}
                  y={-10}
                  width={164}
                  height={20}
                  rx={10}
                  fill={x.t.reachable ? `${x.color}1f` : `${c.warn}1f`}
                  stroke={x.t.reachable ? `${x.color}66` : `${c.warn}66`}
                  strokeWidth={1}
                />
                <text
                  x={-72}
                  y={4}
                  fontSize={10.5}
                  fontWeight={800}
                  fill={x.t.reachable ? x.color : c.warn}
                  letterSpacing="0.08em"
                >
                  {x.cls} →
                </text>
                <text
                  x={72}
                  y={4}
                  fontSize={11}
                  fontWeight={700}
                  textAnchor="end"
                  fill={x.t.reachable ? x.color : c.warn}
                  fontFamily="JetBrains Mono, ui-monospace, monospace"
                >
                  {x.t.ifname.toUpperCase()}
                </text>
              </g>
            ))}
          </g>
        )}

        {/* ─── Node: Fiber underlay ─── */}
        <SysNodeBox
          x={COL_UNDERLAY.x}
          y={FIBER_Y}
          w={COL_UNDERLAY.w}
          h={UNDERLAY_H}
          tint={FIBER_COLOR}
          status={fiberReachable ? "ok" : "warn"}
          c={c}
          label="Fiber"
          sub={`${fiberTunnels.length} tunnels${fiberActive ? " · active" : ""}`}
          illustration={<FiberIllustration tint={FIBER_COLOR} />}
        />

        {/* ─── Node: 5G underlay ─── */}
        <SysNodeBox
          x={COL_UNDERLAY.x}
          y={CELL_Y}
          w={COL_UNDERLAY.w}
          h={UNDERLAY_H}
          tint={CELL_COLOR}
          status={cellReachable ? "ok" : "warn"}
          c={c}
          label="5G / Cellular"
          sub={`${cellTunnels.length} tunnels${cellActive ? " · active" : ""}`}
          illustration={<CellularIllustration tint={CELL_COLOR} />}
        />

        {/* ─── Node: GCP transit (was WAN egress · erouter0).
             This is where the IPsec tunnels actually terminate. From here,
             traffic is routed onward by NCC / Cloud Router. */}
        <SysNodeBox
          x={COL_WAN.x}
          y={ROW_CENTER - WAN_H / 2}
          w={COL_WAN.w}
          h={WAN_H}
          tint={m.wan.link_up ? GCP_COLOR : c.err}
          status={m.wan.link_up ? "ok" : "err"}
          c={c}
          label="GCP"
          sub={
            m.wan.link_up
              ? `NCC transit · ↓${fmtBytes(m.wan.rx_bytes)} ↑${fmtBytes(m.wan.tx_bytes)}`
              : "transit unreachable"
          }
          illustration={
            <GcpIllustration tint={m.wan.link_up ? GCP_COLOR : c.err} />
          }
        />

        {/* ─── Destination: Internet (public egress) ─── */}
        <SysNodeBox
          x={COL_DEST.x}
          y={INT_Y}
          w={COL_DEST.w}
          h={DEST_H}
          tint={INT_COLOR}
          status={m.wan.link_up ? "ok" : "warn"}
          c={c}
          label="Internet"
          sub="public egress · SaaS"
          illustration={<InternetIllustration tint={INT_COLOR} />}
        />
      </svg>

      {/* Hover tooltip — rich per-tunnel metric card following the pointer. */}
      {hover &&
        (() => {
          const ht = hover.t;
          const u = inferUnderlay(ht.ifname);
          const mos =
            ht.reachable && ht.latency_ms > 0
              ? approxMos(ht.latency_ms, ht.loss_percent)
              : 0;
          const jit = stddev(tunnelHist[ht.ifname] ?? []);
          const rate = rateOf(ht.ifname);
          const rows: [string, string][] = [
            ["Underlay", u === "fiber" ? "Fiber" : "5G"],
            ["State", ht.reachable ? "reachable" : ht.present ? "unreachable" : "absent"],
            ["Latency", ht.reachable ? `${ht.latency_ms.toFixed(1)} ms` : "—"],
            ["Jitter", ht.reachable ? `${jit.toFixed(1)} ms` : "—"],
            ["Loss", ht.reachable ? `${ht.loss_percent.toFixed(2)} %` : "—"],
            ["MOS", mos > 0 ? mos.toFixed(2) : "—"],
            ["Throughput", rate > 0 ? fmtRate(rate) : "idle"],
            ["RX / TX", `${fmtBytes(ht.rx_bytes)} / ${fmtBytes(ht.tx_bytes)}`],
          ];
          // Keep the card on-screen: flip left of the cursor past the midline.
          const W = wrapRef.current?.clientWidth ?? 1200;
          const left = hover.x > W - 230 ? hover.x - 226 : hover.x + 16;
          return (
            <div
              style={{
                position: "absolute",
                left,
                top: Math.max(8, hover.y - 40),
                width: 210,
                pointerEvents: "none",
                zIndex: 20,
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
                padding: "10px 12px",
                backdropFilter: "blur(8px)",
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "var(--text)",
                  marginBottom: 6,
                }}
              >
                {ht.ifname}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {rows.map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 11.5,
                    }}
                  >
                    <span style={{ color: "var(--text-muted)" }}>{k}</span>
                    <span
                      className="mono"
                      style={{ color: "var(--text-dim)", fontWeight: 600 }}
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
    </div>
  );
}

/* ─── IT/OT device column — on-prem endpoints feeding the gateway ───
 * Renders two dashed group boxes (IT on top, OT below), each listing up to 3
 * live devices from the same feed as the Devices page, with a Bézier connector
 * from every device into the gateway's left edge. Connector colour follows the
 * device's health (green/amber/red), matching the rest of the flow. */
const DEVICE_KIND_ICON: Record<DeviceView["kind"], typeof Laptop> = {
  laptop: Laptop,
  desktop: Monitor,
  printer: Printer,
  payment: CreditCard,
  server: Server,
  confphone: PhoneCall,
  fire_sensor: Flame,
  smoke_sensor: AlertTriangle,
  door_lock: DoorClosed,
  phone: Smartphone,
  tablet: Tablet,
  matter: Cpu,
  shelly: Plug,
  generic: HelpCircle,
};

function DeviceColumn({
  x,
  w,
  canvasH,
  it,
  ot,
  gwLeft,
  c,
  beziD,
  itColor,
  otColor,
}: {
  x: number;
  w: number;
  canvasH: number;
  it: DeviceView[];
  ot: DeviceView[];
  gwLeft: { x: number; y: number };
  c: ThemeColors;
  beziD: (a: { x: number; y: number }, b: { x: number; y: number }) => string;
  itColor: string;
  otColor: string;
}) {
  const HEADER_H = 24;
  const ROW_H = 26;
  const ROW_GAP = 7;
  const PAD = 9;
  const GROUP_GAP = 24;
  const groupH = (n: number) =>
    HEADER_H + PAD + Math.max(n, 1) * ROW_H + (Math.max(n, 1) - 1) * ROW_GAP + PAD;

  const itH = groupH(it.length);
  const otH = groupH(ot.length);
  // Centre the IT+OT stack on the canvas midline so the column lines up with
  // the gateway row instead of hugging the top of the diagram.
  const itY = Math.max(40, (canvasH - (itH + GROUP_GAP + otH)) / 2);
  const otY = itY + itH + GROUP_GAP;

  const rowTop = (groupY: number, idx: number) =>
    groupY + HEADER_H + PAD + idx * (ROW_H + ROW_GAP);

  const stateOf = (s: DeviceView["status"]): "ok" | "warn" | "err" =>
    s === "ok" ? "ok" : s === "warn" ? "warn" : "err";
  const dotColor = (s: DeviceView["status"]) =>
    s === "ok" ? c.ok : s === "warn" ? c.warn : s === "err" ? c.err : c.textMuted;

  const renderGroup = (
    devices: DeviceView[],
    groupY: number,
    groupH2: number,
    title: string,
    subtitle: string,
    accent: string,
  ) => (
    <g>
      {/* group box */}
      <rect
        x={x}
        y={groupY}
        width={w}
        height={groupH2}
        rx={14}
        fill="rgba(255,255,255,0.02)"
        stroke={`${accent}44`}
        strokeDasharray="6 6"
        strokeWidth={1.2}
      />
      {/* header: domain chip + count */}
      <rect x={x + PAD} y={groupY + 6} width={26} height={16} rx={4} fill={accent} opacity={0.9} />
      <text
        x={x + PAD + 13}
        y={groupY + 18}
        textAnchor="middle"
        fontSize={12}
        fontWeight={800}
        fill="#0b1020"
        letterSpacing="0.04em"
      >
        {title}
      </text>
      <text x={x + PAD + 34} y={groupY + 18} fontSize={12} fill={c.textDim}>
        {subtitle}
      </text>
      {/* device rows */}
      {devices.length === 0 ? (
        <text
          x={x + w / 2}
          y={groupY + HEADER_H + PAD + ROW_H / 2 + 4}
          textAnchor="middle"
          fontSize={12}
          fill={c.textDim}
        >
          no devices
        </text>
      ) : (
        devices.map((d, i) => {
          const top = rowTop(groupY, i);
          const Icon = DEVICE_KIND_ICON[d.kind] ?? HelpCircle;
          const highlight = d.status !== "ok";
          const border = highlight ? dotColor(d.status) : "rgba(255,255,255,0.10)";
          const name = d.name.length > 16 ? `${d.name.slice(0, 15)}…` : d.name;
          return (
            <g key={d.id}>
              <rect
                x={x + PAD}
                y={top}
                width={w - PAD * 2}
                height={ROW_H}
                rx={7}
                fill="rgba(255,255,255,0.03)"
                stroke={border}
                strokeWidth={highlight ? 1.5 : 1}
              />
              <Icon
                x={x + PAD + 8}
                y={top + (ROW_H - 13) / 2}
                width={13}
                height={13}
                color={c.textDim}
              />
              <text
                x={x + PAD + 28}
                y={top + ROW_H / 2 + 3.5}
                fontSize={13}
                fontWeight={600}
                fill={c.text}
              >
                {name}
              </text>
              <circle cx={x + w - PAD - 10} cy={top + ROW_H / 2} r={3.5} fill={dotColor(d.status)} />
            </g>
          );
        })
      )}
    </g>
  );

  return (
    <g>
      {/* connectors first so the group boxes paint over the tails */}
      {it.map((d, i) => (
        <NodeConnector
          key={`itc-${d.id}`}
          a={{ x: x + w - PAD, y: rowTop(itY, i) + ROW_H / 2 }}
          b={gwLeft}
          state={stateOf(d.status)}
          c={c}
          beziD={beziD}
          accent={itColor}
          flowing={d.status === "ok"}
        />
      ))}
      {ot.map((d, i) =>
        // Thread devices (e.g. Onvis sensors) talk to the gateway's Matter hub
        // over the Thread mesh — their traffic terminates locally and never
        // rides the WAN/IPsec tunnel path, so don't draw a flow into it.
        d.conn === "thread" ? null : (
          <NodeConnector
            key={`otc-${d.id}`}
            a={{ x: x + w - PAD, y: rowTop(otY, i) + ROW_H / 2 }}
            b={gwLeft}
            state={stateOf(d.status)}
            c={c}
            beziD={beziD}
            accent={otColor}
            flowing={d.status === "ok"}
          />
        ),
      )}
      {renderGroup(it, itY, itH, "IT", `${it.length} endpoint${it.length === 1 ? "" : "s"}`, itColor)}
      {renderGroup(ot, otY, otH, "OT", `${ot.length} sensor${ot.length === 1 ? "" : "s"} / locks`, otColor)}
    </g>
  );
}

/* ─── Helper: Overview-style node box with halo, tint stripe, illustration ─── */
function SysNodeBox({
  x,
  y,
  w,
  h,
  tint,
  status,
  c,
  label,
  sub,
  illustration,
  haloPulse,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  tint: string;
  status: "ok" | "warn" | "err";
  c: ThemeColors;
  label: string;
  sub: string;
  illustration: React.ReactNode;
  haloPulse?: boolean;
}) {
  const statusColor =
    status === "ok" ? c.ok : status === "warn" ? c.warn : c.err;
  const cx = x + w / 2;
  // Three horizontal bands inside the node: title (top), illustration (mid),
  // sub (bottom). The illustration is centred in the middle band — keep
  // illustrations bounded to y ∈ [-32, +8] in local coords so they fit.
  const titleY = y + 22;
  const illY = y + h / 2 + 6; // illustration centre
  const subY = y + h - 12;
  return (
    <g>
      {/* Outer soft halo */}
      <rect
        x={x - 6}
        y={y - 6}
        width={w + 12}
        height={h + 12}
        rx={16}
        fill={statusColor}
        opacity={0.1}
        filter="url(#ipsec-flow-glow)"
      >
        {haloPulse && (
          <animate
            attributeName="opacity"
            values="0.08;0.18;0.08"
            dur="3s"
            repeatCount="indefinite"
          />
        )}
      </rect>
      {/* Main body */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={12}
        fill="rgba(14,12,32,0.95)"
        stroke={statusColor}
        strokeWidth={status === "ok" ? 1.4 : 2}
      />
      {/* Tint stripe along top edge */}
      <rect
        x={x + 1}
        y={y + 1}
        width={w - 2}
        height={3}
        rx={2}
        fill={tint}
        opacity={0.75}
      />

      {/* Title */}
      <text
        x={cx}
        y={titleY}
        textAnchor="middle"
        fontSize={14}
        fontWeight={700}
        fill={c.text}
      >
        {label}
      </text>
      {/* Illustration slot — centred between title and sub */}
      <g transform={`translate(${cx} ${illY})`}>{illustration}</g>
      {/* Sub-label */}
      <text
        x={cx}
        y={subY}
        textAnchor="middle"
        fontSize={12}
        fill={c.textDim}
      >
        {sub}
      </text>
      {/* Status pulse dot top-right when not ok */}
      {status !== "ok" && (
        <g transform={`translate(${x + w - 10} ${y + 10})`}>
          <circle r={5} fill={statusColor}>
            <animate
              attributeName="opacity"
              values="1;0.4;1"
              dur="1.4s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
      )}
    </g>
  );
}

/** Live-rate badge sitting in a small dark pill — drawn along the active path. */
function RateBadge({
  x,
  y,
  mbps,
  pps,
  accent,
}: {
  x: number;
  y: number;
  mbps: number;
  pps?: number | null;
  accent: string;
}) {
  const rateText =
    mbps < 0.001
      ? "— idle"
      : mbps < 1
        ? `↕ ${(mbps * 1000).toFixed(0)} Kbps`
        : mbps < 10
          ? `↕ ${mbps.toFixed(2)} Mbps`
          : `↕ ${Math.round(mbps)} Mbps`;
  const ppsText = pps != null && pps > 0 ? ` · ${pps.toFixed(0)} pps` : "";
  const text = rateText + ppsText;
  const width = Math.max(96, text.length * 6 + 16);
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x={-width / 2}
        y={-11}
        width={width}
        height={22}
        rx={11}
        fill="rgba(2,4,16,0.75)"
        stroke={accent}
        strokeWidth={1}
      />
      <text
        x={0}
        y={4}
        textAnchor="middle"
        fontSize={12.5}
        fontWeight={700}
        fill={accent}
        fontFamily="JetBrains Mono, ui-monospace, monospace"
      >
        {text}
      </text>
    </g>
  );
}

/* ─── Helper: bezier connector between two system nodes ─── */
function NodeConnector({
  a,
  b,
  state,
  c,
  beziD,
  accent,
  flowing = false,
}: {
  a: { x: number; y: number };
  b: { x: number; y: number };
  state: "ok" | "warn" | "err";
  c: ThemeColors;
  beziD: (a: { x: number; y: number }, b: { x: number; y: number }) => string;
  /** Optional per-segment colour (overrides the state-based green/amber/red). */
  accent?: string;
  /** If true, animate a marching-ants ghost stroke and a flying particle.
   *  Disabled by default so quiet/idle segments stay static and the eye
   *  follows traffic on the genuinely-active path. */
  flowing?: boolean;
}) {
  const col =
    accent && state === "ok"
      ? accent
      : state === "ok"
        ? c.ok
        : state === "warn"
          ? c.warn
          : c.err;
  const d = beziD(a, b);
  return (
    <g>
      <path
        d={d}
        stroke={col}
        strokeWidth={2}
        fill="none"
        opacity={state === "err" ? 0.4 : flowing ? 0.95 : 0.55}
        strokeDasharray={state === "err" ? "4 6" : flowing ? undefined : "5 7"}
      />
      {flowing && (
        <>
          <path
            d={d}
            stroke={col}
            strokeWidth={1.4}
            fill="none"
            strokeDasharray="4 8"
            opacity={0.75}
          >
            <animate
              attributeName="stroke-dashoffset"
              values="0;-24"
              dur="1.4s"
              repeatCount="indefinite"
            />
          </path>
          <circle r={3.5} fill={col} filter="url(#ipsec-flow-glow)">
            <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
          </circle>
        </>
      )}
    </g>
  );
}

/* ─── Inline illustrations (Overview-style, centered around 0,0) ─── */
function GatewayIllustration({
  tint,
  okColor,
  warnColor,
}: {
  tint: string;
  okColor: string;
  warnColor: string;
}) {
  // Generic edge-router silhouette — 3 antennas + chassis with LEDs + RJ45 ports.
  // Content vertically centred around y=0 (range y ∈ [-18, +18]).
  return (
    <g>
      {/* Subtle signal arc above the centre antenna */}
      <path
        d="M -10 -16 A 10 10 0 0 1 10 -16"
        fill="none"
        stroke={tint}
        strokeWidth={1}
        opacity={0.45}
      />
      <path
        d="M -16 -16 A 16 16 0 0 1 16 -16"
        fill="none"
        stroke={tint}
        strokeWidth={0.8}
        opacity={0.22}
      />
      {/* Antennas */}
      <line
        x1={-18}
        y1={-2}
        x2={-21}
        y2={-12}
        stroke={tint}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <line
        x1={0}
        y1={-2}
        x2={0}
        y2={-14}
        stroke={tint}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <line
        x1={18}
        y1={-2}
        x2={21}
        y2={-12}
        stroke={tint}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <circle cx={-21} cy={-12} r={1.6} fill={tint} />
      <circle cx={0} cy={-14} r={1.6} fill={tint} />
      <circle cx={21} cy={-12} r={1.6} fill={tint} />
      {/* Chassis body */}
      <rect
        x={-30}
        y={-2}
        width={60}
        height={22}
        rx={5}
        fill={tint}
        fillOpacity={0.18}
        stroke={tint}
        strokeWidth={1.3}
      />
      {/* LED strip */}
      <circle cx={-20} cy={4} r={1.5} fill={okColor}>
        <animate
          attributeName="opacity"
          values="1;0.35;1"
          dur="1.4s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx={-12} cy={4} r={1.5} fill={okColor}>
        <animate
          attributeName="opacity"
          values="0.35;1;0.35"
          dur="1.6s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx={-4} cy={4} r={1.5} fill={warnColor} />
      <circle cx={4} cy={4} r={1.5} fill={okColor} />
      <circle cx={12} cy={4} r={1.5} fill={okColor} />
      <circle cx={20} cy={4} r={1.5} fill={okColor} />
      {/* Thin divider rail */}
      <line
        x1={-26}
        y1={10}
        x2={26}
        y2={10}
        stroke={tint}
        strokeWidth={0.6}
        opacity={0.35}
      />
      {/* RJ45 port slots */}
      <rect
        x={-23}
        y={14}
        width={10}
        height={4.5}
        rx={0.8}
        fill={tint}
        fillOpacity={0.5}
        stroke={tint}
        strokeWidth={0.5}
      />
      <rect
        x={-11}
        y={14}
        width={10}
        height={4.5}
        rx={0.8}
        fill={tint}
        fillOpacity={0.5}
        stroke={tint}
        strokeWidth={0.5}
      />
      <rect
        x={1}
        y={14}
        width={10}
        height={4.5}
        rx={0.8}
        fill={tint}
        fillOpacity={0.5}
        stroke={tint}
        strokeWidth={0.5}
      />
      <rect
        x={13}
        y={14}
        width={10}
        height={4.5}
        rx={0.8}
        fill={tint}
        fillOpacity={0.5}
        stroke={tint}
        strokeWidth={0.5}
      />
    </g>
  );
}

function GcpIllustration({ tint: _tint }: { tint: string }) {
  // Official Google Cloud icon — verbatim paths from the supplied
  // google_cloud-icon.svg (viewBox 0 0 64 64). Centred around (0,0) so it
  // lines up with SysNodeBox's middle band.
  return (
    <g transform="translate(0 0) scale(0.55) translate(-32 -32)">
      <path
        d="M40.728 20.488l2.05.035 5.57-5.57.27-2.36C44.2 8.657 38.367 6.26 31.993 6.26c-11.54 0-21.28 7.852-24.163 18.488.608-.424 1.908-.106 1.908-.106l11.13-1.83s.572-.947.862-.9A13.88 13.88 0 0 1 32 17.375c3.3.007 6.34 1.173 8.728 3.102z"
        fill="#ea4335"
      />
      <path
        d="M56.17 24.77c-1.293-4.77-3.958-8.982-7.555-12.177l-7.887 7.887c3.16 2.55 5.187 6.452 5.187 10.82v1.392c3.837 0 6.954 3.124 6.954 6.954 0 3.837-3.124 6.954-6.954 6.954H32.007L30.615 48v8.346l1.392 1.385h13.908A18.11 18.11 0 0 0 64 39.647c-.007-6.155-3.1-11.6-7.83-14.876z"
        fill="#4285f4"
      />
      <path
        d="M18.085 57.74h13.9V46.6h-13.9a6.89 6.89 0 0 1-2.862-.622l-2.007.615-5.57 5.57-.488 1.88a18 18 0 0 0 10.926 3.689z"
        fill="#34a853"
      />
      <path
        d="M18.085 21.57A18.11 18.11 0 0 0 0 39.654c0 5.873 2.813 11.095 7.166 14.403l8.064-8.064a6.96 6.96 0 0 1-4.099-6.339c0-3.837 3.124-6.954 6.954-6.954 2.82 0 5.244 1.7 6.34 4.1l8.064-8.064c-3.307-4.353-8.53-7.166-14.403-7.166z"
        fill="#fbbc05"
      />
    </g>
  );
}

function FiberIllustration({ tint }: { tint: string }) {
  // Content centred around y=0 (range y ∈ [-7, +7]).
  return (
    <g>
      {/* SC connector (left) */}
      <rect
        x={-26}
        y={-5}
        width={9}
        height={10}
        rx={1}
        fill={tint}
        fillOpacity={0.25}
        stroke={tint}
        strokeWidth={1.2}
      />
      <rect x={-23} y={-2} width={5} height={4} rx={0.5} fill={tint} />
      {/* fiber strand */}
      <path
        d="M -17 0 C -8 0, 0 0, 8 0 S 16 0, 20 0"
        stroke={tint}
        strokeWidth={2.4}
        fill="none"
        opacity={0.35}
      />
      <path
        d="M -17 0 C -8 0, 0 0, 8 0 S 16 0, 20 0"
        stroke={tint}
        strokeWidth={1.1}
        fill="none"
      />
      {/* glowing terminator */}
      <circle cx={20} cy={0} r={5} fill={tint} fillOpacity={0.2} />
      <circle cx={20} cy={0} r={3} fill={tint} />
      <circle cx={20} cy={0} r={1.2} fill="#ffffff" />
    </g>
  );
}

function CellularIllustration({ tint }: { tint: string }) {
  // Tower mast + arc + signal waves, centred around y=0 (range y ∈ [-15, +8]).
  return (
    <g>
      {/* mast */}
      <line x1={0} y1={-15} x2={0} y2={5} stroke={tint} strokeWidth={1.8} />
      {/* tower triangle */}
      <polygon
        points="-6,5 6,5 0,-15"
        fill={tint}
        fillOpacity={0.18}
        stroke={tint}
        strokeWidth={1.1}
      />
      <circle cx={0} cy={-15} r={2.2} fill={tint} />
      {/* signal waves emanating from the top */}
      <path
        d="M -10 -15 A 10 10 0 0 1 10 -15"
        stroke={tint}
        strokeWidth={1.4}
        fill="none"
        opacity={0.85}
      />
      <path
        d="M -16 -15 A 16 16 0 0 1 16 -15"
        stroke={tint}
        strokeWidth={1.2}
        fill="none"
        opacity={0.55}
      />
      <path
        d="M -22 -15 A 22 22 0 0 1 22 -15"
        stroke={tint}
        strokeWidth={1.0}
        fill="none"
        opacity={0.3}
      />
      {/* ground */}
      <line
        x1={-14}
        y1={7}
        x2={14}
        y2={7}
        stroke={tint}
        strokeWidth={1}
        opacity={0.5}
      />
    </g>
  );
}

function InternetIllustration({ tint }: { tint: string }) {
  // Globe with latitudes/longitudes, centred around y=0 (range y ∈ [-14, +14]).
  return (
    <g>
      <circle
        cx={0}
        cy={0}
        r={14}
        fill={tint}
        fillOpacity={0.12}
        stroke={tint}
        strokeWidth={1.3}
      />
      {/* latitudes */}
      <ellipse
        cx={0}
        cy={0}
        rx={14}
        ry={5}
        fill="none"
        stroke={tint}
        strokeWidth={0.9}
        opacity={0.6}
      />
      <ellipse
        cx={0}
        cy={0}
        rx={14}
        ry={9}
        fill="none"
        stroke={tint}
        strokeWidth={0.8}
        opacity={0.4}
      />
      {/* longitudes */}
      <line
        x1={0}
        y1={-14}
        x2={0}
        y2={14}
        stroke={tint}
        strokeWidth={0.9}
        opacity={0.55}
      />
      <path
        d="M -10 -11 Q -14 0 -10 11"
        stroke={tint}
        strokeWidth={0.8}
        fill="none"
        opacity={0.45}
      />
      <path
        d="M  10 -11 Q  14 0  10 11"
        stroke={tint}
        strokeWidth={0.8}
        fill="none"
        opacity={0.45}
      />
    </g>
  );
}

/** Thin timeline under the topology marking active-tunnel flips (path changes)
 *  and SLA breaches over the live session. Purely from data we already track. */
function FlowEventRibbon({
  events,
  c,
}: {
  events: { ts: number; kind: "flip" | "breach"; text: string }[];
  c: ThemeColors;
}) {
  const flips = events.filter((e) => e.kind === "flip").length;
  const breaches = events.filter((e) => e.kind === "breach").length;
  const now = Date.now();
  const start = events[0]?.ts ?? now;
  const span = Math.max(now - start, 60_000);
  return (
    <div
      style={{
        marginTop: 10,
        padding: "8px 12px",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: events.length ? 8 : 0,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          Path events
        </span>
        <span style={{ display: "inline-flex", gap: 14, fontSize: 11 }}>
          <span style={{ color: c.accent3 }}>{flips} failover{flips === 1 ? "" : "s"}</span>
          <span style={{ color: breaches ? c.warn : "var(--text-muted)" }}>
            {breaches} SLA breach{breaches === 1 ? "" : "es"}
          </span>
        </span>
      </div>
      {events.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
          No failover events this session · path stable
        </div>
      ) : (
        <div
          style={{
            position: "relative",
            height: 16,
            borderRadius: 8,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08))",
          }}
        >
          {events.map((e, i) => {
            const leftPct = ((e.ts - start) / span) * 100;
            const color = e.kind === "flip" ? c.accent3 : c.warn;
            return (
              <span
                key={i}
                title={`${e.kind === "flip" ? "Failover" : "SLA breach"} · ${e.text}`}
                style={{
                  position: "absolute",
                  left: `calc(${Math.max(0, Math.min(100, leftPct))}% - 4px)`,
                  top: 2,
                  width: 8,
                  height: 12,
                  borderRadius: 3,
                  background: color,
                  boxShadow: `0 0 8px ${color}`,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TunnelRow({
  t,
  active,
  carrierClass,
  jitter,
  score,
  c,
}: {
  t: IpsecTunnelMetric;
  active: boolean;
  /** Device class this tunnel carries under the current mode (app-aware demo
   *  policy), or null if it's an idle standby in this mode. */
  carrierClass: "it" | "ot" | null;
  /** Rolling jitter (ms) — stddev of recent latency samples. */
  jitter: number;
  /** Composite SLA score 0–100 (latency + loss + jitter). */
  score: number;
  c: ThemeColors;
}) {
  const stateColor = !t.present
    ? c.textMuted
    : !t.reachable
      ? c.err
      : t.loss_percent > 3 || t.latency_ms > 150
        ? c.warn
        : c.ok;
  const stateLabel = !t.present
    ? "absent"
    : !t.reachable
      ? "unreachable"
      : t.loss_percent > 3 || t.latency_ms > 150
        ? "degraded"
        : "healthy";

  // Distinguish "device-preferred" from "actively carrying traffic". If the
  // gateway names this tunnel as `active_tunnel` but it isn't reachable, it's
  // a preference, not a real active path — calling it ACTIVE alongside
  // UNREACHABLE was contradictory.
  const carrying = active && t.reachable;
  const preferredButDown = active && !t.reachable;
  // App-aware routing tag (IT / OT) — only meaningful while the tunnel is
  // reachable; colour-matched to the topology diagram above.
  const carries = carrierClass && t.reachable ? carrierClass : null;
  const carryColor = carries ? classColorOf(carries) : null;

  return (
    <div
      className={`ipsec-tunnel ${carrying ? "is-active" : ""}`}
      style={{ borderLeftColor: carryColor ?? (carrying ? c.ok : stateColor) }}
    >
      <div className="ipsec-tunnel-id">
        <CircleDot size={12} style={{ color: stateColor }} />
        <span
          className="mono"
          style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}
        >
          {t.ifname}
        </span>
        {carries && (
          <span
            className="badge"
            style={{
              fontSize: 9.5,
              padding: "1px 6px",
              color: carryColor!,
              borderColor: `${carryColor}66`,
              background: `${carryColor}1a`,
            }}
            title={`${carries === "it" ? "IT" : "OT"} devices route through this tunnel`}
          >
            {carries === "it" ? "IT" : "OT"}
          </span>
        )}
        {carrying && (
          <span
            className="badge ok"
            style={{ fontSize: 9.5, padding: "1px 6px" }}
          >
            ACTIVE
          </span>
        )}
        {preferredButDown && (
          <span
            className="badge warn"
            style={{ fontSize: 9.5, padding: "1px 6px" }}
          >
            PREFERRED
          </span>
        )}
        <span className="ipsec-tunnel-state" style={{ color: stateColor }}>
          {stateLabel}
        </span>
      </div>
      <div className="ipsec-tunnel-metrics">
        <Metric
          label="Latency"
          value={t.reachable ? `${t.latency_ms.toFixed(1)} ms` : "—"}
          accent={stateColor}
        />
        <Metric
          label="Jitter"
          value={t.reachable ? `${jitter.toFixed(1)} ms` : "—"}
          accent={t.reachable && jitter > 30 ? c.warn : c.textDim}
        />
        <Metric
          label="Loss"
          value={t.reachable ? `${t.loss_percent.toFixed(2)} %` : "—"}
          accent={stateColor}
        />
        {/* Composite SLA score with a mini progress bar. */}
        <div className="ipsec-metric" style={{ minWidth: 64 }}>
          <span className="ipsec-metric-label">SLA score</span>
          {t.reachable ? (
            (() => {
              const sc = score >= 80 ? c.ok : score >= 60 ? c.warn : c.err;
              return (
                <span
                  style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 13, fontWeight: 700, color: sc, lineHeight: 1 }}
                  >
                    {score}
                  </span>
                  <span
                    style={{
                      width: 52,
                      height: 3,
                      borderRadius: 2,
                      background: "rgba(255,255,255,0.10)",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: `${score}%`,
                        height: "100%",
                        background: sc,
                      }}
                    />
                  </span>
                </span>
              );
            })()
          ) : (
            <span className="ipsec-metric-value mono" style={{ color: c.textMuted }}>
              —
            </span>
          )}
        </div>
        <Metric label="RX" value={fmtBytes(t.rx_bytes)} accent={c.textDim} />
        <Metric label="TX" value={fmtBytes(t.tx_bytes)} accent={c.textDim} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="ipsec-metric">
      <span className="ipsec-metric-label">{label}</span>
      <span className="ipsec-metric-value mono" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}
