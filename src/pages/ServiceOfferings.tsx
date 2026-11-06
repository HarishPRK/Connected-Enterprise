import { lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, CircleDot, Layers3, Maximize2, Pause, Play, RotateCcw, Route } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { StudioSceneBoundary } from '../ui/StudioSceneBoundary';
import { COMPONENT_DETAILS, OFFERING_CHAPTERS, type OfferingId } from '../components/offerings/offeringCatalog';
import { getOfferingStory } from '../components/offerings/offeringStories';
import { getOfferingUseCase } from '../components/offerings/offeringUseCases';
import { OfferingDeviceGuide, OfferingRoutingReadout } from '../components/offerings/OfferingDeviceGuide';
import '../components/offerings/enterprise-field-guide.css';

const OfferingScene = lazy(() => import('../components/offerings/OfferingScene'));
const BEATS = ['Business as usual', 'The incident', 'Edge response', 'The outcome'];
const BEAT_TIMES = [2.5, 7.5, 14, 22];
const DURATION = 24;
const PLAYBACK_SECONDS = 36;
const OFFERING_TONES = { failover: 'cyan', routing: 'blue', twin: 'lilac', eagle: 'mint', automation: 'amber', smart: 'mint', video: 'coral' } as const;
const phaseAt = (time: number, offering: OfferingId): 0 | 1 | 2 | 3 => offering === 'smart'
  ? time >= 18 ? 3 : time >= 10.5 ? 2 : time >= 4 ? 1 : 0
  : offering === 'eagle' ? time >= 18 ? 3 : time >= 12.5 ? 2 : time >= 3 ? 1 : 0
  : time >= 17 ? 3 : time >= 10 ? 2 : time >= 4 ? 1 : 0;

