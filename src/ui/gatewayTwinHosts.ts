import type { DeviceView } from './useDevices';
import { matchesDeviceInventory } from './deviceInventory';

export type GatewayTwinHostKind =
  | 'phone'
  | 'laptop'
  | 'tv'
  | 'camera'
  | 'iot'
  | 'console'
  | 'tablet';

export type GatewayTwinLayer1 =
  | 'lan1'
  | 'lan2'
  | 'lan3'
  | 'wifi2'
  | 'wifi5'
  | 'wifi6';

/** Portable host-roster contract consumed by the embedded gateway twin. */
export interface GatewayTwinHost {
  id: string;
  path: string;
  name: string;
  kind: GatewayTwinHostKind;
  /** Effective classification, including persisted operator overrides. */
  domain: 'IT' | 'OT';
  layer1: GatewayTwinLayer1;
  rssiDbm: number | null;
  /** Current measured traffic rate in bits per second. */
  rxBps: number;
  /** Current measured traffic rate in bits per second. */
  txBps: number;
  active: boolean;
}

export interface GatewayTwinInventoryScope {
  locationSource?: 'rdk' | 'prpl';
  inventoryTopic?: string;
  inventoryTopicsSeen: readonly string[];
}

/** The 3D constellation has a fixed, deliberately bounded glyph pool. */
export const MAX_GATEWAY_TWIN_HOSTS = 16;

const normalizedMac = (mac: string) => mac.trim().toUpperCase();

function compareRosterPriority(left: DeviceView, right: DeviceView): number {
  const activeDelta = Number(right.status !== 'err' && right.status !== 'off')
    - Number(left.status !== 'err' && left.status !== 'off');
  return activeDelta || normalizedMac(left.mac).localeCompare(normalizedMac(right.mac));
}

function balancedRoster(devices: DeviceView[]): DeviceView[] {
  const domainQuota = Math.floor(MAX_GATEWAY_TWIN_HOSTS / 2);
  const it = devices.filter((device) => device.domain === 'IT').sort(compareRosterPriority);
  const ot = devices.filter((device) => device.domain === 'OT').sort(compareRosterPriority);
  const selected = [...it.slice(0, domainQuota), ...ot.slice(0, domainQuota)];
  const remaining = MAX_GATEWAY_TWIN_HOSTS - selected.length;
  if (remaining > 0) {
    selected.push(...[
      ...it.slice(domainQuota),
      ...ot.slice(domainQuota),
    ].sort(compareRosterPriority).slice(0, remaining));
  }
  return selected.sort((left, right) =>
    normalizedMac(left.mac).localeCompare(normalizedMac(right.mac)));
}

function measuredBps(mbps: number | undefined): number {
  if (typeof mbps !== 'number' || !Number.isFinite(mbps) || mbps <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(mbps * 1_000_000));
}

function twinKind(device: DeviceView): GatewayTwinHostKind {
  switch (device.kind) {
    case 'laptop':
      return 'laptop';
    case 'phone':
    case 'confphone':
      return 'phone';
    case 'tablet':
    case 'payment':
      return 'tablet';
    default:
      return 'iot';
  }
}

function twinLayer1(device: DeviceView): GatewayTwinLayer1 {
  if (device.conn === 'wired') return 'lan1';
  if (device.conn === 'poe') return 'lan2';
  if (device.conn === 'thread') return 'wifi2';

  // prplOS AP indices use the even-numbered primary BSS entries for the three
  // radios. Unknown/guest indices stay on the conservative 5 GHz fallback.
  if (device.telemetry?.wifiApIndex === 0) return 'wifi2';
  if (device.telemetry?.wifiApIndex === 4) return 'wifi6';
  return 'wifi5';
}

function hasExactTopic(device: DeviceView, inventoryTopic?: string): boolean {
  if (!inventoryTopic) return true;
  return device.inventoryTopics?.includes(inventoryTopic) === true;
}

/**
 * Map one authoritative branch inventory into the twin's stable host model.
 * `null` means the topic has not reported yet (keep the simulator fallback),
 * while `[]` means it reported an authoritative empty roster.
 */
export function gatewayTwinHostRoster(
  devices: readonly DeviceView[],
  scope: GatewayTwinInventoryScope,
): GatewayTwinHost[] | null {
  const { inventoryTopic, inventoryTopicsSeen, locationSource } = scope;
  if (!inventoryTopic || !inventoryTopicsSeen.includes(inventoryTopic)) return null;

  const scopedDevices = devices
    .filter((device) =>
      matchesDeviceInventory(device, locationSource, inventoryTopic)
      && hasExactTopic(device, inventoryTopic));

  return balancedRoster(scopedDevices)
    .map((device, index) => {
      const mac = normalizedMac(device.mac);
      const rssi = device.telemetry?.rssiDbm;
      return {
        id: `ce-${mac.replace(/[^A-Z0-9]/g, '').toLowerCase()}`,
        path: `Device.Hosts.Host.${index + 1}.`,
        name: device.name,
        kind: twinKind(device),
        domain: device.domain,
        layer1: twinLayer1(device),
        rssiDbm: typeof rssi === 'number' && Number.isFinite(rssi) ? rssi : null,
        rxBps: measuredBps(device.telemetry?.rxMbps),
        txBps: measuredBps(device.telemetry?.txMbps),
        active: device.status !== 'err' && device.status !== 'off',
      };
    });
}
