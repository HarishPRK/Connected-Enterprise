import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeftRight, ArrowRight, Check, ChevronRight, Cloud, Cpu, GitBranch, Leaf, Lightbulb, Pause, Play, Radio, RotateCcw, ShieldCheck, Zap } from 'lucide-react';
import { SolutionScene } from './SolutionScene';
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
    id: 'safety' as const, label: 'Fall detection', icon: ShieldCheck, location: 'Workplace corridor',
    service: 'Video Analytics', support: 'Edge inference + operator alerts',
    href: '/video-analytics', cta: 'Explore Video Analytics',
    beats: [
      { title: 'One small slip. A big blind spot.', description: 'A discarded banana peel turns a routine walk into a slip. Arms flail, footing is lost, and there is no camera to see it happen.', status: 'No camera coverage', signal: 'A slip becomes a fall' },
      { title: 'An incident becomes a blind spot.', description: 'The person remains unattended. There is no video signal to raise an alert, so the team has no reason to respond.', status: 'Incident unobserved', signal: 'No signal reaches the team' },
      { title: 'Bring the scene into view.', description: 'Now add a camera and edge video analytics. A possible fall is flagged locally and an alert reaches the operator.', status: 'Possible fall flagged', signal: 'Camera → edge inference → alert' },
      { title: 'Give the team a way to act.', description: 'An operator checks the incident and requests assistance. A colleague arrives to help the person on the floor.', status: 'Assistance requested', signal: 'Alert → verification → assistance' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'connectivity' as const, label: 'Dynamic Failover', icon: GitBranch, location: 'Branch checkout',
    service: 'Dynamic Failover', support: 'Path health + policy-based routing',
    href: '/path-selection', cta: 'Explore Dynamic Failover',
    beats: [
      { title: 'A card tap goes nowhere.', description: 'A customer presents their card just as the branch’s primary connection drops. The terminal cannot reach the payment service.', status: 'Primary link interrupted', signal: 'Card tap → connection interrupted' },
      { title: 'Work waits for the network.', description: 'With no automatic route change, the terminal stays disconnected while the team troubleshoots the connection.', status: 'Checkout interrupted', signal: 'No active alternative path' },
      { title: 'Let the gateway find a path.', description: 'Dynamic Failover checks link health and selects an available cellular path according to the branch’s routing policy.', status: 'Selecting the cellular path', signal: 'Link health → routing policy → 5G' },
      { title: 'The receipt finally rolls out.', description: 'Traffic follows the alternate connection. The customer retries, the transaction completes, and checkout gets moving again.', status: 'Alternate connection active', signal: '5G path → checkout reconnected' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'energy' as const, label: 'Energy Prediction', icon: Zap, location: 'Building plant room',
    service: 'Energy Prediction', support: 'Edge Analytics + connected controls',
    href: '/cost-insights', cta: 'Explore Cost Savings',
    beats: [
      { title: 'The equipment keeps running.', description: 'A cooling unit begins drawing more energy than its normal operating pattern calls for. From outside, it still looks fine.', status: 'Abnormal energy use', signal: 'Equipment demand rises' },
      { title: 'Hidden waste adds up.', description: 'Without connected readings, the change goes unnoticed. The team has no clear signal that the unit needs attention.', status: 'Anomaly goes unnoticed', signal: 'Consumption without context' },
      { title: 'Turn readings into a signal.', description: 'Energy Prediction evaluates appliance readings at the edge and flags the unusual pattern for investigation.', status: 'Energy anomaly flagged', signal: 'Sensor → edge model → anomaly' },
      { title: 'Act before waste becomes routine.', description: 'The team reviews the alert and adjusts the unit’s operation. In this scenario, consumption returns to its usual pattern.', status: 'Operating pattern stabilized', signal: 'Review → adjustment → monitoring' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'leak' as const, label: 'Sustainability', icon: Leaf, location: 'Utility room',
    service: 'Sustainability', support: 'Leak detection + connected water controls',
    href: '#offering-sustainability', cta: 'See Sustainability capabilities',
    beats: [
      { title: 'A drip becomes a puddle.', description: 'A pipe starts leaking beside stored supplies. The water spreads across the floor while the room sits unattended.', status: 'Water escaping', signal: 'Small leak → spreading water' },
      { title: 'Waste does not wait to be noticed.', description: 'The puddle keeps growing. Without a connected leak sensor, no signal reaches the team and the supply stays open.', status: 'Leak unobserved', signal: 'Water loss continues' },
      { title: 'Let the floor raise the alarm.', description: 'A connected sensor detects water and sends a leak event through the gateway. The affected area is visible to the operator.', status: 'Leak detected', signal: 'Water sensor → gateway → alert' },
      { title: 'Contain the leak at its source.', description: 'In this scenario, a configured water control closes the valve. The flow stops; the team can inspect the pipe and clean up the remaining water.', status: 'Water supply isolated', signal: 'Leak event → valve closes → inspection' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'occupancy' as const, label: 'Matter', icon: Lightbulb, location: 'Meeting room',
    service: 'Matter', support: 'Occupancy signals + enterprise automation',
    href: '#offering-matter', cta: 'See Matter capabilities',
    beats: [
      { title: 'Everyone leaves. Everything stays on.', description: 'The last person walks out of the meeting room. The lights and climate system keep working for an audience of zero.', status: 'Empty room, active equipment', signal: 'People leave → devices keep running' },
      { title: 'Each device lives in its own world.', description: 'An empty room means nothing to a light or thermostat that cannot receive occupancy information. Manual checks become the fallback.', status: 'Occupancy is not shared', signal: 'Separate devices, disconnected context' },
      { title: 'Give devices a shared instruction.', description: 'Matter connects compatible occupancy sensors and controls. The room’s automation can use the same unoccupied state across devices.', status: 'Unoccupied state shared', signal: 'Occupancy → Matter → room controls' },
      { title: 'An empty room can take a break.', description: 'The configured room policy dims the lights, lowers the shades and sets back climate control. Devices respond together to the room’s state.', status: 'Room policy applied', signal: 'Shared state → coordinated control' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'protocols' as const, label: 'Interoperability', icon: ArrowLeftRight, location: 'Mixed equipment site',
    service: 'Interoperability', support: 'Modbus + BACnet + OPC UA protocol conversion',
    href: '#offering-interoperability', cta: 'See Interoperability capabilities',
    beats: [
      { title: 'Three devices. Three languages.', description: 'A meter, building controller and industrial device send readings in different protocols. Their messages arrive in incompatible forms.', status: 'Different device protocols', signal: 'Modbus + BACnet + OPC UA' },
      { title: 'The data reaches a dead end.', description: 'Each device works, but the systems above cannot consume the readings together. Operators are left piecing together separate views.', status: 'Readings cannot be combined', signal: 'Individual signals → separate systems' },
      { title: 'Translate where the devices connect.', description: 'The gateway’s Interoperability service converts the supported device protocols into a common interface for applications.', status: 'Protocol conversion active', signal: 'Device protocols → gateway conversion' },
      { title: 'Bring the readings together.', description: 'Applications can consume the converted readings through the gateway. The team gets a connected view without replacing every device.', status: 'Readings available together', signal: 'Converted data → consumer-facing APIs' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'eagle' as const, label: 'EA:GLE', icon: Activity, location: 'Branch equipment room',
    service: 'EA:GLE — Edge Analytics', support: 'Local processing + anomaly detection',
    href: '/hardware-anomalies', cta: 'Explore EA:GLE',
    beats: [
      { title: 'The gateway starts to struggle.', description: 'Work builds up on branch equipment. Resource usage rises and requests queue, while the outside of the device looks unchanged.', status: 'Resource pressure rising', signal: 'Growing load → delayed work' },
      { title: 'A warning hides in the readings.', description: 'Raw device measurements keep arriving, but a disconnected view gives the team no clear explanation of what is changing.', status: 'Measurements without context', signal: 'More readings, no clear diagnosis' },
      { title: 'Read the pattern at the edge.', description: 'EA:GLE processes local measurements and surfaces unusual behavior. The gateway’s changing resource pattern becomes an actionable signal.', status: 'Anomaly identified', signal: 'Local telemetry → edge analytics' },
      { title: 'Know where to investigate.', description: 'The affected equipment and the unusual trend are highlighted for the operator. The team can investigate with context instead of guessing.', status: 'Equipment flagged for review', signal: 'Anomaly → equipment context → review' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'greengrass' as const, label: 'AWS Greengrass', icon: Cloud, location: 'Remote equipment site',
    service: 'AWS Greengrass', support: 'Local processing + cloud device management',
    href: '#offering-greengrass', cta: 'See AWS Greengrass capabilities',
    beats: [
      { title: 'The cloud connection drops.', description: 'A remote site loses its uplink while sensors are still producing readings. The equipment has work to do even when the cloud is out of reach.', status: 'Cloud link unavailable', signal: 'Site running → cloud disconnected' },
      { title: 'Cloud-only work has nowhere to go.', description: 'Readings pile up while the uplink is down. A site that depends on a cloud round trip cannot process its data where it is produced.', status: 'Readings waiting upstream', signal: 'Sensor samples → blocked uplink' },
      { title: 'Keep processing beside the equipment.', description: 'In this example, AWS Greengrass components process readings on the gateway and buffer results locally while the uplink is unavailable.', status: 'Local processing active', signal: 'Sensor → local component → stored result' },
      { title: 'Reconnect and bring the cloud up to date.', description: 'The uplink returns. The example’s configured synchronization sends buffered results upstream while local processing continues.', status: 'Buffered results synchronizing', signal: 'Local results → restored cloud link' },
    ] satisfies StoryBeat[],
  },
  {
    id: 'thread' as const, label: 'Thread Border Router', icon: Radio, location: 'Connected building',
    service: 'Thread Border Router', support: 'Low-power Thread mesh + enterprise IP network',
    href: '#offering-thread-border-router', cta: 'See Thread Border Router capabilities',
    beats: [
      { title: 'A sensor has news. Who can hear it?', description: 'A door sensor changes state inside the building. Low-power devices need a path from their local mesh to the enterprise network.', status: 'Sensor event waiting', signal: 'Door event → local radio network' },
      { title: 'The room stops at the network boundary.', description: 'Devices can speak within the Thread mesh, but without a border router their messages cannot reach the applications on the adjacent IP network.', status: 'No route to the enterprise network', signal: 'Local mesh → missing network bridge' },
      { title: 'Connect the mesh to the rest of the site.', description: 'The Thread Border Router provides the IP connection between the mesh and the enterprise network. Messages can travel through the connected devices to that bridge.', status: 'Mesh route established', signal: 'Thread hops → border router → IP' },
      { title: 'Small devices become visible.', description: 'The door event and other device readings reach the application. Thread provides the transport for compatible services, including Matter, to use.', status: 'Device readings reach the application', signal: 'Mesh telemetry → connected applications' },
    ] satisfies StoryBeat[],
  },
];

function chapterAt(time: number) {
  return time >= 17 ? 3 : time >= 10 ? 2 : time >= 4 ? 1 : 0;
}

/** One shared clock drives the scene and progress, without rendering React each frame. */
export function SolutionShowcase() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [chapter, setChapter] = useState(0);
  const [playing, setPlaying] = useState(true);
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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const scenario = SCENARIOS[scenarioIndex];
  const beat = scenario.beats[chapter];
  const running = playing && inView && pageVisible && !reducedMotion && !finished;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReducedMotion(query.matches);
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
        setFinished(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

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
    if (index === scenarioIndex) return;
    setScenarioIndex(index);
    // A manual pause remains a pause when switching to a different use case.
    seek(reducedMotion ? 3.9 : 0);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % SCENARIOS.length;
    else if (event.key === 'ArrowLeft') next = (index + SCENARIOS.length - 1) % SCENARIOS.length;
    else if (event.key === 'ArrowDown') next = (index + 3) % SCENARIOS.length;
    else if (event.key === 'ArrowUp') next = (index + SCENARIOS.length - 3) % SCENARIOS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = SCENARIOS.length - 1;
    else return;
    event.preventDefault();
    selectScenario(next);
    tabRefs.current[next]?.focus();
  };

  const replay = () => {
    seek(reducedMotion ? 3.9 : 0);
    setPlaying(true);
  };

  const selectChapter = (index: number) => {
    // Land on a settled frame for manual chapter selection, including reduced motion.
    seek(index === 0 ? 3.9 : CHAPTER_TIMES[index] + (index === 2 ? 4 : index === 3 ? 4 : 2));
    setPlaying(false);
  };

  return (
    <section className="solution-showcase" aria-labelledby="showcase-title">
      <div className="showcase-heading">
        <div>
          <h2 id="showcase-title">Real challenges. See the edge respond.</h2>
          <p>Explore what changes when your site’s devices and services work together.</p>
        </div>
        <span className="showcase-disclosure">{SCENARIOS.length} illustrative scenarios</span>
      </div>

      <div className="showcase-frame">
        <div className="showcase-tabs" role="tablist" aria-label="Solution use cases">
          {SCENARIOS.map((item, index) => {
            const Icon = item.icon;
            return (
              <button key={item.id} id={`showcase-tab-${item.id}`} type="button" role="tab"
                aria-selected={index === scenarioIndex} aria-controls="showcase-panel"
                tabIndex={index === scenarioIndex ? 0 : -1}
                ref={(element) => { tabRefs.current[index] = element; }}
                onKeyDown={(event) => onTabKeyDown(event, index)} onClick={() => selectScenario(index)}>
                <Icon size={17} aria-hidden="true" /><span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div id="showcase-panel" className="showcase-panel" role="tabpanel"
          aria-labelledby={`showcase-tab-${scenario.id}`} tabIndex={0} data-chapter={chapter}>
          <div className="showcase-visual" ref={visualRef}>
            <div className="showcase-scene-heading">
              <span>{scenario.location}</span>
              <span className="showcase-scene-mode">{chapter < 2 ? 'Without connected services' : 'With connected services'}</span>
            </div>
            <div className="showcase-canvas-wrap">
              <SolutionScene scenario={scenario.id} timeRef={timeRef} playing={running}
                reducedMotion={reducedMotion} revision={revision} />
            </div>
            <div className="showcase-scene-caption" aria-hidden="true">
              <span className="showcase-status"><span />{beat.status}</span>
              <span className="showcase-scene-format">Digital twin illustration</span>
            </div>
          </div>

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
              <p>{scenario.support}</p>
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
                onChange={(event) => { seek(Number(event.target.value)); setPlaying(false); }} />
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
      <p className="showcase-footnote">{reducedMotion ? 'Reduced motion is on. Choose a chapter to explore each scene. ' : 'Select a chapter to inspect a moment. '}
        Concept demonstration; events and outcomes are illustrative, not live telemetry.</p>
    </section>
  );
}
