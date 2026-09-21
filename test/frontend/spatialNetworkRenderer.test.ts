import assert from 'node:assert/strict';
import test from 'node:test';
import type { Device, Status } from '../../src/types';
import { buildSpatialNodes } from '../../src/components/widgets/spatialNetworkModel';
import { createSpatialRenderer } from '../../src/components/widgets/spatialNetworkRenderer';

type Command = [string, ...unknown[]];
type Gradient = { coordinates: number[]; stops: [number, string][]; addColorStop(position: number, color: string): void };
type Options = Parameters<ReturnType<typeof createSpatialRenderer>['render']>[1];

function finite(value: unknown): void {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `Canvas received ${value}`);
  else if (Array.isArray(value)) value.forEach(finite);
  else if (value && typeof value === 'object') Object.values(value).forEach(finite);
}

class RecordedPath {
  commands: Command[] = [];
  moveTo(...values: number[]) { finite(values); this.commands.push(['moveTo', ...values]); }
  bezierCurveTo(...values: number[]) { finite(values); this.commands.push(['bezierCurveTo', ...values]); }
}

function serialize(value: unknown): unknown {
  if (value instanceof RecordedCanvas) return { image: value.commands.map(serialize) };
  if (value instanceof RecordedPath) return { path: value.commands.map(serialize) };
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object' && 'stops' in value) {
    const gradient = value as Gradient;
    return { coordinates: [...gradient.coordinates], stops: gradient.stops.map(stop => [...stop]) };
  }
  return value;
}

/** Records the real renderer and nested cached images without mocking its geometry. */
class RecordedCanvas {
  commands: Command[] = [];
  operations = 0;
  stack: Record<string, unknown>[] = [];
  private state: Record<string, unknown> = {};
  private canvasWidth = 300;
  private canvasHeight = 150;
  readonly context: CanvasRenderingContext2D;

