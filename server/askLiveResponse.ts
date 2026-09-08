import { executeTool } from './tools.js';

type LiveResponseIntent = 'wan' | 'devices' | 'both' | 'unsupported';
type RecordValue = Record<string, unknown>;

export interface LiveAskOptions {
  messages: { role: 'user' | 'assistant'; content: string }[];
  branchId: string;
  emit: (event: string, data: Record<string, unknown>) => void;
  /** Test-only override. Production uses an intent-sized minimum so the UI's
   * telemetry-reading state remains visible instead of flashing. */
  minimumResponseMs?: number;
}

export type AskLiveToolRunner = (
  name: 'get_live_branch_wan' | 'get_live_branch_devices',
  branchId: string,
) => Promise<unknown>;

const WAN_TERMS = /\b(wan|ipsec|tunnels?|failover|failback|cellular|modem|5g|fiber|latency|packet\s+loss|loss|rx|tx|throughput|uplink|internet|paths?|link)\b/i;
const DEVICE_TERMS = /\b(devices?|clients?|inventory|wi-?fi|endpoints?|laptops?|desktops?|printers?|phones?|tablets?|sensors?|cameras?|locks?|matter|shelly|\bot\b|\bit\b)\b/i;
const COMBINED_TERMS = /\b(fresh|freshness|telemetry|overall|all\s+systems?|everything|environment|site|branch)\b/i;
const INCIDENT_TERMS = /\b(alerts?|incidents?)\b/i;
const GENERIC_OPERATIONAL_TERMS = /\b(any|active|open|current|right\s+now|status|state|health|healthy|degraded|offline|unreachable|attention|problem|issues?)\b/i;

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

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function code(value: unknown): string {
  return `\`${String(value ?? 'not reported').replaceAll('`', "'")}\``;
}

function availabilityLabel(value: unknown): string {
  return text(value)?.replaceAll('_', ' ') ?? 'unknown';
}

function ageLabel(value: unknown): string | undefined {
  const seconds = number(value);
  if (seconds == null) return undefined;
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
}

export function classifyLiveIntent(question: string): LiveResponseIntent {
  const wantsWan = WAN_TERMS.test(question);
  const wantsDevices = DEVICE_TERMS.test(question);
  const wantsCombined = COMBINED_TERMS.test(question);
  const wantsCurrentIncidents = INCIDENT_TERMS.test(question) && GENERIC_OPERATIONAL_TERMS.test(question);

  if ((wantsWan && wantsDevices) || (wantsCombined && !wantsWan && !wantsDevices)) return 'both';
  if (wantsWan) return 'wan';
  if (wantsDevices) return 'devices';
  if (wantsCombined || wantsCurrentIncidents || GENERIC_OPERATIONAL_TERMS.test(question)) return 'both';
  return 'unsupported';
}

