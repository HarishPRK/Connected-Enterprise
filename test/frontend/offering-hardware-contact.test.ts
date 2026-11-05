import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, SkinnedMesh, Vector3 } from 'three';
import { loadGeometryGlb } from './loadGeometryGlb.ts';
import { PARTS, SERVICE_CART, CONNECTOR_WITHDRAWAL } from '../../src/components/offerings/OfferingEquipment.ts';
import { gatewayPort, connectionCurve, makeConnections } from '../../src/components/offerings/OfferingConnectionPaths.ts';
import { gatewayWristTarget, poseTwinContact, TWIN_OPERATOR } from '../../src/components/offerings/OfferingTwinContact.ts';
import { prepareActor, setRig } from '../../src/components/offerings/OfferingSkinnedActor.ts';
import { sampleActor } from '../../src/components/offerings/OfferingStoryMotion.ts';
import { sampleTwin } from '../../src/components/offerings/OfferingTwinStory.ts';
import { poseConsoleContact, CONSOLE_TOUCH } from '../../src/components/offerings/OfferingConsoleContact.ts';

const directory=new URL('../../src/assets/offerings/',import.meta.url);
const cast=loadGeometryGlb(new URL('enterprise-actors.studio.glb',directory));

test('installed hardware uses metre-scale dimensions against the unchanged cast',async()=>{
  for(const [id,file,height] of [['gateway','gemtek-gateway.glb',.28],['analytics','analytics-server.glb',.42]] as const){
    const gltf=await loadGeometryGlb(new URL(file,directory));
    const part=PARTS.find(p=>p.id===id)!,source=gltf.scene.getObjectByName(part.model)!;
    const box=new Box3().setFromObject(source),size=box.getSize(new Vector3()),wrapper=new Group();
    wrapper.add(source);wrapper.scale.setScalar(part.size/Math.max(...size.toArray()));
    assert(Math.abs(new Box3().setFromObject(wrapper).getSize(new Vector3()).y-height)<1e-6);
  }
  assert.equal(PARTS.find(p=>p.id==='pos')!.size,.36);
  assert.equal(SERVICE_CART.laptopWidth,.36);
  assert(SERVICE_CART.width>.36&&SERVICE_CART.width<.8);
});

test('actual weighted hands and forearms stay outside closed CPE and worktop throughout repair',async()=>{
  const gltf=await cast,actor=prepareActor(gltf.scene.getObjectByName('Technician')!,'Technician','technician');
  const mesh=actor.object.getObjectByName('Technician_Skin_chef') as SkinnedMesh;
  const position=mesh.geometry.attributes.position,vertices:number[]=[];
  for(let i=0;i<position.count;i++)if(Math.abs(position.getX(i))>.17&&position.getY(i)>.69&&position.getY(i)<1.43)vertices.push(i);
  assert(vertices.length>4000,'inspect the actual skin of both hands and forearms');
  const socket=gatewayPort('pos'),plane=new Vector3(...socket.point),normal=new Vector3(...socket.normal);
  let minimum=Infinity;
  for(let frame=0;frame<=192;frame++){
    const time=11.35+frame*.025,pose=sampleActor('technician',{offering:'twin',variant:'ports'},time);
    setRig(actor.joints,pose,time);actor.object.position.fromArray(TWIN_OPERATOR.repair);actor.object.rotation.y=TWIN_OPERATOR.repairHeading;
    poseTwinContact(actor.joints,time);actor.object.updateMatrixWorld(true);mesh.skeleton.update();
    for(const i of vertices){
      const p=mesh.localToWorld(mesh.getVertexPosition(i,new Vector3()));
      const clearance=p.clone().sub(plane).dot(normal);minimum=Math.min(minimum,clearance);
      assert(clearance>0,`skin enters closed housing at ${time.toFixed(3)} s`);
      assert(!(p.x>5.3&&p.x<8.7&&p.z>-3.625&&p.z< -2.375&&p.y>1.02&&p.y<1.1),`skin crosses worktop at ${time.toFixed(3)} s`);
    }
  }
  assert(minimum>.01,`skin/housing clearance ${minimum} m`);
});

test('actual torso and clothing clear the service bench at the authored repair stop',async()=>{
  const gltf=await cast,actor=prepareActor(gltf.scene.getObjectByName('Technician')!,'Technician','technician');
  const surfaces:SkinnedMesh[]=[];actor.object.traverse(node=>{if(node instanceof SkinnedMesh)surfaces.push(node);});
  for(let frame=0;frame<=96;frame++){
    const time=11.35+frame*.05,pose=sampleActor('technician',{offering:'twin',variant:'ports'},time);
    setRig(actor.joints,pose,time);actor.object.position.fromArray(TWIN_OPERATOR.repair);actor.object.rotation.y=TWIN_OPERATOR.repairHeading;
    poseTwinContact(actor.joints,time);actor.object.updateMatrixWorld(true);
    for(const mesh of surfaces){mesh.skeleton.update();for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      const p=mesh.localToWorld(mesh.getVertexPosition(i,new Vector3()));
      assert(!(p.x>5.3&&p.x<8.7&&p.z>-3.625&&p.z< -2.375&&p.y>1.02&&p.y<1.1),`${mesh.name} intersects worktop at ${time}s`);
    }}
  }
});

