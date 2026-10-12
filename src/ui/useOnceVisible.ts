import { useEffect, useRef, useState } from 'react';

/** Mount expensive content on its first viewport intersection, then keep it mounted. */
export function useOnceVisible<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (visible || !element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        setVisible(true);
      }
    });
    // The initial observation also mounts charts already visible on a tall
    // viewport, without a scroll event or a synchronous layout measurement.
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible] as const;
}
