import { useMemo, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { sampleSignals, type StoryContext } from './OfferingStoryMotion';
import { sampleFilmCue } from './OfferingFilmSequence';
import { sampleCheckout } from './OfferingCheckoutStory';
import { sampleRouting } from './OfferingRoutingStory';

export interface StoryAnnotationNodes {
  labels: Map<number, HTMLDivElement>;
  caption: Map<'chapter' | 'title' | 'subtitle', HTMLElement>;
  route: Map<'panel' | 'path' | 'status', HTMLElement>;
  routing: Map<'panel' | 'payment' | 'orders' | 'archive' | 'status' | 'fiber' | 'fiveG', HTMLElement>;
}

export function OfferingStoryAnnotationLayer({ nodes, visible, film }: {
  nodes: RefObject<StoryAnnotationNodes>; visible: boolean; film: boolean;
}) {
  return <div className="offering-story-annotations" aria-hidden="true" hidden={!visible}>
    {[0, 1, 2].map(index => <div key={index} className="offering-story-pin" ref={node => {
      if (node) nodes.current.labels.set(index, node); else nodes.current.labels.delete(index);
    }}><i /><span /></div>)}
    {film && <div className="offering-film-caption">
      <span ref={node => { if (node) nodes.current.caption.set('chapter', node); else nodes.current.caption.delete('chapter'); }} />
      <h3 ref={node => { if (node) nodes.current.caption.set('title', node); else nodes.current.caption.delete('title'); }} />
      <p ref={node => { if (node) nodes.current.caption.set('subtitle', node); else nodes.current.caption.delete('subtitle'); }} />
    </div>}
    {film && <div className="offering-film-route" hidden ref={node => { if(node)nodes.current.route.set('panel',node);else nodes.current.route.delete('panel'); }}>
      <strong>Where the payment goes</strong>
      <ol><li>Checkout</li><li>Edge gateway</li><li ref={node => { if(node)nodes.current.route.set('path',node);else nodes.current.route.delete('path'); }}>Fiber</li><li>Payment service</li></ol>
      <p ref={node => { if(node)nodes.current.route.set('status',node);else nodes.current.route.delete('status'); }} />
    </div>}
    {film && <div className="offering-film-route offering-routing-allocation" hidden ref={node => {if(node)nodes.current.routing.set('panel',node);else nodes.current.routing.delete('panel');}}>
      <strong>Route the request. Keep the footage.</strong><small>Illustrative link measurements · both links online</small>
      <div className="offering-routing-health">{(['fiber','fiveG'] as const).map(id=><span key={id} ref={node=>{if(node)nodes.current.routing.set(id,node);else nodes.current.routing.delete(id);}}/>)}</div>
      <dl>{(['payment','orders','archive'] as const).map((id,index)=><div key={id} style={{'--flow-color':['#8ce3c6','#ffc885','#b4a5ff'][index]} as React.CSSProperties}>
        <dt>{['Checkout','Online orders','Camera archive'][index]}</dt>
        <dd ref={node=>{if(node)nodes.current.routing.set(id,node);else nodes.current.routing.delete(id);}}/>
      </div>)}</dl>
      <p ref={node=>{if(node)nodes.current.routing.set('status',node);else nodes.current.routing.delete('status');}}/>
    </div>}
  </div>;
}

/** Keep scene labels crisp and screen-sized without a React render per frame. */
export function OfferingStoryAnnotationSync({ context, timeRef, nodes, visible, film }: {
  context: StoryContext; timeRef: RefObject<number>; nodes: RefObject<StoryAnnotationNodes>;
  visible: boolean; film: boolean;
}) {
  const { camera, size } = useThree();
  const point = useMemo(() => new Vector3(), []);
  useFrame(() => {
    if (!visible) return;
    camera.updateMatrixWorld();
    const signals = sampleSignals(context, timeRef.current);
    const occupied: { x: number; y: number; width: number }[] = [];
    for (let index = 0; index < 3; index++) {
      const node = nodes.current.labels.get(index), signal = signals[index];
      if (!node) continue;
      // The film caption carries the narrative. Only multi-path stories need
      // additional labels in the shot; manual focus still identifies its asset.
      const show = !!signal?.visible && (!film || context.offering === 'routing' || context.offering === 'twin' || context.offering === 'automation' || (context.offering === 'video' && timeRef.current >= 10.05 && timeRef.current < 13.05) || (context.offering === 'failover' && index === 1));
      node.style.visibility = show ? 'visible' : 'hidden';
      if (!show) continue;
      const text = node.lastElementChild;
      if (text && text.textContent !== signal.text) text.textContent = signal.text;
      node.style.setProperty('--pin-color', signal.color);
      point.set(...signal.at).project(camera);
      const width = Math.min(220, node.offsetWidth || 170);
      let x = (point.x * .5 + .5) * size.width;
      let y = (-point.y * .5 + .5) * size.height - 12;
      x = Math.max(width / 2 + 14, Math.min(size.width - width / 2 - 14, x));
      y = Math.max(28, Math.min(size.height - (film ? 145 : 75), y));
      for (const other of occupied) if (Math.abs(x - other.x) < (width + other.width) / 2 + 10 && Math.abs(y - other.y) < 34) y += 34;
      occupied.push({ x, y, width });
      node.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
      node.style.opacity = point.z < 1 ? '1' : '0';
    }
    if (!film) return;
    const allocation=sampleRouting(timeRef.current);
    const routing=nodes.current.routing;
    const panel=routing.get('panel');if(panel)panel.hidden=context.offering!=='routing'||timeRef.current<5.4||timeRef.current>=12.5;
    const allocationText = {
      payment: `${allocation.paymentPath} · ${allocation.paymentApproved?'approved':allocation.authorizationSent?'authorizing':allocation.policyApplied?'ready':'request held'}`,
      orders: `${allocation.ordersPath} · ${allocation.orderAccepted?'accepted':allocation.orderSent?'sending':'queued'}`,
      archive: `Fiber · ${allocation.archiveMbps} Mb/s${allocation.policyApplied?' (uploader cap)':''}`,
      fiber: `Fiber online · ${allocation.fiber.latencyMs} ms RTT · ${allocation.fiber.jitterMs} ms jitter`,
      fiveG: `5G online · ${allocation.fiveG.latencyMs} ms RTT · ${allocation.fiveG.jitterMs} ms jitter`,
      status: allocation.status,
    };
    for(const id of ['payment','orders','archive','fiber','fiveG','status'] as const){const node=routing.get(id);if(node&&node.textContent!==allocationText[id])node.textContent=allocationText[id];}
    const payment=sampleCheckout(context,timeRef.current);
    const route=nodes.current.route.get('panel'),path=nodes.current.route.get('path'),status=nodes.current.route.get('status');
    if(route){route.hidden=!payment.networkShot;route.dataset.recovered=String(!payment.delayed||timeRef.current>=10);}
    if(path&&path.textContent!==payment.route)path.textContent=payment.route;
    if(status&&status.textContent!==payment.routeStatus)status.textContent=payment.routeStatus;
    const cue = sampleFilmCue(context, timeRef.current);
    const chapter = nodes.current.caption.get('chapter'), title = nodes.current.caption.get('title'), subtitle = nodes.current.caption.get('subtitle');
    if (chapter && chapter.textContent !== cue.chapter) chapter.textContent = cue.chapter;
    if (title && title.textContent !== cue.title) title.textContent = cue.title;
    if (subtitle && subtitle.textContent !== cue.subtitle) subtitle.textContent = cue.subtitle;
  });
  return null;
}
