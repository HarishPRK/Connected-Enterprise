import { useLayoutEffect, useRef, useState } from 'react';
import type { GlobePin } from './BranchGlobe';
import texasUrl from '../../assets/atlas/texas-satellite.jpg?url';
import dfwUrl from '../../assets/atlas/dfw-satellite.jpg?url';
import './RegionalSatelliteMap.css';

const regions = {
  texas: { url: texasUrl, west: -108, south: 23, east: -88, north: 40, lon: -99.9, lat: 31.3, spanLon: 14.7, spanLat: 12.1 },
  dfw: { url: dfwUrl, west: -97.5, south: 32.35, east: -96.1, north: 33.65, lon: -96.80, lat: 33.0, spanLon: .92, spanLat: .77 },
};

interface RegionalSatelliteMapProps {
  region: keyof typeof regions;
  pins: GlobePin[];
  backLabel: string;
  onBack: () => void;
}

interface ProjectedPin { pin: GlobePin; x: number; y: number }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

// Split the short regional lists into west/east label columns. Leaders keep
// the actual branch coordinates exact when neighboring labels need to move.
function labelPins(projected: ProjectedPin[], width: number, height: number) {
  const byLongitude = [...projected].sort((a, b) => a.x - b.x);
  const halfway = Math.ceil(byLongitude.length / 2);
  return [byLongitude.slice(0, halfway), byLongitude.slice(halfway)].flatMap((column, side) => {
    const sorted = column.sort((a, b) => a.y - b.y);
    const ys: number[] = [];
    const firstY = 62, lastY = height - 24;
    const gap = Math.min(36, (lastY - firstY) / Math.max(1, sorted.length - 1));
    sorted.forEach(({ y }, i) => ys.push(Math.max(clamp(y, firstY, lastY), i ? ys[i - 1] + gap : firstY)));
    for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i], i < ys.length - 1 ? ys[i + 1] - gap : lastY);
    return sorted.map((item, i) => {
      const maxLabelWidth = width / 2 - 14;
      const labelWidth = Math.min(maxLabelWidth, 17 + item.pin.label.length * 7 + (item.pin.count > 1 ? 22 : 0));
      const labelX = side
        ? clamp(item.x + 20, width / 2 + 5, width - labelWidth - 8)
        : clamp(item.x - 20, labelWidth + 8, width / 2 - 5);
      return { ...item, left: side === 0, labelX, labelY: ys[i], maxLabelWidth: labelWidth };
    });
  });
}

export function RegionalSatelliteMap({ region, pins, backLabel, onBack }: RegionalSatelliteMapProps) {
  const frame = useRef<HTMLDivElement>(null);
  const lastRegion = useRef<typeof region | null>(null);
  const [size, setSize] = useState({ width: 640, height: 380 });
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const selector = lastRegion.current === 'dfw' && region === 'texas' ? '.regional-pin[data-cluster="true"]' : '.regional-back';
    frame.current?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
    lastRegion.current = region;
  }, [region]);
  const area = regions[region];
  const { width, height } = size;
  const cos = Math.cos(area.lat * Math.PI / 180);
  const fullLon = area.east - area.west, fullLat = area.north - area.south;
  const fit = Math.min(width / (area.spanLon * cos), height / area.spanLat);
  const scale = Math.max(fit, width / (fullLon * cos), height / fullLat);
  const imageWidth = fullLon * cos * scale, imageHeight = fullLat * scale;
  const imageLeft = clamp(width / 2 - (area.lon - area.west) * cos * scale, width - imageWidth, 0);
  const imageTop = clamp(height / 2 - (area.north - area.lat) * scale, height - imageHeight, 0);
  const markers = labelPins(pins.map(pin => ({
    pin, x: imageLeft + (pin.lon - area.west) * cos * scale, y: imageTop + (area.north - pin.lat) * scale,
  })), width, height);
  return <div className="regional-satellite-map" ref={frame} role="group" aria-label={region === 'texas' ? 'Texas satellite map' : 'Dallas–Fort Worth aerial map'}>
    <img className="regional-imagery" src={area.url} loading="lazy" decoding="async" alt="" style={{
      left: imageLeft, top: imageTop, width: imageWidth, height: imageHeight,
    }} />
    <svg className="regional-leaders" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {markers.map(({ pin, x, y, labelX, labelY }) => <line key={pin.id} x1={x} y1={y} x2={labelX} y2={labelY} />)}
    </svg>
    <button type="button" className="regional-back" onClick={onBack}><span aria-hidden="true">←</span>{backLabel}</button>
    {markers.map(({ pin, x, y, labelX, labelY, left, maxLabelWidth }) => <button type="button" key={pin.id} className="regional-pin"
      data-tone={pin.tone} data-selected={pin.selected} data-cluster={pin.count > 1} data-side={left ? 'left' : 'right'} style={{ left: x, top: y }}
      aria-label={pin.ariaLabel} aria-pressed={pin.count === 1 ? pin.selected : undefined} onClick={pin.activate}>
      <i aria-hidden="true" /><span className="regional-pin-label" style={{ left: labelX - x + 12, top: labelY - y + 12, maxWidth: maxLabelWidth }}>
        <span>{pin.label}</span>{pin.count > 1 && <b>{pin.count}</b>}
      </span>
    </button>)}
  </div>;
}

export default RegionalSatelliteMap;
