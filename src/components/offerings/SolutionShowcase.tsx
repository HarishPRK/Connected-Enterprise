import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, Cpu, Pause, Play, RotateCcw } from 'lucide-react';
import { SolutionScene } from './SolutionScene';
import { TWIN_SCENARIOS, WATER_SENSORS } from './twinScenarioInfo';
import type { SustainabilityMode } from './storeAnimations';
import type { ScenarioId } from './scenePrimitives';
import './solution-showcase.css';

const CHAPTERS = ['The incident', 'The blind spot', 'Edge response', 'The outcome'] as const;
const CHAPTER_TIMES = [0, 4, 10, 17];
const DURATION = 24;

interface StoryBeat {
  title: string;
  description: string;
  status: string;
  signal: string;
}

const SCENARIOS = [
  {
    id: 'safety' as const, label: 'Fall detection', location: 'Customer aisle',
    service: 'Video Analytics', support: 'Edge inference + operator alerts',
    href: '/video-analytics', cta: 'Explore Video Analytics',
    beats: [
      { title: 'A routine walk becomes a fall.', description: 'A customer slips on the sales floor. Shopping continues around the store, but the incident needs attention.', status: 'Possible fall on the sales floor', signal: 'Sales floor → customer needs assistance' },
      { title: 'The store team has no signal.', description: 'Without connected video analytics, the fall does not raise an alert. The customer remains unattended while staff work elsewhere in the store.', status: 'Incident unobserved', signal: 'Sales-floor incident → no operator alert' },
      { title: 'Bring the incident into view.', description: 'The store camera sends video to the shared gateway. Local analytics flags a possible fall for the operator to review.', status: 'Possible fall flagged', signal: 'Camera → store gateway → alert' },
      { title: 'Connect detection to assistance.', description: 'The operator verifies the incident and requests assistance. A member of staff arrives to help the customer on the sales floor.', status: 'Assistance requested', signal: 'Alert → verification → staff assistance' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'connectivity' as const, label: 'Dynamic Failover', location: 'Checkout',
    service: 'Dynamic Failover', support: 'Path health + policy-based routing',
    href: '/path-selection', cta: 'Explore Dynamic Failover',
    beats: [
      { title: 'A card tap goes nowhere.', description: 'A customer presents their card just as the store’s primary connection drops. The checkout terminal cannot reach the payment service.', status: 'Primary link interrupted', signal: 'Card tap → connection interrupted' },
      { title: 'The queue waits for the network.', description: 'The payment stays on hold while the team investigates. The same gateway connects checkout, store devices and building operations.', status: 'Checkout interrupted', signal: 'Payment request → unavailable uplink' },
      { title: 'Give checkout another path.', description: 'Dynamic Failover checks link health at the shared gateway and selects the available cellular connection according to routing policy.', status: 'Selecting the cellular path', signal: 'Shared gateway → routing policy → 5G' },
      { title: 'The receipt finally rolls out.', description: 'The customer retries over the alternate connection. The payment completes, the receipt prints, and checkout gets moving again.', status: 'Alternate connection active', signal: '5G path → payment completed' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'energy' as const, label: 'Energy Prediction', location: 'Climate & energy',
    service: 'Energy Prediction', support: 'Edge Analytics + connected controls',
    href: '/cost-insights', cta: 'Explore Cost Savings',
    beats: [
      { title: 'The equipment keeps running.', description: 'The store’s cooling unit begins drawing more energy than its normal operating pattern calls for. From the sales floor, everything still looks fine.', status: 'Abnormal energy use', signal: 'Store cooling → demand rises' },
      { title: 'Hidden waste adds up.', description: 'Without connected readings, the change goes unnoticed. The team has no clear signal that the unit needs attention.', status: 'Anomaly goes unnoticed', signal: 'Consumption without context' },
      { title: 'Turn readings into a signal.', description: 'Plant-room readings reach the shared store gateway. Energy Prediction evaluates the pattern locally and flags unusual demand for investigation.', status: 'Energy anomaly flagged', signal: 'Energy meter → shared gateway → anomaly' },
      { title: 'Act before waste becomes routine.', description: 'The team reviews the alert and adjusts the unit’s operation. In this scenario, consumption returns to its usual pattern.', status: 'Operating pattern stabilized', signal: 'Review → adjustment → monitoring' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'leak' as const, label: 'Sustainability', location: 'Utilities',
    service: 'Sustainability', support: 'Leak detection + connected water controls',
    href: '#offering-sustainability', cta: 'See Sustainability capabilities',
    beats: [
      { title: 'A drip becomes a store problem.', description: 'A pipe leaks beside stored supplies in the utility area. Water spreads across the floor while staff serve customers nearby.', status: 'Water escaping', signal: 'Utility pipe → spreading water' },
      { title: 'Waste does not wait to be noticed.', description: 'The puddle keeps growing. Without a connected leak sensor, no signal reaches the team and the supply stays open.', status: 'Leak unobserved', signal: 'Water loss continues' },
      { title: 'Let the floor raise the alarm.', description: 'A connected water sensor sends a leak event to the shared store gateway. The team sees exactly which utility area needs attention.', status: 'Leak detected', signal: 'Water sensor → shared gateway → alert' },
      { title: 'Contain the leak at its source.', description: 'In this scenario, a configured water control closes the valve. The flow stops; the team can inspect the pipe and clean up the remaining water.', status: 'Water supply isolated', signal: 'Leak event → valve closes → inspection' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'matter' as const, label: 'Matter & Interoperability', location: 'Smart retail zone',
    service: 'Matter & Interoperability', support: 'Different manufacturers · one Matter fabric · Wi-Fi + Thread',
    href: '#offering-matter', cta: 'See Matter & Interoperability',
    beats: [
      { title: 'One space. Different manufacturers.', description: 'An occupancy sensor, lights, thermostat and shades from four different OEMs share the smart retail zone. The last person leaves, but the devices act independently.', status: 'Multi-OEM devices disconnected', signal: 'OEM A sensor · OEM B lights · OEM C climate · OEM D shades' },
      { title: 'The devices share a space, not context.', description: 'Separate controls cannot coordinate a response when the retail zone is empty. Simply connecting devices to the store network does not establish a shared automation.', status: 'Occupancy stays in separate systems', signal: 'Zone empty → lights and cooling stay on' },
      { title: 'Connect through a common language.', description: 'Compatible devices are discovered with mDNS/DNS-SD and commissioned into one Matter fabric. Matter provides a shared application language over IP using Wi-Fi or Thread.', status: 'Multi-OEM Matter fabric connected', signal: 'Discovery → commissioning → shared Matter fabric' },
      { title: 'Different brands. One coordinated response.', description: 'The gateway’s configured policy uses the occupancy sensor’s state to dim the lights, set back the thermostat and lower the shades. Compatible devices from different OEMs respond together.', status: 'Store policy applied across OEMs', signal: 'Shared occupancy → coordinated lights, climate and shades' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'eagle' as const, label: 'EA:GLE', location: 'IT & edge',
    service: 'EA:GLE — Edge Analytics', support: 'Local processing + anomaly detection',
    href: '/hardware-anomalies', cta: 'Explore EA:GLE',
    beats: [
      { title: 'The shared gateway starts to struggle.', description: 'Work builds up on the gateway serving the entire store. Resource usage rises and requests queue, while the outside of the device looks unchanged.', status: 'Resource pressure rising', signal: 'Store gateway → delayed work' },
      { title: 'A warning hides in the readings.', description: 'Raw device measurements keep arriving, but a disconnected view gives the team no clear explanation of what is changing.', status: 'Measurements without context', signal: 'More readings, no clear diagnosis' },
      { title: 'Read the pattern at the edge.', description: 'EA:GLE processes local measurements and surfaces unusual behavior. The gateway’s changing resource pattern becomes an actionable signal.', status: 'Anomaly identified', signal: 'Local telemetry → edge analytics' },
      { title: 'Know where to investigate.', description: 'The affected equipment and the unusual trend are highlighted for the operator. The team can investigate with context instead of guessing.', status: 'Equipment flagged for review', signal: 'Anomaly → equipment context → review' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'greengrass' as const, label: 'AWS Greengrass', location: 'Stockroom',
    service: 'AWS Greengrass', support: 'Local processing + cloud device management',
    href: '#offering-greengrass', cta: 'See AWS Greengrass capabilities',
    beats: [
      { title: 'The cloud connection drops.', description: 'The store loses access to its cloud endpoint while stockroom and sales-floor sensors keep producing readings. Local work still needs to continue.', status: 'Cloud link unavailable', signal: 'Store sensors → cloud unavailable' },
      { title: 'Cloud-only work has nowhere to go.', description: 'Readings from across the store accumulate while the endpoint is unreachable. Cloud-dependent processing cannot respond to changing conditions.', status: 'Readings waiting upstream', signal: 'Store readings → blocked cloud connection' },
      { title: 'Keep processing under the same roof.', description: 'Configured AWS Greengrass components process store readings on the shared gateway and buffer results locally while the cloud endpoint is unavailable.', status: 'Local processing active', signal: 'Store devices → local component → stored results' },
      { title: 'Bring the cloud back into the picture.', description: 'Connectivity returns. Configured synchronization sends the buffered store results upstream while the same gateway continues processing local events.', status: 'Buffered results synchronizing', signal: 'Shared gateway → restored cloud connection' },
    ] satisfies StoryBeat[],
  },
];

const OCCUPANCY_BEATS: StoryBeat[] = [
  { title: 'The last person leaves. The load stays.', description: 'The room is empty, but its lights, plug loads and cooling keep drawing power. Presence, daylight and power readings reveal avoidable consumption.', status: 'Energy use continues', signal: 'Vacant room → lights and cooling still on' },
  { title: 'An empty room should not run at full load.', description: 'Independent devices do not share occupancy or daylight context. The power monitor sees consumption without a reason to reduce it.', status: 'Idle consumption persists', signal: 'No occupants + daylight → avoidable demand' },
  { title: 'Let the sensors inform the response.', description: 'The gateway combines presence, daylight and power signals. A configured vacancy policy requests lower lighting and a temperature setback.', status: 'Vacancy policy triggered', signal: 'Presence + daylight + power → local policy' },
  { title: 'Use energy where people need it.', description: 'Lights dim, the thermostat enters eco mode and shades adjust. In this demonstration, the room reduces idle demand while the sensors continue monitoring.', status: 'Idle demand reduced', signal: 'Lighting reduced → climate setback → monitoring' },
];

function chapterAt(time: number) {
  return time >= 17 ? 3 : time >= 10 ? 2 : time >= 4 ? 1 : 0;
}

/** One shared clock drives the scene and progress, without rendering React each frame. */
export function SolutionShowcase() {
  const [sustainability, setSustainability] = useState<SustainabilityMode>('occupancy');
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [chapter, setChapter] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [touring, setTouring] = useState(false);
  const [finished, setFinished] = useState(false);
  const [revision, setRevision] = useState(0);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [initialTime] = useState(reducedMotion ? 3.9 : 0);
  const visualRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(initialTime);
  const chapterRef = useRef(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const scenario = SCENARIOS[scenarioIndex];
  const occupancy = scenario.id === 'leak' && sustainability === 'occupancy';
  const beat = occupancy ? OCCUPANCY_BEATS[chapter] : scenario.beats[chapter];
  const scenarioInfo = TWIN_SCENARIOS[scenario.id];
  const sensors = scenario.id === 'leak' && sustainability === 'water' ? WATER_SENSORS : scenarioInfo.sensors;
  const running = playing && inView && pageVisible && !reducedMotion && !finished;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => {
      setReducedMotion(query.matches);
      if (query.matches) {
        setTouring(false);
        setPlaying(false);
      }
    };
    const onVisibility = () => setPageVisible(!document.hidden);
    query.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    if (visualRef.current) observer.observe(visualRef.current);
    return () => {
      query.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    let frame: number;
    let previous: number | undefined;
    const tick = (now: number) => {
      // Resume from the same frame after tab/viewport suspension; never fast-forward.
      const delta = previous === undefined ? 0 : Math.min((now - previous) / 1000, 0.1);
      previous = now;
      const time = Math.min(DURATION, timeRef.current + delta);
      timeRef.current = time;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${time / DURATION})`;
      if (rangeRef.current) rangeRef.current.value = String(time);
      const nextChapter = chapterAt(time);
      if (nextChapter !== chapterRef.current) {
        chapterRef.current = nextChapter;
        setChapter(nextChapter);
      }
      if (time >= DURATION) {
        if (touring && scenarioIndex < SCENARIOS.length - 1) {
          // Reset the shared clock before switching scenarios. The changed index
          // starts a fresh RAF effect, so this completed callback cannot advance twice.
          timeRef.current = 0;
          chapterRef.current = 0;
          if (progressRef.current) progressRef.current.style.transform = 'scaleX(0)';
          if (rangeRef.current) rangeRef.current.value = '0';
          setChapter(0);
          setScenarioIndex(scenarioIndex + 1);
          setRevision((value) => value + 1);
        } else {
          setFinished(true);
          setPlaying(false);
          setTouring(false);
        }
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, scenarioIndex, touring]);

  const seek = (time: number) => {
    timeRef.current = time;
    chapterRef.current = chapterAt(time);
    setChapter(chapterRef.current);
    setFinished(time >= DURATION);
    setRevision((value) => value + 1);
    if (progressRef.current) progressRef.current.style.transform = `scaleX(${time / DURATION})`;
    if (rangeRef.current) rangeRef.current.value = String(time);
  };

  const selectScenario = (index: number) => {
    setTouring(false);
    setScenarioIndex(index);
    seek(reducedMotion ? 3.9 : 0);
    setFinished(false);
    setPlaying(!reducedMotion);
  };

  const selectSceneScenario = (id: ScenarioId) => {
    const index = SCENARIOS.findIndex((item) => item.id === id);
    if (index >= 0) selectScenario(index);
  };

  const replay = () => {
    seek(reducedMotion ? 3.9 : 0);
    setPlaying(true);
  };

  const toggleTour = () => {
    if (touring) {
      setTouring(false);
      setPlaying(false);
      return;
    }
    setScenarioIndex(0);
    seek(0);
    setTouring(true);
    setPlaying(true);
  };

  const selectChapter = (index: number) => {
    // Land on a settled frame for manual chapter selection, including reduced motion.
    seek(index === 0 ? 3.9 : index === 3 ? 23 : CHAPTER_TIMES[index] + (index === 2 ? 4 : 2));
    setTouring(false);
    setPlaying(false);
  };

  return (
    <section className="solution-showcase" data-color={scenarioInfo.color} aria-labelledby="showcase-title">
      <div className="showcase-heading">
        <div>
          <h2 id="showcase-title">Inside the store</h2>
          <p>Explore a scenario, rotate the twin and follow the response.</p>
        </div>
        <div className="showcase-heading-actions">
          <span className="showcase-disclosure" aria-live="polite">
            {touring ? `Tour ${scenarioIndex + 1} / ${SCENARIOS.length}` : `${SCENARIOS.length} scenarios`}
          </span>
          {!reducedMotion && (
            <button type="button" className="showcase-tour" onClick={toggleTour} aria-pressed={touring}>
              {touring ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              {touring ? 'End tour' : 'Play store tour'}
            </button>
          )}
        </div>
      </div>

      <div className="showcase-frame">
        <div id="showcase-panel" className="showcase-panel" role="region"
          aria-label="Interactive enterprise store" data-chapter={chapter}>
          <nav className="showcase-scenarios" aria-label="Store scenarios">
            <h3>Explore scenarios</h3>
            {SCENARIOS.map((item, index) => {
              const info = TWIN_SCENARIOS[item.id];
              const Icon = info.icon;
              return <button type="button" key={item.id} data-color={info.color} aria-pressed={index === scenarioIndex}
                onClick={() => selectScenario(index)}>
                <Icon size={19} aria-hidden="true" /><span>{item.label}</span><ChevronRight size={14} aria-hidden="true" />
              </button>;
            })}
            <p>Select a scenario to explore its sensors and edge response.</p>
          </nav>
          <div className="showcase-visual" ref={visualRef}>
            <div className="showcase-scene-heading">
              <span><strong>{scenario.label}</strong></span>
              <span className="showcase-scene-mode">{chapter < 2 ? 'Before response' : 'Connected response'}</span>
            </div>
            <div className="showcase-canvas-wrap">
              <SolutionScene scenario={scenario.id} timeRef={timeRef} playing={running}
                reducedMotion={reducedMotion} revision={revision} sustainability={sustainability} onScenarioSelect={selectSceneScenario} />
            </div>
            <div className="showcase-scene-caption" aria-hidden="true">
              <span className="showcase-status"><span />{beat.status}</span>
              <span className="showcase-scene-format">Illustrative scenario</span>
            </div>
          </div>

          <aside className="showcase-sensors" aria-label="Scenario sensors">
            <h3>Sensor activity</h3>
            <p className="showcase-sensor-context">{occupancy ? 'Occupancy & energy waste' : scenario.location}</p>
            {scenario.id === 'leak' && <div className="showcase-sustainability-modes" aria-label="Sustainability scenario">
              <button type="button" aria-pressed={sustainability === 'occupancy'} onClick={() => { setSustainability('occupancy'); selectScenario(scenarioIndex); }}>Energy waste</button>
              <button type="button" aria-pressed={sustainability === 'water'} onClick={() => { setSustainability('water'); selectScenario(scenarioIndex); }}>Water protection</button>
            </div>}
            <ul>{sensors.map(sensor => <li key={sensor.name}>
              <span className="showcase-sensor-dot" aria-hidden="true" />
              <div><strong>{sensor.name}</strong><span>{sensor.detail}</span><em>{sensor.states[chapter]}</em></div>
            </li>)}</ul>
            <div className="showcase-edge-path"><Cpu size={19} aria-hidden="true" /><div><strong>Shared edge gateway</strong><span>{chapter < 2 ? 'Waiting for a connected response' : 'Local context. Coordinated action.'}</span></div></div>
          </aside>
          <div className="showcase-story">
            <div className="showcase-narrative" aria-live="polite" aria-atomic="true">
              <div className="showcase-chapter-label"><span>{chapter + 1}</span>{CHAPTERS[chapter]}</div>
              <h3>{beat.title}</h3>
              <p>{beat.description}</p>
              <div className="showcase-signal"><span aria-hidden="true" />{beat.signal}</div>
            </div>
            <div className="showcase-service">
              <div className="showcase-service-heading"><Cpu size={17} aria-hidden="true" /><span>The service behind the response</span></div>
              <strong>{scenario.service}</strong>
              <p>{occupancy ? 'Presence, daylight and power monitoring' : scenario.support}</p>
              {scenario.href.startsWith('#') ? (
                <a href={scenario.href}>{scenario.cta}<ArrowRight size={16} aria-hidden="true" /></a>
              ) : (
                <Link to={scenario.href}>{scenario.cta}<ArrowRight size={16} aria-hidden="true" /></Link>
              )}
            </div>
          </div>
          <div className="showcase-transport">
            <div className="showcase-playback">
              {reducedMotion ? (
                <button type="button" className="showcase-play" onClick={() => selectChapter((chapter + 1) % CHAPTERS.length)}>
                  <ChevronRight size={17} aria-hidden="true" />Next chapter
                </button>
              ) : (
                <button type="button" className="showcase-play" onClick={() => finished ? replay() : setPlaying(!playing)}
                  aria-label={finished ? 'Replay scenario' : playing ? 'Pause scenario' : 'Play scenario'}>
                  {finished ? <RotateCcw size={16} aria-hidden="true" /> : playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                  {finished ? 'Replay' : playing ? 'Pause' : 'Play'}
                </button>
              )}
              <button type="button" className="showcase-restart" onClick={replay} aria-label="Restart scenario" title="Restart scenario">
                <RotateCcw size={16} aria-hidden="true" />
              </button>
              <span className="showcase-chapter-count">{chapter + 1} / {CHAPTERS.length}</span>
            </div>
            <div className="showcase-timeline">
              <div className="showcase-progress-track"><div ref={progressRef} style={{ transform: `scaleX(${initialTime / DURATION})` }} /></div>
              <input ref={rangeRef} type="range" min="0" max={DURATION} step="0.1" defaultValue={initialTime}
                aria-label="Scenario progress" aria-valuetext={`Chapter ${chapter + 1}: ${CHAPTERS[chapter]}`}
                onChange={(event) => { seek(Number(event.target.value)); setTouring(false); setPlaying(false); }} />
              <div className="showcase-chapters" aria-label="Story chapters">
                {CHAPTERS.map((label, index) => (
                  <button key={label} type="button" aria-current={index === chapter ? 'step' : undefined}
                    onClick={() => selectChapter(index)}>
                    <span className="showcase-step-number">{index < chapter ? <Check size={12} aria-hidden="true" /> : index + 1}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="showcase-footnote">{reducedMotion ? 'Reduced motion is on. Select a store area to explore its response. ' : 'Drag to rotate. Select a scenario to follow its response. '}
        Concept demonstration; events and outcomes are illustrative, not live telemetry.</p>
    </section>
  );
}
