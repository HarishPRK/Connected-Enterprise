import { useEffect, useRef, useState } from 'react';

/* ─────────── AnimatedNumber
 * Smoothly tweens between numeric values using requestAnimationFrame and
 * easeOutCubic. On mount, animates from 0 → value (gives KPI cards a
 * "rolling up" effect). On value change, animates from the previously
 * displayed value → new value — so switching branches makes the metrics
 * visibly transition rather than snap.
 *
 * Pass a `format` function for non-integer or composite values:
 *   <AnimatedNumber value={99.92} format={n => `${n.toFixed(2)}%`} />
 *   <AnimatedNumber value={13}    format={n => `${Math.round(n)}/15`} />               */

interface Props {
  value: number;
  format?: (n: number) => string;
  /** Duration in ms (default 800). */
  durationMs?: number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  durationMs = 800,
}: Props) {
  const [display, setDisplay] = useState<number>(0);
  // Keep the latest displayed value in a ref so the next animation starts
  // from where the previous one ended (rather than jumping to a stale closure).
  const displayRef = useRef(0);
  displayRef.current = display;

  useEffect(() => {
    const startFrom = displayRef.current;
    const target = value;
    if (Math.abs(target - startFrom) < 0.01) {
      // No-op for tiny changes — avoid wasted RAF frames.
      setDisplay(target);
      return;
    }
    const startAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startAt) / durationMs);
      const eased = easeOutCubic(t);
      setDisplay(startFrom + (target - startFrom) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <>{format(display)}</>;
}
