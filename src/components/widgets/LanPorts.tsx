import { Card } from '../Card';
import type { LanPort } from '../../types';
import {
  WidgetDataBadge,
  WidgetDataEmpty,
  WidgetDataNote,
  type WidgetDataMeta,
} from './WanWidget';

export interface LanPortsProps extends WidgetDataMeta {
  ports: readonly LanPort[] | null;
}

function formatPortRate(speedMbps: number | undefined) {
  if (typeof speedMbps !== 'number' || !Number.isFinite(speedMbps) || speedMbps <= 0) {
    return 'rate not reported';
  }
  if (speedMbps >= 1000 && speedMbps % 1000 === 0) return `${speedMbps / 1000}G`;
  return `${speedMbps}M`;
}

function formatPacketRate(value: number) {
  if (value < 1) return `${value.toFixed(2)} pkt/s`;
  if (value < 10 && !Number.isInteger(value)) return `${value.toFixed(1)} pkt/s`;
  if (value < 1_000) return `${Math.round(value).toLocaleString()} pkt/s`;
  if (value < 1_000_000) return `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kpkt/s`;
  return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} Mpkt/s`;
}

function portActivity(port: LanPort) {
  const hasPacketCounters = port.rxPackets !== undefined || port.txPackets !== undefined;
  const hasRxRate = Number.isFinite(port.rxPps);
  const hasTxRate = Number.isFinite(port.txPps);
  const packetRate = (hasRxRate ? Number(port.rxPps) : 0) + (hasTxRate ? Number(port.txPps) : 0);
  if (hasPacketCounters) {
    return {
      active: packetRate > 0,
      packetRate: hasRxRate || hasTxRate ? packetRate : null,
      text: hasRxRate || hasTxRate ? formatPacketRate(packetRate) : 'collecting rate…',
    };
  }
  if (port.linkUp === false) return { active: false, packetRate: null, text: 'down' };
  if (port.linkUp === true) return { active: true, packetRate: null, text: formatPortRate(port.speedMbps) };
  return { active: false, packetRate: null, text: 'link state not reported' };
}

/** Blink period like physical switch LEDs: busier port → faster blink.
 *  null = solid (link up, no measured traffic). */
function blinkSeconds(pps: number | null): number | null {
  if (pps === null || !Number.isFinite(pps) || pps <= 0) return null;
  if (pps < 5) return 1.1;
  if (pps < 50) return 0.7;
  if (pps < 500) return 0.4;
  if (pps < 5_000) return 0.22;
  return 0.13;
}

export function LanPorts({
  ports,
  dataState = 'unavailable',
  source,
  statusMessage,
  observedAt,
}: LanPortsProps) {
  const canShowObservation = dataState === 'live' || dataState === 'stale';
  const visiblePorts = canShowObservation ? (ports ?? []) : [];
  const summary = visiblePorts.length > 0
    ? `${visiblePorts.length} live interface reports`
    : 'GW Twin interface activity';

  return (
    <Card
      title="LAN Ports"
      sub={(
        <>
          <div>{summary}</div>
          <WidgetDataNote
            dataState={dataState}
            source={source}
            statusMessage={statusMessage}
            observedAt={observedAt}
          />
        </>
      )}
      right={<WidgetDataBadge state={dataState} />}
    >
      {visiblePorts.length === 0 ? (
        <WidgetDataEmpty state={dataState} liveLabel="LAN port data" skeleton={dataState === 'live'} />
      ) : (
        visiblePorts.map((port) => {
          const activity = portActivity(port);
          const blink = blinkSeconds(activity.packetRate);
          return (
            <div key={port.id} className="port-row" title={port.interfaceName}>
              <span className="port-id">P{port.id}</span>
              <span
                className={`dot ${activity.active ? 'ok' : 'off'}${blink ? ' led-blink' : ''}`}
                style={blink ? { animationDuration: `${blink}s` } : undefined}
              />
              <span className="port-dev" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                {port.label?.trim() || port.device?.trim() || port.interfaceName || 'Interface'}
              </span>
              <span className="port-rate">{activity.text}</span>
            </div>
          );
        })
      )}
    </Card>
  );
}
