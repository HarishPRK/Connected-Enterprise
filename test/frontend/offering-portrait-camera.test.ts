import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { portraitStoryCamera } from '../../src/components/offerings/offeringPortraitCamera.ts';
import { sampleActor, sampleStoryCamera, type StoryContext } from '../../src/components/offerings/OfferingStoryMotion.ts';

function cameraAt(context: StoryContext, time: number, aspect: number) {
  const shot = portraitStoryCamera(context,time,aspect,sampleStoryCamera(context,time));
  const distance = shot.distance * Math.max(1,(shot.distance < 3 ? .65 : 1.25)/Math.max(aspect,.4));
  const yaw = .586 + shot.yaw;
  const target = new Vector3(...shot.target);
  const eye = target.clone().addScaledVector(new Vector3(Math.sin(yaw)*Math.cos(shot.pitch),Math.sin(shot.pitch),Math.cos(yaw)*Math.cos(shot.pitch)),distance);
  const camera = new PerspectiveCamera(40,aspect,.1,250);
  camera.position.copy(eye);camera.lookAt(target);camera.updateMatrixWorld();
  return {camera,eye,target};
}

test('wide frames keep every original shot exactly',()=>{
  const contexts:StoryContext[]=[{offering:'failover',variant:'fiber'},{offering:'video',variant:'man-down'},{offering:'twin',variant:'assembled'}];
  for(const context of contexts)for(let time=0;time<=24;time+=.125){
    const original=sampleStoryCamera(context,time);
    assert.equal(portraitStoryCamera(context,time,1.55,original),original);
  }
});

test('portrait checkout sightline clears the two pendant supports throughout its tracking shot',()=>{
  const context:StoryContext={offering:'failover',variant:'fiber'};
  for(const aspect of [.85,1.05,1.2,1.35])for(let time=1.25;time<2.95;time+=1/48){
    const {eye,target}=cameraAt(context,time,aspect);
    for(const z of[4.5,7]){
      const dx=target.x-eye.x,dz=target.z-eye.z;
      const along=Math.max(0,Math.min(1,((12.78-eye.x)*dx+(z-eye.z)*dz)/(dx*dx+dz*dz)));
      const clearance=Math.hypot(eye.x+along*dx-12.78,eye.z+along*dz-z);
      assert(clearance>.22,`support blocks checkout at ${time}, aspect ${aspect}: ${clearance}`);
    }
  }
});

test('portrait response keeps both the guest and approaching helper in frame',()=>{
  const context:StoryContext={offering:'video',variant:'man-down'};
  for(const aspect of [.85,1.05,1.2,1.35,1.39])for(let time=13.05;time<=24;time+=.1){
    const {camera}=cameraAt(context,time,aspect);
    const helper=sampleActor('staff',context,time).at;
    for(const point of[new Vector3(1.05,.3,6),new Vector3(helper[0],1.1,helper[2])]){
      const projected=point.project(camera);
      assert(Math.abs(projected.x)<.9 && Math.abs(projected.y)<.85 && projected.z<1,`response actor clipped at ${time}, aspect ${aspect}`);
    }
  }
});

test('portrait framing is deterministic when seeking backwards',()=>{
  const context:StoryContext={offering:'video',variant:'man-down'};
  const sample=(time:number)=>portraitStoryCamera(context,time,1.05,sampleStoryCamera(context,time));
  const first=sample(14);
  for(const time of[22,13.05,24,18,14])sample(time);
  assert.deepEqual(sample(14),first);
});
