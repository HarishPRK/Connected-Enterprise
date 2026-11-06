import type { OfferingChapter, OfferingId, OfferingVariant } from './offeringCatalog';
import { EAGLE_CASES, eagleVariant } from './OfferingEagleStory';

export type StoryBeat = {
  title: string;
  description: string;
  status: string;
  signals: { label: string; value: string }[];
};
type Story = [StoryBeat, StoryBeat, StoryBeat, StoryBeat];
type Signal = readonly [label: string, value: string];
function beat(title: string, description: string, status: string, signals: [Signal, Signal, Signal]): StoryBeat {
  return { title, description, status, signals: signals.map(([label, value]) => ({ label, value })) };
}

const FAILOVER: Record<string, Story> = {
  fiber: [
    beat('A customer taps their card.', 'It is the lunch rush. The cashier is serving a customer while the next shoppers wait. Checkout reaches the payment service through fiber.', 'Checkout in progress', [['Customer', 'Ready to pay'], ['Cashier', 'Processing payment'], ['Primary route', 'Fiber']]),
    beat('The payment cannot get through.', 'The fiber connection drops before the payment completes. The customer stays at the terminal and the queue waits behind them.', 'Fiber interrupted · payment waiting', [['Payment', 'Waiting for a route'], ['Customer', 'Still at checkout'], ['Fiber', 'Connection lost']]),
    beat('Give the cashier another route.', 'The CPE checks the cellular connection and selects it under the failover policy. The cashier retries the payment through 5G.', '5G selected · checkout resumes', [['CPE', 'Select healthy alternate'], ['Cashier', 'Retry payment'], ['Payment route', '5G']]),
    beat('The receipt prints. The queue moves.', 'The payment completes over the alternate connection. The customer takes their receipt and leaves, and the cashier serves the next person. Fiber remains flagged for investigation.', 'Customer served · fiber fault remains open', [['Payment', 'Completed over 5G'], ['Customer', 'Receipt collected'], ['Fiber', 'Follow-up required']]),
  ],
  '5g': [
    beat('The store is trading as usual.', 'A cashier serves the afternoon queue over the primary fiber connection. The cellular link is ready to provide an alternate route.', 'Checkout using fiber', [['Cashier', 'Serving customers'], ['Fiber', 'Primary route'], ['5G', 'Alternate available']]),
    beat('The backup link disappears.', 'The cellular connection disconnects. The manager sees the lost backup while the current customer’s payment continues on fiber.', '5G unavailable · fiber still carries traffic', [['5G', 'Connection lost'], ['Payment', 'Still on fiber'], ['Manager', 'Backup issue visible']]),
    beat('Protect the route that is still working.', 'The gateway keeps the eligible fiber route and removes the failed cellular path from consideration. The manager assigns the backup issue for investigation.', 'Working fiber route retained', [['CPE', 'Retain fiber'], ['Checkout', 'Continue service'], ['Support task', 'Investigate backup']]),
    beat('Keep serving while support checks the backup.', 'The cashier completes the sale and calls the next customer forward. The technician has a separate cellular investigation; the branch is still operating with reduced redundancy.', 'Trade continues · backup review pending', [['Customer', 'Sale completed'], ['Technician', 'Check cellular path'], ['Redundancy', 'Reduced']]),
  ],
};

