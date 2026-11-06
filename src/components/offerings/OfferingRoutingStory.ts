export type RoutingVariant = 'teams' | 'archive' | 'voice';
export type RoutingClientId = 'front-desk' | 'back-office' | 'meeting-room' | 'kitchen-pos' | 'dock-door';
export type RoutingTunnelId = 'vti-fiber1' | 'vti-fiber2' | 'vti-cell1' | 'vti-cell2';
export type RoutingStage = 'baseline' | 'symptom' | 'review' | 'locked-preview' | 'selecting' | 'ready-to-publish' | 'publishing' | 'broker-accepted' | 'illustrating' | 'outcome';

/** Absolute story units; the player maps 24 units to 60 real seconds. */
export const ROUTING_TIMING = {
  symptoms: 4, review: 6, blockedPreview: 6, unlock: 7,
  selectionStart: 9, selectionComplete: 10.5, publish: 11,
  brokerAccepted: 12, newFlow: 14, teamsRejoined: 16,
  voiceConnected: 15.5, outcome: 17, duration: 24,
} as const;

export interface RoutingTunnel {
  id: RoutingTunnelId;
  label: string;
  kind: 'fiber' | 'cellular';
  rtt: number;
  online: true;
}
export interface RoutingClient {
  id: RoutingClientId;
  label: string;
  app: 'Teams' | 'Surveillance' | 'VoIP' | 'POSPayments' | 'OTTelemetry';
  color: string;
  locked: boolean;
  initialRoute: RoutingTunnelId;
  desiredRoute: RoutingTunnelId;
  publishedRoute: RoutingTunnelId;
  illustratedRoute: RoutingTunnelId;
  selected: boolean;
}
export const ROUTING_TUNNELS: readonly RoutingTunnel[] = [
  {id:'vti-fiber1',label:'Fiber 1',kind:'fiber',rtt:4.2,online:true},
  {id:'vti-fiber2',label:'Fiber 2',kind:'fiber',rtt:4.3,online:true},
  {id:'vti-cell1',label:'Cellular 1',kind:'cellular',rtt:41.1,online:true},
  {id:'vti-cell2',label:'Cellular 2',kind:'cellular',rtt:48.7,online:true},
];
type ClientDefinition=Pick<RoutingClient,'id'|'label'|'app'|'color'|'locked'|'initialRoute'>;
export const ROUTING_CLIENTS: readonly ClientDefinition[] = [
  {id:'front-desk',label:'Front desk',app:'Teams',color:'#68d6ff',locked:false,initialRoute:'vti-cell1'},
  {id:'back-office',label:'Back office',app:'Surveillance',color:'#ffc885',locked:false,initialRoute:'vti-fiber1'},
  {id:'meeting-room',label:'Meeting room',app:'VoIP',color:'#b4a5ff',locked:true,initialRoute:'vti-cell2'},
  {id:'kitchen-pos',label:'Kitchen POS',app:'POSPayments',color:'#8ce3c6',locked:true,initialRoute:'vti-fiber1'},
  {id:'dock-door',label:'Dock door',app:'OTTelemetry',color:'#d3d899',locked:true,initialRoute:'vti-fiber2'},
];
export const ROUTING_CASES: Record<RoutingVariant,{client:RoutingClientId;target:RoutingTunnelId;label:string}> = {
  teams:{client:'front-desk',target:'vti-fiber1',label:'Front-desk Teams session'},
  archive:{client:'back-office',target:'vti-fiber2',label:'Back-office surveillance upload'},
  voice:{client:'meeting-room',target:'vti-fiber2',label:'Meeting-room VoIP call'},
};

