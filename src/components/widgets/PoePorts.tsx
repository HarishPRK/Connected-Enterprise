import { Card } from '../Card';
import type { PoePort } from '../../types';
import {
  WidgetDataBadge,
  WidgetDataEmpty,
  WidgetDataNote,
  type WidgetDataMeta,
} from './WanWidget';

export interface PoePortsProps extends WidgetDataMeta {
  ports: readonly PoePort[] | null;
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function formatWatts(value: number) {
  return finiteNonNegative(value) ? `${value.toFixed(1)} W` : 'not reported';
}

export function PoePorts({
  ports,
  dataState = 'unavailable',
  source,
  statusMessage,
  observedAt,
}: PoePortsProps) {
  const canShowObservation = dataState === 'live' || dataState === 'stale';
  const visiblePorts = canShowObservation ? (ports ?? []) : [];
  const hasCompleteDraw = visiblePorts.length > 0 && visiblePorts.every((port) => finiteNonNegative(port.watts));
  const totalW = hasCompleteDraw
    ? visiblePorts.reduce((sum, port) => sum + port.watts, 0)
    : null;
  const summary = totalW == null
    ? visiblePorts.length > 0 ? 'Power draw partially reported' : 'Power draw by switch port'
    : `Draw ${totalW.toFixed(1)} W total`;

  return (
    <Card
      title="PoE Ports"
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
        <WidgetDataEmpty state={dataState} liveLabel="PoE port data" />
      ) : (
        visiblePorts.map((port) => {
          const hasDraw = finiteNonNegative(port.watts);
          const hasLimit = Number.isFinite(port.max) && port.max > 0;
          const pct = hasDraw && hasLimit
            ? Math.max(0, Math.min(100, (port.watts / port.max) * 100))
            : null;

          return (
            <div key={port.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                <span style={{ color: 'var(--text-dim)', minWidth: 0, overflowWrap: 'anywhere' }}>
                  PoE{port.id} · {port.device?.trim() || <em style={{ color: 'var(--text-muted)' }}>Device not identified</em>}
                </span>
                <span style={{ color: hasDraw && port.watts > 0 ? 'var(--text)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {formatWatts(port.watts)} / {hasLimit ? `${port.max} W` : 'limit not reported'}
                </span>
              </div>
              <div
                className="progress"
                role="meter"
                aria-label={`PoE ${port.id} power draw`}
                aria-valuemin={0}
                aria-valuemax={hasLimit ? port.max : undefined}
                aria-valuenow={hasDraw ? port.watts : undefined}
              >
                {pct != null && <span style={{ width: `${pct}%` }} />}
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}