const ROUTING: Record<string, Story> = {
  teams: [
    beat('The front desk joins the briefing.', 'A colleague opens Microsoft Teams on the front-desk laptop. Its example binding runs through the shared gateway to vti-cell1. Surveillance, VoIP, POS Payments and OT Telemetry have separate bindings; all four tunnels are online.', 'Briefing underway · four tunnels online', [['Selected client', 'front-desk · Microsoft Teams'], ['Current binding', 'vti-cell1'], ['POS + OT', 'Bindings locked']]),
    beat('Pause the choppy video and review its route.', 'The briefing image stalls. The colleague pauses the session while the operator checks front-desk and compares the tunnel measurements on the patchboard. The operator selects vti-fiber1 for this client; no connection has failed.', 'One client under review · other bindings retained', [['Visible symptom', 'Briefing video paused'], ['Current → selected', 'vti-cell1 → vti-fiber1'], ['Other tunnels', 'Still online']]),
    beat('Preview the placement, then publish it.', 'The operator previews front-desk on vti-fiber1 and publishes the route command. Broker acceptance confirms that the command was published, not that the gateway applied it. POS and telemetry stay locked, and the other application bindings remain unchanged.', 'Broker publication confirmed · awaiting gateway evidence', [['Selected client', 'front-desk only'], ['Command result', 'Accepted by broker'], ['Gateway result', 'Not reported']]),
    beat('Rejoin the briefing on the illustrated next flow.', 'The colleague rejoins and the meeting video advances. This new vti-fiber1 connection and its improved playback are illustrative. The command remains published with gateway evidence pending; the scene does not claim migration of the earlier session.', 'Briefing illustrated · gateway evidence still pending', [['Next connection', 'Illustrative · vti-fiber1'], ['Colleague', 'Briefing resumed'], ['Confirmed evidence', 'Broker publication only']]),
  ],
  archive: [
    beat('Select the footage that needs to leave the store.', 'At back-office, the colleague selects a recorded camera segment for transfer. Surveillance currently uses vti-fiber1 through the shared gateway. The camera continues recording locally, and four online tunnels remain available.', 'Footage selected · local recording active', [['Selected client', 'back-office · Surveillance'], ['Current binding', 'vti-fiber1'], ['Camera', 'Recording locally']]),
    beat('The transfer is slow. Compare another online path.', 'The segment’s progress slows. The operator opens the Surveillance client on the patchboard and compares vti-fiber1 with vti-fiber2. The next segment can use a different selected path while the other clients keep their bindings.', 'Transfer under review · recording continues', [['Visible symptom', 'Slow segment transfer'], ['Current → selected', 'vti-fiber1 → vti-fiber2'], ['POS + OT', 'Bindings locked']]),
    beat('Publish a route for this upload client.', 'The operator previews back-office on vti-fiber2 and publishes that single client’s change. The broker accepts the command. There is no applied acknowledgement from the gateway and no bandwidth cap; camera recording remains separate from the transfer.', 'Broker publication confirmed · awaiting gateway evidence', [['Selected client', 'back-office only'], ['Command result', 'Accepted by broker'], ['Gateway result', 'Not reported']]),
    beat('The next recorded segment advances.', 'The workstation starts the next segment and its progress advances along an illustrative vti-fiber2 flow. The live camera preview keeps recording. This depicts the intended placement; actual gateway evidence is still pending after broker publication.', 'Transfer illustrated · gateway evidence still pending', [['Next segment', 'Illustrative · vti-fiber2'], ['Local recording', 'Continues'], ['Other clients', 'Bindings retained']]),
  ],
  voice: [
    beat('The colleague prepares the next call.', 'The meeting-room phone is ready for an outgoing VoIP call. Its client binding is locked to vti-cell2. The operator can compare all four online tunnels, but the lock protects this placement from an immediate change.', 'Next call ready · meeting-room route locked', [['Selected client', 'meeting-room · VoIP'], ['Current binding', 'vti-cell2 · locked'], ['Call state', 'Not placed yet']]),
    beat('The lock blocks the first selection.', 'The operator reviews the current delay and attempts another placement. The patchboard refuses to move the locked client. The operator explicitly releases the meeting-room lock, then selects online vti-fiber2; the POS and telemetry locks stay on.', 'Meeting-room unlocked · POS and OT remain locked', [['First attempt', 'Blocked by client lock'], ['Operator action', 'Release meeting-room lock'], ['Selected destination', 'vti-fiber2']]),
    beat('Publish before placing the new call.', 'The operator previews meeting-room on vti-fiber2 and publishes its route command. Broker acceptance confirms publication only. The colleague then places a new call in the illustrative sequence; no active call is moved between tunnels.', 'Broker publication confirmed · awaiting gateway evidence', [['Selected client', 'meeting-room only'], ['Command result', 'Accepted by broker'], ['Gateway result', 'Not reported']]),
    beat('The next call has its illustrated path.', 'The colleague uses the phone and the new call’s activity travels through an illustrative vti-fiber2 binding. This is the intended experience, not a gateway acknowledgement. All tunnels stay online and unrelated clients keep their original routes.', 'Call illustrated · gateway evidence still pending', [['New call', 'Illustrative · vti-fiber2'], ['Other clients', 'Bindings retained'], ['Confirmed evidence', 'Broker publication only']]),
  ],
};

