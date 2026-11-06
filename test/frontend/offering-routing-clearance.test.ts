import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFERING_CHAPTERS } from '../../src/components/offerings/offeringCatalog.ts';
import { sampleActor, STORY_ACTORS } from '../../src/components/offerings/OfferingStoryMotion.ts';
import { isCheckoutStory } from '../../src/components/offerings/OfferingCheckoutStory.ts';
import { sampleRouting } from '../../src/components/offerings/OfferingRoutingStory.ts';

test('every visible actor clears the appropriate furniture footprints throughout all stories', () => {
  // Actual Blender worktops: center x=8, z=4.5/7, width=3.3, depth=1.3.
  // Reserve 32 cm for the torso instead of checking only the actor origin.
  for (const chapter of OFFERING_CHAPTERS) for (const variant of chapter.variants) {
    const context = {offering: chapter.id, variant: variant.id};
    for (const actor of STORY_ACTORS) for (let frame=0;frame<=480;frame++) {
      const pose = sampleActor(actor.id, context, frame / 20);
      if (!pose.visible) continue;
      // Routing replaces the old checkout fixtures with two narrower standing
      // desks. Dense skinned-body/hand checks live in routing-contact.test.ts.
      const furniture=chapter.id==='routing'
        ?[[7.25,8.75,4.08,4.9275],[7.3,8.7,6.65,7.3575]]
        :[4.5,7].map(z=>[6.35,9.65,z-.65,z+.65]);
      for (const [left,right,back,front] of furniture) {
        const dx = Math.max(left-pose.at[0],0,pose.at[0]-right);
        const dz = Math.max(back-pose.at[2],0,pose.at[2]-front);
        assert.ok(Math.hypot(dx,dz) >= (chapter.id==='routing'?.18:.32), `${chapter.id}/${variant.id}/${actor.id}@${frame/20} enters furniture ${back}`);
      }
    }
  }
});

test('routing uses workplace applications without checkout props or link outages', () => {
  for (const variant of ['teams','archive','voice']) {
    const context = {offering:'routing' as const,variant};
    assert.equal(isCheckoutStory(context),false);
    for (const time of [0,4,7,11,18,24]) {
      assert.ok(sampleRouting(time,variant).tunnels.every(tunnel=>tunnel.online));
      for(const actor of STORY_ACTORS){
        const pose=sampleActor(actor.id,context,time);
        if(!pose.visible)continue;
        assert.equal(pose.receipt,0);
        assert.equal(pose.phone,0,'conference phone stays on the desk');
        assert.equal(pose.carry,0);
      }
    }
    assert.equal(sampleActor('shopper',context,7).visible,false);
    assert.equal(sampleActor('staff',context,7).visible,true);
    assert.equal(sampleActor('technician',context,7).visible,true);
  }
});
