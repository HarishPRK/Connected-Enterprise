/**
 * Health view + metering tiles built from REAL device telemetry (Shelly
 * switch:0 readings, etc.), replacing the synthetic `getDeviceHealth`
 * narrative for devices that report live electrical data. Returns null when
 * the device has no telemetry, so callers fall back to the mock health.
 */

import type { Device, DeviceHealth, DeviceTelemetry, HealthSignal } from '../types';

/** Bytes → compact human string. */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${Math.round(n)} B`;
}

/** Energy in Wh → a compact human string (kWh for ≥1000 Wh; sub-Wh kept
 *  precise so a barely-used relay doesn't render as a flat "0 Wh"). */
export function formatEnergy(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  if (wh >= 1) return `${Math.round(wh)} Wh`;
  return `${wh.toFixed(3)} Wh`;
}

export type EnergyRating = 'A' | 'B' | 'C' | 'D' | 'E';

/**
 * A live load band derived from instantaneous active power. This is an
 * operational energy rating, not an appliance efficiency certification — the
 * latter requires device-class and duty-cycle data that the gateway does not
 * report.
 */
export function energyRatingFor(apowerW?: number): EnergyRating | null {
  if (apowerW == null || !Number.isFinite(apowerW) || apowerW < 0) return null;
  if (apowerW <= 5) return 'A';
  if (apowerW <= 25) return 'B';
  if (apowerW <= 100) return 'C';
  if (apowerW <= 500) return 'D';
  return 'E';
}

export function energyRatingLabel(rating: EnergyRating): string {
  return {
    A: 'Very low live load',
    B: 'Low live load',
    C: 'Moderate live load',
    D: 'High live load',
    E: 'Very high live load',
  }[rating];
}

/** Power / current / voltage / energy as labelled tiles for the drawer's
 *  metering card. Empty when the device reports no electrical data. */
export function meteringTiles(t: DeviceTelemetry): { label: string; value: string }[] {
  const tiles: { label: string; value: string }[] = [];
  if (t.apowerW != null) tiles.push({ label: 'Live power draw', value: `${t.apowerW.toFixed(1)} W` });
  if (t.currentA != null) tiles.push({ label: 'Current', value: `${t.currentA.toFixed(3)} A` });
  if (t.voltageV != null) tiles.push({ label: 'Voltage', value: `${t.voltageV.toFixed(1)} V` });
  if (t.energyWhTotal != null) tiles.push({ label: 'Energy (total)', value: formatEnergy(t.energyWhTotal) });
  return tiles;
}

/** Connection duration from (possibly fractional) hours → human string with
 *  seconds/minutes resolution, so a just-connected device reads "42s", not "0 h". */
export function formatConnectedFor(hours: number): string {
  const sec = Math.round(hours * 3600);
  if (sec <= 0) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  if (hours < 24) return `${Math.floor(hours)}h ${Math.floor((hours % 1) * 60)}m`;
  return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
}

export function telemetryHealth(d: Device): DeviceHealth | null {
  const t = d.telemetry;
  if (!t) return null;

  // At-a-glance line (shown in the table): power · current · voltage · energy
  // plus the real Wi-Fi signal/health when the gateway reports them.
  const parts: string[] = [];
  if (t.apowerW != null) parts.push(`${t.apowerW.toFixed(1)} W`);
  if (t.currentA != null) parts.push(`${t.currentA.toFixed(3)} A`);
  if (t.voltageV != null) parts.push(`${t.voltageV.toFixed(1)} V`);
  if (t.energyWhTotal != null) parts.push(formatEnergy(t.energyWhTotal));
  if (t.rssiDbm != null) parts.push(`RSSI ${t.rssiDbm} dBm`);
  if (t.rxBytes != null || t.txBytes != null) {
    parts.push(`↓${formatBytes(t.rxBytes ?? 0)} · ↑${formatBytes(t.txBytes ?? 0)}`);
  }
  if (t.wifiHealth && !/^(ok|healthy|good)$/i.test(t.wifiHealth)) parts.push(t.wifiHealth);

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
  if (t.rssiDbm != null) {
    signals.push({
      label: 'Wi-Fi RSSI',
      value: `${t.rssiDbm} dBm`,
      status: t.rssiDbm > -70 ? 'ok' : t.rssiDbm > -80 ? 'warn' : 'err',
      threshold: '≥ −70 dBm',
      why: t.rssiDbm <= -70 ? 'Weak signal — consider relocating the device or AP' : undefined,
    });
  }
  if (t.snrDb != null) {
    signals.push({
      label: 'SNR',
      value: `${t.snrDb} dB`,
      status: t.snrDb >= 20 ? 'ok' : t.snrDb >= 10 ? 'warn' : 'err',
      threshold: '≥ 20 dB',
    });
  }
  if (t.rxBytes != null || t.txBytes != null) {
    signals.push({
      label: 'Data transferred',
      value: `↓ ${formatBytes(t.rxBytes ?? 0)} · ↑ ${formatBytes(t.txBytes ?? 0)}`,
      status: 'ok',
    });
  }
  if (t.rxMbps != null || t.txMbps != null) {
    signals.push({
      label: 'Throughput now',
      value: `${(t.rxMbps ?? 0).toFixed(2)}↓ / ${(t.txMbps ?? 0).toFixed(2)}↑ Mbps`,
      status: 'ok',
    });
  }
  if (t.linkDownMbps != null || t.linkUpMbps != null) {
    const std = t.wifiStandard ? (t.wifiStandard.startsWith('802') ? t.wifiStandard : `802.11${t.wifiStandard}`) : null;
    signals.push({
      label: 'Link rate',
      value: `${t.linkDownMbps ?? '—'}↓ / ${t.linkUpMbps ?? '—'}↑ Mbps${std ? ` · ${std}` : ''}`,
      status: 'ok',
    });
  }
  if (t.wifiHealth && !/^(ok|healthy|good)$/i.test(t.wifiHealth)) {
    const why: Record<string, string> = {
      high_retrans: 'High retransmission rate on the wireless link',
      tx_errors: 'Transmit errors reported by the access point',
      weak_signal: 'The AP classifies this client as weak-signal',
    };
    signals.push({
      label: 'Link health',
      value: t.wifiHealth,
      status: 'warn',
      why: why[t.wifiHealth.toLowerCase()] ?? "Gateway's link-health verdict for this client",
    });
  }

  if (signals.length === 0) return null;
  return {
    summary: parts.length ? `Live metering · ${parts.join(' · ')}` : 'Live device telemetry',
    signals,
  };
}
