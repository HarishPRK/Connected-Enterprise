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
  voice: [
    beat('The morning delivery needs confirming.', 'A colleague calls the supplier at the service desk. The cameras begin archiving footage while the inventory server sends its stock update. Both fiber and 5G are healthy.', 'Supplier call in progress', [['Supplier call', 'Fiber'], ['Camera archive', 'Fiber'], ['Stock sync', 'Fiber']]),
    beat('The upload competes with the conversation.', 'The bulk transfers build a queue on fiber. The colleague asks the supplier to repeat the delivery time. There is no link outage; the applications have different priorities.', 'Bulk traffic competes with voice', [['Voice', 'Delay-sensitive'], ['Camera archive', 'Bulk transfer'], ['Uplinks', 'Both healthy']]),
    beat('Three jobs get three deliberate decisions.', 'The gateway sends the voice class over 5G, keeps the camera archive on fiber and queues the stock sync for the next window. The camera follows both active uplinks.', 'Call on 5G; archive on fiber', [['Supplier call', '5G'], ['Camera archive', 'Fiber'], ['Stock sync', 'Queued']]),
    beat('Delivery confirmed. Background work continues.', 'The colleague confirms the delivery and lowers the phone. The archive continues on fiber and the stock sync resumes in its scheduled window. Both connections remain available.', 'Delivery confirmed', [['Supplier call', 'Conversation clear'], ['Camera archive', 'Fiber retained'], ['Stock sync', 'Syncing on fiber']]),
  ],
  stock: [
    beat('The stock update starts in the background.', 'The inventory server prepares the next stock update as a colleague calls the supplier and the cameras archive footage.', 'Three application classes share fiber', [['Stock sync', 'Background update'], ['Supplier call', 'In progress'], ['Camera archive', 'Uploading']]),
    beat('The inventory job can wait; the call cannot.', 'A bulk stock update competes with voice and video on the shared route. Fiber and 5G are both healthy, so application priority guides the decision.', 'Priorities differ across applications', [['Stock sync', 'Delay-tolerant'], ['Voice', 'Delay-sensitive'], ['Uplinks', 'Both healthy']]),
    beat('Queue the stock sync for its own window.', 'The gateway pauses the background transfer, places voice on 5G and retains the archive on fiber. The stock job stays queued without reporting a network fault.', 'Stock sync scheduled', [['Stock sync', 'Queued'], ['Supplier call', '5G'], ['Camera archive', 'Fiber']]),
    beat('The stock update gets its turn.', 'The scheduled transfer resumes over fiber while the supplier conversation finishes. Background work has a defined place alongside customer-facing activity.', 'Stock sync resumes on fiber', [['Stock sync', 'Syncing'], ['Supplier call', 'Delivery confirmed'], ['Camera archive', 'Still on fiber']]),
  ],
  video: [
    beat('Two camera feeds reach local analytics.', 'The Dell analytics server processes the feeds locally and begins an upstream archive transfer. A supplier call and stock update use the same gateway.', 'Camera archive begins', [['Camera feeds', 'Local analytics'], ['Archive', 'Fiber'], ['Supplier call', 'In progress']]),
    beat('A large archive competes with a live call.', 'Sustained footage uploads fill the shared route. The operator needs bandwidth for the archive and a responsive path for the supplier conversation.', 'Separate bandwidth and delay needs', [['Archive', 'Bandwidth-oriented'], ['Voice', 'Delay-sensitive'], ['Uplinks', 'Both healthy']]),
    beat('Retain fiber for the archive.', 'The camera archive keeps its fiber policy while the call moves to 5G. The stock sync waits for its scheduled window; local camera processing continues.', 'Archive on fiber; voice on 5G', [['Camera archive', 'Fiber'], ['Supplier call', '5G'], ['Stock sync', 'Queued']]),
    beat('The archive and the conversation both progress.', 'The colleague confirms the delivery while footage continues to the archive. The inventory transfer resumes in its window without changing the camera route.', 'Each application follows its own policy', [['Camera archive', 'Fiber retained'], ['Supplier call', 'Delivery confirmed'], ['Stock sync', 'Syncing on fiber']]),
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
  gateway: { setting: 'The store relies on one shared gateway.', baseline: 'The cashier, service desk and connected building equipment use the same CPE. A technician monitors the equipment room from the operations view.', incident: 'Several local responses slow together.', impact: 'An unusual hardware pattern appears at the shared CPE. Staff see delays in more than one place, so inspecting each endpoint separately would miss the common dependency.', response: 'EA:GLE connects the hardware event to the CPE and its dependent IT/OT connections. The operator directs the technician to the equipment room.', outcome: 'The technician approaches the shared gateway with the affected hardware context. The team investigates the resource or thermal condition before choosing an intervention.', asset: 'Shared CPE', signal: 'Hardware pattern', task: 'Inspect gateway hardware' },
  fiber: { setting: 'The service desk reaches upstream services.', baseline: 'A colleague checks a supplier order while the cashier continues serving. Their applications reach upstream systems through the store’s wired uplink.', incident: 'The supplier request cannot get through.', impact: 'The fiber segment degrades. The store needs to determine whether the problem belongs to the business endpoint or the upstream connection.', response: 'EA:GLE associates the connectivity event with the fiber segment and keeps the local devices visible. The operator directs the investigation to the wired uplink.', outcome: 'The technician checks the fiber terminal and uplink context. Staff have an identified network issue to track while the condition remains open.', asset: 'Fiber terminal', signal: 'Uplink degradation', task: 'Inspect fiber connection' },
  '5g': { setting: 'The cellular path stands behind the primary route.', baseline: 'Customers are being served while the operator checks that the branch’s alternate connection is available. The cellular interface has its own monitoring context.', incident: 'The cellular layer needs attention.', impact: 'The alternate path develops a signal or registration issue. The operator needs to separate this condition from a fiber problem or a disconnected endpoint.', response: 'EA:GLE highlights the cellular interface and its connection to the CPE. The technician receives the affected layer and the signal context together.', outcome: 'The technician checks the cellular interface and antenna connection. The unresolved backup issue stays visible while the team investigates.', asset: 'Cellular interface', signal: 'Registration & signal context', task: 'Inspect cellular connection' },
  it: { setting: 'A colleague looks up stock for a customer.', baseline: 'At the service desk, a colleague checks the local inventory service. The IT rack and its connection to the shared gateway support that lookup.', incident: 'The stock lookup stops responding.', impact: 'The IT rack loses its local connection while the colleague is helping the customer. The operator needs to separate this IT segment from the store’s still-visible upstream links.', response: 'EA:GLE connects the missing IT asset to its local segment and CPE relationship. The technician is directed to the equipment rack.', outcome: 'The technician reaches the IT rack and checks its local connection. The service-desk colleague can follow a specific support task while the connection remains under investigation.', asset: 'Local IT rack', signal: 'IT segment disconnected', task: 'Check rack & local link' },
  ot: { setting: 'The climate sensor sends its operating context.', baseline: 'Staff keep the shop comfortable while the OT sensor reports through the gateway. The HVAC equipment state and the sensor’s network connection provide different clues.', incident: 'The climate sensor stops reporting.', impact: 'The sensor’s connection is interrupted. Missing readings alone cannot tell staff whether the HVAC equipment or its communication path is at fault.', response: 'EA:GLE highlights the affected OT connection and its path to the CPE. The operator sends a technician to check the sensor and equipment together.', outcome: 'The technician checks the sensor connection beside the HVAC equipment. The team keeps the equipment and connectivity investigation linked until the cause is verified.', asset: 'Climate OT sensor', signal: 'OT connection interrupted', task: 'Check sensor & equipment' },
};
function monitoringStory(id: string): Story {
  const item = MONITORING[id] ?? MONITORING.gateway;
  return [
    beat(item.setting, item.baseline, 'Store operations in progress', [['Store team', 'Serving customers'], ['Monitoring focus', item.asset], ['Context', 'Shared IT + OT topology']]),
    beat(item.incident, item.impact, `${item.asset} needs investigation`, [['Event', item.signal], ['Affected asset', item.asset], ['Team', 'Needs fault context']]),
    beat('Send support to the right place.', item.response, 'Affected layer identified for the technician', [['EA:GLE', 'Correlates the connection'], ['Technician task', item.task], ['Other layers', 'Remain visible']]),
    beat('The technician investigates the affected asset.', item.outcome, 'Technician inspection · condition remains open', [['Technician', 'At the affected asset'], ['Next check', item.task], ['Condition', 'Under investigation']]),
  ];
}

