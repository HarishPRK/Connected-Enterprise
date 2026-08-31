import { useState } from 'react';
import { LiveIpsecCard, SAMPLE_IPSEC_GATEWAY } from '../../pages/DynamicPathSelection';
import {
  BRANCH_TO_DEVICE_TOPIC,
  BRANCH_TO_FAILOVER_TOPIC,
  BRANCH_TO_WAN_TOPIC,
} from '../../data/mock';
import type { UseIpsecMetricsResult } from '../../ui/useIpsecMetrics';

/** Branch-scoped Dynamic Failover diagram for the Overview page.
 *
 *  Thin wrapper around the Dynamic Failover page's `LiveIpsecCard` — the same
 *  live flow diagram (IT/OT devices → gateway → Fiber/5G underlays → IPsec
 *  tunnels → WAN), driven by the branch's own MQTT feed: Plano renders the
 *  gateway streaming on `rdk/ipsec/metrics`, McKinney/QDR the one on
 *  `prpl/ipsec/metrics`. The `ipsec` stream is passed in from the parent so
 *  the page keeps a single SSE connection.
 *
 *  Only render this for branches present in `BRANCH_TO_FAILOVER_TOPIC`; branches
 *  without a live feed should keep the static Topology widget instead. */
export function FailoverTopology({
  branchId,
  ipsec,
}: {
  branchId: string;
  ipsec: UseIpsecMetricsResult;
}) {
  const [showSample, setShowSample] = useState(false);

  // Keep each branch's topology on its failover feed. McKinney's numerical
  // WAN badge is selected independently from prplhome below.
  const branchTopic = BRANCH_TO_FAILOVER_TOPIC[branchId];
  const branchList = branchTopic
    ? ipsec.list.filter((gateway) => gateway.topic === branchTopic)
    : ipsec.list;

  const effectiveList = showSample ? [SAMPLE_IPSEC_GATEWAY] : branchList;

  return (
    <LiveIpsecCard
      ipsec={ipsec}
      showSample={showSample}
      onToggleSample={() => setShowSample((s) => !s)}
      effectiveList={effectiveList}
      branchTopic={branchTopic ?? null}
      deviceTopic={BRANCH_TO_DEVICE_TOPIC[branchId] ?? null}
      wanTopic={BRANCH_TO_WAN_TOPIC[branchId] ?? null}
    />
  );
}
