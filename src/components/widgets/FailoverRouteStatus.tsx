import { ArrowRight, CheckCircle2, CircleAlert, Eye, Radio } from 'lucide-react';
import type { FailoverRoutePresentation } from './failoverSceneTypes';
import './FailoverRouteStatus.css';

export function FailoverRouteStatus({ route }: { route?: FailoverRoutePresentation }) {
  if (!route) return null;
  const warning = route.phase === 'failed' || route.phase === 'unconfirmed';
  const tone = warning ? 'warning' : route.phase === 'confirmed' ? 'confirmed' : route.phase === 'preview' ? 'preview' : 'pending';
  const Icon = warning ? CircleAlert : route.phase === 'confirmed' ? CheckCircle2 : route.phase === 'preview' ? Eye : Radio;
  const label = {
    queued: 'SWITCH QUEUED', sending: 'SWITCHING PATH', 'awaiting-ack': 'AWAITING GATEWAY',
    'awaiting-telemetry': 'GATEWAY ACKNOWLEDGED', confirmed: route.requested === 'AUTO SELECTION' ? 'AUTO ACKNOWLEDGED' : 'ROUTE OBSERVED',
    failed: 'REQUEST FAILED', unconfirmed: 'PATH NOT CONFIRMED', preview: 'LOCAL PREVIEW',
  }[route.phase];
  return <div className={`failover-route-status is-${tone}`} role="status" aria-live="polite" aria-atomic="true">
    <div className="failover-route-state"><Icon size={18} aria-hidden="true" /><div><strong>{label}</strong><span>{route.message}</span></div></div>
    <div className="failover-route-comparison">
      <div><span>LAST REPORTED</span><strong>{route.reported}</strong></div>
      <ArrowRight className="failover-route-arrow" size={18} aria-hidden="true" />
      <div className="failover-route-requested"><span>{route.phase === 'preview' ? 'PREVIEW ROUTE' : 'REQUESTED'}</span><strong>{route.requested}</strong></div>
    </div>
  </div>;
}
