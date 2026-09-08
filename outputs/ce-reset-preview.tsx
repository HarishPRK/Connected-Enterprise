import React from 'react';
import {createRoot} from 'react-dom/client';
import {GatewayInventory} from '../src/features/onboarding/GatewayInventory';
import {ToastProvider} from '../src/ui/Toast';
import '../src/index.css';
import '../src/App.css';
import '../src/features/onboarding/onboarding.css';
const base = {thingName:'gw-preview',modelId:'ce-gateway-v1',hardwareRevision:'1',siteId:'lab',health:'UNKNOWN' as const,deploymentGeneration:5,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
createRoot(document.getElementById('root')!).render(<ToastProvider><main className="ce-onb-page" style={{padding:24}}><GatewayInventory gateways={[
  {...base,id:'active',serialNumber:'DEMO-ACTIVE',state:'ACTIVE',certificateState:'ACTIVE'},
  {...base,id:'retired',serialNumber:'DEMO-RETIRED',state:'DECOMMISSIONED',certificateState:'INACTIVE'},
]} sites={[{id:'lab',name:'Test Lab',location:'Development'}]} models={[]} profiles={[]} operations={[]} controller={undefined} refreshing={false} canVerifyDevice={true} canDecommission={true} canResetRegistration={true} canDeployProfile={false} onRefresh={()=>{}} onVerifyDevice={()=>{}} onOperation={()=>{}} /></main></ToastProvider>);
