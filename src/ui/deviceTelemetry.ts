/**
 * Health view built from REAL device telemetry (Shelly status dumps, etc.),
 * replacing the synthetic `getDeviceHealth` narrative for devices that report
 * live readings. Returns null when the device has no telemetry, so callers
 * fall back to the mock health.
 */

import type { Device, DeviceHealth, HealthSignal } from '../types';

export function telemetryHealth(d: Device): DeviceHealth | null {
  const t = d.telemetry;
  if (!t) return null;

  const parts: string[] = [];
  if (t.apowerW != null) parts.push(`${t.apowerW.toFixed(1)} W`);
  if (t.voltageV != null) parts.push(`${t.voltageV.toFixed(1)} V`);
  if (t.tempC != null) parts.push(`${t.tempC.toFixed(1)} °C`);
  if (t.rssiDbm != null) parts.push(`RSSI ${t.rssiDbm} dBm`);

  const signals: HealthSignal[] = [];
  if (t.apowerW != null) {
    signals.push({ label: 'Power draw', value: `${t.apowerW.toFixed(1)} W`, status: 'ok' });
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
  if (t.currentA != null) {
    signals.push({ label: 'Current', value: `${t.currentA.toFixed(3)} A`, status: 'ok' });
  }
  if (t.energyWhTotal != null) {
    signals.push({
      label: 'Energy (lifetime)',
      value: t.energyWhTotal >= 1000
        ? `${(t.energyWhTotal / 1000).toFixed(2)} kWh`
        : `${Math.round(t.energyWhTotal)} Wh`,
      status: 'ok',
    });
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
  if (t.rssiDbm != null) {
    signals.push({
      label: 'Wi-Fi RSSI',
      value: `${t.rssiDbm} dBm${t.ssid ? ` · ${t.ssid}` : ''}`,
      status: t.rssiDbm > -70 ? 'ok' : t.rssiDbm > -80 ? 'warn' : 'err',
      threshold: '≥ -70 dBm',
      why: t.rssiDbm <= -70 ? 'Weak signal — consider relocating the device or AP' : undefined,
    });
  }
  if (t.fwUpdateVersion) {
    signals.push({
      label: 'Firmware',
      value: `update ${t.fwUpdateVersion} available`,
      status: 'warn',
      why: 'A newer stable firmware is available',
    });
  }

  if (signals.length === 0) return null;
  return {
    summary: `Live device telemetry · ${parts.join(' · ')}`,
    signals,
  };
}