export interface RoutingStoryState {
  illustrative: true;
  variant: RoutingVariant;
  time: number;
  stage: RoutingStage;
  progress: number;
  selectionProgress: number;
  selectedClientId: RoutingClientId;
  targetRoute: RoutingTunnelId;
  previewBlocked: boolean;
  unlockRequested: boolean;
  selectionAllowed: boolean;
  publishRequested: boolean;
  brokerAccepted: boolean;
  illustrationStarted: boolean;
  publicationState: 'not-requested' | 'publishing' | 'broker-accepted';
  gatewayAcknowledgement: 'not-reported';
  evidenceLabel: 'Awaiting gateway evidence';
  metricLabel: 'Illustrative RTT snapshot';
  clients: RoutingClient[];
  tunnels: RoutingTunnel[];
  teams: {state:'live'|'frozen'|'rejoining';frozen:boolean;motionTime:number;rejoinProgress:number;route:RoutingTunnelId};
  archive: {recording:true;uploadProgress:number;flow:'existing-flow'|'new-flow';route:RoutingTunnelId};
  voice: {state:'ready'|'waiting'|'dialing'|'connected';newCallStarted:boolean;waveform:number;route:RoutingTunnelId};
  status: string;
  detail: string;
  disclaimer: string;
}

function ramp(time:number,start:number,end:number) {
  const u=Math.max(0,Math.min(1,(time-start)/(end-start)));
  return u*u*(3-2*u);
}

/** Scripted route selection and publication, never a gateway control call.
 * The application's publisher supplies no device-application acknowledgement.
 * A later business animation illustrates a NEW flow on the chosen route; it
 * neither asserts live route application nor moves an existing connection. */
