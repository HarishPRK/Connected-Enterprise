export type Vec = [number, number, number];
export interface EquipmentSpec { id: string; model: string; at: Vec; size: number; yaw?: number; }

export const PARTS: EquipmentSpec[] = [
  { id: 'hvac', model: 'HVAC', at: [-9, .05, -6], size: 2.65 },
  { id: 'cooler', model: 'Cooler', at: [-1.35, .03, -7.6], size: 3.05 },
  { id: 'cooler-right', model: 'Cooler', at: [1.25, .03, -7.6], size: 3.05 },
  { id: 'energy', model: 'SolarPanel', at: [-14.6, .03, -1.5], size: 3.45, yaw: .15 },
  { id: 'meter', model: 'Meter', at: [-9.1, 1.35, -9.35], size: .82 },
  { id: 'it', model: 'ServerRack', at: [10, .04, -6], size: 3.1 },
  { id: 'gateway', model: 'GatewayTwin', at: [6.45, 1.1, -3], size: 1.65, yaw: -Math.PI / 2 + .3 },
  { id: 'analytics', model: 'AnalyticsServer', at: [8.05, 1.1, -3], size: 1.4 },
  { id: 'fiber', model: 'FiberTerminal', at: [14.6, .04, -6], size: 2.05 },
  { id: '5g', model: 'CellularTower', at: [14.6, .04, 1.4], size: 5.15 },
  { id: 'sensor', model: 'Sensor', at: [-11.2, 1.55, -1.13], size: .67 },
  { id: 'thermostat', model: 'Thermostat', at: [-9.6, 1.5, -1.13], size: .74 },
  { id: 'lock', model: 'Lock', at: [-8.55, .9, -1.13], size: 1.05 },
  { id: 'light', model: 'Light', at: [-10.5, .03, 1.6], size: 2.5 },
  { id: 'ot', model: 'Sensor', at: [-7.55, 1.05, -6], size: .48, yaw: .6 },
  { id: 'pos', model: 'Laptop', at: [8, 1.15, 4.5], size: .75 },
  { id: 'voice', model: 'DeskPhone', at: [8, 1.15, 7], size: .5 },
  { id: 'camera', model: 'Camera', at: [4.8, 3.65, 7.9], size: .92, yaw: -.6 },
  { id: 'camera-back', model: 'Camera', at: [11.4, 3.6, -2.1], size: .85, yaw: -.85 },
];

// Source Gemtek model coordinates. The socket frame stays on its base while
// the shells and electronics separate. Camera orbit does not alter this assembly.
export const GATEWAY_EXPLODE: Record<string, Vec> = {
  GatewayHousingFront: [0, .18, 1.25], GatewayHousingBack: [0, .18, -1.25],
  GatewayCrown: [0, .66, 0], GatewayFrontPanel: [-.42, 0, 0],
  GatewayPorts: [0, 0, 0], GatewayBoard: [0, 0, .57],
  GatewayRadio: [0, 0, -.57], GatewayHeatsinkLeft: [0, 0, 1.06],
  GatewayAntennae: [0, .5, 0],
};
