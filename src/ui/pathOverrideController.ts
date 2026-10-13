export type ForceMode = 'auto' | 'fiber' | '5g';
export type PathCommand = 'auto' | 'fiber' | '5g' | 'tunnel1' | 'tunnel2' | 'tunnel3' | 'tunnel4';
export type PathOverridePhase = 'idle' | 'queued' | 'sending' | 'awaiting-ack' | 'awaiting-telemetry' | 'confirmed' | 'failed' | 'unconfirmed' | 'preview';

export interface PathTelemetry {
  activeTunnel: string;
  receivedAt: number;
  sourceTimestampMs?: number;
}

export interface PathOverrideState {
  mode: ForceMode;
  forcedTunnel: string | null;
  visualTunnel: string;
  phase: PathOverridePhase;
  message: string;
  requestedTunnel: string | null;
}

export interface PathOverrideSnapshot extends PathOverrideState {
  scope: string;
  sample: boolean;
}

export type PathTransport = (command: PathCommand) => Promise<{ pending: boolean }>;

export interface PathOverrideContext {
  scope: string;
  telemetry: PathTelemetry;
  sample?: boolean;
  send: PathTransport;
}

export interface PathOverrideControllerOptions extends PathOverrideContext {
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
  timeoutMs?: number;
}

export interface PathOverrideController {
  getSnapshot(): PathOverrideSnapshot;
  subscribe(listener: () => void): () => void;
  configure(context: PathOverrideContext): void;
  updateTelemetry(telemetry: PathTelemetry): void;
  request(mode: ForceMode, command: PathCommand, tunnel?: string): void;
  /** Starts a new lifecycle after React's development-effect cleanup. */
  activate(): void;
  dispose(): void;
}

type Intent = {
  id: number;
  epoch: number;
  mode: ForceMode;
  command: PathCommand;
  tunnel: string | null;
  baseline?: PathTelemetry;
  dispatchedAt?: number;
  response: { pending: boolean } | null;
  responseError?: string;
  observed: boolean;
  expired: boolean;
};

export function initialPathOverrideSnapshot(context: Pick<PathOverrideContext, 'scope' | 'sample' | 'telemetry'>): PathOverrideSnapshot {
  return {
    scope: context.scope,
    sample: Boolean(context.sample),
    mode: 'auto',
    forcedTunnel: null,
    visualTunnel: context.telemetry.activeTunnel,
    phase: 'idle',
    message: '',
    requestedTunnel: null,
  };
}

function finiteTimestamp(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function newerSample(sample: PathTelemetry, baseline: PathTelemetry) {
  if (!(sample.receivedAt > baseline.receivedAt)) return false;
  if (finiteTimestamp(baseline.sourceTimestampMs)) {
    return finiteTimestamp(sample.sourceTimestampMs) && sample.sourceTimestampMs > baseline.sourceTimestampMs;
  }
  return true;
}

function uncertainError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return name === 'AbortError' || name === 'TimeoutError' ||
    /failed to fetch|network(?: error| request failed)|timed? ?out|timeout/i.test(message);
}