function twinStory(exploded: boolean): Story {
  return [
    beat('The operator opens the gateway on a laptop.', 'Checkout 01 reports intermittent connectivity. At the service cart, the operator opens the Gemtek twin and its interface diagnostics. The physical CPE remains beside the laptop.', 'Gateway diagnostic session opened', [['Operator', 'At the laptop'], ['Affected endpoint', 'Checkout 01'], ['Twin', 'Gemtek OSPv2']]),
    beat('The error log points to LAN 1.', 'Repeated link disconnects identify one local Ethernet interface. The operator selects that log entry and the twin highlights the matching LAN 1 socket. Fiber and 5G remain healthy.', 'LAN 1 identified from the error log', [['Log event', 'Repeated link disconnects'], ['Affected interface', 'LAN 1'], ['Next step', 'Inspect the connector']]),
    beat('Match the twin to the physical connection.', exploded ? 'The on-screen exploded model reveals the port assembly. The physical gateway stays assembled. The operator walks to the highlighted LAN 1 connector, checks its seating and reseats it.' : 'The operator matches the highlighted socket on the laptop to LAN 1 on the physical gateway, walks to the equipment and reseats its Ethernet connector.', 'Operator checks and reseats LAN 1', [['Twin', 'Port location confirmed'], ['Physical check', 'Connector seating'], ['Action', 'Reseat LAN 1 cable']]),
    beat('Verify the repair before closing the issue.', 'The operator returns to the laptop. The simulated log reports LINK UP, the stability check passes and Checkout 01 is reachable again. The restored traffic follows the same local cable.', 'LAN 1 stable; checkout reachable', [['Link state', 'Up at 1 Gbps'], ['Verification', 'Stability check passed'], ['Checkout 01', 'Reachable']]),
  ];
}
const TWIN: Record<string, Story> = { assembled: twinStory(false), exploded: twinStory(true) };

const MONITORING = EAGLE_CASES;
function monitoringStory(id: string): Story {
  const item = EAGLE_CASES[eagleVariant(id)];
  const gateway = id === 'gateway';
  return [
    beat('One branch. Several connected workloads.', 'A camera records, checkout requests inventory and climate sensors report through shared local infrastructure. The example baseline response is 180 ms. EA:GLE supplies hardware detector windows and connection context.', 'Connected devices responding', [['Service response', '180 ms baseline'], ['Detector', 'Within learned threshold'], ['Context', 'Illustrative compressed windows']]),
    beat(item.symptom + '.', gateway ? 'Pending requests accumulate across several workloads. One MSE window crosses the 1.122 learned threshold before a separate received flag reports Memory Pressure. The operator compares successive windows rather than diagnosing from one spike.' : 'The separate response check becomes slow while EA:GLE hardware windows stay within threshold. The operator compares the service symptom with the normal detector result and protocol connection counts.', 'Evidence accumulating · cause not yet established', [['Response delay', (item.delay / 1000).toFixed(1) + ' seconds'], ['Received reason', gateway ? 'Memory Pressure after crossing' : 'Normal hardware'], ['Next check', item.check]]),
    beat('Inspect first. Attempt a specific recovery.', item.actionDetail + ' ' + item.finding + '. The physical console shows the example action being started; this sequence sends no live device commands.', 'Physical check → illustrative attempt', [['Inspection', item.check], ['Attempt', item.action], ['Verification', 'Fresh evidence still required']]),
    beat(item.improves ? 'Verify the new responses before claiming recovery.' : 'The repeat check is still slow. Escalate.', item.improves ? 'The pending queue drains and the response improves after the example intervention. Two fresh windows must arrive; in the gateway case the received flag must also clear. This demonstrates an observed recovery, not a permanent repair or proven root cause.' : 'The terminal check and repeated upstream probe do not clear the delay. Normal hardware windows do not prove the uplink healthy. The operator retains the evidence and escalates the interface investigation.', item.outcome, [['Service evidence', item.improves ? 'New responses improve' : 'Repeat probe remains delayed'], ['Detector evidence', item.improves ? 'Two fresh windows + no flag' : 'Hardware remains Normal'], ['Follow-up', 'Investigation remains open']]),
  ];
}

