import assert from 'node:assert/strict';
import test from 'node:test';
import { onboardingOverview } from '../../src/features/onboarding/readinessOverview';
import type { Gateway, OnboardingOperation, OnboardingSnapshot } from '../../src/features/onboarding/types';

const timestamp='2026-11-06T12:00:00Z';
const gateway:Gateway={id:'gw-1',thingName:'gw-1',serialNumber:'CE-001',modelId:'prpl',hardwareRevision:'A',siteId:'north',state:'ACTIVE',certificateState:'ACTIVE',health:'HEALTHY',deploymentGeneration:2,profileVersionId:'profile-2',createdAt:timestamp,updatedAt:timestamp};
const operation:OnboardingOperation={id:'op-1',type:'PROFILE_DEPLOY',status:'SUCCEEDED',state:'APPLIED_HEALTHY',gatewayId:'gw-1',serialNumber:'CE-001',siteId:'north',deploymentGeneration:2,profileVersionId:'profile-2',timeline:[{state:'APPLIED_HEALTHY',at:timestamp,detail:'Gateway reported application and health.'}],createdAt:timestamp,updatedAt:timestamp};
const snapshot:OnboardingSnapshot={mode:'aws',generatedAt:timestamp,tenant:{id:'tenant-1',name:'Enterprise'},sites:[{id:'north',name:'North office',location:'Chicago'},{id:'south',name:'South office',location:'Austin'}],gatewayModels:[],gateways:[gateway],profiles:[],operations:[operation]};

test('overview keeps authenticated retrieval separate from confirmed device health',()=>{
  const result=onboardingOverview({...snapshot,gateways:[gateway,{...gateway,id:'pull-only',configurationSource:'CONTROLLER',configurationConfirmationMethod:'AUTHENTICATED_CONFIGURATION_PULL'},{...gateway,id:'pending',state:'PENDING',health:'UNKNOWN'},{...gateway,id:'retired',state:'DECOMMISSIONED',certificateState:'INACTIVE'}]});
  assert.deepEqual(result.groups,{ready:1,activating:1,attention:1,retired:1});
  assert.equal(result.total,4);
});

test('current-generation in-flight deployment outranks old health evidence',()=>{
  const old={...operation,id:'old',deploymentGeneration:1,updatedAt:'2026-11-06T14:00:00Z'};
  const current={...operation,id:'new',status:'IN_PROGRESS' as const,state:'PROFILE_STAGED' as const};
  const result=onboardingOverview({...snapshot,operations:[old,current]});
  assert.equal(result.groups.activating,1);
  assert.equal(result.groups.ready,0);
});

test('overview scopes inventory and recent operations to a known selected site without changing snapshot order',()=>{
  const other={...operation,id:'south-op',siteId:'south',updatedAt:'2026-11-06T13:00:00Z'};
  const data={...snapshot,gateways:[gateway,{...gateway,id:'gw-2',siteId:'south'}],operations:[operation,other]};
  const before=JSON.stringify(data);
  const scoped=onboardingOverview(data,'north');
  assert.equal(scoped.total,1);
  assert.deepEqual(scoped.recent.map(item=>item.id),['op-1']);
  assert.equal(scoped.site?.name,'North office');
  assert.equal(onboardingOverview(data,'unknown').total,2);
  assert.equal(onboardingOverview(data).recent[0].id,'south-op');
  assert.equal(JSON.stringify(data),before);
});

test('empty inventory stays zero and published profile history is not double counted',()=>{
  const profile={id:'profile-1',profileId:'office',name:'Office',description:'Office network',modelId:'prpl',version:1,schemaVersion:2,parameters:{},contentHash:'one',immutable:true as const,createdAt:timestamp,createdBy:'operator',changeNote:'Initial publication'};
  const result=onboardingOverview({...snapshot,gateways:[],operations:[],profiles:[profile,{...profile,id:'profile-2',version:2,contentHash:'two'}]});
  assert.deepEqual(result.groups,{ready:0,activating:0,attention:0,retired:0});
  assert.equal(result.profileCount,1);
  assert.equal(result.controllerConfigured,false);
  assert.equal(result.siteCount,2);
  assert.deepEqual(result.recent,[]);
});
