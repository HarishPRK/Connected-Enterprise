import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnomalyFluxQuery,
  buildEagleDevicesFluxQuery,
  InfluxSource,
  InfluxSourceError,
  parseAnomalyAnnotatedCsv,
  parseEagleAnnotatedCsv,
  parseEagleDevicesCsv,
  resolveAnomalyQuery,
} from './influxSource.js';

const NOW = Date.parse('2026-08-20T18:00:00.000Z');

const DEVICES_CSV = `#datatype,string,long,string
#group,false,false,false
#default,_result,,
,result,table,_value
,,0,gateway-b
,,0,R95VA4GP000041
,,0,gateway-b
,,0,branch:gateway_1.0
,,0,invalid device
,,0,NULL
,,0,UNKNOWN
`;

test('discovers sorted unique retained devices from hardware metrics, without a chart-range or device filter', async () => {
  let body = '';
  const source = new InfluxSource({ token: 'test-read-only-token', fetchImpl: async (_url, init) => {
    body = String(init?.body);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Token test-read-only-token');
    return new Response(DEVICES_CSV);
  } });
  assert.deepEqual(await source.listDevices(), { devices: ['R95VA4GP000041', 'branch:gateway_1.0', 'gateway-b'] });
  assert.match(body, /schema.measurementTagValues/);
  assert.match(body, /measurement: "hardware_metrics"/);
  assert.match(body, /tag: "device_serial"/);
  assert.match(body, /start: time\(v: 0\)/);
  assert.doesNotMatch(body, /R95VA4GP|test-read-only-token|v.timeRange/);
  assert.match(buildEagleDevicesFluxQuery('bucket"name'), /bucket: "bucket\\"name"/);
});

test('device discovery handles empty results and rejects malformed or partial error responses', () => {
  assert.deepEqual(parseEagleDevicesCsv(''), []);
  assert.deepEqual(parseEagleDevicesCsv(',result,table,_value\r\n'), []);
  assert.deepEqual(parseEagleDevicesCsv('\uFEFF,result,table,_value\r\n,,0,"gateway-a"\r\n'), ['gateway-a']);
  for (const csv of ['<html>Error</html>', `${DEVICES_CSV}\n,error,reference\n,private error,123`]) {
    assert.throws(() => parseEagleDevicesCsv(csv), InfluxSourceError);
  }
});

test('device discovery enforces credential, size and timeout protections', async () => {
  let calls = 0;
  const missing = new InfluxSource({ fetchImpl: async () => { calls++; return new Response(''); } });
  assert.equal((await errorOf(missing.listDevices())).kind, 'configuration');
  assert.equal(calls, 0);
  const limited = new InfluxSource({ token: 'test', maxResponseBytes: 16, fetchImpl: async () => new Response(DEVICES_CSV) });
  assert.equal((await errorOf(limited.listDevices())).kind, 'response');
  const timed = new InfluxSource({ token: 'test', timeoutMs: 10, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  assert.equal((await errorOf(timed.listDevices())).kind, 'timeout');
});

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
  assert.equal(url.origin, 'http://76.187.202.198:8086');
  assert.equal(url.pathname, '/api/v2/query');
  assert.equal(url.searchParams.get('org'), 'Capgemini');
  assert.equal(call.init?.method, 'POST');
  assert.equal(new Headers(call.init?.headers).get('authorization'), 'Token test-read-only-token');
  assert.equal(new Headers(call.init?.headers).get('content-type'), 'application/vnd.flux');
  assert.doesNotMatch(String(call.init?.body), /test-read-only-token/);
  assert.match(String(call.init?.body), /from\(bucket: "BGW620"\)/);
  assert.equal((String(call.init?.body).match(
    /device_serial"\] == "R95VA4GP000041"/g,
  ) ?? []).length, 5);
  assert.match(String(call.init?.body), /metric"\] == "anomaly_flag"/);
  assert.match(String(call.init?.body), /group\(columns: \["metric"\]\)/);
  assert.match(String(call.init?.body), /fn: max/);
  assert.match(String(call.init?.body), /fn: mean/);
  assert.doesNotMatch(String(call.init?.body), /v\.timeRange|v\.windowPeriod/);

  assert.deepEqual(result, {
    reasonCodes: [],
    conntrack: [],
    anomalyMetrics: [],
    source: { org: 'Capgemini', bucket: 'BGW620', measurement: 'hardware_metrics', deviceSerial: 'R95VA4GP000041' },
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

const EAGLE_CSV = `${ANNOTATED_CSV}
,result,table,_time,_value,_measurement,metric,device_serial
,reason_codes,0,2026-08-20T17:59:00Z,0,hardware_metrics,anomaly_reason_code,gateway-a
,reason_codes,1,2026-08-20T17:58:00Z,4,hardware_metrics,anomaly_reason_code,gateway-b

,result,table,_time,_value,_measurement,device_serial
,mean,0,2026-08-20T17:55:00Z,7.5,conntrack_tcp,gateway-a
,mean,0,2026-08-20T17:50:00Z,0,conntrack_tcp,gateway-a
,mean,1,2026-08-20T17:55:00Z,19,conntrack_tcp,gateway-b
,mean,2,2026-08-20T17:55:00Z,2,conntrack_udp,gateway-a
,mean,3,2026-08-20T17:55:00Z,0,conntrack_icmp,gateway-a
,mean,4,2026-08-20T17:55:00Z,1,conntrack_other,gateway-a
,mean,5,2026-08-20T17:55:00Z,10.5,conntrack_total,gateway-a
`;

test('reads mixed query schemas, preserving zero codes, fractional means and device series', async () => {
  const source = new InfluxSource({ token: 'test', now: () => NOW, fetchImpl: async () => new Response(EAGLE_CSV) });
  const result = await source.queryAnomalies();
  assert.deepEqual(result.points, parseAnomalyAnnotatedCsv(ANNOTATED_CSV));
  assert.deepEqual(result.reasonCodes, [
    { time: '2026-08-20T17:59:00.000Z', code: 0, tags: { device_serial: 'gateway-a' } },
    { time: '2026-08-20T17:58:00.000Z', code: 4, tags: { device_serial: 'gateway-b' } },
  ]);
  assert.equal(result.conntrack.length, 6);
  assert.deepEqual(result.conntrack[0].points, [
    { time: '2026-08-20T17:50:00.000Z', value: 0 },
    { time: '2026-08-20T17:55:00.000Z', value: 7.5 },
  ]);
  assert.equal(result.conntrack[1].points[0].value, 19);
  assert.notEqual(result.conntrack[0].id, result.conntrack[1].id);
});

test('all EA:GLE queries filter the device and new metric queries use hardware_metrics with mean windows', () => {
  const flux = buildAnomalyFluxQuery('BGW620', resolveAnomalyQuery({ start: '-6h', window: '5m' }, NOW));
  const extraQueries = flux.slice(flux.indexOf('from(bucket:', flux.indexOf('yield(name: "anomalies")')));
  assert.match(extraQueries, /"anomaly_reason_code"\)\s+\|> last\(\)/);
  for (const protocol of ['icmp', 'other', 'tcp', 'total', 'udp']) assert.ok(extraQueries.includes(`"conntrack_${protocol}"`));
  assert.match(extraQueries, /aggregateWindow\(every: 5m, fn: mean, createEmpty: false\)/);
  assert.doesNotMatch(extraQueries, /v\.timeRange|v\.windowPeriod/);
  assert.equal((extraQueries.match(/device_serial"\] == "R95VA4GP000041"/g) ?? []).length, 3);
  assert.equal((extraQueries.match(/_measurement"\] == "hardware_metrics"/g) ?? []).length, 3);
  assert.doesNotMatch(extraQueries, /_measurement"\] == "conntrack_/);
  assert.match(extraQueries, /metric"\] == "anomaly_raw_flag"/);
  assert.equal((extraQueries.match(/fn: mean/g) ?? []).length, 2);
});

test('new telemetry rejects invalid values and late errors, and handles empty results', () => {
  assert.deepEqual(parseEagleAnnotatedCsv(''), { reasonCodes: [], conntrack: [], anomalyMetrics: [] });
  assert.throws(() => parseEagleAnnotatedCsv(EAGLE_CSV.replace(',7.5,conntrack_tcp', ',NaN,conntrack_tcp')), InfluxSourceError);
  assert.throws(() => parseEagleAnnotatedCsv(EAGLE_CSV.replace(',0,hardware_metrics', ',,hardware_metrics')), InfluxSourceError);
  assert.throws(() => parseEagleAnnotatedCsv(`${EAGLE_CSV}\n,error,reference\n,query failed,123`), InfluxSourceError);
});

test('connection tracking can be returned when hardware measurements are absent', () => {
  const csv = ',result,table,_time,_value,_measurement\n,mean,0,2026-08-20T17:55:00Z,12,conntrack_total\n';
  assert.deepEqual(parseAnomalyAnnotatedCsv(csv), []);
  assert.equal(parseEagleAnnotatedCsv(csv).conntrack[0].points[0].value, 12);
});

test('new hardware_metrics series preserve raw and confirmed flag means without overwriting summary flags', () => {
  const csv = `${ANNOTATED_CSV}
,result,table,_time,_value,_measurement,metric,device_serial
,anomaly_metrics,0,2026-08-20T17:55:00Z,0.25,hardware_metrics,anomaly_flag,gateway-a
,anomaly_metrics,1,2026-08-20T17:55:00Z,0.75,hardware_metrics,anomaly_raw_flag,gateway-a
,anomaly_metrics,2,2026-08-20T17:55:00Z,0.015,hardware_metrics,anomaly_mse,gateway-a
,anomaly_metrics,3,2026-08-20T17:55:00Z,0.02,hardware_metrics,anomaly_threshold,gateway-a
,mean,4,2026-08-20T17:55:00Z,12.5,hardware_metrics,conntrack_total,gateway-a
,mean,5,2026-08-20T17:55:00Z,0,hardware_metrics,conntrack_icmp,gateway-a
,mean,6,2026-08-20T17:55:00Z,19,hardware_metrics,conntrack_total,gateway-b
`;
  assert.deepEqual(parseAnomalyAnnotatedCsv(csv), parseAnomalyAnnotatedCsv(ANNOTATED_CSV));
  const parsed = parseEagleAnnotatedCsv(csv);
  assert.equal(parsed.anomalyMetrics.length, 4);
  assert.equal(parsed.anomalyMetrics.find(s => s.metric === 'anomaly_flag')?.points[0].value, 0.25);
  assert.equal(parsed.anomalyMetrics.find(s => s.metric === 'anomaly_raw_flag')?.points[0].value, 0.75);
  assert.equal(parsed.conntrack.length, 3);
  assert.equal(parsed.conntrack[0].measurement, 'conntrack_total');
  assert.equal(parsed.conntrack[0].points[0].value, 12.5);
  assert.equal(parsed.conntrack[1].points[0].value, 0);
  assert.notEqual(parsed.conntrack[0].id, parsed.conntrack[2].id);
  assert.throws(() => parseEagleAnnotatedCsv(csv.replace(',0.75,hardware_metrics', ',NaN,hardware_metrics')), InfluxSourceError);
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
  assert.match(flux, /device_serial"\] == "R95VA4GP000041"/);
  assert.match(flux, /keep\(columns: \["_time", "_value", "metric"\]\)/);
});

test('applies the selected device serial to every query and returns its identity', async () => {
  let requestBody = '';
  const source = new InfluxSource({
    token: 'test-token',
    fetchImpl: async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(ANNOTATED_CSV);
    },
    now: () => NOW,
  });

  const result = await source.queryAnomalies({
    start: '-1h',
    deviceSerial: 'gateway-a',
  });

  assert.equal((requestBody.match(/device_serial"\] == "gateway-a"/g) ?? []).length, 5);
  assert.doesNotMatch(requestBody, /R95VA4GP000041|\$\{Device\}/);
  assert.equal(result.source.deviceSerial, 'gateway-a');
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
  for (const deviceSerial of ['${Device}', 'x" |> yield()', 'a\nb', 'a'.repeat(129), ['a', 'b']]) {
    assert.equal((await errorOf(source.queryAnomalies({ deviceSerial }))).kind, 'validation');
  }
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
