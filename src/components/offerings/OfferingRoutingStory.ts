/** One illustrative shift, viewed from checkout, online orders or the archive.
 * These are scripted examples, not live measurements or gateway configuration.
 * Absolute-time sampling keeps the physical action, captions and routes aligned
 * when scrubbing. A new authorization is sent once, after its route is selected;
 * an in-flight financial transaction is never moved or automatically retried.
 */
export const ROUTING_TIMING = {
  congestion: 4,
  policy: 10,
  authorization: 12.5,
  orderRequest: 12.6,
  approval: 13,
  orderAccepted: 13.2,
  receipt: 14.3,
  queueResumes: 16.95,
} as const;

export type RoutingPerspective = 'payment' | 'orders' | 'archive';
export type RoutingPaymentState = 'ready' | 'held' | 'route-ready' | 'authorizing' | 'approved';
export type RoutingOrderState = 'ready' | 'queued' | 'route-ready' | 'syncing' | 'accepted';

export function sampleRouting(time: number) {
  const congested = time >= ROUTING_TIMING.congestion;
  const policyApplied = time >= ROUTING_TIMING.policy;
  const authorizationSent = time >= ROUTING_TIMING.authorization;
  const paymentApproved = time >= ROUTING_TIMING.approval;
  const orderSent = time >= ROUTING_TIMING.orderRequest;
  const orderAccepted = time >= ROUTING_TIMING.orderAccepted;
  const receiptPrinted = time >= ROUTING_TIMING.receipt;
  const queueResumed = time >= ROUTING_TIMING.queueResumes;
  const paymentPath: 'Fiber' | '5G' = policyApplied ? '5G' : 'Fiber';
  const paymentState: RoutingPaymentState = paymentApproved ? 'approved' : authorizationSent
    ? 'authorizing' : policyApplied ? 'route-ready' : congested ? 'held' : 'ready';
  const ordersState: RoutingOrderState = orderAccepted ? 'accepted' : orderSent
    ? 'syncing' : policyApplied ? 'route-ready' : congested ? 'queued' : 'ready';
  return {
    illustrative: true as const,
    policyApplied,
    paymentPath,
    ordersPath: paymentPath,
    archivePath: 'Fiber' as const,
    paymentState,
    ordersState,
    authorizationSent,
    authorizationCount: authorizationSent ? 1 : 0,
    paymentApproved,
    orderSent,
    orderAccepted,
    receiptPrinted,
    queueResumed,
    // Bandwidth limiting belongs to the illustrative archive uploader. The
    // application's routing editor currently configures paths and SLA classes,
    // not an uplink bandwidth cap. Local recording continues throughout.
    archiveCapSource: 'Archive uploader' as const,
    archiveCapMbps: policyApplied ? 12 : null,
    archiveMbps: policyApplied ? 12 : congested ? 28 : 8,
    localRecording: true as const,
    fiber: {
      online: true as const,
      latencyMs: policyApplied ? 54 : congested ? 96 : 22,
      jitterMs: policyApplied ? 7 : congested ? 18 : 3,
      lossPercent: 0,
      utilizationPercent: policyApplied ? 48 : congested ? 94 : 30,
    },
    fiveG: {
      online: true as const,
      latencyMs: 32,
      jitterMs: 4,
      lossPercent: 0,
      utilizationPercent: policyApplied ? 18 : 6,
    },
    status: queueResumed ? 'Receipt collected. The next customer steps forward.' : receiptPrinted
      ? 'Receipt prints. The online order is accepted.' : paymentApproved
        ? 'Approved once over 5G. Archive continues on fiber.' : authorizationSent
          ? 'One authorization travels over the selected 5G route.' : policyApplied
            ? '5G selected for new business requests. Archive capped at its uploader.' : congested
              ? 'Archive upload loads fiber. Payment waits before submission.'
              : 'Both links online. A customer is ready to pay.',
    visible: time >= ROUTING_TIMING.congestion && time < 21,
  };
}
