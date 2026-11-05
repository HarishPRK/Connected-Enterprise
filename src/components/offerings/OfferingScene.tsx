export type OfferingId = 'failover' | 'routing' | 'twin' | 'eagle' | 'automation' | 'smart' | 'video';
export interface OfferingSceneProps {
  offering: OfferingId;
  variant: string;
  active: boolean;
  paused: boolean;
  selected: string | null;
  phase?: 0 | 1 | 2 | 3;
  timeRef?: RefObject<number>;
  revision?: number;
  followStory?: boolean;
  onCameraInteraction?: () => void;
  onReady?: () => void;
  finished?: boolean;
  onTogglePlayback?: () => void;
  onSeek?: (time: number) => void;
  onReplay?: () => void;
  onSelect: (id: string) => void;
  onOfferingSelect?: (id: OfferingId) => void;
}
export { default } from './OfferingSceneStore';
import type { RefObject } from 'react';