const AUTOMATION: Record<string, Story> = {
  'after-hours': [
    beat('The last colleague requests closure.', 'Three selected loads are still on: a display through a Matter Wi-Fi plug, a desk lamp through a Matter Thread plug, and a sign through a Shelly relay. The colleague starts the illustrative closing routine on the tablet; the wall console tracks its progress.', 'Close request · three loads still on', [['Display', 'Matter over Wi-Fi'], ['Desk lamp', 'Matter over Thread'], ['Sign', 'Shelly · MQTT over Wi-Fi']]),
    beat('Wait until the colleague has left.', 'The routine stays on hold while presence is reported. After the colleague leaves through the staff door and it closes, the proposed Zigbee bridge supplies a clear report. A compressed vacancy dwell must finish before any load command is sent.', 'Presence condition · no commands yet', [['Presence', 'Occupied → clear'], ['Vacancy dwell', 'Compressed for this demonstration'], ['Zigbee bridge & rule', 'Proposed integration']]),
    beat('Switch each load. Check its own reply.', 'The display switches off through Matter over Wi-Fi, then the desk lamp through Matter over Thread. The Shelly sign relay follows through RPC over MQTT. The wall console distinguishes each request, acknowledgement and observed switch state; the sign circuit reading then settles from an illustrative 120 W to 0 W.', 'Three paths · independent state confirmations', [['Display & lamp', 'Matter On/Off'], ['Sign relay', 'Shelly Switch.Set'], ['Verification', 'State readback + sign circuit power']]),
    beat('Three selected loads are confirmed off.', 'The display and desk lamp are dark, the illuminated sign is off, and the console shows three confirmations. The cooler, network equipment and separate walkway light keep operating. The scene illustrates a coordinated routine; it does not issue commands to connected equipment.', '3 / 3 confirmed · essential loads remain powered', [['Selected loads', 'Off · confirmed individually'], ['Sign circuit', 'Illustrative 0 W'], ['Still powered', 'Coolers · network · walkway']]),
  ],
  occupied: [
    beat('The colleague requests closure but keeps working.', 'The employee starts the closing request on the tablet and continues the inventory check inside. The display, desk lamp and sign remain powered through their different device integrations.', 'Close requested · colleague still inside', [['Colleague', 'Finishing inventory'], ['Selected loads', 'All on'], ['Routine', 'Waiting for presence check']]),
    beat('The presence check explains the hold.', 'The proposed Zigbee presence input still reports someone inside. The wall console shows that condition explicitly. An accepted closing request is not permission to switch the loads before the vacancy rule clears.', 'Held · presence still reported', [['Presence', 'Occupied'], ['Vacancy condition', 'Not satisfied'], ['Commands sent', '0']]),
    beat('Withhold every device command.', 'No Matter Off request goes to the Wi-Fi or Thread plug, and no Shelly Switch.Set request leaves for the sign. The employee keeps working in the lit space while the wall console retains the reason for the hold.', 'All three paths withheld · loads remain on', [['Wi-Fi plug', 'On · no command'], ['Thread plug', 'On · no command'], ['Shelly relay', 'On · no command']]),
    beat('A visible hold is the correct result.', 'The colleague is still inside, so all three loads stay on and the sign circuit remains at its illustrative 120 W. The console has no off confirmations. The proposed presence rule is demonstrated without claiming any deployed Zigbee adapter or automation engine.', 'Still occupied · closure remains pending', [['Reason', 'Colleague still inside'], ['Confirmed off', '0 / 3'], ['Selected loads', 'Remain on']]),
  ],
};

