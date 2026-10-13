import type { ForceMode, PathCommand } from './pathOverrideController';

export interface FlowSwitchTunnel {
  ifname: string;
  present: boolean;
  reachable: boolean;
}

export interface FlowSwitchIntent {
  mode: Exclude<ForceMode, 'auto'>;
  command: Extract<PathCommand, 'tunnel1' | 'tunnel2' | 'tunnel3' | 'tunnel4'>;
  tunnel: string;
}

export interface FlowSwitchContext {
  mode: 'live' | 'target';
  tunnels: readonly FlowSwitchTunnel[];
  /** The illustrated route, including the latest immediate request. */
  activeTunnel: string;
  /** Only a request that is still pending; failed requests may be retried. */
  requestedTunnel?: string | null;
}

const COMMANDS = new Map<string, FlowSwitchIntent['command']>([
  ['xfrm1-fiber', 'tunnel1'], ['xfrm2-fiber', 'tunnel2'],
  ['xfrm1-cell', 'tunnel3'], ['xfrm2-cell', 'tunnel4'],
  ['vti1', 'tunnel1'], ['vti2', 'tunnel2'], ['vti3', 'tunnel3'], ['vti4', 'tunnel4'],
]);

/** Gateway commands identify fixed interfaces, never the payload's array order. */
export function tunnelSwitchIntent(ifname: string): FlowSwitchIntent | null {
  const command = COMMANDS.get(ifname);
  if (!command) return null;
  return { mode: command === 'tunnel1' || command === 'tunnel2' ? 'fiber' : '5g', command, tunnel: ifname };
}

/** Resolve again on drop so an old highlight cannot authorize an unavailable path. */
export function resolveFlowSwitch(nodeId: string, context: FlowSwitchContext): FlowSwitchIntent | null {
  if (context.mode !== 'live' || !nodeId.startsWith('tunnel:')) return null;
  const ifname = nodeId.slice('tunnel:'.length);
  const intent = tunnelSwitchIntent(ifname);
  if (!intent || ifname === context.activeTunnel || ifname === context.requestedTunnel) return null;
  const tunnel = context.tunnels.find((candidate) => candidate.ifname === ifname);
  if (!tunnel?.present || !tunnel.reachable) return null;
  // Two aliases for the same command in one payload do not provide an unambiguous target.
  if (context.tunnels.filter((candidate) => tunnelSwitchIntent(candidate.ifname)?.command === intent.command).length !== 1) return null;
  return intent;
}
