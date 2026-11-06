import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, Mesh, Object3D, SkinnedMesh, Vector3 } from 'three';
import { loadGeometryGlb } from './loadGeometryGlb.ts';
import { prepareActor, setRig } from '../../src/components/offerings/OfferingSkinnedActor.ts';
import { sampleActor, type ActorId } from '../../src/components/offerings/OfferingStoryMotion.ts';
import { poseRoutingContact, ROUTING_CONTACT } from '../../src/components/offerings/OfferingRoutingContact.ts';
import { SERVICE_CART } from '../../src/components/offerings/OfferingEquipment.ts';

const directory=new URL('../../src/assets/offerings/',import.meta.url);
const cast=loadGeometryGlb(new URL('enterprise-actors.studio.glb',directory));
const kit=loadGeometryGlb(new URL('routing-kit.studio.glb',directory));
type Actor=ReturnType<typeof prepareActor>;
type Desk={left:number;right:number;back:number;front:number;bottom:number;top:number};
const times=(from:number,to:number)=>Array.from({length:Math.round((to-from)/.025)+1},(_,i)=>from+i*.025);

// An exact vertical projection of the shipped hardware triangles, indexed in
// 20 mm cells. This catches skin penetrating individual keys and the curved
// speaker ring; a single device bounding box cannot verify these contacts.
function topSurface(scene:Object3D,minimumHeight=1.1026){
  type Triangle={a:Vector3;b:Vector3;c:Vector3;denominator:number;name:string};
  const cells=new Map<string,Triangle[]>(),cell=.02;
  scene.updateMatrixWorld(true);
  scene.traverse(node=>{
    if(!(node instanceof Mesh))return;
    const positions=node.geometry.attributes.position,indices=node.geometry.index;
    for(let i=0;i<(indices?.count??positions.count);i+=3){
      const [a,b,c]=[0,1,2].map(j=>node.localToWorld(new Vector3().fromBufferAttribute(positions,indices?indices.getX(i+j):i+j)));
      if(Math.max(a.y,b.y,c.y)<minimumHeight)continue;
      const denominator=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(denominator)<1e-10)continue;
      const triangle={a,b,c,denominator,name:node.name};
      for(let x=Math.floor(Math.min(a.x,b.x,c.x)/cell);x<=Math.floor(Math.max(a.x,b.x,c.x)/cell);x++)for(let z=Math.floor(Math.min(a.z,b.z,c.z)/cell);z<=Math.floor(Math.max(a.z,b.z,c.z)/cell);z++){
        const key=`${x}/${z}`,list=cells.get(key)??[];list.push(triangle);cells.set(key,list);
      }
    }
  });
  return(p:Vector3)=>{
    let height=-Infinity,name='';
    for(const t of cells.get(`${Math.floor(p.x/cell)}/${Math.floor(p.z/cell)}`)??[]){
      const u=((t.b.z-t.c.z)*(p.x-t.c.x)+(t.c.x-t.b.x)*(p.z-t.c.z))/t.denominator;
      const v=((t.c.z-t.a.z)*(p.x-t.c.x)+(t.a.x-t.c.x)*(p.z-t.c.z))/t.denominator;
      if(u<0||v<0||u+v>1)continue;
      const y=u*t.a.y+v*t.b.y+(1-u-v)*t.c.y;if(y>height){height=y;name=t.name;}
    }
    return {height,name};
  };
}

function poseAt(actor:Actor,id:ActorId,variant:string,time:number){
  const pose=sampleActor(id,{offering:'routing',variant},time);
  setRig(actor.joints,pose,time);actor.object.position.fromArray(pose.at);actor.object.rotation.y=pose.heading;
  poseRoutingContact(actor.joints,id,variant,time);actor.object.updateMatrixWorld(true);
  actor.object.traverse(node=>{if(node instanceof SkinnedMesh)node.skeleton.update();});
}