export function formatLiveWanAnswer(result: unknown): string {
  const root = asRecord(result);
  if (!root) {
    return '**WAN/IPsec:** Live telemetry could not be read. (source: `get_live_branch_wan`)';
  }

  const branch = asRecord(root.branch);
  const source = asRecord(root.source);
  const branchName = text(branch?.name) ?? text(branch?.id) ?? 'selected branch';
  const availability = availabilityLabel(root.availability);

  if (root.live !== true) {
    const details = [
      `status ${code(availability)}`,
      ageLabel(source?.age_seconds) ? `last complete sample ${ageLabel(source?.age_seconds)}` : undefined,
      source?.mqtt_connected === false ? 'MQTT disconnected' : undefined,
      text(source?.last_error) ? 'the source reported an error' : undefined,
    ].filter(Boolean);
    return `**WAN/IPsec — ${branchName}:** No fresh live sample is available (${details.join('; ')}). (source: \`get_live_branch_wan\`)`;
  }

  const gateways = asRecords(root.gateways);
  if (gateways.length === 0) {
    return `**WAN/IPsec — ${branchName}:** The feed is live but no gateway was reported. (source: \`get_live_branch_wan\`)`;
  }

  const sections = gateways.slice(0, 4).map((gateway) => {
    const name = text(gateway.name) ?? text(gateway.mac) ?? 'Gateway';
    const wan = asRecord(gateway.wan);
    const tunnels = asRecords(gateway.tunnels);
    const cellular = asRecord(gateway.cellular);
    const wanState = wan?.link_up === true ? 'up' : wan?.link_up === false ? 'down' : 'not reported';
    const rx = number(wan?.rx_mbps);
    const tx = number(wan?.tx_mbps);
    const rates = rx == null && tx == null
      ? 'rates not reported'
      : `RX ${rx == null ? 'not reported' : `${rx.toFixed(2)} Mbps`}, TX ${tx == null ? 'not reported' : `${tx.toFixed(2)} Mbps`}`;
    const tunnelDetails = tunnels.length > 0
      ? tunnels.map((tunnel) => {
        const state = tunnel.present === false
          ? 'not present'
          : tunnel.reachable === false
            ? 'unreachable'
            : tunnel.reachable === true
              ? 'reachable'
              : 'reachability unknown';
        const observations = [
          number(tunnel.latency_ms) == null ? undefined : `${number(tunnel.latency_ms)} ms`,
          number(tunnel.loss_percent) == null ? undefined : `${number(tunnel.loss_percent)}% loss`,
        ].filter(Boolean);
        return `${code(text(tunnel.interface) ?? 'unnamed')} ${state}${observations.length ? ` (${observations.join(', ')})` : ''}`;
      }).join('; ')
      : 'none reported';
    const unhealthyTunnels = tunnels.filter((tunnel) => tunnel.present === false || tunnel.reachable === false);
    const tunnelSummary = unhealthyTunnels.length === 0
      ? 'all reported tunnels are reachable'
      : `${unhealthyTunnels.length} tunnel${unhealthyTunnels.length === 1 ? '' : 's'} need attention`;
    const cellularSummary = cellular
      ? [
        cellular.available === true ? 'available' : cellular.available === false ? 'unavailable' : undefined,
        text(cellular.health),
        text(cellular.registration_state) ? `registration ${text(cellular.registration_state)}` : undefined,
        cellular.bearer_connected === true ? 'bearer connected' : cellular.bearer_connected === false ? 'bearer disconnected' : undefined,
        number(cellular.rssi_dbm) == null ? undefined : `RSSI ${number(cellular.rssi_dbm)} dBm`,
        number(cellular.snr_db) == null ? undefined : `SNR ${number(cellular.snr_db)} dB`,
      ].filter(Boolean).join(', ') || 'reported without health details'
      : 'not reported';

    return [
      `**${name}**`,
      `- WAN ${code(text(wan?.interface) ?? 'interface')}: **${wanState}**; ${rates}`,
      `- Active tunnel: ${code(text(gateway.active_tunnel) ?? 'none reported')}`,
      `- Tunnel health: **${tunnelSummary}** — ${tunnelDetails}`,
      `- Cellular: ${cellularSummary}`,
    ].join('\n');
  });

  const extra = gateways.length > 4 ? `\n- ${gateways.length - 4} additional gateways omitted.` : '';
  return `**WAN/IPsec — ${branchName}**\n\n${sections.join('\n\n')}${extra}\n\n(source: \`get_live_branch_wan\`)`;
}

function deviceTelemetrySummary(device: RecordValue): string | undefined {
  const telemetry = asRecord(device.telemetry);
  const details = [
    number(telemetry?.rssiDbm) == null ? undefined : `RSSI ${number(telemetry?.rssiDbm)} dBm`,
    number(telemetry?.snrDb) == null ? undefined : `SNR ${number(telemetry?.snrDb)} dB`,
    number(telemetry?.rxMbps) == null ? undefined : `RX ${number(telemetry?.rxMbps)?.toFixed(2)} Mbps`,
    number(telemetry?.txMbps) == null ? undefined : `TX ${number(telemetry?.txMbps)?.toFixed(2)} Mbps`,
    number(telemetry?.apowerW) == null ? undefined : `${number(telemetry?.apowerW)?.toFixed(1)} W`,
    number(telemetry?.tempC) == null ? undefined : `${number(telemetry?.tempC)?.toFixed(1)} °C`,
    text(telemetry?.wifiHealth),
    device.power_on === true ? 'power on' : device.power_on === false ? 'power off' : undefined,
  ].filter(Boolean);
  return details.length ? details.join(', ') : undefined;
}

