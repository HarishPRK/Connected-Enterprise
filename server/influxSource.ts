const DEFAULT_INFLUX_URL = 'http://76.187.201.239:8086';
const DEFAULT_INFLUX_ORG = 'Capgemini';
const DEFAULT_INFLUX_BUCKET = 'BGW620';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1_000;
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;
const MIN_WINDOW_MS = 1_000;
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_WINDOW_COUNT = 10_000;

export type AnomalyFlagAggregation = 'max' | 'last';
export type AnomalyValueAggregation = 'mean' | 'last';

export interface AnomalyQueryInput {
  /** RFC3339 timestamp or a lookback such as `-24h` / `24h`. */
  start?: unknown;
  /** RFC3339 timestamp or `now`. */
  stop?: unknown;
  /** Flux duration from 1s through 7d, for example `5m`. */
  window?: unknown;
  flagAggregation?: unknown;
  valueAggregation?: unknown;
}

export interface ResolvedAnomalyQuery {
  start: string;
  stop: string;
  window: string;
  flagAggregation: AnomalyFlagAggregation;
  valueAggregation: AnomalyValueAggregation;
}

export interface AnomalyPoint {
  time: string;
  anomalyFlag?: boolean;
  anomalyMse?: number;
  anomalyThreshold?: number;
}

export interface AnomalyQueryResult {
  source: {
    org: string;
    bucket: string;
    measurement: 'hardware_metrics';
  };
  range: {
    start: string;
    stop: string;
  };
  window: string;
  aggregations: {
    anomalyFlag: AnomalyFlagAggregation;
    anomalyMse: AnomalyValueAggregation;
    anomalyThreshold: AnomalyValueAggregation;
  };
  points: AnomalyPoint[];
}

export type InfluxSourceErrorKind =
  | 'validation'
  | 'configuration'
  | 'timeout'
  | 'upstream'
  | 'response';

/** Every message carried by this error is safe to return to the browser. */
export class InfluxSourceError extends Error {
  constructor(
    public readonly kind: InfluxSourceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'InfluxSourceError';
  }
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface InfluxSourceConfig {
  baseUrl?: string;
  org?: string;
  bucket?: string;
  token?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface NormalizedInfluxSourceConfig {
  baseUrl: string;
  org: string;
  bucket: string;
  token: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl: FetchLike;
  now: () => number;
}

const durationFactors: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
};

function positiveIntegerSetting(
  raw: string | undefined,
  fallback: number,
  name: string,
  maximum: number,
): number {
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new InfluxSourceError(
      'configuration',
      `${name} must be a positive integer no greater than ${maximum}.`,
    );
  }
  return parsed;
}

function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InfluxSourceError('configuration', 'INFLUX_URL must be a valid HTTP or HTTPS URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InfluxSourceError('configuration', 'INFLUX_URL must use HTTP or HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new InfluxSourceError(
      'configuration',
      'INFLUX_URL must not contain credentials; use the server-only INFLUX_TOKEN setting.',
    );
  }
  if (parsed.search || parsed.hash) {
    throw new InfluxSourceError('configuration', 'INFLUX_URL must not contain a query string or fragment.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

function normalizeConfig(config: InfluxSourceConfig): NormalizedInfluxSourceConfig {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new InfluxSourceError('configuration', 'InfluxDB timeout must be a positive integer.');
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new InfluxSourceError('configuration', 'InfluxDB response cap must be a positive integer.');
  }

  const org = config.org?.trim() || DEFAULT_INFLUX_ORG;
  const bucket = config.bucket?.trim() || DEFAULT_INFLUX_BUCKET;
  return {
    baseUrl: normalizeBaseUrl(config.baseUrl?.trim() || DEFAULT_INFLUX_URL),
    org,
    bucket,
    token: config.token?.trim() ?? '',
    timeoutMs,
    maxResponseBytes,
    fetchImpl: config.fetchImpl ?? fetch,
    now: config.now ?? Date.now,
  };
}

function scalarQueryValue(raw: unknown, name: string): string | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw !== 'string') {
    throw new InfluxSourceError('validation', `${name} must be a single string value.`);
  }
  const value = raw.trim();
  if (!value) return undefined;
  return value;
}

