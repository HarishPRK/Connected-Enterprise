import { currentGatewayOperation, gatewayJourney, type GatewayGroup } from './gatewayLifecycle';
import { currentProfiles } from './profileSelection';
import type { OnboardingSnapshot } from './types';

/** The overview uses the same current-generation evidence as gateway detail.
 * An authenticated profile retrieval is not promoted to confirmed health. */
export function onboardingOverview(snapshot:OnboardingSnapshot,preferredSiteId?:string) {
  const site=snapshot.sites.find(item=>item.id===preferredSiteId);
  const gateways=site?snapshot.gateways.filter(gateway=>gateway.siteId===site.id):snapshot.gateways;
  const groups:Record<GatewayGroup,number>={ready:0,activating:0,attention:0,retired:0};
  for(const gateway of gateways)groups[gatewayJourney(gateway,currentGatewayOperation(gateway,snapshot.operations)).group]++;
  const recent=[...snapshot.operations].filter(operation=>!site||operation.siteId===site.id)
    .sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0)).slice(0,3);
  return {site,total:gateways.length,groups,recent,profileCount:currentProfiles(snapshot.profiles).length,
    siteCount:snapshot.sites.length,controllerConfigured:Boolean(snapshot.controller)};
}