export function sampleRouting(time:number,variant:string='teams'):RoutingStoryState {
  const id:RoutingVariant=variant==='archive'||variant==='voice'?variant:'teams';
  const t=Number.isNaN(time)?0:Math.max(0,Math.min(ROUTING_TIMING.duration,time));
  const scenario=ROUTING_CASES[id];
  const unlockRequested=id==='voice'&&t>=ROUTING_TIMING.unlock;
  const previewBlocked=id==='voice'&&t>=ROUTING_TIMING.blockedPreview&&!unlockRequested;
  const selectionAllowed=id!=='voice'||unlockRequested;
  const desiredSelected=selectionAllowed&&t>=ROUTING_TIMING.selectionComplete;
  const publishRequested=desiredSelected&&t>=ROUTING_TIMING.publish;
  const brokerAccepted=publishRequested&&t>=ROUTING_TIMING.brokerAccepted;
  const illustrationStarted=brokerAccepted&&t>=ROUTING_TIMING.newFlow;
  const clients:RoutingClient[]=ROUTING_CLIENTS.map(client=>{
    const selected=client.id===scenario.client;
    const locked=client.id==='meeting-room'?!(selected&&unlockRequested):client.locked;
    return {...client,selected,locked,
      desiredRoute:selected&&!locked&&desiredSelected?scenario.target:client.initialRoute,
      publishedRoute:selected&&!locked&&brokerAccepted?scenario.target:client.initialRoute,
      illustratedRoute:selected&&!locked&&illustrationStarted?scenario.target:client.initialRoute,
    };
  });
  const route=(client:RoutingClientId)=>clients.find(item=>item.id===client)!.illustratedRoute;
  const stage:RoutingStage=t<ROUTING_TIMING.symptoms?'baseline':t<ROUTING_TIMING.review?'symptom':previewBlocked?'locked-preview':t<ROUTING_TIMING.selectionStart?'review':!desiredSelected?'selecting':!publishRequested?'ready-to-publish':!brokerAccepted?'publishing':!illustrationStarted?'broker-accepted':t<ROUTING_TIMING.outcome?'illustrating':'outcome';
  const symptom=id==='teams'?'The Teams picture pauses':id==='archive'?'Review the archive’s shared route':'Choose a route before the next call';
  const status:Record<RoutingStage,string>={
    baseline:'Five clients. Four online tunnels.', symptom,
    review:unlockRequested?'VoIP route unlocked by the operator':'Operator reviews client routes and RTT',
    'locked-preview':'Preview blocked · VoIP route is locked',
    selecting:`Select ${scenario.target} for ${scenario.label}`,
    'ready-to-publish':'Desired route selected · not yet published',
    publishing:'Publishing the desired route',
    'broker-accepted':'Publication accepted by broker · awaiting gateway evidence',
    illustrating:id==='teams'?'Illustrated Teams rejoin on the selected route':id==='archive'?'Illustrated new upload flow on Fiber 2':'Illustrated new call dials on Fiber 2',
    outcome:id==='teams'?'Teams motion resumes in the illustrated rejoin':id==='archive'?'Archive upload continues; recording stays active':'The new call is connected in the illustration',
  };
  const detail:Record<RoutingStage,string>={
    baseline:'Each client has an assigned logical tunnel. POS and OT routes are locked.',
    symptom:'All four tunnels remain online. This is an operator-led route choice, not a failover.',
    review:'The displayed RTT values are a representative snapshot, not live measurements or a guarantee of application performance.',
    'locked-preview':'The attempted preview changes nothing. The operator must explicitly release this client’s lock first.',
    selecting:'The selector changes the desired route only. Other clients retain their assigned routes.',
    'ready-to-publish':'The desired route is staged in the editor. The published and illustrated routes still show the original path.',
    publishing:'The publisher sends the requested configuration. No gateway application acknowledgement is available.',
    'broker-accepted':'Broker acceptance records publication only. It does not confirm that the gateway applied the route.',
    illustrating:'This new-flow example is separate from the publication evidence. It does not claim a seamless move of an existing connection.',
    outcome:'The visible business result is illustrative. Gateway acknowledgement and actual application remain unreported.',
  };
  const frozen=id==='teams'&&t>=ROUTING_TIMING.symptoms&&t<ROUTING_TIMING.newFlow;
  const rejoining=id==='teams'&&illustrationStarted&&t<ROUTING_TIMING.teamsRejoined;
  const teamsMotion=id==='teams'?(t<4?t:t<14?4:4+t-14):t;
  const callStarted=id==='voice'&&illustrationStarted;
  const voiceState:RoutingStoryState['voice']['state']=callStarted?t<ROUTING_TIMING.voiceConnected?'dialing':'connected':id==='voice'&&t>=4?'waiting':'ready';
  return {
    illustrative:true,variant:id,time:t,stage,progress:t/ROUTING_TIMING.duration,
    selectionProgress:selectionAllowed?ramp(t,ROUTING_TIMING.selectionStart,ROUTING_TIMING.selectionComplete):0,
    selectedClientId:scenario.client,targetRoute:scenario.target,previewBlocked,unlockRequested,selectionAllowed,
    publishRequested,brokerAccepted,illustrationStarted,
    publicationState:brokerAccepted?'broker-accepted':publishRequested?'publishing':'not-requested',
    gatewayAcknowledgement:'not-reported',evidenceLabel:'Awaiting gateway evidence',metricLabel:'Illustrative RTT snapshot',
    clients,tunnels:ROUTING_TUNNELS.map(tunnel=>({...tunnel})),
    teams:{state:frozen?'frozen':rejoining?'rejoining':'live',frozen,motionTime:teamsMotion,rejoinProgress:id==='teams'?ramp(t,14,16):1,route:route('front-desk')},
    // Continuous illustrative transfer progress, not an invented bandwidth cap.
    archive:{recording:true,uploadProgress:.16+.7*t/24,flow:id==='archive'&&illustrationStarted?'new-flow':'existing-flow',route:route('back-office')},
    voice:{state:voiceState,newCallStarted:callStarted,waveform:voiceState==='connected'?.18+.82*Math.abs(Math.sin((t-15.5)*5.3)):0,route:route('meeting-room')},
    status:status[stage],detail:detail[stage],
    disclaimer:'Illustrative scenario and RTT snapshot. Publication is not gateway acknowledgement. Business motion shows a new-flow example, not live route verification.',
  };
}
