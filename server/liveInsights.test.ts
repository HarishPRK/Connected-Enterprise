import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatIpsecInsight,
  formatPageInsight,
  waitForResponseWindow,
} from './liveInsights.js';

describe('direct page insights', () => {
  it('summarizes device health and identifies devices needing attention', () => {
    const result = formatPageInsight('ot-devices', {
      total: 3,
      counts: { ok: 1, warn: 1, err: 1 },
      devices: [
        { id: 'sensor-1', name: 'Temperature Sensor', status: 'ok', conn: 'matter' },
        { id: 'lock-1', name: 'Loading Door', status: 'err', conn: 'matter' },
        { id: 'camera-1', name: 'Dock Camera', status: 'warn', conn: 'ethernet' },
      ],
    });

    assert.match(result, /3 total; 1 healthy, 1 degraded, 1 offline/);
    assert.match(result, /Loading Door/);
    assert.match(result, /matter 2/);
    assert.equal(result.split('\n').length, 3);
  });

  it('summarizes connectivity metrics without inventing status fields', () => {
    const result = formatPageInsight('connectivity', {
      fiber: { opticalRxDbm: -14.2, fcsErrorsLastHour: 4, linkSpeedMbps: 1000 },
      fiveG: { rssiDbm: -78, sinrDb: 14, carrier: 'Carrier' },
      reachabilityProbes: [{ successPct: 100 }, { successPct: 92 }],
      probeSuccessAvgPct: 96,
      dnsStats: { totalFailures: 2, totalLookups: 500 },
      natUtilizationPct: 22.5,
      recentEvents: [{ severity: 'warn' }],
    });

    assert.match(result, /-14\.2 dBm optical RX/);
    assert.match(result, /-78 dBm RSSI/);
    assert.match(result, /2 failures across 500 lookups/);
    assert.equal(result.split('\n').length, 3);
  });

  it('supports both fleet payload shapes used by the UI', () => {
    const fleetPage = formatPageInsight('fleet', {
      totals: { branches: 2, healthy: 1, alerts: 3, avgUptime: 99.4, throughput: 410 },
      branches: [
        { name: 'Plano', healthScore: 99, openAlerts: 0 },
        { name: 'McKinney', healthScore: 82, openAlerts: 3 },
      ],
    });
    const commandCenter = formatPageInsight('fleet', {
      fleet: { branches: 3, healthyBranches: 2, openAlerts: 1, avgUptimePct: 99.8, totalThroughputMbps: 700 },
      comparedBranches: [{ name: 'Plano', healthScore: 96, openAlerts: 1 }],
    });

    assert.match(fleetPage, /1 of 2 branches healthy/);
    assert.match(fleetPage, /`McKinney`/);
    assert.match(commandCenter, /2 of 3 branches healthy/);
  });

  it('flags real-time routing policies that are not fiber-preferred', () => {
    const result = formatPageInsight('app-routing', {
      totals: { enabled: 2, realtime: 1 },
      policies: [
        { app: 'Voice', slaClass: 'realtime', preferredPath: '5G', enabled: true },
        { app: 'Backups', slaClass: 'best-effort', preferredPath: 'Auto', enabled: true },
      ],
      categories: [{ name: 'Voice', trafficSharePct: 34 }],
    });

    assert.match(result, /`Voice` are real-time without Fiber preference/);
    assert.match(result, /leads at 34%/);
  });
});

describe('direct IPsec insight', () => {
  it('reports active paths and unreachable tunnels from the current snapshot', () => {
    const result = formatIpsecInsight({
      connected: true,
      gateways: {
        plano: {
          receivedAt: 2_000_000,
          metrics: {
            active_tunnel: 'vti-fiber1',
            gateway: { name: 'plano-gw' },
            wan: { link_up: true },
            tunnels: [
              { ifname: 'vti-fiber1', present: true, reachable: true, latency_ms: 18, loss_percent: 0 },
              { ifname: 'vti-cell1', present: true, reachable: false, latency_ms: 190, loss_percent: 8 },
            ],
          },
        },
      },
    }, 2_010_000);

    assert.match(result, /`plano-gw` → `vti-fiber1`/);
    assert.match(result, /1 of 2 unavailable/);
    assert.match(result, /1 tunnels exceed 150 ms or 3% loss/);
    assert.equal(result.split('\n').length, 3);
  });

  it('returns an actionable no-sample response', () => {
    const result = formatIpsecInsight({ connected: false, gateways: {} });
    assert.match(result, /No gateway snapshot has arrived/);
    assert.equal(result.split('\n').length, 3);
  });
});

it('keeps the loading state visible for the requested response window', async () => {
  const startedAt = Date.now();
  await waitForResponseWindow(startedAt, { minimumResponseMs: 25 });
  assert.ok(Date.now() - startedAt >= 20);
});

