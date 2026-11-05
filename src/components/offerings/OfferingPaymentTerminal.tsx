import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { sampleCheckout } from './OfferingCheckoutStory';
import type { StoryContext } from './OfferingStoryMotion';
import { sampleEagle } from './OfferingEagleStory';

function paintLookup(c:CanvasRenderingContext2D,texture:CanvasTexture,state:ReturnType<typeof sampleEagle>){
  const delayed=state.symptom&&state.checkoutAffected,elapsed=delayed?state.endpointDelayMs:state.baselineResponseMs;
  c.fillStyle='#0a1a24';c.fillRect(0,0,768,480);c.textAlign='center';
  c.fillStyle='#adc6d0';c.font='500 31px sans-serif';c.fillText('CHECKOUT 01 / PRICE LOOKUP',384,53);
  c.fillStyle=delayed?'#ffd18b':'#91e2bf';c.font='600 100px sans-serif';
  c.fillText(elapsed>=1000?`${(elapsed/1000).toFixed(1)} s`:`${elapsed} ms`,384,178);
  c.fillStyle='#33494f';c.fillRect(45,211,678,16);c.fillStyle=delayed?'#e9ad6d':'#91e2bf';c.fillRect(45,211,678*Math.min(1,elapsed/3000),16);
  c.fillStyle='#eef4ee';c.font='600 47px sans-serif';c.fillText(delayed?'Response delayed':'Price lookup ready',384,305);
  c.fillStyle='#c2d5de';c.font='31px sans-serif';c.fillText('Normal response: 180 ms',384,370);
  c.font='26px sans-serif';c.fillText(delayed?'EA:GLE investigation requested':'Illustrative service check',384,432);
  texture.needsUpdate=true;
}

function paintTerminal(c:CanvasRenderingContext2D,texture:CanvasTexture,state:ReturnType<typeof sampleCheckout>){
    c.fillStyle = '#0a1a24'; c.fillRect(0, 0, 768, 480);
    c.textAlign = 'center'; c.fillStyle = '#adc6d0'; c.font = '500 35px sans-serif';
    c.fillText('MARKET · CHECKOUT 01', 384, 56);
    c.fillStyle = '#f2f7fa'; c.font = '600 115px sans-serif'; c.fillText('$24.80', 384, 190);
    c.fillStyle = state.color; c.fillRect(38, 228, 692, 3);
    c.font = '600 70px sans-serif'; c.fillText(state.title, 384, 324);
    c.fillStyle = '#c2d5de'; c.font = '400 35px sans-serif'; c.fillText(state.detail, 384, 398);
    texture.needsUpdate = true;
}

/** A real surface on the Blender reader, rather than a screen-space status card. */
export function OfferingPaymentTerminal({ context, timeRef }: { context: StoryContext; timeRef: RefObject<number> }) {
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 480;
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
    return { canvas, texture, paint: canvas.getContext('2d')! };
  }, []);
  const last = useRef('');
  useEffect(() => () => surface.texture.dispose(), [surface]);
  useFrame(() => {
    if(context.offering==='eagle'){
      const eagle=sampleEagle(context.variant,timeRef.current),key=`eagle/${eagle.checkoutAffected}/${Math.round(eagle.endpointDelayMs/50)}`;
      if(key!==last.current){last.current=key;paintLookup(surface.paint,surface.texture,eagle);}
      return;
    }
    const state = sampleCheckout(context, timeRef.current);
    const key = `${state.stage}/${state.title}/${state.detail}`;
    if (key === last.current) return;
    last.current = key;
    paintTerminal(surface.paint,surface.texture,state);
  });
  return <mesh position={[7.2, 1.55625, 5.012]} rotation={[-.30, 0, 0]}>
    <planeGeometry args={[.225, .14375]} />
    <meshBasicMaterial map={surface.texture} toneMapped={false} />
  </mesh>;
}
