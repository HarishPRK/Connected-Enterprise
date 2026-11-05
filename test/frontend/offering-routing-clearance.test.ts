import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFERING_CHAPTERS } from '../../src/components/offerings/offeringCatalog.ts';
import { sampleActor, STORY_ACTORS } from '../../src/components/offerings/OfferingStoryMotion.ts';
import { isCheckoutStory } from '../../src/components/offerings/OfferingCheckoutStory.ts';
import { makeConnections } from '../../src/components/offerings/OfferingConnectionPaths.ts';
import { sampleRouting } from '../../src/components/offerings/OfferingRoutingStory.ts';

test('every visible actor clears both counter footprints throughout all stories', () => {
  // Actual Blender worktops: center x=8, z=4.5/7, width=3.3, depth=1.3.
  // Reserve 32 cm for the torso instead of checking only the actor origin.
  for (const chapter of OFFERING_CHAPTERS) for (const variant of chapter.variants) {
    const context = {offering: chapter.id, variant: variant.id};
    for (const actor of STORY_ACTORS) for (let frame=0;frame<=480;frame++) {
      const pose = sampleActor(actor.id, context, frame / 20);
      if (!pose.visible) continue;
      for (const z of [4.5, 7]) {
        const dx = Math.max(6.35-pose.at[0],0,pose.at[0]-9.65);
        const dz = Math.max(z-.65-pose.at[2],0,pose.at[2]-z-.65);
        assert.ok(Math.hypot(dx,dz) >= .32, `${chapter.id}/${variant.id}/${actor.id}@${frame/20} enters counter ${z}`);
      }
    }
  }
});

test('application policy keeps healthy links active and never becomes another checkout story', () => {
  for (const variant of ['voice','stock','video']) {
    const context = {offering:'routing' as const,variant};
    assert.equal(isCheckoutStory(context),false);
    for (const time of [0,4,7,11,18,24]) {
      const links=makeConnections(context,time>=4,time>=10);
      assert.ok(links.every(link=>!link.failed));
      assert.equal(links.find(link=>link.id==='fiber')?.lit,true);
      assert.equal(links.find(link=>link.id==='5g')?.lit,time>=10);
      assert.equal(sampleActor('shopper',context,time).receipt,0);
    }
  }
  assert.equal(sampleRouting(7).voice,'Fiber');
  assert.equal(sampleRouting(11).voice,'5G');
  assert.equal(sampleRouting(11).stock,'Queued');
  assert.equal(sampleRouting(18).stock,'Syncing · Fiber');
  const initial=sampleRouting(7);
  sampleRouting(24);
  assert.deepEqual(sampleRouting(7),initial);
});
