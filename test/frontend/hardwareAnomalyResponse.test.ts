import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHardwareAnomalyResponse } from '../../src/ui/useHardwareAnomalies';

test('EA:GLE retains the selected device and fractional mean flags in the browser response', () => {
  const response = parseHardwareAnomalyResponse({
    source: { deviceSerial: 'gateway-b' }, points: [],
    anomalyMetrics: [{ id: 'raw', metric: 'anomaly_raw_flag', tags: { device_serial: 'gateway-b' }, points: [
      { time: '2026-11-10T12:00:00Z', value: 0.25 },
      { time: '2026-11-10T12:05:00Z', value: 0 },
    ] }],
    conntrack: [{ id: 'tcp', measurement: 'conntrack_tcp', tags: { device_serial: 'gateway-b' }, points: [
      { time: '2026-11-10T12:00:00Z', value: 12.5 },
    ] }],
  });
  assert.equal(response.source.deviceSerial, 'gateway-b');
  assert.equal(response.anomalyMetrics[0].points[0].value, 0.25);
  assert.equal(response.anomalyMetrics[0].points[1].value, 0);
  assert.equal(response.conntrack[0].points[0].value, 12.5);
});

test('EA:GLE tolerates old responses without the new series and excludes invalid mean samples', () => {
  assert.deepEqual(parseHardwareAnomalyResponse({ points: [] }).anomalyMetrics, []);
  const response = parseHardwareAnomalyResponse({ points: [], anomalyMetrics: [
    { id: 'invalid', metric: 'other', tags: {}, points: [] },
    { id: 'raw', metric: 'anomaly_raw_flag', tags: {}, points: [
      { time: 'bad', value: 1 }, { time: '2026-11-10T12:00:00Z', value: null },
    ] },
  ] });
  assert.equal(response.anomalyMetrics.length, 1);
  assert.deepEqual(response.anomalyMetrics[0].points, []);
});
