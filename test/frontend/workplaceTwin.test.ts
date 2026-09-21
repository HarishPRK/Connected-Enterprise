import assert from 'node:assert/strict';
import test from 'node:test';
import { drawStoreScenario } from '../../src/components/offerings/storeAnimations';
import { palette, withScenePresentation, type ScenarioId, type ScenePresentation } from '../../src/components/offerings/scenePrimitives';

const SCENARIOS: ScenarioId[] = ['safety', 'connectivity', 'energy', 'leak', 'matter', 'eagle', 'greengrass'];
const STORY_TIMES = [0, .8, 1.8, 2.7, 3.8, 4, 10, 12, 17, 17.75, 18.5, 20.3, 22.5, 24];
type Command = readonly [string, ...unknown[]];
type Gradient = { kind: string; coordinates: number[]; stops: [number, string][]; addColorStop(position: number, color: string): void };

/** Records the real scene's Canvas API calls, including drawing state and gradients. */
function recordingContext() {
  let commands: Command[] = [];
  let state: Record<string, unknown> = {
    globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
    shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0,
    lineCap: 'butt', lineJoin: 'miter', lineDash: [], filter: 'none',
  };
  const stack: Record<string, unknown>[] = [];
  const serialize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(serialize);
    if (value && typeof value === 'object' && 'stops' in value) {
      const gradient = value as Gradient;
      return { kind: gradient.kind, coordinates: [...gradient.coordinates], stops: gradient.stops.map(stop => [...stop]) };
    }
    return value;
  };
  const record = (name: string, ...args: unknown[]) => commands.push([name, ...args.map(serialize)]);
  const methods: Record<string, (...args: unknown[]) => unknown> = {};
  const regularMethods = new Set(['beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'ellipse', 'roundRect', 'rect', 'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'translate', 'rotate', 'scale', 'transform', 'setTransform', 'resetTransform', 'clip']);
  const api = {
    save() { record('save'); stack.push({ ...state }); },
    restore() { record('restore'); assert.ok(stack.length, 'scene restored an unsaved Canvas state'); state = stack.pop()!; },
    setLineDash(segments: number[]) { state.lineDash = [...segments]; record('setLineDash', segments); },
    getLineDash() { return [...state.lineDash as number[]]; },
    measureText(text: string) {
      record('measureText', text, state.font);
      // Font rasterization is browser QA's responsibility; this stable metric lets
      // the scene execute its real label-layout branch in a headless Node test.
      const fontSize = Number(String(state.font).match(/([\d.]+)px/)?.[1] ?? 10);
      return { width: text.length * fontSize * .56 } as TextMetrics;
    },
    createRadialGradient(...coordinates: number[]) {
      record('createRadialGradient', ...coordinates);
      const gradient: Gradient = {
        kind: 'radial', coordinates, stops: [],
        addColorStop(position, color) { this.stops.push([position, color]); record('addColorStop', position, color); },
      };
      return gradient as unknown as CanvasGradient;
    },
  };
  const ctx = new Proxy(api, {
    get(target, property) {
      const key = String(property);
      if (key in target) return target[key as keyof typeof target];
      if (key in state) return state[key];
      if (regularMethods.has(key)) return methods[key] ??= (...args: unknown[]) => record(key, ...args);
      throw new Error(`Canvas recorder does not support ${key}`);
    },
    set(_target, property, value) { state[String(property)] = value; record(`set:${String(property)}`, value); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    beginFrame() { assert.equal(stack.length, 0, 'previous scene leaked a saved Canvas state'); commands = []; },
    finishFrame() { assert.equal(stack.length, 0, 'scene did not balance save/restore'); return commands; },
  };
}

function presentation(id: ScenarioId): ScenePresentation {
  return { labels: false, routes: false, desk: id === 'eagle', gateway: id === 'greengrass' };
}

function frame(recorder: ReturnType<typeof recordingContext>, id: ScenarioId, time: number, dark = true, options: ScenePresentation | null = presentation(id)) {
  recorder.beginFrame();
  recorder.ctx.save();
  try {
    const draw = () => drawStoreScenario(recorder.ctx, palette(dark), id, time);
    if (options) withScenePresentation(recorder.ctx, options, draw);
    else draw();
  } finally { recorder.ctx.restore(); }
  return recorder.finishFrame();
}

function assertFinite(value: unknown, description: string) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${description} contains ${value}`);
  else if (Array.isArray(value)) value.forEach(item => assertFinite(item, description));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => assertFinite(item, description));
}

test('all seven real Canvas scenarios draw finite, balanced commands across both themes and backward chapter seeks', () => {
  const recorder = recordingContext();
  for (const dark of [false, true]) for (const id of SCENARIOS) for (const time of [...STORY_TIMES].reverse()) {
    const commands = frame(recorder, id, time, dark);
    commands.forEach(command => assertFinite(command, `${id} at ${time}s: ${command[0]}`));
    assert.ok(commands.filter(([name]) => name === 'fill' || name === 'stroke').length > 20, `${id} at ${time}s must draw physical devices/actors`);
    for (const [name, ...args] of commands) {
      if (name === 'ellipse') assert.ok(Number(args[2]) >= 0 && Number(args[3]) >= 0, `${id}: negative ellipse radius`);
      if (name === 'arc') assert.ok(Number(args[2]) >= 0, `${id}: negative arc radius`);
      if (name === 'set:globalAlpha') assert.ok(Number(args[0]) >= 0 && Number(args[0]) <= 1, `${id}: invalid opacity`);
    }
  }
});

test('direct and backward scrubbing reproduce the exact drawing commands after another scenario played', () => {
  const reused = recordingContext();
  for (let index = 0; index < SCENARIOS.length; index++) {
    const id = SCENARIOS[index];
    const prior = SCENARIOS[(index + 3) % SCENARIOS.length];
    for (const time of [24, 21, 17.5, 11, 3.8, 0]) {
      for (let previousTime = 0; previousTime <= 24; previousTime += 2) frame(reused, prior, previousTime);
      const actual = frame(reused, id, time);
      const expected = frame(recordingContext(), id, time);
      assert.deepEqual(actual, expected, `${id} at ${time}s must not inherit pose, opacity or scene presentation from ${prior}`);
    }
  }
});

test('elapsed-time animation produces the same frame through 60 Hz and 120 Hz sampling', () => {
  for (const id of ['safety', 'energy', 'matter'] as ScenarioId[]) {
    const at60 = recordingContext();
    const at120 = recordingContext();
    for (let index = 0; index <= 180; index++) frame(at60, id, index / 60);
    for (let index = 0; index <= 360; index++) frame(at120, id, index / 120);
    assert.deepEqual(frame(at60, id, 3), frame(at120, id, 3), `${id} must follow elapsed time rather than frame count`);
    assert.notDeepEqual(frame(at60, id, 2), frame(at60, id, 3), `${id} should still animate during the incident`);
  }
});

test('presentation scoping restores the previous drawing behavior after nested exceptions and isolates contexts', () => {
  const recorder = recordingContext();
  const other = recordingContext();
  const full = frame(other, 'safety', 14, true, null);
  const suppressed = frame(other, 'safety', 14, true, presentation('safety'));
  assert.notDeepEqual(suppressed, full, 'suppressing shared hardware/labels must actually affect drawing commands');

  assert.throws(() => withScenePresentation(recorder.ctx, presentation('safety'), () => { throw new Error('scene failed'); }), /scene failed/);
  assert.deepEqual(frame(recorder, 'safety', 14, true, null), full, 'a thrown scene must not suppress later standalone drawing');

  withScenePresentation(recorder.ctx, presentation('safety'), () => {
    assert.throws(() => withScenePresentation(recorder.ctx, { gateway: true, labels: true }, () => { throw new Error('nested failure'); }), /nested failure/);
    assert.deepEqual(frame(recorder, 'safety', 14, true, null), suppressed, 'nested cleanup must reinstate the outer presentation');
    assert.deepEqual(frame(other, 'safety', 14, true, null), full, 'another Canvas context must remain independent');
  });
  assert.deepEqual(frame(recorder, 'safety', 14, true, null), full, 'leaving the outer scope must restore the original behavior');
});
