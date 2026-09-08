type RecordValue = Record<string, unknown>;

export type InsightTopic =
  | 'it-devices'
  | 'ot-devices'
  | 'connectivity'
  | 'fleet'
  | 'app-routing';

export interface LiveInsightOptions {
  minimumResponseMs?: number;
}

function asRecord(value: unknown): RecordValue | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function asRecords(value: unknown): RecordValue[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is RecordValue => item != null)
    : [];
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safe(value: unknown): string {
  return String(value ?? 'not reported').replaceAll('`', "'");
}

function code(value: unknown): string {
  return `\`${safe(value)}\``;
}

function count(value: unknown): number {
  return Math.max(0, Math.round(number(value) ?? 0));
}

function fmt(value: number, digits = 1): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function bullet(value: string): string {
  return `- ${value}`;
}

function deviceInsight(topic: 'it-devices' | 'ot-devices', data: unknown): string {
  const root = asRecord(data) ?? {};
  const counts = asRecord(root.counts) ?? {};
  const devices = asRecords(root.devices);
  const total = number(root.total) ?? devices.length;
  const healthy = number(counts.ok) ?? devices.filter((device) => device.status === 'ok').length;
  const degraded = number(counts.warn) ?? devices.filter((device) => device.status === 'warn').length;
  const offline = number(counts.err) ?? devices.filter((device) => device.status === 'err').length;
  const attention = devices.filter((device) => device.status === 'warn' || device.status === 'err');
  const byConnection = new Map<string, number>();
  for (const device of devices) {
    const connection = string(device.conn) ?? 'not reported';
    byConnection.set(connection, (byConnection.get(connection) ?? 0) + 1);
  }
  const connectionMix = [...byConnection.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, value]) => `${name} ${value}`)
    .join(', ') || 'not reported';
  const critical = attention
    .slice()
    .sort((a, b) => (a.status === 'err' ? -1 : 1) - (b.status === 'err' ? -1 : 1))
    .slice(0, 3)
    .map((device) => `${code(string(device.name) ?? string(device.id) ?? 'unnamed')} (${safe(device.status)})`)
    .join(', ');
  const label = topic === 'ot-devices' ? 'OT inventory' : 'IT inventory';

  return [
    bullet(`**${label}:** ${count(total)} total; ${count(healthy)} healthy, ${count(degraded)} degraded, ${count(offline)} offline.`),
    bullet(critical
      ? `**Priority:** ${critical}${attention.length > 3 ? `; ${attention.length - 3} more need review` : ''}.`
      : '**Priority:** No reported devices currently need attention.'),
    bullet(`**Connection mix:** ${connectionMix}.`),
  ].join('\n');
}

function linkSummary(name: string, value: unknown): string {
  const link = asRecord(value);
  if (!link) return `${name} not reported`;
  const status = string(link.status) ?? (link.linkUp === true || link.link_up === true ? 'up' : link.linkUp === false || link.link_up === false ? 'down' : 'unknown');
  const latency = number(link.latencyMs) ?? number(link.latency_ms);
  const loss = number(link.lossPct) ?? number(link.loss_percent);
  const parts = [status, latency == null ? undefined : `${fmt(latency)} ms`, loss == null ? undefined : `${fmt(loss)}% loss`].filter(Boolean);
  if (name === 'Fiber') {
    const optical = number(link.opticalRxDbm);
    const errors = number(link.fcsErrorsLastHour);
    const speed = number(link.linkSpeedMbps);
    const fiberParts = [
      optical == null ? undefined : `${fmt(optical)} dBm optical RX`,
      errors == null ? undefined : `${count(errors)} FCS errors/h`,
      speed == null ? undefined : `${fmt(speed)} Mbps link`,
    ].filter(Boolean);
    if (fiberParts.length > 0) return `${name} ${fiberParts.join(', ')}`;
  }
  if (name === '5G') {
    const rssi = number(link.rssiDbm);
    const sinr = number(link.sinrDb);
    const carrier = string(link.carrier);
    const radioParts = [
      rssi == null ? undefined : `${fmt(rssi)} dBm RSSI`,
      sinr == null ? undefined : `${fmt(sinr)} dB SINR`,
      carrier,
    ].filter(Boolean);
    if (radioParts.length > 0) return `${name} ${radioParts.join(', ')}`;
  }
  return `${name} ${parts.join(', ')}`;
}

