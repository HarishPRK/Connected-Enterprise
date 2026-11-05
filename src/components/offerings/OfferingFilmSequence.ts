import { isCheckoutStory, sampleCheckout } from './OfferingCheckoutStory';
import { ROUTING_TIMING } from './OfferingRoutingStory';
import { EAGLE_TIMING, sampleEagle } from './OfferingEagleStory';
import { AUTOMATION_TIMING, sampleAutomation } from './OfferingAutomationStory';
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
    payment: [
      ['One customer. Three applications.', 'Checkout, online orders and the camera archive share the store gateway.'],
      ['The upload holds up the next sale', 'Checkout holds the new authorization before submission. Both uplinks remain online.'],
      ['Choose the path before sending', 'Current measurements select 5G for new business requests. The archive stays on fiber.'],
      ['The sale completes. The queue moves.', 'The shopper collects the receipt. The order is accepted and the archive keeps uploading.'],
    ],
    orders: [
      ['The next order is ready to arrive', 'The service desk prepares a new order request while a customer reaches checkout.'],
      ['The business requests wait', 'A bulk footage upload loads fiber. The new order and payment have not been sent yet.'],
      ['A business policy for both requests', '5G has less measured delay in this example. New order and payment requests use it.'],
      ['Order received. Customer served.', 'The service desk has the order. At checkout, the receipt prints and the queue advances.'],
    ],
    archive: [
      ['Record locally. Archive upstream.', 'The camera server records footage and uploads an archive over fiber.'],
      ['The archive loads the shared path', 'The illustrative upload reaches 28 Mb/s. Checkout and online orders wait before sending.'],
      ['Keep the archive on its own route', 'An uploader cap manages the footage transfer. New business requests take the selected 5G path.'],
      ['Keep recording. Keep serving.', 'The archive continues on fiber while the payment and online order complete.'],
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
      ['A price lookup returns promptly', 'The cashier gets the result in an illustrative 0.18 seconds.'],
      ['The next lookup takes 2.8 seconds', 'The customer waits while the hardware detector reports an unusual window.'],
      ['Read the evidence at the console', 'The operator compares MSE, the learned threshold, the received flag and connection counts.'],
      ['Inspect the CPE with context', 'Memory Pressure is a detector reason. The operator still needs to establish and address its cause.'],
    ],
    fiber: [
      ['Checkout reaches the upstream service', 'The price lookup starts with an illustrative 0.18-second response.'],
      ['The lookup now takes 2.2 seconds', 'The cashier waits while the separate interface check investigates fiber.'],
      ['Check the hardware evidence first', 'MSE remains below threshold. A slow interface does not itself establish a hardware anomaly.'],
      ['Inspect the fiber terminal', 'The operator checks the physical uplink. The delayed response remains under investigation.'],
    ],
    '5g': [
      ['A probe checks the cellular path', 'The alternate connection responds while checkout keeps using fiber.'],
      ['The cellular probe takes 2.4 seconds', '5G readiness needs a check. The working fiber checkout is still available.'],
      ['Separate the probe from the detector', 'The operator reviews normal hardware MSE alongside the delayed cellular check.'],
      ['Check the cellular interface', 'Registration and signal need physical investigation. No repair is declared.'],
    ],
    it: [
      ['The local service answers checkout', 'The inventory server returns a price and stock response in 0.18 seconds.'],
      ['The customer waits for the lookup', 'The local service now takes 2.6 seconds. The cashier is waiting for its result.'],
      ['Read the diagnostic window', 'The operator compares normal hardware MSE with connection counts and the slow local response.'],
      ['Check the server and its LAN port', 'The operator moves from the console to the service connection. Investigation continues.'],
    ],
    ot: [
      ['A climate report arrives promptly', 'The sensor reports through the gateway in an illustrative 0.18 seconds.'],
      ['The report takes 3.2 seconds', 'Staff wait for a fresh reading. Gateway hardware MSE remains within threshold.'],
      ['Compare the two kinds of evidence', 'The operator checks detector output and connection counts before choosing the sensor inspection.'],
      ['Check the sensor at its source', 'The operator inspects communication and power beside the climate equipment. The issue remains open.'],
    ],
  },
  automation: {
    'after-hours': [
      ['Close the store. Confirm every load.', 'An illustrative closing routine connects three selected loads through their own integrations.'],
      ['The closing request must wait', 'Presence keeps every command on hold until the colleague leaves and the vacancy check finishes.'],
      ['Three loads. Three confirmations.', 'Watch each device switch its load, acknowledge the request and report its state.'],
      ['The selected loads are off', 'Coolers, networking and the separate walkway light remain powered.'],
    ],
    occupied: [
      ['The colleague is still working', 'The display, desk lamp and sign are on while inventory is checked.'],
      ['Presence prevents the shutdown', 'The proposed Zigbee presence input reports occupancy. The vacancy condition is not satisfied.'],
      ['No commands leave the routine', 'Both Matter plugs and the Shelly relay retain their On state.'],
      ['Keeping the lights on is the result', 'The employee remains inside. Closure stays pending, with its reason visible on the console.'],
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
  if (context.offering === 'automation') {
    const state = sampleAutomation(context.variant, time);
    const sequence = context.variant === 'occupied' ? SEQUENCES.automation.occupied : SEQUENCES.automation['after-hours'];
    if (context.variant === 'occupied') {
      const cues: readonly [number, string, string][] = [
        [0, ...sequence[0]],
        [AUTOMATION_TIMING.closeRequested, 'Close requested. Someone is still inside.', 'The colleague submits the request on the tablet, then continues checking inventory.'],
        [5.5, ...sequence[1]],
        [AUTOMATION_TIMING.vacancyVerified, 'The vacancy condition has not cleared', 'The wall console explains the hold: presence is still reported, so all device commands are withheld.'],
        [AUTOMATION_TIMING.display.request, 'The Wi-Fi display stays on', 'No Matter Off command is sent to its plug.'],
        [AUTOMATION_TIMING.lamp.request, 'The Thread desk lamp stays on', 'Its Matter plug receives no Off command either.'],
        [AUTOMATION_TIMING.sign.request, 'The Shelly sign stays on too', `No Switch.Set command is sent. The illustrative sign circuit remains at ${state.devices.sign.watts.toFixed(0)} W.`],
        [AUTOMATION_TIMING.complete, '0 / 3 off. The routine is still held.', 'The colleague remains inside. The console keeps the occupancy reason visible instead of claiming completion.'],
      ];
      const cue = [...cues].reverse().find(([start]) => time >= start) ?? cues[0];
      return { chapter: time >= AUTOMATION_TIMING.closeRequested ? 'HELD / PRESENCE REPORTED' : CHAPTERS[0], title: cue[1], subtitle: cue[2] };
    }
    const cues: readonly [number, string, string][] = [
      [0, ...sequence[0]],
      [AUTOMATION_TIMING.closeRequested, 'The colleague requests closure', 'The request starts on the tablet. All three loads stay on while someone is still inside.'],
      [5.5, 'The presence check keeps the loads on', 'The illustrative Zigbee sensor reports occupancy through a proposed bridge. No load commands have been sent.'],
      [AUTOMATION_TIMING.employeeExit, 'The last colleague leaves', 'The employee passes through the staff door. The routine still waits for the vacancy check.'],
      [AUTOMATION_TIMING.doorClosed, 'Allow the vacancy check to finish', 'The door is closed and presence is clear. This demonstration compresses the vacancy dwell.'],
      [AUTOMATION_TIMING.vacancyVerified, 'Vacancy is verified in this example', 'The proposed presence rule releases the selected loads for switching.'],
      [AUTOMATION_TIMING.display.request, 'Send Off to the Wi-Fi plug', 'Matter carries the request through the Wi-Fi network. Watch the display light.'],
      [AUTOMATION_TIMING.display.ack, 'The Wi-Fi plug acknowledges', 'The request has a reply. The console still checks the observed switch state.'],
      [AUTOMATION_TIMING.display.observed, 'The display light is off', 'The Matter Wi-Fi plug reports Off. The first selected load is confirmed.'],
      [AUTOMATION_TIMING.lamp.request, 'Next, the Thread desk-lamp plug', 'Matter reaches this plug over Thread through the border router.'],
      [AUTOMATION_TIMING.lamp.ack, 'The Thread plug acknowledges', 'Its reply is separate from the Wi-Fi plug. Watch the lamp and its reported state.'],
      [AUTOMATION_TIMING.lamp.observed, 'The desk lamp is off', 'The Matter Thread plug reports Off. Two selected loads are confirmed.'],
      [AUTOMATION_TIMING.sign.request, 'Send Off to the Shelly relay', 'Switch.Set travels over MQTT and Wi-Fi. The illuminated sign has its own command and reply.'],
      [AUTOMATION_TIMING.sign.ack, 'The Shelly relay acknowledges', 'The command has a reply. Check the sign, switch state and circuit reading.'],
      [AUTOMATION_TIMING.sign.observed, 'The illuminated sign is off', 'The relay reports Off. Its circuit reading is settling before the final confirmation.'],
      [AUTOMATION_TIMING.sign.powerStart, 'Check the sign circuit as it settles', `Illustrative circuit reading: ${state.devices.sign.watts.toFixed(0)} W, falling from 120 W toward 0 W.`],
      [AUTOMATION_TIMING.sign.powerSettled, 'The sign circuit reads 0 W', 'The measured-power example agrees with the Off state. The console completes its checks.'],
      [AUTOMATION_TIMING.complete, `${state.confirmedCount} / ${state.total} selected loads confirmed off`, 'Display, desk lamp and sign are off. Coolers, networking and walkway lighting remain powered.'],
      [20, ...sequence[3]],
    ];
    const cue = [...cues].reverse().find(([start]) => time >= start) ?? cues[0];
    return { chapter: time >= AUTOMATION_TIMING.complete ? '04 / CONFIRMED' : CHAPTERS[phase], title: cue[1], subtitle: cue[2] };
  }
  if (context.offering === 'eagle') {
    const state = sampleEagle(context.variant, time);
    const sequence = SEQUENCES.eagle[context.variant] ?? SEQUENCES.eagle.gateway;
    const inspectionTime = context.variant === 'ot' ? EAGLE_TIMING.farInspect : EAGLE_TIMING.inspect;
    const cues: readonly [number, string, string][] = [
      [0, ...sequence[0]],
      [EAGLE_TIMING.symptom, `${state.endpointLabel} now takes ${(state.endpointDelayMs / 1000).toFixed(1)} seconds`, sequence[1][1]],
      [EAGLE_TIMING.approach, 'The operator goes to EA:GLE', 'Follow the operator to the diagnostic console mounted on the IT rack.'],
      [EAGLE_TIMING.review, 'Compare reconstruction error with the threshold', `Illustrative MSE ${state.anomalyMse.toFixed(3)}; learned threshold ${state.anomalyThreshold.toFixed(3)}. ${state.diagnosticStatus}.`],
      [EAGLE_TIMING.selectWindow, 'Read the detector flag and reason', `Flag ${state.anomalyFlag ? '1' : '0'} · code ${state.reasonCode}: ${state.reasonLabel}. The operator checks the selected window.`],
      [EAGLE_TIMING.connections, 'Compare the connection counts too', `${state.conntrack.total} tracked connections: TCP ${state.conntrack.tcp}, UDP ${state.conntrack.udp}, ICMP ${state.conntrack.icmp}, other ${state.conntrack.other}. Counts provide context, not a root-cause verdict.`],
      [12.5, 'Choose the next physical check', state.evidence],
      [EAGLE_TIMING.dispatch, `Follow up at the ${state.deviceLabel.toLowerCase()}`, 'The operator leaves the console with a specific inspection task. The delayed response is still present.'],
      [inspectionTime, ...sequence[3]],
      [22.5, 'Investigation stays open', 'The operator is inspecting the selected equipment. A diagnosis and repair still need verification.'],
    ];
    const cue = [...cues].reverse().find(([start]) => time >= start) ?? cues[0];
    return { chapter: CHAPTERS[phase], title: cue[1], subtitle: cue[2] };
  }
  if (context.offering === 'routing') {
    if (context.variant === 'orders' && time >= 17 && time < 19.4) {
      return { chapter: CHAPTERS[phase], title: 'The store has order #1042', subtitle: 'Accepted over the selected 5G path. Its fulfillment ticket is ready for picking.' };
    }
    const sequence = SEQUENCES.routing[context.variant] ?? SEQUENCES.routing.payment;
    const cues: readonly [number, string, string][] = [
      [0, ...sequence[0]],
      [1.25, 'A customer reaches the reader', 'The cashier prepares the sale while the other applications share the gateway.'],
      [2.95, 'The customer taps once', 'Checkout prepares a new authorization. The next shoppers wait behind the customer.'],
      [ROUTING_TIMING.congestion, ...sequence[1]],
      [5.4, 'Follow the bulk upload', 'Camera footage travels from the local server to its archive. Local recording continues.'],
      [8.35, 'Compare the paths that are available', 'Illustrative RTT: fiber 96 ms; 5G 32 ms. Both links are online with no packet loss.'],
      [ROUTING_TIMING.policy, ...sequence[2]],
      [11.1, 'Two routes. Different jobs.', 'The archive uploader limits itself to 12 Mb/s on fiber. New business requests are assigned to 5G.'],
      [ROUTING_TIMING.authorization, 'Send one authorization', 'The new payment request leaves on its selected 5G path.'],
      [ROUTING_TIMING.approval, 'Approved. The customer can finish.', 'Confirmation reaches the reader. The cashier prepares the receipt.'],
      [ROUTING_TIMING.orderAccepted, context.variant === 'orders' ? 'The online order is accepted too' : 'The business requests are through', 'The order is accepted over 5G while the archive continues on fiber.'],
      [ROUTING_TIMING.receipt, 'The receipt is the result', 'The printer feeds the receipt. The customer collects it before leaving.'],
      [ROUTING_TIMING.queueResumes, 'The next shopper steps forward', 'The sale is complete. The cashier can serve the next customer.'],
      [19.55, ...sequence[3]],
    ];
    const cue = [...cues].reverse().find(([start]) => time >= start) ?? cues[0];
    return { chapter: CHAPTERS[phase], title: cue[1], subtitle: cue[2] };
  }
  if (isCheckoutStory(context)) {
    const payment = sampleCheckout(context,time);
    const beats: readonly [number,string,string][] = [
      [0,'One customer. One ordinary sale.','A shopper reaches checkout while the next customers join the queue.'],
      [1.25,'The cashier starts the payment','The basket is on the counter. The customer takes out a card.'],
      [2.95,'A card. A tap. A decision.','Watch the reader as the customer presents their card.'],
      [4,payment.delayed?'The payment meets an interruption':'The payment stays on fiber',payment.delayed?'The reader waits for a response. The purchase is not yet complete.':'The backup disappears, but the payment still has its working fiber path.'],
      [5.4,payment.delayed?'The pause becomes personal':'The sale is still moving',payment.delayed?'Cashier: “One moment. The payment is still waiting.”':'The customer receives approval while the gateway flags the missing backup.'],
      [8.35,'Behind the checkout',payment.delayed?'Follow the transaction from the counter to the shared edge gateway.':'The gateway keeps fiber active and flags the unavailable 5G backup.'],
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
