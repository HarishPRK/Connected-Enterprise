import { useMemo, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { sampleSignals, type StoryContext } from './OfferingStoryMotion';
import { sampleFilmCue } from './OfferingFilmSequence';

export interface StoryAnnotationNodes {
  labels: Map<number, HTMLDivElement>;
  caption: Map<'chapter' | 'title' | 'subtitle', HTMLElement>;
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
      const show = !!signal?.visible && (!film || context.offering === 'routing' || (context.offering === 'failover' && index === 1));
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
    const cue = sampleFilmCue(context, timeRef.current);
    const chapter = nodes.current.caption.get('chapter'), title = nodes.current.caption.get('title'), subtitle = nodes.current.caption.get('subtitle');
    if (chapter && chapter.textContent !== cue.chapter) chapter.textContent = cue.chapter;
    if (title && title.textContent !== cue.title) title.textContent = cue.title;
    if (subtitle && subtitle.textContent !== cue.subtitle) subtitle.textContent = cue.subtitle;
  });
  return null;
}
