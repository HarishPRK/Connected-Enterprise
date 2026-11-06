export type AutomationVariant = 'after-hours' | 'occupied';
export type AutomationDeviceId = 'display' | 'lamp' | 'sign';
export type AutomationStage = 'baseline' | 'guard-hold' | 'vacancy-check' | 'switching' | 'verifying' | 'complete';
export type AutomationDeviceStage = 'on' | 'requested' | 'acknowledged' | 'observed-off' | 'confirmed';

/** Absolute story units. The film player maps 24 units to 20 real seconds.
 * Vacancy dwell and device responses are illustrative, compressed examples. */
export const AUTOMATION_TIMING = {
  closeRequested: 3,
  doorOpening: 4.3,
  doorOpen: 5,
  employeeExit: 8.5,
  doorClosed: 9,
  vacancyVerified: 10.5,
  display: { request: 11, ack: 11.7, observed: 12 },
  lamp: { request: 12.5, ack: 13.2, observed: 13.5 },
  sign: { request: 14, ack: 14.6, observed: 14.9, powerStart: 15, powerSettled: 16 },
  complete: 16.5,
  duration: 24,
} as const;

export const AUTOMATION_DEVICES = {
  display: { id: 'display', label: 'Store display', device: 'Matter smart plug', protocol: 'Matter', network: 'Wi-Fi', transport: 'Matter over Wi-Fi' },
  lamp: { id: 'lamp', label: 'Desk lamp', device: 'Matter smart plug', protocol: 'Matter', network: 'Thread', transport: 'Matter over Thread' },
  sign: { id: 'sign', label: 'Store sign', device: 'Shelly Plus 1PM', protocol: 'MQTT', network: 'Wi-Fi', transport: 'MQTT over Wi-Fi' },
} as const;

export const AUTOMATION_TOPOLOGY = {
  occupancy: { device: 'Occupancy sensor', protocol: 'Zigbee', bridge: 'Illustrative Zigbee bridge', productionIntegration: false },
  threadBorderRouter: { role: 'IP forwarding between Thread and the LAN', translatesMatter: false },
} as const;

interface LoadState {
  id: AutomationDeviceId;
  label: string;
  device: string;
  protocol: 'Matter' | 'MQTT';
  network: 'Wi-Fi' | 'Thread';
  transport: string;
  requested: boolean;
  ack: boolean;
  acknowledged: boolean;
  observed: boolean;
  on: boolean;
  confirmed: boolean;
  stage: AutomationDeviceStage;
  status: string;
}
export type AutomationDeviceState =
  | (LoadState & { id: 'display'; watts?: never; powerVerified?: never })
  | (LoadState & { id: 'lamp'; watts?: never; powerVerified?: never })
  | (LoadState & { id: 'sign'; watts: number; powerVerified: boolean });
export interface AutomationStoryState {
  illustrative: true;
  variant: AutomationVariant;
  time: number;
  stage: AutomationStage;
  presence: boolean;
  doorClosed: boolean;
  vacancyVerified: boolean;
  requestClose: boolean;
  guardHold: boolean;
  confirmedCount: number;
  total: 3;
  allVerified: boolean;
  devices: {
    display: Extract<AutomationDeviceState, { id: 'display' }>;
    lamp: Extract<AutomationDeviceState, { id: 'lamp' }>;
    sign: Extract<AutomationDeviceState, { id: 'sign' }>;
  };
  status: string;
  detail: string;
}

function loadState(id: AutomationDeviceId, time: number, permitted: boolean): LoadState {
  const timing=AUTOMATION_TIMING[id];
  const requested=permitted&&time>=timing.request;
  const ack=requested&&time>=timing.ack;
  const observed=ack&&time>=timing.observed;
  const confirmed=observed&&(id!=='sign'||time>=AUTOMATION_TIMING.sign.powerSettled);
  const stage:AutomationDeviceStage=confirmed?'confirmed':observed?'observed-off':ack?'acknowledged':requested?'requested':'on';
  const status=confirmed?'Off confirmed':observed?'Off observed · checking power':ack?'Command acknowledged · awaiting state':requested?'Off requested · awaiting acknowledgement':'On · no command issued';
  return {...AUTOMATION_DEVICES[id],requested,ack,acknowledged:ack,observed,on:!observed,confirmed,stage,status};
}

