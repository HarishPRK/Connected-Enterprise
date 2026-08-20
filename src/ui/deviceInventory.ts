export interface DeviceInventoryProvenance {
  locationSource?: 'rdk' | 'prpl';
  inventoryTopics?: string[];
}

/** Match a device to a branch's authoritative inventory feed. Exact topic
 *  provenance wins when available; auxiliary enrichments without a primary
 *  topic remain eligible through their branch location. */
export function matchesDeviceInventory(
  device: DeviceInventoryProvenance,
  locationSource?: 'rdk' | 'prpl',
  inventoryTopic?: string,
): boolean {
  if (locationSource && device.locationSource !== locationSource) return false;
  if (inventoryTopic && device.inventoryTopics?.length) {
    return device.inventoryTopics.includes(inventoryTopic);
  }
  return true;
}