function connectivityInsight(data: unknown): string {
  const root = asRecord(data) ?? {};
  const probes = asRecords(root.reachabilityProbes);
  const events = asRecords(root.recentEvents);
  const dns = asRecord(root.dnsStats) ?? {};
  const probeAverage = number(root.probeSuccessAvgPct);
  const failedProbes = probes.filter((probe) => {
    const success = number(probe.successPct);
    return probe.reachable === false || (success != null && success < 100);
  });
  const severeEvents = events.filter((event) => event.severity === 'warn' || event.severity === 'err');
  const dnsFailures = number(dns.totalFailures);
  const dnsLookups = number(dns.totalLookups);
  const nat = number(root.natUtilizationPct);

  return [
    bullet(`**WAN:** ${linkSummary('Fiber', root.fiber)}; ${linkSummary('5G', root.fiveG)}.`),
    bullet(`**Reachability:** ${probeAverage == null ? 'average not reported' : `${fmt(probeAverage)}% average`}; ${failedProbes.length} of ${probes.length} probes show impairment.`),
    bullet(`**Services:** DNS ${dnsFailures == null ? 'failures not reported' : `${count(dnsFailures)} failures${dnsLookups == null ? '' : ` across ${count(dnsLookups)} lookups`}`}; NAT ${nat == null ? 'not reported' : `${fmt(nat)}%`}; ${severeEvents.length} recent warnings/errors.`),
  ].join('\n');
}

function fleetInsight(data: unknown): string {
  const root = asRecord(data) ?? {};
  const fleet = asRecord(root.totals) ?? asRecord(root.fleet) ?? {};
  const branches = asRecords(root.branches).length > 0
    ? asRecords(root.branches)
    : asRecords(root.comparedBranches);
  const total = number(fleet.branches) ?? branches.length;
  const healthy = number(fleet.healthy) ?? number(fleet.healthyBranches) ?? branches.filter((branch) => branch.status === 'ok').length;
  const alerts = number(fleet.alerts) ?? number(fleet.openAlerts) ?? branches.reduce((sum, branch) => sum + (number(branch.openAlerts) ?? 0), 0);
  const uptime = number(fleet.avgUptime) ?? number(fleet.avgUptimePct);
  const throughput = number(fleet.throughput) ?? number(fleet.totalThroughputMbps);
  const riskiest = branches
    .slice()
    .sort((a, b) => {
      const alertDifference = (number(b.openAlerts) ?? 0) - (number(a.openAlerts) ?? 0);
      return alertDifference || (number(a.healthScore) ?? 100) - (number(b.healthScore) ?? 100);
    })[0];
  const riskName = string(riskiest?.name) ?? string(riskiest?.id);
  const riskDetails = riskiest
    ? [
        number(riskiest.openAlerts) == null ? undefined : `${count(riskiest.openAlerts)} alerts`,
        number(riskiest.healthScore) == null ? undefined : `health ${fmt(number(riskiest.healthScore) ?? 0)}`,
        number(riskiest.uptimePct) == null ? undefined : `${fmt(number(riskiest.uptimePct) ?? 0, 2)}% uptime`,
      ].filter(Boolean).join(', ')
    : '';

  return [
    bullet(`**Fleet posture:** ${count(healthy)} of ${count(total)} branches healthy; ${count(alerts)} open alerts.`),
    bullet(riskName ? `**Highest priority:** ${code(riskName)} — ${riskDetails || 'review reported branch status'}.` : '**Highest priority:** No branch-level detail was reported.'),
    bullet(`**Operations:** ${uptime == null ? 'uptime not reported' : `${fmt(uptime, 2)}% average uptime`}; ${throughput == null ? 'throughput not reported' : `${fmt(throughput)} Mbps aggregate throughput`}.`),
  ].join('\n');
}

