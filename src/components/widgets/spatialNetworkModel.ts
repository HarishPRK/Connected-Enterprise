import type { Device, Status } from '../../types';

export const SPATIAL_WIDTH = 900;
export const SPATIAL_HEIGHT = 500;
export const GATEWAY = { x: 450, y: 255 } as const;

const MAX_DOMAIN_NODES = 60;
const statusPriority: Record<Status, number> = { err: 0, warn: 1, off: 2, ok: 3 };

export type SpatialNode = {
  device: Device;
  x: number;
  y: number;
  size: number;
  phase: number;
};

function compareIdentity(left: Device, right: Device): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function identityPhase(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/**
 * One bounded glyph per selected inventory device. Exceptions get admission
 * priority, but placement only uses identity so routine health and telemetry
 * updates cannot rearrange an unchanged selection. Counts and inspectors must
 * continue using the complete inventory, not this rendering subset.
 */
export function buildSpatialNodes(devices: readonly Device[]): SpatialNode[] {
  return (['IT', 'OT'] as const).flatMap((domain) => {
    const selected = devices.filter((device) => device.domain === domain)
      .sort((left, right) => statusPriority[left.status] - statusPriority[right.status]
        || compareIdentity(left, right))
      .slice(0, MAX_DOMAIN_NODES)
      .sort(compareIdentity);
    const count = selected.length;
    if (count === 0) return [];

    const columns = Math.min(6, Math.ceil(Math.sqrt(count * 1.3)));
    const rows = Math.ceil(count / columns);
    const centerX = domain === 'IT' ? 205 : 695;
    const towardGateway = domain === 'IT' ? 1 : -1;
    const horizontalGap = count <= 10 ? 80 : columns <= 4 ? 70 : 51;
    const preferredVerticalGap = count <= 10 ? 76 : count <= 18 ? 60 : count <= 36 ? 38 : 34;
    const verticalGap = Math.min(preferredVerticalGap, 282 / Math.max(1, rows - 1));
    const size = count <= 4 ? 56 : count <= 10 ? 48 : count <= 18 ? 40 : count <= 36 ? 30 : 26;

    return selected.map((device, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const rowSize = Math.min(columns, count - row * columns);
      const columnOffset = column - (rowSize - 1) / 2;
      const rowCurve = rows > 1 ? Math.sin(row / (rows - 1) * Math.PI) * 12 : 0;
      const rowStagger = row % 2 ? 10 : 0;
      const arc = rowSize > 1
        ? (columnOffset / ((rowSize - 1) / 2)) ** 2 * 8 - 4
        : 0;
      return {
        device,
        x: centerX + columnOffset * horizontalGap + (rowCurve + rowStagger) * towardGateway,
        y: 244 + (row - (rows - 1) / 2) * verticalGap + arc
          + columnOffset * horizontalGap * .05 * towardGateway,
        size,
        phase: identityPhase(device.id),
      };
    });
  });
}

function measuredRate(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * `active` permits schematic connection motion, not a claim of observed packets.
 * Unknown directions stay omitted; PHY link speeds and counters are not rates.
 * Only two measured zero directions establish an idle link. Offline gateways
 * and offline/inactive devices never animate, even with retained positive rates.
 */
export function getDeviceFlow(device: Device, online: boolean): {
  active: boolean;
  measured: boolean;
  rxMbps?: number;
  txMbps?: number;
} {
  const rxMbps = measuredRate(device.telemetry?.rxMbps);
  const txMbps = measuredRate(device.telemetry?.txMbps);
  return {
    active: online && (device.status === 'ok' || device.status === 'warn')
      && !(rxMbps === 0 && txMbps === 0),
    measured: rxMbps !== undefined || txMbps !== undefined,
    ...(rxMbps !== undefined ? { rxMbps } : {}),
    ...(txMbps !== undefined ? { txMbps } : {}),
  };
}

export function deviceLabel(device: Device): string {
  return device.name.trim() || device.mac.trim() || device.id;
}
