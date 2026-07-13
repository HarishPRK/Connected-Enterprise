import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import {
  AlertCircle, Cpu, Loader2, Maximize2, Minimize2, Play, RefreshCw, Video, Wifi,
} from 'lucide-react';

type StreamGroup = 'Nvidia' | 'Hailo';

interface VideoStream {
  id: string;
  name: string;
  description: string;
  url: string;
  group: StreamGroup;
  /** Camera hardware behind this pipeline. */
  camera: string;
}

/** Stream URLs route through the local Express server at `/api/video/:id`.
 *  In dev, Vite proxies `/api/*` to localhost:3001. In prod, same-origin on EC2.
 *  The server resolves each id to a real upstream URL — configurable per stream
 *  via VIDEO_UPSTREAM_<ID>, or by group via VIDEO_BASE_NVIDIA / VIDEO_BASE_HAILO. */
const STREAMS: VideoStream[] = [
  // ── Nvidia · GPU inference
  { id: 'nv-nanoowl',  name: 'Inventory Management', description: 'Open-vocabulary object detection',  url: '/api/video/nv-nanoowl',  group: 'Nvidia', camera: 'Axis P3265-LV' },
  { id: 'nv-violence', name: 'Violence detection', description: 'Aggressive-behaviour classifier',     url: '/api/video/nv-violence', group: 'Nvidia', camera: 'Axis P3265-LV' },
  { id: 'nv-fall',     name: 'Fall detection',     description: 'Detects person falls in zones',       url: '/api/video/nv-fall',     group: 'Nvidia', camera: 'Hikvision DS-2CD2387G2' },
  { id: 'nv-ppe',      name: 'PPE compliance',     description: 'Hard-hat · vest',                     url: '/api/video/nv-ppe',      group: 'Nvidia', camera: 'Hikvision DS-2CD2387G2' },
  { id: 'nv-table',    name: 'Table monitor',      description: 'Table occupancy and dwell-time',      url: '/api/video/nv-table',    group: 'Nvidia', camera: 'Reolink RLC-833A' },
  { id: 'nv-weapon',   name: 'Weapon detection',   description: 'Firearms and edged-weapon classifier', url: '/api/video/nv-weapon',   group: 'Nvidia', camera: 'Axis P3265-LV' },
  { id: 'nv-parking',  name: 'Parking monitor',    description: 'Bay occupancy and dwell-time',        url: '/api/video/nv-parking',  group: 'Nvidia', camera: 'Dahua IPC-Color4K' },
  // ── Hailo · NPU inference
  { id: 'ha-anpd',     name: 'ANPR',               description: 'Automatic number-plate recognition',  url: '/api/video/ha-anpd',     group: 'Hailo', camera: 'Dahua IPC-Color4K' },
  { id: 'ha-intruder', name: 'Intruder detection', description: 'Perimeter intrusion alerts',          url: '/api/video/ha-intruder', group: 'Hailo', camera: 'Reolink RLC-833A' },
  { id: 'ha-hairnet',  name: 'Hairnet monitor',    description: 'Food-safety hairnet compliance',      url: '/api/video/ha-hairnet',  group: 'Hailo', camera: 'Tapo C320WS' },
  { id: 'ha-fire',     name: 'Fire detection',     description: 'Smoke and flame classifier',          url: '/api/video/ha-fire',     group: 'Hailo', camera: 'Tapo C320WS' },
  { id: 'ha-crowd',    name: 'Crowd analytics',    description: 'Density and flow analysis',           url: '/api/video/ha-crowd',    group: 'Hailo', camera: 'Hikvision DS-2CD2387G2' },
  { id: 'ha-drive',    name: 'Drive-thru monitor', description: 'Lane occupancy and wait time',        url: '/api/video/ha-drive',    group: 'Hailo', camera: 'Dahua IPC-Color4K' },
];

const GROUP_META: Record<StreamGroup, { color: string; sub: string }> = {
  Nvidia: { color: 'var(--ok)',      sub: 'GPU inference pipeline' },
  Hailo:  { color: 'var(--accent3)', sub: 'NPU inference pipeline' },
};

/** Probes each stream endpoint so the page can show which cameras are actually
 *  reachable without opening the full video streams: a plain fetch resolves as
 *  soon as response headers arrive, at which point the body is aborted so no
 *  video bytes keep flowing. Re-probes on an interval. */
function useStreamStatus(streams: VideoStream[], intervalMs = 30_000) {
  const [status, setStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let disposed = false;
    const controllers = new Set<AbortController>();

    const probe = () => {
      for (const s of streams) {
        const ctrl = new AbortController();
        controllers.add(ctrl);
        fetch(s.url, { signal: ctrl.signal, cache: 'no-store' })
          .then((res) => {
            if (!disposed) setStatus((prev) => ({ ...prev, [s.id]: res.ok }));
            ctrl.abort(); // headers are enough — kill the body stream
          })
          .catch(() => {
            // AbortError from our own cleanup must not mark the camera down.
            if (!disposed && !ctrl.signal.aborted) {
              setStatus((prev) => ({ ...prev, [s.id]: false }));
            }
          })
          .finally(() => controllers.delete(ctrl));
      }
    };

    probe();
    const t = window.setInterval(probe, intervalMs);
    return () => {
      disposed = true;
      window.clearInterval(t);
      controllers.forEach((c) => c.abort());
    };
  }, [streams, intervalMs]);

  return status;
}

export function VideoAnalyticsPage() {
  const nvidia = useMemo(() => STREAMS.filter((s) => s.group === 'Nvidia'), []);
  const hailo  = useMemo(() => STREAMS.filter((s) => s.group === 'Hailo'),  []);
  const status = useStreamStatus(STREAMS);

  const probedCount = Object.keys(status).length;
  const onlineCount = STREAMS.filter((s) => status[s.id]).length;

  // Camera models rolled up from per-stream reachability.
  const models = useMemo(() => {
    const m = new Map<string, { total: number; online: number; probed: number }>();
    for (const s of STREAMS) {
      const e = m.get(s.camera) ?? { total: 0, online: 0, probed: 0 };
      e.total += 1;
      if (status[s.id] !== undefined) e.probed += 1;
      if (status[s.id]) e.online += 1;
      m.set(s.camera, e);
    }
    return [...m.entries()];
  }, [status]);

  const onlineAccent = onlineCount === STREAMS.length ? 'var(--ok)' : onlineCount > 0 ? 'var(--warn)' : 'var(--err)';

  return (
    <>
      <PageHeader
        title="Video Analytics"
        subtitle="Live inference feeds from edge GPU and NPU pipelines. Each tile shows a preview — click Open to start the stream in fullscreen."
      />

      <div className="kpi-strip">
        <Kpi label="Cameras online" value={`${onlineCount} / ${STREAMS.length}`}
          sub={probedCount < STREAMS.length ? 'probing feeds…' : 'reachability · refreshed every 30 s'}
          icon={Video} accent={probedCount === 0 ? 'var(--accent)' : onlineAccent} />
        <Kpi label="Nvidia analytics" value={String(nvidia.length)} sub="GPU inference"           icon={Cpu}  accent="var(--ok)" />
        <Kpi label="Hailo analytics"  value={String(hailo.length)}  sub="NPU inference"           icon={Cpu}  accent="var(--accent3)" />
        <Kpi label="Transport"        value="RTSP / RTP / HTTP"     sub="camera → edge → dashboard" icon={Wifi} accent="var(--accent2)" />
      </div>

      <div className="grid">
        <div className="col-12">
          <Card
            title="Camera fleet"
            sub="Camera models behind the pipelines — reachability probed from the stream endpoints every 30 s."
            right={
              <span className={`badge ${onlineCount === STREAMS.length ? 'ok' : onlineCount > 0 ? 'warn' : 'err'}`}>
                {onlineCount}/{STREAMS.length} online
              </span>
            }
          >
            <div className="va-cam-strip">
              {models.map(([model, m]) => {
                const state = m.probed === 0 ? 'off' : m.online === m.total ? 'ok' : m.online > 0 ? 'warn' : 'err';
                return (
                  <span key={model} className="va-cam-chip" title={`${m.online} of ${m.total} cameras reachable`}>
                    <span className={`dot ${state}`} />
                    <span className="va-cam-model">{model}</span>
                    <span className="va-cam-count mono">{m.online}/{m.total}</span>
                  </span>
                );
              })}
            </div>
          </Card>
        </div>
        <div className="col-12">
          <StreamGroupCard group="Nvidia" streams={nvidia} status={status} />
        </div>
        <div className="col-12">
          <StreamGroupCard group="Hailo" streams={hailo} status={status} />
        </div>
      </div>
    </>
  );
}

function StreamGroupCard({ group, streams, status }: {
  group: StreamGroup;
  streams: VideoStream[];
  status: Record<string, boolean>;
}) {
  const meta = GROUP_META[group];
  return (
    <Card
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 22, height: 22, borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: meta.color,
            background: `linear-gradient(135deg, ${meta.color}33, transparent)`,
            border: '1px solid var(--border)',
          }}>
            <Cpu size={12} />
          </span>
          {group}
        </span>
      }
      sub={meta.sub}
      right={
        <span className="badge" style={{
          color: meta.color, borderColor: meta.color, background: `${meta.color}1a`,
        }}>
          {streams.length} streams
        </span>
      }
    >
      <div className="va-grid">
        {streams.map((s) => <StreamTile key={s.id} stream={s} active={status[s.id]} />)}
      </div>
    </Card>
  );
}

/* ─────────── Stream tile ─────────── */