test('plug withdrawal and wrist use the same absolute connector displacement',()=>{
  const spec=makeConnections({offering:'twin',variant:'ports'},true,true).find(c=>c.id==='pos')!;
  const start=connectionCurve(spec,0,0).getPoint(0),unplugged=connectionCurve(spec,0,1).getPoint(0);
  assert(Math.abs(start.distanceTo(unplugged)-CONNECTOR_WITHDRAWAL)<1e-8);
  const before=gatewayWristTarget(13),during=gatewayWristTarget(14.3),after=gatewayWristTarget(15.3);
  assert.equal(sampleTwin(14.3).unplug,1);
  assert(Math.abs(during.position.distanceTo(before.position)-CONNECTOR_WITHDRAWAL)<1e-8);
  assert(after.position.distanceTo(before.position)<1e-8);
});

test('thumb and index remain on opposite boot faces while the connector withdraws and reseats',async()=>{
  const gltf=await cast,actor=prepareActor(gltf.scene.getObjectByName('Technician')!,'Technician','technician');
  const skin=actor.object.getObjectByName('Technician_Skin_chef') as SkinnedMesh;
  actor.object.updateMatrixWorld(true);skin.skeleton.update();
  const padVertices=['Thumb','Index'].map(digit=>{
    const target=actor.joints[`Right${digit}Pad`]!.object.getWorldPosition(new Vector3());let index=0,minimum=Infinity;
    for(let i=0;i<skin.geometry.attributes.position.count;i++){const distance=skin.getVertexPosition(i,new Vector3()).distanceTo(target);if(distance<minimum){index=i;minimum=distance;}}
    return index;
  });
  const socket=gatewayPort('pos');
  for(let frame=0;frame<=64;frame++){
    const time=12.2+frame*.05,pose=sampleActor('technician',{offering:'twin',variant:'ports'},time);
    setRig(actor.joints,pose,time);actor.object.position.fromArray(TWIN_OPERATOR.repair);actor.object.rotation.y=TWIN_OPERATOR.repairHeading;
    poseTwinContact(actor.joints,time);actor.object.updateMatrixWorld(true);skin.skeleton.update();
    const center=new Vector3(...socket.point).addScaledVector(new Vector3(...socket.normal),.048+sampleTwin(time).unplug*CONNECTOR_WITHDRAWAL);
    const pads=padVertices.map(i=>skin.localToWorld(skin.getVertexPosition(i,new Vector3())));
    assert(Math.abs(pads[0].distanceTo(pads[1])-.0096)<.00001,'opposed skin pads match the boot height: '+pads[0].distanceTo(pads[1])+' at '+time);
    assert(pads[0].clone().lerp(pads[1],.5).distanceTo(center)<.00001,'grip follows the boot without sliding');
  }
});

test('the console index pad reaches its selection point while the hand stays outside rack glass',async()=>{
  const gltf=await cast,actor=prepareActor(gltf.scene.getObjectByName('Technician')!,'Technician','technician');
  const skin=actor.object.getObjectByName('Technician_Skin_chef') as SkinnedMesh;
  const position=skin.geometry.attributes.position,indices:number[]=[];
  for(let i=0;i<position.count;i++)if(position.getX(i)>.17&&position.getY(i)>.69&&position.getY(i)<1.43)indices.push(i);
  for(let frame=0;frame<=140;frame++){
    const time=9.3+frame*.025,pose=sampleActor('technician',{offering:'eagle',variant:'it'},time);
    setRig(actor.joints,{...pose,tablet:0,tap:0},time);actor.object.position.set(9.82,.04,-4.84);actor.object.rotation.y=2.825;
    poseConsoleContact(actor.joints,time);actor.object.updateMatrixWorld(true);skin.skeleton.update();
    for(const i of indices)assert(skin.localToWorld(skin.getVertexPosition(i,new Vector3())).z> -5.391,'arm must not penetrate rack glass');
    if(time>=9.8&&time<=12.2){const pad=actor.joints.RightIndexPad!.object.getWorldPosition(new Vector3());assert(pad.distanceTo(new Vector3(...CONSOLE_TOUCH))<.00001);}
  }
});
