import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultRoutingConfig, type RoutingConfig } from '../../shared/routing-config';

async function requestConfig(branchId: string, update?: RoutingConfig, signal?: AbortSignal): Promise<RoutingConfig> {
  const response = await fetch(`/api/routing/config/${encodeURIComponent(branchId)}`, {
    method: update ? 'PUT' : 'GET',
    headers: update ? { 'Content-Type': 'application/json' } : undefined,
    body: update ? JSON.stringify(update) : undefined,
    cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(data?.error ?? `Routing configuration request failed (${response.status}).`);
  if (!data || data.branchId !== branchId || !Array.isArray(data.policies) || !Array.isArray(data.thresholds)) {
    throw new Error('The service did not return a valid routing configuration.');
  }
  return data as RoutingConfig;
}

export function useRoutingConfig(branchId: string) {
  const [state, setState] = useState(() => ({ config: defaultRoutingConfig(branchId), loading: true, saving: false, error: '' }));
  const activeBranch = useRef(branchId);
  const savingRef = useRef(false);
  activeBranch.current = branchId;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    try {
      const config = await requestConfig(branchId, undefined, signal);
      if (activeBranch.current === branchId && !signal?.aborted) setState({ config, loading: false, saving: false, error: '' });
    } catch (error) {
      if (activeBranch.current === branchId && !signal?.aborted) {
        setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }, [branchId]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ config: defaultRoutingConfig(branchId), loading: true, saving: false, error: '' });
    void refresh(controller.signal);
    return () => controller.abort();
  }, [branchId, refresh]);
  const save = useCallback(async (patch: Partial<Pick<RoutingConfig, 'policies' | 'thresholds'>>) => {
    if (savingRef.current || state.loading || state.config.branchId !== branchId) throw new Error('Wait for routing configuration to finish loading or saving.');
    savingRef.current = true;
    setState((previous) => ({ ...previous, saving: true, error: '' }));
    try {
      const config = await requestConfig(branchId, { ...state.config, ...patch });
      if (activeBranch.current === branchId) setState({ config, loading: false, saving: false, error: '' });
      return config;
    } catch (error) {
      if (activeBranch.current === branchId) setState((previous) => ({ ...previous, saving: false, error: error instanceof Error ? error.message : String(error) }));
      throw error;
    } finally { savingRef.current = false; }
  }, [branchId, state.config, state.loading]);
  return { ...state, refresh, save };
}
