import { useEffect, useState } from 'react';

export interface DonutSegment {
  key: string;
  label: string;
  count: number;
  /** Devices in this segment needing attention — drawn on the thin outer health arc. */
  attention?: number;
}

interface SegmentDonutProps {
  segments: DonutSegment[];
  size?: number;
  radius?: number;
  strokeWidth?: number;
  /** Color for segment i — shared with the parent's legend dots. */
  colorFor: (index: number) => string;
  centerLabel?: string;
  hoverIndex?: number | null;
  onHover?: (index: number | null) => void;
}

const SEGMENT_GAP = 2.5;
const MIN_ARC = 1.5;

/**
 * Theme-aware segmented donut. The track uses var(--border) so it stays
 * visible in both themes; segments sweep in on mount and highlight on hover
 * (the center number flips to the hovered category). Segments with attention
 * counts get a thin warn-colored arc just outside the ring.
 */
export function SegmentDonut({
  segments,
  size = 100,
  radius = size * 0.32,
  strokeWidth = size * 0.1,
  colorFor,
  centerLabel = 'Total',
  hoverIndex = null,
  onHover,
}: SegmentDonutProps) {
  const cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.count, 0) || 1;

  // Sweep-in: segments transition from zero-length dashes to their final
  // arcs on the frame after mount, staggered per segment.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const outerR = radius + strokeWidth / 2 + 3;
  const outerC = 2 * Math.PI * outerR;
  const hovered = hoverIndex != null ? segments[hoverIndex] : null;

  const fracs = segments.map((s) => s.count / total);
  const arcs = segments.map((s, i) => ({
    segment: s,
    index: i,
    dash: Math.max(MIN_ARC, C * fracs[i] - SEGMENT_GAP),
    start: C * fracs.slice(0, i).reduce((sum, f) => sum + f, 0),
  }));

  const valueSize = Math.round(size * 0.17);
  const labelSize = Math.max(7, Math.round(size * 0.08));

  return (
    <svg width={size} height={size} style={{ flexShrink: 0, overflow: 'visible' }}>
      <circle cx={cx} cy={cy} r={radius} stroke="var(--border)" strokeWidth={strokeWidth} fill="none" />
      {arcs.map(({ segment: s, index: i, dash, start }) => {
        const dimmed = hoverIndex != null && hoverIndex !== i;
        return (
          <circle
            key={s.key}
            cx={cx} cy={cy} r={radius}
            stroke={colorFor(i)}
            strokeWidth={hoverIndex === i ? strokeWidth + 2 : strokeWidth}
            fill="none"
            strokeDasharray={mounted ? `${dash} ${C - dash}` : `0 ${C}`}
            strokeDashoffset={-start}
            strokeLinecap="butt"
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{
              opacity: dimmed ? 0.3 : 1,
              transition: `stroke-dasharray 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${i * 70}ms, opacity 0.15s ease, stroke-width 0.15s ease`,
              cursor: onHover ? 'pointer' : undefined,
            }}
            onMouseEnter={onHover ? () => onHover(i) : undefined}
            onMouseLeave={onHover ? () => onHover(null) : undefined}
          />
        );
      })}
      {/* Thin outer health arc — one warn segment per category with attention,
          anchored at that category's start angle. */}
      {mounted && arcs.map(({ segment: s, start }) => {
        if (!s.attention) return null;
        const frac = s.attention / total;
        const dash = Math.max(3, outerC * frac);
        const outerStart = (start / C) * outerC;
        return (
          <circle
            key={`attn-${s.key}`}
            cx={cx} cy={cy} r={outerR}
            stroke="var(--warn)"
            strokeWidth={2.5}
            fill="none"
            strokeDasharray={`${dash} ${outerC - dash}`}
            strokeDashoffset={-outerStart}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ opacity: 0.9 }}
          />
        );
      })}
      <text x={cx} y={cy - size * 0.02} textAnchor="middle" fontSize={valueSize} fontWeight="700" fill="var(--text)"
        style={{ fontVariantNumeric: 'tabular-nums' }}>
        {hovered ? hovered.count : total}
      </text>
      <text x={cx} y={cy + size * 0.11} textAnchor="middle" fontSize={labelSize} fill="var(--text-muted)"
        style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {hovered ? hovered.label : centerLabel}
      </text>
    </svg>
  );
}