  constructor() {
    this.reset();
    const methods: Record<string, (...args: unknown[]) => unknown> = {};
    const regular = new Set(['beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'ellipse', 'rect', 'fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'translate', 'rotate', 'scale', 'transform', 'setTransform']);
    const api = {
      save: () => { this.record('save'); this.stack.push({ ...this.state }); },
      restore: () => { assert.ok(this.stack.length, 'restore requires a saved state'); this.state = this.stack.pop()!; this.record('restore'); },
      clearRect: (...values: number[]) => { this.commands = []; this.record('clearRect', ...values); },
      drawImage: (...args: unknown[]) => this.record('drawImage', ...args),
      setLineDash: (values: number[]) => { this.state.lineDash = [...values]; this.record('setLineDash', values); },
      createLinearGradient: (...coordinates: number[]) => {
        finite(coordinates);
        const gradient: Gradient = { coordinates, stops: [], addColorStop(position, color) { assert.ok(position >= 0 && position <= 1); this.stops.push([position, color]); } };
        return gradient as unknown as CanvasGradient;
      },
    };
    this.context = new Proxy(api, {
      get: (target, property) => {
        const key = String(property);
        if (key in target) return target[key as keyof typeof api];
        if (key in this.state) return this.state[key];
        if (regular.has(key)) return methods[key] ??= (...args: unknown[]) => {
          if (key === 'arc') assert.ok(Number(args[2]) >= 0, 'arc radius must be nonnegative');
          if (key === 'ellipse') assert.ok(Number(args[2]) >= 0 && Number(args[3]) >= 0, 'ellipse radii must be nonnegative');
          this.record(key, ...args);
        };
        throw new Error(`Unsupported Canvas operation: ${key}`);
      },
      set: (_target, property, value) => {
        if (property === 'globalAlpha') assert.ok(Number(value) >= 0 && Number(value) <= 1, 'opacity must stay in [0, 1]');
        this.state[String(property)] = value;
        this.record(`set:${String(property)}`, value);
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  }
  private reset() {
    this.commands = []; this.stack = [];
    this.state = { globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', lineCap: 'butt', lineJoin: 'miter', shadowBlur: 0, shadowColor: 'transparent', shadowOffsetY: 0, lineDash: [] };
  }
  private record(name: string, ...args: unknown[]) {
    const values = args.map(serialize);
    finite(values);
    this.commands.push([name, ...values]);
    this.operations++;
  }
  get width() { return this.canvasWidth; }
  set width(value: number) { finite(value); this.canvasWidth = value; this.reset(); }
  get height() { return this.canvasHeight; }
  set height(value: number) { finite(value); this.canvasHeight = value; this.reset(); }
  getContext() { return this.context; }
}

const kinds: Device['kind'][] = ['laptop', 'desktop', 'printer', 'payment', 'server', 'confphone', 'fire_sensor', 'smoke_sensor', 'door_lock', 'phone', 'tablet', 'matter', 'shelly', 'generic'];
const statuses: Status[] = ['ok', 'warn', 'err', 'off'];
function inventory(): Device[] {
  return kinds.flatMap((kind, index) => statuses.map((status, stateIndex) => ({
    id: `${kind}-${status}`, name: `${kind} ${status}`, kind, status,
    domain: (index + stateIndex) % 2 ? 'IT' : 'OT', conn: 'wifi', ip: `192.168.1.${index + 1}`, mac: `02:00:00:00:00:${index}`, connectedForHours: 1,
    telemetry: { rxMbps: 1.2, txMbps: .3 },
  })));
}

function withRenderer(callback: (scene: {
  renderer: ReturnType<typeof createSpatialRenderer>;
  canvas: RecordedCanvas;
  canvases: RecordedCanvas[];
  frame: (nodes: ReturnType<typeof buildSpatialNodes>, options?: Partial<Options>) => Command[];
  resize: (dark: boolean) => void;
}) => void) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const canvases: RecordedCanvas[] = [];
  const dataset = { theme: 'dark' };
  const install = (key: string, value: unknown) => { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  install('document', { documentElement: { dataset }, createElement: (tag: string) => { assert.equal(tag, 'canvas'); const canvas = new RecordedCanvas(); canvases.push(canvas); return canvas; } });
  install('window', { devicePixelRatio: 2 });
  install('Path2D', RecordedPath);
  install('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  const canvas = new RecordedCanvas(); canvases.push(canvas);
  const renderer = createSpatialRenderer(canvas as unknown as HTMLCanvasElement);
  const resize = (dark: boolean) => { dataset.theme = dark ? 'dark' : 'light'; renderer.resize(900, 500, 2, dark); };
  const frame = (nodes: ReturnType<typeof buildSpatialNodes>, options: Partial<Options> = {}) => {
    renderer.render(nodes, { time: 2, online: true, hoveredId: null, ...options });
    for (const recorded of canvases) assert.equal(recorded.stack.length, 0, 'every cached layer and sprite must balance save/restore');
    return canvas.commands.map(command => serialize(command) as Command);
  };
  try { resize(true); callback({ renderer, canvas, canvases, frame, resize }); }
  finally {
    renderer.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('every physical device kind and health state renders finite, balanced geometry in both themes', () => {
  withRenderer(({ frame, resize, canvases }) => {
    const nodes = buildSpatialNodes(inventory());
    for (const dark of [true, false]) {
      resize(dark);
      const image = frame(nodes);
      assert.ok(image.some(([operation]) => operation === 'drawImage'), 'the main canvas must composite the scene');
      const painted = canvases.flatMap(canvas => canvas.commands).filter(([operation]) => operation === 'fill' || operation === 'stroke');
      assert.ok(painted.length > kinds.length * statuses.length, 'physical glyphs must actually issue drawing commands');
    }
  });
});

test('time moves active connection trails, while offline gateways and inactive endpoints remain static', () => {
  withRenderer(({ frame }) => {
    const nodes = buildSpatialNodes(inventory());
    assert.notDeepEqual(frame(nodes, { time: 1 }), frame(nodes, { time: 4 }), 'online connections should move');
    assert.deepEqual(frame(nodes, { time: 1, online: false }), frame(nodes, { time: 4, online: false }), 'offline gateway must suppress all trail motion');
    const inactive = buildSpatialNodes(inventory().filter(device => device.status === 'err' || device.status === 'off'));
    assert.deepEqual(frame(inactive, { time: 1 }), frame(inactive, { time: 4 }), 'retained positive telemetry must not animate offline or inactive endpoints');
  });
});

test('hover, category, domain, gateway, inventory and theme changes invalidate the visible scene', () => {
  withRenderer(({ frame, resize }) => {
    const devices = inventory();
    const nodes = buildSpatialNodes(devices);
    const baseline = frame(nodes);
    assert.notDeepEqual(frame(nodes, { hoveredId: nodes[0].device.id }), baseline, 'hover must highlight and lift the actual selected device');
    assert.notDeepEqual(frame(nodes, { highlightedKind: 'laptop' }), baseline, 'category highlighting must redraw');
    assert.notDeepEqual(frame(nodes, { highlightedKind: 'laptop', highlightedDomain: 'IT' }), frame(nodes, { highlightedKind: 'laptop', highlightedDomain: 'OT' }), 'domain distinguishes the same device kind');
    assert.notDeepEqual(frame(nodes, { online: false }), baseline, 'gateway state changes the gateway and active routes');
    const changed = buildSpatialNodes(devices.map((device, index) => index === 0 ? { ...device, kind: 'printer', status: 'err' } : device));
    assert.notDeepEqual(frame(changed), baseline, 'inventory updates must replace cached glyphs and health');
    resize(false);
    assert.notDeepEqual(frame(nodes), baseline, 'theme change must replace cached surface and glyph colors');
    resize(true);
    assert.deepEqual(frame(nodes), baseline, 'returning to the original theme must reproduce the original scene');
  });
});

test('warm frames reuse physical sprites and static layers, including when only animation time advances', () => {
  withRenderer(({ frame, canvases, canvas }) => {
    const nodes = buildSpatialNodes(inventory());
    const first = frame(nodes);
    const offscreenOperations = () => canvases.filter(item => item !== canvas).reduce((sum, item) => sum + item.operations, 0);
    const warmed = offscreenOperations();
    const allocated = canvases.length;
    assert.deepEqual(frame(nodes), first, 'same state and time must reproduce the same frame');
    frame(nodes, { time: 3 });
    assert.equal(offscreenOperations(), warmed, 'moving trails must not redraw physical devices or static layers');
    assert.equal(canvases.length, allocated, 'warm animation frames must not allocate new sprite canvases');
    frame(nodes, { hoveredId: nodes[0].device.id });
    assert.ok(offscreenOperations() > warmed, 'inspection must refresh the cached scene');
    assert.equal(canvases.length, allocated, 'inspection should reuse the device glyph sprites');
  });
});

test('dispose is idempotent and later render or resize calls leave the display untouched', () => {
  withRenderer(({ renderer, canvas, frame }) => {
    const nodes = buildSpatialNodes(inventory());
    frame(nodes);
    renderer.dispose();
    const image = canvas.commands.map(command => serialize(command));
    const dimensions = [canvas.width, canvas.height];
    renderer.dispose();
    assert.doesNotThrow(() => { renderer.render(nodes, { time: 10, online: true, hoveredId: null }); renderer.resize(300, 200, 1, false); });
    assert.deepEqual(canvas.commands, image);
    assert.deepEqual([canvas.width, canvas.height], dimensions);
  });
});