function routingInsight(data: unknown): string {
  const root = asRecord(data) ?? {};
  const totals = asRecord(root.totals) ?? {};
  const policies = asRecords(root.policies);
  const categories = asRecords(root.categories);
  const enabled = number(totals.enabled) ?? policies.filter((policy) => policy.enabled === true).length;
  const realtime = number(totals.realtime) ?? policies.filter((policy) => policy.slaClass === 'realtime').length;
  const disabled = policies.filter((policy) => policy.enabled === false);
  const exposed = policies.filter((policy) => {
    const sla = string(policy.slaClass)?.toLowerCase();
    const preferred = string(policy.preferredPath)?.toLowerCase();
    return policy.enabled === true && sla === 'realtime' && preferred !== 'fiber';
  });
  const topCategory = categories
    .slice()
    .sort((a, b) => (number(b.trafficSharePct) ?? 0) - (number(a.trafficSharePct) ?? 0))[0];
  const topCategoryName = string(topCategory?.name) ?? string(topCategory?.id);
  const topCategoryShare = number(topCategory?.trafficSharePct);

  return [
    bullet(`**Policy coverage:** ${count(enabled)} enabled; ${count(realtime)} real-time; ${disabled.length} disabled.`),
    bullet(exposed.length > 0
      ? `**SLA review:** ${exposed.slice(0, 3).map((policy) => code(string(policy.app) ?? 'unnamed')).join(', ')} are real-time without Fiber preference.`
      : '**SLA alignment:** All enabled real-time policies prefer Fiber.'),
    bullet(topCategoryName
      ? `**Traffic mix:** ${code(topCategoryName)} leads at ${topCategoryShare == null ? 'an unreported share' : `${fmt(topCategoryShare)}%`}.`
      : '**Traffic mix:** Category shares were not reported.'),
  ].join('\n');
}

export function formatPageInsight(topic: InsightTopic, data: unknown): string {
  switch (topic) {
    case 'it-devices':
    case 'ot-devices':
      return deviceInsight(topic, data);
    case 'connectivity':
      return connectivityInsight(data);
    case 'fleet':
      return fleetInsight(data);
    case 'app-routing':
      return routingInsight(data);
  }
}

export function formatIpsecInsight(snapshot: unknown, now = Date.now()): string {
  const root = asRecord(snapshot) ?? {};
  const gateways = Object.values(asRecord(root.gateways) ?? {}).map(asRecord).filter((item): item is RecordValue => item != null);
  const connected = root.connected === true;
  if (gateways.length === 0) {
    return [
      bullet(`**Telemetry:** No gateway snapshot has arrived; source connection is ${connected ? 'up' : 'down'}.`),
      bullet('**IPsec health:** Tunnel reachability cannot be evaluated without a gateway sample.'),
      bullet('**Next check:** Confirm the gateway telemetry publisher and subscription are active.'),
    ].join('\n');
  }

  const observations = gateways.map((state) => {
    const metrics = asRecord(state.metrics) ?? {};
    const gateway = asRecord(metrics.gateway) ?? {};
    const wan = asRecord(metrics.wan) ?? {};
    const tunnels = asRecords(metrics.tunnels);
    return { state, metrics, gateway, wan, tunnels };
  });
  const allTunnels = observations.flatMap((item) => item.tunnels);
  const unavailable = allTunnels.filter((tunnel) => tunnel.present === false || tunnel.reachable === false);
  const impaired = allTunnels.filter((tunnel) => (number(tunnel.latency_ms) ?? 0) > 150 || (number(tunnel.loss_percent) ?? 0) > 3);
  const stale = observations.filter((item) => now - (number(item.state.receivedAt) ?? 0) > 90_000);
  const active = observations.map((item) => {
    const name = string(item.gateway.name) ?? 'gateway';
    return `${code(name)} → ${code(string(item.metrics.active_tunnel) ?? 'not reported')}`;
  }).join(', ');
  const wanDown = observations.filter((item) => item.wan.link_up === false);

  return [
    bullet(`**Active paths:** ${active}; ${wanDown.length} of ${observations.length} WAN links reported down.`),
    bullet(unavailable.length > 0
      ? `**Tunnel health:** ${unavailable.length} of ${allTunnels.length} unavailable — ${unavailable.slice(0, 3).map((tunnel) => code(string(tunnel.ifname) ?? 'unnamed')).join(', ')}.`
      : `**Tunnel health:** All ${allTunnels.length} reported tunnels are present and reachable.`),
    bullet(`**Quality/freshness:** ${impaired.length} tunnels exceed 150 ms or 3% loss; ${stale.length} gateway samples are older than 90 seconds.`),
  ].join('\n');
}

export async function waitForResponseWindow(
  startedAt: number,
  options: LiveInsightOptions = {},
  defaultMinimumMs = 1_350,
): Promise<void> {
  const minimumResponseMs = Math.max(0, options.minimumResponseMs ?? defaultMinimumMs);
  const remaining = minimumResponseMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}
