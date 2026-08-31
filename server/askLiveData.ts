import type { DeviceSnapshot, DeviceView } from './deviceSource.js';
import type { IpsecGatewayState } from '../src/types.js';

export const ASK_LIVE_STALE_MS = 90_000;

interface LiveBranchScope {
  name: string;
  source: 'rdk' | 'prpl';
  failoverTopic: string;
  wanTopic: string;
  deviceTopic: string;
}

const LIVE_BRANCHES: Record<string, LiveBranchScope> = {
  'b-pln-01': {
    name: 'Plano-01',
    source: 'rdk',
    failoverTopic: 'rdk/ipsec/metrics',
    wanTopic: 'rdk/ipsec/metrics',
    deviceTopic: 'rdk/ipsec/metrics',
  },
  'b-mck-03': {
    name: 'McKinney-03',
    source: 'prpl',
    failoverTopic: 'prpl/ipsec/metrics',
    wanTopic: 'prplhome/ipsec/metrics',
    deviceTopic: 'prplhome/ipsec/metrics',
  },
};

export interface IpsecLiveSnapshot {
  gateways: Record<string, IpsecGatewayState>;
  receivedAt: number;
  connected: boolean;
  lastError?: string;
}

function secondsSince(timestamp: number | undefined, now: number): number | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((now - timestamp) / 1_000));
}

function iso(timestamp: number | undefined): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function unavailableBranch(branchId: string | undefined) {
  return {
    availability: 'not_configured',
    live: false,
    branch_id: branchId ?? null,
    message: 'No live Connected Enterprise telemetry feed is mapped to this branch.',
  };
}

/** Build a compact, model-friendly view of the request-time WAN snapshot. */
export function buildLiveBranchWan(
  branchId: string | undefined,
  snapshot: IpsecLiveSnapshot,
  now = Date.now(),
) {
  const scope = branchId ? LIVE_BRANCHES[branchId] : undefined;
  if (!scope) return unavailableBranch(branchId);

  const failoverStates = Object.values(snapshot.gateways)
    .filter((state) => state.topic === scope.failoverTopic)
    .sort((a, b) => b.receivedAt - a.receivedAt);
  const wanStates = scope.wanTopic === scope.failoverTopic
    ? failoverStates
    : Object.values(snapshot.gateways)
      .filter((state) => state.topic === scope.wanTopic)
      .sort((a, b) => b.receivedAt - a.receivedAt);
  const failoverFreshest = failoverStates[0]?.receivedAt;
  const wanFreshest = wanStates[0]?.receivedAt;
  const failoverAgeSeconds = secondsSince(failoverFreshest, now);
  const wanAgeSeconds = secondsSince(wanFreshest, now);
  const stale = failoverAgeSeconds == null
    || wanAgeSeconds == null
    || failoverAgeSeconds * 1_000 > ASK_LIVE_STALE_MS
    || wanAgeSeconds * 1_000 > ASK_LIVE_STALE_MS;
  const availability = failoverStates.length === 0 || wanStates.length === 0
    ? 'waiting_for_data'
    : !snapshot.connected
      ? 'disconnected'
      : stale
        ? 'stale'
        : 'live';

  return {
    availability,
    live: availability === 'live',
    branch: { id: branchId, name: scope.name },
    source: {
      system: 'Connected Enterprise IPsec telemetry',
      failover_topic: scope.failoverTopic,
      wan_topic: scope.wanTopic,
      mqtt_connected: snapshot.connected,
      last_error: snapshot.lastError ?? null,
      observed_at: iso(
        failoverFreshest != null && wanFreshest != null
          ? Math.min(failoverFreshest, wanFreshest)
          : undefined,
      ),
      age_seconds: failoverAgeSeconds != null && wanAgeSeconds != null
        ? Math.max(failoverAgeSeconds, wanAgeSeconds)
        : null,
      failover_observed_at: iso(failoverFreshest),
      failover_age_seconds: failoverAgeSeconds,
      wan_observed_at: iso(wanFreshest),
      wan_age_seconds: wanAgeSeconds,
      stale_after_seconds: ASK_LIVE_STALE_MS / 1_000,
      queried_at: new Date(now).toISOString(),
    },
    gateways: failoverStates.map((state) => {
      const { metrics } = state;
      const cellular = metrics.cellular;
      const identity = (metrics.gateway.mac || metrics.gateway.name).toLowerCase();
      const wanState = scope.wanTopic === scope.failoverTopic
        ? state
        : wanStates.find((candidate) => {
          const candidateIdentity = (
            candidate.metrics.gateway.mac || candidate.metrics.gateway.name
          ).toLowerCase();
          return identity.length > 0 && candidateIdentity === identity;
        }) ?? wanStates[0];
      const wanMetrics = wanState?.metrics.wan;
      return {
        name: metrics.gateway.name,
        mac: metrics.gateway.mac,
        primary_wan_ip: metrics.gateway.prim_wan_ip,
        secondary_wan_ip: metrics.gateway.sec_wan_ip,
        observed_at: iso(state.receivedAt),
        age_seconds: secondsSince(state.receivedAt, now),
        stale: now - state.receivedAt > ASK_LIVE_STALE_MS,
        active_tunnel: metrics.active_tunnel,
        tunnel_count: metrics.tunnel_count,
        tunnels: metrics.tunnels.map((tunnel) => ({
          interface: tunnel.ifname,
          present: tunnel.present,
          reachable: tunnel.reachable,
          latency_ms: tunnel.latency_ms,
          loss_percent: tunnel.loss_percent,
        })),
        wan: {
          source_topic: scope.wanTopic,
          source_gateway: wanState?.metrics.gateway.name ?? null,
          observed_at: iso(wanState?.receivedAt),
          age_seconds: secondsSince(wanState?.receivedAt, now),
          stale: wanState ? now - wanState.receivedAt > ASK_LIVE_STALE_MS : true,
          interface: wanMetrics?.ifname ?? null,
          link_up: wanMetrics?.link_up ?? null,
          rx_mbps: wanState?.wanRate?.rxMbps ?? null,
          tx_mbps: wanState?.wanRate?.txMbps ?? null,
          rate_observed_at: iso(wanState?.wanRate?.observedAt),
        },
        cellular: cellular ? {
          available: cellular.available,
          health: cellular.health,
          modem_state: cellular.modem?.state ?? null,
          registration_state: cellular.modem?.registration_state ?? null,
          signal_quality_percent: cellular.modem?.signal_quality_percent ?? null,
          bearer_connected: cellular.bearer?.connected ?? null,
          rssi_dbm: cellular.radio?.rssi_dbm ?? null,
          rsrp_dbm: cellular.radio?.rsrp_dbm ?? null,
          snr_db: cellular.radio?.snr_db ?? null,
        } : null,
      };
    }),
  };
}

