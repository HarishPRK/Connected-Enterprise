import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnomalyFluxQuery,
  InfluxSource,
  InfluxSourceError,
  parseAnomalyAnnotatedCsv,
  resolveAnomalyQuery,
} from './influxSource.js';

const NOW = Date.parse('2026-08-20T18:00:00.000Z');

const ANNOTATED_CSV = `#datatype,string,long,dateTime:RFC3339,double,string
#group,false,false,false,false,false
#default,_result,,,,
,result,table,_time,_value,metric
,,0,2026-08-20T17:50:00Z,0,anomaly_flag
,,0,2026-08-20T17:50:00Z,0.014,anomaly_mse
,,0,2026-08-20T17:50:00Z,0.020,anomaly_threshold
,,0,2026-08-20T17:55:00Z,true,anomaly_flag
,,0,2026-08-20T17:55:00Z,0.031,anomaly_mse
,,0,2026-08-20T17:55:00Z,0.020,anomaly_threshold
`;

function errorOf(promise: Promise<unknown>): Promise<InfluxSourceError> {
  return promise.then(
    () => assert.fail('expected promise to reject'),
    (error: unknown) => {
      assert.ok(error instanceof InfluxSourceError);
      return error;
    },
  );
}

test('queries the fixed Influx endpoint and normalizes annotated CSV', async () => {
  const calls: Array<{ input: string | URL; init?: RequestInit }> = [];
  const source = new InfluxSource({
    token: 'test-read-only-token',
    fetchImpl: async (input, init) => {
      calls.push({ input, init });
      return new Response(ANNOTATED_CSV, {
        status: 200,
        headers: { 'Content-Type': 'application/csv' },
      });
    },
    now: () => NOW,
  });

  const result = await source.queryAnomalies({ start: '-1h', window: '5m' });

  assert.equal(calls.length, 1);
  const call = calls[0];
  const url = new URL(String(call.input));
  assert.equal(url.origin, 'http://76.187.201.239:8086');
  assert.equal(url.pathname, '/api/v2/query');
  assert.equal(url.searchParams.get('org'), 'Capgemini');
  assert.equal(call.init?.method, 'POST');
  assert.equal(new Headers(call.init?.headers).get('authorization'), 'Token test-read-only-token');
  assert.equal(new Headers(call.init?.headers).get('content-type'), 'application/vnd.flux');
  assert.doesNotMatch(String(call.init?.body), /test-read-only-token/);
  assert.match(String(call.init?.body), /from\(bucket: "BGW620"\)/);
  assert.match(String(call.init?.body), /metric"\] == "anomaly_flag"/);
  assert.match(String(call.init?.body), /group\(columns: \["metric"\]\)/);
  assert.match(String(call.init?.body), /fn: max/);
  assert.match(String(call.init?.body), /fn: mean/);
  assert.doesNotMatch(String(call.init?.body), /v\.timeRange|v\.windowPeriod/);

  assert.deepEqual(result, {
    source: { org: 'Capgemini', bucket: 'BGW620', measurement: 'hardware_metrics' },
    range: {
      start: '2026-08-20T17:00:00.000Z',
      stop: '2026-08-20T18:00:00.000Z',
    },
    window: '5m',
    aggregations: {
      anomalyFlag: 'max',
      anomalyMse: 'mean',
      anomalyThreshold: 'mean',
    },
    points: [
      {
        time: '2026-08-20T17:50:00.000Z',
        anomalyFlag: false,
        anomalyMse: 0.014,
        anomalyThreshold: 0.020,
      },
      {
        time: '2026-08-20T17:55:00.000Z',
        anomalyFlag: true,
        anomalyMse: 0.031,
        anomalyThreshold: 0.020,
      },
    ],
  });
});

test('allows only separate, allowlisted selector/aggregate functions', () => {
  const query = resolveAnomalyQuery({
    start: '2026-08-20T12:00:00Z',
    stop: '2026-08-20T13:00:00Z',
    window: '30s',
    flagAggregation: 'last',
    valueAggregation: 'last',
  }, NOW);
  const flux = buildAnomalyFluxQuery('bucket-with-"quote', query);

  assert.equal(query.flagAggregation, 'last');
  assert.equal(query.valueAggregation, 'last');
  assert.equal((flux.match(/fn: last/g) ?? []).length, 2);
  assert.equal((flux.match(/\|> sort\(columns: \["_time"\]\)/g) ?? []).length, 2);
  assert.equal((flux.match(
    /\|> group\(columns: \["metric"\]\)\s+\|> sort\(columns: \["_time"\]\)\s+\|> aggregateWindow\([^\n]+fn: last/g,
  ) ?? []).length, 2);
  assert.match(flux, /bucket-with-\\"quote/);
  assert.match(flux, /keep\(columns: \["_time", "_value", "metric"\]\)/);
});

test('rejects arbitrary Flux and excessive query ranges before fetching', async () => {
  let fetchCount = 0;
  const source = new InfluxSource({
    token: 'test-token',
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response('');
    },
    now: () => NOW,
  });

  const injection = await errorOf(source.queryAnomalies({
    window: '5m) |> drop(columns: ["_value"])',
  }));
  assert.equal(injection.kind, 'validation');

  const excessive = await errorOf(source.queryAnomalies({ start: '-32d' }));
  assert.equal(excessive.kind, 'validation');

  const tooManyWindows = await errorOf(source.queryAnomalies({ start: '-31d', window: '1s' }));
  assert.equal(tooManyWindows.kind, 'validation');
  assert.match(tooManyWindows.message, /10000 time buckets/);

  const arrayValue = await errorOf(source.queryAnomalies({ start: ['-1h', '-2h'] }));
  assert.equal(arrayValue.kind, 'validation');
  assert.equal(fetchCount, 0);
});

test('an absent token returns a configuration failure without contacting InfluxDB', async () => {
  let fetched = false;
  const source = new InfluxSource({
    token: '',
    fetchImpl: async () => {
      fetched = true;
      return new Response('');
    },
  });

  const error = await errorOf(source.queryAnomalies());
  assert.equal(error.kind, 'configuration');
  assert.match(error.message, /INFLUX_TOKEN/);
  assert.equal(fetched, false);
});

test('does not relay an upstream error body', async () => {
  const source = new InfluxSource({
    token: 'test-token',
    fetchImpl: async () => new Response(
      'database diagnostic containing do-not-expose-this-value',
      { status: 401 },
    ),
  });

  const error = await errorOf(source.queryAnomalies());
  assert.equal(error.kind, 'upstream');
  assert.doesNotMatch(error.message, /do-not-expose|diagnostic|401/);
});

test('aborts a query that exceeds its timeout', async () => {
  let observedAbort = false;
  const source = new InfluxSource({
    token: 'test-token',
    timeoutMs: 10,
    fetchImpl: (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        observedAbort = true;
        reject(new Error('aborted'));
      }, { once: true });
    }),
  });

  const error = await errorOf(source.queryAnomalies());
  assert.equal(error.kind, 'timeout');
  assert.equal(observedAbort, true);
});

