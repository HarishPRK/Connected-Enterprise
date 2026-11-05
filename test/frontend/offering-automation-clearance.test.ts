import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh,SkinnedMesh,Vector3 } from 'three';
import { loadGeometryGlb } from './loadGeometryGlb.ts';
import { prepareActor,setRig } from '../../src/components/offerings/OfferingSkinnedActor.ts';
import { sampleActor } from '../../src/components/offerings/OfferingStoryMotion.ts';

const cast=loadGeometryGlb(new URL('../../src/assets/offerings/enterprise-actors.studio.glb',import.meta.url));
const ramp=(time:number,start:number,end:number)=>{const u=Math.max(0,Math.min(1,(time-start)/(end-start)));return u*u*(3-2*u);};

test('the actual Staff skin, both hands and carried tablet pass through the open staff door',async()=>{
  const gltf=await cast,actor=prepareActor(gltf.scene.getObjectByName('Staff')!,'Staff','shopper');
  const meshes:Mesh[]=[];actor.object.traverse(node=>{if(node instanceof Mesh)meshes.push(node);});
  let jambClearance=Infinity,doorClearance=Infinity,supportError=0;
  let worstJamb='',worstDoor='',crossingVertices=0,tabletCrossings=0;
  for(let frame=0;frame<=245;frame++){
    const time=4.2+frame*.02,pose=sampleActor('shopper',{offering:'automation',variant:'after-hours'},time);
    setRig(actor.joints,pose,time);actor.object.position.fromArray(pose.at);actor.object.rotation.y=pose.heading;actor.object.updateMatrixWorld(true);
    const palm=actor.joints.LeftHand!.object.localToWorld(new Vector3(0,-.06,.012));
    const underside=actor.joints.Tablet!.object.localToWorld(new Vector3(0,-.01,-.015));
    supportError=Math.max(supportError,palm.distanceTo(underside));
    const angle=Math.PI/2*ramp(time,4.3,5)*(1-ramp(time,8.5,9)),cos=Math.cos(angle),sin=Math.sin(angle);
    for(const mesh of meshes){
      let visible=true;for(let parent:typeof mesh.parent=mesh;parent;parent=parent.parent)if(!parent.visible)visible=false;
      if(!visible)continue;
      if(mesh instanceof SkinnedMesh)mesh.skeleton.update();
      for(let index=0;index<mesh.geometry.attributes.position.count;index++){
        const p=mesh.localToWorld(mesh.getVertexPosition(index,new Vector3()));
        if(Math.abs(p.z+1.49)<.065&&p.y>0&&p.y<2.2){
          crossingVertices++;if(mesh.name.includes('Tablet'))tabletCrossings++;
          const clearance=Math.min(p.x+8.02,-7.08-p.x);
          if(clearance<jambClearance){jambClearance=clearance;worstJamb=`${mesh.name}, ${time.toFixed(2)}s, ${p.toArray()}`;}
        }
        const dx=p.x+8.02,dz=p.z+1.49,localX=cos*dx-sin*dz,localZ=sin*dx+cos*dz;
        if(localX>=0&&localX<=.94&&p.y>0&&p.y<2.2){
          const clearance=Math.abs(localZ)-.035;
          if(clearance<doorClearance){doorClearance=clearance;worstDoor=`${mesh.name}, ${time.toFixed(2)}s, ${p.toArray()}`;}
        }
      }
    }
  }
  assert(crossingVertices>1000&&tabletCrossings>0,'test must include the actual tablet crossing');
  assert(jambClearance>.015,`jamb clearance ${jambClearance}m at ${worstJamb}`);
  assert(doorClearance>.015,`leaf clearance ${doorClearance}m at ${worstDoor}`);
  assert(supportError<.035,`tablet support error ${supportError}m`);
  const exit=sampleActor('shopper',{offering:'automation',variant:'after-hours'},8.5);
  assert(exit.at[2]<=-2.75,'employee completes the exit before the door closes');
  console.log(JSON.stringify({jambClearance,doorClearance,supportError,worstJamb,worstDoor,tabletCrossings}));
});
