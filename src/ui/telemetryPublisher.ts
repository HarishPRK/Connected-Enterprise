/** Fold a delivery burst into one notification, while retaining every reducer update. */
export function createTelemetryPublisher<T>(initial: T, schedule: (run: () => void) => () => void = (run) => {
  const timer = setTimeout(run, 32);
  return () => clearTimeout(timer);
}) {
  let current = initial;
  let latest = initial;
  let cancel: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const flush = () => {
    cancel?.();
    cancel = null;
    if (Object.is(current, latest)) return;
    current = latest;
    for (const listener of listeners) listener();
  };
  const publish = (value: T) => {
    if (Object.is(latest, value)) return;
    latest = value;
    if (!cancel) cancel = schedule(flush);
  };
  return {
    getSnapshot: () => current,
    getLatest: () => latest,
    publish,
    update: (reduce: (previous: T) => T) => publish(reduce(latest)),
    flush,
    size: () => listeners.size,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** JSON wire values can share identities when a heartbeat repeats the same readings. */
export function sameTelemetryValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const first = left as Record<string, unknown>;
  const second = right as Record<string, unknown>;
  const keys = Object.keys(first);
  return keys.length === Object.keys(second).length
    && keys.every((key) => Object.hasOwn(second, key) && sameTelemetryValue(first[key], second[key]));
}

export function shareTelemetryRows<T extends { id: string }>(previous: readonly T[], incoming: T[]): T[] {
  const byId = new Map(previous.map((row) => [row.id, row]));
  const next = incoming.map((row) => {
    const old = byId.get(row.id);
    return old && sameTelemetryValue(old, row) ? old : row;
  });
  return previous.length === next.length && next.every((row, index) => row === previous[index])
    ? previous as T[] : next;
}
