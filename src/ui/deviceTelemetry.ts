/**
 * Health view + metering tiles built from REAL device telemetry (Shelly
 * switch:0 readings, etc.), replacing the synthetic `getDeviceHealth`
 * narrative for devices that report live electrical data. Returns null when
 * the device has no telemetry, so callers fall back to the mock health.
 */

import type { Device, DeviceHealth, DeviceTelemetry, HealthSignal } from '../types';

/** Energy in Wh → a compact human string (kWh for ≥1000 Wh; sub-Wh kept
 *  precise so a barely-used relay doesn't render as a flat "0 Wh"). */
export function formatEnergy(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  if (wh >= 1) return `${Math.round(wh)} Wh`;
  return `${wh.toFixed(3)} Wh`;
}

/** Power / current / voltage / energy as labelled tiles for the drawer's
 *  metering card. Empty when the device reports no electrical data. */
export function meteringTiles(t: DeviceTelemetry): { label: string; value: string }[] {
  const tiles: { label: string; value: string }[] = [];
  if (t.apowerW != null) tiles.push({ label: 'Power', value: `${t.apowerW.toFixed(1)} W` });
  if (t.currentA != null) tiles.push({ label: 'Current', value: `${t.currentA.toFixed(3)} A` });
  if (t.voltageV != null) tiles.push({ label: 'Voltage', value: `${t.voltageV.toFixed(1)} V` });
  if (t.energyWhTotal != null) tiles.push({ label: 'Energy (total)', value: formatEnergy(t.energyWhTotal) });
  return tiles;
}

export function telemetryHealth(d: Device): DeviceHealth | null {
  const t = d.telemetry;
  if (!t) return null;

  // At-a-glance line (shown in the table): power · current · voltage · energy.
  const parts: string[] = [];
  if (t.apowerW != null) parts.push(`${t.apowerW.toFixed(1)} W`);
  if (t.currentA != null) parts.push(`${t.currentA.toFixed(3)} A`);
  if (t.voltageV != null) parts.push(`${t.voltageV.toFixed(1)} V`);
  if (t.energyWhTotal != null) parts.push(formatEnergy(t.energyWhTotal));

  const signals: HealthSignal[] = [];
  if (t.apowerW != null) {
    signals.push({ label: 'Power draw', value: `${t.apowerW.toFixed(1)} W`, status: 'ok' });
  }
  if (t.currentA != null) {
    signals.push({ label: 'Current', value: `${t.currentA.toFixed(3)} A`, status: 'ok' });
  }
  if (t.voltageV != null) {
    const inRange = t.voltageV >= 108 && t.voltageV <= 132;
    signals.push({
      label: 'Line voltage',
      value: `${t.voltageV.toFixed(1)} V`,
      status: inRange ? 'ok' : 'warn',
      threshold: '108–132 V',
      why: inRange ? undefined : 'Outside nominal 120 V ±10% band',
    });
  }
  if (t.energyWhTotal != null) {
    signals.push({ label: 'Energy (lifetime)', value: formatEnergy(t.energyWhTotal), status: 'ok' });
  }
  if (t.tempC != null) {
    signals.push({
      label: 'Device temperature',
      value: `${t.tempC.toFixed(1)} °C`,
      status: t.tempC < 70 ? 'ok' : t.tempC < 85 ? 'warn' : 'err',
      threshold: '< 70 °C',
      why: t.tempC >= 70 ? 'Relay running hot' : undefined,
    });
  }

  if (signals.length === 0) return null;
  return {
    summary: parts.length ? `Live metering · ${parts.join(' · ')}` : 'Live device telemetry',
    signals,
  };
}
