/**
 * Mock/config data for the Dynamic Failover pack — carved from src/data/mock.ts.
 * Only the two exports the DynamicPathSelection page consumes:
 * BRANCH_TO_IPSEC_SOURCE and pathThresholds.
 */

import type { PathThreshold } from '../types';

/** Branches that are backed by a live IPsec MQTT feed. The value matches the
 *  `source` tag the server attaches to each cached gateway state (derived from
 *  the topic prefix it arrived on). */
export const BRANCH_TO_IPSEC_SOURCE: Record<string, 'rdk' | 'prpl'> = {
  'b-pln-01': 'rdk',   // Plano  → rdk/ipsec/metrics
  'b-mck-03': 'prpl',  // McKinney → prpl/ipsec/metrics
};

export const pathThresholds: PathThreshold[] = [
  // Fiber holds the tighter bound; 5G is given more headroom on latency/jitter.
  { metric: 'latency', fiber: { warn: 80,  fail: 150 }, fiveg: { warn: 120, fail: 200 }, unit: 'ms' },
  { metric: 'jitter',  fiber: { warn: 30,  fail: 60  }, fiveg: { warn: 40,  fail: 80  }, unit: 'ms' },
  { metric: 'loss',    fiber: { warn: 1,   fail: 3   }, fiveg: { warn: 1.5, fail: 5   }, unit: '%'  },
  { metric: 'mos',     fiber: { warn: 3.6, fail: 3.0 }, fiveg: { warn: 3.4, fail: 2.8 }, unit: ''   },
];
