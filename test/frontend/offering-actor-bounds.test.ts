import assert from 'node:assert/strict';
import test from 'node:test';
import { Frustum, Group, Matrix4, PerspectiveCamera, SkinnedMesh, Vector3 } from 'three';
import { loadGeometryGlb } from './loadGeometryGlb.ts';
import { OFFERING_CHAPTERS } from '../../src/components/offerings/OfferingCatalog.ts';
import { prepareActor, reachReader, setRig } from '../../src/components/offerings/OfferingSkinnedActor.ts';
import { sampleActor, STORY_ACTORS, storyProgress, type StoryContext } from '../../src/components/offerings/OfferingStoryMotion.ts';
import { sampleActorRig } from '../../src/components/offerings/OfferingActorMotion.ts';
import { poseRoutingContact } from '../../src/components/offerings/OfferingRoutingContact.ts';
import { poseSmartContact } from '../../src/components/offerings/OfferingSmartContact.ts';
import { poseTwinContact } from '../../src/components/offerings/OfferingTwinContact.ts';
import { poseConsoleContact } from '../../src/components/offerings/OfferingConsoleContact.ts';
import { isCheckoutStory, sampleCheckout } from '../../src/components/offerings/OfferingCheckoutStory.ts';
import { poseCardGrip } from '../../src/components/offerings/OfferingFingerGrip.ts';

const cast=loadGeometryGlb(new URL('../../src/assets/offerings/enterprise-actors.studio.glb',import.meta.url));
const contexts:StoryContext[]=OFFERING_CHAPTERS.flatMap(chapter=>chapter.variants.map(variant=>({offering:chapter.id,variant:variant.id})));

test('actual skin influences fit the fixed envelope for arbitrary joint rotations',async()=>{
  const gltf=await cast,point=new Vector3();
  for(const role of ['Customer','Staff','Technician','Security'] as const){
    const actor=prepareActor(gltf.scene.getObjectByName(role)!,role,'shopper');
    actor.object.updateMatrixWorld(true);
    const hips=actor.joints.Hips!.object;
    actor.object.traverse(node=>{
      if(!(node instanceof SkinnedMesh))return;
      assert(node.frustumCulled);assert(node.boundingSphere);
      assert.deepEqual(node.matrixWorld.elements,new Matrix4().elements,'the authored mesh shares actor-local coordinates');
      assert.deepEqual(node.bindMatrix.elements,new Matrix4().elements);
      const skeleton=node.skeleton,position=node.geometry.attributes.position;
      const indices=node.geometry.attributes.skinIndex,weights=node.geometry.attributes.skinWeight;
      const lengths=skeleton.bones.map(bone=>{
        let length=0,joint=bone;
        while(joint!==hips){
          assert(joint.parent,'every influencing bone belongs to the hip hierarchy');
          assert.deepEqual(joint.scale.toArray(),[1,1,1]);
          length+=joint.position.length();joint=joint.parent as typeof bone;
        }
        return length;
      });
      for(let i=0;i<position.count;i++){
        let totalWeight=0;
        for(let j=0;j<4;j++){
          const weight=weights.getComponent(i,j);assert(weight>=0);totalWeight+=weight;
          if(!weight)continue;
          const bone=indices.getComponent(i,j);
          point.fromBufferAttribute(position,i).applyMatrix4(node.bindMatrix).applyMatrix4(skeleton.boneInverses[bone]);
          // Triangle inequality bounds every influence under any rotations.
          // Non-negative normalized skin weights preserve this convex bound.
          assert(lengths[bone]+point.length()<1.24,`${node.name} influence exceeds the certified 1.24 m reach`);
        }
        assert(Math.abs(totalWeight-1)<1e-5);
      }
      assert(node.boundingSphere.radius>=1.24+.24);
    });
  }
});

test('all authored hip travel remains inside the conservative translation allowance',()=>{
  for(const context of contexts)for(const {id} of STORY_ACTORS)for(let frame=0;frame<=240;frame++){
    const time=frame/10,pose=sampleActor(id,context,time),state=sampleActorRig(pose,time);
    assert(Math.abs(.9+state.hipsY-.7)<.24,`${context.offering}/${context.variant}/${id} hip leaves its allowance at ${time}`);
  }
});