export function ServiceOfferingsPage() {
  const [params, setParams] = useSearchParams();
  const offering = OFFERING_CHAPTERS.find(item => item.id === params.get('offering')) ?? OFFERING_CHAPTERS[0];
  const index = OFFERING_CHAPTERS.indexOf(offering);
  const playbackSeconds = ['eagle','smart'].includes(offering.id) ? 72 : ['automation','routing'].includes(offering.id) ? 60 : PLAYBACK_SECONDS;
  const beatTimes = offering.id === 'smart' ? [2.5,8.5,16.8,23] : offering.id === 'eagle' ? [1,10.5,17.5,23] : BEAT_TIMES;
  const [variantId, setVariantId] = useState(offering.variants[0].id);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [followStory, setFollowStory] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [sceneReady, setSceneReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [touring, setTouring] = useState(false);
  const [finished, setFinished] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(true);
  const hostRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const phaseRef = useRef(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const variant = offering.variants.find(item => item.id === variantId) ?? offering.variants[0];
  const story = getOfferingStory(offering, variant);
  const useCase = getOfferingUseCase(offering, variant);
  const beat = story[phase];
  const detail = selected ? COMPONENT_DETAILS[selected] : undefined;
  const active = phase >= 1;

  const seek = useCallback((time: number, chapter: OfferingId = 'failover') => {
    timeRef.current = time;
    phaseRef.current = phaseAt(time,chapter);
    setPhase(phaseAt(time,chapter));
    setFinished(time >= DURATION);
    setRevision(value => value + 1);
    if (progressRef.current) progressRef.current.style.transform = `scaleX(${time / DURATION})`;
    if (rangeRef.current) rangeRef.current.value = String(time);
  }, []);

  const changeOffering = useCallback((id: OfferingId) => {
    const nextOffering = OFFERING_CHAPTERS.find(item => item.id === id)!;
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('offering', id);
      return next;
    }, { replace: true, preventScrollReset: true });
    setVariantId(nextOffering.variants[0].id);
    setSelected(null);
    seek(0);
  }, [setParams, seek, setSelected, setVariantId]);

  function selectOffering(id: OfferingId) {
    changeOffering(id);
    setTouring(false);
    setPlaying(!reducedMotion);
    setFollowStory(!reducedMotion);
  }

  function togglePlayback() {
    if(finished)seek(0);
    if(!playing&&offering.id==='twin')setFollowStory(true);
    setPlaying(!playing);setTouring(false);
  }
  function replayFilm() { seek(reducedMotion?beatTimes[0]:0,offering.id);setFollowStory(true);setPlaying(!reducedMotion);setTouring(false); }
  async function watchCinema() {
    const scene=stageRef.current?.querySelector<HTMLElement>('.offering-scene');
    // Request fullscreen directly from the click so browser gesture permission
    // is retained. If unavailable, the same film plays in the embedded stage.
    try { await scene?.requestFullscreen(); } catch { /* Embedded playback remains available. */ }
    replayFilm();
  }
  function watchStory() {
    seek(reducedMotion ? beatTimes[0] : 0,offering.id);
    setFollowStory(true);
    setTouring(false);
    setPlaying(!reducedMotion);
    stageRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => { setReducedMotion(media.matches); if (media.matches) { setPlaying(false); setTouring(false); } };
    let inView = true;
    const updateVisibility = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(entries => { inView = entries[entries.length - 1]?.isIntersecting ?? false; updateVisibility(); });
    if (hostRef.current) observer.observe(hostRef.current);
    media.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => { observer.disconnect(); media.removeEventListener('change', updateMotion); document.removeEventListener('visibilitychange', updateVisibility); };
  }, []);

  const onSceneReady = useCallback(() => setSceneReady(true), []);
  const leaveStoryCamera = useCallback(() => setFollowStory(false), []);
  const running = playing && sceneReady && visible && !reducedMotion && !finished;
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let previous: number | undefined;
    const tick = (now: number) => {
      const delta = previous === undefined ? 0 : Math.min((now - previous) / 1000, .1);
      previous = now;
      const time = Math.min(DURATION, timeRef.current + delta * DURATION / playbackSeconds);
      timeRef.current = time;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${time / DURATION})`;
      if (rangeRef.current) rangeRef.current.value = String(time);
      const nextPhase = phaseAt(time,offering.id);
      if (nextPhase !== phaseRef.current) { phaseRef.current = nextPhase; setPhase(nextPhase); }
      if (time >= DURATION) {
        if (touring && index < OFFERING_CHAPTERS.length - 1) changeOffering(OFFERING_CHAPTERS[index + 1].id);
        else { setFinished(true); setPlaying(false); setTouring(false); }
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, touring, index, changeOffering, playbackSeconds, offering.id]);

  function selectPhase(next: number) { setPlaying(false); setTouring(false); setFollowStory(true); seek(beatTimes[next],offering.id); }
  function toggleTour() {
    if (touring) { setTouring(false); setPlaying(false); return; }
    changeOffering(OFFERING_CHAPTERS[0].id);
    setFollowStory(true);
    setTouring(true); setPlaying(true);
  }

  return <div className="service-offerings-page enterprise-offerings-page">
    <PageHeader title="Challenges / Offerings" subtitle="Real-world challenges, played out in one connected enterprise."
      right={<span className="enterprise-capability-count"><Layers3 size={15} aria-hidden="true" />7 offerings</span>} />
    <section className="solution-showcase enterprise-showcase" ref={hostRef} aria-labelledby="enterprise-showcase-title" data-color={OFFERING_TONES[offering.id]}>
      <div className="showcase-heading"><div><span className="enterprise-guide-kicker"><Layers3 size={14} aria-hidden="true" />Enterprise field guide</span><h2 id="enterprise-showcase-title">Inside the connected store</h2><p className="enterprise-heading-sub">People, equipment, and the services that keep the day moving.</p></div>
        <div className="showcase-heading-actions"><span className="showcase-disclosure">{touring ? `Tour ${index + 1} / 7` : 'One store · 7 offerings'}</span>
          {!reducedMotion && <button type="button" className="showcase-tour" aria-pressed={touring} onClick={toggleTour}>{touring ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{touring ? 'End tour' : 'Play store tour'}</button>}
        </div>
      </div>
      <div className="showcase-frame"><div className="showcase-panel">
        <nav className="showcase-scenarios" aria-label="Offerings in priority order">{OFFERING_CHAPTERS.map((item, i) => {
          const Icon = item.icon;
          return <button type="button" key={item.id} aria-pressed={offering.id === item.id} aria-label={`${i + 1}. ${item.title}`} onClick={() => selectOffering(item.id)}
            data-color={OFFERING_TONES[item.id]}>
            <span className="enterprise-offering-number">{String(i + 1).padStart(2, '0')}</span><Icon size={18} aria-hidden="true" /><span>{item.navTitle}</span>
          </button>;
        })}</nav>
        <div className="enterprise-case-summary">
          <div className="enterprise-brief-index"><span>Field briefing</span><span>{String(index + 1).padStart(2, '0')} / 07</span></div>
          <div className="enterprise-case-copy"><span>{useCase.setting}</span><h3>{useCase.title}</h3><p>{useCase.stakes}</p></div>
          <div className="enterprise-case-actions">
            <button type="button" className="enterprise-watch-story" onClick={watchStory}><Play size={17} aria-hidden="true" />{reducedMotion ? 'Explore the story' : 'Watch story'}<span>{reducedMotion ? '4 steps' : `${playbackSeconds} s`}</span></button>
            <button type="button" className="enterprise-cinema" disabled={!sceneReady} onClick={()=>void watchCinema()}><Maximize2 size={16} aria-hidden="true"/>{reducedMotion?'Explore in cinema':'Watch in cinema'}</button>
            <button type="button" className="enterprise-follow-story" aria-pressed={followStory} onClick={() => setFollowStory(!followStory)}><Route size={14} aria-hidden="true" />{followStory ? 'Following the action' : 'Follow the action'}</button>
          </div>
        </div>
        <div className="showcase-visual" ref={stageRef}>
          <div className="showcase-scene-heading"><span><strong>{offering.title}</strong><span className="showcase-location">{offering.category}</span></span><span className="showcase-scene-mode">{!sceneReady ? 'Preparing scene' : running ? 'Story playing' : finished ? 'Story complete' : 'Story paused'} · {BEATS[phase]}</span></div>
          <div className="showcase-canvas-wrap enterprise-canvas-wrap">
            <StudioSceneBoundary fallback={<EnterpriseFallback offering={offering.id} onOfferingSelect={selectOffering} onReady={onSceneReady} />}
              loading={<div className="enterprise-scene-loading"><Layers3 size={32} strokeWidth={1} aria-hidden="true" /><strong>Preparing the connected store</strong><span>Explore the scenarios while the 3D environment loads.</span></div>}>
              <OfferingScene offering={offering.id} variant={variant.id} active={active} phase={phase} paused={!running} selected={selected} onSelect={setSelected} onOfferingSelect={selectOffering}
                timeRef={timeRef} revision={revision} followStory={followStory} onCameraInteraction={leaveStoryCamera} onReady={onSceneReady} finished={finished} onTogglePlayback={togglePlayback} onSeek={time=>{seek(time,offering.id);setPlaying(false);setTouring(false);}} onReplay={replayFilm} />
            </StudioSceneBoundary>
          </div>
          <div className="showcase-scene-caption"><span className="showcase-status"><span />{beat.status}</span><span className="showcase-scene-format">Illustrative scenario</span></div>
          {offering.id === 'automation' && <OfferingDeviceGuide onSelect={setSelected}/>}
          {offering.id === 'routing' && <OfferingRoutingReadout timeRef={timeRef} variant={variant.id} revision={revision} running={running}/>}
        </div>
        <aside className="showcase-sensors" aria-label="Offering story and activity">
          <div className="enterprise-variant-picker" role="group" aria-label={`${offering.title} scenarios`}>{offering.variants.map(item => <button type="button" key={item.id} aria-pressed={variant.id === item.id}
            onClick={() => { setVariantId(item.id); setSelected(null); setTouring(false); setPlaying(!reducedMotion); setFollowStory(!reducedMotion); seek(0); }}>{item.label}</button>)}</div>
          <div className="showcase-narrative" aria-live="polite" aria-atomic="true"><div className="showcase-chapter-label"><span>{phase + 1}</span>{BEATS[phase]}</div><h3>{beat.title}</h3><p>{beat.description}</p></div>
          <details className="showcase-sensor-readings"><summary>Scenario activity</summary><ul>{beat.signals.map(signal => <li key={signal.label}><span className="showcase-sensor-dot" /><div><strong>{signal.label}</strong></div><em>{signal.value}</em></li>)}</ul></details>
          {phase === 3 && <div className="enterprise-business-outcome"><span>Business outcome</span><p>{useCase.outcome}</p></div>}
          {detail && <div className="enterprise-component-inspector" aria-live="polite"><span><CircleDot size={13} aria-hidden="true" />Component focus</span><h4>{detail.title}</h4><p>{detail.detail}</p><div>{detail.signals.map(signal => <small key={signal}>{signal}</small>)}</div><button type="button" onClick={() => setSelected(null)}>Clear selection</button></div>}
          <div className="showcase-service"><div className="showcase-service-heading"><offering.icon size={16} aria-hidden="true" /><span>{offering.category}</span></div>
            {offering.links.map(link => <Link key={link.href} to={link.href}>{link.label}<ArrowRight size={14} aria-hidden="true" /></Link>)}
          </div>
        </aside>
        <div className="showcase-transport">
          <div className="showcase-playback">
            {reducedMotion ? <button type="button" className="showcase-play" onClick={() => selectPhase((phase + 1) % 4)}><ChevronRight size={16} aria-hidden="true" />Next step</button>
              : <button type="button" className="showcase-play" aria-label={finished ? 'Replay scenario' : playing ? 'Pause scenario' : 'Play scenario'} onClick={togglePlayback}>{playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{finished ? 'Replay' : playing ? 'Pause' : 'Play'}</button>}
            <button type="button" className="showcase-restart" aria-label="Reset scenario" title="Reset scenario" onClick={() => { seek(0); setPlaying(false); setTouring(false); }}><RotateCcw size={16} aria-hidden="true" /></button><span className="showcase-chapter-count">{phase + 1} / 4</span>
          </div>
          <div className="showcase-timeline"><div className="showcase-progress-track"><div ref={progressRef} style={{ transform: 'scaleX(0)' }} /></div>
            <input ref={rangeRef} type="range" min={0} max={DURATION} step={.1} defaultValue={0} aria-label="Scenario progress" aria-valuetext={`${BEATS[phase]}: ${beat.status}`}
              onChange={event => { seek(Number(event.target.value),offering.id); setPlaying(false); setTouring(false); }} />
            <div className="showcase-chapters" aria-label="Story steps">{BEATS.map((name, i) => <button type="button" key={name} aria-current={phase === i ? 'step' : undefined} onClick={() => selectPhase(i)}><span className="showcase-step-number">{phase > i ? <Check size={12} aria-hidden="true" /> : i + 1}</span>{name}</button>)}</div>
          </div>
        </div>
      </div></div>
      <p className="showcase-footnote">{reducedMotion ? 'Reduced motion is on. Choose a story step to see its settled scene. ' : 'Watch follows the action; drag the scene to explore freely. ' }Illustrative business scenarios. These controls do not operate connected equipment.</p>
    </section>
    <section className="enterprise-capabilities" aria-labelledby="enterprise-capabilities-title">
      <div className="enterprise-capabilities-heading"><h2 id="enterprise-capabilities-title">Stories from the store</h2><p>Seven offerings. Specific problems, visible responses.</p></div>
      <ol>{OFFERING_CHAPTERS.map((item, i) => {
        const example = getOfferingUseCase(item, item.variants[0]);
        return <li key={item.id}>
          <span className="enterprise-capability-number">{String(i + 1).padStart(2, '0')}</span><div><span className="enterprise-case-offering">{item.title}</span><button type="button" onClick={() => { selectOffering(item.id); hostRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }); }}>{example.title}<ArrowRight size={14} aria-hidden="true" /></button><p>{example.setting} · {example.stakes}</p><ul>{item.scope.map(scope => <li key={scope}>{scope}</li>)}</ul></div>
        </li>;
      })}</ol>
    </section>
  </div>;
}

function EnterpriseFallback({ offering, onOfferingSelect, onReady }: { offering: OfferingId; onOfferingSelect: (id: OfferingId) => void; onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return <div className="enterprise-fallback"><Layers3 size={34} strokeWidth={1} aria-hidden="true" /><h3>The connected enterprise</h3><p>3D is unavailable. Explore the same offerings and their stories below.</p><div>{OFFERING_CHAPTERS.map((item, i) => <button type="button" key={item.id} aria-pressed={item.id === offering} onClick={() => onOfferingSelect(item.id)}><span>{String(i + 1).padStart(2, '0')}</span><item.icon size={19} aria-hidden="true" />{item.navTitle}</button>)}</div></div>;
}
