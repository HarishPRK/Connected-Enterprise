import { useCallback, useEffect, useRef, useState } from 'react';

export const HARDWARE_ANOMALIES_ENDPOINT = '/api/hardware-metrics/anomalies' as const;

export interface HardwareAnomalyPoint {
  time: string;
  anomalyFlag: boolean | null;
  anomalyMse: number | null;
  anomalyThreshold: number | null;
}

export interface HardwareAnomalySource {
  org: string;
  bucket: string;
  measurement: string;
}

export interface HardwareAnomalyRange {
  start: string;
  stop: string;
}

export interface HardwareAnomalyAggregations {
  anomalyFlag: 'max' | 'last';
  anomalyMse: 'mean' | 'last';
  anomalyThreshold: 'mean' | 'last';
}

export interface HardwareAnomalyResponse {
  source: HardwareAnomalySource;
  range: HardwareAnomalyRange;
  window: string;
  aggregations: HardwareAnomalyAggregations;
  points: HardwareAnomalyPoint[];
}

export interface HardwareAnomalyQuery {
  start: string;
  stop?: string;
  window: string;
  flagAggregation?: 'max' | 'last';
  valueAggregation?: 'mean' | 'last';
}

interface HardwareAnomalyState {
  data: HardwareAnomalyResponse | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
}

export interface UseHardwareAnomaliesResult extends HardwareAnomalyState {
  refresh: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function anomalyFlag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function parsePoint(value: unknown): HardwareAnomalyPoint | null {
  if (!isRecord(value) || typeof value.time !== 'string') return null;
  if (!Number.isFinite(new Date(value.time).getTime())) return null;

  return {
    time: value.time,
    anomalyFlag: anomalyFlag(value.anomalyFlag),
    anomalyMse: finiteNumber(value.anomalyMse),
    anomalyThreshold: finiteNumber(value.anomalyThreshold),
  };
}

function parseResponse(value: unknown): HardwareAnomalyResponse {
  if (!isRecord(value) || !Array.isArray(value.points)) {
    throw new Error('The anomaly service returned an unexpected response.');
  }

  const points = value.points
    .map(parsePoint)
    .filter((point): point is HardwareAnomalyPoint => point !== null)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  if (value.points.length > 0 && points.length === 0) {
    throw new Error('The anomaly service returned samples without valid timestamps.');
  }

  const source = isRecord(value.source) ? value.source : {};
  const range = isRecord(value.range) ? value.range : {};
  const aggregations = isRecord(value.aggregations) ? value.aggregations : {};

  return {
    source: {
      org: typeof source.org === 'string' ? source.org : 'Capgemini',
      bucket: typeof source.bucket === 'string' ? source.bucket : 'BGW620',
      measurement: typeof source.measurement === 'string' ? source.measurement : 'hardware_metrics',
    },
    range: {
      start: typeof range.start === 'string' ? range.start : '',
      stop: typeof range.stop === 'string' ? range.stop : '',
    },
    window: typeof value.window === 'string' ? value.window : '',
    aggregations: {
      anomalyFlag: aggregations.anomalyFlag === 'last' ? 'last' : 'max',
      anomalyMse: aggregations.anomalyMse === 'last' ? 'last' : 'mean',
      anomalyThreshold: aggregations.anomalyThreshold === 'last' ? 'last' : 'mean',
    },
    points,
  };
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      if (typeof body.error === 'string' && body.error.trim()) return body.error;
      if (typeof body.message === 'string' && body.message.trim()) return body.message;
    }
  } catch {
    // The HTTP status below is still useful when the response is not JSON.
  }
  return `The anomaly service returned HTTP ${response.status}.`;
}

export function useHardwareAnomalies(
  query: HardwareAnomalyQuery,
): UseHardwareAnomaliesResult {
  const [requestVersion, setRequestVersion] = useState(0);
  const previousQueryKey = useRef<string | null>(null);
  const [state, setState] = useState<HardwareAnomalyState>({
    data: null,
    loading: true,
    error: null,
    fetchedAt: null,
  });

  const refresh = useCallback(() => setRequestVersion((version) => version + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const queryKey = [
      query.start,
      query.stop ?? 'now',
      query.window,
      query.flagAggregation ?? 'max',
      query.valueAggregation ?? 'mean',
    ].join('|');
    const params = new URLSearchParams({
      start: query.start,
      stop: query.stop ?? 'now',
      window: query.window,
      flagAggregation: query.flagAggregation ?? 'max',
      valueAggregation: query.valueAggregation ?? 'mean',
    });

    const rangeChanged = previousQueryKey.current !== null && previousQueryKey.current !== queryKey;
    previousQueryKey.current = queryKey;
    setState((previous) => ({
      ...previous,
      data: rangeChanged ? null : previous.data,
      loading: true,
      error: null,
    }));

    fetch(`${HARDWARE_ANOMALIES_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response));
        return response.json() as Promise<unknown>;
      })
      .then((body) => {
        const data = parseResponse(body);
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null, fetchedAt: Date.now() });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : 'Unable to load anomaly telemetry.',
        }));
      });

    return () => controller.abort();
  }, [
    query.start,
    query.stop,
    query.window,
    query.flagAggregation,
    query.valueAggregation,
    requestVersion,
  ]);

  return { ...state, refresh };
}
