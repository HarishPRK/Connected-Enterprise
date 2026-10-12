import { useEffect, useState } from 'react';
import { FlaskConical, LoaderCircle } from 'lucide-react';
import { fetchGatewaySimulator, startGatewaySimulator, type GatewaySimulatorJob } from './api';
import type { OnboardingOperation } from './types';

export function GatewaySimulator({ operation }: { operation: OnboardingOperation }) {
  const [file, setFile] = useState<File>();
  const [job, setJob] = useState<GatewaySimulatorJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await fetchGatewaySimulator(operation.id, controller.signal);
        if (!controller.signal.aborted) setJob(result.job);
      } catch { /* The operation's AWS polling remains independent. */ }
      finally { inFlight = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [operation.id]);
  const run = async () => {
    if (!file || busy) return;
    setBusy(true); setError(undefined);
    try { setJob((await startGatewaySimulator(operation.id, file)).job); setFile(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The simulator could not start.'); }
    finally { setBusy(false); }
  };
  return <section className="ce-onb-simulator" aria-labelledby="gateway-simulator-title">
    <h3 id="gateway-simulator-title"><FlaskConical size={18} aria-hidden="true" />Simulated gateway · live AWS</h3>
    <p>Connect a software gateway on EC2 using the bootstrap ZIP for <strong>{operation.serialNumber}</strong>. It exchanges real AWS certificates, retrieves the signed profile, and simulates applying it. The activation timeline uses AWS acknowledgements.</p>
    {job ? <p role="status">{job.state === 'running' && <LoaderCircle size={15} aria-hidden="true" />}{job.phase}</p> : operation.status !== 'IN_PROGRESS' ? <p>This operation has finished. Its recorded AWS result is shown below.</p> : <>
      <label htmlFor="simulator-package">Downloaded bootstrap package</label>
      <input id="simulator-package" type="file" accept=".zip,application/zip" disabled={busy || operation.status !== 'IN_PROGRESS'} onChange={event => { setFile(event.target.files?.[0]); setError(undefined); }} />
      <small>The ZIP includes a private key. It is sent to this application's EC2 server and stored in a protected per-device directory for the simulator.</small>
      <button type="button" className="primary" disabled={!file || busy || operation.status !== 'IN_PROGRESS'} onClick={() => void run()}>
        {busy ? <><LoaderCircle size={15} aria-hidden="true" />Starting simulator…</> : 'Connect simulated gateway'}
      </button>
      </>}
    {error && <p className="ce-onb-alert is-error" role="alert">{error}</p>}
  </section>;
}
