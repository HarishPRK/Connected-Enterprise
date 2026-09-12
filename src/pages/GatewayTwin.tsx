import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../ui/Toast';

// HTTPS host routes to the same target as the supplied public ALB :8080 URL.
// The studio owns its telemetry and controls; it does not implement the old
// gw-twin postMessage contract or the dashboard's branch-selection protocol.
const STUDIO_URL = 'https://studio.connectedenterprise.app/';
const LOAD_TIMEOUT_MS = 20_000;

export function GatewayTwinPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const fullscreenErrorAt = useRef(0);
  const [frameAttempt, setFrameAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { push } = useToast();

  const reportFullscreenError = useCallback((detail?: string) => {
    const now = Date.now();
    if (now - fullscreenErrorAt.current < 400) return;
    fullscreenErrorAt.current = now;
    push({
      kind: 'error',
      title: 'Full-screen action failed',
      detail: detail ?? 'Allow full-screen access in the browser, then try again.',
    });
  }, [push]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === pageRef.current);
    };
    const onFullscreenError = () => reportFullscreenError();
    const init = window.requestAnimationFrame(() => {
      setFullscreenSupported(Boolean(document.fullscreenEnabled && pageRef.current?.requestFullscreen));
      syncFullscreenState();
    });
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('fullscreenerror', onFullscreenError);
    return () => {
      window.cancelAnimationFrame(init);
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('fullscreenerror', onFullscreenError);
    };
  }, [reportFullscreenError]);

  useEffect(() => {
    if (loaded) return;
    const timeout = window.setTimeout(() => setLoadTimedOut(true), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [frameAttempt, loaded]);

  const reloadStudio = () => {
    setLoaded(false);
    setLoadTimedOut(false);
    setFrameAttempt((attempt) => attempt + 1);
  };

  const toggleFullscreen = async () => {
    const page = pageRef.current;
    if (!page || !fullscreenSupported) {
      reportFullscreenError('This browser does not support full-screen mode.');
      return;
    }
    try {
      if (document.fullscreenElement === page) await document.exitFullscreen();
      else if (document.fullscreenElement) reportFullscreenError('Exit the current full-screen view, then try again.');
      else await page.requestFullscreen();
    } catch (error) {
      reportFullscreenError(error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <div ref={pageRef} className={`gateway-twin-page${isFullscreen ? ' is-fullscreen' : ''}`}>
      <PageHeader
        title="GW Digital Twin Studio"
        subtitle="Gemtek OSPv2 · Explore gateway hardware, live operations and network simulations"
        right={
          <div className="gateway-twin-toolbar">
            <button type="button" className="gateway-twin-fullscreen-button" onClick={reloadStudio}>
              <RefreshCw size={16} aria-hidden="true" />Reload Twin
            </button>
            <a className="gateway-twin-fullscreen-button" href={STUDIO_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} aria-hidden="true" />Open in new tab
            </a>
            <button
              type="button"
              className="gateway-twin-fullscreen-button"
              disabled={!fullscreenSupported}
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit gateway twin full screen' : 'Open gateway twin full screen'}
              aria-pressed={isFullscreen}
            >
              {isFullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
              {isFullscreen ? 'Exit full screen' : 'Full screen'}
            </button>
          </div>
        }
      />
      <div className="gateway-twin-frame">
        {!loaded && (
          <div className="gateway-twin-loading" role={loadTimedOut ? 'alert' : 'status'}>
            {loadTimedOut
              ? 'The studio is taking longer to load. Try Reload Twin or Open in new tab.'
              : 'Loading Digital Twin Studio…'}
          </div>
        )}
        <iframe
          key={frameAttempt}
          src={STUDIO_URL}
          title="Gemtek Digital Twin Studio"
          onLoad={() => { setLoaded(true); setLoadTimedOut(false); }}
          onError={() => { setLoaded(false); setLoadTimedOut(true); }}
          style={{ border: 0, width: '100%', height: '100%', display: 'block', background: '#060709' }}
          allow="fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  );
}