const AUTOMATION: Record<string, Story> = {
  open: [
    beat('The opening team arrives.', 'A colleague enters the store before the first customers. Lights, access control and climate equipment are present, each with its own device state.', 'Opening team enters the store', [['Colleague', 'Arriving for the shift'], ['Lighting', 'Awaiting the routine'], ['Access & climate', 'Independent controls']]),
    beat('The space is not ready for customers yet.', 'The opening instruction needs to reach devices from different manufacturers and protocol families. Their shared location does not make them act together.', 'Opening routine needs coordinated device actions', [['Trigger', 'Opening instruction'], ['Devices', 'Different integrations'], ['Store', 'Preparing for customers']]),
    beat('One routine reaches the compatible devices.', 'The gateway applies the opening policy through supported adapters. Lighting turns on, access is released and the thermostat moves to its comfort setting.', 'Lighting, access and climate respond together', [['Gateway', 'Applies opening policy'], ['Adapters', 'Translate supported actions'], ['Device requests', 'Light · access · climate']]),
    beat('The first customer walks into a ready store.', 'The colleague can welcome the first customer into the lit space. Access and climate now reflect the same opening intent.', 'Store ready for the first customer', [['Lighting', 'On'], ['Access', 'Released'], ['Climate', 'Comfort setting']]),
  ],
  'after-hours': [
    beat('The closing colleague finishes the shift.', 'The last member of staff walks toward the exit. Lighting, access and climate still reflect the day’s independent operating states.', 'Final closing tasks in progress', [['Colleague', 'Preparing to leave'], ['Lighting', 'Still on'], ['Climate', 'Daytime setting']]),
    beat('The last person leaves. The loads stay on.', 'The store becomes vacant. The occupancy change needs a configured routine before the separate devices can coordinate a closing response.', 'Store vacant · closing response needed', [['Occupancy', 'No staff remaining'], ['Lighting', 'Running in an empty space'], ['Access & climate', 'Awaiting the routine']]),
    beat('Apply the after-hours policy across the devices.', 'The gateway uses occupancy context and compatible integrations to dim lighting, secure access and request the thermostat setback.', 'Closing routine reaches the connected devices', [['Policy', 'After-hours routine'], ['Lighting request', 'Dim'], ['Access & climate', 'Secure · set back']]),
    beat('The store settles into its after-hours state.', 'The lights dim as the colleague leaves. Access is secured and climate demand follows the setback, with each device contributing to the same closing routine.', 'Closing routine complete', [['Lighting', 'Dimmed'], ['Access', 'Secured'], ['Climate', 'Setback applied']]),
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
