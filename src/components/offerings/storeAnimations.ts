import { safetyScene } from './safetyScene';
import { connectivityScene, energyScene } from './operationsScenes';
import { leakScene, occupancyScene } from './additionalScenes';
import { eagleScene, greengrassScene } from './platformScenes';
import {
  box, ellipse, iso, line, polygon, progress, scenePresentation,
  type Palette, type Point, type ScenarioId,
} from './scenePrimitives';

type Scene = (ctx: CanvasRenderingContext2D, p: Palette, time: number) => void;

function devicePlacard(
  ctx: CanvasRenderingContext2D, p: Palette, at: Point, x: number, y: number,
  name: string, transport: string, color: string, time: number, index: number,
) {
  const discovered = time >= 10.4 + index * .38;
  const commissioned = time >= 13 + index * .45;
  const status = commissioned ? `Connected · ${transport}` : discovered ? `Discovered · ${transport}` : transport;
  const width = 143;
  const left = x - width / 2;
  const stateColor = commissioned ? p.teal : discovered ? p.blue : color;
  ctx.save();
  line(ctx, [at, { x, y: y + 18 }], p.hardwareSide, 1);
  ctx.beginPath();
  ctx.roundRect(left, y - 19, width, 39, 5);
  ctx.fillStyle = p.dark ? '#1b293f' : '#f8fbff';
  ctx.fill();
  ctx.strokeStyle = p.dark ? '#3c526e' : '#c9d7e4';
  ctx.lineWidth = 1;
  ctx.stroke();
  line(ctx, [{ x: left + 1.5, y: y - 12 }, { x: left + 1.5, y: y + 12 }], color, 3);
  ellipse(ctx, { x: left + 12, y: y - 5 }, 3, 3, stateColor);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '600 12px "Space Grotesk", ui-sans-serif, system-ui';
  ctx.fillStyle = p.ink;
  ctx.fillText(name, left + 22, y - 5);
  ctx.font = '500 10px "Space Grotesk", ui-sans-serif, system-ui';
  ctx.fillStyle = p.muted;
  ctx.fillText(status, left + 12, y + 9);
  if (commissioned) {
    line(ctx, [{ x: left + width - 17, y: y - 6 }, { x: left + width - 14, y: y - 3 }, { x: left + width - 9, y: y - 9 }], p.teal, 1.7);
  }
  ctx.restore();
}

