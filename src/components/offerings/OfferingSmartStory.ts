export type SmartVariant = 'hvac' | 'cooler' | 'energy';
export type SmartStage = 'baseline' | 'symptom' | 'review' | 'approach' | 'action' | 'verification';

/** Absolute story units; the player maps 24 units to 30 real seconds.
 * Temperatures, circuit loads and elapsed trend windows are illustrative. */
export const SMART_TIMING = {
  symptom: 4,
  consoleApproach: 5.5,
  review: 7,
  dispatch: 10.5,
  arrive: 15.5,
  action: 16,
  actionComplete: 18,
  recovery: 18.8,
  verify: 20,
  duration: 24,
  cooler: { opening: 1, ajar: 3, closeStart: 16, closed: 18 },
  energy: { request: 16, lightsStart: 17, lightsSettled: 19, hvacStart: 18, hvacSettled: 20, powerSettled: 23.5 },
} as const;

const clamp = (value: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const smooth = (time: number, start: number, end: number) => {
  const p = clamp((time - start) / (end - start));
  return p * p * (3 - 2 * p);
};
const rounded = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

/** Integral of smoothstep: stable absolute-clock rotor motion, including seek. */
function integratedRamp(time: number, start: number, end: number) {
  const duration = end - start, p = clamp((time - start) / duration);
  return duration * (p ** 3 - p ** 4 / 2) + Math.max(0, time - end);
}

export interface SmartStoryState {
  illustrative: true;
  variant: SmartVariant;
  time: number;
  stage: SmartStage;
  operatorAtConsole: boolean;
  reviewed: boolean;
  actionStarted: boolean;
  actionComplete: boolean;
  status: string;
  detail: string;
  hvac: {
    obstructionProgress: number;
    obstructed: boolean;
    airflow: number;
    fanLoad: number;
    fanAngle: number;
    zoneC: number;
    targetC: number;
    warning: boolean;
    recovering: boolean;
  };
  cooler: {
    doorAngle: number;
    doorOpen: boolean;
    airLoss: number;
    airC: number;
    targetC: number;
    warning: boolean;
    recovering: boolean;
    stockCondition: 'not-assessed';
  };
  energy: {
    requested: boolean;
    proposedControls: true;
    displayLevel: number;
    lightingLevel: number;
    hvacLoad: number;
    hvacFanAngle: number;
    setpointC: number;
    totalKw: number;
    essentialKw: number;
    selectedLoadsKw: number;
    coolersOn: true;
    networkOn: true;
    walkwayOn: true;
  };
  verification: {
    started: boolean;
    progress: number;
    trendImproving: boolean;
    temperatureStable: false;
    followUpRequired: true;
    message: string;
  };
}

/** No random state or real commands. Cause, physical action and delayed
 * response are separate, so a closed door cannot instantly reset temperature. */
export function sampleSmart(variant: string, time: number): SmartStoryState {
  const id: SmartVariant = variant === 'cooler' || variant === 'energy' ? variant : 'hvac';
  const t = clamp(Number.isNaN(time) ? 0 : time, 0, SMART_TIMING.duration);
  const removed = smooth(t, SMART_TIMING.action, SMART_TIMING.actionComplete);
  const recovered = smooth(t, SMART_TIMING.recovery, SMART_TIMING.duration);
  const warming = smooth(t, 3, 9);
  const hvac = {
    obstructionProgress: id === 'hvac' ? removed : 1,
    obstructed: id === 'hvac' && removed < .98,
    airflow: id === 'hvac' ? .28 + .72 * removed : 1,
    fanLoad: id === 'hvac' ? .55 + .41 * smooth(t, 4, 6.5) - .34 * smooth(t, 19, 23) : .55,
    fanAngle: 9 * t + (id === 'hvac' ? 6 * integratedRamp(t, 4, 6.5) - 5 * integratedRamp(t, 19, 23) : 0),
    zoneC: rounded(id === 'hvac' ? 22 + 5.3 * warming - 3.1 * recovered : 22),
    targetC: 22.5,
    warning: id === 'hvac' && t >= 4 && t < 21.5,
    recovering: id === 'hvac' && t >= SMART_TIMING.recovery,
  };
  const open = id === 'cooler' ? smooth(t, 1, 3) * (1 - removed) : 0;
  const cooler = {
    doorAngle: open > 0 ? -.68 * open : 0,
    doorOpen: open > .015,
    airLoss: open,
    airC: rounded(id === 'cooler' ? 3.2 + 4.2 * smooth(t, 3, 9) - 2.6 * recovered : 3.2),
    targetC: 3.2,
    warning: id === 'cooler' && t >= 4,
    recovering: id === 'cooler' && t >= SMART_TIMING.recovery,
    stockCondition: 'not-assessed' as const,
  };
  const lights = id === 'energy' ? smooth(t, 17, 19) : 0;
  const hvacStandby = id === 'energy' ? smooth(t, 18, 20) : 0;
  const essentialKw = 3.8;
  const demandDrop = id === 'energy' ? smooth(t, 18.2, 23.5) : 0;
  const totalKw = rounded(9.4 - 4.77 * demandDrop, 2);
  const energy = {
    requested: id === 'energy' && t >= SMART_TIMING.energy.request,
    proposedControls: true as const,
    displayLevel: 1 - lights,
    lightingLevel: 1 - .8 * lights,
    hvacLoad: 1 - .92 * hvacStandby,
    hvacFanAngle: 9 * t - 8.4 * integratedRamp(t, 18, 20),
    setpointC: id === 'energy' && t >= 17 ? 26 : 22,
    totalKw,
    essentialKw,
    selectedLoadsKw: rounded(totalKw - essentialKw, 2),
    coolersOn: true as const,
    networkOn: true as const,
    walkwayOn: true as const,
  };
  const stage: SmartStage = t >= 18 ? 'verification' : t >= 16 ? 'action' : t >= 10.5 ? 'approach' : t >= 7 ? 'review' : t >= 4 ? 'symptom' : 'baseline';
  const phrases: Record<SmartVariant, Record<SmartStage, [string, string]>> = {
    hvac: {
      baseline: ['A packing trolley blocks the intake', 'The external grille is partly covered while the protected fan continues running.'],
      symptom: ['The zone warms while fan demand rises', 'The illustrative temperature trend and airflow restriction call for a physical check.'],
      review: ['Compare the temperature and fan-demand trends', 'The operator reviews the rack console before inspecting the intake.'],
      approach: ['Inspect the external grille', 'The operator walks to the HVAC unit; the enclosure remains closed.'],
      action: ['Move the packing trolley clear', 'The operator pushes the external obstruction sideways; no guard or panel is removed.'],
      verification: ['Airflow returns; watch the cooling trend', 'Zone temperature falls gradually but remains above target. Continue monitoring before closing the task.'],
    },
    cooler: {
      baseline: ['A cooler door is left ajar', 'The door opens for a stock check and does not return to its closed position.'],
      symptom: ['Cold air escapes and cabinet temperature rises', 'The door-open report and warming trend point to a visible local condition.'],
      review: ['Review the door state beside the temperature trend', 'The operator checks the console, then goes to the affected cooler.'],
      approach: ['Check the open door and its handle', 'The operator approaches the affected left door; the neighboring cooler stays closed.'],
      action: ['Close the cooler door', 'The operator follows the handle as the door returns to its seal.'],
      verification: ['Door closed; temperature is still recovering', 'The air cools gradually. Stock condition and sustained temperature still need follow-up.'],
    },
    energy: {
      baseline: ['The store is empty but selected loads remain on', 'The display, task lighting and HVAC still follow the occupied schedule.'],
      symptom: ['After-hours demand remains at 9.40 kW', 'The example circuit breakdown separates avoidable loads from essential equipment.'],
      review: ['Review each load before changing its schedule', 'The operator checks the console and excludes coolers, networking and walkway lighting.'],
      approach: ['Go to the local comfort controls', 'The operator checks the empty zone before requesting the illustrative after-hours settings.'],
      action: ['Request the selected after-hours settings', 'The illustrated control sequence turns off the display, reduces task lighting and relaxes the zone setpoint.'],
      verification: ['Selected loads fall; essential services stay on', 'The example meter declines after the load changes. Check the longer trend before accepting the saving.'],
    },
  };
  return {
    illustrative: true, variant: id, time: t, stage,
    operatorAtConsole: t >= 7 && t < 10.5,
    reviewed: t >= 10.5,
    actionStarted: t >= 16,
    actionComplete: t >= (id === 'energy' ? SMART_TIMING.energy.hvacSettled : SMART_TIMING.actionComplete),
    status: phrases[id][stage][0], detail: phrases[id][stage][1], hvac, cooler, energy,
    verification: {
      started: t >= 18,
      progress: smooth(t, 18, 24),
      trendImproving: id === 'energy' ? demandDrop > .01 : recovered > .01,
      temperatureStable: false,
      followUpRequired: true,
      message: id === 'energy' ? 'Example demand lower · verify the next interval' : id === 'cooler' ? 'Door closed · recovery and stock checks continue' : 'Intake clear · cooling trend still under observation',
    },
  };
}
