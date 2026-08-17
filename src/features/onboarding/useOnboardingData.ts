import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchOnboardingSnapshot, ONBOARDING_EVENTS_URL } from './api';
import { onboardingSseEnabled } from './auth';
import type {
  Gateway,
  OnboardingEventEnvelope,
  OnboardingOperation,
  OnboardingSnapshot,
  ProfileVersion,
} from './types';

export type OnboardingStreamState = 'connecting' | 'connected' | 'reconnecting' | 'polling';

interface UseOnboardingDataResult {
  snapshot?: OnboardingSnapshot;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  streamState: OnboardingStreamState;
  refresh: () => Promise<void>;
  upsertOperation: (operation: OnboardingOperation) => void;
  upsertProfile: (profile: ProfileVersion) => void;
}

function isSnapshot(value: unknown): value is OnboardingSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<OnboardingSnapshot>;
  return Array.isArray(candidate.gateways)
    && Array.isArray(candidate.profiles)
    && Array.isArray(candidate.sites);
}

function isOperation(value: unknown): value is OnboardingOperation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<OnboardingOperation>;
  return typeof candidate.id === 'string'
    && typeof candidate.state === 'string'
    && typeof candidate.status === 'string';
}

function isGateway(value: unknown): value is Gateway {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Gateway>;
  return typeof candidate.id === 'string'
    && typeof candidate.serialNumber === 'string'
    && typeof candidate.state === 'string';
}

function isProfile(value: unknown): value is ProfileVersion {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProfileVersion>;
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.version === 'number';
}

function replaceById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [next, ...items];
  const copy = [...items];
  copy[index] = next;
  return copy;
}

export function useOnboardingData(): UseOnboardingDataResult {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [streamState, setStreamState] = useState<OnboardingStreamState>(() => (
    onboardingSseEnabled() ? 'connecting' : 'polling'
  ));

  const applySnapshot = useCallback((next: OnboardingSnapshot) => {
    setSnapshot(next);
    setLoading(false);
    setRefreshing(false);
    setError(undefined);
  }, []);

  const upsertOperation = useCallback((operation: OnboardingOperation) => {
    setSnapshot((current) => current
      ? { ...current, operations: replaceById(current.operations, operation), generatedAt: operation.updatedAt }
      : current);
  }, []);

  const upsertGateway = useCallback((gateway: Gateway) => {
    setSnapshot((current) => current
      ? { ...current, gateways: replaceById(current.gateways, gateway) }
      : current);
  }, []);

  const upsertProfile = useCallback((profile: ProfileVersion) => {
    setSnapshot((current) => current
      ? { ...current, profiles: replaceById(current.profiles, profile) }
      : current);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      applySnapshot(await fetchOnboardingSnapshot());
    } catch (cause) {
      setRefreshing(false);
      setLoading(false);
      setError(cause instanceof Error ? cause.message : 'Unable to load onboarding inventory.');
    }
  }, [applySnapshot]);

  useEffect(() => {
    const controller = new AbortController();
    fetchOnboardingSnapshot(controller.signal)
      .then(applySnapshot)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(cause instanceof Error ? cause.message : 'Unable to load onboarding inventory.');
      });
    return () => controller.abort();
  }, [applySnapshot]);

  useEffect(() => {
    if (onboardingSseEnabled()) return undefined;
    let controller: AbortController | undefined;
    let running = false;
    const poll = async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      controller = new AbortController();
      try {
        applySnapshot(await fetchOnboardingSnapshot(controller.signal));
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Unable to refresh onboarding inventory.');
        }
      } finally {
        running = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    const timer = window.setInterval(() => void poll(), 15_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      controller?.abort();
    };
  }, [applySnapshot]);

  useEffect(() => {
    if (!onboardingSseEnabled()) {
      return undefined;
    }
    const source = new EventSource(ONBOARDING_EVENTS_URL, { withCredentials: true });

    const applyEvent = (raw: string, kind?: string) => {
      try {
        const parsed = JSON.parse(raw) as OnboardingEventEnvelope | OnboardingSnapshot | OnboardingOperation | Gateway | ProfileVersion;
        if (kind === 'snapshot' && isSnapshot(parsed)) {
          applySnapshot(parsed);
          return;
        }
        if (kind === 'operation' && isOperation(parsed)) {
          upsertOperation(parsed);
          return;
        }
        if (kind === 'gateway' && isGateway(parsed)) {
          upsertGateway(parsed);
          return;
        }
        if (kind === 'profile' && isProfile(parsed)) {
          upsertProfile(parsed);
          return;
        }

        const envelope = parsed as OnboardingEventEnvelope;
        if (envelope.snapshot && isSnapshot(envelope.snapshot)) applySnapshot(envelope.snapshot);
        if (envelope.operation && isOperation(envelope.operation)) upsertOperation(envelope.operation);
        if (envelope.gateway && isGateway(envelope.gateway)) upsertGateway(envelope.gateway);
        if (envelope.profile && isProfile(envelope.profile)) upsertProfile(envelope.profile);

        if (isSnapshot(parsed)) applySnapshot(parsed);
        else if (isOperation(parsed)) upsertOperation(parsed);
      } catch {
        // A malformed event must not tear down the stream; the next snapshot
        // or the explicit refresh path will reconcile browser state.
      }
    };

    const listen = (kind: 'snapshot' | 'operation' | 'gateway' | 'profile') => {
      source.addEventListener(kind, (event) => applyEvent((event as MessageEvent<string>).data, kind));
    };
    listen('snapshot');
    listen('operation');
    listen('gateway');
    listen('profile');
    source.onmessage = (event) => applyEvent(event.data);
    source.onopen = () => setStreamState('connected');
    source.onerror = () => setStreamState('reconnecting');

    return () => source.close();
  }, [applySnapshot, upsertGateway, upsertOperation, upsertProfile]);

  return useMemo(
    () => ({ snapshot, loading, refreshing, error, streamState, refresh, upsertOperation, upsertProfile }),
    [snapshot, loading, refreshing, error, streamState, refresh, upsertOperation, upsertProfile],
  );
}
