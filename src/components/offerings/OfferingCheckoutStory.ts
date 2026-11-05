import type { StoryContext, StoryPoint } from './OfferingStoryMotion';
import { ROUTING_TIMING, sampleRouting } from './OfferingRoutingStory';

export type PaymentStage = 'ready' | 'reading' | 'waiting' | 'retrying' | 'approved' | 'receipt';
export const isCheckoutStory = ({ offering }: StoryContext) => offering === 'failover' || offering === 'routing';
const progress = (time: number, start: number, end: number) => {
  const value = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return value * value * (3 - 2 * value);
};

/** One clock controls the card, screen, route and editorial cuts, including seeks. */
export function sampleCheckout(context: StoryContext, time: number) {
  const t = Math.max(0, Math.min(24, time));
  const routing = context.offering === 'routing' ? sampleRouting(t) : null;
  const delayed = context.offering === 'failover' && context.variant === 'fiber';
  const focused = isCheckoutStory(context);
  const approvalAt = routing ? ROUTING_TIMING.approval : delayed ? 13 : 6;
  const printAt = focused ? 14.3 : 7;
  const stage: PaymentStage = routing ? t < 3.5 ? 'ready' : t < 4 ? 'reading' : t < ROUTING_TIMING.authorization ? 'waiting' : t < approvalAt ? 'reading' : t < ROUTING_TIMING.receipt ? 'approved' : 'receipt' : t < 3.5 ? 'ready' : t < 4 ? 'reading' : t < approvalAt
    ? delayed && t >= 10 ? 'retrying' : delayed ? 'waiting' : 'reading'
    : t < printAt ? 'approved' : 'receipt';
  const copy: Record<PaymentStage, [string, string]> = {
    ready: ['Tap to pay', 'Contactless accepted'], reading: ['Processing', 'Please wait'],
    waiting: ['Please wait', 'Connection interrupted'], retrying: ['Trying again', 'Connection restored'],
    approved: ['Approved', 'Payment complete'], receipt: ['Thank you', 'Receipt ready'],
  };
  if (routing) {
    copy.waiting = ['Please wait', routing.policyApplied ? 'Secure route ready' : 'Preparing secure route'];
    copy.reading = ['Processing', t >= ROUTING_TIMING.authorization ? 'Authorizing once via 5G' : 'Card read · request held'];
  }
  // The card reaches the reader before its state changes, then comes back to
  // the customer's hand. There is no second tap or duplicate transaction.
  const cardReach = progress(t, 3.05, 3.65) * (1 - progress(t, 4.2, 4.85));
  return {
    stage, delayed, approved: t >= approvalAt, title: copy[stage][0], detail: copy[stage][1],
    color: stage === 'waiting' ? '#ffd18b' : stage === 'approved' || stage === 'receipt' ? '#91e2bf' : '#8edbff',
    cardReach, cardVisible: focused && t >= 2.9 && t < 5,
    paper: progress(t, printAt, printAt + 1.1),
    networkShot: !routing && focused && t >= 8.35 && t < 12.5,
    route: routing ? routing.paymentPath : delayed ? t >= 10 ? '5G' : 'Fiber' : 'Fiber',
    routeStatus: routing ? routing.status : delayed ? t >= 10 ? 'Payment retry via 5G' : 'Fiber path unavailable' : 'Payment continues on fiber',
  };
}

export interface CheckoutShot { t: number; at: StoryPoint; distance: number; yaw?: number; pitch?: number; cut?: boolean; }
export const CHECKOUT_SHOTS: CheckoutShot[] = [
  {t:0,at:[5.5,1.1,5.7],distance:16,pitch:.38},
  {t:1.2,at:[5.7,1.1,5.7],distance:15.4,pitch:.38},
  {t:1.25,at:[6.1,1.15,6.1],distance:5.9,yaw:.75,pitch:.23,cut:true},
  {t:2.9,at:[7.05,1.2,5.5],distance:5.5,yaw:.75,pitch:.23},
  {t:2.95,at:[7.19,1.51,4.98],distance:1.65,yaw:.05,pitch:.52,cut:true},
  {t:5.35,at:[7.19,1.51,4.98],distance:1.52,yaw:.02,pitch:.50},
  {t:5.4,at:[7.65,1.3,4.6],distance:4.9,yaw:1.05,pitch:.19,cut:true},
  {t:8.3,at:[7.65,1.3,4.6],distance:4.6,yaw:1.02,pitch:.19},
  {t:8.35,at:[10.5,1.55,-2.2],distance:14.8,yaw:.08,pitch:.41,cut:true},
  {t:10,at:[10.5,1.55,-2.2],distance:14.4,yaw:.08,pitch:.41},
  {t:10.05,at:[10.1,2.1,-1.65],distance:15.6,yaw:-.18,pitch:.32,cut:true},
  {t:12.45,at:[10.1,2.1,-1.65],distance:15.1,yaw:-.16,pitch:.32},
  {t:12.5,at:[7.19,1.51,4.98],distance:1.55,yaw:.05,pitch:.5,cut:true},
  {t:14.25,at:[7.19,1.51,4.98],distance:1.48,yaw:.02,pitch:.49},
  {t:14.3,at:[8.7,1.52,4.76],distance:1.9,yaw:.6,pitch:.4,cut:true},
  {t:16.9,at:[8.65,1.5,4.8],distance:2.1,yaw:.56,pitch:.39},
  {t:16.95,at:[7.55,1.25,5.05],distance:5.7,yaw:.85,pitch:.22,cut:true},
  {t:19.5,at:[5.9,1.2,7.1],distance:6.6,yaw:.85,pitch:.24},
  {t:19.55,at:[4.5,1.1,7.2],distance:14.2,yaw:-.08,pitch:.35,cut:true},
  {t:24,at:[3.9,1.1,8.2],distance:15,yaw:-.12,pitch:.35},
];
