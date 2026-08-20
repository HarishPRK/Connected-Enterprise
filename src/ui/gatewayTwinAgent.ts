/**
 * Parent-window signal used to route CE's global Ctrl/Cmd+K shortcut into the
 * Gateway Twin iframe while the Digital Twin route is active.
 */
export const GATEWAY_TWIN_OPEN_AGENT_EVENT = 'ce:gateway-twin:open-agent';

export function requestGatewayTwinAgent(): void {
  window.dispatchEvent(new Event(GATEWAY_TWIN_OPEN_AGENT_EVENT));
}
