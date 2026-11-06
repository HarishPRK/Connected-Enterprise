import { useEffect, useRef, type RefObject } from 'react';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { clampStoryTime, formatStoryElapsed, STORY_DURATION } from './OfferingPlayback';

export function OfferingCinemaControls({ timeRef, paused, finished, reduced, revision, onToggle, onSeek, onReplay }: {
  timeRef: RefObject<number>; paused: boolean; finished: boolean; reduced: boolean; revision: number;
  onToggle?: () => void; onSeek?: (time: number) => void; onReplay?: () => void;
}) {
  const slider=useRef<HTMLInputElement>(null),elapsed=useRef<HTMLOutputElement>(null);
  useEffect(()=>{
    let frame=0;
    const sync=()=>{
      const time=clampStoryTime(timeRef.current);
      if(slider.current){slider.current.value=String(time);slider.current.style.setProperty('--elapsed',`${time/STORY_DURATION*100}%`);}
      if(elapsed.current)elapsed.current.textContent=formatStoryElapsed(time);
      if(!paused)frame=requestAnimationFrame(sync);
    };
    sync();return()=>cancelAnimationFrame(frame);
  },[timeRef,paused,revision]);
  const next=()=>{const next=[2.5,7.5,14,22].find(time=>time>timeRef.current+.2)??2.5;onSeek?.(next);};
  return <div className="offering-cinema-transport" aria-label="Cinema playback">
    <button type="button" aria-label={reduced?'Next story step':finished?'Replay film':paused?'Play film':'Pause film'} onClick={reduced?next:finished?onReplay:onToggle}>
      {reduced?<SkipForward size={18}/>:paused?<Play size={18}/>:<Pause size={18}/>}<span>{reduced?'Next step':finished?'Replay':paused?'Play':'Pause'}</span>
    </button>
    <button type="button" aria-label="Restart film" title="Restart film" onClick={onReplay}><RotateCcw size={16}/></button>
    <input ref={slider} type="range" min={0} max={STORY_DURATION} step={.1} defaultValue={0} aria-label="Film progress" onChange={event=>onSeek?.(Number(event.target.value))}/>
    <output ref={elapsed} aria-label="Film elapsed time">{formatStoryElapsed(0)}</output>
  </div>;
}