const SMART: Record<string, Story> = {
  hvac: [
    beat('A delivery has been left at the intake.', 'A loaded trolley obstructs the external air grille. The fan runs, but the visible airflow is restricted. The example zone temperature begins at 22 °C.', 'External obstruction · equipment still running', [['Intake', 'Partly obstructed'], ['Zone baseline', '22 °C'], ['Example data', 'Illustrative']]),
    beat('The room warms while the fan works harder.', 'The physical console traces rising temperature and fan load. The operator reads both trends before walking to the unit; the readings alone do not establish a mechanical fault.', 'Rising trend · physical inspection needed', [['Zone', 'Rising toward 27.3 °C'], ['Fan load', 'Increasing'], ['Next step', 'Check the intake']]),
    beat('Move the obstruction clear of the grille.', 'At the unit, the technician grips the trolley handle and rolls the delivery out of the intake area. The equipment enclosure stays shut. The airflow streaks strengthen as the obstruction moves away.', 'External intake cleared · airflow returning', [['Physical action', 'Move loaded trolley'], ['Equipment enclosure', 'Remains closed'], ['Airflow', 'Visible recovery']]),
    beat('Watch the trend before closing the task.', 'Temperature starts falling only after the intake clears. The final example remains at 24.2 °C, above the 22.5 °C target. The technician keeps the follow-up open instead of declaring an immediate repair.', 'Improving trend · target not yet reached', [['Zone', '24.2 °C · illustrative'], ['Target', '22.5 °C'], ['Follow-up', 'Continue monitoring']]),
  ],
  cooler: [
    beat('The customer leaves the door ajar.', 'A customer opens the cooler by its handle and walks away before closing it. Cold-air streaks escape through the opening while the second cabinet stays shut.', 'Door left ajar · cold air escaping', [['Physical cause', 'Open cooler door'], ['Baseline air', '3.2 °C · illustrative'], ['Other cabinet', 'Remains closed']]),
    beat('The console connects the door and temperature.', 'The operator sees an open-door report beside a temperature trace climbing toward 7.4 °C. They review the condition at the rack console, then walk to the cabinet to check it.', 'Door condition reviewed · technician dispatched', [['Door', 'Still open'], ['Air temperature', 'Rising'], ['Inspection', 'Affected cabinet']]),
    beat('Grip the handle and close the door.', 'The technician reaches the actual handle and rotates the hinged door shut. The air-loss effect subsides with the closing gap. Closing the door does not instantly restore the cabinet temperature.', 'Door closed · recovery still pending', [['Physical action', 'Close the hinged door'], ['Cold-air loss', 'Stops'], ['Temperature', 'Has not reset']]),
    beat('Keep checking the recovering temperature.', 'After a delay, the example air temperature falls toward 4.8 °C. It has not reached its 3.2 °C target. Stock condition has not been assessed; staff must continue their handling and monitoring procedure.', 'Improving air trend · stock assessment still required', [['Air temperature', '4.8 °C · illustrative'], ['Target', '3.2 °C'], ['Stock condition', 'Not assessed']]),
  ],
  energy: [
    beat('Closing time leaves unnecessary loads running.', 'The sales area is empty, but its display is bright, selected lights are at full output and HVAC still follows the daytime setting. The example meter reads 9.4 kW.', 'Unoccupied area · daytime demand continues', [['Display & selected lights', 'On'], ['HVAC setting', '22 °C'], ['Demand', '9.4 kW · illustrative']]),
    beat('Compare the loads before changing the plan.', 'The operator checks the circuit trend at the physical console, identifies the selected nonessential loads and walks to inspect the area. Coolers, networking and the walkway light are excluded from the proposed adjustment.', 'Selected loads reviewed · essentials retained', [['Review', 'Circuit and load context'], ['Selected area', 'Unoccupied sales floor'], ['Protected loads', 'Coolers · network · walkway']]),
    beat('Request the closing plan and watch the room respond.', 'On the tablet, the operator requests an illustrative display-off, lighting reduction and 26 °C HVAC setting. The display darkens, selected lights smoothly dim and the fan slows. These proposed controls send no live commands.', 'Illustrative adjustment · visible load response', [['Display', 'Switches off'], ['Selected lighting', 'Dims to 20%'], ['HVAC', 'Fan load reduces']]),
    beat('Verify the lower demand with the essentials still on.', 'The example meter gradually settles at 4.63 kW rather than changing instantly. Cooler operation, networking and the separate walkway illumination remain visible. The operator keeps monitoring before treating the change as sustained savings.', 'Demand reduced · continued verification needed', [['Demand', '4.63 kW · illustrative'], ['Essentials', 'Remain powered'], ['Next step', 'Verify sustained performance']]),
  ],
};

