import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { sampleCheckout } from './OfferingCheckoutStory';
import type { StoryContext } from './OfferingStoryMotion';

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
    const state = sampleCheckout(context, timeRef.current);
    if (state.stage === last.current) return;
    last.current = state.stage;
    paintTerminal(surface.paint,surface.texture,state);
  });
  return <mesh position={[7.2, 1.55625, 5.012]} rotation={[-.30, 0, 0]}>
    <planeGeometry args={[.225, .14375]} />
    <meshBasicMaterial map={surface.texture} toneMapped={false} />
  </mesh>;
}
