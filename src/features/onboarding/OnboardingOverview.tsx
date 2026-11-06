import { ArrowRight, Check, Clock3, FileCheck2, MapPin, Network, ShieldCheck } from 'lucide-react';
import { onboardingOverview } from './readinessOverview';
import type { OnboardingOperation, OnboardingSnapshot } from './types';

const GROUPS=[
  {id:'ready',label:'Health confirmed'},
  {id:'activating',label:'Activating'},
  {id:'attention',label:'Needs attention'},
  {id:'retired',label:'Retired'},
] as const;
const operationType={ONBOARD:'Gateway onboarding',PROFILE_DEPLOY:'Profile deployment',DECOMMISSION:'Gateway retirement'};
function dateLabel(value:string) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'Time unavailable':date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}

export function OnboardingOverview({snapshot,preferredSiteId,canOperate,onStart,onProfiles,onController,onOperation}:{
  snapshot:OnboardingSnapshot;preferredSiteId?:string;canOperate:boolean;
  onStart:()=>void;onProfiles:()=>void;onController:()=>void;onOperation:(operation:OnboardingOperation)=>void;
}) {
  const overview=onboardingOverview(snapshot,preferredSiteId),latest=overview.recent[0];
  const latestEvent=latest?.timeline[latest.timeline.length-1];
  return <section className="ce-onb-overview" aria-labelledby="ce-onb-overview-title">
    <div className="ce-onb-overview-main">
      <div className="ce-onb-overview-heading">
        <div><span className="ce-onb-overview-eyebrow">{overview.site?.name??'Tenant workspace'}</span>
          <h2 id="ce-onb-overview-title">Gateway readiness</h2></div>
        <span className="ce-onb-overview-total">{overview.total} <span>{overview.total===1?'gateway':'gateways'}</span></span>
      </div>
      <div className="ce-onb-readiness-bar" aria-hidden="true">
        {overview.total?GROUPS.filter(group=>overview.groups[group.id]>0).map(group=><span key={group.id} data-state={group.id} style={{flexGrow:overview.groups[group.id]}}/>):<span data-state="empty"/>}
      </div>
      <dl className="ce-onb-readiness-counts">
        {GROUPS.map(group=><div key={group.id} data-state={group.id}><dt><i aria-hidden="true"/>{group.label}</dt><dd>{overview.groups[group.id]}</dd></div>)}
      </dl>
      <p className="ce-onb-overview-note"><ShieldCheck size={13} aria-hidden="true"/>Configuration retrieval and device health are separate confirmations.</p>
    </div>
    <div className="ce-onb-overview-latest">
      <span className="ce-onb-overview-eyebrow"><Clock3 size={13} aria-hidden="true"/>Latest reported operation</span>
      {latest?<>
        <div className="ce-onb-overview-operation-title"><strong>{latest.serialNumber}</strong><span data-status={latest.status}>{latest.status==='IN_PROGRESS'?'In progress':latest.status==='SUCCEEDED'?'Completed':'Needs attention'}</span></div>
        <p className="ce-onb-overview-operation-kind">{operationType[latest.type]}<span aria-hidden="true"> · </span><time dateTime={latest.updatedAt}>{dateLabel(latest.updatedAt)}</time></p>
        <p className="ce-onb-overview-event">{latestEvent?.detail??'Open the operation to review its reported stages.'}</p>
        <button type="button" onClick={()=>onOperation(latest)}>View operation<ArrowRight size={14} aria-hidden="true"/></button>
      </>:<>
        <strong className="ce-onb-overview-empty-title">Your next gateway starts here.</strong>
        <p>Prepare its identity, choose a site and assign a configuration profile.</p>
        {canOperate?<button type="button" onClick={onStart}>Start gateway onboarding<ArrowRight size={14} aria-hidden="true"/></button>:<span className="ce-onb-overview-readonly">View access · an operator can start onboarding.</span>}
      </>}
    </div>
    <div className="ce-onb-preparation" aria-label="Workspace preparation">
      <button type="button" onClick={onController}><Network size={18} aria-hidden="true"/><span><strong>Controller</strong><small>{overview.controllerConfigured?'Settings configured · connection not verified':'Configuration needed'}</small></span>{overview.controllerConfigured?<Check size={15} aria-label="Configured"/>:<ArrowRight size={15} aria-hidden="true"/>}</button>
      <button type="button" onClick={onProfiles}><FileCheck2 size={18} aria-hidden="true"/><span><strong>{overview.profileCount} {overview.profileCount===1?'profile':'profiles'} available</strong><small>Current published versions</small></span><ArrowRight size={15} aria-hidden="true"/></button>
      <div><MapPin size={18} aria-hidden="true"/><span><strong>{overview.siteCount} {overview.siteCount===1?'site':'sites'} configured</strong><small>{overview.site?'Inventory scoped to '+overview.site.name:'Sites available to this tenant'}</small></span></div>
    </div>
  </section>;
}
