interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}

export function Sparkline({
  values, width = 88, height = 28,
  stroke = 'var(--accent)', fill,
}: SparklineProps) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(1, max - min);
  const dx = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * dx).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`);
  const path = `M ${pts.join(' L ')}`;
  const fillPath = `${path} L ${width},${height} L 0,${height} Z`;
  const fillFinal = fill ?? 'rgba(var(--accent-rgb) / 0.20)';
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <path d={fillPath} fill={fillFinal} />
      <path d={path} stroke={stroke} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