function discoveryPulse(ctx: CanvasRenderingContext2D, p: Palette, at: Point, time: number, index: number) {
  const appearing = progress(time, 10 + index * .38, 10.8 + index * .38);
  const finished = progress(time, 14.6 + index * .25, 16.2 + index * .2);
  if (!appearing || finished >= 1) return;
  ctx.save();
  for (let n = 0; n < 2; n++) {
    const phase = ((time - 10) * .8 + n * .5 + index * .12) % 1;
    ctx.globalAlpha = appearing * (1 - finished) * (1 - phase) * .55;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, 10 + phase * 25, 6 + phase * 14, 0, 0, Math.PI * 2);
    ctx.strokeStyle = time < 13 + index * .45 ? p.blue : p.teal;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Preserve the deployed occupancy animation: the person leaves, the pendant
 * dims, cooling airflow slows, and the original shades physically descend.
 * The additional hardware makes the shared Matter policy a four-OEM story.
 */
function matterScene(ctx: CanvasRenderingContext2D, p: Palette, time: number) {
  occupancyScene(ctx, p, time);
  const dimmed = progress(time, 17, 20.5);
  const sensor = iso(12, 33, 92);
  const light = iso(151, 169, 134);
  const climate = iso(322, 14, 80);
  const shades = iso(151, 7, 101);

  // The occupancy sensor exists before discovery; connectivity changes its state.
  ellipse(ctx, sensor, 14, 12, p.hardwareTop);
  ellipse(ctx, { x: sensor.x + 1, y: sensor.y + 1 }, 6.5, 6.5, p.hardwareSide);
  ellipse(ctx, sensor, 4.5, 4.5, time < 10.4 ? p.amber : time < 13 ? p.blue : p.teal);

  // A wall control belongs to a different manufacturer from the pendant.
  box(ctx, 303, 4, 61, 39, 9, 39, p.hardwareTop, p.hardware, p.hardwareSide);
  polygon(ctx, [iso(309, 14, 92), iso(336, 14, 92), iso(336, 14, 70), iso(309, 14, 70)], p.screen);
  ctx.save();
  ctx.font = `600 ${dimmed > .6 ? 12 : 15}px "Space Grotesk", ui-sans-serif, system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = dimmed > .6 ? p.teal : '#c9eef5';
  ctx.fillText(dimmed > .6 ? 'ECO' : '22°', climate.x + 1, climate.y);
  ctx.restore();
  ellipse(ctx, iso(332, 14, 65), 2, 2, time >= 13.9 ? p.teal : p.amber);

  // The motor cassette remains visible while the original fabric is retracted.
  box(ctx, 65, 2, 96, 169, 7, 7, p.hardwareTop, p.hardware, p.hardwareSide);
  ellipse(ctx, iso(224, 10, 100), 2, 2, time >= 14.35 ? p.teal : p.amber);

  discoveryPulse(ctx, p, sensor, time, 0);
  discoveryPulse(ctx, p, light, time, 1);
  discoveryPulse(ctx, p, climate, time, 2);
  discoveryPulse(ctx, p, shades, time, 3);
  if (scenePresentation(ctx)?.labels !== false) {
    devicePlacard(ctx, p, sensor, 337, 72, 'OEM A · Sensor', 'Thread', p.blue, time, 0);
    devicePlacard(ctx, p, light, 313, 148, 'OEM B · Lighting', 'Wi-Fi', p.amber, time, 1);
    devicePlacard(ctx, p, climate, 743, 175, 'OEM C · Climate', 'Wi-Fi', '#df91d0', time, 2);
    devicePlacard(ctx, p, shades, 548, 72, 'OEM D · Shades', 'Thread', p.teal, time, 3);
  }

  if (time >= 10 && time < 17 && scenePresentation(ctx)?.labels !== false) {
    const text = time < 12 ? 'mDNS / DNS-SD discovery' : time < 15 ? 'Commissioning one Matter fabric' : 'One fabric · four manufacturers';
    ctx.save();
    ctx.font = '600 12px "Space Grotesk", ui-sans-serif, system-ui';
    const width = ctx.measureText(text).width + 28;
    ctx.beginPath(); ctx.roundRect(488 - width / 2, 411, width, 26, 5);
    ctx.fillStyle = p.dark ? '#1b293f' : '#f8fbff'; ctx.fill();
    ctx.strokeStyle = time < 15 ? p.blue : p.teal; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = p.ink;
    ctx.fillText(text, 488, 424);
    ctx.restore();
  }
}

// These are the original, rich canvas scenes. Their actor poses, paper/receipt
// motion, fan acceleration, water, operator gestures and conveyor remain intact.
const SCENES: Record<ScenarioId, Scene> = {
  safety: safetyScene,
  connectivity: connectivityScene,
  energy: energyScene,
  leak: leakScene,
  matter: matterScene,
  eagle: eagleScene,
  greengrass: greengrassScene,
};

export function drawStoreScenario(ctx: CanvasRenderingContext2D, p: Palette, id: ScenarioId, time: number) {
  SCENES[id](ctx, p, time);
}

/** Status follows the actual original animation beats, including gradual outcomes. */
export function storeScenarioStatus(id: ScenarioId, time: number): string {
  switch (id) {
    case 'safety':
      return time < 1.8 ? 'Shopper in the aisle' : time < 3.85 ? 'A fall in the aisle' : time < 10.6 ? 'Fall unobserved' : time < 13.2 ? 'Possible fall detected' : time < 20.3 ? 'Assistance requested' : 'Colleague assisting';
    case 'connectivity':
      return time < 3 ? 'Checkout in progress' : time < 10 ? 'Payment waiting' : time < 15 ? 'Selecting cellular' : time < 17.2 ? '5G path selected' : time < 19.3 ? 'Checkout resumes' : 'Payment complete';
    case 'energy':
      return time < 1.4 ? 'Cooling the store' : time < 11 ? 'Cooling demand rising' : time < 17 ? 'Energy anomaly detected' : time < 18.9 ? 'Technician on site' : time < 22 ? 'Adjusting the setpoint' : 'Cooling demand stabilized';
    case 'leak':
      return time < .8 ? 'Utility supply operating' : time < 10 ? 'Water escaping' : time < 17 ? 'Leak detected' : time < 20 ? 'Valve closing' : 'Supply isolated';
    case 'matter':
      return time < 3.6 ? 'Different OEMs · independent controls' : time < 10 ? 'Empty room · devices still on' : time < 12 ? 'Discovering devices · mDNS / DNS-SD' : time < 15 ? 'Commissioning one Matter fabric' : time < 17 ? 'Multi-OEM devices connected' : time < 20.5 ? 'Room policy coordinating devices' : 'Lights, climate + shades coordinated';
    case 'eagle':
      return time < 10 ? 'Queued work grows' : time < 13 ? 'EA:GLE analyzing signals' : time < 16 ? 'Anomaly identified' : time < 20 ? 'Operator reviewing equipment' : 'Equipment flagged for investigation';
    case 'greengrass':
      return time < 1.55 ? 'Stockroom scanner online' : time < 10 ? 'Cloud offline · samples retained' : time < 17 ? 'Local processing + buffering' : time <= 17.75 ? 'Cloud connection returning' : time < 22.5 ? 'Buffered results synchronizing' : 'Buffer synchronized';
  }
}
