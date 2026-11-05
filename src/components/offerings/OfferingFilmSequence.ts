import type { StoryContext } from './OfferingStoryMotion';

export interface FilmCue { chapter: string; title: string; subtitle: string; }
type Shot = readonly [title: string, subtitle: string];
type Sequence = readonly [Shot, Shot, Shot, Shot];

// Short, observable actions accompany the film. Detailed operating context stays
// in the adjacent story panel; these captions never represent live telemetry.
const SEQUENCES: Record<StoryContext['offering'], Record<string, Sequence>> = {
  failover: {
    fiber: [
      ['The next sale begins', 'A customer reaches checkout. The cashier starts the payment.'],
      ['The payment cannot leave', 'Fiber drops. The customer waits, and the queue stops.'],
      ['Another way through', 'The gateway selects 5G. The cashier retries the payment.'],
      ['The store keeps moving', 'A receipt prints. The customer leaves, and the queue advances.'],
    ],
    '5g': [
      ['An ordinary afternoon sale', 'Fiber carries the payment. The cellular connection stands ready.'],
      ['The backup goes missing', '5G disconnects while the working fiber route stays available.'],
      ['Keep the working connection', 'The gateway retains fiber and flags the missing backup.'],
      ['Trading continues on fiber', 'The customer leaves with a receipt. Backup connectivity still needs investigation.'],
    ],
  },
  routing: {
    pos: [
      ['Three jobs share the network', 'A payment, a supplier call and camera footage reach the gateway.'],
      ['The customer is waiting', 'The payment needs its own route while other applications continue.'],
      ['Give payments their own path', 'The gateway sends the payment over its configured 5G route.'],
      ['One sale, separate decisions', 'The receipt prints. Voice and video retain their own routes.'],
    ],
    voice: [
      ['The supplier joins the call', 'A colleague arranges a delivery while the store keeps trading.'],
      ['The conversation breaks up', 'The call needs a route suited to its connection requirements.'],
      ['Move the call onto 5G', 'The gateway applies the voice policy. Other application paths remain separate.'],
      ['The conversation can continue', 'The colleague continues the supplier call on the selected connection.'],
    ],
    video: [
      ['Footage leaves the store', 'The camera transfers video while staff take calls and payments.'],
      ['The transfer needs a policy', 'Video needs an explicit route alongside the other store applications.'],
      ['Keep video on fiber', 'The gateway assigns footage to fiber without moving every application.'],
      ['Each application keeps its path', 'Video flows on fiber. Payments and calls retain separate routing decisions.'],
    ],
  },
  twin: {
    assembled: [
      ['Support joins the store colleague', 'A remote engineer and a colleague examine the same gateway.'],
      ['Which connection needs checking?', 'The colleague needs to locate the interface the engineer means.'],
      ['Find the physical interface', 'The shared CPE view connects the discussion to a specific port.'],
      ['Agree the next check', 'The colleague can now check the identified interface and cable.'],
    ],
    exploded: [
      ['A closer CPE inspection', 'A technician reviews the gateway before its thermal inspection.'],
      ['Look beneath the enclosure', 'The layers separate to reveal the board and thermal assembly.'],
      ['Follow the thermal assembly', 'The engineer identifies how the board, heatsink and enclosure fit together.'],
      ['The inspection has a focus', 'The technician has the relevant components identified for the next check.'],
    ],
  },
  eagle: {
    gateway: [
      ['One gateway supports the store', 'People and connected equipment depend on the shared edge CPE.'],
      ['Several connections need attention', 'A hardware condition appears at their common gateway.'],
      ['Trace the shared dependency', 'EA:GLE associates the affected connections with the gateway hardware.'],
      ['The technician checks the CPE', 'The investigation reaches the shared device. Its condition remains under review.'],
    ],
    fiber: [
      ['The store reaches upstream services', 'The wired connection carries requests beyond the branch.'],
      ['The wired path changes', 'Fiber degradation appears while the local devices remain visible.'],
      ['Follow the affected segment', 'EA:GLE directs the investigation to the wired uplink.'],
      ['Check the fiber connection', 'The technician reaches the terminal with the affected segment identified.'],
    ],
    '5g': [
      ['An alternate connection stands ready', 'The cellular interface provides another path for the branch.'],
      ['The cellular layer needs attention', 'A signal or registration condition appears on the alternate connection.'],
      ['Locate the cellular issue', 'EA:GLE separates the 5G condition from the other network layers.'],
      ['Inspect the alternate connection', 'The technician checks the cellular interface while the condition remains visible.'],
    ],
    it: [
      ['A colleague checks the stock', 'The local IT equipment supports the store’s inventory service.'],
      ['The local service stops responding', 'Its IT connection disappears while the wider network remains visible.'],
      ['Find the affected local equipment', 'EA:GLE connects the missing IT path to its gateway relationship.'],
      ['Check the rack and connection', 'The technician reaches the local equipment to investigate its connection.'],
    ],
    ot: [
      ['The climate sensor reports', 'The sensor beside the HVAC equipment communicates through the gateway.'],
      ['The readings stop arriving', 'The OT connection disappears. Missing readings need investigation.'],
      ['Follow the sensor connection', 'EA:GLE identifies the affected sensor and its path to the gateway.'],
      ['Check communication and equipment', 'The technician examines the sensor connection beside the HVAC unit.'],
    ],
  },
  automation: {
    open: [
      ['The opening colleague arrives', 'Lighting, access and climate devices await the store’s opening routine.'],
      ['Arrival starts the routine', 'The occupancy event reaches the shared edge gateway.'],
      ['One routine, different devices', 'Compatible integrations coordinate lighting, access and the climate setting.'],
      ['The store is ready', 'Lighting is on, access is released and comfort mode is requested.'],
    ],
    'after-hours': [
      ['The last colleague gets ready', 'The store’s independent devices still need a coordinated closing routine.'],
      ['The last colleague leaves', 'The space becomes vacant as the colleague exits through the entrance.'],
      ['One routine closes the store', 'The gateway coordinates lighting, access and climate through compatible integrations.'],
      ['Closed for the night', 'Lighting dims, access secures and climate demand follows the setback.'],
    ],
  },
  smart: {
    hvac: [
      ['Comfort depends on this unit', 'The HVAC equipment supports the working sales floor.'],
      ['The fan’s behaviour changes', 'An unusual condition appears before the team chooses an intervention.'],
      ['Bring the condition to maintenance', 'The gateway highlights the pattern and its equipment context.'],
      ['Inspection reaches the right unit', 'The technician approaches the HVAC unit. Investigation continues with context.'],
    ],
    cooler: [
      ['Chilled stock needs stable conditions', 'A customer visits the cooler while the store continues trading.'],
      ['The cooler needs attention', 'Temperature drifts. Door activity and compressor condition need checking.'],
      ['Direct attention to the stock', 'The gateway flags the cooler pattern for maintenance review.'],
      ['Inspect before choosing an intervention', 'The technician checks the cooler while its condition remains under review.'],
    ],
    energy: [
      ['Equipment follows the working day', 'Lighting and climate loads should match the needs of the space.'],
      ['The loads stay on', 'Equipment continues running when the store no longer needs those loads.'],
      ['Find the avoidable demand', 'The team reviews equipment use alongside the operating schedule.'],
      ['Prepare an efficiency adjustment', 'Review the schedule and setpoints, then verify the effect after changes.'],
    ],
  },
  video: {
    'man-down': [
      ['A customer crosses the aisle', 'The camera observes a shared walkway beyond the cashier’s direct view.'],
      ['A customer needs help', 'The person falls in the aisle while nearby staff are elsewhere.'],
      ['An alert brings a response', 'An operator reviews the event and calls a nearby colleague.'],
      ['A colleague reaches the customer', 'The colleague kneels beside the person to assist.'],
    ],
    intruder: [
      ['A boundary protects staff access', 'The camera watches the entrance to a staff-only area.'],
      ['Someone crosses the boundary', 'A person enters the marked area and remains visible to the camera.'],
      ['Review the entry in context', 'The operator checks the event before deciding whether access is authorized.'],
      ['Security checks the entry', 'A staff member approaches the person to verify their authorization.'],
    ],
    crowd: [
      ['The next shoppers arrive', 'People gather between the entrance and the checkout.'],
      ['The queue fills the aisle', 'The waiting group begins to occupy the shared walkway.'],
      ['Send help to the queue', 'The team reviews the congestion and a colleague approaches.'],
      ['People have room to move', 'The colleague redirects customers into a clearer flow through the aisle.'],
    ],
  },
};

const CHAPTERS = ['01 / The setting', '02 / The challenge', '03 / The response', '04 / The outcome'];

export function sampleFilmCue(context: StoryContext, time: number): FilmCue {
  const phase = time >= 17 ? 3 : time >= 10 ? 2 : time >= 4 ? 1 : 0;
  const variants = SEQUENCES[context.offering];
  const sequence = variants[context.variant] ?? Object.values(variants)[0];
  const [title, subtitle] = sequence[phase];
  return { chapter: CHAPTERS[phase], title, subtitle };
}