function parseDuration(raw: string): { milliseconds: number; flux: string } | undefined {
  const match = /^(\d+)(ms|s|m|h|d|w)$/.exec(raw);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const factor = durationFactors[match[2]];
  const milliseconds = amount * factor;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return undefined;
  return { milliseconds, flux: `${amount}${match[2]}` };
}

function parseTimestamp(raw: string, name: string): number {
  // A timezone is mandatory. This avoids the server's local timezone changing
  // the requested range and keeps the value safe to embed as an RFC3339 string.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    throw new InfluxSourceError(
      'validation',
      `${name} must be an RFC3339 timestamp${name === 'stop' ? ' or "now"' : ' or a lookback such as "-24h"'}.`,
    );
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    throw new InfluxSourceError('validation', `${name} is not a valid timestamp.`);
  }
  return timestamp;
}

function aggregation<T extends string>(
  raw: unknown,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = scalarQueryValue(raw, name);
  if (value == null) return fallback;
  if (!allowed.includes(value as T)) {
    throw new InfluxSourceError('validation', `${name} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function resolveAnomalyQuery(input: AnomalyQueryInput, nowMs = Date.now()): ResolvedAnomalyQuery {
  if (!Number.isFinite(nowMs)) {
    throw new InfluxSourceError('configuration', 'InfluxDB query clock returned an invalid value.');
  }

  const stopRaw = scalarQueryValue(input.stop, 'stop');
  const stopMs = stopRaw == null || stopRaw.toLowerCase() === 'now'
    ? nowMs
    : parseTimestamp(stopRaw, 'stop');

  const startRaw = scalarQueryValue(input.start, 'start');
  let startMs: number;
  if (startRaw == null) {
    startMs = stopMs - DEFAULT_LOOKBACK_MS;
  } else {
    const lookback = parseDuration(startRaw.replace(/^-/, ''));
    startMs = lookback
      ? stopMs - lookback.milliseconds
      : parseTimestamp(startRaw, 'start');
  }

  if (startMs >= stopMs) {
    throw new InfluxSourceError('validation', 'start must be earlier than stop.');
  }
  if (stopMs - startMs > MAX_RANGE_MS) {
    throw new InfluxSourceError('validation', 'The requested time range cannot exceed 31 days.');
  }

  const windowRaw = scalarQueryValue(input.window, 'window') ?? '5m';
  const window = parseDuration(windowRaw);
  if (!window || window.milliseconds < MIN_WINDOW_MS || window.milliseconds > MAX_WINDOW_MS) {
    throw new InfluxSourceError('validation', 'window must be a duration from 1s through 7d.');
  }
  if (Math.ceil((stopMs - startMs) / window.milliseconds) > MAX_WINDOW_COUNT) {
    throw new InfluxSourceError(
      'validation',
      `The requested range and window cannot produce more than ${MAX_WINDOW_COUNT} time buckets.`,
    );
  }

  return {
    start: new Date(startMs).toISOString(),
    stop: new Date(stopMs).toISOString(),
    window: window.flux,
    flagAggregation: aggregation(
      input.flagAggregation,
      'flagAggregation',
      ['max', 'last'] as const,
      'max',
    ),
    valueAggregation: aggregation(
      input.valueAggregation,
      'valueAggregation',
      ['mean', 'last'] as const,
      'mean',
    ),
  };
}

/** JSON string escaping is compatible with Flux string literals. */
function fluxString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Construct the one allowlisted query used by the anomaly page. No request
 * value can add a filter, function, bucket, or other arbitrary Flux fragment.
 */
export function buildAnomalyFluxQuery(
  bucket: string,
  query: ResolvedAnomalyQuery,
): string {
  const common = `from(bucket: ${fluxString(bucket)})
  |> range(start: time(v: ${fluxString(query.start)}), stop: time(v: ${fluxString(query.stop)}))
  |> filter(fn: (r) => r["_measurement"] == "hardware_metrics")
  |> filter(fn: (r) => r["_field"] == "value")`;

  // The first page is a bucket-wide view. Grouping only by metric deliberately
  // collapses host/device tag dimensions before each window is aggregated.
  return `flag = ${common}
  |> filter(fn: (r) => r["metric"] == "anomaly_flag")
  |> group(columns: ["metric"])
  |> aggregateWindow(every: ${query.window}, fn: ${query.flagAggregation}, createEmpty: false)

values = ${common}
  |> filter(fn: (r) => r["metric"] == "anomaly_mse" or r["metric"] == "anomaly_threshold")
  |> group(columns: ["metric"])
  |> aggregateWindow(every: ${query.window}, fn: ${query.valueAggregation}, createEmpty: false)

union(tables: [flag, values])
  |> keep(columns: ["_time", "_value", "metric"])
  |> group()
  |> sort(columns: ["_time", "metric"])
  |> yield(name: "anomalies")`;
}

function parseCsvRecords(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const finishRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      finishRow();
    } else if (character === '\r') {
      if (input[index + 1] !== '\n') finishRow();
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new InfluxSourceError('response', 'InfluxDB returned malformed CSV data.');
  }
  if (field.length > 0 || row.length > 0) finishRow();
  return rows;
}

function parseFlag(raw: string): boolean {
  if (typeof raw !== 'string') {
    throw new InfluxSourceError('response', 'InfluxDB returned a malformed anomaly flag.');
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    throw new InfluxSourceError('response', 'InfluxDB returned an empty anomaly flag.');
  }
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    throw new InfluxSourceError('response', 'InfluxDB returned an invalid anomaly flag.');
  }
  return numeric !== 0;
}

function parseMetricNumber(raw: string): number {
  if (typeof raw !== 'string') {
    throw new InfluxSourceError('response', 'InfluxDB returned a malformed anomaly metric.');
  }
  if (!raw.trim()) {
    throw new InfluxSourceError('response', 'InfluxDB returned an empty anomaly metric.');
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    throw new InfluxSourceError('response', 'InfluxDB returned an invalid anomaly metric.');
  }
  return numeric;
}

export function parseAnomalyAnnotatedCsv(csv: string): AnomalyPoint[] {
  const points = new Map<string, AnomalyPoint>();
  let timeIndex = -1;
  let valueIndex = -1;
  let metricIndex = -1;
  let sawHeader = false;

  for (const row of parseCsvRecords(csv.replace(/^\uFEFF/, ''))) {
    if (row.length === 0 || row[0]?.startsWith('#')) continue;

    const nextTimeIndex = row.indexOf('_time');
    const nextValueIndex = row.indexOf('_value');
    const nextMetricIndex = row.indexOf('metric');
    if (nextTimeIndex >= 0 && nextValueIndex >= 0 && nextMetricIndex >= 0) {
      timeIndex = nextTimeIndex;
      valueIndex = nextValueIndex;
      metricIndex = nextMetricIndex;
      sawHeader = true;
      continue;
    }
    if (timeIndex < 0 || valueIndex < 0 || metricIndex < 0) continue;

    const metric = row[metricIndex];
    if (metric !== 'anomaly_flag' && metric !== 'anomaly_mse' && metric !== 'anomaly_threshold') {
      continue;
    }
    const rawTime = row[timeIndex];
    const timestamp = Date.parse(rawTime);
    if (!Number.isFinite(timestamp)) {
      throw new InfluxSourceError('response', 'InfluxDB returned an invalid anomaly timestamp.');
    }
    const time = new Date(timestamp).toISOString();
    const point = points.get(time) ?? { time };
    const rawValue = row[valueIndex];
    if (metric === 'anomaly_flag') point.anomalyFlag = parseFlag(rawValue);
    if (metric === 'anomaly_mse') point.anomalyMse = parseMetricNumber(rawValue);
    if (metric === 'anomaly_threshold') point.anomalyThreshold = parseMetricNumber(rawValue);
    points.set(time, point);
  }

  if (csv.trim() && !sawHeader) {
    throw new InfluxSourceError('response', 'InfluxDB returned malformed CSV data.');
  }

  return [...points.values()].sort((left, right) => left.time.localeCompare(right.time));
}

async function readLimitedResponse(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    controller.abort();
    throw new InfluxSourceError('response', 'InfluxDB response exceeded the server size limit.');
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let result = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        controller.abort();
        throw new InfluxSourceError('response', 'InfluxDB response exceeded the server size limit.');
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

export class InfluxSource {
  private readonly config: NormalizedInfluxSourceConfig;

  constructor(config: InfluxSourceConfig = {}) {
    this.config = normalizeConfig(config);
  }

  static fromEnv(): InfluxSource {
    return new InfluxSource({
      baseUrl: process.env.INFLUX_URL,
      org: process.env.INFLUX_ORG,
      bucket: process.env.INFLUX_BUCKET,
      token: process.env.INFLUX_TOKEN,
      timeoutMs: positiveIntegerSetting(
        process.env.INFLUX_TIMEOUT_MS,
        DEFAULT_TIMEOUT_MS,
        'INFLUX_TIMEOUT_MS',
        120_000,
      ),
      maxResponseBytes: positiveIntegerSetting(
        process.env.INFLUX_MAX_RESPONSE_BYTES,
        DEFAULT_MAX_RESPONSE_BYTES,
        'INFLUX_MAX_RESPONSE_BYTES',
        16 * 1024 * 1024,
      ),
    });
  }

  async queryAnomalies(input: AnomalyQueryInput = {}): Promise<AnomalyQueryResult> {
    if (!this.config.token) {
      throw new InfluxSourceError(
        'configuration',
        'InfluxDB query access is not configured. Set the server-only INFLUX_TOKEN value.',
      );
    }

    const query = resolveAnomalyQuery(input, this.config.now());
    const flux = buildAnomalyFluxQuery(this.config.bucket, query);
    const endpoint = new URL(`${this.config.baseUrl}/api/v2/query`);
    endpoint.searchParams.set('org', this.config.org);

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.config.fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/csv',
            Authorization: `Token ${this.config.token}`,
            'Content-Type': 'application/vnd.flux',
          },
          body: flux,
          signal: controller.signal,
        });
      } catch {
        if (timedOut) {
          throw new InfluxSourceError('timeout', 'InfluxDB did not respond before the query timed out.');
        }
        throw new InfluxSourceError('upstream', 'The server could not reach InfluxDB.');
      }

      if (!response.ok) {
        // Do not relay the upstream body. It can contain database internals and
        // is unnecessary for the browser to handle the failure safely.
        await response.body?.cancel().catch(() => undefined);
        throw new InfluxSourceError('upstream', 'InfluxDB rejected the anomaly query.');
      }

      let csv: string;
      try {
        csv = await readLimitedResponse(response, this.config.maxResponseBytes, controller);
      } catch (error) {
        if (timedOut) {
          throw new InfluxSourceError('timeout', 'InfluxDB did not respond before the query timed out.');
        }
        if (error instanceof InfluxSourceError) throw error;
        throw new InfluxSourceError('upstream', 'The server could not read the InfluxDB response.');
      }

      return {
        source: {
          org: this.config.org,
          bucket: this.config.bucket,
          measurement: 'hardware_metrics',
        },
        range: { start: query.start, stop: query.stop },
        window: query.window,
        aggregations: {
          anomalyFlag: query.flagAggregation,
          anomalyMse: query.valueAggregation,
          anomalyThreshold: query.valueAggregation,
        },
        points: parseAnomalyAnnotatedCsv(csv),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
