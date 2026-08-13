import { useEffect, useId, useMemo, useState } from 'react';
import { geoPath, geoAlbersUsa, geoMercator, geoCentroid, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { ArrowLeft } from 'lucide-react';
import { Card } from '../Card';
import { branches, fleetStats } from '../../data/mock';
import type { Branch } from '../../types';
import { useTheme, useThemeColors } from '../../ui/Theme';

const TOPO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

const W = 800, H = 500;

/** City registry. `metro` groups cities into metropolitan areas so the map can
 *  drill US → State → Metro and show tightly-packed cities at their REAL
 *  geographic positions inside the metro view. */
const cityCoords: Record<string, { lon: number; lat: number; state: string; metro?: string }> = {
  'Dallas, TX':       { lon: -96.7970,  lat: 32.7767, state: 'Texas', metro: 'DFW' },
  'Plano, TX':        { lon: -96.6989,  lat: 33.0198, state: 'Texas', metro: 'DFW' },
  'Irving, TX':       { lon: -96.9489,  lat: 32.8140, state: 'Texas', metro: 'DFW' },
  'McKinney, TX':     { lon: -96.6397,  lat: 33.1972, state: 'Texas', metro: 'DFW' },
  'Austin, TX':       { lon: -97.7431,  lat: 30.2672, state: 'Texas' },
  'San Antonio, TX':  { lon: -98.4936,  lat: 29.4241, state: 'Texas' },
  'Houston, TX':      { lon: -95.3698,  lat: 29.7604, state: 'Texas' },
  'Seattle, WA':      { lon: -122.3321, lat: 47.6062, state: 'Washington' },
  'Boston, MA':       { lon: -71.0589,  lat: 42.3601, state: 'Massachusetts' },
  'Chicago, IL':      { lon: -87.6298,  lat: 41.8781, state: 'Illinois' },
  'Tampa, FL':        { lon: -82.4572,  lat: 27.9506, state: 'Florida' },
};

interface StateProps { name: string }

interface StateClusterMarker {
  type: 'state-cluster';
  state: string;
  count: number;
  branches: Branch[];
  x: number; y: number;
}
interface MetroClusterMarker {
  type: 'metro-cluster';
  metro: string;
  count: number;
  branches: Branch[];
  x: number; y: number;
}
interface BranchMarker {
  type: 'branch';
  branch: Branch;
  x: number; y: number;
}
type Marker = StateClusterMarker | MetroClusterMarker | BranchMarker;

interface ZoomLevel {
  state: string;
  metro?: string;
}

interface BranchMapProps {
  selectedId: string;
  onSelect: (id: string) => void;
  /** When true, render the map content without the surrounding Card chrome
   *  so it can be embedded inside another card. */
  embedded?: boolean;
}

/** Radar-style expanding rings — two staggered pulses so the ripple never goes quiet. */
function RadarRipple({ x, y, r, color, dur = 2.4 }: {
  x: number; y: number; r: number; color: string; dur?: number;
}) {
  return (
    <>
      {[0, -dur / 2].map((begin) => (
        <circle key={begin} cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={1.4}>
          <animate attributeName="r" values={`${r};${r + 18}`} dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="0.55;0" dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </>
  );
}

/** warn/err pulse color for a set of branches, or null when all healthy. */
function issueColorFor(list: Branch[], colors: { warn: string; err: string }): string | null {
  let worst: 'warn' | 'err' | null = null;
  for (const b of list) {
    const s = fleetStats[b.id]?.status;
    if (s === 'err') worst = 'err';
    else if (s === 'warn' && worst === null) worst = 'warn';
  }
  return worst === 'err' ? colors.err : worst === 'warn' ? colors.warn : null;
}

export function BranchMap({ selectedId, onSelect, embedded = false }: BranchMapProps) {
  const [states, setStates] = useState<Feature<Geometry, StateProps>[] | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomLevel | null>(null);
  const c = useThemeColors();
  const { theme } = useTheme();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  useEffect(() => {
    let cancelled = false;
    fetch(TOPO_URL)
      .then((r) => r.json())
      .then((topo: Topology) => {
        if (cancelled) return;
        const collection = feature(
          topo,
          topo.objects.states as GeometryCollection<StateProps>,
        ) as FeatureCollection<Geometry, StateProps>;
        setStates(collection.features);
      })
      .catch(() => { /* leave null */ });
    return () => { cancelled = true; };
  }, []);

  // ── Group branches by state ──
  const branchesByState = useMemo(() => {
    const m = new Map<string, Branch[]>();
    for (const b of branches) {
      const co = cityCoords[b.location];
      if (!co) continue;
      const arr = m.get(co.state) ?? [];
      arr.push(b);
      m.set(co.state, arr);
    }
    return m;
  }, []);

  const statesWithBranches = useMemo(() => new Set(branchesByState.keys()), [branchesByState]);

  // ── Projection: 3 levels (USA / state / metro) ──
  const projection = useMemo<GeoProjection>(() => {
    // Metro level — compute Mercator scale + center manually so we don't depend
    // on fitExtent doing the right thing with a synthetic feature.
    if (zoom?.metro && zoom.state) {
      const metroCities = Object.values(cityCoords).filter(
        (co) => co.state === zoom.state && co.metro === zoom.metro,
      );
      if (metroCities.length > 0) {
        const lons = metroCities.map((co) => co.lon);
        const lats = metroCities.map((co) => co.lat);
        const PAD = 0.4; // ~30 mi buffer in lat / lon degrees
        const minLon = Math.min(...lons) - PAD;
        const maxLon = Math.max(...lons) + PAD;
        const minLat = Math.min(...lats) - PAD;
        const maxLat = Math.max(...lats) + PAD;
        const cLon = (minLon + maxLon) / 2;
        const cLat = (minLat + maxLat) / 2;
        const lonSpan = maxLon - minLon;
        const latSpan = maxLat - minLat;

        // Mercator scale math:
        //   1° longitude at latitude L = scale × cos(L) × π / 180 pixels
        //   1° latitude (small spans near centre) ≈ scale × π / 180 pixels
        const cosLat = Math.cos((cLat * Math.PI) / 180);
        const targetW = W - 160; // 80 px padding each side
        const targetH = H - 160;
        const scaleByLon = targetW / ((lonSpan * cosLat * Math.PI) / 180);
        const scaleByLat = targetH / ((latSpan * Math.PI) / 180);
        const scale = Math.min(scaleByLon, scaleByLat);

        return geoMercator()
          .center([cLon, cLat])
          .scale(scale)
          .translate([W / 2, H / 2]);
      }
    }
    // State level
    if (zoom?.state && states) {
      const stateFeature = states.find((s) => s.properties.name === zoom.state);
      if (stateFeature) {
        return geoMercator().fitExtent([[50, 50], [W - 50, H - 50]], stateFeature);
      }
    }
    // Country level
    return geoAlbersUsa().scale(1000).translate([W / 2, H / 2]);
  }, [zoom, states]);

  const pathGen = useMemo(() => geoPath(projection), [projection]);

  // ── Build markers based on current view ──
  const markers = useMemo<Marker[]>(() => {
    const out: Marker[] = [];

    // ── METRO LEVEL: render every city in this metro at its real geographic position ──
    if (zoom?.metro && zoom.state) {
      const list = branchesByState.get(zoom.state) ?? [];
      for (const b of list) {
        const co = cityCoords[b.location];
        if (!co || co.metro !== zoom.metro) continue;
        const xy = projection([co.lon, co.lat]);
        if (!xy) continue;
        out.push({ type: 'branch', branch: b, x: xy[0], y: xy[1] });
      }
      return out;
    }

    // ── STATE LEVEL: solo cities + metro-cluster pins ──
    if (zoom?.state) {
      const list = branchesByState.get(zoom.state) ?? [];
      const byMetro = new Map<string, Branch[]>();
      const solos: Branch[] = [];
      for (const b of list) {
        const co = cityCoords[b.location];
        const m = co?.metro;
        if (m) {
          const arr = byMetro.get(m) ?? [];
          arr.push(b);
          byMetro.set(m, arr);
        } else {
          solos.push(b);
        }
      }
      // Solo cities at their projected positions
      for (const b of solos) {
        const co = cityCoords[b.location];
        if (!co) continue;
        const xy = projection([co.lon, co.lat]);
        if (!xy) continue;
        out.push({ type: 'branch', branch: b, x: xy[0], y: xy[1] });
      }
      // Metro groups → if 1 branch, single pin; if 2+, metro cluster pin
      byMetro.forEach((bs, metro) => {
        if (bs.length === 1) {
          const co = cityCoords[bs[0].location];
          if (!co) return;
          const xy = projection([co.lon, co.lat]);
          if (!xy) return;
          out.push({ type: 'branch', branch: bs[0], x: xy[0], y: xy[1] });
          return;
        }
        // Mean of metro city coords (geographic centroid of the metro's cities)
        const lons = bs.map((b) => cityCoords[b.location]?.lon).filter((v): v is number => v != null);
        const lats = bs.map((b) => cityCoords[b.location]?.lat).filter((v): v is number => v != null);
        const lon = lons.reduce((a, b) => a + b, 0) / lons.length;
        const lat = lats.reduce((a, b) => a + b, 0) / lats.length;
        const xy = projection([lon, lat]);
        if (!xy) return;
        out.push({ type: 'metro-cluster', metro, count: bs.length, branches: bs, x: xy[0], y: xy[1] });
      });
      return out;
    }

    // ── COUNTRY LEVEL: solo cities + state-cluster pins ──
    branchesByState.forEach((bs, state) => {
      if (bs.length === 1) {
        const b = bs[0];
        const co = cityCoords[b.location];
        if (!co) return;
        const xy = projection([co.lon, co.lat]);
        if (!xy) return;
        out.push({ type: 'branch', branch: b, x: xy[0], y: xy[1] });
      } else {
        // True state polygon centroid (not branch mean — that lands on Dallas for Texas)
        const stateFeature = states?.find((s) => s.properties.name === state);
        let lon: number, lat: number;
        if (stateFeature) {
          [lon, lat] = geoCentroid(stateFeature);
        } else {
          const lons = bs.map((b) => cityCoords[b.location]?.lon).filter((v): v is number => v != null);
          const lats = bs.map((b) => cityCoords[b.location]?.lat).filter((v): v is number => v != null);
          lon = lons.reduce((a, b) => a + b, 0) / lons.length;
          lat = lats.reduce((a, b) => a + b, 0) / lats.length;
        }
        const xy = projection([lon, lat]);
        if (!xy) return;
        out.push({ type: 'state-cluster', state, count: bs.length, branches: bs, x: xy[0], y: xy[1] });
      }
    });
    return out;
  }, [zoom, branchesByState, projection, states]);

  // ── SD-WAN connectivity links between branches ──
  // Hub-and-spoke from the largest cluster (Dallas-HQ / Texas) out to every
  // other site. Drawn at country zoom only — once you drill into a state or
  // metro the inter-state mesh is no longer relevant.
  const connections = useMemo(() => {
    if (zoom) return [];
    // Hub = the marker with the most branches, falling back to the first.
    const hub = [...markers].sort((a, b) => {
      const ca = a.type === 'state-cluster' ? a.count : 1;
      const cb = b.type === 'state-cluster' ? b.count : 1;
      return cb - ca;
    })[0];
    if (!hub) return [];
    return markers
      .filter((m) => m !== hub)
      .map((m) => {
        const key =
          m.type === 'state-cluster' ? `s-${m.state}` :
          m.type === 'metro-cluster' ? `m-${m.metro}` :
          `b-${m.branch.id}`;
        return { id: `link-${key}`, from: hub, to: m };
      });
  }, [zoom, markers]);

  // ── Theme-aware fills ──
  const stateActiveFill   = theme === 'dark' ? 'rgba(124,255,212,0.18)' : 'rgba(6,214,160,0.14)';
  const stateActiveStroke = theme === 'dark' ? 'rgba(124,255,212,0.55)' : 'rgba(6,214,160,0.55)';
  const stateInactiveFill = theme === 'dark' ? 'rgba(124,255,212,0.04)' : 'rgba(15,23,42,0.04)';
  const stateInactiveStroke = theme === 'dark' ? 'rgba(200,195,230,0.30)' : 'rgba(15,23,42,0.18)';
  const stateZoomFill     = theme === 'dark' ? 'rgba(124,255,212,0.10)' : 'rgba(6,214,160,0.08)';
  const stateZoomStroke   = theme === 'dark' ? 'rgba(124,255,212,0.65)' : 'rgba(6,214,160,0.65)';

  const labelStrokeBg = theme === 'dark' ? 'rgba(14,12,32,0.9)' : 'rgba(255,255,255,0.85)';
  const dotPaperFill  = theme === 'dark' ? 'rgba(14,12,32,0.95)' : '#ffffff';
  const haloFill      = theme === 'dark' ? 'rgba(124,255,212,0.55)' : 'rgba(6,214,160,0.45)';

  function onStateClick(stateName: string) {
    if (zoom) return; // already zoomed somewhere
    if ((branchesByState.get(stateName)?.length ?? 0) > 1) {
      setZoom({ state: stateName });
    }
  }

  function goBack() {
    if (zoom?.metro) setZoom({ state: zoom.state }); // metro → state
    else setZoom(null);                              // state → country
  }

  // Subtitle reflects current view
  const branchesInMetro = (state: string, metro: string) =>
    (branchesByState.get(state) ?? []).filter((b) => cityCoords[b.location]?.metro === metro).length;

  const subtitle = zoom?.metro && zoom.state
    ? `${zoom.metro} Metro · ${branchesInMetro(zoom.state, zoom.metro)} branches`
    : zoom?.state
    ? `${zoom.state} · ${branchesByState.get(zoom.state)?.length ?? 0} branches`
    : `${branches.length} sites · ${statesWithBranches.size} regions`;

  const backLabel = zoom?.metro ? `Back to ${zoom.state}` : 'Back to US';

  const mapBody = (
    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
        {zoom && (
          <button
            onClick={goBack}
            style={{
              position: 'absolute', top: 8, left: 8, zIndex: 10,
              padding: '6px 10px', fontSize: 12,
            }}
          >
            <ArrowLeft size={13} />{backLabel}
          </button>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', maxHeight: 420, display: 'block' }}>
          <defs>
            <radialGradient id="map-bg" cx="50%" cy="50%" r="60%">
              <stop offset="0%"  stopColor={haloFill} stopOpacity={0.18} />
              <stop offset="100%" stopColor={haloFill} stopOpacity={0} />
            </radialGradient>
            <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill={theme === 'dark' ? 'rgba(200,195,230,0.18)' : 'rgba(15,23,42,0.10)'} />
            </pattern>
            <radialGradient id="pin-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%"  stopColor={haloFill} />
              <stop offset="100%" stopColor={haloFill} stopOpacity={0} />
            </radialGradient>
          </defs>

          <rect x="0" y="0" width={W} height={H} fill="url(#map-bg)" rx="14" />
          <rect x="0" y="0" width={W} height={H} fill="url(#dots)" rx="14" />

          {states ? (
            <g>
              {states
                // At state-zoom or metro-zoom, only render the focused state's polygon.
                .filter((s) => !zoom || s.properties.name === zoom.state)
                .map((s, i) => {
                  const d = pathGen(s);
                  if (!d) return null;
                  const stateName = s.properties.name;
                  const has = statesWithBranches.has(stateName);
                  const isZoomedState = zoom?.state === stateName;
                  const isClickable = !zoom && has && (branchesByState.get(stateName)?.length ?? 0) > 1;

                  let fill: string, stroke: string, strokeW: number;
                  if (isZoomedState) {
                    fill = stateZoomFill; stroke = stateZoomStroke; strokeW = 1.6;
                  } else if (has) {
                    fill = stateActiveFill; stroke = stateActiveStroke; strokeW = 1.1;
                  } else {
                    fill = stateInactiveFill; stroke = stateInactiveStroke; strokeW = 0.7;
                  }

                  return (
                    <path
                      key={i}
                      d={d}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={strokeW}
                      strokeLinejoin="round"
                      style={{ cursor: isClickable ? 'pointer' : 'default', transition: 'fill 0.18s, stroke 0.18s' }}
                      onClick={() => onStateClick(stateName)}
                    >
                      <title>
                        {stateName}
                        {has ? ` · ${branchesByState.get(stateName)?.length} branch${branchesByState.get(stateName)!.length > 1 ? 'es' : ''}` : ''}
                        {isClickable ? ' (click to drill in)' : ''}
                      </title>
                    </path>
                  );
                })}
            </g>
          ) : (
            <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="13" fill={c.textMuted}>Loading map…</text>
          )}

          {/* ── SD-WAN connectivity links (drawn behind markers) ── */}
          {connections.length > 0 && (
            <g>
              {connections.map(({ id, from, to }, linkIndex) => {
                // Slight arc upward so lines don't run dead-straight across the map.
                const midX = (from.x + to.x) / 2;
                const midY = (from.y + to.y) / 2;
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const lift = Math.min(70, dist * 0.20);
                const cx = midX;
                const cy = midY - lift;
                const d = `M ${from.x} ${from.y} Q ${cx} ${cy}, ${to.x} ${to.y}`;
                const pathId = `${uid}-${id}`;
                const cometDur = 2.8 + (linkIndex % 3) * 0.6;
                const cometBegin = -(linkIndex * 0.9);
                return (
                  <g key={id}>
                    {/* Soft base line */}
                    <path
                      id={pathId}
                      d={d}
                      stroke={c.accent}
                      strokeWidth={1.4}
                      strokeOpacity={0.22}
                      fill="none"
                    />
                    {/* Animated flowing dashes — give the mesh a "live" feel */}
                    <path
                      d={d}
                      stroke={c.accent}
                      strokeWidth={1.2}
                      strokeOpacity={0.7}
                      strokeDasharray="3 7"
                      fill="none"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        values="0;-20"
                        dur={`${2.4 + (dist % 1)}s`}
                        repeatCount="indefinite"
                      />
                    </path>
                    {/* Comet: bright head + soft trailing glow riding the arc */}
                    <circle r={4.5} fill={c.accent} opacity={0.25}>
                      <animateMotion
                        dur={`${cometDur}s`}
                        begin={`${cometBegin - 0.07}s`}
                        repeatCount="indefinite"
                      >
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                    <circle r={2.2} fill={c.accent} opacity={0.95}>
                      <animateMotion
                        dur={`${cometDur}s`}
                        begin={`${cometBegin}s`}
                        repeatCount="indefinite"
                      >
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                  </g>
                );
              })}
            </g>
          )}

          {/* ── Markers ── */}
          {markers.map((m) => {
            if (m.type === 'state-cluster') {
              const isHov = hover === `state:${m.state}`;
              const r = isHov ? 14 : 12;
              const issueColor = issueColorFor(m.branches, c);
              return (
                <g
                  key={`state-cluster-${m.state}`}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHover(`state:${m.state}`)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setZoom({ state: m.state })}
                >
                  <circle cx={m.x} cy={m.y} r={36} fill="url(#pin-glow)" />
                  {issueColor && <RadarRipple x={m.x} y={m.y} r={r + 7} color={issueColor} />}
                  <circle cx={m.x} cy={m.y} r={r + 4} fill={dotPaperFill} stroke={c.accent} strokeWidth={1.5} />
                  <circle cx={m.x} cy={m.y} r={r} fill={c.accent} />
                  <text x={m.x} y={m.y + 4} textAnchor="middle" fontSize="13" fontWeight={700}
                    fill={theme === 'dark' ? '#0a0a18' : '#ffffff'} style={{ pointerEvents: 'none' }}>
                    {m.count}
                  </text>
                  <text x={m.x} y={m.y - 22} textAnchor="middle" fontSize="11" fontWeight={600}
                    fill={c.text} style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: labelStrokeBg, strokeWidth: 3 }}>
                    {m.state}
                  </text>
                  <text x={m.x} y={m.y + 28} textAnchor="middle" fontSize="9.5"
                    fill={c.textDim} style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: labelStrokeBg, strokeWidth: 3 }}>
                    click to drill in
                  </text>
                </g>
              );
            }

            if (m.type === 'metro-cluster') {
              const isHov = hover === `metro:${m.metro}`;
              const r = isHov ? 13 : 11;
              const issueColor = issueColorFor(m.branches, c);
              return (
                <g
                  key={`metro-cluster-${m.metro}`}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHover(`metro:${m.metro}`)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setZoom({ state: zoom?.state ?? '', metro: m.metro })}
                >
                  <circle cx={m.x} cy={m.y} r={32} fill="url(#pin-glow)" />
                  {issueColor && <RadarRipple x={m.x} y={m.y} r={r + 7} color={issueColor} />}
                  <circle cx={m.x} cy={m.y} r={r + 4} fill={dotPaperFill} stroke={c.accent2} strokeWidth={1.5} />
                  <circle cx={m.x} cy={m.y} r={r} fill={c.accent2} />
                  <text x={m.x} y={m.y + 4} textAnchor="middle" fontSize="12" fontWeight={700}
                    fill={theme === 'dark' ? '#0a0a18' : '#ffffff'} style={{ pointerEvents: 'none' }}>
                    {m.count}
                  </text>
                  <text x={m.x} y={m.y - 22} textAnchor="middle" fontSize="11" fontWeight={600}
                    fill={c.text} style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: labelStrokeBg, strokeWidth: 3 }}>
                    {m.metro} Metro
                  </text>
                  <text x={m.x} y={m.y + 26} textAnchor="middle" fontSize="9.5"
                    fill={c.textDim} style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: labelStrokeBg, strokeWidth: 3 }}>
                    click to drill in
                  </text>
                </g>
              );
            }

            // type === 'branch'
            const b = m.branch;
            const isSel = b.id === selectedId;
            const isHov = hover === b.id;
            const r = isSel ? 9 : isHov ? 8 : 6;
            const stat = fleetStats[b.id]?.status;
            const pinFill = stat === 'err' ? c.err
              : stat === 'warn' ? c.warn
              : isSel ? c.accent2 : c.accent;
            const rippleColor = stat === 'err' ? c.err
              : stat === 'warn' ? c.warn
              : isSel ? c.accent2 : null;
            return (
              <g
                key={b.id}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(b.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(b.id)}
              >
                <circle cx={m.x} cy={m.y} r={32} fill="url(#pin-glow)" />
                {rippleColor && <RadarRipple x={m.x} y={m.y} r={r + 5} color={rippleColor} />}
                <circle cx={m.x} cy={m.y} r={r + 4} fill={dotPaperFill} />
                <circle cx={m.x} cy={m.y} r={r} fill={pinFill} />
                <text x={m.x} y={m.y - 18} textAnchor="middle" fontSize="11" fontWeight={isSel ? 700 : 600}
                  fill={c.text} style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: labelStrokeBg, strokeWidth: 3 }}>
                  {b.name}
                </text>
                <text x={m.x} y={m.y + 24} textAnchor="middle" fontSize="10"
                  fill={c.textDim} style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: labelStrokeBg, strokeWidth: 3 }}>
                  {b.location}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
  );

  if (embedded) return mapBody;
  return (
    <Card
      title="Branch Map"
      sub={subtitle}
      right={<span className="badge ok"><span className="dot ok" /> Live</span>}
    >
      {mapBody}
    </Card>
  );
}

/** Subtitle helper for callers that embed the map and want to render their
 *  own header. Mirrors the subtitle logic above. */
export function getBranchMapSubtitle(_selectedId: string): string {
  return `${branches.length} sites total`;
}
