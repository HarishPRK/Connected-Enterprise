import { useId } from 'react';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}

/** Catmull-Rom → cubic-bezier smoothing so the trace reads as a curve, not a zig-zag. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 3) {
    return `M ${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')}`;
  }
  let d = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function Sparkline({
  values, width = 88, height = 28,
  stroke = 'var(--accent)', fill,
}: SparklineProps) {
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, '');
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  // A constant series (all 1s, all 0s) must sit at mid-height — mapping it
  // through the 0-span scale pins it to the bottom edge and reads as "broken".
  const flat = max - min < 1e-9;
  const pad = 3;
  const innerH = height - pad * 2;
  const yFor = (v: number) => (flat
    ? height / 2
    : pad + innerH - ((v - min) / (max - min)) * innerH);
  const dx = width / (values.length - 1);
  const pts = values.map((v, i) => [i * dx, yFor(v)] as [number, number]);
  const path = smoothPath(pts);
  const fillPath = `${path} L ${width},${height} L 0,${height} Z`;
  const fillTop = fill ?? 'rgba(var(--accent-rgb) / 0.25)';
  const [endX, endY] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillTop} />
          <stop offset="100%" stopColor={fillTop} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#spark-${gradId})`} />
      <path d={path} stroke={stroke} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={endX} cy={endY} r={4.5} fill={stroke} opacity={0.18} />
      <circle cx={endX} cy={endY} r={2} fill={stroke} />
    </svg>
  );
}
