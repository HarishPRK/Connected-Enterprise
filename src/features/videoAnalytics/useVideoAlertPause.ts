import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'ce-video-alert-popups-v1';
type Preference = { paused: boolean; resumedAt: number };

function readPreference(): Preference {
  // Pop-ups are paused by default until the operator explicitly resumes them.
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && typeof saved === 'object' && 'paused' in saved && 'resumedAt' in saved
      && typeof saved.paused === 'boolean' && typeof saved.resumedAt === 'number'
      && Number.isFinite(saved.resumedAt) && saved.resumedAt >= 0) {
      return { paused: saved.paused, resumedAt: saved.resumedAt };
    }
  } catch { /* Fall back to the requested pause when storage is unavailable. */ }
  return { paused: true, resumedAt: 0 };
}

export function useVideoAlertPause() {
  const [preference, setPreference] = useState(readPreference);
  const setPaused = useCallback((next: boolean) => {
    const updated = { paused: next, resumedAt: next ? 0 : Date.now() };
    setPreference(updated);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); }
    catch { /* The choice still applies for this page when storage is blocked. */ }
  }, []);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) setPreference(readPreference());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return { ...preference, setPaused };
}
