/*
 * THESIS: Make the learned threshold legible as an operating boundary, not a decorative chart line.
 * OWN-WORLD: CE's quiet panels and mint/pink status palette frame an oscilloscope-like diagnostic trace.
 * STORY: Read current state, compare error with threshold, then inspect the windows that crossed it.
 * FIRST VIEWPORT: Compact controls and summary lead directly into the wide threshold-corridor trace.
 * FORM: Operator diagnostic surface, fixed by the supplied brief and incumbent CE dashboard system.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Gauge,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { useTheme, useThemeColors } from '../ui/Theme';
import { ANOMALY_REASON_LABELS, CONNTRACK_MEASUREMENTS, type ConntrackSeries } from '../../shared/eagleTelemetry';
import {
  useHardwareAnomalies,
  type HardwareAnomalyPoint,
  type HardwareAnomalySource,
} from '../ui/useHardwareAnomalies';
import './HardwareAnomalies.css';

const RANGE_OPTIONS = [
  { key: '1h', label: '1 hour', shortLabel: '1h', start: '-1h', window: '1m' },
  { key: '6h', label: '6 hours', shortLabel: '6h', start: '-6h', window: '5m' },
  { key: '12h', label: '12 hours', shortLabel: '12h', start: '-12h', window: '5m' },
  { key: '24h', label: '24 hours', shortLabel: '24h', start: '-24h', window: '5m' },
  { key: '7d', label: '7 days', shortLabel: '7d', start: '-7d', window: '30m' },
  { key: '30d', label: '30 days', shortLabel: '30d', start: '-30d', window: '2h' },
] as const;

type RangeKey = (typeof RANGE_OPTIONS)[number]['key'];
const EMPTY_ANOMALY_POINTS: HardwareAnomalyPoint[] = [];
type SummaryTone = 'ok' | 'warn' | 'err' | 'neutral';
type SummaryIcon = React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;

interface ChartPoint extends HardwareAnomalyPoint {
  timestamp: number;
  corridorCeiling: number | null;
  flaggedMse: number | null;
}

interface FlaggedWindow {
  start: number;
  end: number;
}

function formatMetric(value: number | null, compact = false): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  if ((absolute > 0 && absolute < 0.001) || absolute >= 10_000) {
    return value.toExponential(compact ? 1 : 3);
  }
  if (absolute >= 100) return value.toFixed(compact ? 0 : 2);
  if (absolute >= 1) return value.toFixed(compact ? 1 : 3);
  return value.toFixed(compact ? 3 : 5);
}

function formatFixedAxisMetric(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatRatio(point: HardwareAnomalyPoint | null): string {
  if (
    !point
    || point.anomalyMse === null
    || point.anomalyThreshold === null
    || point.anomalyThreshold === 0
  ) return '—';
  return `${(point.anomalyMse / point.anomalyThreshold).toFixed(2)}×`;
}

function crossedThreshold(point: HardwareAnomalyPoint): boolean {
  return point.anomalyMse !== null
    && point.anomalyThreshold !== null
    && point.anomalyMse > point.anomalyThreshold;
}

function currentAnomalyStatus(point: HardwareAnomalyPoint | null): {
  tone: SummaryTone;
  label: string;
  icon: SummaryIcon;
} {
  if (!point) return { tone: 'neutral', label: 'No sample available', icon: AlertTriangle };
  if (point.anomalyFlag === true) {
    return { tone: 'err', label: 'Anomaly flagged', icon: ShieldAlert };
  }
  if (crossedThreshold(point)) {
    return {
      tone: 'warn',
      label: point.anomalyFlag === false
        ? 'Threshold crossed · no flag'
        : 'Threshold crossed · flag unknown',
      icon: TriangleAlert,
    };
  }
  if (point.anomalyMse === null || point.anomalyThreshold === null) {
    return { tone: 'neutral', label: 'Metric incomplete', icon: AlertTriangle };
  }
  if (point.anomalyFlag === null) {
    return { tone: 'neutral', label: 'Flag unavailable', icon: AlertTriangle };
  }
  return { tone: 'ok', label: 'Within threshold', icon: CheckCircle2 };
}

function formatAxisTime(timestamp: number, range: RangeKey): string {
  const options: Intl.DateTimeFormatOptions = range === '30d'
    ? { month: 'short', day: 'numeric' }
    : range === '7d'
      ? { month: 'short', day: 'numeric', hour: 'numeric' }
      : { hour: 'numeric', minute: '2-digit' };
  return new Intl.DateTimeFormat(undefined, options).format(timestamp);
}

function formatTableTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

function median(values: number[]): number {
  if (values.length === 0) return 5 * 60_000;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

function flaggedWindows(points: ChartPoint[]): FlaggedWindow[] {
  const gaps = points
    .slice(1)
    .map((point, index) => point.timestamp - points[index].timestamp)
    .filter((gap) => gap > 0);
  const sampleWidth = median(gaps);
  const windows: FlaggedWindow[] = [];

  for (const point of points) {
    if (point.anomalyFlag !== true) continue;
    const start = point.timestamp - sampleWidth / 2;
    const end = point.timestamp + sampleWidth / 2;
    const previous = windows[windows.length - 1];
    if (previous && start <= previous.end + sampleWidth * 0.25) {
      previous.end = end;
    } else {
      windows.push({ start, end });
    }
  }
  return windows;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
}

export function HardwareAnomaliesPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('24h');
  const range = RANGE_OPTIONS.find((option) => option.key === rangeKey) ?? RANGE_OPTIONS[3];
  const query = useMemo(() => ({
    start: range.start,
    stop: 'now',
    window: range.window,
    flagAggregation: 'max' as const,
    valueAggregation: 'mean' as const,
  }), [range.start, range.window]);
  const { data, loading, error, fetchedAt, refresh } = useHardwareAnomalies(query);

  const points = data?.points ?? EMPTY_ANOMALY_POINTS;
  const latest = points.at(-1) ?? null;
  const crossings = useMemo(() => points.filter(crossedThreshold), [points]);
  const flagged = useMemo(() => points.filter((point) => point.anomalyFlag === true), [points]);
  const unflaggedCrossings = useMemo(
    () => crossings.filter((point) => point.anomalyFlag !== true),
    [crossings],
  );
  const breachRows = useMemo(
    () => points
      .filter((point) => point.anomalyFlag || crossedThreshold(point))
      .slice()
      .reverse()
      .slice(0, 20),
    [points],
  );

  const currentStatus = currentAnomalyStatus(latest);

  return (
    <div className="anomaly-page">
      <PageHeader
        title="EA:GLE"
        subtitle="Hardware anomaly detection and connection tracking"
        right={
          <div className="anomaly-header-tools">
            <SourceStatus
              source={data?.source}
              loading={loading}
              error={Boolean(error)}
              hasData={Boolean(data)}
            />
            <div className="anomaly-range-control" role="group" aria-label="Telemetry time range">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={rangeKey === option.key ? 'is-active' : undefined}
                  aria-pressed={rangeKey === option.key}
                  aria-label={`Show the last ${option.label}`}
                  onClick={() => setRangeKey(option.key)}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="anomaly-refresh"
              onClick={refresh}
              disabled={loading}
              aria-label={loading ? 'Refreshing anomaly telemetry' : 'Refresh anomaly telemetry'}
            >
              <RefreshCw size={14} className={loading ? 'is-spinning' : undefined} aria-hidden="true" />
              <span>{loading ? 'Refreshing' : 'Refresh'}</span>
            </button>
          </div>
        }
      />

      <p className="anomaly-live-region" aria-live="polite">
        {loading
          ? `Loading anomaly telemetry for the last ${range.label}.`
          : error
            ? `Anomaly telemetry unavailable. ${error}`
            : `${points.length} anomaly samples loaded for the last ${range.label}.`}
      </p>

      {error && data && (
        <div className="anomaly-stale-banner" role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            <strong>Refresh failed.</strong> Showing the last successful response
            {fetchedAt ? ` from ${new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.
            {' '}{error}
          </span>
          <button type="button" onClick={refresh} disabled={loading}>Retry</button>
        </div>
      )}

      {data && (
        <Card className="anomaly-reason-card" title="Anomaly reason code" sub="Latest reported value per series in the selected range">
          {data.reasonCodes.length === 0 ? (
            <p className="anomaly-panel-empty">No reason code reported in this range.</p>
          ) : (
            <dl className="anomaly-reason-list">
              {data.reasonCodes.map((reason, index) => (
                <div key={`${JSON.stringify(reason.tags)}-${index}`}>
                  <dt>{Object.values(reason.tags).join(' · ') || 'Series'}</dt>
                  <dd>
                    <strong className="anomaly-reason-value" data-tone={reason.code === 0 ? 'ok' : 'err'}>
                      {reason.code === 0
                        ? <CheckCircle2 size={20} aria-hidden="true" />
                        : <TriangleAlert size={20} aria-hidden="true" />}
                      <span>{ANOMALY_REASON_LABELS[reason.code] ?? 'Unknown Anomaly'}</span>
                    </strong>
                    <span className="anomaly-reason-code">Code {reason.code}</span>
                    <time dateTime={reason.time}>{formatTableTime(reason.time)}</time>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      )}

      {loading && !data ? (
        <AnomalyLoadingState />
      ) : error && !data ? (
        <AnomalyErrorState message={error} onRetry={refresh} />
      ) : points.length === 0 ? (
        <AnomalyEmptyState rangeLabel={range.label} loading={loading} onRefresh={refresh} />
      ) : (
        <>
          <section className="anomaly-summary" aria-label="Current anomaly summary">
            <SummaryMetric
              icon={currentStatus.icon}
              label="Latest sample"
              value={currentStatus.label}
              detail={latest ? formatTableTime(latest.time) : 'No sample timestamp'}
              tone={currentStatus.tone}
            />
            <SummaryMetric
              icon={Gauge}
              label="Error / threshold"
              value={formatRatio(latest)}
              detail={latest
                ? `${formatMetric(latest.anomalyMse)} / ${formatMetric(latest.anomalyThreshold)}`
                : 'No current values'}
              tone={latest && crossedThreshold(latest) ? 'warn' : 'neutral'}
            />
            <SummaryMetric
              icon={TriangleAlert}
              label="Threshold crossings"
              value={String(crossings.length)}
              detail={`${((crossings.length / points.length) * 100).toFixed(1)}% of sampled windows`}
              tone={crossings.length > 0 ? 'warn' : 'ok'}
            />
            <SummaryMetric
              icon={Activity}
              label="Flags raised"
              value={String(flagged.length)}
              detail={`${unflaggedCrossings.length} crossings without a confirmed flag`}
              tone={flagged.length > 0 ? 'err' : 'ok'}
            />
          </section>

          <div className="grid anomaly-content-grid">
            <div className="col-12">
              <Card
                className="anomaly-trace-card"
                title={
                  <span className="anomaly-card-title">
                    <Activity size={15} aria-hidden="true" />
                    Hardware Anomalies
                  </span>
                }
                sub={`R95VA4GP000041 · MSE and learned threshold · ${data?.window || range.window} aggregation window · fixed Y scale 0–2`}
                right={
                  <div className="anomaly-chart-legend" aria-label="Chart legend">
                    <span><i className="mse" />Reconstruction error</span>
                    <span><i className="threshold" />Learned threshold</span>
                    <span><i className="flag" />Flagged window</span>
                  </div>
                }
              >
                <AnomalyTrace points={points} range={rangeKey} />
                <div className="anomaly-trace-meta">
                  <span><strong>{points.length.toLocaleString()}</strong> samples</span>
                  <span><strong>{data?.window || range.window}</strong> returned window</span>
                  <span><strong>0–2</strong> fixed Y-axis scale</span>
                  <span><strong>{data?.aggregations.anomalyFlag ?? 'max'}</strong> flag aggregation</span>
                  <span><strong>{data?.aggregations.anomalyMse ?? 'mean'}</strong> MSE aggregation</span>
                  {fetchedAt && <span>Updated <strong>{new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
      {data && <ConntrackChart series={data.conntrack} range={rangeKey} window={data.window || range.window} />}
      {points.length > 0 && <BreachTable rows={breachRows} total={points.length} />}
    </div>
  );
}

const CONNTRACK_LABELS = { conntrack_total: 'Total', conntrack_tcp: 'TCP', conntrack_udp: 'UDP', conntrack_icmp: 'ICMP', conntrack_other: 'Other' };

function ConntrackChart({ series, range, window }: { series: ConntrackSeries[]; range: RangeKey; window: string }) {
  const colors = useThemeColors();
  const { theme } = useTheme();
  const palette = theme === 'light'
    ? ['#475569', '#047857', '#be185d', '#1d4ed8', '#92400e']
    : ['#cbd5e1', '#34d399', '#f472b6', '#60a5fa', '#fbbf24'];
  const orderedSeries = useMemo(() => [...series].sort((a, b) => (
    CONNTRACK_MEASUREMENTS.indexOf(a.measurement) - CONNTRACK_MEASUREMENTS.indexOf(b.measurement)
  )), [series]);
  const chartPoints = useMemo(() => {
    const byTime = new Map<number, Record<string, number>>();
    orderedSeries.forEach((item, index) => item.points.forEach((point) => {
      const timestamp = Date.parse(point.time);
      const row = byTime.get(timestamp) ?? { timestamp };
      row[`series${index}`] = point.value;
      byTime.set(timestamp, row);
    }));
    return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, [orderedSeries]);
  const label = (item: ConntrackSeries) => [CONNTRACK_LABELS[item.measurement], ...Object.values(item.tags)].join(' · ');
  const seriesColor = (item: ConntrackSeries) => palette[CONNTRACK_MEASUREMENTS.indexOf(item.measurement)];

  return (
    <Card className="anomaly-conntrack-card" title="Conntrack (Connection Tracking)" sub={`Mean connection counts · ${window} aggregation window`}>
      {chartPoints.length === 0 ? (
        <p className="anomaly-panel-empty">No connection-tracking samples in this range. Choose a longer range or refresh.</p>
      ) : (
        <>
          <div className="anomaly-chart-legend" aria-label="Connection tracking legend">
            {orderedSeries.map((item) => <span key={item.id}><i style={{ background: seriesColor(item) }} />{label(item)}</span>)}
          </div>
          <figure className="anomaly-trace" aria-label="Connection counts over the selected range">
            <div className="anomaly-chart">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 800, height: 360 }}>
                <ComposedChart data={chartPoints} margin={{ top: 12, right: 14, left: 2, bottom: 2 }} accessibilityLayer aria-label="Connection tracking chart">
                  <CartesianGrid stroke={colors.chartGrid} strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => formatAxisTime(value, range)} stroke={colors.textDim} tickLine={false} axisLine={false} minTickGap={52} fontSize={11} tickMargin={10} />
                  <YAxis domain={[0, 'auto']} stroke={colors.textDim} tickLine={false} axisLine={false} width={58} fontSize={11} />
                  <Tooltip
                    position={{ x: 8, y: 8 }}
                    wrapperStyle={{ maxWidth: 'calc(100% - 16px)' }}
                    itemStyle={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                    labelStyle={{ whiteSpace: 'normal' }}
                    labelFormatter={(value) => formatTableTime(new Date(Number(value)).toISOString())}
                    formatter={(value) => typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value)}
                    contentStyle={{ background: colors.panelSolid, borderColor: colors.chartGrid, color: colors.textDim, borderRadius: 12, fontSize: 12 }}
                  />
                  {orderedSeries.map((item, index) => (
                    <Line key={item.id} dataKey={`series${index}`} name={label(item)} type="linear" stroke={seriesColor(item)} strokeWidth={item.measurement === 'conntrack_total' ? 2.5 : 1.8} strokeDasharray={item.measurement === 'conntrack_total' ? '7 4' : undefined} dot={item.points.length === 1} isAnimationActive={false} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </figure>
          <div className="anomaly-trace-meta"><span><strong>{chartPoints.length.toLocaleString()}</strong> sampled windows</span><span><strong>mean</strong> aggregation</span></div>
        </>
      )}
    </Card>
  );
}

function SourceStatus({
  source,
  loading,
  error,
  hasData,
}: {
  source?: HardwareAnomalySource;
  loading: boolean;
  error: boolean;
  hasData: boolean;
}) {
  const tone = error ? (hasData ? 'stale' : 'error') : loading ? 'pending' : 'snapshot';
  const label = error
    ? (hasData ? 'Cached snapshot' : 'Source unavailable')
    : loading
      ? 'Querying source'
      : 'Snapshot loaded';
  const sourceLabel = source?.org || 'Telemetry source';
  return (
    <div className="anomaly-source" data-tone={tone} title={source?.measurement || 'hardware_metrics'}>
      <span className="anomaly-source-dot" aria-hidden="true" />
      <Database size={14} aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{sourceLabel}</small>
      </span>
    </div>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: SummaryIcon;
  label: string;
  value: string;
  detail: string;
  tone: SummaryTone;
}) {
  return (
    <div className="anomaly-summary-item" data-tone={tone}>
      <span className="anomaly-summary-icon"><Icon size={17} aria-hidden={true} /></span>
      <span className="anomaly-summary-copy">
        <span className="anomaly-summary-label">{label}</span>
        <strong className="anomaly-summary-value">{value}</strong>
        <span className="anomaly-summary-detail">{detail}</span>
      </span>
    </div>
  );
}

function AnomalyTrace({ points, range }: { points: HardwareAnomalyPoint[]; range: RangeKey }) {
  const colors = useThemeColors();
  const { theme } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const chartPoints = useMemo<ChartPoint[]>(() => points.map((point) => ({
    ...point,
    timestamp: new Date(point.time).getTime(),
    corridorCeiling: point.anomalyThreshold,
    flaggedMse: point.anomalyFlag === true ? point.anomalyMse : null,
  })), [points]);
  const windows = useMemo(() => flaggedWindows(chartPoints), [chartPoints]);
  const flaggedCount = points.filter((point) => point.anomalyFlag === true).length;
  const crossingCount = points.filter(crossedThreshold).length;
  const signalColors = theme === 'light'
    ? { mse: '#047857', threshold: '#be185d', flag: '#b91c1c', axis: '#475569' }
    : { mse: colors.accent, threshold: colors.accent2, flag: colors.err, axis: colors.textDim };

  return (
    <figure className="anomaly-trace" aria-labelledby="anomaly-trace-caption">
      <figcaption id="anomaly-trace-caption" className="anomaly-visually-hidden">
        Reconstruction error over the selected range. The shaded corridor is bounded by the learned threshold.
        {` ${crossingCount} threshold crossings and ${flaggedCount} flagged windows are present.`}
      </figcaption>
      <div className="anomaly-chart">
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={0}
          initialDimension={{ width: 800, height: 360 }}
        >
          <ComposedChart
            data={chartPoints}
            margin={{ top: 12, right: 14, left: 2, bottom: 2 }}
            accessibilityLayer
            aria-label="Hardware anomaly threshold chart"
            aria-describedby="anomaly-trace-caption"
          >
            <defs>
              <linearGradient id="anomaly-corridor-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={signalColors.threshold} stopOpacity={0.18} />
                <stop offset="100%" stopColor={signalColors.threshold} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colors.chartGrid} strokeDasharray="3 5" vertical={false} />
            {windows.map((window) => (
              <ReferenceArea
                key={`${window.start}-${window.end}`}
                x1={window.start}
                x2={window.end}
                fill={signalColors.flag}
                fillOpacity={0.095}
                strokeOpacity={0}
                ifOverflow="hidden"
              />
            ))}
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value: number) => formatAxisTime(value, range)}
              stroke={signalColors.axis}
              tickLine={false}
              axisLine={false}
              minTickGap={52}
              fontSize={11}
              tickMargin={10}
            />
            <YAxis
              domain={[0, 2]}
              ticks={[0, 0.5, 1, 1.5, 2]}
              allowDataOverflow
              tickFormatter={formatFixedAxisMetric}
              stroke={signalColors.axis}
              tickLine={false}
              axisLine={false}
              width={58}
              fontSize={11}
              tickMargin={8}
            />
            <Tooltip
              content={<AnomalyTooltip />}
              cursor={{ stroke: colors.chartCursor, strokeWidth: 1 }}
            />
            <Area
              type="stepAfter"
              dataKey="corridorCeiling"
              stroke="none"
              fill="url(#anomaly-corridor-fill)"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="anomalyMse"
              name="Reconstruction error"
              stroke={signalColors.mse}
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, fill: colors.panelSolid }}
              isAnimationActive={!reducedMotion}
              animationDuration={500}
            />
            <Line
              type="stepAfter"
              dataKey="anomalyThreshold"
              name="Learned threshold"
              stroke={signalColors.threshold}
              strokeWidth={1.7}
              strokeDasharray="7 5"
              dot={false}
              isAnimationActive={false}
            />
            <Scatter
              name="Flagged window"
              dataKey="flaggedMse"
              fill={signalColors.flag}
              line={false}
              isAnimationActive={!reducedMotion}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

interface TooltipEntry {
  payload?: ChartPoint;
}

function AnomalyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
}) {
  const point = payload?.find((entry) => entry.payload)?.payload;
  if (!active || !point) return null;
  const crossed = crossedThreshold(point);
  const stateLabel = point.anomalyFlag === true
    ? 'Flag raised'
    : crossed && point.anomalyFlag === false
      ? 'Crossed · no flag'
      : crossed
        ? 'Crossed · flag unknown'
        : point.anomalyFlag === null
          ? 'Flag unavailable'
          : 'Within threshold';
  const stateTone = point.anomalyFlag === true ? 'err' : crossed ? 'warn' : point.anomalyFlag === null ? '' : 'ok';

  return (
    <div className="anomaly-tooltip">
      <div className="anomaly-tooltip-time">{formatTableTime(point.time)}</div>
      <div><span>Reconstruction error</span><strong>{formatMetric(point.anomalyMse)}</strong></div>
      <div><span>Learned threshold</span><strong>{formatMetric(point.anomalyThreshold)}</strong></div>
      <div><span>Error / threshold</span><strong>{formatRatio(point)}</strong></div>
      <span className={`badge ${stateTone}`}>
        {stateLabel}
      </span>
    </div>
  );
}

function BreachTable({ rows, total }: { rows: HardwareAnomalyPoint[]; total: number }) {
  return (
    <Card
      className="anomaly-breach-card"
      title={
        <span className="anomaly-card-title">
          <ShieldAlert size={15} aria-hidden="true" />
          Recent threshold breaches
        </span>
      }
      sub="Newest first · flagged windows and unflagged crossings"
      right={<span className={`badge ${rows.length > 0 ? 'warn' : 'ok'}`}>{rows.length > 0 ? `${rows.length} shown` : 'All clear'}</span>}
    >
      {rows.length === 0 ? (
        <div className="anomaly-no-breaches">
          <CheckCircle2 size={22} aria-hidden="true" />
          <div>
            <strong>No threshold breaches in this range</strong>
            <span>All {total.toLocaleString()} samples remained within the learned corridor.</span>
          </div>
        </div>
      ) : (
        <div className="anomaly-table-wrap">
          <table className="anomaly-table">
            <caption className="anomaly-visually-hidden">
              The 20 most recent hardware anomaly threshold breaches.
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Detector result</th>
                <th scope="col">MSE</th>
                <th scope="col">Threshold</th>
                <th scope="col">Δ threshold</th>
                <th scope="col">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((point) => {
                const delta = point.anomalyMse !== null && point.anomalyThreshold !== null
                  ? point.anomalyMse - point.anomalyThreshold
                  : null;
                return (
                  <tr key={point.time}>
                    <td><time dateTime={point.time}>{formatTableTime(point.time)}</time></td>
                    <td>
                      <span className={`badge ${point.anomalyFlag === true ? 'err' : 'warn'}`}>
                        {point.anomalyFlag === true
                          ? 'Flagged'
                          : point.anomalyFlag === false
                            ? 'Crossed · no flag'
                            : 'Crossed · flag unknown'}
                      </span>
                    </td>
                    <td className="mono">{formatMetric(point.anomalyMse)}</td>
                    <td className="mono">{formatMetric(point.anomalyThreshold)}</td>
                    <td className={`mono ${delta !== null && delta > 0 ? 'anomaly-positive' : ''}`}>
                      {delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatMetric(delta)}`}
                    </td>
                    <td className="mono">{formatRatio(point)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AnomalyLoadingState() {
  return (
    <div className="anomaly-loading" aria-hidden="true">
      <div className="anomaly-loading-summary">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index}>
            <span className="skeleton-row" />
            <span className="skeleton-row" />
            <span className="skeleton-row" />
          </div>
        ))}
      </div>
      <Card className="anomaly-loading-chart">
        <span className="skeleton-row" />
        <span className="skeleton-row" />
        <span className="skeleton-row" />
        <span className="skeleton-row" />
      </Card>
    </div>
  );
}

function AnomalyErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="anomaly-state-card">
      <span className="anomaly-state-icon is-error"><AlertTriangle size={24} aria-hidden="true" /></span>
      <div>
        <h2>Anomaly telemetry is unavailable</h2>
        <p>{message} Check the server’s InfluxDB connection, then retry this query.</p>
      </div>
      <button type="button" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Retry query</button>
    </Card>
  );
}

function AnomalyEmptyState({
  rangeLabel,
  loading,
  onRefresh,
}: {
  rangeLabel: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Card className="anomaly-state-card">
      <span className="anomaly-state-icon"><Activity size={24} aria-hidden="true" /></span>
      <div>
        <h2>No anomaly samples in the last {rangeLabel}</h2>
        <p>The selected range returned no hardware anomaly measurements. Choose a longer range or refresh.</p>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading}>
        <RefreshCw size={14} className={loading ? 'is-spinning' : undefined} aria-hidden="true" />
        {loading ? 'Refreshing' : 'Refresh query'}
      </button>
    </Card>
  );
}