function StreamTile({ stream, active }: { stream: VideoStream; active?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** When `true`, the <img> for the stream is mounted (network request fires). */
  const [isLive, setIsLive] = useState(false);
  const [errored, setErrored] = useState(false);
  /** Flips to `true` once the browser receives the first frame (img onLoad). */
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFsChange() {
      const inFs = document.fullscreenElement === containerRef.current;
      setIsFullscreen(inFs);
      // Exiting fullscreen → tear the stream down so the request stops.
      if (!inFs) {
        setIsLive(false);
        setErrored(false);
      }
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function openStream() {
    setErrored(false);
    setLoaded(false);
    setIsLive(true);
    // Request fullscreen after the image element is in the DOM.
    requestAnimationFrame(() => {
      containerRef.current?.requestFullscreen?.().catch(() => {
        // Fullscreen denied (e.g. user gesture lost) — still keep the stream open
        // inline so the click isn't a no-op.
      });
    });
  }

  function closeStream() {
    if (document.fullscreenElement === containerRef.current) {
      document.exitFullscreen().catch(() => {});
    }
    setIsLive(false);
    setErrored(false);
    setLoaded(false);
  }

  function retry() {
    setErrored(false);
    setLoaded(false);
    setVersion((v) => v + 1);
  }

  // Cache-buster on retry forces the browser to refetch the stream.
  const src = version === 0
    ? stream.url
    : `${stream.url}${stream.url.includes('?') ? '&' : '?'}r=${version}`;

  return (
    <div ref={containerRef} className={`va-tile ${isFullscreen ? 'is-fullscreen' : ''}`}>
      <div className="va-tile-head">
        {/* Open stream → live state; otherwise the probed camera reachability. */}
        <span className={`dot ${isLive
          ? (errored ? 'err' : 'ok')
          : active === undefined ? 'off' : active ? 'ok' : 'err'}`} />
        <div className="va-tile-name">
          <div className="va-tile-title">{stream.name}</div>
          <div className="va-tile-desc">{stream.camera} · {stream.description}</div>
        </div>
        {isLive && (
          <button
            className="va-tile-btn"
            onClick={retry}
            title="Reload stream"
            aria-label="Reload"
          >
            <RefreshCw size={13} />
          </button>
        )}
        {isLive && (
          <button
            className="va-tile-btn"
            onClick={closeStream}
            title="Close stream"
            aria-label="Close stream"
          >
            <Minimize2 size={14} />
          </button>
        )}
        {/* Balance the leading status dot so the title stays truly centred */}
        {!isLive && <span className="va-tile-head-balance" aria-hidden="true" />}
      </div>

      <div className="va-tile-body">
        {!isLive ? (
          <StreamThumbnail stream={stream} />
        ) : errored ? (
          <OfflinePlaceholder url={stream.url} onRetry={retry} />
        ) : (
          <>
            {/* The <img> is mounted as soon as `isLive` flips on so the network
                request starts; `onLoad` fires when the first MJPEG frame arrives,
                at which point we hide the loading placeholder. */}
            <img
              key={version}
              src={src}
              alt={stream.name}
              className="va-tile-stream"
              style={loaded ? undefined : { visibility: 'hidden' }}
              onLoad={() => setLoaded(true)}
              onError={() => setErrored(true)}
              draggable={false}
            />
            {!loaded && <LoadingPlaceholder name={stream.name} url={stream.url} />}
          </>
        )}
        {isLive && !errored && loaded && (
          <div className="va-live-badge">
            <span className="dot ok" />
            LIVE
          </div>
        )}
        {isFullscreen && (
          <button
            className="va-fs-exit"
            onClick={closeStream}
            title="Exit fullscreen (ESC)"
            aria-label="Exit fullscreen"
          >
            <Minimize2 size={16} />
            Exit fullscreen
          </button>
        )}
      </div>

      {!isLive && (
        <button
          className="va-open-btn"
          onClick={openStream}
          title={`Loads ${stream.url} and goes fullscreen`}
        >
          <Play size={14} fill="currentColor" />
          Open feed
          <Maximize2 size={12} style={{ opacity: 0.7 }} />
        </button>
      )}
    </div>
  );
}

function LoadingPlaceholder({ name, url }: { name: string; url: string }) {
  return (
    <div className="va-loading">
      <Loader2 size={28} className="spin" />
      <div className="va-loading-title">Video loading…</div>
      <div className="va-loading-sub">Buffering first frame for <strong>{name}</strong></div>
      <div className="va-offline-sub mono">{url}</div>
    </div>
  );
}

function OfflinePlaceholder({ url, onRetry }: { url: string; onRetry: () => void }) {
  return (
    <div className="va-offline">
      <AlertCircle size={28} />
      <div className="va-offline-title">Stream unavailable</div>
      <div className="va-offline-sub mono">{url}</div>
      <button className="va-tile-btn va-retry" onClick={onRetry}>
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

/* ─────────── Per-stream SVG illustrations ─────────── */

const VB = '0 0 320 180';

function StreamThumbnail({ stream }: { stream: VideoStream }) {
  return (
    <div className="va-thumb">
      <svg viewBox={VB} className="va-thumb-svg" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`vbg-${stream.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#1a1540" />
            <stop offset="100%" stopColor="#0a0820" />
          </linearGradient>
          <pattern id={`vg-${stream.id}`} width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="320" height="180" fill={`url(#vbg-${stream.id})`} />
        <rect width="320" height="180" fill={`url(#vg-${stream.id})`} />
        {/* dashed horizon to simulate camera "ground" */}
        <line x1="0" y1="155" x2="320" y2="155" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 4" />
        {renderScene(stream.id)}
      </svg>
      {/* camera-style corner markers */}
      <span className="va-thumb-corner tl" />
      <span className="va-thumb-corner tr" />
      <span className="va-thumb-corner bl" />
      <span className="va-thumb-corner br" />
    </div>
  );
}

/** Each scene draws the analytic's subject + a labelled bounding box. */
function renderScene(id: string): React.ReactNode {
  switch (id) {
    case 'nv-nanoowl': return SceneNanoOwl();
    case 'nv-violence': return SceneViolence();
    case 'nv-fall': return SceneFall();
    case 'nv-ppe': return ScenePpe();
    case 'nv-table': return SceneTable();
    case 'nv-weapon': return SceneWeapon();
    case 'nv-parking': return SceneParking();
    case 'ha-anpd': return SceneAnpr();
    case 'ha-intruder': return SceneIntruder();
    case 'ha-hairnet': return SceneHairnet();
    case 'ha-fire': return SceneFire();
    case 'ha-crowd': return SceneCrowd();
    case 'ha-drive': return SceneDriveThru();
    default: return null;
  }
}

/** Reusable bounding-box overlay drawn inside the SVG.
 *  `below` flips the label to render at the *bottom* edge of the box —
 *  useful when there's a face or other illustration above the box that
 *  the default top-anchored label would obscure. */
function BBox({
  x, y, w, h, color, label, below,
}: {
  x: number; y: number; w: number; h: number;
  color: string; label: string; below?: boolean;
}) {
  const labelW = Math.max(label.length * 5.8 + 8, 36);
  const labelY = below ? y + h : y - 11;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="3 2" />
      {[[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([cx, cy], i) => (
        <rect key={i} x={cx - 2} y={cy - 2} width="4" height="4" fill={color} />
      ))}
      <rect x={x} y={labelY} width={labelW} height="11" fill={color} />
      <text x={x + 4} y={labelY + 8} fontSize="8" fontWeight="700" fill="#0a0820" fontFamily="ui-monospace, monospace">{label}</text>
    </g>
  );
}

/* ── Nvidia ── */

function SceneNanoOwl() {
  // Friendly cartoon owl with AI-scanner eyes detecting some snacks.
  return (
    <g>
      {/* Owl */}
      <g transform="translate(82 102)">
        {/* body */}
        <ellipse cx="0" cy="22" rx="32" ry="36" fill="#a06a3a" />
        {/* belly */}
        <ellipse cx="0" cy="28" rx="20" ry="26" fill="#f4d2a0" />
        <g fill="none" stroke="#7c4f1f" strokeWidth="0.5" opacity="0.7">
          <path d="M -14 22 Q -7 25 0 22 Q 7 25 14 22" />
          <path d="M -12 32 Q -6 35 0 32 Q 6 35 12 32" />
          <path d="M -10 42 Q -5 45 0 42 Q 5 45 10 42" />
        </g>
        {/* wings */}
        <path d="M -28 6 Q -42 24 -26 48 L -20 32 Z" fill="#7c4f1f" />
        <path d="M 28 6 Q 42 24 26 48 L 20 32 Z" fill="#7c4f1f" />
        {/* head */}
        <circle cx="0" cy="-16" r="27" fill="#a06a3a" />
        {/* ear tufts */}
        <polygon points="-20,-32 -16,-44 -10,-30" fill="#7c4f1f" />
        <polygon points="20,-32 16,-44 10,-30" fill="#7c4f1f" />
        {/* face disc */}
        <ellipse cx="-9" cy="-13" rx="13" ry="16" fill="#f4d2a0" />
        <ellipse cx="9"  cy="-13" rx="13" ry="16" fill="#f4d2a0" />
        {/* eyes white */}
        <circle cx="-9" cy="-13" r="10" fill="#ffffff" />
        <circle cx="9"  cy="-13" r="10" fill="#ffffff" />
        {/* AI scanner iris */}
        <circle cx="-9" cy="-13" r="7.5" fill="#7cffd4" />
        <circle cx="9"  cy="-13" r="7.5" fill="#7cffd4" />
        <circle cx="-9" cy="-13" r="7.5" fill="none" stroke="#06d6a0" strokeWidth="0.8" />
        <circle cx="9"  cy="-13" r="7.5" fill="none" stroke="#06d6a0" strokeWidth="0.8" />
        {/* crosshairs */}
        <g stroke="#ff7bd6" strokeWidth="0.6" opacity="0.85">
          <line x1="-15" y1="-13" x2="-3" y2="-13" />
          <line x1="-9"  y1="-19" x2="-9" y2="-7" />
          <line x1="3"   y1="-13" x2="15" y2="-13" />
          <line x1="9"   y1="-19" x2="9"  y2="-7" />
        </g>
        {/* pupils */}
        <circle cx="-9" cy="-13" r="3.5" fill="#0a0820" />
        <circle cx="9"  cy="-13" r="3.5" fill="#0a0820" />
        {/* sparkle */}
        <circle cx="-7" cy="-15" r="1.3" fill="#ffffff" />
        <circle cx="11" cy="-15" r="1.3" fill="#ffffff" />
        {/* beak */}
        <polygon points="0,-2 -5,5 5,5" fill="#fbbf24" stroke="#d97706" strokeWidth="0.5" />
        <line x1="0" y1="0" x2="0" y2="5" stroke="#d97706" strokeWidth="0.4" />
        {/* feet */}
        <g stroke="#fbbf24" strokeWidth="3" strokeLinecap="round">
          <line x1="-10" y1="55" x2="-10" y2="62" />
          <line x1="10"  y1="55" x2="10"  y2="62" />
        </g>
      </g>
      {/* Speech bubble */}
      <g transform="translate(155 50)">
        <path d="M -28 -10 Q -32 -10 -32 -4 L -32 10 Q -32 16 -26 16 L -22 16 L -28 22 L -16 16 L 28 16 Q 32 16 32 10 L 32 -4 Q 32 -10 28 -10 Z" fill="#ffffff" stroke="#7cffd4" strokeWidth="1" />
        <text x="0" y="6" fontSize="10" fontWeight="800" fill="#0a0820" textAnchor="middle" fontFamily="'Space Grotesk', system-ui, sans-serif">I SEE YOU!</text>
      </g>
      {/* Rubber duck */}
      <g transform="translate(228 122)">
        <ellipse cx="0" cy="0" rx="20" ry="14" fill="#fbbf24" />
        <ellipse cx="0" cy="3" rx="16" ry="9" fill="#fde047" opacity="0.55" />
        <circle cx="-14" cy="-9" r="11" fill="#fbbf24" />
        <circle cx="-17" cy="-11" r="2.5" fill="#0a0820" />
        <circle cx="-16" cy="-12" r="0.9" fill="#ffffff" />
        <polygon points="-24,-8 -32,-6 -24,-3" fill="#f97316" />
        <path d="M 0 -3 Q 9 -3 11 5 Q 9 7 -2 6 Z" fill="#f59e0b" />
        <path d="M -22 14 Q -10 17 0 14 Q 10 17 22 14" stroke="#7cffd4" strokeWidth="1" fill="none" opacity="0.6" />
      </g>
      <BBox x={196} y={98} w={56} h={42} color="#fb7185" label="duck 0.87" />
      {/* Donut */}
      <g transform="translate(268 65)">
        <circle cx="0" cy="0" r="14" fill="#d4946a" stroke="#a06a3a" strokeWidth="1" />
        <path d="M -12 -2 Q -10 -11 -2 -13 Q 6 -13 11 -8 Q 13 1 9 8 Q 4 13 -3 12 Q -10 9 -12 2 Z" fill="#ff7bd6" />
        <circle cx="0" cy="0" r="4" fill="#1a1540" />
        <g strokeWidth="1.4" strokeLinecap="round">
          <line x1="-7" y1="-4" x2="-5" y2="-1" stroke="#fbbf24" />
          <line x1="3"  y1="-9" x2="4"  y2="-5" stroke="#7cffd4" />
          <line x1="7"  y1="4"  x2="9"  y2="6"  stroke="#fbbf24" />
          <line x1="-3" y1="7"  x2="-1" y2="9"  stroke="#7cffd4" />
        </g>
      </g>
      <BBox x={250} y={45} w={36} h={40} color="#fbbf24" label="donut 0.96" />
      {/* Owl bbox */}
      <BBox x={48} y={50} w={70} h={110} color="#7cffd4" label="owl 0.99" />
    </g>
  );
}

function SceneViolence() {
  // Two cartoon fighters with a "POW!" starburst between them.
  return (
    <g>
      {/* ground */}
      <line x1="0" y1="160" x2="320" y2="160" stroke="rgba(196,190,224,0.3)" />
      {/* dust cloud */}
      <g fill="rgba(196,190,224,0.16)">
        <circle cx="120" cy="160" r="14" />
        <circle cx="160" cy="158" r="20" />
        <circle cx="200" cy="160" r="14" />
        <circle cx="105" cy="162" r="8" />
        <circle cx="215" cy="162" r="8" />
      </g>
      {/* motion swooshes */}
      <g stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M 35 60 Q 55 65 70 65" opacity="0.6" />
        <path d="M 30 80 L 60 80" opacity="0.6" />
        <path d="M 255 55 Q 270 60 285 60" opacity="0.6" />
        <path d="M 260 78 L 290 78" opacity="0.6" />
      </g>

      {/* Fighter A — punching, red */}
      <g transform="translate(95 105)">
        {/* legs */}
        <path d="M -10 28 L -8 50 L -2 50 L -1 28 Z" fill="#1e293b" />
        <path d="M 3  28 L 5  50 L 11 50 L 11 28 Z" fill="#1e293b" />
        <ellipse cx="-5" cy="52" rx="6" ry="2" fill="#0a0820" />
        <ellipse cx="8"  cy="52" rx="6" ry="2" fill="#0a0820" />
        {/* torso (tank top) */}
        <path d="M -14 -14 L 14 -14 L 16 28 L -16 28 Z" fill="#991b1b" />
        <path d="M -10 -14 L -10 -8 L 10 -8 L 10 -14 Z" fill="#7f1d1d" />
        {/* back arm */}
        <path d="M -14 -12 L -22 0 L -16 8 L -10 -2 Z" fill="#f5d2a8" />
        {/* punching arm */}
        <path d="M 12 -12 L 38 -8 L 50 -10 L 52 -3 L 44 0 L 28 0 L 14 -2 Z" fill="#f5d2a8" />
        <circle cx="50" cy="-5" r="7" fill="#f5d2a8" stroke="#0a0820" strokeWidth="0.7" />
        <g stroke="#0a0820" strokeWidth="0.5" fill="none">
          <path d="M 46 -10 L 46 -2" />
          <path d="M 49 -10 L 49 -2" />
          <path d="M 52 -10 L 52 -2" />
        </g>
        {/* head */}
        <circle cx="0" cy="-28" r="13" fill="#f5d2a8" />
        {/* hair — red mohawk */}
        <path d="M -11 -36 Q -3 -46 0 -42 Q 3 -46 11 -36 L 11 -32 L -11 -32 Z" fill="#dc2626" />
        <polygon points="-3,-44 0,-50 3,-44" fill="#dc2626" />
        {/* angry brows */}
        <path d="M -7 -33 L -2 -31" stroke="#0a0820" strokeWidth="2" strokeLinecap="round" />
        <path d="M 2  -31 L 7 -33" stroke="#0a0820" strokeWidth="2" strokeLinecap="round" />
        {/* eyes */}
        <circle cx="-4" cy="-27" r="1.5" fill="#0a0820" />
        <circle cx="4"  cy="-27" r="1.5" fill="#0a0820" />
        {/* gritted teeth */}
        <path d="M -5 -21 L 5 -21 L 5 -18 L -5 -18 Z" fill="#ffffff" stroke="#0a0820" strokeWidth="0.5" />
        <line x1="-2" y1="-21" x2="-2" y2="-18" stroke="#0a0820" strokeWidth="0.4" />
        <line x1="2"  y1="-21" x2="2"  y2="-18" stroke="#0a0820" strokeWidth="0.4" />
        {/* anger marks */}
        <g stroke="#fbbf24" strokeWidth="1.5" fill="none">
          <path d="M -16 -42 L -10 -42 M -14 -45 L -12 -39" />
        </g>
      </g>

      {/* POW! starburst */}
      <g transform="translate(165 92)">
        <polygon
          points="-24,-2 -10,-5 -4,-20 0,-6 12,-16 8,-2 24,0 11,6 18,22 5,12 0,26 -4,12 -16,20 -10,5 -26,5"
          fill="#fbbf24" stroke="#d97706" strokeWidth="1.5" strokeLinejoin="round"
        />
        <polygon
          points="-14,0 -6,-3 -2,-12 0,-3 8,-9 5,0 14,2 6,5 10,13 3,8 0,15 -3,8 -10,12 -6,3 -16,3"
          fill="#fef08a"
        />
        <text x="0" y="5" fontSize="11" fontWeight="900" fill="#dc2626" textAnchor="middle" fontFamily="'Space Grotesk', system-ui, sans-serif">POW!</text>
      </g>

      {/* Fighter B — taking the hit, blue */}
      <g transform="translate(225 108)">
        {/* legs (off-balance) */}
        <path d="M -10 25 L -8 50 L -2 50 L -1 25 Z" fill="#1e293b" transform="rotate(-3 -6 38)" />
        <path d="M 3  25 L 5  50 L 11 50 L 11 25 Z" fill="#1e293b" transform="rotate(5 7 38)" />
        <ellipse cx="-5" cy="52" rx="6" ry="2" fill="#0a0820" />
        <ellipse cx="8"  cy="52" rx="6" ry="2" fill="#0a0820" />
        {/* torso */}
        <path d="M -14 -14 L 14 -14 L 16 25 L -16 25 Z" fill="#1d4ed8" />
        <path d="M -10 -14 L -10 -8 L 10 -8 L 10 -14 Z" fill="#1e40af" />
        {/* arms flailing */}
        <path d="M -14 -12 L -28 -4 L -32 4 L -25 4 L -10 0 Z" fill="#f5d2a8" />
        <path d="M 14 -12 L 24 -6 L 26 4 L 18 4 L 10 -2 Z" fill="#f5d2a8" />
        {/* head — tilted from impact */}
        <g transform="rotate(18 0 -22)">
          <circle cx="0" cy="-26" r="13" fill="#f5d2a8" />
          {/* hair — blue */}
          <path d="M -11 -34 Q 0 -42 11 -34 L 11 -30 L -11 -30 Z" fill="#3b82f6" />
          {/* X eyes */}
          <g stroke="#0a0820" strokeWidth="1.5" strokeLinecap="round">
            <line x1="-7" y1="-29" x2="-2" y2="-23" />
            <line x1="-7" y1="-23" x2="-2" y2="-29" />
            <line x1="2"  y1="-29" x2="7"  y2="-23" />
            <line x1="2"  y1="-23" x2="7"  y2="-29" />
          </g>
          {/* O mouth */}
          <ellipse cx="0" cy="-17" rx="3" ry="4" fill="#0a0820" />
        </g>
        {/* sweat */}
        <g fill="#7cffd4">
          <path d="M 14 -38 Q 16 -36 16 -34 Q 14 -34 12 -36 Z" />
          <path d="M 20 -42 Q 22 -40 22 -38 Q 20 -38 18 -40 Z" />
        </g>
      </g>

      <BBox x={62} y={50} w={195} h={108} color="#ff5577" label="VIOLENCE 0.94" />
    </g>
  );
}

function SceneFall() {
  // Cartoon character slipping on a banana peel mid-fall.
  return (
    <g>
      {/* floor */}
      <line x1="0" y1="158" x2="320" y2="158" stroke="rgba(196,190,224,0.4)" strokeWidth="1" />
      {/* floor tiles hint */}
      <g stroke="rgba(196,190,224,0.06)" strokeWidth="0.5">
        <line x1="40"  y1="160" x2="100" y2="178" />
        <line x1="160" y1="160" x2="200" y2="178" />
        <line x1="260" y1="160" x2="290" y2="178" />
      </g>
      {/* motion arc */}
      <path d="M 70 60 Q 130 80 200 130" fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="3 3" />
      {/* swoosh lines */}
      <g stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" opacity="0.7">
        <line x1="55" y1="80" x2="68" y2="78" />
        <line x1="50" y1="95" x2="62" y2="92" />
        <line x1="45" y1="110" x2="58" y2="108" />
      </g>

      {/* Banana peel on floor */}
      <g transform="translate(115 153)">
        <path d="M -22 0 Q -25 -6 -18 -8 Q -10 -8 -8 -4 Q -2 -2 4 -6 Q 12 -8 18 -4 Q 22 0 18 4 Q 8 6 -2 4 Q -10 6 -18 4 Q -24 4 -22 0 Z" fill="#fde047" stroke="#d97706" strokeWidth="1" />
        <path d="M -18 -3 Q -10 -3 -2 -1 Q 6 -3 14 -1" fill="none" stroke="#a16207" strokeWidth="0.7" />
        <ellipse cx="0" cy="-1" rx="3" ry="1.5" fill="#fffbeb" opacity="0.7" />
      </g>

      {/* Person mid-fall — rotated */}
      <g transform="translate(175 105) rotate(58)">
        {/* legs flailing up */}
        <path d="M -8 -10 L -22 -32 L -16 -36 L -2 -14 Z" fill="#1e3a8a" />
        <path d="M 8 -10 L 22 -36 L 16 -40 L 2 -14 Z" fill="#1e3a8a" />
        {/* shoes flying off feeling */}
        <ellipse cx="-22" cy="-34" rx="4" ry="2" fill="#0a0820" />
        <ellipse cx="22"  cy="-38" rx="4" ry="2" fill="#0a0820" />
        {/* torso */}
        <path d="M -12 -12 L 12 -12 L 14 16 L -14 16 Z" fill="#ec4899" />
        {/* belt */}
        <rect x="-14" y="10" width="28" height="3" fill="#0a0820" />
        {/* arms flailing wide */}
        <path d="M -12 -10 L -28 -8 L -34 0 L -26 4 L -10 0 Z" fill="#f5d2a8" />
        <path d="M 12 -10 L 28 -8 L 34 0 L 26 4 L 10 0 Z" fill="#f5d2a8" />
        {/* head */}
        <circle cx="0" cy="-22" r="11" fill="#f5d2a8" />
        {/* hair */}
        <path d="M -10 -28 Q 0 -36 10 -28 L 10 -24 L -10 -24 Z" fill="#5b3a17" />
        {/* eyes — wide surprised */}
        <circle cx="-4" cy="-22" r="3" fill="#ffffff" />
        <circle cx="4"  cy="-22" r="3" fill="#ffffff" />
        <circle cx="-4" cy="-22" r="1.5" fill="#0a0820" />
        <circle cx="4"  cy="-22" r="1.5" fill="#0a0820" />
        {/* mouth — big O */}
        <ellipse cx="0" cy="-16" rx="2.5" ry="3.5" fill="#0a0820" />
      </g>

      {/* Speech bubble */}
      <g transform="translate(245 55)">
        <path d="M -26 -12 Q -30 -12 -30 -6 L -30 8 Q -30 14 -24 14 L -16 14 L -20 22 L -8 14 L 24 14 Q 30 14 30 8 L 30 -6 Q 30 -12 24 -12 Z" fill="#ffffff" stroke="#ff5577" strokeWidth="1.2" />
        <text x="0" y="6" fontSize="13" fontWeight="900" fill="#dc2626" textAnchor="middle" fontFamily="'Space Grotesk', system-ui, sans-serif">AAAH!</text>
      </g>

      <BBox x={130} y={62} w={110} h={96} color="#ff5577" label="FALL 0.96" />
    </g>
  );
}

function ScenePpe() {
  // Cheerful construction worker giving a thumbs-up in full gear.
  return (
    <g>
      {/* floor */}
      <line x1="40" y1="170" x2="280" y2="170" stroke="rgba(196,190,224,0.3)" />
      {/* warning sign in background */}
      <g transform="translate(56 78)">
        <polygon points="0,-20 20,16 -20,16" fill="#fbbf24" stroke="#92400e" strokeWidth="1.5" />
        <text x="0" y="10" fontSize="16" fontWeight="900" fill="#0a0820" textAnchor="middle">!</text>
      </g>

      {/* Worker */}
      <g transform="translate(170 100)">
        {/* legs / work pants */}
        <path d="M -16 30 L -14 60 L -4 60 L -3 30 Z" fill="#1e3a8a" />
        <path d="M 3 30 L 4 60 L 14 60 L 16 30 Z" fill="#1e3a8a" />
        <rect x="-16" y="58" width="13" height="6" fill="#92400e" />
        <rect x="3"   y="58" width="13" height="6" fill="#92400e" />
        {/* tool belt */}
        <rect x="-22" y="26" width="44" height="6" fill="#451a03" />
        <rect x="-18" y="28" width="3" height="6" fill="#92400e" />
        <circle cx="14" cy="32" r="3" fill="#fbbf24" stroke="#92400e" strokeWidth="0.6" />
        {/* high-vis vest body */}
        <path d="M -22 -10 L 22 -10 L 24 30 L -24 30 Z" fill="#4ade80" stroke="#10b981" strokeWidth="1.5" />
        {/* vest opening */}
        <path d="M -2 -10 L 0 30 L 2 -10 Z" fill="#bbf7d0" stroke="#10b981" strokeWidth="0.6" />
        {/* reflective stripes */}
        <rect x="-22" y="6"  width="44" height="3.5" fill="#fbbf24" />
        <rect x="-22" y="18" width="44" height="3.5" fill="#fbbf24" />
        {/* shirt under (white) */}
        <path d="M -16 -16 L 16 -16 L 16 -10 L -16 -10 Z" fill="#ffffff" />
        {/* shoulders */}
        <ellipse cx="-22" cy="-10" rx="6" ry="5" fill="#4ade80" />
        <ellipse cx="22"  cy="-10" rx="6" ry="5" fill="#4ade80" />
        {/* thumbs-up arm (right) */}
        <path d="M 22 -8 L 38 -22 L 36 -30 L 30 -28 L 16 -14 Z" fill="#f5d2a8" />
        {/* hand making thumbs-up */}
        <g transform="translate(36 -30)">
          <circle cx="0" cy="0" r="6" fill="#f5d2a8" stroke="#0a0820" strokeWidth="0.5" />
          <path d="M -2 -6 Q 2 -10 4 -6 L 4 0 L -2 0 Z" fill="#f5d2a8" stroke="#0a0820" strokeWidth="0.5" />
        </g>
        {/* other arm */}
        <path d="M -22 -8 L -32 4 L -28 10 L -16 -2 Z" fill="#f5d2a8" />
        {/* head */}
        <circle cx="0" cy="-30" r="14" fill="#f5d2a8" />
        {/* mustache */}
        <path d="M -8 -26 Q -4 -23 0 -25 Q 4 -23 8 -26" stroke="#5b3a17" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {/* eyes (behind safety glasses) */}
        <ellipse cx="-5" cy="-32" rx="4" ry="3" fill="#ffffff" />
        <ellipse cx="5"  cy="-32" rx="4" ry="3" fill="#ffffff" />
        <circle cx="-5" cy="-32" r="1.5" fill="#0a0820" />
        <circle cx="5"  cy="-32" r="1.5" fill="#0a0820" />
        {/* Safety glasses frame */}
        <g fill="none" stroke="#0a0820" strokeWidth="1">
          <rect x="-10" y="-36" width="9" height="7" rx="1.5" />
          <rect x="1"   y="-36" width="9" height="7" rx="1.5" />
          <line x1="-1" y1="-33" x2="1" y2="-33" />
          <line x1="-10" y1="-35" x2="-13" y2="-35" />
          <line x1="10"  y1="-35" x2="13"  y2="-35" />
        </g>
        {/* tint on glasses */}
        <rect x="-10" y="-36" width="9" height="7" rx="1.5" fill="rgba(124,255,212,0.35)" />
        <rect x="1"   y="-36" width="9" height="7" rx="1.5" fill="rgba(124,255,212,0.35)" />
        {/* smile */}
        <path d="M -5 -22 Q 0 -18 5 -22" fill="none" stroke="#0a0820" strokeWidth="1.5" strokeLinecap="round" />
        {/* Hard hat */}
        <path d="M -16 -38 Q 0 -56 16 -38 L 18 -32 L -18 -32 Z" fill="#fbbf24" stroke="#d97706" strokeWidth="1" />
        <rect x="-18" y="-32" width="36" height="4" fill="#f59e0b" />
        <rect x="-3" y="-50" width="6" height="3" fill="#dc2626" />
        {/* helmet brim shadow */}
        <ellipse cx="0" cy="-32" rx="18" ry="2" fill="rgba(0,0,0,0.2)" />
      </g>

      {/* check marks for each PPE item */}
      <g transform="translate(255 70)">
        <g transform="translate(0 0)">
          <circle cx="0" cy="0" r="9" fill="#10b981" />
          <path d="M -4 0 L -1 3 L 4 -2" stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
        <text x="14" y="3" fontSize="9" fontWeight="700" fill="#4ade80" fontFamily="ui-monospace, monospace">HELMET</text>
        <g transform="translate(0 22)">
          <circle cx="0" cy="0" r="9" fill="#10b981" />
          <path d="M -4 0 L -1 3 L 4 -2" stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
        <text x="14" y="25" fontSize="9" fontWeight="700" fill="#4ade80" fontFamily="ui-monospace, monospace">VEST</text>
        <g transform="translate(0 44)">
          <circle cx="0" cy="0" r="9" fill="#10b981" />
          <path d="M -4 0 L -1 3 L 4 -2" stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
        <text x="14" y="47" fontSize="9" fontWeight="700" fill="#4ade80" fontFamily="ui-monospace, monospace">EYES</text>
      </g>

      <BBox x={132} y={42} w={78} h={120} color="#4ade80" label="PPE COMPLIANT" />
    </g>
  );
}

function SceneTable() {
  // Side-view restaurant: two diners enjoying a meal, with a waiter passing by.
  return (
    <g>
      {/* Floor & back wall */}
      <rect x="0" y="0" width="320" height="120" fill="rgba(40,30,70,0.4)" />
      <line x1="0" y1="120" x2="320" y2="120" stroke="rgba(196,190,224,0.4)" />
      {/* faint wall art */}
      <rect x="32" y="22" width="38" height="28" fill="rgba(124,255,212,0.08)" stroke="rgba(124,255,212,0.35)" strokeWidth="0.7" />
      <path d="M 38 42 L 44 32 L 50 38 L 56 28 L 64 44 Z" fill="rgba(124,255,212,0.25)" />
      <circle cx="58" cy="30" r="2" fill="#fbbf24" />

      {/* Table — long, with cloth */}
      <g>
        {/* table top */}
        <rect x="60" y="110" width="200" height="14" fill="#8b5e34" stroke="#5b3a17" strokeWidth="1" />
        {/* tablecloth */}
        <path d="M 70 124 L 250 124 L 240 152 L 80 152 Z" fill="#dc2626" stroke="#991b1b" strokeWidth="1" />
        <path d="M 70 124 L 80 152 L 78 152 L 68 124 Z" fill="#991b1b" />
        <path d="M 250 124 L 240 152 L 242 152 L 252 124 Z" fill="#991b1b" />
        {/* trim */}
        <line x1="78" y1="146" x2="242" y2="146" stroke="#fbbf24" strokeWidth="1" strokeDasharray="3 3" />
      </g>

      {/* Plate + steamy food (left) */}
      <g transform="translate(105 108)">
        <ellipse cx="0" cy="4" rx="18" ry="3" fill="rgba(0,0,0,0.3)" />
        <ellipse cx="0" cy="0" rx="18" ry="4" fill="#ffffff" stroke="#c4bee0" strokeWidth="0.7" />
        {/* food mound */}
        <path d="M -10 -2 Q -5 -10 0 -8 Q 5 -12 8 -6 Q 12 -2 10 -1 Z" fill="#a3651b" />
        <circle cx="-3" cy="-6" r="2" fill="#dc2626" />
        <circle cx="4" cy="-7" r="1.5" fill="#fbbf24" />
        {/* steam */}
        <g fill="none" stroke="#ffffff" strokeWidth="1.2" opacity="0.7" strokeLinecap="round">
          <path d="M -6 -14 Q -8 -20 -5 -26 Q -2 -32 -5 -36" />
          <path d="M 3  -14 Q 1 -20 4 -26 Q 7 -32 4 -36" />
        </g>
      </g>

      {/* Drink glass (left) */}
      <g transform="translate(140 105)">
        <path d="M -6 0 L 6 0 L 5 14 L -5 14 Z" fill="rgba(124,255,212,0.5)" stroke="#7cffd4" strokeWidth="0.8" />
        <ellipse cx="0" cy="0" rx="6" ry="1.5" fill="#7cffd4" />
        {/* straw */}
        <line x1="2" y1="-6" x2="3" y2="10" stroke="#ff7bd6" strokeWidth="1.5" />
      </g>

      {/* Plate + drink (right) — almost empty */}
      <g transform="translate(215 108)">
        <ellipse cx="0" cy="4" rx="18" ry="3" fill="rgba(0,0,0,0.3)" />
        <ellipse cx="0" cy="0" rx="18" ry="4" fill="#ffffff" stroke="#c4bee0" strokeWidth="0.7" />
        {/* crumbs */}
        <circle cx="-6" cy="-1" r="1" fill="#a3651b" />
        <circle cx="3" cy="-2" r="1.2" fill="#a3651b" />
        <circle cx="8" cy="-1" r="0.8" fill="#a3651b" />
      </g>
      <g transform="translate(180 105)">
        <path d="M -5 0 L 5 0 L 4 12 L -4 12 Z" fill="rgba(192,132,252,0.4)" stroke="#c084fc" strokeWidth="0.8" />
        <ellipse cx="0" cy="0" rx="5" ry="1.2" fill="#c084fc" />
      </g>

      {/* Diner LEFT — happy, eating with a fork */}
      <g transform="translate(105 75)">
        {/* chair back */}
        <path d="M -18 36 L -18 56 L 18 56 L 18 36 Z" fill="rgba(124,255,212,0.15)" stroke="#7cffd4" strokeWidth="0.8" />
        <line x1="-12" y1="42" x2="12" y2="42" stroke="#7cffd4" strokeWidth="0.6" />
        <line x1="-12" y1="50" x2="12" y2="50" stroke="#7cffd4" strokeWidth="0.6" />
        {/* torso */}
        <path d="M -16 8 L 16 8 L 20 38 L -20 38 Z" fill="#7cffd4" />
        {/* head */}
        <circle cx="0" cy="-8" r="14" fill="#f5d2a8" />
        {/* hair */}
        <path d="M -13 -16 Q 0 -24 13 -16 L 13 -10 L -13 -10 Z" fill="#5b3a17" />
        {/* big happy eyes (closed/squinting) */}
        <path d="M -6 -8 Q -3 -11 0 -8" stroke="#0a0820" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M 0  -8 Q 3 -11 6 -8" stroke="#0a0820" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* huge smile */}
        <path d="M -6 0 Q 0 6 6 0" stroke="#0a0820" strokeWidth="1.5" fill="#dc2626" strokeLinecap="round" />
        {/* cheek blush */}
        <circle cx="-9" cy="-2" r="2.5" fill="#f5b3a8" opacity="0.6" />
        <circle cx="9"  cy="-2" r="2.5" fill="#f5b3a8" opacity="0.6" />
        {/* arm holding fork */}
        <path d="M 16 12 L 28 0 L 30 -8 L 24 -10 L 14 4 Z" fill="#f5d2a8" />
        {/* fork */}
        <g transform="translate(28 -12)">
          <line x1="0" y1="0" x2="0" y2="-8" stroke="#c4bee0" strokeWidth="1" />
          <line x1="-2" y1="-8" x2="-2" y2="-12" stroke="#c4bee0" strokeWidth="0.8" />
          <line x1="0"  y1="-8" x2="0"  y2="-12" stroke="#c4bee0" strokeWidth="0.8" />
          <line x1="2"  y1="-8" x2="2"  y2="-12" stroke="#c4bee0" strokeWidth="0.8" />
        </g>
        {/* "yum!" bubble */}
        <g transform="translate(30 -28)">
          <ellipse cx="0" cy="0" rx="18" ry="9" fill="#ffffff" stroke="#fbbf24" strokeWidth="0.8" />
          <polygon points="-10,7 -16,12 -6,10" fill="#ffffff" stroke="#fbbf24" strokeWidth="0.8" />
          <text x="0" y="3" fontSize="9" fontWeight="800" fill="#dc2626" textAnchor="middle">YUM!</text>
        </g>
      </g>

      {/* Diner RIGHT — chatting */}
      <g transform="translate(215 78)">
        {/* chair */}
        <path d="M -18 33 L -18 53 L 18 53 L 18 33 Z" fill="rgba(124,255,212,0.15)" stroke="#7cffd4" strokeWidth="0.8" />
        <line x1="-12" y1="39" x2="12" y2="39" stroke="#7cffd4" strokeWidth="0.6" />
        {/* torso */}
        <path d="M -15 8 L 15 8 L 18 35 L -18 35 Z" fill="#c084fc" />
        {/* head */}
        <circle cx="0" cy="-8" r="13" fill="#f5d2a8" />
        {/* hair (curly) */}
        <path d="M -12 -16 Q -10 -22 -4 -22 Q 0 -26 4 -22 Q 10 -22 12 -16 L 12 -10 L -12 -10 Z" fill="#3a2818" />
        <circle cx="-8" cy="-19" r="3" fill="#3a2818" />
        <circle cx="0"  cy="-21" r="3" fill="#3a2818" />
        <circle cx="8"  cy="-19" r="3" fill="#3a2818" />
        {/* eyes */}
        <circle cx="-4" cy="-7" r="1.7" fill="#0a0820" />
        <circle cx="4"  cy="-7" r="1.7" fill="#0a0820" />
        {/* talking mouth */}
        <ellipse cx="0" cy="0" rx="3" ry="2" fill="#0a0820" />
        {/* arms — gesturing */}
        <path d="M -15 14 L -22 18 L -24 24 L -16 22 Z" fill="#f5d2a8" />
        <path d="M 15 14 L 22 6 L 22 -2 L 16 0 Z" fill="#f5d2a8" />
      </g>

      {/* Waiter walking by (background) */}
      <g transform="translate(285 70)">
        {/* tray */}
        <ellipse cx="0" cy="-12" rx="14" ry="2.5" fill="#451a03" stroke="#5b3a17" strokeWidth="0.6" />
        <rect x="-3" y="-18" width="6" height="6" rx="1" fill="#7cffd4" />
        {/* arm */}
        <path d="M 0 -10 L 4 0 L 8 4 L 4 6 Z" fill="#f5d2a8" />
        {/* body */}
        <path d="M -8 0 L 8 0 L 10 26 L -10 26 Z" fill="#1e293b" />
        <line x1="-3" y1="2" x2="-3" y2="22" stroke="#ffffff" strokeWidth="0.5" />
        <line x1="3"  y1="2" x2="3"  y2="22" stroke="#ffffff" strokeWidth="0.5" />
        {/* head */}
        <circle cx="0" cy="-4" r="8" fill="#f5d2a8" />
        <path d="M -7 -8 Q 0 -14 7 -8 L 7 -4 L -7 -4 Z" fill="#3a2818" />
        <circle cx="-2" cy="-4" r="0.8" fill="#0a0820" />
        <circle cx="2"  cy="-4" r="0.8" fill="#0a0820" />
        {/* legs */}
        <line x1="-3" y1="26" x2="-5" y2="42" stroke="#1e293b" strokeWidth="4" />
        <line x1="3"  y1="26" x2="5"  y2="42" stroke="#1e293b" strokeWidth="4" />
      </g>

      <BBox x={75} y={48} w={170} h={110} color="#fbbf24" label="OCCUPIED · 2 GUESTS" />
    </g>
  );
}

function SceneWeapon() {
  // Cartoon stick-em-up scene: classic burglar in stripes + eye mask waving
  // an oversized revolver at a panicked bank teller. Real (cartoon) weapon,
  // matching the friendly toon style of the violence/fire scenes.
  return (
    <g>
      {/* Bank interior — beige walls + tile floor */}
      <rect x="0" y="0" width="320" height="125" fill="rgba(70,55,30,0.30)" />
      <rect x="0" y="125" width="320" height="30" fill="rgba(40,30,15,0.40)" />
      <g stroke="rgba(255,255,255,0.10)" strokeWidth="0.6">
        <line x1="0" y1="125" x2="320" y2="125" />
        <line x1="0" y1="138" x2="320" y2="138" />
        <line x1="50" y1="125" x2="50" y2="155" />
        <line x1="120" y1="125" x2="120" y2="155" />
        <line x1="200" y1="125" x2="200" y2="155" />
        <line x1="270" y1="125" x2="270" y2="155" />
      </g>

      {/* "BANK" sign on the wall behind */}
      <g transform="translate(248 18)">
        <rect x="-30" y="-8" width="60" height="20" rx="2" fill="#34a853" stroke="#1c4a26" strokeWidth="1" />
        <text x="0" y="6" textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff" fontFamily="'Space Grotesk', system-ui, sans-serif">BANK</text>
        <circle cx="-22" cy="2" r="2" fill="#fbbf24" />
        <circle cx="22"  cy="2" r="2" fill="#fbbf24" />
      </g>

      {/* Bank counter */}
      <rect x="170" y="92" width="148" height="40" fill="#8b5e34" stroke="#5b3a17" strokeWidth="1" />
      <line x1="170" y1="100" x2="318" y2="100" stroke="#5b3a17" strokeWidth="0.6" />
      {/* counter window bars */}
      <g stroke="#c4bee0" strokeWidth="1">
        <line x1="200" y1="92" x2="200" y2="78" />
        <line x1="220" y1="92" x2="220" y2="78" />
        <line x1="240" y1="92" x2="240" y2="78" />
        <line x1="200" y1="78" x2="240" y2="78" />
      </g>

      {/* Money bag on counter — gigantic $ sack */}
      <g transform="translate(280 95)">
        <path d="M -16 -4 Q -18 14 0 14 Q 18 14 16 -4 L 12 -8 L -12 -8 Z" fill="#fbbf24" stroke="#92400e" strokeWidth="1" />
        <rect x="-12" y="-10" width="24" height="4" rx="1" fill="#92400e" />
        <text x="0" y="9" textAnchor="middle" fontSize="11" fontWeight="900" fill="#92400e" fontFamily="'Space Grotesk', system-ui, sans-serif">$</text>
      </g>

      {/* Falling coins around the bag */}
      <g fill="#fbbf24" stroke="#92400e" strokeWidth="0.5">
        <circle cx="258" cy="118" r="3" />
        <text x="258" y="121" textAnchor="middle" fontSize="4" fontWeight="900" fill="#92400e">$</text>
        <circle cx="306" cy="124" r="2.5" />
        <text x="306" y="126.5" textAnchor="middle" fontSize="4" fontWeight="900" fill="#92400e">$</text>
      </g>

      {/* TELLER (right side) — panicked, hands up */}
      <g transform="translate(218 82)">
        {/* shirt visible above counter */}
        <path d="M -16 6 L 16 6 L 18 12 L -18 12 Z" fill="#5ac8ff" />
        {/* head */}
        <circle cx="0" cy="-10" r="13" fill="#f5d2a8" />
        {/* hair */}
        <path d="M -12 -18 Q 0 -26 12 -18 L 12 -14 L -12 -14 Z" fill="#5b3a17" />
        {/* terrified wide eyes */}
        <circle cx="-4" cy="-10" r="3" fill="#fff" />
        <circle cx="4"  cy="-10" r="3" fill="#fff" />
        <circle cx="-4" cy="-10" r="1.4" fill="#0a0820" />
        <circle cx="4"  cy="-10" r="1.4" fill="#0a0820" />
        {/* sweat drop */}
        <path d="M 10 -16 Q 12 -10 10 -8 Q 8 -10 10 -16 Z" fill="#5ac8ff" />
        {/* O-shaped scream mouth */}
        <ellipse cx="0" cy="-3" rx="2.5" ry="3.5" fill="#7a1818" />
        {/* hands up above the head */}
        <circle cx="-16" cy="-20" r="3.5" fill="#f5d2a8" />
        <circle cx="16"  cy="-20" r="3.5" fill="#f5d2a8" />
        <path d="M -16 -16 L -18 -10 L -14 -10 Z" fill="#f5d2a8" />
        <path d="M 16  -16 L 14 -10 L 18 -10 Z" fill="#f5d2a8" />
        {/* "AAA!" speech bubble */}
        <g transform="translate(-28 -32)">
          <ellipse cx="0" cy="0" rx="14" ry="9" fill="#fff" stroke="#0a0820" strokeWidth="0.8" />
          <path d="M 4 8 L 8 14 L 10 6 Z" fill="#fff" stroke="#0a0820" strokeWidth="0.8" />
          <text x="0" y="3" textAnchor="middle" fontSize="9" fontWeight="900" fill="#dc2626" fontFamily="'Space Grotesk', system-ui, sans-serif">AAA!</text>
        </g>
      </g>

      {/* BANDIT (left side) — the actual armed suspect */}
      <g transform="translate(105 82)">
        {/* legs */}
        <rect x="-10" y="36" width="8" height="30" fill="#1f2937" />
        <rect x="2"   y="36" width="8" height="30" fill="#1f2937" />
        <rect x="-10" y="64" width="8" height="3" fill="#0a0820" />
        <rect x="2"   y="64" width="8" height="3" fill="#0a0820" />
        {/* torso — classic black-and-white burglar stripes */}
        <path d="M -18 -2 L 18 -2 L 22 42 L -22 42 Z" fill="#fff" />
        <g stroke="#0a0820" strokeWidth="2.8">
          <line x1="-20" y1="6"  x2="20" y2="6" />
          <line x1="-21" y1="14" x2="21" y2="14" />
          <line x1="-21" y1="22" x2="21" y2="22" />
          <line x1="-22" y1="30" x2="22" y2="30" />
          <line x1="-22" y1="38" x2="22" y2="38" />
        </g>
        {/* head */}
        <circle cx="0" cy="-20" r="14" fill="#f5d2a8" />
        {/* beanie/cap */}
        <path d="M -14 -28 Q 0 -38 14 -28 L 14 -22 L -14 -22 Z" fill="#1f2937" />
        <circle cx="0" cy="-36" r="2" fill="#dc2626" />
        {/* CLASSIC EYE MASK */}
        <rect x="-12" y="-22" width="24" height="6" fill="#0a0820" />
        <circle cx="-5" cy="-19" r="1.2" fill="#fff" />
        <circle cx="5"  cy="-19" r="1.2" fill="#fff" />
        {/* shifty smirk */}
        <path d="M -5 -11 Q 0 -7 7 -12" stroke="#0a0820" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* "FREEZE!" speech bubble */}
        <g transform="translate(28 -28)">
          <rect x="-2" y="-9" width="44" height="14" rx="3" fill="#fff" stroke="#0a0820" strokeWidth="0.8" />
          <path d="M -2 -2 L -8 4 L 2 2 Z" fill="#fff" stroke="#0a0820" strokeWidth="0.8" />
          <text x="20" y="1" textAnchor="middle" fontSize="9" fontWeight="900" fill="#0a0820" fontFamily="'Space Grotesk', system-ui, sans-serif">FREEZE!</text>
        </g>
        {/* extended arm holding revolver */}
        <path d="M 18 -4 L 50 4 L 52 12 L 22 10 Z" fill="#fff" />
        <g stroke="#0a0820" strokeWidth="1.8">
          <line x1="20" y1="0"  x2="50" y2="6" />
          <line x1="22" y1="8" x2="52" y2="10" />
        </g>
        <circle cx="48" cy="8" r="4" fill="#f5d2a8" />

        {/* CARTOON REVOLVER — big, obvious, classic six-shooter silhouette */}
        <g transform="translate(54 8)">
          {/* grip */}
          <path d="M -4 2 L 4 4 L 8 16 L -2 14 Z" fill="#5b3a17" stroke="#0a0820" strokeWidth="0.6" />
          <line x1="0" y1="6" x2="4" y2="14" stroke="#92400e" strokeWidth="0.5" />
          {/* cylinder (round drum) */}
          <circle cx="6" cy="-2" r="6" fill="#4b5563" stroke="#0a0820" strokeWidth="0.7" />
          <circle cx="6" cy="-2" r="3" fill="#1f2937" />
          <circle cx="6" cy="-4" r="0.9" fill="#0a0820" />
          <circle cx="9" cy="-2" r="0.9" fill="#0a0820" />
          <circle cx="6" cy="0"  r="0.9" fill="#0a0820" />
          <circle cx="3" cy="-2" r="0.9" fill="#0a0820" />
          {/* barrel */}
          <rect x="11" y="-4" width="16" height="5" rx="0.8" fill="#4b5563" stroke="#0a0820" strokeWidth="0.7" />
          <rect x="11" y="-4" width="16" height="1.5" fill="#6b7280" />
          {/* trigger guard + trigger */}
          <path d="M 1 4 Q 3 10 8 8" fill="none" stroke="#0a0820" strokeWidth="0.9" />
          {/* sight bead at the tip */}
          <rect x="25" y="-6" width="2" height="2" fill="#0a0820" />
          {/* tiny smoke puff from muzzle (recently fired warning shot maybe) */}
          <g fill="#c4bee0" opacity="0.7">
            <circle cx="30" cy="-3" r="2" />
            <circle cx="33" cy="-5" r="1.5" />
            <circle cx="33" cy="-1" r="1.4" />
          </g>
        </g>
      </g>

      {/* HUD scan lines */}
      <g stroke="rgba(220,38,38,0.18)" strokeWidth="0.5" strokeDasharray="2 4">
        <line x1="0" y1="50" x2="320" y2="50" />
        <line x1="0" y1="100" x2="320" y2="100" />
      </g>

      {/* Bounding boxes — short labels so they don't extend past their box and
          across the rest of the scene. Positioned in the clean top sky strip
          (SUSPECT, HOSTAGE) or on the counter (GUN via below=true). */}
      {/* SUSPECT — full-body box; label rides above the cap in the top margin */}
      <BBox x={78}  y={42} w={56} h={108} color="#fbbf24" label="SUSPECT" />
      {/* HOSTAGE — head + raised hands; label sits between AAA bubble and BANK sign */}
      <BBox x={212} y={58} w={30} h={28}  color="#7cffd4" label="HOSTAGE" />
      {/* REVOLVER — tight on the gun; label BELOW the box lands on counter */}
      <BBox x={170} y={82} w={22} h={12}  color="#dc2626" label="GUN · 97%" below />
    </g>
  );
}

function SceneParking() {
  // Top-down parking lot in glorious chaos. Featuring: a guy parked
  // across two bays, the world's longest dwell-timer, a bicycle in an
  // SUV bay, and a duck taking the scenic route.
  return (
    <g>
      {/* Tarmac */}
      <rect x="0" y="0" width="320" height="155" fill="rgba(20,20,30,0.55)" />
      {/* Centre drive lane */}
      <rect x="0" y="72" width="320" height="38" fill="rgba(255,255,255,0.04)" />
      <g stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" strokeDasharray="10 8">
        <line x1="0" y1="91" x2="320" y2="91" />
      </g>

      {/* Bay separator lines — top row */}
      <g stroke="rgba(255,255,255,0.35)" strokeWidth="1">
        <line x1="20"  y1="14" x2="20"  y2="72" />
        <line x1="60"  y1="14" x2="60"  y2="72" />
        <line x1="100" y1="14" x2="100" y2="72" />
        <line x1="140" y1="14" x2="140" y2="72" />
        <line x1="180" y1="14" x2="180" y2="72" />
        <line x1="220" y1="14" x2="220" y2="72" />
        <line x1="260" y1="14" x2="260" y2="72" />
        <line x1="300" y1="14" x2="300" y2="72" />
        <line x1="20"  y1="14" x2="300" y2="14" />
      </g>
      {/* Bay separator lines — bottom row */}
      <g stroke="rgba(255,255,255,0.35)" strokeWidth="1">
        <line x1="20"  y1="110" x2="20"  y2="150" />
        <line x1="60"  y1="110" x2="60"  y2="150" />
        <line x1="100" y1="110" x2="100" y2="150" />
        <line x1="140" y1="110" x2="140" y2="150" />
        <line x1="180" y1="110" x2="180" y2="150" />
        <line x1="220" y1="110" x2="220" y2="150" />
        <line x1="260" y1="110" x2="260" y2="150" />
        <line x1="300" y1="110" x2="300" y2="150" />
        <line x1="20"  y1="150" x2="300" y2="150" />
      </g>

      {/* ─── Top row chaos ─── */}

      {/* Bay 1: PERFECTLY parked smug red sedan */}
      <g transform="translate(40 43)">
        <rect x="-14" y="-22" width="28" height="48" rx="4" fill="#dc2626" stroke="#7a1818" strokeWidth="0.7" />
        <rect x="-11" y="-16" width="22" height="14" rx="2" fill="rgba(0,0,0,0.45)" />
        <circle cx="-9" cy="-18" r="1.4" fill="#fbbf24" />
        <circle cx="9"  cy="-18" r="1.4" fill="#fbbf24" />
        {/* smug face on hood */}
        <circle cx="-5" cy="18" r="1" fill="#0a0820" />
        <circle cx="5"  cy="18" r="1" fill="#0a0820" />
        <path d="M -4 22 Q 0 24 4 22" stroke="#0a0820" strokeWidth="0.8" fill="none" />
      </g>

      {/* Bay 2–3: GIANT TRUCK parked across TWO bays diagonally */}
      <g transform="translate(95 43) rotate(8)">
        {/* truck cab */}
        <rect x="-32" y="-26" width="64" height="56" rx="4" fill="#3b82f6" stroke="#1e3a8a" strokeWidth="0.8" />
        <rect x="-26" y="-20" width="52" height="16" rx="2" fill="rgba(0,0,0,0.5)" />
        {/* truck bed lines */}
        <line x1="-26" y1="2" x2="26" y2="2" stroke="#1e3a8a" strokeWidth="0.6" />
        <line x1="-26" y1="12" x2="26" y2="12" stroke="#1e3a8a" strokeWidth="0.6" />
        <line x1="-26" y1="22" x2="26" y2="22" stroke="#1e3a8a" strokeWidth="0.6" />
      </g>

      {/* Bay 4: BICYCLE chained up in a full-size bay */}
      <g transform="translate(160 43)">
        <circle cx="-7" cy="6" r="6" fill="none" stroke="#7cffd4" strokeWidth="1.5" />
        <circle cx="7"  cy="6" r="6" fill="none" stroke="#7cffd4" strokeWidth="1.5" />
        <line x1="-7" y1="6" x2="0" y2="-4" stroke="#7cffd4" strokeWidth="1.4" />
        <line x1="7"  y1="6" x2="0" y2="-4" stroke="#7cffd4" strokeWidth="1.4" />
        <line x1="0"  y1="-4" x2="-2" y2="-14" stroke="#7cffd4" strokeWidth="1.4" />
        <rect x="-4" y="-16" width="10" height="2" rx="0.5" fill="#7cffd4" />
        <line x1="7"  y1="6" x2="6" y2="-6" stroke="#7cffd4" strokeWidth="1.2" />
        <rect x="3" y="-10" width="6" height="3" rx="0.5" fill="#7cffd4" />
      </g>

      {/* Bay 5: silver hatch sitting on the LINE (half in bay 5, half in 6) */}
      <g transform="translate(218 43)">
        <rect x="-14" y="-22" width="28" height="48" rx="4" fill="#c4bee0" stroke="#6a6680" strokeWidth="0.7" />
        <rect x="-11" y="-14" width="22" height="12" rx="2" fill="rgba(0,0,0,0.45)" />
      </g>

      {/* Bay 6: empty — flagged FREE */}
      {/* Bay 7: 47-DAY CAMPER VAN with cobwebs */}
      <g transform="translate(280 43)">
        {/* van body — taller, beige */}
        <rect x="-15" y="-26" width="30" height="52" rx="4" fill="#fbbf24" stroke="#92400e" strokeWidth="0.7" />
        {/* roof rack */}
        <rect x="-13" y="-29" width="26" height="3" rx="1" fill="#92400e" />
        {/* windshield */}
        <rect x="-12" y="-22" width="24" height="10" rx="1" fill="rgba(0,0,0,0.5)" />
        {/* side stripe */}
        <line x1="-15" y1="4" x2="15" y2="4" stroke="#92400e" strokeWidth="1" />
        {/* cobwebs (corner triangles) */}
        <path d="M -15 -26 L -10 -26 L -15 -21 Z" fill="rgba(255,255,255,0.20)" />
        <path d="M 15 -26 L 10 -26 L 15 -21 Z" fill="rgba(255,255,255,0.20)" />
        {/* "47 DAYS" sticker */}
        <rect x="-12" y="0" width="24" height="6" rx="1" fill="#dc2626" />
        <text x="0" y="5" textAnchor="middle" fontSize="5" fontWeight="900" fill="#fff" fontFamily="ui-monospace, monospace">47 DAYS</text>
      </g>

      {/* ─── Bottom row chaos ─── */}

      {/* Bay A: car parked BACKWARDS (rear lights pointing toward camera) */}
      <g transform="translate(40 130)">
        <rect x="-14" y="-22" width="28" height="48" rx="4" fill="#34a853" stroke="#1c4a26" strokeWidth="0.7" />
        <rect x="-11" y="-20" width="22" height="14" rx="2" fill="rgba(0,0,0,0.45)" />
        {/* red brake lights at the BACK (north end — wrong direction) */}
        <rect x="-12" y="-23" width="6" height="3" rx="0.5" fill="#dc2626" />
        <rect x="6" y="-23" width="6" height="3" rx="0.5" fill="#dc2626" />
        {/* small confused arrow */}
        <text x="0" y="8" textAnchor="middle" fontSize="14" fontWeight="900" fill="#fff">?</text>
      </g>

      {/* Bay B: car parked PERFECTLY SIDEWAYS (90° rotation) */}
      <g transform="translate(80 130) rotate(90)">
        <rect x="-14" y="-22" width="28" height="48" rx="4" fill="#a855f7" stroke="#581c87" strokeWidth="0.7" />
        <rect x="-11" y="-14" width="22" height="12" rx="2" fill="rgba(0,0,0,0.45)" />
      </g>

      {/* Bay C: SHOPPING CART abandoned */}
      <g transform="translate(120 130)">
        {/* cart basket */}
        <path d="M -10 -2 L 12 -2 L 10 14 L -8 14 Z" fill="none" stroke="#c4bee0" strokeWidth="1.4" />
        {/* basket grid */}
        <line x1="-9" y1="3" x2="11" y2="3" stroke="#c4bee0" strokeWidth="0.6" />
        <line x1="-9" y1="8" x2="11" y2="8" stroke="#c4bee0" strokeWidth="0.6" />
        <line x1="-2" y1="-2" x2="-2" y2="14" stroke="#c4bee0" strokeWidth="0.6" />
        <line x1="5" y1="-2" x2="5" y2="14" stroke="#c4bee0" strokeWidth="0.6" />
        {/* handle */}
        <line x1="-10" y1="-2" x2="-14" y2="-6" stroke="#c4bee0" strokeWidth="1.4" />
        <line x1="-15" y1="-6" x2="-9" y2="-6" stroke="#c4bee0" strokeWidth="1.4" />
        {/* wheels */}
        <circle cx="-7" cy="17" r="2" fill="#c4bee0" />
        <circle cx="9"  cy="17" r="2" fill="#c4bee0" />
      </g>

      {/* Bay D: orange car bumper-kissing the line */}
      <g transform="translate(160 130) translate(8 0)">
        <rect x="-14" y="-22" width="28" height="48" rx="4" fill="#ff9f43" stroke="#7c2d12" strokeWidth="0.7" />
        <rect x="-11" y="8" width="22" height="12" rx="2" fill="rgba(0,0,0,0.45)" />
      </g>

      {/* Bay E: DUCK waddling across the lot 🦆 */}
      <g transform="translate(210 132)">
        {/* body */}
        <ellipse cx="0" cy="0" rx="10" ry="6" fill="#fbbf24" stroke="#92400e" strokeWidth="0.7" />
        {/* tail */}
        <path d="M -10 -2 L -14 -4 L -10 2 Z" fill="#fbbf24" stroke="#92400e" strokeWidth="0.6" />
        {/* head */}
        <circle cx="8" cy="-6" r="5" fill="#fbbf24" stroke="#92400e" strokeWidth="0.7" />
        {/* bill */}
        <path d="M 12 -6 L 18 -5 L 12 -3 Z" fill="#f97316" stroke="#7c2d12" strokeWidth="0.5" />
        {/* eye */}
        <circle cx="9" cy="-7" r="0.9" fill="#0a0820" />
        {/* feet */}
        <path d="M -3 6 L -4 9 L -1 9 Z" fill="#f97316" />
        <path d="M 3 6 L 2 9 L 5 9 Z" fill="#f97316" />
        {/* speech bubble: QUACK */}
        <g transform="translate(20 -16)">
          <rect x="-2" y="-8" width="32" height="11" rx="3" fill="#fff" />
          <path d="M -2 0 L -6 4 L 0 3 Z" fill="#fff" />
          <text x="14" y="0" textAnchor="middle" fontSize="7" fontWeight="800" fill="#0a0820" fontFamily="ui-monospace, monospace">QUACK!</text>
        </g>
      </g>

      {/* Bay F: tiny SMART CAR in a giant bay (way too much space) */}
      <g transform="translate(255 134)">
        <rect x="-7" y="-9" width="14" height="20" rx="3" fill="#5ac8ff" stroke="#1e40af" strokeWidth="0.7" />
        <rect x="-5" y="-6" width="10" height="6" rx="1" fill="rgba(0,0,0,0.45)" />
      </g>

      {/* Bay G: BMW that took up two bays — center across G + nothing */}
      <g transform="translate(285 130)">
        <rect x="-14" y="-22" width="28" height="48" rx="4" fill="#1f2937" stroke="#000" strokeWidth="0.7" />
        <rect x="-11" y="10" width="22" height="12" rx="2" fill="rgba(0,0,0,0.55)" />
      </g>

      {/* Free bay highlight: top-row bay 6 (x=240–260) */}
      <rect x="220" y="14" width="40" height="58" fill="rgba(124,255,212,0.18)" stroke="#7cffd4" strokeWidth="1" strokeDasharray="3 3" />
      <text x="240" y="46" textAnchor="middle" fontSize="9" fontWeight="700" fill="#7cffd4" fontFamily="ui-monospace, monospace">FREE</text>

      {/* The good kind of bounding boxes */}
      <BBox x={260} y={20}  w={40} h={50} color="#dc2626" label="DWELL · 47d 03h 22m 🚐" />
      <BBox x={62}  y={20}  w={70} h={48} color="#fbbf24" label="BAD PARKING · 2 BAYS" />
      <BBox x={140} y={20}  w={36} h={44} color="#7cffd4" label="BIKE 🚲 · WRONG VEHICLE" />
      <BBox x={66}  y={108} w={28} h={42} color="#fbbf24" label="ROTATED 90° 🤔" />
      <BBox x={198} y={120} w={28} h={26} color="#a855f7" label="DUCK 🦆 · NON-VEHICLE" />
      <BBox x={4}   y={4}   w={312} h={146} color="#fff" label="LOT · 9 / 16 · CHAOS LEVEL: HIGH" />
    </g>
  );
}

/* ── Hailo ── */

function SceneAnpr() {
  // Front view of a BMW driving toward the camera — license plate on the
  // front bumper (where it actually belongs), kidney grille, BMW roundel,
  // angel-eye headlights, and an OCR readout callout off to the side.
  return (
    <g>
      {/* road dashes */}
      <g stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" opacity="0.65">
        <line x1="20"  y1="170" x2="50"  y2="170" />
        <line x1="80"  y1="170" x2="110" y2="170" />
        <line x1="210" y1="170" x2="240" y2="170" />
        <line x1="270" y1="170" x2="300" y2="170" />
      </g>

      {/* Speed radar device top-right */}
      <g transform="translate(290 38)">
        <rect x="-22" y="-12" width="44" height="26" rx="3" fill="#1e293b" stroke="#fbbf24" strokeWidth="1.2" />
        <text x="0" y="-3" fontSize="6.5" fontWeight="700" fill="#fbbf24" textAnchor="middle" fontFamily="ui-monospace, monospace">RADAR</text>
        <text x="0" y="9" fontSize="11" fontWeight="900" fill="#ff5577" textAnchor="middle" fontFamily="ui-monospace, monospace">42</text>
        <g fill="none" stroke="#7cffd4" strokeWidth="1">
          <path d="M -28 0 Q -34 -4 -34 -10" opacity="0.7" />
          <path d="M -32 4 Q -42 0 -42 -10" opacity="0.45" />
        </g>
      </g>

      {/* OCR readout callout (top-left) — what the ANPR pipeline actually outputs */}
      <g transform="translate(48 42)">
        <rect x="-32" y="-14" width="64" height="36" rx="3" fill="#1e293b" stroke="#fbbf24" strokeWidth="1.2" />
        <text x="0" y="-4" fontSize="6.5" fontWeight="700" fill="#fbbf24" textAnchor="middle" fontFamily="ui-monospace, monospace">SCANNED</text>
        {/* mini plate */}
        <g transform="translate(0 9)">
          <rect x="-26" y="-7" width="52" height="13" rx="1.2" fill="#ffffff" stroke="#0a0820" strokeWidth="0.8" />
          <rect x="-26" y="-7" width="7" height="13" fill="#1d4ed8" />
          <text x="-22.5" y="2" fontSize="5.5" fontWeight="700" fill="#fde047" textAnchor="middle" fontFamily="ui-monospace, monospace">CA</text>
          <text x="3" y="3" fontSize="8.5" fontWeight="900" fill="#0a0820" textAnchor="middle" fontFamily="ui-monospace, monospace">7XK·403</text>
        </g>
      </g>

      {/* BMW 3-Series, side view. The front of the car (with the plate)
         points right at the camera; the rest of the car is in profile, which
         is the most recognisable car silhouette and lets us show the BMW
         design language (Hofmeister kink, roundel, kidney shadow) cleanly. */}
      <g transform="translate(160 115)">
        {/* shadow */}
        <ellipse cx="0" cy="35" rx="118" ry="5" fill="rgba(0,0,0,0.45)" />

        {/* Body — long sleek silhouette */}
        <path d="
          M -118 22
          L -118 8
          L -110 -4
          L -88 -10
          L -65 -22
          L -28 -32
          L 20 -32
          L 48 -22
          L 78 -14
          L 102 -6
          L 116 0
          L 118 6
          L 118 22
          Z
        " fill="#1e3a5f" stroke="#0a0820" strokeWidth="1.6" strokeLinejoin="round" />

        {/* Lower rocker / character line */}
        <line x1="-110" y1="10" x2="112" y2="10" stroke="#0a0820" strokeWidth="0.5" opacity="0.55" />
        {/* belt line above doors */}
        <line x1="-100" y1="-4" x2="78" y2="-14" stroke="#3b6ea8" strokeWidth="0.6" opacity="0.55" />

        {/* Greenhouse / window glass — with BMW Hofmeister kink at the rear */}
        <path d="
          M -88 -10
          L -60 -28
          L 20 -28
          L 38 -18
          L 38 -10
          L -82 -10
          Z
        " fill="rgba(124,255,212,0.55)" stroke="#0a0820" strokeWidth="0.9" />
        {/* B-pillar */}
        <line x1="-18" y1="-28" x2="-18" y2="-10" stroke="#0a0820" strokeWidth="1.2" />
        {/* Hofmeister kink — small angular cut at the rear window's bottom corner */}
        <path d="M -88 -10 L -82 -16 L -78 -10 Z" fill="#1e3a5f" stroke="#0a0820" strokeWidth="0.7" />

        {/* Driver visible through window */}
        <g transform="translate(8 -19)">
          <circle cx="0" cy="0" r="5" fill="#f5d2a8" />
          <path d="M -4 -3 Q 0 -7 4 -3 L 4 0 L -4 0 Z" fill="#3a2818" />
          <circle cx="-1.5" cy="0" r="0.6" fill="#0a0820" />
          <circle cx="1.5"  cy="0" r="0.6" fill="#0a0820" />
          <path d="M -2 3 Q 0 4 2 3" stroke="#0a0820" strokeWidth="0.5" fill="none" />
        </g>

        {/* Passenger silhouette */}
        <g transform="translate(-25 -19)" opacity="0.7">
          <circle cx="0" cy="0" r="4.5" fill="#f5d2a8" />
          <path d="M -3.5 -2 Q 0 -6 3.5 -2 L 3.5 0 L -3.5 0 Z" fill="#5b3a17" />
        </g>

        {/* Door lines */}
        <g stroke="#0a0820" strokeWidth="0.6">
          <line x1="-58" y1="-10" x2="-58" y2="20" />
          <line x1="-18" y1="-10" x2="-18" y2="20" />
        </g>
        {/* Door handles */}
        <rect x="-50" y="-2" width="14" height="2.5" rx="1" fill="#0a0820" />
        <rect x="-10" y="-2" width="14" height="2.5" rx="1" fill="#0a0820" />

        {/* Side mirror */}
        <path d="M 40 -14 L 50 -16 L 50 -10 L 40 -10 Z" fill="#1e3a5f" stroke="#0a0820" strokeWidth="0.7" />

        {/* BMW roundel on rear door */}
        <g transform="translate(-38 6)">
          <circle cx="0" cy="0" r="5.5" fill="#0a0820" />
          <circle cx="0" cy="0" r="4.4" fill="#ffffff" />
          <circle cx="0" cy="0" r="3.1" fill="#0066b3" />
          <path d="M 0 0 L 3.1 0 A 3.1 3.1 0 0 0 0 -3.1 Z" fill="#ffffff" />
          <path d="M 0 0 L -3.1 0 A 3.1 3.1 0 0 0 0 3.1 Z" fill="#ffffff" />
          <circle cx="0" cy="0" r="3.1" fill="none" stroke="#0a0820" strokeWidth="0.4" />
        </g>

        {/* FRONT FASCIA — at the right edge, visible since the car points slightly toward the camera */}
        {/* kidney grille shadow visible from the side */}
        <path d="M 102 -2 L 116 -2 L 118 8 L 104 10 Z" fill="#0a0820" />
        <g stroke="#475569" strokeWidth="0.5">
          <line x1="105" y1="0" x2="107" y2="8" />
          <line x1="109" y1="-1" x2="111" y2="8" />
          <line x1="113" y1="-1" x2="114" y2="8" />
        </g>
        {/* Headlight at the front — swept BMW style */}
        <g transform="translate(96 -2)">
          <path d="M -8 -6 L 8 -4 L 10 4 L -10 4 Z" fill="#0a0820" />
          <ellipse cx="0" cy="0" rx="7" ry="3" fill="#fde047" />
          <ellipse cx="0" cy="0" rx="8" ry="3.5" fill="none" stroke="#7cffd4" strokeWidth="1.1" />
          <ellipse cx="-2" cy="-1" rx="2" ry="0.8" fill="#ffffff" />
        </g>
        {/* Tail-light at the rear */}
        <path d="M -118 0 L -112 -2 L -110 6 L -118 8 Z" fill="#dc2626" />
        <path d="M -116 2 L -113 1 L -112 5 L -116 6 Z" fill="#fde047" opacity="0.7" />

        {/* License plate — on the FRONT bumper, slightly visible from this 3/4 angle */}
        <g transform="translate(106 16)">
          <rect x="-12" y="-6" width="22" height="12" rx="1" fill="#ffffff" stroke="#0a0820" strokeWidth="0.8" transform="skewY(-8)" />
          <text x="-1" y="3" fontSize="6.5" fontWeight="900" fill="#0a0820" textAnchor="middle" fontFamily="ui-monospace, monospace" transform="skewY(-8)">7XK·403</text>
        </g>

        {/* WHEELS — large, properly attached, with multi-spoke alloy detail */}
        {/* rear wheel */}
        <g transform="translate(-70 22)">
          {/* arch shadow */}
          <path d="M -22 0 Q -22 -10 0 -10 Q 22 -10 22 0" fill="none" stroke="#0a0820" strokeWidth="0.8" />
          <circle cx="0" cy="0" r="18" fill="#0a0820" />
          <circle cx="0" cy="0" r="13" fill="#475569" />
          {/* alloy spokes */}
          <g stroke="#0a0820" strokeWidth="1.5" strokeLinecap="round">
            <line x1="-12" y1="0"  x2="12"  y2="0" />
            <line x1="0"   y1="-12" x2="0"  y2="12" />
            <line x1="-8"  y1="-8" x2="8"   y2="8" />
            <line x1="-8"  y1="8"  x2="8"   y2="-8" />
          </g>
          <circle cx="0" cy="0" r="3" fill="#0a0820" />
          <circle cx="0" cy="0" r="1.5" fill="#7cffd4" />
        </g>
        {/* front wheel */}
        <g transform="translate(70 22)">
          <path d="M -22 0 Q -22 -10 0 -10 Q 22 -10 22 0" fill="none" stroke="#0a0820" strokeWidth="0.8" />
          <circle cx="0" cy="0" r="18" fill="#0a0820" />
          <circle cx="0" cy="0" r="13" fill="#475569" />
          <g stroke="#0a0820" strokeWidth="1.5" strokeLinecap="round">
            <line x1="-12" y1="0"  x2="12"  y2="0" />
            <line x1="0"   y1="-12" x2="0"  y2="12" />
            <line x1="-8"  y1="-8" x2="8"   y2="8" />
            <line x1="-8"  y1="8"  x2="8"   y2="-8" />
          </g>
          <circle cx="0" cy="0" r="3" fill="#0a0820" />
          <circle cx="0" cy="0" r="1.5" fill="#7cffd4" />
        </g>

        {/* motion lines behind */}
        <g stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" opacity="0.5">
          <line x1="-128" y1="-2" x2="-140" y2="-2" />
          <line x1="-128" y1="6"  x2="-145" y2="6" />
          <line x1="-128" y1="14" x2="-138" y2="14" />
        </g>
      </g>

      {/* Dashed bbox around the actual plate on the bumper */}
      <BBox x={258} y={123} w={28} h={16} color="#fbbf24" label="PLATE 7XK-403" />
    </g>
  );
}

function SceneIntruder() {
  return (
    <g>
      {/* Building wall on the left with a lit window */}
      <rect x="0" y="55" width="58" height="100" fill="rgba(60,50,90,0.35)" />
      <g stroke="rgba(196,190,224,0.10)" strokeWidth="0.6">
        <line x1="0" y1="78"  x2="58" y2="78"  />
        <line x1="0" y1="100" x2="58" y2="100" />
        <line x1="0" y1="122" x2="58" y2="122" />
        <line x1="0" y1="144" x2="58" y2="144" />
      </g>
      {/* window */}
      <rect x="12" y="86" width="22" height="26" fill="rgba(251,191,36,0.55)" stroke="rgba(251,191,36,0.8)" strokeWidth="0.5" />
      <line x1="23" y1="86" x2="23" y2="112" stroke="rgba(0,0,0,0.4)" strokeWidth="0.6" />
      <line x1="12" y1="99" x2="34" y2="99" stroke="rgba(0,0,0,0.4)" strokeWidth="0.6" />

      {/* Chain-link fence — diamond mesh between two posts */}
      <g stroke="rgba(196,190,224,0.6)" fill="none">
        {/* posts */}
        <line x1="82"  y1="40" x2="82"  y2="155" strokeWidth="2.5" />
        <line x1="158" y1="40" x2="158" y2="155" strokeWidth="2.5" />
        {/* top rail */}
        <line x1="78" y1="40" x2="162" y2="40" strokeWidth="1.5" />
        {/* diamond mesh — two sets of evenly spaced diagonals */}
        <g strokeWidth="0.6" opacity="0.65">
          {[-30, -22, -14, -6, 2, 10, 18, 26, 34, 42, 50, 58, 66, 74].map((off) => (
            <line key={`a${off}`} x1={84 + off + 10} y1="42" x2={84 + off + 70} y2="155" />
          ))}
          {[-30, -22, -14, -6, 2, 10, 18, 26, 34, 42, 50, 58, 66, 74].map((off) => (
            <line key={`b${off}`} x1={84 + off + 60} y1="42" x2={84 + off}      y2="155" />
          ))}
        </g>
        {/* barbed wire — 3 horizontal strands */}
        <line x1="78" y1="34" x2="162" y2="34" strokeWidth="0.8" />
        <line x1="78" y1="28" x2="162" y2="28" strokeWidth="0.8" />
        {/* barb crosses */}
        {[88, 102, 116, 130, 144, 158].map((x) => (
          <g key={x} strokeWidth="0.8">
            <line x1={x - 3} y1="26" x2={x + 3} y2="36" />
            <line x1={x + 3} y1="26" x2={x - 3} y2="36" />
          </g>
        ))}
      </g>

      {/* Alert pulse rings centred on intruder */}
      <g fill="none" stroke="#ff5577">
        <circle cx="225" cy="115" r="44" strokeWidth="1.2" opacity="0.4" />
        <circle cx="225" cy="115" r="60" strokeWidth="1"   opacity="0.22" />
      </g>

      {/* Intruder — masked silhouette crouching, sneaking right→left */}
      <g>
        {/* legs (crouched) */}
        <path d="M 213 134 L 209 158 L 218 158 L 222 135 Z" fill="#1a0e22" stroke="#ff5577" strokeWidth="1" />
        <path d="M 228 134 L 232 158 L 241 158 L 237 135 Z" fill="#1a0e22" stroke="#ff5577" strokeWidth="1" />
        {/* torso — leaning forward */}
        <path d="M 207 100 L 240 96 L 244 132 L 215 137 Z" fill="#1a0e22" stroke="#ff5577" strokeWidth="1.3" />
        {/* striped burglar shirt accent */}
        <line x1="210" y1="106" x2="241" y2="103" stroke="#ff5577" strokeWidth="0.6" opacity="0.5" />
        <line x1="211" y1="114" x2="242" y2="111" stroke="#ff5577" strokeWidth="0.6" opacity="0.5" />
        <line x1="212" y1="122" x2="243" y2="119" stroke="#ff5577" strokeWidth="0.6" opacity="0.5" />
        {/* back arm */}
        <path d="M 240 102 L 252 116 L 248 121 L 235 110 Z" fill="#1a0e22" stroke="#ff5577" strokeWidth="1" />
        {/* front arm — reaching with a "swag" sack */}
        <path d="M 209 104 L 195 116 L 191 113 L 205 100 Z" fill="#1a0e22" stroke="#ff5577" strokeWidth="1" />
        <circle cx="190" cy="115" r="3" fill="#1a0e22" stroke="#ff5577" strokeWidth="0.8" />
        {/* loot bag */}
        <path d="M 178 118 Q 175 122 178 130 L 192 130 Q 195 122 192 118 Z" fill="#1a0e22" stroke="#fbbf24" strokeWidth="1" />
        <text x="185" y="127" fontSize="6" fontWeight="900" fill="#fbbf24" textAnchor="middle" fontFamily="ui-monospace, monospace">$</text>
        {/* hood / head */}
        <path d="M 215 75 Q 220 65 232 67 Q 244 70 244 88 L 240 96 L 215 99 L 211 90 Z" fill="#1a0e22" stroke="#ff5577" strokeWidth="1.3" />
        {/* eye slit (ski mask) */}
        <rect x="216" y="80" width="22" height="6" rx="1.5" fill="#f5d2a8" />
        {/* shifty eyes peering out */}
        <circle cx="222" cy="83" r="1.6" fill="#0a0820" />
        <circle cx="232" cy="83" r="1.6" fill="#0a0820" />
        <circle cx="222.5" cy="82.5" r="0.5" fill="#ffffff" />
        <circle cx="232.5" cy="82.5" r="0.5" fill="#ffffff" />
        {/* mouth slit (smirking) */}
        <path d="M 222 91 Q 227 93 232 91" stroke="#f5d2a8" strokeWidth="1.2" fill="none" />
      </g>

      {/* alert badge near camera */}
      <g transform="translate(298 56)">
        <circle cx="0" cy="0" r="7" fill="#dc2626" stroke="#ffffff" strokeWidth="1" />
        <text x="0" y="3" fontSize="9" fontWeight="900" fill="#ffffff" textAnchor="middle">!</text>
      </g>

      {/* Security camera mounted in top-right */}
      <g transform="translate(282 34)">
        {/* mount bracket */}
        <rect x="-2" y="-7" width="4" height="7" fill="rgba(196,190,224,0.55)" />
        {/* camera body */}
        <path d="M -3 0 L 15 0 L 17 4 L 17 9 L 14 12 L -3 12 Z" fill="#7cffd4" />
        {/* lens hood */}
        <rect x="11" y="3" width="9" height="6" fill="#7cffd4" />
        <circle cx="18" cy="6" r="2" fill="#0a0820" />
        <circle cx="18.5" cy="5.5" r="0.8" fill="#7cffd4" />
        {/* recording LED */}
        <circle cx="2" cy="3.5" r="1.2" fill="#ff5577" />
      </g>
      {/* camera vision cone — dashed lines to intruder */}
      <g stroke="#7cffd4" strokeDasharray="3 3" strokeWidth="0.7" fill="none">
        <path d="M 300 42 L 230 90" opacity="0.55" />
        <path d="M 300 42 L 245 135" opacity="0.30" />
      </g>

      {/* motion arrow */}
      <path d="M 268 152 L 252 152" stroke="#fbbf24" strokeWidth="1.8" />
      <polygon points="252,152 258,148 258,156" fill="#fbbf24" />

      <BBox x={186} y={62} w={70} h={100} color="#ff5577" label="INTRUSION 0.94" />
    </g>
  );
}

function SceneHairnet() {
  // Front-facing chef holding a plate of pasta with BOTH hands — arms come
  // straight down from each shoulder and meet at the plate, so nothing is
  // detached. No floating spoon. Hairnet remains the focal element.
  return (
    <g>
      {/* ── BODY ── Solid coat silhouette. Path: bottom-left → up the side →
           round the shoulder → in to the collar V (neck notch) → up + over
           the head's neck → back down to the other collar → out to the right
           shoulder → down the right side. Single filled shape, no gap. */}
      <path d="
        M 80 180
        L 80 148
        Q 82 138 96 136
        L 144 136
        L 152 128
        L 168 128
        L 176 136
        L 224 136
        Q 238 138 240 148
        L 240 180
        Z
      " fill="#f5f3ff" stroke="#c4bee0" strokeWidth="1.4" strokeLinejoin="round" />
      {/* collar — green V neckerchief sitting in the notch */}
      <path d="M 144 134 L 176 134 L 168 152 L 152 152 Z" fill="#4ade80" stroke="#10b981" strokeWidth="0.7" />
      <path d="M 152 134 L 168 134 L 160 150 Z" fill="#0a8a52" />
      {/* coat double-breast crease running down the centre */}
      <line x1="160" y1="152" x2="160" y2="170" stroke="#c4bee0" strokeWidth="0.8" />
      {/* buttons — left and right of the centre crease */}
      <circle cx="152" cy="156" r="1.7" fill="#7c7194" />
      <circle cx="152" cy="164" r="1.7" fill="#7c7194" />
      <circle cx="168" cy="156" r="1.7" fill="#7c7194" />
      <circle cx="168" cy="164" r="1.7" fill="#7c7194" />
      {/* sleeve seam lines — subtle hint that the arms come from the shoulders */}
      <line x1="100" y1="138" x2="100" y2="168" stroke="#c4bee0" strokeWidth="0.6" opacity="0.6" />
      <line x1="220" y1="138" x2="220" y2="168" stroke="#c4bee0" strokeWidth="0.6" opacity="0.6" />

      {/* ── HEAD ── */}
      <ellipse cx="160" cy="100" rx="30" ry="33" fill="#f5d2a8" />
      {/* hair under the net */}
      <path d="M 133 92 Q 133 72 160 70 Q 187 72 187 92 Z" fill="#3a2818" />
      {/* ears */}
      <ellipse cx="131" cy="103" rx="2.5" ry="4" fill="#e8b894" />
      <ellipse cx="189" cy="103" rx="2.5" ry="4" fill="#e8b894" />

      {/* ── HAIRNET ── translucent dome + diamond mesh */}
      <path d="M 127 92 Q 132 52 160 50 Q 188 52 193 92 Z" fill="rgba(124,255,212,0.2)" stroke="#7cffd4" strokeWidth="1.8" strokeLinejoin="round" />
      <ellipse cx="160" cy="92" rx="33" ry="3.5" fill="none" stroke="#7cffd4" strokeWidth="1.6" />
      {/* mesh diagonals one way */}
      <g stroke="#7cffd4" strokeWidth="0.6" opacity="0.85">
        <line x1="135" y1="62" x2="168" y2="92" />
        <line x1="144" y1="55" x2="180" y2="92" />
        <line x1="154" y1="51" x2="190" y2="90" />
        <line x1="162" y1="50" x2="192" y2="80" />
        <line x1="172" y1="51" x2="192" y2="70" />
      </g>
      {/* mesh diagonals other way */}
      <g stroke="#7cffd4" strokeWidth="0.6" opacity="0.85">
        <line x1="185" y1="62" x2="152" y2="92" />
        <line x1="176" y1="55" x2="140" y2="92" />
        <line x1="166" y1="51" x2="130" y2="90" />
        <line x1="158" y1="50" x2="128" y2="80" />
        <line x1="148" y1="51" x2="128" y2="70" />
      </g>
      {/* dome curvature arcs */}
      <g fill="none" stroke="#7cffd4" strokeWidth="0.5" opacity="0.5">
        <path d="M 130 76 Q 160 70 190 76" />
        <path d="M 132 64 Q 160 58 188 64" />
      </g>

      {/* ── FACE ── */}
      <path d="M 144 104 Q 149 102 154 104" stroke="#3a2818" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M 166 104 Q 171 102 176 104" stroke="#3a2818" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <circle cx="149" cy="111" r="1.9" fill="#0a0820" />
      <circle cx="171" cy="111" r="1.9" fill="#0a0820" />
      <circle cx="140" cy="121" r="3" fill="#f5b3a8" opacity="0.55" />
      <circle cx="180" cy="121" r="3" fill="#f5b3a8" opacity="0.55" />
      {/* big smile */}
      <path d="M 150 124 Q 160 132 170 124" stroke="#3a2818" strokeWidth="1.6" fill="#dc2626" strokeLinecap="round" />
      {/* chef mustache */}
      <path d="M 144 119 Q 152 116 160 118 Q 168 116 176 119" stroke="#3a2818" strokeWidth="2.2" fill="none" strokeLinecap="round" />

      {/* ── HANDS gripping the front rim of the plate ──
           Drawn AFTER the body so they sit in front; the wrists meet the
           cuffs that come down from the sleeves naturally at y≈168. */}
      {/* green cuffs */}
      <ellipse cx="115" cy="170" rx="9" ry="3" fill="#4ade80" stroke="#10b981" strokeWidth="0.6" />
      <ellipse cx="205" cy="170" rx="9" ry="3" fill="#4ade80" stroke="#10b981" strokeWidth="0.6" />
      {/* hands */}
      <g>
        <ellipse cx="113" cy="172" rx="9" ry="6" fill="#f5d2a8" stroke="#0a0820" strokeWidth="0.5" />
        <path d="M 106 170 Q 110 167 116 169" stroke="#c19a6f" strokeWidth="0.5" fill="none" />
        <path d="M 108 173 Q 112 175 118 173" stroke="#c19a6f" strokeWidth="0.5" fill="none" />
      </g>
      <g>
        <ellipse cx="207" cy="172" rx="9" ry="6" fill="#f5d2a8" stroke="#0a0820" strokeWidth="0.5" />
        <path d="M 204 170 Q 208 167 214 169" stroke="#c19a6f" strokeWidth="0.5" fill="none" />
        <path d="M 202 173 Q 206 175 212 173" stroke="#c19a6f" strokeWidth="0.5" fill="none" />
      </g>

      {/* ── STEAMING PLATE OF PASTA held between the hands ── */}
      <g>
        {/* under-plate shadow */}
        <ellipse cx="160" cy="178" rx="55" ry="4" fill="rgba(0,0,0,0.35)" />
        {/* plate rim */}
        <ellipse cx="160" cy="173" rx="55" ry="6" fill="#ffffff" stroke="#c4bee0" strokeWidth="1" />
        {/* plate inside (slightly darker) */}
        <ellipse cx="160" cy="171" rx="48" ry="5" fill="#f1ecff" stroke="#c4bee0" strokeWidth="0.5" />
        {/* spaghetti nest */}
        <ellipse cx="160" cy="169" rx="42" ry="4.5" fill="#fde047" />
        {/* strands */}
        <g stroke="#a16207" strokeWidth="0.9" fill="none" strokeLinecap="round">
          <path d="M 128 169 Q 145 165 160 169 Q 175 165 192 169" />
          <path d="M 132 170 Q 150 167 160 171 Q 170 167 188 170" />
          <path d="M 135 167 Q 152 163 160 167 Q 168 163 185 167" />
        </g>
        {/* tomatoes */}
        <circle cx="148" cy="169" r="2.5" fill="#dc2626" stroke="#991b1b" strokeWidth="0.4" />
        <circle cx="172" cy="168" r="2.5" fill="#dc2626" stroke="#991b1b" strokeWidth="0.4" />
        {/* basil leaf */}
        <ellipse cx="160" cy="167" rx="3.5" ry="2" fill="#4ade80" />
        <line x1="160" y1="167" x2="162" y2="166" stroke="#0a8a52" strokeWidth="0.5" />
        {/* steam rising from the plate */}
        <g fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.7">
          <path d="M 144 164 Q 142 154 145 144 Q 148 134 144 124" />
          <path d="M 160 162 Q 163 152 158 142 Q 162 132 158 122" />
          <path d="M 176 164 Q 178 154 175 144 Q 172 134 176 124" />
        </g>
      </g>

      {/* ── Speech bubble — top-right, well clear of the plate / chef ── */}
      <g transform="translate(252 50)">
        <ellipse cx="0" cy="0" rx="34" ry="14" fill="#ffffff" stroke="#4ade80" strokeWidth="1.3" />
        <polygon points="-20,8 -32,22 -14,12" fill="#ffffff" stroke="#4ade80" strokeWidth="1.3" />
        <text x="0" y="5" fontSize="13" fontWeight="900" fill="#10b981" textAnchor="middle">DELISH!</text>
      </g>

      <BBox x={120} y={48} w={80} h={50} color="#4ade80" label="HAIRNET OK" />
    </g>
  );
}

function SceneFire() {
  // Mischievous flame character menacing a panicked bystander.
  return (
    <g>
      <defs>
        <linearGradient id="fire-grad-static" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stopColor="#dc2626" />
          <stop offset="60%"  stopColor="#f97316" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      {/* floor */}
      <line x1="0" y1="160" x2="320" y2="160" stroke="rgba(196,190,224,0.3)" />

      {/* Person running away — panicked */}
      <g transform="translate(78 110)">
        {/* legs mid-stride */}
        <path d="M -6 12 L -20 28 L -14 32 L -2 14 Z" fill="#1e3a8a" />
        <path d="M 6  12 L 16 26 L 22 22 L 12 8 Z"   fill="#1e3a8a" />
        <ellipse cx="-17" cy="32" rx="4" ry="2" fill="#0a0820" />
        <ellipse cx="20"  cy="24" rx="4" ry="2" fill="#0a0820" />
        {/* body */}
        <path d="M -12 -10 L 12 -10 L 14 12 L -14 12 Z" fill="#7cffd4" />
        {/* arms RAISED */}
        <path d="M -12 -8 L -20 -28 L -14 -32 L -6 -10 Z" fill="#f5d2a8" />
        <path d="M 12 -8 L 22 -28 L 28 -24 L 8 -8 Z"     fill="#f5d2a8" />
        <circle cx="-17" cy="-30" r="3" fill="#f5d2a8" />
        <circle cx="25"  cy="-26" r="3" fill="#f5d2a8" />
        {/* head */}
        <circle cx="0" cy="-22" r="12" fill="#f5d2a8" />
        {/* hair flying back */}
        <path d="M -11 -28 Q -8 -36 0 -34 Q 6 -38 11 -28 L 11 -22 L -11 -22 Z" fill="#5b3a17" />
        <path d="M 8 -28 Q 16 -32 18 -38" stroke="#5b3a17" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* terrified wide eyes */}
        <circle cx="-4" cy="-22" r="3.5" fill="#ffffff" />
        <circle cx="4"  cy="-22" r="3.5" fill="#ffffff" />
        <circle cx="-4" cy="-22" r="1.8" fill="#0a0820" />
        <circle cx="4"  cy="-22" r="1.8" fill="#0a0820" />
        {/* screaming O mouth */}
        <ellipse cx="0" cy="-15" rx="3" ry="4" fill="#0a0820" />
        {/* sweat */}
        <g fill="#7cffd4">
          <path d="M -14 -36 Q -12 -34 -12 -32 Q -14 -32 -16 -34 Z" />
          <path d="M 16 -38 Q 18 -36 18 -34 Q 16 -34 14 -36 Z" />
        </g>
        {/* "!" alert above */}
        <g transform="translate(-22 -46)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" />
          <circle cx="0" cy="12" r="1.8" fill="#dc2626" />
        </g>
        <g transform="translate(22 -50)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" />
          <circle cx="0" cy="12" r="1.8" fill="#dc2626" />
        </g>
        {/* motion lines behind */}
        <g stroke="#fbbf24" strokeWidth="1.6" strokeLinecap="round" opacity="0.75">
          <line x1="20" y1="-4" x2="32" y2="-4" />
          <line x1="20" y1="2"  x2="34" y2="2" />
          <line x1="20" y1="8"  x2="30" y2="8" />
        </g>
      </g>

      {/* Mischievous flame character */}
      <g transform="translate(220 100)">
        {/* smoke billows */}
        <ellipse cx="0"  cy="-65" rx="50" ry="10" fill="rgba(180,170,200,0.18)" />
        <ellipse cx="-8" cy="-50" rx="38" ry="8"  fill="rgba(180,170,200,0.25)" />
        {/* outer flame */}
        <path d="M 0 52 Q -44 34 -30 -8 Q -14 -2 -22 -40 Q -4 -22 2 -58 Q 8 -22 24 -40 Q 18 -2 32 -8 Q 46 34 0 52 Z" fill="url(#fire-grad-static)" />
        {/* inner flame */}
        <path d="M 0 38 Q -22 28 -16 0 Q -4 5 -8 -20 Q 0 -8 4 -25 Q 8 -8 10 0 Q 22 28 0 38 Z" fill="#fde047" />
        {/* angry brows */}
        <path d="M -15 -2 L -4 2" stroke="#0a0820" strokeWidth="2" strokeLinecap="round" />
        <path d="M 4  2 L 15 -2" stroke="#0a0820" strokeWidth="2" strokeLinecap="round" />
        {/* evil eyes */}
        <ellipse cx="-10" cy="6" rx="5" ry="6" fill="#ffffff" />
        <ellipse cx="10"  cy="6" rx="5" ry="6" fill="#ffffff" />
        <circle cx="-9" cy="7" r="2.5" fill="#0a0820" />
        <circle cx="11" cy="7" r="2.5" fill="#0a0820" />
        <circle cx="-8" cy="6" r="0.8" fill="#ffffff" />
        <circle cx="12" cy="6" r="0.8" fill="#ffffff" />
        {/* toothy grin */}
        <path d="M -10 18 Q 0 26 10 18 L 8 22 L 6 19 L 4 22 L 2 19 L 0 22 L -2 19 L -4 22 L -6 19 L -8 22 Z" fill="#ffffff" stroke="#0a0820" strokeWidth="0.6" />
        {/* fang tongue */}
        <path d="M -3 22 Q 0 28 3 22" fill="#dc2626" />
      </g>

      {/* sparks flying */}
      <g fill="#fbbf24">
        <polygon points="180,70 183,66 186,70 183,74" />
        <polygon points="266,80 269,76 272,80 269,84" />
        <polygon points="170,100 173,97 176,100 173,103" />
        <polygon points="278,108 281,105 284,108 281,111" />
        <polygon points="188,128 191,124 194,128 191,132" />
      </g>

      <BBox x={185} y={45} w={75} h={113} color="#fbbf24" label="FIRE 0.97" />
    </g>
  );
}

function SceneCrowd() {
  // Diverse cartoon characters with different outfits, expressions, and props.
  return (
    <g>
      {/* floor */}
      <line x1="0" y1="160" x2="320" y2="160" stroke="rgba(196,190,224,0.3)" />

      {/* Back row — smaller / further away */}
      {/* Person with hat */}
      <g transform="translate(75 78)">
        <ellipse cx="0" cy="18" rx="7" ry="2" fill="rgba(0,0,0,0.25)" />
        <path d="M -7 0 L 7 0 L 8 18 L -8 18 Z" fill="#7cffd4" />
        <circle cx="0" cy="-6" r="6" fill="#f5d2a8" />
        {/* fedora */}
        <ellipse cx="0" cy="-10" rx="9" ry="1.5" fill="#451a03" />
        <path d="M -5 -10 Q 0 -16 5 -10 Z" fill="#451a03" />
        <circle cx="-2" cy="-6" r="0.7" fill="#0a0820" />
        <circle cx="2"  cy="-6" r="0.7" fill="#0a0820" />
        <path d="M -2 -3 Q 0 -1 2 -3" stroke="#0a0820" strokeWidth="0.5" fill="none" />
      </g>
      {/* Person with phone (looking down) */}
      <g transform="translate(115 78)">
        <ellipse cx="0" cy="18" rx="7" ry="2" fill="rgba(0,0,0,0.25)" />
        <path d="M -7 0 L 7 0 L 8 18 L -8 18 Z" fill="#dc2626" />
        <circle cx="0" cy="-6" r="6" fill="#f5d2a8" />
        <path d="M -6 -10 Q 0 -14 6 -10 L 6 -6 L -6 -6 Z" fill="#3a2818" />
        <circle cx="-2" cy="-5" r="0.6" fill="#0a0820" />
        <circle cx="2"  cy="-5" r="0.6" fill="#0a0820" />
        {/* phone */}
        <rect x="-3" y="2" width="6" height="9" rx="1" fill="#0a0820" stroke="#7cffd4" strokeWidth="0.5" />
        <rect x="-2" y="3" width="4" height="6" fill="#7cffd4" opacity="0.6" />
      </g>
      {/* Person with backpack */}
      <g transform="translate(155 76)">
        <ellipse cx="0" cy="20" rx="8" ry="2" fill="rgba(0,0,0,0.25)" />
        <path d="M -7 0 L 7 0 L 9 20 L -9 20 Z" fill="#fbbf24" />
        {/* backpack strap */}
        <rect x="-9" y="0" width="2" height="10" fill="#451a03" />
        <rect x="7"  y="0" width="2" height="10" fill="#451a03" />
        <circle cx="0" cy="-6" r="6.5" fill="#f5d2a8" />
        {/* curly hair */}
        <circle cx="-5" cy="-12" r="3" fill="#3a2818" />
        <circle cx="0"  cy="-13" r="3" fill="#3a2818" />
        <circle cx="5"  cy="-12" r="3" fill="#3a2818" />
        <circle cx="-2" cy="-5" r="0.7" fill="#0a0820" />
        <circle cx="2"  cy="-5" r="0.7" fill="#0a0820" />
        <path d="M -2 -2 Q 0 0 2 -2" stroke="#0a0820" strokeWidth="0.6" fill="none" />
      </g>
      {/* Tall person */}
      <g transform="translate(195 74)">
        <ellipse cx="0" cy="22" rx="8" ry="2" fill="rgba(0,0,0,0.25)" />
        <path d="M -7 0 L 7 0 L 9 22 L -9 22 Z" fill="#1d4ed8" />
        <circle cx="0" cy="-7" r="6.5" fill="#f5d2a8" />
        {/* bald + beard */}
        <path d="M -6 -10 Q 0 -13 6 -10" stroke="#0a0820" strokeWidth="0.5" fill="none" />
        <path d="M -4 -2 Q 0 0 4 -2 Q 4 2 0 4 Q -4 2 -4 -2 Z" fill="#5b3a17" />
        <circle cx="-2" cy="-6" r="0.7" fill="#0a0820" />
        <circle cx="2"  cy="-6" r="0.7" fill="#0a0820" />
      </g>
      {/* Person waving */}
      <g transform="translate(238 78)">
        <ellipse cx="0" cy="18" rx="7" ry="2" fill="rgba(0,0,0,0.25)" />
        <path d="M -7 0 L 7 0 L 8 18 L -8 18 Z" fill="#ff7bd6" />
        {/* waving arm */}
        <path d="M 7 1 L 14 -10 L 18 -8 L 9 4 Z" fill="#f5d2a8" />
        <circle cx="0" cy="-6" r="6" fill="#f5d2a8" />
        {/* long hair */}
        <path d="M -8 -10 Q -8 -2 -5 4 L -7 -2 Q -9 -8 -6 -12 Z" fill="#dc2626" />
        <path d="M -8 -12 Q 0 -16 8 -12 Q 9 -2 8 4 L 8 -6 Q 8 -10 6 -12 Z" fill="#dc2626" />
        <circle cx="-2" cy="-5" r="0.6" fill="#0a0820" />
        <circle cx="2"  cy="-5" r="0.6" fill="#0a0820" />
        <path d="M -2 -2 Q 0 1 2 -2" stroke="#0a0820" strokeWidth="0.6" fill="none" />
      </g>
      {/* Person far right with sunglasses */}
      <g transform="translate(278 80)">
        <ellipse cx="0" cy="16" rx="7" ry="2" fill="rgba(0,0,0,0.25)" />
        <path d="M -7 0 L 7 0 L 8 16 L -8 16 Z" fill="#0ea968" />
        <circle cx="0" cy="-5" r="6" fill="#f5d2a8" />
        <path d="M -6 -9 Q 0 -13 6 -9 L 6 -5 L -6 -5 Z" fill="#fbbf24" />
        {/* sunglasses */}
        <rect x="-4" y="-5" width="3" height="2.5" rx="0.5" fill="#0a0820" />
        <rect x="1"  y="-5" width="3" height="2.5" rx="0.5" fill="#0a0820" />
        <line x1="-1" y1="-4" x2="1" y2="-4" stroke="#0a0820" strokeWidth="0.5" />
        <path d="M -2 -1 Q 0 1 2 -1" stroke="#0a0820" strokeWidth="0.5" fill="none" />
      </g>

      {/* Front row — larger / closer */}
      {/* Kid with balloon */}
      <g transform="translate(55 130)">
        <ellipse cx="0" cy="20" rx="8" ry="2" fill="rgba(0,0,0,0.3)" />
        <path d="M -7 -2 L 7 -2 L 8 20 L -8 20 Z" fill="#fbbf24" />
        <circle cx="0" cy="-10" r="7" fill="#f5d2a8" />
        <path d="M -7 -14 Q 0 -19 7 -14 L 7 -10 L -7 -10 Z" fill="#a16207" />
        <circle cx="-2" cy="-10" r="0.8" fill="#0a0820" />
        <circle cx="2"  cy="-10" r="0.8" fill="#0a0820" />
        <path d="M -2 -6 Q 0 -3 2 -6" stroke="#0a0820" strokeWidth="0.7" fill="none" />
        {/* balloon string */}
        <line x1="6" y1="-2" x2="12" y2="-32" stroke="#7c7194" strokeWidth="0.6" />
        <circle cx="12" cy="-36" r="5" fill="#dc2626" />
        <polygon points="11,-32 13,-32 12,-30" fill="#dc2626" />
      </g>
      {/* Big guy */}
      <g transform="translate(100 132)">
        <ellipse cx="0" cy="20" rx="11" ry="3" fill="rgba(0,0,0,0.3)" />
        <path d="M -11 -2 L 11 -2 L 13 20 L -13 20 Z" fill="#1d4ed8" />
        <circle cx="0" cy="-11" r="8" fill="#f5d2a8" />
        <path d="M -8 -16 Q 0 -22 8 -16 L 8 -11 L -8 -11 Z" fill="#0a0820" />
        <circle cx="-3" cy="-11" r="0.9" fill="#0a0820" />
        <circle cx="3"  cy="-11" r="0.9" fill="#0a0820" />
        <path d="M -3 -6 Q 0 -3 3 -6" stroke="#0a0820" strokeWidth="0.8" fill="none" />
        {/* arms holding bag */}
        <path d="M -11 0 L -18 8 L -16 12 L -9 6 Z" fill="#f5d2a8" />
        <rect x="-22" y="6" width="8" height="10" fill="#dc2626" />
      </g>
      {/* Woman with handbag */}
      <g transform="translate(150 134)">
        <ellipse cx="0" cy="18" rx="8" ry="2" fill="rgba(0,0,0,0.3)" />
        <path d="M -8 -2 L 8 -2 L 10 18 L -10 18 Z" fill="#ff7bd6" />
        <circle cx="0" cy="-10" r="7" fill="#f5d2a8" />
        {/* long flowing hair */}
        <path d="M -8 -14 Q 0 -19 8 -14 Q 9 -2 8 8 L 8 -10 Q 8 -12 6 -14 Q -6 -14 -8 -12 Q -8 -2 -8 6 Z" fill="#5b3a17" />
        <circle cx="-2" cy="-10" r="0.8" fill="#0a0820" />
        <circle cx="2"  cy="-10" r="0.8" fill="#0a0820" />
        <path d="M -3 -5 Q 0 -2 3 -5" stroke="#dc2626" strokeWidth="0.8" fill="none" />
        {/* handbag */}
        <path d="M 8 0 L 13 4 L 15 14 L 11 14 Z" fill="#451a03" />
        <path d="M 9 0 Q 12 -3 14 0" fill="none" stroke="#451a03" strokeWidth="0.7" />
      </g>
      {/* Couple holding hands */}
      <g transform="translate(195 132)">
        <ellipse cx="0" cy="20" rx="8" ry="2" fill="rgba(0,0,0,0.3)" />
        <path d="M -8 -2 L 8 -2 L 10 20 L -10 20 Z" fill="#7cffd4" />
        <circle cx="0" cy="-10" r="7" fill="#f5d2a8" />
        <path d="M -8 -14 Q 0 -20 8 -14 L 8 -10 L -8 -10 Z" fill="#fbbf24" />
        <circle cx="-2" cy="-10" r="0.8" fill="#0a0820" />
        <circle cx="2"  cy="-10" r="0.8" fill="#0a0820" />
        <path d="M -2 -5 Q 0 -3 2 -5" stroke="#0a0820" strokeWidth="0.7" fill="none" />
        {/* arm reaching to partner */}
        <path d="M 9 4 L 16 4 L 16 8 L 9 8 Z" fill="#f5d2a8" />
        {/* heart above */}
        <path d="M 12 -16 Q 14 -20 17 -18 Q 20 -20 22 -16 Q 22 -12 17 -8 Q 12 -12 12 -16 Z" fill="#dc2626" />
      </g>
      <g transform="translate(232 132)">
        <ellipse cx="0" cy="20" rx="8" ry="2" fill="rgba(0,0,0,0.3)" />
        <path d="M -8 -2 L 8 -2 L 10 20 L -10 20 Z" fill="#dc2626" />
        <circle cx="0" cy="-10" r="7" fill="#f5d2a8" />
        <path d="M -8 -14 Q 0 -20 8 -14 Q 9 -4 8 4 L 8 -10 Q 6 -14 0 -14 Q -6 -14 -8 -12 Z" fill="#3a2818" />
        <circle cx="-2" cy="-10" r="0.8" fill="#0a0820" />
        <circle cx="2"  cy="-10" r="0.8" fill="#0a0820" />
        <path d="M -2 -5 Q 0 -3 2 -5" stroke="#0a0820" strokeWidth="0.7" fill="none" />
        {/* arm reaching back */}
        <path d="M -9 4 L -16 4 L -16 8 L -9 8 Z" fill="#f5d2a8" />
      </g>
      {/* Sketchy guy on edge */}
      <g transform="translate(283 134)">
        <ellipse cx="0" cy="18" rx="7" ry="2" fill="rgba(0,0,0,0.3)" />
        <path d="M -7 -2 L 7 -2 L 9 18 L -9 18 Z" fill="#c084fc" />
        <circle cx="0" cy="-9" r="6.5" fill="#f5d2a8" />
        {/* beanie */}
        <path d="M -7 -13 Q 0 -18 7 -13 L 7 -9 L -7 -9 Z" fill="#10b981" />
        <line x1="-7" y1="-12" x2="7" y2="-12" stroke="#0a0820" strokeWidth="0.4" />
        <circle cx="-2" cy="-9" r="0.7" fill="#0a0820" />
        <circle cx="2"  cy="-9" r="0.7" fill="#0a0820" />
        <path d="M -2 -5 Q 0 -3 2 -5" stroke="#0a0820" strokeWidth="0.6" fill="none" />
      </g>

      <BBox x={42} y={62} w={252} h={92} color="#c084fc" label="CROWD · 12 PEOPLE" />
    </g>
  );
}

function SceneDriveThru() {
  // Service window with a cheerful attendant handing a burger bag to a happy customer in a car.
  return (
    <g>
      {/* Building wall — brick pattern */}
      <rect x="0" y="0" width="92" height="180" fill="rgba(60,50,80,0.4)" />
      <g stroke="rgba(196,190,224,0.10)" strokeWidth="0.5">
        <line x1="0" y1="30" x2="92" y2="30" />
        <line x1="0" y1="60" x2="92" y2="60" />
        <line x1="0" y1="90" x2="92" y2="90" />
        <line x1="0" y1="120" x2="92" y2="120" />
        <line x1="0" y1="150" x2="92" y2="150" />
        <line x1="46" y1="0" x2="46" y2="30" />
        <line x1="22" y1="30" x2="22" y2="60" />
        <line x1="70" y1="30" x2="70" y2="60" />
        <line x1="46" y1="60" x2="46" y2="90" />
        <line x1="22" y1="90" x2="22" y2="120" />
        <line x1="70" y1="90" x2="70" y2="120" />
      </g>
      {/* Sign on top of building */}
      <g transform="translate(46 18)">
        <rect x="-28" y="-12" width="56" height="20" rx="3" fill="#dc2626" stroke="#7f1d1d" strokeWidth="1" />
        <text x="0" y="-1" fontSize="7.5" fontWeight="900" fill="#fde047" textAnchor="middle">DRIVE</text>
        <text x="0" y="6" fontSize="5.5" fontWeight="700" fill="#ffffff" textAnchor="middle" letterSpacing="0.06em">THRU</text>
      </g>

      {/* Service window */}
      <rect x="22" y="55" width="48" height="68" fill="rgba(124,255,212,0.18)" stroke="#7cffd4" strokeWidth="2" />
      <line x1="22" y1="89" x2="70" y2="89" stroke="#7cffd4" strokeWidth="0.6" />
      <line x1="46" y1="55" x2="46" y2="89" stroke="#7cffd4" strokeWidth="0.6" />

      {/* Attendant inside */}
      <g transform="translate(46 92)">
        {/* head */}
        <circle cx="0" cy="-6" r="11" fill="#f5d2a8" />
        {/* cap */}
        <path d="M -11 -13 Q 0 -22 11 -13 L 13 -10 L -13 -10 Z" fill="#dc2626" />
        <rect x="-11" y="-10" width="22" height="2.5" fill="#7f1d1d" />
        {/* peak */}
        <path d="M -11 -10 L -16 -8 L -11 -8 Z" fill="#7f1d1d" />
        {/* hair */}
        <path d="M -10 -7 Q 0 -5 10 -7 L 10 -3 L -10 -3 Z" fill="#fbbf24" />
        {/* face */}
        <circle cx="-3" cy="-6" r="0.9" fill="#0a0820" />
        <circle cx="3"  cy="-6" r="0.9" fill="#0a0820" />
        {/* big smile */}
        <path d="M -4 -1 Q 0 3 4 -1" stroke="#0a0820" strokeWidth="1.3" fill="#dc2626" strokeLinecap="round" />
        {/* uniform */}
        <path d="M -13 5 L 13 5 L 16 28 L -16 28 Z" fill="#dc2626" />
        <line x1="0" y1="5" x2="0" y2="28" stroke="#7f1d1d" strokeWidth="0.5" />
        <circle cx="-4" cy="12" r="1" fill="#fde047" />
        <circle cx="4"  cy="12" r="1" fill="#fde047" />
        {/* badge / name tag */}
        <rect x="5" y="9" width="6" height="3" fill="#ffffff" stroke="#7f1d1d" strokeWidth="0.3" />
        {/* arm extending out */}
        <path d="M 13 8 L 38 4 L 42 10 L 16 16 Z" fill="#f5d2a8" />
      </g>

      {/* Paper bag being handed out */}
      <g transform="translate(100 100)">
        <path d="M -10 -10 L 10 -10 L 10 14 L -10 14 Z" fill="#d4a574" stroke="#8b5e34" strokeWidth="1" />
        <path d="M -10 -10 L -10 -16 L 10 -16 L 10 -10 Z" fill="#f4c89a" stroke="#8b5e34" strokeWidth="0.7" />
        <g stroke="#8b5e34" strokeWidth="0.4">
          <line x1="-6" y1="-15" x2="-6" y2="-11" />
          <line x1="-2" y1="-15" x2="-2" y2="-11" />
          <line x1="2"  y1="-15" x2="2"  y2="-11" />
          <line x1="6"  y1="-15" x2="6"  y2="-11" />
        </g>
        {/* Logo (B for Burger) */}
        <circle cx="0" cy="2" r="5" fill="#dc2626" stroke="#7f1d1d" strokeWidth="0.5" />
        <text x="0" y="4.5" fontSize="6" fontWeight="900" fill="#fde047" textAnchor="middle">B</text>
        {/* steam */}
        <g fill="none" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" opacity="0.65">
          <path d="M -4 -18 Q -6 -24 -3 -28" />
          <path d="M 4  -18 Q 6 -24 3 -28" />
        </g>
      </g>

      {/* Car (side view) with happy driver */}
      <g transform="translate(220 120)">
        <ellipse cx="0" cy="32" rx="72" ry="5" fill="rgba(0,0,0,0.3)" />
        {/* body */}
        <path d="M -72 22 L -72 -2 Q -72 -12 -55 -14 L -36 -22 Q -20 -28 0 -28 Q 22 -28 36 -20 L 52 -10 Q 72 -8 72 4 L 72 22 Z" fill="#ff7bd6" stroke="#9f1239" strokeWidth="1.5" />
        {/* window */}
        <path d="M -32 -14 L -16 -24 Q -2 -26 14 -24 L 28 -10 L -30 -10 Z" fill="rgba(255,255,255,0.4)" stroke="#9f1239" strokeWidth="0.8" />
        {/* door line */}
        <line x1="-8" y1="-10" x2="-8" y2="20" stroke="#9f1239" strokeWidth="0.5" />
        <line x1="28" y1="-10" x2="28" y2="20" stroke="#9f1239" strokeWidth="0.5" />
        {/* handle */}
        <rect x="0" y="2" width="4" height="1.5" fill="#9f1239" />
        {/* Headlight */}
        <circle cx="-68" cy="6" r="5" fill="#fde047" stroke="#9f1239" strokeWidth="0.5" />
        {/* Tail light */}
        <circle cx="68" cy="6" r="3" fill="#dc2626" />
        {/* Wheels */}
        <circle cx="-42" cy="22" r="13" fill="#0a0820" stroke="#c4bee0" strokeWidth="1.8" />
        <circle cx="-42" cy="22" r="5" fill="#c4bee0" />
        <circle cx="42"  cy="22" r="13" fill="#0a0820" stroke="#c4bee0" strokeWidth="1.8" />
        <circle cx="42"  cy="22" r="5" fill="#c4bee0" />

        {/* Driver — reaching out with hungry face */}
        <g transform="translate(-12 -16)">
          {/* head */}
          <circle cx="0" cy="0" r="8" fill="#f5d2a8" />
          {/* hair */}
          <path d="M -6 -4 Q 0 -10 6 -4 L 6 -1 L -6 -1 Z" fill="#3a2818" />
          {/* sunglasses (cool customer) */}
          <rect x="-5" y="-1" width="4" height="2" rx="0.5" fill="#0a0820" />
          <rect x="1"  y="-1" width="4" height="2" rx="0.5" fill="#0a0820" />
          <line x1="-1" y1="0" x2="1" y2="0" stroke="#0a0820" strokeWidth="0.4" />
          {/* huge smile */}
          <path d="M -3 4 Q 0 7 3 4" stroke="#0a0820" strokeWidth="1" fill="#dc2626" strokeLinecap="round" />
          {/* arm reaching out window */}
          <path d="M -2 8 L -16 14 L -20 18 L -4 18 Z" fill="#f5d2a8" />
        </g>
      </g>

      {/* Drive arrow */}
      <path d="M 290 152 L 308 152 M 302 147 L 308 152 L 302 157" stroke="#fbbf24" strokeWidth="2" fill="none" strokeLinecap="round" />

      <BBox x={145} y={88} w={155} h={68} color="#fbbf24" label="LANE 1 · 2:14" />
    </g>
  );
}

function Kpi({
  label, value, sub, icon: Icon, accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ size?: number }>;
  accent: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div className="kpi-icon" style={{ color: accent, background: `linear-gradient(135deg, ${accent}33, transparent)` }}>
          <Icon size={16} />
        </div>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-mid">
        <div className="kpi-value" style={{ color: accent }}>{value}</div>
      </div>
      <div className="kpi-trend-sub" style={{ fontSize: 11 }}>{sub}</div>
    </div>
  );
}