function boneWeight(mesh:SkinnedMesh,index:number,pattern:RegExp){
  let weight=0;for(let j=0;j<4;j++)if(pattern.test(mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(index,j)].name))weight+=mesh.geometry.attributes.skinWeight.getComponent(index,j);
  return weight;
}

function fingerTip(skin:SkinnedMesh,side:'Right'|'Left'){
  let index=-1,lowest=Infinity;
  for(let i=0;i<skin.geometry.attributes.position.count;i++){
    if(boneWeight(skin,i,new RegExp(`${side}Index`))<.6)continue;
    const p=skin.localToWorld(skin.getVertexPosition(i,new Vector3()));if(p.y<lowest){lowest=p.y;index=i;}
  }
  assert(index>=0,'must use an actual index-finger skin vertex');return index;
}

function verifyClearance(actor:Actor,id:ActorId,variant:string,samples:number[],desk:Desk,surface:ReturnType<typeof topSurface>){
  const meshes:{mesh:SkinnedMesh;body:Set<number>;hands:Set<number>}[]=[];
  actor.object.traverse(node=>{
    if(!(node instanceof SkinnedMesh))return;
    const body=new Set<number>(),hands=new Set<number>(),position=node.geometry.attributes.position;
    for(let i=0;i<position.count;i++){
      if(position.getY(i)>.87&&position.getY(i)<1.4&&boneWeight(node,i,/_Hips$|_Torso$/)>.8)body.add(i);
      if(boneWeight(node,i,/Hand$|Thumb|Index|Middle|Ring|Little/)>.8)hands.add(i);
    }
    meshes.push({mesh:node,body,hands});
  });
  assert.equal(meshes.length,7,'include skin and all six clothing/hair surfaces');
  let minimumHardware=Infinity,minimumBody=Infinity;
  for(const time of samples){
    poseAt(actor,id,variant,time);
    const bodyBox=new Box3(),handPoints:Vector3[]=[];
    for(const {mesh,body,hands} of meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      const p=mesh.localToWorld(mesh.getVertexPosition(i,new Vector3()));
      const context=`${id}/${mesh.name}@${time.toFixed(3)} ${p.toArray()}`;
      assert(!(p.x>desk.left&&p.x<desk.right&&p.z>desk.back&&p.z<desk.front&&p.y>desk.bottom&&p.y<desk.top),`worktop penetration: ${context}`);
      if(p.y>desk.bottom){
        const top=surface(p),clearance=p.y-top.height;minimumHardware=Math.min(minimumHardware,clearance);
        assert(clearance>=-2e-6,`${top.name} penetration ${clearance} m: ${context}`);
      }
      if(body.has(i))bodyBox.expandByPoint(actor.object.worldToLocal(p.clone()));
      if(hands.has(i))handPoints.push(actor.object.worldToLocal(p.clone()));
    }
    // A conservative box contains the actual posed torso/clothing surfaces.
    // Keeping every hand vertex outside it prevents body-through-hand poses.
    assert(!bodyBox.isEmpty()&&handPoints.length>1000);
    for(const hand of handPoints){const gap=bodyBox.distanceToPoint(hand);minimumBody=Math.min(minimumBody,gap);assert(gap>.002,`hand enters torso envelope: ${id}@${time}`);}
  }
  return {minimumHardware,minimumBody};
}

