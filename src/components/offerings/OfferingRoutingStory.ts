/** Illustrative application policy, independent of link failure. Absolute time
 * keeps the film, labels and packets consistent when seeking in either direction. */
export function sampleRouting(time: number) {
  const policy = time >= 10;
  const queued = policy && time < 17;
  return {
    policy, queued,
    voice: policy ? '5G' : 'Fiber',
    video: 'Fiber',
    stock: queued ? 'Queued' : time >= 17 ? 'Syncing · Fiber' : 'Fiber',
    status: time < 4 ? 'A delivery call and two background jobs.' : !policy
      ? 'Bulk uploads compete with the conversation.' : queued
        ? 'Voice gets its path. Inventory waits its turn.' : 'Delivery confirmed. Stock sync resumes.',
    visible: time >= 4 && time < 21,
  };
}
