import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshStandardMaterial, SkinnedMesh, Vector3 } from 'three';
import { prepareActor, setRig, reachReader } from '../../src/components/offerings/OfferingSkinnedActor.ts';
import { sampleActor, type ActorRole } from '../../src/components/offerings/OfferingStoryMotion.ts';

async function loadCast() {
  const raw=await fs.readFile(new URL('../../src/assets/offerings/enterprise-actors.studio.glb',import.meta.url));
  const length=raw.readUInt32LE(12),json=JSON.parse(raw.subarray(20,20+length).toString());
  // Geometry, original inverse-bind matrices and bones are loaded by Three's
  // real GLTFLoader. Strip only image references for the Node test environment.
  for(const material of json.materials) {
    if(material.pbrMetallicRoughness)delete material.pbrMetallicRoughness.baseColorTexture;
    delete material.normalTexture;delete material.emissiveTexture;delete material.occlusionTexture;
  }
  const body=Buffer.from(JSON.stringify(json));
  const padded=Buffer.concat([body,Buffer.alloc((4-body.length%4)%4,32)]);
  const binary=raw.subarray(28+length);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);
  header.writeUInt32LE(28+padded.length+binary.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length);binHeader.writeUInt32LE(0x004e4942,4);
  const data=Buffer.concat([header,padded,binHeader,binary]);
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
}
const cast=loadCast();

test('anatomical cast keeps independent skeletons and the established CE contact pivots',async()=>{
  const gltf=await cast,source=gltf.scene.getObjectByName('Customer')!;
  const a=prepareActor(source,'Customer','shopper'),b=prepareActor(source,'Customer','queue1');
  const skinA=a.object.getObjectByName('Customer_Skin_guest') as SkinnedMesh;
  const skinB=b.object.getObjectByName('Customer_Skin_guest') as SkinnedMesh;
  assert.ok(skinA.isSkinnedMesh&&skinB.isSkinnedMesh);
  assert.notEqual(skinA.skeleton,skinB.skeleton);
  assert.notEqual(skinA.skeleton.bones[0],skinB.skeleton.bones[0]);
  assert.equal(skinA.geometry,skinB.geometry,'clones share immutable geometry');
  a.object.updateMatrixWorld(true);
  const elbow=a.joints.RightForearm!.object.getWorldPosition(new Vector3());
  assert(elbow.distanceTo(new Vector3(.265,1.115,0))<.000001);
  const before=b.joints.RightForearm!.object.quaternion.clone();
  reachReader(a.joints,1,'Right',[.18,1.35,.48]);
  assert(b.joints.RightForearm!.object.quaternion.equals(before));
  assert.equal((skinA.material as MeshStandardMaterial).metalness,0);
});

test('short-sleeve uniforms keep anatomical skin underneath their hems',async()=>{
  const gltf=await cast;
  for(const [role,part] of [['Staff','crew'],['Technician','chef'],['Security','customer']]) {
    const mesh=gltf.scene.getObjectByName(role+'_Skin_'+part) as SkinnedMesh;
    const position=mesh.geometry.attributes.position;
    let coverage=0;
    for(let i=0;i<position.count;i++)if(Math.abs(position.getX(i))>.15&&position.getY(i)>1.15&&position.getY(i)<1.32)coverage++;
    assert(coverage>120,`${role} must retain upper-arm skin under the short sleeve`);
  }
});

test('actual weighted surfaces remain finite and deterministic under walk, kneel and reader IK',async()=>{
  const gltf=await cast;
  for(const role of ['Customer','Staff','Technician','Security'] as ActorRole[]){
    const actor=prepareActor(gltf.scene.getObjectByName(role)!,role,role==='Customer'?'shopper':'staff');
    const meshes:SkinnedMesh[]=[];actor.object.traverse(node=>{if(node instanceof SkinnedMesh)meshes.push(node);});
    assert.equal(meshes.length,7);
    const sample=(t:number,kneel:boolean)=>{
      const pose=sampleActor(kneel?'staff':'shopper',kneel?{offering:'video',variant:'man-down'}:{offering:'failover',variant:'fiber'},t);
      setRig(actor.joints,pose,t);
      if(!kneel)reachReader(actor.joints,.7,'Right',[.15,1.38,.46]);
      actor.object.updateMatrixWorld(true);meshes.forEach(mesh=>mesh.skeleton.update());
      const values:number[]=[];
      for(const mesh of meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i+=19){
        const vertex=mesh.getVertexPosition(i,new Vector3());
        assert(vertex.toArray().every(Number.isFinite));
        assert(vertex.length()<3,'skin cannot explode away from its actor');
        values.push(...vertex.toArray());
      }
      return values;
    };
    const first=sample(3,false);sample(22,true);sample(14,false);
    assert.deepEqual(sample(3,false),first,'reverse seeking reconstructs the same skin pose');
  }
});

test('tablet underside rests on the rotated anatomical palm',async()=>{
  const gltf=await cast,actor=prepareActor(gltf.scene.getObjectByName('Staff')!,'Staff','staff');
  const pose={...sampleActor('staff',{offering:'eagle',variant:'it'},22),tablet:1};
  setRig(actor.joints,pose,22);actor.object.updateMatrixWorld(true);
  const palm=actor.joints.LeftHand!.object.localToWorld(new Vector3(0,-.06,.012));
  const underside=actor.joints.Tablet!.object.localToWorld(new Vector3(0,-.01,-.015));
  assert(palm.distanceTo(underside)<.035,`tablet support error ${palm.distanceTo(underside)}m`);
});