test('actual hands, hips and clothes clear both routing desks during approach, touch and release',async()=>{
  const gltf=await cast,surface=topSurface((await kit).scene);
  for(const id of ['staff','caller'] as const){
    const actor=prepareActor(gltf.scene.getObjectByName('Staff')!,'Staff',id),skin=actor.object.getObjectByName('Staff_Skin_crew') as SkinnedMesh;
    const variant=id==='staff'?'teams':'voice',side=id==='staff'?'Right':'Left',target=new Vector3(...(id==='staff'?ROUTING_CONTACT.keyboardKey:ROUTING_CONTACT.speakerKey));
    poseAt(actor,id,variant,id==='staff'?2.2:14.4);const tip=fingerTip(skin,side);
    const desk=id==='staff'?{left:7.25,right:8.75,back:4.08,front:4.9275,bottom:1.02,top:1.1025}:{left:7.3,right:8.7,back:6.65,front:7.3575,bottom:1.02,top:1.1025};
    const samples=id==='staff'?[...times(.4,3.8),...times(13.9,15.9),4,8,12,17,24]:[...times(13.6,15.4),0,4,8,12,17,24];
    const result=verifyClearance(actor,id,variant,samples,desk,surface);
    let contacts=0;
    for(const time of id==='staff'?[...times(1.3,3),...times(14.4,15.2)]:times(14.1,14.8)){
      poseAt(actor,id,variant,time);const p=skin.localToWorld(skin.getVertexPosition(tip,new Vector3()));
      assert(Math.hypot(p.x-target.x,p.z-target.z)<1e-6,'fingertip remains centered on the actual key');
      assert(p.y-target.y>=-1e-6&&p.y-target.y<.00301,'typing lift stays within 3 mm; no penetration');
      if(p.distanceTo(target)<1e-6)contacts++;
    }
    assert(contacts>10,'must make actual skin-to-key contact repeatedly');
    console.log(id,result);
  }
});

test('technician turns outside the cart and presses the actual laptop key without case penetration',async()=>{
  const actor=prepareActor((await cast).scene.getObjectByName('Technician')!,'Technician','technician');
  const laptop=(await loadGeometryGlb(new URL('offerings-kit.glb',directory))).scene.getObjectByName('Laptop')!;
  const box=new Box3().setFromObject(laptop),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3()),wrapper=new Group();
  laptop.position.sub(new Vector3(center.x,box.min.y,center.z));wrapper.add(laptop);wrapper.scale.setScalar(SERVICE_CART.laptopWidth/Math.max(...size.toArray()));wrapper.position.set(7.1,SERVICE_CART.top,.25);
  const surface=topSurface(wrapper,SERVICE_CART.top),desk={left:7.1-SERVICE_CART.width/2,right:7.1+SERVICE_CART.width/2,back:.25-SERVICE_CART.depth/2,front:.25+SERVICE_CART.depth/2,bottom:1,top:SERVICE_CART.top};
  const result=verifyClearance(actor,'technician','teams',[...times(4.5,7.5),9,10.5,11,12,14,17,24],desk,surface);
  const skin=actor.object.getObjectByName('Technician_Skin_chef') as SkinnedMesh;
  poseAt(actor,'technician','teams',6.6);const tip=fingerTip(skin,'Right'),p=skin.localToWorld(skin.getVertexPosition(tip,new Vector3()));
  assert(p.distanceTo(new Vector3(...ROUTING_CONTACT.laptopKey))<1e-6);
  console.log('technician',result);
});

test('routing contact poses are seek deterministic and leave unrelated actors and caller variants alone',async()=>{
  const gltf=await cast;
  for(const id of ['staff','caller','technician'] as const){
    const role=id==='technician'?'Technician':'Staff',actor=prepareActor(gltf.scene.getObjectByName(role)!,role,id);
    const snapshot=(time:number)=>{poseAt(actor,id,'voice',time);return Object.values(actor.joints).filter(Boolean).map(joint=>joint!.object.matrixWorld.elements.slice());};
    for(const time of [0,1.15,2.2,5.7,6.6,13.85,14.4,15.1,24]){const before=snapshot(time);snapshot(24);snapshot(0);assert.deepEqual(snapshot(time),before);}
  }
  const actor=prepareActor(gltf.scene.getObjectByName('Staff')!,'Staff','caller');
  for(const variant of ['teams','archive']){
    const pose=sampleActor('caller',{offering:'routing',variant},14.4);setRig(actor.joints,pose,14.4);
    const before=Object.values(actor.joints).filter(Boolean).map(j=>j!.object.quaternion.toArray());
    poseRoutingContact(actor.joints,'caller',variant,14.4);
    assert.deepEqual(Object.values(actor.joints).filter(Boolean).map(j=>j!.object.quaternion.toArray()),before);
  }
});
