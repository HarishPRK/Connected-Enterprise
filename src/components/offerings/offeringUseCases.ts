import type { OfferingChapter, OfferingId, OfferingVariant } from './offeringCatalog';

export interface OfferingUseCase {
  title: string;
  setting: string;
  stakes: string;
  trigger: string;
  outcome: string;
}

const CASES: Record<OfferingId, Record<string, OfferingUseCase>> = {
  failover: {
    fiber: { title: 'The payment that cannot wait', setting: 'Lunch rush · Checkout', stakes: 'A customer is ready to pay while the queue grows behind them.', trigger: 'The fiber connection drops during the card payment.', outcome: 'The cashier retries over 5G, prints the receipt and serves the next customer.' },
    '5g': { title: 'Keep trading when the backup disappears', setting: 'Busy afternoon · Checkout', stakes: 'The store needs to keep serving customers while it investigates lost redundancy.', trigger: 'The cellular backup disconnects while fiber still carries business traffic.', outcome: 'Checkout continues on fiber and the manager assigns the backup connection for review.' },
  },
  routing: {
    payment: { title: 'Let the next sale through', setting: 'Busy shift · Checkout payment', stakes: 'A customer has tapped their card, but checkout is holding the request while a large camera archive loads fiber.', trigger: 'Both uplinks are online. In this example, measured round-trip delay is 96 ms on fiber and 32 ms on 5G.', outcome: 'The policy selects 5G before one authorization is sent. Approval arrives, the receipt prints and the queue advances.' },
    orders: { title: 'Bring the next online order into the store', setting: 'The same shift · Order service', stakes: 'The service desk needs to receive a new online order while checkout and the camera archive share the gateway.', trigger: 'The order request queues behind the upload on fiber. The currently measured 5G path has less delay.', outcome: 'New order requests use the business application policy on 5G. The order is accepted while the cashier completes the sale.' },
    archive: { title: 'Keep recording without holding up checkout', setting: 'The same shift · Camera archive', stakes: 'Recorded footage still needs to upload while customer-facing applications remain responsive.', trigger: 'The illustrative archive upload reaches 28 Mb/s and loads fiber. Local recording continues and both uplinks stay online.', outcome: 'The archive retains fiber with a 12 Mb/s uploader cap. New payment and order requests use 5G under the current measured conditions.' },
  },
  twin: {
    assembled: { title: 'From an error log to the right physical port', setting: 'Service laptop · Gateway diagnostics', stakes: 'Checkout disconnects intermittently; the operator needs to identify and check the exact local connection.', trigger: 'The laptop log reports repeated link disconnects on LAN 1.', outcome: 'The twin identifies the socket, the operator reseats its connector and verifies checkout connectivity.' },
    exploded: { title: 'Locate the interface inside the digital assembly', setting: 'Service laptop · Exploded twin', stakes: 'The operator needs to connect a logged interface error to the gateway port assembly.', trigger: 'LAN 1 link errors appear in the laptop diagnostics.', outcome: 'The virtual assembly identifies LAN 1 while the physical gateway stays closed; its cable is reseated and verified.' },
  },
  eagle: {
    gateway: { title: 'Checkout slows. Check the shared gateway.', setting: 'Trading hours · EA:GLE investigation', stakes: 'A price lookup stretches from 0.18 to 2.8 seconds while the next customer waits.', trigger: 'The illustrative MSE crosses its learned threshold; the detector reports Memory Pressure and connection counts rise.', outcome: 'The operator checks the rack-mounted EA:GLE console, reviews the evidence and walks to inspect the CPE. The issue remains open.' },
    fiber: { title: 'A slow lookup is not automatically a hardware fault', setting: 'The same store · Fiber investigation', stakes: 'An upstream price lookup takes 2.2 seconds while the cashier waits for its response.', trigger: 'EA:GLE hardware readings remain within threshold. A separate interface check points the investigation toward the fiber uplink.', outcome: 'The operator compares the detector and connection counts, then walks to the fiber terminal to inspect the connection.' },
    '5g': { title: 'Check the slow cellular health probe', setting: 'The same store · Cellular investigation', stakes: 'The 5G health probe takes 2.4 seconds even though trading over fiber remains available.', trigger: 'The cellular check is delayed while EA:GLE hardware metrics show no confirmed anomaly.', outcome: 'The operator reviews the EA:GLE console, then checks the cellular interface and registration. The backup condition remains under review.' },
    it: { title: 'The price lookup waits on the local service', setting: 'The same store · Inventory service', stakes: 'The cashier waits 2.6 seconds for a price and stock response from the local inventory service.', trigger: 'Hardware MSE stays below threshold. The delayed service response and changed connection counts need a local investigation.', outcome: 'After checking EA:GLE, the operator moves to the rack service port and inspects the inventory server and LAN connection.' },
    ot: { title: 'Climate reports arrive late', setting: 'The same store · Sensor communication', stakes: 'A climate sensor report stretches from 0.18 to 3.2 seconds while staff wait for a fresh reading.', trigger: 'The report is delayed even though EA:GLE does not confirm a gateway hardware anomaly.', outcome: 'The operator reviews detector evidence and connection counts, then walks to the sensor to check its power and communication.' },
  },
  automation: {
    'after-hours': { title: 'Close the store. Confirm every load.', setting: 'Closing time · Illustrative automation', stakes: 'The display, desk lamp and sign use different integrations. The operator needs evidence that each selected load is off.', trigger: 'The operator requests closure. The proposed Zigbee presence check must clear and finish its compressed vacancy dwell before commands begin.', outcome: 'Matter over Wi-Fi, Matter over Thread and Shelly over MQTT each report their result. The sign circuit falls from an illustrative 120 W to 0 W; coolers, networking and walkway lighting stay powered.' },
    occupied: { title: 'Someone is still inside. Keep the lights on.', setting: 'Closing time · Presence condition', stakes: 'A closing request must not switch the selected loads while a colleague is still working inside.', trigger: 'The operator requests closure, but the proposed Zigbee presence input continues to report occupancy.', outcome: 'The console explains the hold. All three loads remain on, no device commands are sent, and the colleague can finish the task.' },
  },
  smart: {
    hvac: { title: 'Catch the HVAC change before comfort suffers', setting: 'Sales floor · Equipment condition', stakes: 'A changing HVAC pattern can affect customers and staff if it goes unnoticed.', trigger: 'The HVAC unit develops an unusual temperature, vibration or power pattern.', outcome: 'Maintenance receives the condition context and the technician inspects the unit.' },
    cooler: { title: 'Protect the chilled stock', setting: 'Chilled goods · Cooler condition', stakes: 'The store team needs to investigate a cooler deviation before it affects the stock.', trigger: 'Cooler temperature drifts while customers continue shopping.', outcome: 'The team checks the cooler, its door activity and compressor condition with a focused maintenance task.' },
    energy: { title: 'The store closes; the loads stay on', setting: 'After hours · Energy and equipment', stakes: 'Lighting and HVAC demand should match the needs of an empty store.', trigger: 'The energy view shows equipment still running after the space becomes vacant.', outcome: 'The manager reviews the equipment schedule and setpoints, then plans and verifies the efficiency adjustment.' },
  },
  video: {
    'man-down': { title: 'A customer needs help in the aisle', setting: 'Sales floor · Man-down detection', stakes: 'The team needs a timely signal when someone falls out of direct staff view.', trigger: 'A customer falls in the camera-monitored aisle.', outcome: 'An operator verifies the event and a nearby colleague arrives to assist.' },
    intruder: { title: 'Someone crosses into the staff-only area', setting: 'Back office · Restricted boundary', stakes: 'The operator needs location context before deciding whether an entry is authorized.', trigger: 'A person crosses the marked boundary into the restricted area.', outcome: 'The operator reviews the event and a staff member checks the person’s authorization.' },
    crowd: { title: 'The queue starts blocking the aisle', setting: 'Checkout · Crowd monitoring', stakes: 'Customers need space to reach the checkout and move through the store.', trigger: 'The waiting group grows into the shared aisle.', outcome: 'Staff review the congestion, open space and guide customers into a clearer flow.' },
  },
};

export function getOfferingUseCase(chapter: OfferingChapter, variant: OfferingVariant): OfferingUseCase {
  return CASES[chapter.id][variant.id] ?? CASES[chapter.id][chapter.variants[0].id];
}
