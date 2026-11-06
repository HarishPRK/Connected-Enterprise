import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Socket } from './OfferingConnectionPaths';
import { ETHERNET_PLUG_SCALE } from './OfferingEquipment';

export const CONNECTOR_PARTS = {
  socket: { at: [0, 0, -.006], size: [.12, .085, .028] },
  metal: { at: [0, 0, .016], size: [.084, .055, .065] },
  boot: { at: [0, 0, .065], size: [.072, .048, .055] },
  marker: { at: [0, .028, .052], size: [.048, .009, .024] },
} as const;
export type ConnectorPart = keyof typeof CONNECTOR_PARTS;

const scale = new Vector3(ETHERNET_PLUG_SCALE, ETHERNET_PLUG_SCALE, .55);
const localMatrices = Object.fromEntries(Object.entries(CONNECTOR_PARTS).map(([key, part]) => [key,
  new Matrix4().compose(new Vector3(...part.at), new Quaternion(), new Vector3(...part.size)),
])) as Record<ConnectorPart, Matrix4>;

/** A unit-box instance reproduces the original nested connector transforms,
 * including its nonuniform plug scale and the socket's surface normal. */
export function connectorFrame(socket: Socket) {
  return new Matrix4().compose(new Vector3(...socket.point),
    new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...socket.normal)), scale);
}

export function connectorPartMatrix(frame: Matrix4, part: ConnectorPart, target: Matrix4) {
  return target.multiplyMatrices(frame, localMatrices[part]);
}

export function packetRadius(wireless: boolean | undefined, point: Vector3, eye: Vector3) {
  return (wireless ? .072 : .045) * Math.min(1, Math.max(.05, point.distanceTo(eye) / 7));
}
