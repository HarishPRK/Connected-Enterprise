import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';

/** RenderTexture keeps its last frame. Continuous visual changes render at the
 * main frame rate; a held pose, paused clock or static assembly needs one final
 * frame only. React is notified at these boundaries, never for each movie frame. */
export function useAnimatedScreenFrames(visualKey: () => string | number) {
  const [frames, setFrames] = useState(1);
  const previous = useRef<{ key: string | number | undefined; frames: number }>({ key: undefined, frames: 1 });
  useFrame(() => {
    const key = visualKey(), desired = key === previous.current.key ? 1 : Infinity;
    previous.current.key = key;
    if (desired === previous.current.frames) return;
    previous.current.frames = desired;
    setFrames(desired);
  });
  return frames;
}
