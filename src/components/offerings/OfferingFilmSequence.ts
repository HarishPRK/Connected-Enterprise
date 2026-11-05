import { isCheckoutStory, sampleCheckout } from './OfferingCheckoutStory';
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
    voice: [
      ['A delivery to confirm', 'The supplier joins the call. Camera footage and stock data begin uploading.'],
      ['Could you repeat that?', 'Bulk transfers compete with the call. Both network links are healthy.'],
      ['A route for every job', 'Voice takes 5G. The archive keeps fiber. The stock sync waits its turn.'],
      ['Delivery confirmed', 'The colleague finishes the call while the scheduled stock update resumes.'],
    ],
    stock: [
      ['The stock update begins', 'The inventory server shares fiber with the supplier call and camera archive.'],
      ['Background work can wait', 'The stock transfer competes with a conversation that needs a prompt response.'],
      ['Schedule the stock sync', 'Queue inventory, retain the archive on fiber, and put voice on 5G.'],
      ['Now the stock job gets its turn', 'Inventory resumes on fiber. The delivery is confirmed.'],
    ],
    video: [
      ['The cameras reach local analytics', 'Two feeds enter the Dell analytics server. Footage begins its archive upload.'],
      ['The archive shares a busy path', 'A live supplier call and stock update compete with the upload.'],
      ['Keep the archive on fiber', 'The call takes 5G while the stock sync waits for its window.'],
      ['Keep recording. Keep working.', 'The archive continues, the delivery is confirmed, and inventory resumes.'],
    ],
  },
  twin: {
    assembled: [
      ['Open the gateway on the laptop', 'An operator investigates Checkout 01 connectivity using the Gemtek twin.'],
      ['The log names the interface: LAN 1', 'Select the error. The on-screen twin locates the exact socket.'],
      ['Check the port the twin identified', 'The operator walks to the gateway and reseats the LAN 1 connector.'],
      ['Verify the connection before closing the issue', 'Link stable. Checkout reachable. The operator confirms the result on the laptop.'],
    ],
    exploded: [
      ['The service session begins on the laptop', 'The operator opens the twin and its interface error log.'],
      ['Look inside the virtual port assembly', 'LAN 1 disconnects repeatedly. Only the on-screen twin is taken apart.'],
      ['Match the digital assembly to the physical socket', 'The gateway stays assembled while the operator checks and reseats its LAN 1 cable.'],
      ['The laptop confirms the repair', 'The link returns, passes its stability check, and reaches Checkout 01.'],
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
  if(context.offering==='video'&&time>=10.05&&time<13.05)return {chapter:'03 / LOCAL ANALYTICS',title:'The camera feeds arrive here',subtitle:'The Dell analytics server examines the footage and raises an event for operator review.'};
  if(context.offering==='twin'&&time>=15.4&&time<17)return {chapter:'03 / VERIFY THE REPAIR',title:'Test the link after reseating',subtitle:'The connector is back in place. Check link stability and checkout reachability.'};
  const phase = time >= 17 ? 3 : time >= 10 ? 2 : time >= 4 ? 1 : 0;
  if (isCheckoutStory(context)) {
    const payment = sampleCheckout(context,time);
    const beats: readonly [number,string,string][] = [
      [0,'One customer. One ordinary sale.','A shopper reaches checkout while the next customers join the queue.'],
      [1.25,'The cashier starts the payment','The basket is on the counter. The customer takes out a card.'],
      [2.95,'A card. A tap. A decision.','Watch the reader as the customer presents their card.'],
      [4,payment.delayed?'The payment meets an interruption':'The payment stays on fiber',payment.delayed?'The reader waits for a response. The purchase is not yet complete.':'The backup disappears, but the payment still has its working fiber path.'],
      [5.4,payment.delayed?'The pause becomes personal':'The sale is still moving',payment.delayed?'Cashier: “One moment. The payment is still waiting.”':'The customer receives approval while the gateway flags the missing backup.'],
      [8.35,context.offering==='routing'?'A payment needs its own path':'Behind the checkout',payment.delayed?'Follow the transaction from the counter to the shared edge gateway.':'The gateway keeps fiber active and flags the unavailable 5G backup.'],
      [10.05,payment.delayed?'The gateway selects 5G':'Keep the working connection',payment.delayed?'The payment gets an available path. The cashier can retry.':'Fiber carries the transaction. The missing backup still needs attention.'],
      [12.5,payment.delayed?'Back at the reader':'Back with the customer',payment.delayed?'The cashier retries over 5G. Watch for the terminal’s confirmation.':'The transaction is approved over fiber. The customer can collect their receipt.'],
      [13,'Approved. The sale can continue.','Cashier: “That’s gone through. Here’s your receipt.”'],
      [14.3,'The receipt is the payoff','Paper feeds from the printer. The customer collects it before leaving.'],
      [16.95,'The next customer steps forward','The shopper leaves with the basket and receipt. The queue moves again.'],
      [19.55,'The store keeps moving',payment.delayed?'A recovered connection becomes a completed sale and a shorter queue.':'Trading continues on fiber while the missing backup is investigated.'],
    ];
    const cue=[...beats].reverse().find(([start])=>time>=start)??beats[0];
    return {chapter:CHAPTERS[phase],title:cue[1],subtitle:cue[2]};
  }
  const variants = SEQUENCES[context.offering];
  const sequence = variants[context.variant] ?? Object.values(variants)[0];
  const [title, subtitle] = sequence[phase];
  return { chapter: CHAPTERS[phase], title, subtitle };
}
