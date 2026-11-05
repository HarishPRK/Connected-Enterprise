import type { OfferingChapter, OfferingId, OfferingVariant } from './offeringCatalog';

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
  payment: [
    beat('A customer is ready to pay.', 'The cashier prepares a sale and the customer presents their card. A camera archive runs in the background. This illustrated shift starts with both fiber and 5G online; no connection fails.', 'Checkout ready · both links online', [['Customer', 'Card ready'], ['Camera archive', 'Uploading on fiber'], ['Scenario', 'Illustrative measurements']]),
    beat('The upload makes the customer wait.', 'The archive reaches 28 Mb/s and loads the fiber uplink. Checkout holds the new authorization before submission. Current example measurements show 96 ms round-trip delay on fiber and 32 ms on 5G, with no packet loss on either path.', 'Payment held before submission', [['Fiber', '96 ms RTT · 18 ms jitter'], ['5G', '32 ms RTT · 4 ms jitter'], ['Authorization', 'Not sent yet']]),
    beat('Choose a path for the new request.', 'The business application policy selects the currently lower-latency 5G path. The archive stays on fiber, with its uploader limited to 12 Mb/s. Checkout sends one authorization, receives approval and prints the receipt.', 'Application policy selected · both links online', [['Payment', 'One authorization on 5G'], ['Archive', 'Fiber · uploader cap 12 Mb/s'], ['Online order', 'Accepted on 5G']]),
    beat('The receipt prints. The line moves.', 'The customer collects the receipt and leaves. The next shopper steps forward, the online order is accepted and footage continues uploading on fiber. Both links remain online; this route choice reflects the example measurements, not a permanent preference for cellular.', 'Sale completed · background upload continues', [['Customer', 'Receipt collected'], ['Queue', 'Next shopper served'], ['Archive', 'Fiber retained']]),
  ],
  orders: [
    beat('A new order is waiting to reach the store.', 'At the service desk, the order application prepares its next request. Nearby, a customer is ready to pay and the camera server begins an archive upload. These are three applications sharing the same gateway.', 'New order ready · checkout in progress', [['Order service', 'Request ready'], ['Checkout', 'Customer at the reader'], ['Uplinks', 'Both online']]),
    beat('The order request joins the queue.', 'Bulk footage loads the shared fiber route. The new order request waits alongside checkout. The illustrated path samples show more delay and jitter on fiber than on the available 5G link; neither uplink has disconnected.', 'Business requests wait behind bulk traffic', [['Fiber', '96 ms RTT · 18 ms jitter'], ['5G', '32 ms RTT · 4 ms jitter'], ['Online order', 'Waiting to send']]),
    beat('Give business requests their selected path.', 'The policy selects 5G for new payment and order requests under these measured conditions. The order request is sent and accepted. The archive keeps fiber and reduces its upload rate at the source.', 'Business application policy selected', [['Order service', 'Accepted over 5G'], ['Checkout', 'One approved authorization'], ['Archive uploader', '12 Mb/s on fiber']]),
    beat('Staff have the order. Checkout keeps moving.', 'The service desk shows the accepted online order while the cashier hands over the receipt and calls the next customer. The archive continues on its own route; customer-facing work and background work both progress.', 'Order received · next customer served', [['Online order', 'Accepted'], ['Checkout', 'Receipt collected'], ['Both links', 'Remain online']]),
  ],
  archive: [
    beat('The cameras record locally and upload an archive.', 'Camera feeds reach the local analytics server, which starts an upstream footage upload. Recording and local analysis continue independently of the upload. A customer arrives at checkout during the same shift.', 'Local recording active · archive on fiber', [['Camera feeds', 'Local recording continues'], ['Archive', 'Fiber uplink'], ['Checkout', 'Customer ready to pay']]),
    beat('The archive fills most of the available path.', 'The illustrated upload reaches 28 Mb/s and fiber utilization rises to 94%. New business requests wait before they are sent. Both links are online, but current round-trip delay is 96 ms on fiber versus 32 ms on 5G.', 'Bulk upload competes with business requests', [['Archive upload', '28 Mb/s'], ['Fiber utilization', '94%'], ['Links', 'Both online · no packet loss']]),
    beat('Keep the archive on fiber, at a managed rate.', 'The archive uploader applies its illustrative 12 Mb/s cap while the gateway selects 5G for new business requests. The cap belongs to the uploader, separate from the application routing policy. Local recording and analysis continue.', 'Archive capped at source · business requests on 5G', [['Archive uploader', '12 Mb/s cap'], ['Archive route', 'Fiber retained'], ['Business requests', '5G selected by current quality']]),
    beat('The footage uploads and the store keeps serving.', 'The archive continues at its managed rate while the sale completes and the online order is accepted. No footage is discarded and neither link is marked failed. The store has separated application needs without interrupting local recording.', 'Recording continues · sale and order completed', [['Local recording', 'Still active'], ['Archive upload', '12 Mb/s on fiber'], ['Customer-facing work', 'Payment and order accepted']]),
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

interface MonitoringCase {
  setting: string;
  baseline: string;
  incident: string;
  impact: string;
  response: string;
  outcome: string;
  asset: string;
  signal: string;
  task: string;
}
const MONITORING: Record<string, MonitoringCase> = {
  gateway: { setting: 'The store responds normally.', baseline: 'The cashier requests a price and stock lookup. Its illustrative response is 0.18 seconds. The rack-mounted EA:GLE console shows hardware MSE below the learned threshold and a normal detector reason.', incident: 'Checkout and stock responses slow together.', impact: 'The lookup grows to 2.8 seconds and the customer waits. In this scripted example, hardware MSE rises to 1.48 against a learned threshold of 1.122. A separate received flag confirms the window and reason code 2 reports Memory Pressure.', response: 'The operator walks to the physical EA:GLE console, selects the flagged window and compares the MSE trace with the threshold, Memory Pressure reason and TCP/UDP connection counts. The evidence supports inspecting the shared CPE; it is not proof of a repair.', outcome: 'The operator leaves the console and checks the CPE with the memory and connection evidence in hand. The slow response and detector flag remain visible while the underlying condition is investigated.', asset: 'Shared CPE', signal: 'Price response: 0.18 → 2.8 s', task: 'Inspect CPE memory and load' },
  fiber: { setting: 'An upstream lookup returns promptly.', baseline: 'The cashier requests a price through the wired uplink. The illustrated response is 0.18 seconds, and EA:GLE shows normal hardware detector output.', incident: 'The upstream lookup takes 2.2 seconds.', impact: 'The cashier and customer wait longer for the result. The hardware trace remains below its learned threshold with flag 0 and reason Normal. The separate interface response check needs a fiber investigation.', response: 'The operator walks to the EA:GLE console and checks the unflagged MSE trace and protocol connection counts. The operator compares that evidence with the slow interface check before choosing the fiber terminal for physical inspection.', outcome: 'The operator leaves the screen and checks the fiber terminal and uplink connection. Hardware evidence and the interface symptom remain separate; the issue stays open until the physical and network checks establish its cause.', asset: 'Fiber terminal', signal: 'Price response: 0.18 → 2.2 s', task: 'Inspect fiber terminal and uplink' },
  '5g': { setting: 'The cellular health probe responds.', baseline: 'A routine diagnostic probe checks the alternate cellular path while checkout continues over fiber. The example probe returns in 0.18 seconds and hardware MSE is within threshold.', incident: 'The cellular probe becomes slow.', impact: 'The 5G check stretches to 2.4 seconds. This affects the alternate path check, not an invented payment outage on working fiber. EA:GLE still shows hardware flag 0 and reason Normal.', response: 'The operator walks to the rack console, reviews the MSE trace and connection counts, and compares the normal hardware result with the delayed cellular probe. The next check is registration and signal at the cellular interface.', outcome: 'The operator walks to the cellular equipment and inspects the interface. Fiber trading remains available; cellular readiness is still under review. The story does not declare the probe repaired.', asset: 'Cellular interface', signal: '5G probe: 0.18 → 2.4 s', task: 'Check cellular registration and signal' },
  it: { setting: 'The inventory service answers checkout.', baseline: 'A price and stock request reaches the local inventory service in 0.18 seconds. The same rack carries the physical diagnostic console, which remains available for local investigation.', incident: 'The price lookup holds up the customer.', impact: 'The local lookup grows to 2.6 seconds. Hardware MSE remains below the learned threshold, so the delay alone does not establish a gateway hardware fault.', response: 'The operator opens the relevant window on the EA:GLE console, checks the Normal reason and protocol connection counts, and compares them with the slow inventory service response. The local server and its LAN port become the next physical check.', outcome: 'The operator moves from the console to the rack service connection and inspects the inventory server and LAN port. The delayed lookup remains under investigation; no automatic recovery is claimed.', asset: 'Inventory server', signal: 'Price response: 0.18 → 2.6 s', task: 'Check inventory service and LAN port' },
  ot: { setting: 'The climate sensor reports promptly.', baseline: 'A climate report reaches the store in an illustrative 0.18 seconds. The sensor and local gateway provide separate device and hardware evidence.', incident: 'Fresh climate reports arrive late.', impact: 'The report delay rises to 3.2 seconds while staff wait for a fresh reading. Hardware MSE stays below threshold and the detector does not flag a gateway anomaly.', response: 'The operator reviews the EA:GLE trace, Normal reason and connection counts at the rack console, then compares those results with the late sensor reports. The next check is sensor power and communication, rather than assuming the HVAC itself has failed.', outcome: 'The operator walks across the store to inspect the sensor beside the climate equipment. The communication condition remains open while power and connection checks continue.', asset: 'Climate sensor', signal: 'Report delay: 0.18 → 3.2 s', task: 'Check sensor power and communication' },
};
function monitoringStory(id: string): Story {
  const item = MONITORING[id] ?? MONITORING.gateway;
  return [
    beat(item.setting, item.baseline, 'Normal responses · hardware within threshold', [['Response baseline', '0.18 seconds'], ['Monitoring focus', item.asset], ['Context', 'Illustrative detector samples']]),
    beat(item.incident, item.impact, `${item.asset} response needs investigation`, [['Visible symptom', item.signal], ['Affected asset', item.asset], ['Next step', 'Review diagnostic evidence']]),
    beat('The operator checks the EA:GLE console.', item.response, 'Operator reviews detector and connection evidence', [['Hardware trace', 'MSE vs learned threshold'], ['Detector output', id === 'gateway' ? 'Flag 1 · Memory Pressure' : 'Flag 0 · Normal'], ['Connection tracking', 'TCP · UDP · ICMP · Other']]),
    beat('Follow the evidence to the physical device.', item.outcome, 'Physical inspection · investigation remains open', [['Next check', item.task], ['Operator', 'Inspecting the affected device'], ['Condition', 'Unresolved']]),
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
    beat('Customers shop while HVAC conditions the space.', 'The unit runs in the background as a colleague works on the sales floor. Temperature, vibration and power provide context for its operating condition.', 'HVAC serving the occupied store', [['Customers', 'Shopping'], ['HVAC', 'Operating'], ['Condition inputs', 'Temperature · vibration · power']]),
    beat('The HVAC pattern begins to change.', 'The unit develops an unusual operating pattern while the store still appears normal. The colleague has no visible reason yet to call maintenance.', 'HVAC condition change needs attention', [['Equipment', 'Operating deviation'], ['Sales floor', 'Still in use'], ['Maintenance', 'Needs a focused signal']]),
    beat('Give maintenance a reason to inspect.', 'Edge analysis flags the changed condition and identifies the HVAC unit. The operator sends the technician the equipment context and an inspection task.', 'HVAC condition flagged for maintenance', [['Analysis', 'Pattern deviation'], ['Affected equipment', 'HVAC unit'], ['Task', 'Inspect the condition']]),
    beat('The technician reaches the unit with context.', 'The technician inspects the HVAC while the team reviews its operating history. The condition remains open until the cause and appropriate maintenance action are verified.', 'Technician at HVAC · investigation continues', [['Technician', 'Inspecting HVAC'], ['Condition', 'Under review'], ['Next decision', 'Maintenance action']]),
  ],
  cooler: [
    beat('A colleague stocks the chilled section.', 'Customers browse nearby while the cooler holds the store’s chilled goods. Temperature, door activity and compressor behavior describe its operating context.', 'Cooler serving the chilled section', [['Colleague', 'Stocking chilled goods'], ['Cooler', 'Operating'], ['Context', 'Temperature · door · compressor']]),
    beat('The cooler temperature starts to drift.', 'A temperature deviation develops while shopping continues. The team needs to investigate before the condition affects the chilled stock.', 'Cooler deviation puts stock at risk', [['Temperature', 'Drifting from its pattern'], ['Stock', 'Needs attention'], ['Cause', 'To be verified']]),
    beat('Connect the alert to the right cooler.', 'The edge view associates the deviation with this cooler. The operator gives the colleague and technician a focused check of temperature, door activity and compressor condition.', 'Cooler maintenance task raised', [['Equipment', 'Affected cooler'], ['Team', 'Checks operating context'], ['Maintenance', 'Inspect the deviation']]),
    beat('The team checks the cooler and protects the stock.', 'The technician inspects the cooler while store staff review the chilled goods and follow their handling procedure. Recovery remains to be verified.', 'Cooler inspection in progress', [['Technician', 'At the cooler'], ['Store colleague', 'Checks the stock'], ['Recovery', 'To be verified']]),
  ],
  energy: [
    beat('The store reaches closing time.', 'The final colleague finishes work while lighting and HVAC serve the occupied space. The meter relates that demand to the equipment still operating.', 'Closing time · equipment still running', [['Colleague', 'Finishing the shift'], ['Lighting & HVAC', 'Operating'], ['Meter', 'Consumption context']]),
    beat('The store is empty but demand continues.', 'The colleague leaves and the space becomes vacant. The lights and HVAC continue running beyond the store’s current needs.', 'After-hours loads need review', [['Occupancy', 'Store vacant'], ['Lighting & HVAC', 'Still running'], ['Demand context', 'Mismatch with occupancy']]),
    beat('Show the manager where the demand comes from.', 'The energy view connects the meter to the equipment and occupancy state. The manager can identify which schedules or setpoints need review.', 'Equipment demand linked to the empty space', [['Analysis', 'Operating-context mismatch'], ['Review', 'Schedules & setpoints'], ['Owner', 'Store manager']]),
    beat('Plan the adjustment and verify its effect.', 'The manager reviews the after-hours equipment plan with the team. An efficiency action is prepared for approval, with metering available to verify the result afterward.', 'Efficiency action prepared for review', [['Manager', 'Reviews equipment use'], ['Action', 'Schedule or setpoint change'], ['Verification', 'Monitor after adjustment']]),
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

/** One shared 24-second story: setting, incident, edge response, visible outcome. */
export function getOfferingStory(chapter: OfferingChapter, variant: OfferingVariant): Story {
  return STORIES[chapter.id][variant.id] ?? STORIES[chapter.id][chapter.variants[0].id];
}
