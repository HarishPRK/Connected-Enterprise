import { memo, useLayoutEffect, useRef } from 'react';

interface Props {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
}
const defaultFormat = (n: number) => String(Math.round(n));
const hiddenText = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 } as const;

/** Tween only the visual text node. Accessible text immediately reflects the
 * actual value, without announcing every intermediate animation frame. */
export const AnimatedNumber = memo(function AnimatedNumber({ value, format = defaultFormat, durationMs = 800 }: Props) {
  const visualRef = useRef<HTMLSpanElement>(null);
  const displayRef = useRef(0);
  const targetText = format(value);
  useLayoutEffect(() => {
    const node = visualRef.current;
    if (!node) return;
    let frame = 0;
    let stopped = false;
    const from = displayRef.current;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const write = (number: number) => {
      displayRef.current = number;
      const text = format(number);
      if (node.textContent !== text) node.textContent = text;
    };
    const finish = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      write(value);
    };
    if (!Number.isFinite(value) || !Number.isFinite(durationMs) || durationMs <= 0 || Math.abs(value - from) < 0.01 || motion.matches || document.hidden) {
      finish();
      return;
    }
    write(from);
    const start = performance.now();
    const tick = (now: number) => {
      if (stopped) return;
      const t = Math.max(0, Math.min(1, (now - start) / durationMs));
      write(from + (value - from) * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
      else stopped = true;
    };
    const checkVisibility = () => { if (document.hidden || motion.matches) finish(); };
    document.addEventListener('visibilitychange', checkVisibility);
    motion.addEventListener('change', checkVisibility);
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', checkVisibility);
      motion.removeEventListener('change', checkVisibility);
    };
  }, [value, durationMs, format]);
  return <><span ref={visualRef} aria-hidden="true">{targetText}</span><span style={hiddenText}>{targetText}</span></>;
}, (previous, next) => previous.value === next.value
  && previous.durationMs === next.durationMs
  && (previous.format ?? defaultFormat)(previous.value) === (next.format ?? defaultFormat)(next.value));
