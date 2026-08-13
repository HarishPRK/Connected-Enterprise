import { Card } from '../Card';
import type { AppTraffic } from '../../types';
import {
  WidgetDataBadge,
  WidgetDataEmpty,
  WidgetDataNote,
  type WidgetDataMeta,
} from './WanWidget';

export interface AppTrafficWidgetProps extends WidgetDataMeta {
  items: readonly AppTraffic[] | null;
}

function formatShare(value: number) {
  return Number.isFinite(value) ? `${value.toLocaleString()}%` : 'Share not reported';
}

function formatThroughput(value: number | undefined) {
  return Number.isFinite(value)
    ? `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} Mbps`
    : 'Rate not reported';
}

export function AppTrafficWidget({
  items,
  dataState = 'unavailable',
  source,
  statusMessage,
  observedAt,
}: AppTrafficWidgetProps) {
  const canShowObservation = dataState === 'live' || dataState === 'stale';
  const visibleItems = canShowObservation ? (items ?? []) : [];

  return (
    <Card
      title="Active Client Traffic"
      sub={(
        <>
          <div>Share of measured Wi-Fi client throughput</div>
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
      {visibleItems.length === 0 ? (
        <WidgetDataEmpty state={dataState} liveLabel="active client traffic" />
      ) : (
        visibleItems.map((item, index) => {
          const hasShare = Number.isFinite(item.sharePct);
          const width = hasShare ? Math.max(0, Math.min(100, item.sharePct)) : null;

          return (
            <div key={`${item.app}-${index}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                <span style={{ color: 'var(--text)', minWidth: 0, overflowWrap: 'anywhere' }}>{item.app}</span>
                <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {formatShare(item.sharePct)} · {formatThroughput(item.mbps)}
                </span>
              </div>
              <div
                className="progress"
                role="meter"
                aria-label={`${item.app} share of measured client traffic`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={hasShare ? item.sharePct : undefined}
              >
                {width != null && <span style={{ width: `${width}%` }} />}
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}
