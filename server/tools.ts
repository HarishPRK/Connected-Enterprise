import type Anthropic from '@anthropic-ai/sdk';

/**
 * Tools the agent can call. Read tools are mocked locally for demo purposes
 * — they return realistic data drawn from the same world the UI uses.
 *
 * The single write tool (force_dhcp_renew) is intentionally guarded: it
 * returns an error telling the agent to call request_human_approval first.
 * That + the system prompt + the UI's approval gate are the safety layers.
 */
export const tools: Anthropic.Messages.Tool[] = [
  {
    name: 'get_device',
    description: 'Read the current state of a device by id (e.g. "DL-2-Server", "POS-02").',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Device id' } },
      required: ['id'],
    },
  },
  {
    name: 'query_alerts',
    description: 'Query alerts in a time window for a branch.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start time (ISO or HH:MM)' },
        to: { type: 'string', description: 'End time' },
        branchId: { type: 'string' },
      },
      required: ['from', 'to', 'branchId'],
    },
  },
  {
    name: 'check_probe',
    description: 'Probe an IP from the gateway (ping). Returns reachability + RTT.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'IP or hostname' },
        count: { type: 'number', description: 'Number of pings (default 5)' },
      },
      required: ['target'],
    },
  },
  {
    name: 'get_dhcp_leases',
    description: 'Read the DHCP lease table for a VLAN.',
    input_schema: {
      type: 'object',
      properties: { vlan: { type: 'number' } },
      required: ['vlan'],
    },
  },
  {
    name: 'get_wan_status',
    description: 'Get current WAN active/standby state and recent failover history.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_wifi_client',
    description: 'Read Wi-Fi client state for a MAC: RSSI, retries, channel, neighbors.',
    input_schema: {
      type: 'object',
      properties: { mac: { type: 'string' } },
      required: ['mac'],
    },
  },
  {
    name: 'request_human_approval',
    description:
      'Request explicit human approval for a destructive/write action. ' +
      'Call this BEFORE any write tool that modifies an OT device, gateway, ' +
      'or policy. The UI will pause and surface the request. Returns immediately ' +
      'with status "pending" — agent should stop and wait.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'What you want to do, in plain English' },
        tool:   { type: 'string', description: 'Name of the write tool you intend to call' },
        args:   { type: 'object', description: 'Arguments you intend to pass' },
        risk:   { type: 'string', enum: ['low', 'medium', 'high'] },
        reason: { type: 'string', description: 'Why this needs human approval' },
      },
      required: ['action', 'tool', 'args', 'risk', 'reason'],
    },
  },
  {
    name: 'force_dhcp_renew',
    description:
      'WRITE TOOL: Force a DHCP lease renewal for a device. Will briefly disrupt the device. ' +
      'You MUST have called request_human_approval and received approval before calling this. ' +
      'Otherwise this returns an error.',
    input_schema: {
      type: 'object',
      properties: {
        device: { type: 'string' },
        vlan:   { type: 'number' },
      },
      required: ['device'],
    },
  },
];

/* ───── Mock implementations ─────
 * In production these would hit the actual gateway control plane / telemetry
 * pipeline. For the demo they return realistic-looking data so the agent's
 * reasoning has real ground truth to chain on. */

const mockLatencyMs = () => 200 + Math.random() * 800;

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  approvedActions: Set<string>,
): Promise<unknown> {
  // Simulate network latency
  await new Promise((r) => setTimeout(r, mockLatencyMs()));

  switch (name) {
    case 'get_device': {
      const id = String(args.id ?? '');
      if (id.startsWith('DL-2')) {
        return {
          status: 'offline', last_seen: '02:14:31', ip: '10.20.1.32',
          mac: 'BB:11:22:33:44:06', arp: 'incomplete',
          domain: 'OT', kind: 'door_lock',
        };
      }
      if (id === 'POS-02') {
        return {
          status: 'online_unstable', ip: '10.10.1.42',
          mac: 'AA:11:22:33:44:5A', conn: 'wifi',
          loss_pct_5m: 8.4, last_seen: 'now',
        };
      }
      return { status: 'online', ip: '10.10.1.x', last_seen: 'now' };
    }

    case 'query_alerts': {
      return [
        { type: 'fiber_flap', at: '02:14:03', duration_s: 19, recovery: '02:14:22' },
      ];
    }

    case 'check_probe': {
      const target = String(args.target ?? '');
      if (target.startsWith('10.20.')) {
        return { reachable: false, since: '02:14:22', arp: 'incomplete', retries: 5 };
      }
      return { reachable: true, rtt_ms: 4 + Math.round(Math.random() * 6), packets: '5/5' };
    }

    case 'get_dhcp_leases': {
      const vlan = Number(args.vlan ?? 0);
      if (vlan === 20) {
        return { 'DL-2': { lease: 'EXPIRED 02:14:22', state: 'abandoned' } };
      }
      return { leases: 'normal' };
    }

    case 'get_wan_status': {
      return {
        active: 'Fiber', primary: 'Fiber', standby: '5G',
        last_flip: '02:14:22',
        recent_flaps_24h: 1,
      };
    }

    case 'get_wifi_client': {
      return {
        rssi: -78, retries_pct: 31, channel: 36, ssid: 'CE-Corp',
        neighbors: 9, roams_5m: 14,
      };
    }

    case 'request_human_approval': {
      // Mark this action as one that has been requested, for the write-tool gate.
      const key = `${args.tool}:${JSON.stringify(args.args ?? {})}`;
      approvedActions.add(`PENDING:${key}`);
      return {
        status: 'pending',
        message: 'Approval request created. UI will surface to operator. Stop and await response.',
      };
    }

    case 'force_dhcp_renew': {
      const key = `force_dhcp_renew:${JSON.stringify(args)}`;
      if (!approvedActions.has(`APPROVED:${key}`)) {
        return {
          ok: false,
          error: 'BLOCKED: this action requires prior human approval via request_human_approval.',
        };
      }
      return {
        ok: true,
        lease: { ip: '10.20.1.32', expires: new Date(Date.now() + 86_400_000).toISOString() },
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
