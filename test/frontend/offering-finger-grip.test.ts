import assert from 'node:assert/strict';
import test from 'node:test';
import { SkinnedMesh,Vector3 } from 'three';
import { loadGeometryGlb } from './loadGeometryGlb.ts';
import { prepareActor,setRig,reachReader } from '../../src/components/offerings/OfferingSkinnedActor.ts';
import { poseFingerGrip,fingerGripPose } from '../../src/components/offerings/OfferingFingerGrip.ts';
import { sampleActor } from '../../src/components/offerings/OfferingStoryMotion.ts';
import { sampleCheckout } from '../../src/components/offerings/OfferingCheckoutStory.ts';

const cast=loadGeometryGlb(new URL('../../src/assets/offerings/enterprise-actors.studio.glb',import.meta.url));
for(const side of ['Right','Left'] as const)test(`${side} anatomical thumb and index pinch opposite prop faces through approach, hold and retract`,async()=>{
  const gltf=await cast,actor=prepareActor(gltf.scene.getObjectByName('Customer')!,'Customer','shopper');
  const skin=actor.object.getObjectByName('Customer_Skin_guest') as SkinnedMesh;
  const hand=actor.joints[`${side}Hand`]!.object;
  actor.object.updateMatrixWorld(true);skin.skeleton.update();
  // Find real textured surface vertices, not just the contact helper empties.
  const padIndices=['Thumb','Index'].map(digit=>{
    const target=actor.joints[`${side}${digit}Pad`]!.object.getWorldPosition(new Vector3());
    let minimum=Infinity,index=0;
    for(let i=0;i<skin.geometry.attributes.position.count;i++){
      const distance=skin.getVertexPosition(i,new Vector3()).distanceTo(target);
      if(distance<minimum){minimum=distance;index=i;}
    }
    assert(minimum<1e-6);return index;
  });
  const thickness=side==='Right'?.001:.0006;
  const sample=(time:number)=>{
    const context={offering:'failover',variant:'fiber'} as const,pose=sampleActor('shopper',context,time);
    actor.object.position.fromArray(pose.at);actor.object.rotation.y=pose.heading;
    setRig(actor.joints,pose,time);
    if(side==='Right')hand.rotation.y=0;
    poseFingerGrip(actor.joints,side,1,thickness);
    reachReader(actor.joints,side==='Right'?sampleCheckout(context,time).cardReach:.7,side);
    actor.object.updateMatrixWorld(true);skin.skeleton.update();
    const pads=padIndices.map(i=>skin.localToWorld(skin.getVertexPosition(i,new Vector3())));
    const center=hand.localToWorld(fingerGripPose(side,thickness).center);
    assert(Math.abs(pads[0].distanceTo(pads[1])-thickness)<2e-6,'skin pads close to actual material thickness');
    assert(pads[0].clone().lerp(pads[1],.5).distanceTo(center)<2e-6,'both pads meet the same grip point');
    const prop=side==='Right'?actor.card:actor.receipt;
    for(const p of pads){const local=prop.worldToLocal(p.clone());
      assert(Math.abs(Math.abs(local.z)-thickness/2)<2e-6,'a fingertip rests on each sheet face');
      assert(Math.abs(local.x)<(side==='Right'?.0428:.045)&&Math.abs(local.y)<(side==='Right'?.027:.085));
    }
    assert.equal(prop.parent,hand,'prop follows the articulated hand, not the forearm or palm proxy');
    return pads.flatMap(p=>p.toArray());
  };
  const first=sample(3.3);sample(3.8);sample(4.6);sample(16.5);assert.deepEqual(sample(3.3),first);
});
