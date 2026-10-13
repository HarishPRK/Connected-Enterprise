import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPathOverrideController, initialPathOverrideSnapshot } from './pathOverrideController';
import type { ForceMode, PathCommand, PathOverrideContext, PathOverrideState } from './pathOverrideController';

export type { ForceMode, PathCommand, PathOverridePhase, PathTelemetry } from './pathOverrideController';

export interface UsePathOverrideResult extends PathOverrideState {
  request(mode: ForceMode, command: PathCommand, tunnel?: string): void;
}

/** Event handlers own commands; renders only read the controller's immutable snapshot. */
export function usePathOverride({ scope, telemetry, sample, send }: PathOverrideContext): UsePathOverrideResult {
  const [controller] = useState(() => createPathOverrideController({ scope, telemetry, sample, send }));
  const { activeTunnel, receivedAt, sourceTimestampMs } = telemetry;
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    controller.configure({ scope, sample, send, telemetry: { activeTunnel, receivedAt, sourceTimestampMs } });
  }, [controller, scope, sample, send, activeTunnel, receivedAt, sourceTimestampMs]);
  const stored = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const snapshot = stored.scope === scope && stored.sample === Boolean(sample)
    ? stored : initialPathOverrideSnapshot({ scope, sample, telemetry });
  const request = useCallback((mode: ForceMode, command: PathCommand, tunnel?: string) => {
    controller.configure({ scope, sample, send, telemetry: { activeTunnel, receivedAt, sourceTimestampMs } });
    controller.request(mode, command, tunnel);
  }, [controller, scope, sample, send, activeTunnel, receivedAt, sourceTimestampMs]);
  return {
    mode: snapshot.mode, forcedTunnel: snapshot.forcedTunnel, visualTunnel: snapshot.visualTunnel,
    phase: snapshot.phase, message: snapshot.message, requestedTunnel: snapshot.requestedTunnel, request,
  };
}
