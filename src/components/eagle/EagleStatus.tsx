import { Check, ChevronDown, CircleHelp, Clock3, TriangleAlert } from 'lucide-react';
import { ANOMALY_REASON_LABELS, type AnomalyReasonCode } from '../../../shared/eagleTelemetry';
import { eagleHistorySegments, eagleHttpCatCode, eagleSampleState, eagleSnapshotMood } from '../../ui/eaglePresentation';
import type { HardwareAnomalyPoint } from '../../ui/useHardwareAnomalies';
import cat200 from '../../assets/eagle/http-cat-200.jpg';
import cat404 from '../../assets/eagle/http-cat-404.jpg';
import cat500 from '../../assets/eagle/http-cat-500.jpg';
import cat503 from '../../assets/eagle/http-cat-503.jpg';

type Mood = ReturnType<typeof eagleSnapshotMood>;
const HTTP_CATS = {
  200: { image: cat200, label: '200 OK' },
  404: { image: cat404, label: '404 Not Found' },
  500: { image: cat500, label: '500 Internal Server Error' },
  503: { image: cat503, label: '503 Service Unavailable' },
};

export function EagleHttpCat({ mood, animate = false, unavailable = false, compact = false }: {
  mood: Mood; animate?: boolean; unavailable?: boolean; compact?: boolean;
}) {
  const code = eagleHttpCatCode(mood, unavailable);
  const cat = HTTP_CATS[code];
  return <figure className={`eagle-cat${compact ? ' eagle-cat-compact' : ''}`} data-mood={mood} data-animate={animate}>
    <img key={code} src={cat.image} alt={`HTTP Cats meme: ${cat.label}`} width={750} height={600} decoding="async" />
    <figcaption><a href={`https://http.cat/status/${code}`} target="_blank" rel="noreferrer">HTTP Cats ↗</a>
      <span>HTTP meme · visual reaction</span></figcaption>
  </figure>;
}

const stamp = (time: string) => new Date(time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function EagleStatus({ reasons, latest, animate, stale }: {
  reasons: AnomalyReasonCode[]; latest: HardwareAnomalyPoint | null; animate: boolean; stale: boolean;
}) {
  const mood = eagleSnapshotMood(reasons, latest, stale);
  const ordered = [...reasons].sort((a, b) => Number(b.code !== 0) - Number(a.code !== 0) || Date.parse(b.time) - Date.parse(a.time));
  const primary = ordered[0];
  const title = primary ? ANOMALY_REASON_LABELS[primary.code] ?? 'Unrecognized reason code' : 'Awaiting a reason code';
  const Icon = !primary ? CircleHelp : primary.code === 0 ? Check : TriangleAlert;
  return <section className="eagle-status" data-mood={mood} aria-label="Anomaly reason code">
    <div className="eagle-status-main">
      <div className="eagle-status-heading"><h2>Anomaly reason code</h2><span className="eagle-snapshot-label"><Clock3 size={12} />{stale ? 'Cached snapshot' : 'Latest report'}</span></div>
      <div className="eagle-status-result">
        <div className="eagle-code" data-fault={Boolean(primary && primary.code !== 0)}><span>Code</span><strong>{primary ? String(primary.code).padStart(2, '0') : '—'}</strong></div>
        <div className="eagle-reason-copy"><h3><Icon size={24} aria-hidden="true" />{title}</h3>
          <p>{!primary ? 'The selected device has not reported a reason code in this range.' : primary.code === 0
            ? 'The detector reports normal behavior for this series.' : 'The detector reported this condition. Review the signals and affected sample windows below.'}</p>
          {primary && <div className="eagle-reason-meta"><span>{Object.values(primary.tags).join(' · ') || 'Device series'}</span><time dateTime={primary.time}>{stamp(primary.time)}</time></div>}
          {ordered.length > 1 && <div className="eagle-additional-reasons">{ordered.slice(1).map((reason, index) =>
            <span key={index}>Code {reason.code} · {ANOMALY_REASON_LABELS[reason.code] ?? 'Unknown'} · {Object.values(reason.tags).join(' · ')} · {stamp(reason.time)}</span>)}</div>}
        </div>
      </div>
      <details className="eagle-code-guide"><summary>Understand status codes <ChevronDown size={14} aria-hidden="true" /></summary>
        <dl>{Object.entries(ANOMALY_REASON_LABELS).map(([code, label]) => <div key={code} data-current={reasons.some(reason => reason.code === Number(code))}>
          <dt>{code.padStart(2, '0')}</dt><dd>{label}</dd></div>)}</dl>
        <p>Reported codes and threshold crossings are separate signals. An absent code is not a healthy result.</p>
      </details>
    </div>
    <EagleHttpCat mood={mood} animate={animate} unavailable={stale} />
  </section>;
}

const STATE_LABELS = { normal: 'Within threshold', unknown: 'Incomplete', crossed: 'Crossed threshold', flagged: 'Flagged' };
export function EagleHistory({ points }: { points: HardwareAnomalyPoint[] }) {
  const segments = eagleHistorySegments(points);
  const counts = { normal: 0, unknown: 0, crossed: 0, flagged: 0 };
  points.forEach(point => counts[eagleSampleState(point)]++);
  return <figure className="eagle-history" aria-label="Sample history by detector state">
    <div className="eagle-history-track" aria-hidden="true">{segments.map((segment, index) => <span key={index} data-state={segment.state}
      title={`${stamp(segment.start)} – ${stamp(segment.end)} · ${segment.count} windows · ${STATE_LABELS[segment.state]}`} />)}</div>
    <figcaption><span>{points.length.toLocaleString()} sampled windows <span className="eagle-history-direction">· oldest → newest</span></span>
      <span className="eagle-history-legend">{(Object.keys(counts) as (keyof typeof counts)[]).map(state => <span key={state} data-state={state}>
        <i />{counts[state].toLocaleString()} {STATE_LABELS[state]}</span>)}</span>
    </figcaption>
  </figure>;
}