const VIDEO: Record<string, Story> = {
  'man-down': [
    beat('A customer walks through the aisle.', 'The customer moves along the sales floor while a member of staff works nearby. A camera covers the shared aisle.', 'Routine activity in the monitored aisle', [['Customer', 'Walking through the aisle'], ['Camera', 'Covers the area'], ['Nearby staff', 'Working elsewhere']]),
    beat('The customer falls out of direct view.', 'The customer falls to the floor between the store fixtures. Nearby staff continue their tasks and may not immediately see what has happened.', 'Person down · assistance needed', [['Person', 'On the floor'], ['Nearby staff', 'Not yet alerted'], ['Location', 'Monitored aisle']]),
    beat('The operator verifies the man-down alert.', 'Edge video analysis highlights the person on the floor. The operator checks the event and calls the nearby colleague to assist.', 'Possible man-down verified for response', [['Detection', 'Possible man-down'], ['Operator', 'Reviews the event'], ['Response', 'Colleague called']]),
    beat('A colleague arrives to help.', 'The nearby colleague reaches the person and starts the site’s assistance procedure. The operator retains the incident context while help is coordinated.', 'Colleague assisting in the aisle', [['Responder', 'At the affected person'], ['Operator', 'Coordinates assistance'], ['Incident', 'Remains visible']]),
  ],
  intruder: [
    beat('A person approaches the staff-only area.', 'The camera covers the boundary between the public space and the back office. A staff member is available to check access when needed.', 'Staff-only boundary monitored', [['Person', 'In the public area'], ['Boundary', 'Restricted access'], ['Camera', 'Covers the entry']]),
    beat('The person crosses the restricted boundary.', 'The person moves into the staff-only area. The operator needs to check whether the entry is authorized before deciding the response.', 'Restricted-zone entry detected', [['Person', 'Inside the restricted zone'], ['Authorization', 'Needs verification'], ['Location', 'Back-office boundary']]),
    beat('Give the operator the location and event.', 'The camera event highlights the crossing and the person involved. The operator reviews the entry and asks a staff member to check access.', 'Entry event sent for access verification', [['Edge analysis', 'Boundary crossing'], ['Operator', 'Checks the event'], ['Staff member', 'Sent to the boundary']]),
    beat('A staff member checks the entry.', 'The staff member approaches and verifies the person’s authorization. The operator follows the site procedure with the location and event still visible.', 'Staff member verifying access', [['Staff member', 'At the restricted area'], ['Access', 'Authorization check'], ['Operator', 'Follows site procedure']]),
  ],
  crowd: [
    beat('Customers form a checkout queue.', 'A small group waits while the cashier serves the next customer. Other shoppers can still move along the aisle.', 'Checkout queue moving normally', [['Cashier', 'Serving customers'], ['Queue', 'Contained near checkout'], ['Aisle', 'Available for movement']]),
    beat('The queue starts blocking the aisle.', 'More customers gather and the waiting group extends into the shared space. Other shoppers have less room to pass.', 'Crowd build-up restricts the aisle', [['Queue', 'Growing into the aisle'], ['Shoppers', 'Movement constrained'], ['Staff', 'Needs congestion context']]),
    beat('Show staff where the congestion is building.', 'Crowd monitoring highlights the concentrated group and affected aisle. The operator asks a colleague to help manage the flow.', 'Crowd concentration highlighted for staff', [['Monitoring', 'Affected area highlighted'], ['Operator', 'Reviews congestion'], ['Colleague', 'Moves to assist']]),
    beat('Staff open space and guide the queue.', 'The colleague helps customers move into a clearer queue while checkout continues. The shared aisle opens up and the operator keeps monitoring the area.', 'Customer flow improves around the aisle', [['Colleague', 'Guides the queue'], ['Aisle', 'Clearer route through'], ['Checkout', 'Continues serving']]),
  ],
};

const STORIES: Record<OfferingId, Record<string, Story>> = {
  failover: FAILOVER, routing: ROUTING, twin: TWIN,
  eagle: Object.fromEntries(Object.keys(MONITORING).map(id => [id, monitoringStory(id)])),
  automation: AUTOMATION, smart: SMART, video: VIDEO,
};

/** One shared 24-unit clock, played over the chapter's chosen duration. */
export function getOfferingStory(chapter: OfferingChapter, variant: OfferingVariant): Story {
  return STORIES[chapter.id][variant.id] ?? STORIES[chapter.id][chapter.variants[0].id];
}
