import { Radio, Cable } from 'lucide-react';
import { Card } from '../Card';
import { StatusBadge } from '../StatusBadge';
import type { WanLink } from '../../types';

export type WidgetDataState = 'loading' | 'live' | 'stale' | 'unavailable';

export interface WidgetDataMeta {
  /** Omission is intentionally treated as unavailable, never as live. */
  dataState?: WidgetDataState;
  /** Human-readable telemetry origin, for example an MQTT topic or gateway. */
  source?: string;
  /** Source-specific context such as a connection error or rolling-window note. */
  statusMessage?: string;
  /** Timestamp attached to the observation, not the component render time. */
  observedAt?: number | string | Date | null;
}

export interface WanWidgetProps extends WidgetDataMeta {
  links: readonly WanLink[] | null;
}

const STATE_LABEL: Record<WidgetDataState, string> = {
  loading: 'Loading',
  live: 'Live',
  stale: 'Stale',
  unavailable: 'Unavailable',
};

const STATE_CLASS: Record<WidgetDataState, string> = {
  loading: '',
  live: 'ok',
  stale: 'warn',
  unavailable: 'err',
};

const STATE_DOT: Record<WidgetDataState, string> = {
  loading: 'off',
  live: 'ok',
  stale: 'warn',
  unavailable: 'err',
};

function formatObservedAt(value: WidgetDataMeta['observedAt']) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function WidgetDataBadge({ state }: { state: WidgetDataState }) {
  return (
    <span className={`badge ${STATE_CLASS[state]}`} aria-label={`Data status: ${STATE_LABEL[state]}`}>
      <span className={`dot ${STATE_DOT[state]}`} />
      {STATE_LABEL[state]}
    </span>
  );
}

export function WidgetDataNote({
  dataState = 'unavailable',
  source,
  statusMessage,
  observedAt,
}: WidgetDataMeta) {
  const observed = formatObservedAt(observedAt);
  const details = [
    statusMessage,
    source ? `Source: ${source}` : null,
    observed ? `Observed ${observed}` : null,
  ].filter((detail): detail is string => Boolean(detail));

  if (details.length === 0) {
    details.push(
      dataState === 'loading'
        ? 'Waiting for the live telemetry source.'
        : dataState === 'stale'
          ? 'Showing the last observation received.'
          : dataState === 'live'
            ? 'Live telemetry received.'
            : 'Live telemetry is unavailable.',
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ marginTop: 3, fontSize: 10.5, lineHeight: 1.4, overflowWrap: 'anywhere' }}
    >
      {details.join(' · ')}
    </div>
  );
}

export function WidgetDataEmpty({
  state,
  liveLabel,
  message: messageOverride,
}: {
  state: WidgetDataState;
  liveLabel: string;
  message?: string;
}) {
  const message = messageOverride ?? (state === 'loading'
    ? `Connecting to live ${liveLabel}…`
    : state === 'stale'
      ? `The last observation contained no ${liveLabel}.`
      : state === 'live'
        ? `The live source reported no ${liveLabel}.`
        : `Live ${liveLabel} is unavailable.`);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: 92,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px 12px',
        border: '1px dashed var(--border-strong)',
        borderRadius: 10,
        color: 'var(--text-muted)',
        fontSize: 12,
        textAlign: 'center',
      }}
    >
      {message}
    </div>
  );
}

function formatMbps(value: number | undefined) {
  return Number.isFinite(value) ? `${value} Mbps` : 'not reported';
}

function radioMetrics(link: WanLink) {
  const values = [
    Number.isFinite(link.rssi) ? `RSSI ${link.rssi} dBm` : null,
    Number.isFinite(link.sinr) ? `SINR ${link.sinr} dB` : null,
  ].filter((value): value is string => Boolean(value));

  return values.length > 0 ? values.join(' · ') : 'Radio metrics not reported';
}

function linkMetrics(link: WanLink) {
  const throughput = `Rx ${formatMbps(link.rxMbps)} · Tx ${formatMbps(link.txMbps)}`;
  return link.type === '5G' ? `${throughput} · ${radioMetrics(link)}` : throughput;
}

export function WanWidget({
  links,
  dataState = 'unavailable',
  source,
  statusMessage,
  observedAt,
}: WanWidgetProps) {
  const canShowObservation = dataState === 'live' || dataState === 'stale';
  const visibleLinks = canShowObservation ? (links ?? []) : [];
  const active = visibleLinks.find((link) => link.active);

  return (
    <Card
      title="WAN (5G / Fiber)"
      sub={(
        <>
          <div>Dual-WAN with auto-failover</div>
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
      {visibleLinks.length === 0 ? (
        <WidgetDataEmpty state={dataState} liveLabel="WAN link data" />
      ) : (
        visibleLinks.map((link, index) => (
          <div
            key={`${link.type}-${index}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              minWidth: 0,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {link.type === '5G' ? <Radio size={16} /> : <Cable size={16} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {link.type}
                  <span className={`badge ${link.active ? 'ok' : ''}`} style={{ marginInlineStart: 6 }}>
                    {link.active ? 'Active' : 'Standby'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                  {linkMetrics(link)}
                </div>
              </div>
            </div>
            <StatusBadge status={link.status} />
          </div>
        ))
      )}
      {visibleLinks.length > 0 && (
        <div className="card-sub">
          {active ? (
            <>Currently routing via <strong style={{ color: 'var(--text)' }}>{active.type}</strong></>
          ) : (
            'No active WAN path reported'
          )}
        </div>
      )}
    </Card>
  );
}
