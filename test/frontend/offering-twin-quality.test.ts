import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { offeringPixelRatio } from '../../src/components/offerings/offeringRenderQuality.ts';
import { sampleTwin } from '../../src/components/offerings/OfferingTwinStory.ts';
import { sampleActor } from '../../src/components/offerings/OfferingStoryMotion.ts';
import { connectionCurve, gatewayPort, makeConnections } from '../../src/components/offerings/OfferingConnectionPaths.ts';
import { CONNECTOR_WITHDRAWAL, SERVICE_CART } from '../../src/components/offerings/OfferingEquipment.ts';

test('the raster uses native desktop density, bounded HiDPI and CSS zoom within a 1080p pixel budget',()=>{
  assert.equal(offeringPixelRatio(1000,600,1000,600,1),1);
  assert.equal(offeringPixelRatio(1920,1080,1920,1080,1),1);
  assert.equal(offeringPixelRatio(390,844,390,844,3),1.5);
  assert.ok(Math.abs(offeringPixelRatio(1000,600,1300,780,1)-1.3)<1e-9,'CSS zoom is compensated without mandatory supersampling');
  assert.equal(offeringPixelRatio(3840,2160,3840,2160,1),.5,'4K surfaces respect the same 1080p budget');
  for(const [w,h,dw,dh,native] of [[1000,600,1100,660,1],[1920,1080,2265.6,1274.4,1],[390,844,390,844,3],[3840,2160,3840,2160,2],[1000,600,2000,600,1],[10000,100,10000,100,2]]){
    const ratio=offeringPixelRatio(w,h,dw,dh,native);
    assert.ok(w*h*ratio*ratio<=2_073_600+1e-6,'render area stays within2.0736MP even under nonuniform CSS enlargement');
    assert.ok(Math.max(w,h)*ratio<=4096+1e-6,'extreme aspect ratios also respect the texture-dimension limit');
  }
});

test('the twin log locates a port, a physical check precedes recovery, and reverse seeks restore the fault',()=>{
  assert.equal(sampleTwin(5).stage,'log');
  assert.equal(sampleTwin(8).highlight,true);
  assert.equal(sampleTwin(14.3).unplug,1);
  assert.equal(sampleTwin(15.4).unplug,0);
  assert.equal(sampleTwin(16).stage,'verify');
  assert.equal(sampleTwin(16).resolved,false);
  assert.equal(sampleTwin(17).resolved,true);
  const early=sampleTwin(5);sampleTwin(24);assert.deepEqual(sampleTwin(5),early);
});

test('the operator clears the service cart and workbench, and reaches the actual LAN 1 socket',()=>{
  const port=gatewayPort('pos');
  for(const variant of ['assembled','exploded'])for(let frame=0;frame<=480;frame++){
    const time=frame/20,pose=sampleActor('technician',{offering:'twin',variant},time);
    const [cx,,cz]=SERVICE_CART.at;
    for(const [x0,x1,z0,z1] of [[cx-SERVICE_CART.width/2,cx+SERVICE_CART.width/2,cz-SERVICE_CART.depth/2,cz+SERVICE_CART.depth/2],[5.3,8.7,-3.625,-2.375],[3.4,4.6,-1.5,3.5]]){
      const dx=Math.max(x0-pose.at[0],0,pose.at[0]-x1),dz=Math.max(z0-pose.at[2],0,pose.at[2]-z1);
      // The fitted anatomical body has <.20 m horizontal depth. Actual
      // skin-vs-worktop coverage is verified separately at 40 samples/second.
      assert.ok(Math.hypot(dx,dz)>=.20,`operator intersects furniture at ${time}`);
    }
    if(sampleTwin(time).reach>.9){
      const shoulder=new Vector3(.235,1.38,0).applyAxisAngle(new Vector3(0,1,0),pose.heading).add(new Vector3(...pose.at));
      assert.ok(shoulder.distanceTo(new Vector3(...port.point))<.6,'socket is within arm reach');
    }
  }
});

test('reseating moves only the local plug along its socket normal and preserves the remote cable end',()=>{
  const link=makeConnections({offering:'twin',variant:'assembled'},true,true).find(link=>link.id==='pos')!;
  const seated=connectionCurve(link),out=connectionCurve(link,0,1);
  const delta=out.getPoint(0).sub(seated.getPoint(0));
  assert.ok(Math.abs(delta.length()-CONNECTOR_WITHDRAWAL)<1e-6);
  assert.ok(delta.normalize().dot(new Vector3(...link.from.normal))>.999);
  assert.ok(out.getPoint(1).distanceTo(seated.getPoint(1))<1e-6);
});