test('propagates a caller abort to the upstream fetch', async () => {
  let upstreamSignal: AbortSignal | undefined;
  const source = new InfluxSource({
    token: 'test-token',
    fetchImpl: (_input, init) => new Promise<Response>((_resolve, reject) => {
      upstreamSignal = init?.signal ?? undefined;
      if (upstreamSignal?.aborted) {
        reject(new Error('aborted'));
        return;
      }
      upstreamSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  const caller = new AbortController();

  const pending = source.queryAnomalies({}, { signal: caller.signal });
  caller.abort();

  const error = await errorOf(pending);
  assert.equal(error.kind, 'cancelled');
  assert.equal(upstreamSignal?.aborted, true);
});

test('stops reading a response beyond the configured byte cap', async () => {
  const source = new InfluxSource({
    token: 'test-token',
    maxResponseBytes: 16,
    fetchImpl: async () => new Response(ANNOTATED_CSV),
  });

  const error = await errorOf(source.queryAnomalies());
  assert.equal(error.kind, 'response');
  assert.match(error.message, /size limit/);
});

test('parses quoted, repeated annotated CSV tables without naive comma splitting', () => {
  const csv = `#datatype,string,long,dateTime:RFC3339,double,string,string
#group,false,false,false,false,false,false
#default,_result,,,,,
,result,table,_time,_value,metric,note
,,0,"2026-08-20T17:55:00Z",1,"anomaly_flag","value, contains comma"

#datatype,string,long,dateTime:RFC3339,double,string,string
#group,false,false,false,false,false,false
#default,_result,,,,,
,result,table,_time,_value,metric,note
,,1,"2026-08-20T17:55:00Z",0.42,"anomaly_mse","line one
line two"
,,1,"2026-08-20T17:55:00Z",0.5,"anomaly_threshold",ok
`;

  assert.deepEqual(parseAnomalyAnnotatedCsv(csv), [{
    time: '2026-08-20T17:55:00.000Z',
    anomalyFlag: true,
    anomalyMse: 0.42,
    anomalyThreshold: 0.5,
  }]);
});

test('rejects empty values instead of converting missing data into healthy zeros', () => {
  const csv = `,result,table,_time,_value,metric
,,0,2026-08-20T17:55:00Z,,anomaly_flag
`;
  assert.throws(
    () => parseAnomalyAnnotatedCsv(csv),
    (error: unknown) => error instanceof InfluxSourceError
      && error.kind === 'response'
      && /empty anomaly flag/.test(error.message),
  );

  const numericCsv = `,result,table,_time,_value,metric
,,0,2026-08-20T17:55:00Z,   ,anomaly_mse
`;
  assert.throws(
    () => parseAnomalyAnnotatedCsv(numericCsv),
    (error: unknown) => error instanceof InfluxSourceError
      && error.kind === 'response'
      && /empty anomaly metric/.test(error.message),
  );
});

test('rejects a successful non-CSV response instead of silently returning no data', async () => {
  const source = new InfluxSource({
    token: 'test-token',
    fetchImpl: async () => new Response('{"unexpected":"payload"}', { status: 200 }),
  });

  const error = await errorOf(source.queryAnomalies());
  assert.equal(error.kind, 'response');
  assert.match(error.message, /malformed CSV/);
});

test('rejects an appended Influx error table instead of returning partial results', () => {
  const partialThenError = `${ANNOTATED_CSV}
#datatype,string,long
#group,true,true
#default,,
,error,reference
,"execution failed after partial output, internal detail",42
`;

  assert.throws(
    () => parseAnomalyAnnotatedCsv(partialThenError),
    (error: unknown) => error instanceof InfluxSourceError
      && error.kind === 'response'
      && /error while executing/.test(error.message)
      && !/internal detail|partial output/.test(error.message),
  );
});
