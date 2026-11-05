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
    voice: { title: 'Confirm the delivery while the archive uploads', setting: 'Service desk · Supplier call', stakes: 'The colleague needs a clear conversation while camera footage and stock updates share the network.', trigger: 'Bulk uploads compete with the live call on an otherwise healthy fiber connection.', outcome: 'Voice uses 5G, the archive stays on fiber and the stock sync gets a scheduled window.' },
    stock: { title: 'Give the stock sync its own window', setting: 'Inventory server · Background transfer', stakes: 'A stock update must progress without competing with a time-sensitive supplier conversation.', trigger: 'Inventory and camera uploads enter the shared route while the call is active.', outcome: 'The stock sync queues, then resumes on fiber while voice uses its separate 5G policy.' },
    video: { title: 'Archive the footage while the store stays responsive', setting: 'Local analytics · Camera archive', stakes: 'The archive needs sustained bandwidth while the colleague confirms the next delivery.', trigger: 'The camera archive competes with a live call and a background inventory transfer.', outcome: 'The archive retains fiber, voice moves to 5G and the stock sync is scheduled.' },
  },
  twin: {
    assembled: { title: 'From an error log to the right physical port', setting: 'Service laptop · Gateway diagnostics', stakes: 'Checkout disconnects intermittently; the operator needs to identify and check the exact local connection.', trigger: 'The laptop log reports repeated link disconnects on LAN 1.', outcome: 'The twin identifies the socket, the operator reseats its connector and verifies checkout connectivity.' },
    exploded: { title: 'Locate the interface inside the digital assembly', setting: 'Service laptop · Exploded twin', stakes: 'The operator needs to connect a logged interface error to the gateway port assembly.', trigger: 'LAN 1 link errors appear in the laptop diagnostics.', outcome: 'The virtual assembly identifies LAN 1 while the physical gateway stays closed; its cable is reseated and verified.' },
  },
  eagle: {
    gateway: { title: 'Several devices slow down at once', setting: 'Trading hours · Shared edge gateway', stakes: 'Checkout and connected equipment depend on the same CPE.', trigger: 'An unusual gateway hardware pattern coincides with delayed local responses.', outcome: 'The operator sends the technician to the shared gateway with hardware context.' },
    fiber: { title: 'Find the cause beyond the checkout terminal', setting: 'Service desk · Upstream connectivity', stakes: 'The team needs to separate an uplink problem from a failed business endpoint.', trigger: 'A fiber degradation interrupts access to upstream services.', outcome: 'The operator traces the issue to the wired segment and directs the network investigation.' },
    '5g': { title: 'Find out why the alternate path is weak', setting: 'Equipment room · Cellular monitoring', stakes: 'The branch needs a dependable alternate connection when its primary link changes.', trigger: 'The cellular layer shows degraded registration or signal context.', outcome: 'The technician checks the cellular interface and antenna connection with the affected layer identified.' },
    it: { title: 'The stock lookup stops responding', setting: 'Service desk · Local IT equipment', stakes: 'A colleague needs the local inventory service while helping a customer.', trigger: 'The IT rack loses its local connection while upstream network layers remain visible.', outcome: 'The technician checks the IT rack and its connection using the shared topology.' },
    ot: { title: 'The climate sensor stops reporting', setting: 'Building services · OT connectivity', stakes: 'Staff need to know whether missing climate readings mean a connection issue or an equipment fault.', trigger: 'The OT sensor’s connection to the gateway is interrupted.', outcome: 'The technician checks the sensor connection beside the HVAC equipment before deciding the next action.' },
  },
  automation: {
    open: { title: 'Get the store ready for its first customer', setting: 'Opening time · Entrance and sales floor', stakes: 'Lighting, access and climate come from different devices but serve the same opening routine.', trigger: 'The opening team arrives and starts the configured routine.', outcome: 'Compatible integrations coordinate lighting, released access and a comfort climate setting.' },
    'after-hours': { title: 'The last colleague leaves', setting: 'Closing time · Empty store', stakes: 'Independent lights, access controls and climate equipment need one coordinated closing instruction.', trigger: 'The store becomes vacant after the last member of staff leaves.', outcome: 'The routine dims lighting, secures access and applies the climate setback.' },
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
