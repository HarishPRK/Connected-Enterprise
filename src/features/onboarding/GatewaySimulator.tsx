import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FlaskConical, LoaderCircle, Play, RefreshCw, TriangleAlert } from 'lucide-react';
import { fetchGatewaySimulator, startGatewaySimulator, type GatewaySimulatorJob } from './api';
import { gatewayFlowPresentation } from './gatewayFlowPresentation';
import type { OnboardingOperation } from './types';

export function GatewaySimulator({ operation, initialError }: { operation: OnboardingOperation; initialError?: string }) {
  const [job, setJob] = useState<GatewaySimulatorJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);
  const [lookupReady, setLookupReady] = useState(false);
  const [lookupError, setLookupError] = useState<string>();
  const [lookupRevision, setLookupRevision] = useState(0);
  const startRef = useRef<AbortController | null>(null);
  const presentation = gatewayFlowPresentation(operation, job, busy);
  const working = ['starting', 'running', 'awaiting-confirmation'].includes(presentation.state);
  const receiveJob = (incoming: GatewaySimulatorJob | null) => {
    if (!incoming || incoming.operationId !== operation.id) return;
    setJob(current => current?.state !== 'running' && incoming.state === 'running' && current
      ? current : incoming);
  };
  useEffect(() => {
    if (operation.status !== 'IN_PROGRESS') return;
    const controller = new AbortController();
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await fetchGatewaySimulator(operation.id, controller.signal);
        if (!controller.signal.aborted) {
          if (result.job?.operationId === operation.id) setJob(current => current && current.state !== 'running' && result.job?.state === 'running' ? current : result.job);
          setLookupReady(true);
          setLookupError(undefined);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setLookupError(cause instanceof Error ? cause.message : 'The flow status could not be checked.');
      }
      finally { inFlight = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [operation.id, operation.status, lookupRevision]);
  useEffect(() => () => startRef.current?.abort(), [operation.id]);
  const run = async () => {
    if (!lookupReady || !presentation.canInitiate || startRef.current) return;
    const controller = new AbortController();
    startRef.current = controller;
    setBusy(true); setError(undefined);
    try {
      const result = await startGatewaySimulator(operation.id, `ce-simulator-${operation.id}`, controller.signal);
      if (!controller.signal.aborted) receiveJob(result.job);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The flow could not start. Check the operation status and try again.');
    } finally {
      if (!controller.signal.aborted) { startRef.current = null; setBusy(false); }
    }
  };
  return <section className="ce-onb-simulator" aria-labelledby="gateway-simulator-title">
    <h3 id="gateway-simulator-title"><FlaskConical size={18} aria-hidden="true" />Simulated gateway · live AWS</h3>
    <p>Initiate the software gateway for <strong>{operation.serialNumber}</strong>. The server prepares its connection and runs the flow. AWS identity and configuration retrieval are live; device application is simulated.</p>
    <div className="ce-onb-flow-status" data-state={presentation.state} role="status" aria-live="polite" aria-atomic="true">
      {working ? <LoaderCircle size={18} aria-hidden="true" /> : presentation.state === 'confirmed' ? <CheckCircle2 size={18} aria-hidden="true" /> : presentation.state === 'failed' ? <TriangleAlert size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
      <div><strong>{presentation.title}</strong><span>{presentation.detail}</span></div>
    </div>
    <div className="ce-onb-flow-actions">
      <button type="button" className="primary" disabled={!lookupReady || !presentation.canInitiate} onClick={() => void run()}>
        {working ? <LoaderCircle size={15} aria-hidden="true" /> : presentation.state === 'confirmed' ? <CheckCircle2 size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        {working ? 'FLOW IN PROGRESS' : presentation.state === 'confirmed' ? 'FLOW CONFIRMED' : 'INITIATE FLOW'}
      </button>
      {!lookupReady && operation.status === 'IN_PROGRESS' && !lookupError && <small>Checking for an existing flow…</small>}
    </div>
    {lookupError && <p className="ce-onb-alert is-warning" role="status"><span>{lookupError} The operation timeline below remains authoritative.</span><button type="button" onClick={() => setLookupRevision(value => value + 1)}><RefreshCw size={14} aria-hidden="true" />Check status</button></p>}
    {error && <p className="ce-onb-alert is-error" role="alert">{error}</p>}
  </section>;
}