test('posed weighted vertices remain inside their sphere during stories, falls and physical contacts',async()=>{
  const gltf=await cast,point=new Vector3();let verticesChecked=0;
  // Every story is sampled; denser boundary frames cover the handoffs and fall.
  const times=[...new Set([...Array.from({length:25},(_,i)=>i),4.7,5.4,6.1,10.1,11.5,12.2,13.7,14.3,15.3,15.9,16.3,16.55,17.25,17.8,18.5,19.5])].sort((a,b)=>a-b);
  for(const {id,role} of STORY_ACTORS){
    const actor=prepareActor(gltf.scene.getObjectByName(role)!,role,id,gltf.scene),root=new Group(),lean=new Group();
    root.add(lean);lean.add(actor.object);
    const meshes:SkinnedMesh[]=[];actor.object.traverse(node=>{if(node instanceof SkinnedMesh)meshes.push(node);});
    for(const context of contexts)for(const time of times){
      const pose=sampleActor(id,context,time);if(!pose.visible)continue;
      root.position.fromArray(pose.at);root.rotation.y=pose.heading;lean.rotation.x=pose.fall*Math.PI/2;
      setRig(actor.joints,pose,time);
      if(context.offering==='routing')poseRoutingContact(actor.joints,id,context.variant,time);
      if(context.offering==='smart')poseSmartContact(actor.joints,id,context.variant,time);
      const checkout=sampleCheckout(context,time);
      if(id==='shopper'&&checkout.cardVisible)poseCardGrip(actor.joints);
      if(id==='technician'&&context.offering==='twin')poseTwinContact(actor.joints,time);
      if(id==='technician'&&context.offering==='eagle'){
        if(time>=10&&time<=12)poseConsoleContact(actor.joints,9.3+(time-10)*1.75);
        if(time>=17&&time<=18)poseConsoleContact(actor.joints,9.3+(time-17)*3.5);
      }
      if(id==='shopper'&&isCheckoutStory(context)){
        reachReader(actor.joints,checkout.cardReach);
        const lift=storyProgress(time,15.9,16.3),lower=storyProgress(time,16.55,17.25);
        reachReader(actor.joints,lift*lift*(3-2*lift)*(1-lower*lower*(3-2*lower)),'Left',[8.7,1.6,4.85]);
      }
      root.updateMatrixWorld(true);meshes[0].skeleton.update();
      for(const mesh of meshes){
        const sphere=mesh.boundingSphere!,world=sphere.clone().applyMatrix4(mesh.matrixWorld);
        for(let i=0;i<mesh.geometry.attributes.position.count;i++){
          mesh.getVertexPosition(i,point);verticesChecked++;
          if(!sphere.containsPoint(point))assert.fail(`${context.offering}/${context.variant}/${id}: ${mesh.name} outside at ${time}`);
          point.applyMatrix4(mesh.matrixWorld);
          if(!world.containsPoint(point))assert.fail('parent walking, turn and fall transforms preserve the bound');
        }
      }
    }
  }
  assert(verticesChecked>1_000_000);
});

test('off-camera skins are rejectable while actors at the camera edge remain visible',async()=>{
  const gltf=await cast,actor=prepareActor(gltf.scene.getObjectByName('Technician')!,'Technician','technician');
  const camera=new PerspectiveCamera(45,16/9,.1,30);camera.position.set(0,1.2,5);camera.lookAt(0,.7,0);camera.updateMatrixWorld();
  const frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  actor.object.updateMatrixWorld(true);
  actor.object.traverse(node=>{if(node instanceof SkinnedMesh)assert(frustum.intersectsObject(node));});
  actor.object.position.x=20;actor.object.updateMatrixWorld(true);
  actor.object.traverse(node=>{if(node instanceof SkinnedMesh)assert(!frustum.intersectsObject(node));});
});