/** Owns command ordering and evidence; it never invents an available or active route. */
export function createPathOverrideController(options: PathOverrideControllerOptions): PathOverrideController {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const timeoutMs = options.timeoutMs ?? 30_000;
  let context: PathOverrideContext = { scope: options.scope, telemetry: { ...options.telemetry }, sample: options.sample, send: options.send };
  let snapshot = initialPathOverrideSnapshot(context);
  let completedChoice: { mode: ForceMode; tunnel: string | null } = { mode: 'auto', tunnel: null };
  let disposed = false;
  let epoch = 0;
  let sequence = 0;
  let latest: Intent | null = null;
  let queued: Intent | null = null;
  let inFlight: Intent | null = null;
  let finished: Intent | null = null;
  let timeoutHandle: unknown;
  let timeoutScheduled = false;
  const listeners = new Set<() => void>();

  function emit(state: PathOverrideState) {
    if (disposed) return;
    const next = { ...state, scope: context.scope, sample: Boolean(context.sample) };
    if (Object.keys(next).every((key) => next[key as keyof PathOverrideSnapshot] === snapshot[key as keyof PathOverrideSnapshot])) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function clearDeadline() {
    if (!timeoutScheduled) return;
    cancel(timeoutHandle);
    timeoutScheduled = false;
  }

  function current(intent: Intent) {
    return !disposed && !intent.expired && intent.epoch === epoch && latest === intent;
  }

  function title(intent: Intent) {
    return intent.mode === 'auto' ? 'AUTO' : (intent.tunnel || (intent.mode === 'fiber' ? 'FIBER' : '5G')).toUpperCase();
  }

  function confirmationMessage(intent: Intent) {
    if (intent.mode === 'auto') return 'THE GATEWAY ACKNOWLEDGED AUTO MODE. THE DIAGRAM SHOWS THE REPORTED ROUTE.';
    if (context.telemetry.activeTunnel !== intent.tunnel) {
      return `THE REQUESTED PATH WAS OBSERVED. CURRENT REPORTED ROUTE: ${context.telemetry.activeTunnel.toUpperCase() || 'UNKNOWN'}.`;
    }
    if (intent.responseError) return `NEW TELEMETRY CONFIRMS ${title(intent)}. THE COMMAND RESPONSE FAILED; THE MODE ACK WAS NOT RECEIVED. ${intent.responseError}`;
    if (intent.response?.pending === false) return `NEW TELEMETRY CONFIRMS ${title(intent)}. THE GATEWAY ALSO ACKNOWLEDGED THE MODE.`;
    if (intent.response?.pending === true) return `NEW TELEMETRY CONFIRMS ${title(intent)}. THE MODE ACK WAS NOT RECEIVED.`;
    return `NEW TELEMETRY CONFIRMS ${title(intent)}. THE COMMAND RESPONSE IS STILL PENDING.`;
  }

  function confirm(intent: Intent) {
    if (!current(intent)) return;
    clearDeadline();
    completedChoice = { mode: intent.mode, tunnel: intent.tunnel };
    latest = null;
    finished = intent;
    emit({
      mode: intent.mode, forcedTunnel: intent.tunnel, visualTunnel: context.telemetry.activeTunnel,
      phase: 'confirmed', requestedTunnel: intent.tunnel, message: confirmationMessage(intent),
    });
  }

  function unconfirmed(intent: Intent, reason?: string) {
    if (!current(intent)) return;
    clearDeadline();
    intent.expired = true;
    latest = null;
    emit({
      mode: intent.mode, forcedTunnel: intent.tunnel, requestedTunnel: intent.tunnel,
      visualTunnel: context.telemetry.activeTunnel, phase: 'unconfirmed',
      message: `${title(intent)} WAS REQUESTED, BUT APPLICATION COULD NOT BE CONFIRMED. SHOWING THE REPORTED ROUTE.${reason ? ` ${reason}` : ''}`,
    });
  }

  function rejected(intent: Intent, error: unknown) {
    if (!disposed && !intent.expired && intent.epoch === epoch && finished === intent && latest === null) {
      intent.responseError = error instanceof Error ? error.message : String(error);
      emit({ ...snapshot, message: confirmationMessage(intent) });
      return;
    }
    if (!current(intent)) return;
    if (uncertainError(error)) {
      unconfirmed(intent, 'THE COMMAND MAY STILL HAVE REACHED THE GATEWAY.');
      return;
    }
    clearDeadline();
    latest = null;
    const detail = error instanceof Error ? error.message : String(error);
    emit({
      mode: completedChoice.mode, forcedTunnel: completedChoice.tunnel,
      requestedTunnel: intent.tunnel, visualTunnel: context.telemetry.activeTunnel, phase: 'failed',
      message: `${title(intent)} REQUEST FAILED. THE PREVIOUS CONFIRMED CHOICE WAS RESTORED. ${detail}`,
    });
  }

  function response(intent: Intent, result: { pending: boolean }) {
    if (disposed || intent.epoch !== epoch || intent.expired) return;
    if (!result || typeof result.pending !== 'boolean') {
      rejected(intent, new Error('The gateway returned an invalid command response.'));
      return;
    }
    if (finished === intent && latest === null) {
      intent.response = result;
      emit({ ...snapshot, message: confirmationMessage(intent) });
      return;
    }
    if (!current(intent)) return;
    intent.response = result;
    if (intent.mode === 'auto' && !result.pending) {
      confirm(intent);
      return;
    }
    emit({
      ...snapshot, phase: result.pending ? 'awaiting-ack' : 'awaiting-telemetry',
      message: result.pending
        ? `${title(intent)} COMMAND WAS SENT, BUT NO MODE ACK WAS RECEIVED. ${intent.mode === 'auto' ? 'AUTO NEEDS A GATEWAY ACK.' : 'WAITING FOR NEW ROUTE TELEMETRY.'}`
        : `THE GATEWAY ACKNOWLEDGED THE MODE. WAITING FOR NEW TELEMETRY TO CONFIRM ${title(intent)}.`,
    });
  }

  function dispatch(intent: Intent) {
    if (!current(intent) || context.sample || inFlight) return;
    queued = null;
    intent.baseline = { ...context.telemetry };
    intent.dispatchedAt = now();
    inFlight = intent;
    emit({ ...snapshot, phase: 'sending', message: `${title(intent)} REQUEST IS BEING SENT TO THE GATEWAY.` });
    timeoutScheduled = true;
    timeoutHandle = schedule(() => unconfirmed(intent), timeoutMs);
    let sending: Promise<{ pending: boolean }>;
    try { sending = Promise.resolve(context.send(intent.command)); }
    catch (error) { sending = Promise.reject(error); }
    void sending.then((result) => response(intent, result), (error: unknown) => rejected(intent, error)).finally(() => {
      if (inFlight === intent) inFlight = null;
      if (disposed || !queued || !current(queued)) return;
      const next = queued;
      dispatch(next);
    });
  }

  function updateTelemetry(telemetry: PathTelemetry) {
    if (disposed) return;
    const previous = context.telemetry;
    if (telemetry.receivedAt < previous.receivedAt) return;
    if (finiteTimestamp(previous.sourceTimestampMs) && finiteTimestamp(telemetry.sourceTimestampMs)) {
      if (telemetry.sourceTimestampMs < previous.sourceTimestampMs) return;
      if (telemetry.sourceTimestampMs === previous.sourceTimestampMs && telemetry.activeTunnel !== previous.activeTunnel) return;
    }
    if (telemetry.receivedAt === previous.receivedAt && telemetry.activeTunnel !== previous.activeTunnel) return;
    context = { ...context, telemetry: { ...telemetry } };
    if (latest?.baseline && latest.tunnel && telemetry.activeTunnel === latest.tunnel && newerSample(telemetry, latest.baseline)) {
      latest.observed = true;
      confirm(latest);
      return;
    }
    if (latest && latest.mode !== 'auto') return;
    if (context.sample && snapshot.phase === 'preview' && snapshot.forcedTunnel) return;
    emit({
      ...snapshot, visualTunnel: telemetry.activeTunnel,
      message: snapshot.phase === 'confirmed' && finished ? confirmationMessage(finished) : snapshot.message,
    });
  }

  const controller: PathOverrideController = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    configure(next) {
      if (disposed) return;
      const changed = context.scope !== next.scope || Boolean(context.sample) !== Boolean(next.sample);
      if (changed) {
        clearDeadline();
        epoch++;
        latest = null;
        queued = null;
        finished = null;
        completedChoice = { mode: 'auto', tunnel: null };
        context = { ...next, telemetry: { ...next.telemetry } };
        emit(initialPathOverrideSnapshot(context));
        return;
      }
      context = { ...context, send: next.send };
      updateTelemetry(next.telemetry);
    },
    updateTelemetry,
    request(mode, command, tunnel) {
      if (disposed) return;
      clearDeadline();
      finished = null;
      const requestedTunnel = mode === 'auto' ? null : tunnel?.trim() || null;
      const intent: Intent = { id: ++sequence, epoch, mode, command, tunnel: requestedTunnel, response: null, observed: false, expired: false };
      latest = intent;
      emit({
        mode, forcedTunnel: requestedTunnel, requestedTunnel,
        visualTunnel: requestedTunnel || context.telemetry.activeTunnel,
        phase: context.sample ? 'preview' : inFlight ? 'queued' : 'sending',
        message: context.sample ? 'CAPTURED SAMPLE PREVIEW. NO GATEWAY COMMAND WAS SENT.'
          : inFlight ? 'LATEST REQUEST QUEUED. THE PREVIOUS COMMAND IS FINISHING.' : `${title(intent)} REQUEST IS BEING SENT TO THE GATEWAY.`,
      });
      if (context.sample) { latest = null; queued = null; return; }
      if (inFlight) queued = intent;
      else dispatch(intent);
    },
    activate() {
      if (!disposed) return;
      disposed = false;
      epoch++;
      latest = null;
      queued = null;
      finished = null;
      completedChoice = { mode: 'auto', tunnel: null };
      emit(initialPathOverrideSnapshot(context));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      epoch++;
      clearDeadline();
      latest = null;
      queued = null;
      finished = null;
      listeners.clear();
    },
  };
  return controller;
}
