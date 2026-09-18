import { useCallback, useSyncExternalStore } from 'react';

interface HistoryState<T> {
  data?: T;
  loading: boolean;
  error?: string;
}
interface Entry {
  state: HistoryState<unknown>;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
  pending?: Promise<void>;
}
const cache = new Map<string, Entry>();
const disabled: HistoryState<never> = { loading: false };

function entryFor(url: string): Entry {
  let entry = cache.get(url);
  if (!entry) {
    entry = { state: { loading: true }, listeners: new Set() };
    cache.set(url, entry);
  }
  return entry;
}

function load(url: string, entry: Entry) {
  if (entry.pending) return;
  entry.pending = fetch(url, { signal: AbortSignal.timeout(15_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error(`History request failed (${response.status})`);
      const data: unknown = await response.json();
      entry.state = { data, loading: false };
    })
    .catch(() => {
      entry.state = { ...entry.state, loading: false, error: 'History is unavailable. Retrying automatically.' };
    })
    .finally(() => {
      entry.pending = undefined;
      for (const listener of entry.listeners) listener();
    });
}

/** Share requests and retain the last good response across page navigation.
 * A slow request never overlaps the next poll or clears an existing chart. */
export function useChartHistory<T>(url: string | null): HistoryState<T> {
  const subscribe = useCallback((listener: () => void) => {
    if (!url) return () => {};
    const entry = entryFor(url);
    entry.listeners.add(listener);
    if (!entry.timer) {
      load(url, entry);
      entry.timer = setInterval(() => load(url, entry), 10_000);
    }
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) {
        clearInterval(entry.timer);
        entry.timer = undefined;
        // Bound cached fleet/filter combinations without evicting active charts.
        if (cache.size > 30) {
          for (const [key, value] of cache) {
            if (key !== url && !value.listeners.size && !value.pending) cache.delete(key);
            if (cache.size <= 30) break;
          }
        }
      }
    };
  }, [url]);
  const snapshot = useCallback(
    () => (url ? entryFor(url).state : disabled) as HistoryState<T>,
    [url],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