export function formatLiveDeviceAnswer(result: unknown): string {
  const root = asRecord(result);
  if (!root) {
    return '**Devices:** Live inventory could not be read. (source: `get_live_branch_devices`)';
  }

  const branch = asRecord(root.branch);
  const source = asRecord(root.source);
  const branchName = text(branch?.name) ?? text(branch?.id) ?? 'selected branch';
  const availability = availabilityLabel(root.availability);

  if (root.live !== true) {
    const details = [
      `status ${code(availability)}`,
      ageLabel(source?.age_seconds) ? `last sample ${ageLabel(source?.age_seconds)}` : undefined,
      source?.mqtt_connected === false ? 'MQTT disconnected' : undefined,
    ].filter(Boolean);
    return `**Devices — ${branchName}:** No fresh live inventory is available (${details.join('; ')}). (source: \`get_live_branch_devices\`)`;
  }

  const counts = asRecord(root.counts);
  const attention = asRecords(root.devices_needing_attention);
  const countSummary = [
    `${number(counts?.total) ?? 0} total`,
    `${number(counts?.healthy) ?? 0} healthy`,
    `${number(counts?.warning) ?? 0} warning`,
    `${number(counts?.error) ?? 0} error`,
    `${number(counts?.offline) ?? 0} offline`,
  ].join(', ');
  const attentionLines = attention.length === 0
    ? ['- No devices currently need attention.']
    : attention.slice(0, 8).map((device) => {
      const name = text(device.name) ?? text(device.id) ?? 'Unnamed device';
      const identity = [text(device.domain), text(device.kind), text(device.status)].filter(Boolean).join(' · ');
      const endpoint = [text(device.ip), text(device.connection)].filter(Boolean).join(' · ');
      const telemetry = deviceTelemetrySummary(device);
      return `- **${name}** (${code(text(device.id) ?? 'unknown')}) — ${identity || 'status not reported'}${endpoint ? `; ${endpoint}` : ''}${telemetry ? `; ${telemetry}` : ''}`;
    });
  if (attention.length > 8) attentionLines.push(`- ${attention.length - 8} additional devices needing attention omitted.`);

  return `**Devices — ${branchName}:** ${countSummary}.\n${attentionLines.join('\n')}\n\n(source: \`get_live_branch_devices\`)`;
}

const defaultToolRunner: AskLiveToolRunner = async (name, branchId) => executeTool(
  name,
  {},
  new Set<string>(),
  { branchId },
);

/** Answer supported operational questions without an LLM. Every value comes
 * from the same request-time, branch-scoped tools used by the normal Ask AI
 * flow; unsupported questions are declined instead of being guessed. */
export async function runLiveTelemetryAnswer(
  opts: LiveAskOptions,
  runTool: AskLiveToolRunner = defaultToolRunner,
): Promise<void> {
  const { messages, branchId, emit } = opts;
  const startedAt = Date.now();
  const question = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const intent = classifyLiveIntent(question);
  const sections: string[] = [];
  const toolsUsed: string[] = [];

  if (intent === 'wan' || intent === 'both') {
    emit('tool_using', { tool: 'get_live_branch_wan', args: {} });
    toolsUsed.push('get_live_branch_wan');
    sections.push(formatLiveWanAnswer(await runTool('get_live_branch_wan', branchId)));
  }
  if (intent === 'devices' || intent === 'both') {
    emit('tool_using', { tool: 'get_live_branch_devices', args: {} });
    toolsUsed.push('get_live_branch_devices');
    sections.push(formatLiveDeviceAnswer(await runTool('get_live_branch_devices', branchId)));
  }

  const answer = intent === 'unsupported'
    ? 'I can answer questions about current WAN links, IPsec tunnels, failover, cellular connectivity, device health, and telemetry freshness. This read-only view does not include broader architecture or historical analysis.'
    : sections.join('\n\n');

  const defaultMinimumMs = intent === 'both' ? 1_600 : intent === 'unsupported' ? 800 : 1_100;
  const minimumResponseMs = Math.max(0, opts.minimumResponseMs ?? defaultMinimumMs);
  const remainingMs = minimumResponseMs - (Date.now() - startedAt);
  if (remainingMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingMs));

  emit('chunk', { text: answer });
  emit('done', { mode: 'live-telemetry', tools: toolsUsed });
}