/** A local explanatory sequence. It issues no device commands and does not
 * infer successful switching from an acknowledgement alone. Every sample is
 * rebuilt from variant + absolute clock, including backwards seeks. */
export function sampleAutomation(variant:string,time:number):AutomationStoryState {
  const id:AutomationVariant=variant==='occupied'?'occupied':'after-hours';
  const t=Number.isNaN(time)?0:Math.max(0,Math.min(AUTOMATION_TIMING.duration,time));
  const requestClose=t>=AUTOMATION_TIMING.closeRequested;
  const presence=id==='occupied'||t<AUTOMATION_TIMING.employeeExit;
  const doorClosed=id==='occupied'||t<AUTOMATION_TIMING.doorOpening||t>=AUTOMATION_TIMING.doorClosed;
  const vacancyVerified=requestClose&&!presence&&doorClosed&&t>=AUTOMATION_TIMING.vacancyVerified;
  const guardHold=requestClose&&!vacancyVerified;
  const permitted=requestClose&&vacancyVerified&&!presence;
  const display={...loadState('display',t,permitted),id:'display' as const};
  const lamp={...loadState('lamp',t,permitted),id:'lamp' as const};
  // Acknowledged relay state and metered power are separate observations.
  // Only this illustrative Shelly load has a power measurement.
  const signBase=loadState('sign',t,permitted);
  const readback=signBase.observed?Math.max(0,Math.min(1,(t-AUTOMATION_TIMING.sign.powerStart)/(AUTOMATION_TIMING.sign.powerSettled-AUTOMATION_TIMING.sign.powerStart))):0;
  const sign={...signBase,id:'sign' as const,watts:Math.round(120*(1-readback)*10)/10,powerVerified:signBase.confirmed};
  const confirmedCount=[display,lamp,sign].filter(device=>device.confirmed).length;
  const allVerified=confirmedCount===3&&t>=AUTOMATION_TIMING.complete;
  const stage:AutomationStage=!requestClose?'baseline':presence?'guard-hold':!vacancyVerified?'vacancy-check':allVerified?'complete':t>=AUTOMATION_TIMING.sign.powerStart?'verifying':'switching';
  const status:Record<AutomationStage,string>={
    baseline:'Close the store. Confirm every load.',
    'guard-hold':'Closing held · employee still inside',
    'vacancy-check':doorClosed?'Door closed · verifying vacancy':'Employee has left · waiting for the door',
    switching:`Switching loads · ${confirmedCount} of 3 confirmed`,
    verifying:`Checking the sign’s power · ${confirmedCount} of 3 confirmed`,
    complete:'Store closed · all 3 loads verified off',
  };
  const detail:Record<AutomationStage,string>={
    baseline:'Display, desk lamp and sign are on. The close routine has not been requested.',
    'guard-hold':'Presence blocks every off command. The display, desk lamp and sign remain on.',
    'vacancy-check':'No commands are issued until the door and illustrative vacancy dwell are confirmed.',
    switching:'Each load shows the request, acknowledgement and observed state separately.',
    verifying:'The Shelly sign’s power readback falls from 120 W to 0 W before final confirmation.',
    complete:'Both Matter plug states are off; the Shelly relay is off and its power readback is 0 W.',
  };
  return {illustrative:true,variant:id,time:t,stage,presence,doorClosed,vacancyVerified,requestClose,guardHold,confirmedCount,total:3,allVerified,devices:{display,lamp,sign},status:status[stage],detail:detail[stage]};
}