function belongsToBranch(device: DeviceView, scope: LiveBranchScope): boolean {
  if (device.locationSource !== scope.source) return false;
  if (device.inventoryTopics?.length) return device.inventoryTopics.includes(scope.deviceTopic);
  return true;
}

function modelDevice(device: DeviceView) {
  return {
    id: device.id,
    name: device.name,
    domain: device.domain,
    kind: device.kind,
    status: device.status,
    ip: device.ip,
    mac: device.mac,
    connection: device.conn,
    connected_for_hours: device.connectedForHours,
    power_on: device.power ?? null,
    telemetry: device.telemetry ?? null,
    inventory_topics: device.inventoryTopics ?? [],
  };
}

/** Build a branch-scoped device result without ever falling back to seed data. */
export function buildLiveBranchDevices(
  branchId: string | undefined,
  snapshot: DeviceSnapshot,
  now = Date.now(),
  ipsecSnapshot?: IpsecLiveSnapshot,
) {
  const scope = branchId ? LIVE_BRANCHES[branchId] : undefined;
  if (!scope) return unavailableBranch(branchId);

  const devices = snapshot.source === 'gateway'
    ? snapshot.devices.filter((device) => belongsToBranch(device, scope))
    : [];
  const authoritativeTopicSeen = snapshot.inventoryTopicsSeen.includes(scope.deviceTopic);
  const branchFeedObservedAt = ipsecSnapshot
    ? Object.values(ipsecSnapshot.gateways)
      .filter((state) => state.topic === scope.deviceTopic)
      .reduce<number | undefined>(
        (latest, state) => latest == null || state.receivedAt > latest ? state.receivedAt : latest,
        undefined,
      )
    : undefined;
  const observedAt = branchFeedObservedAt ?? snapshot.lastInventoryAt;
  const ageSeconds = secondsSince(observedAt, now);
  const stale = ageSeconds == null || ageSeconds * 1_000 > ASK_LIVE_STALE_MS;
  const availability = snapshot.source !== 'gateway'
    ? 'waiting_for_live_inventory'
    : devices.length === 0 && !authoritativeTopicSeen
      ? 'waiting_for_branch_data'
      : !snapshot.connected
        ? 'disconnected'
        : stale
          ? 'stale'
          : 'live';
  const needsAttention = devices.filter((device) => device.status !== 'ok');

  return {
    availability,
    live: availability === 'live',
    branch: { id: branchId, name: scope.name },
    source: {
      system: 'Connected Enterprise device inventory',
      topic: scope.deviceTopic,
      coverage: authoritativeTopicSeen ? 'authoritative' : devices.length > 0 ? 'partial' : 'none',
      mqtt_connected: snapshot.connected,
      observed_at: iso(observedAt),
      age_seconds: ageSeconds,
      stale_after_seconds: ASK_LIVE_STALE_MS / 1_000,
      queried_at: new Date(now).toISOString(),
    },
    counts: {
      total: devices.length,
      healthy: devices.filter((device) => device.status === 'ok').length,
      warning: devices.filter((device) => device.status === 'warn').length,
      error: devices.filter((device) => device.status === 'err').length,
      offline: devices.filter((device) => device.status === 'off').length,
      needing_attention: needsAttention.length,
    },
    devices_needing_attention: needsAttention.map(modelDevice),
  };
}
