import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { connectionCurve, makeConnections } from '../../src/components/offerings/OfferingConnectionPaths.ts';
import { OFFERING_CHAPTERS } from '../../src/components/offerings/offeringCatalog.ts';

test('every connection ends exactly at both sockets and wired leads exit along the socket normals',()=>{
  for(const chapter of OFFERING_CHAPTERS)for(const variant of chapter.variants){
    for(const connection of makeConnections({offering:chapter.id,variant:variant.id},true,true)){
      const curve=connectionCurve(connection);
      assert.ok(curve.getPoint(0).distanceTo(new Vector3(...connection.from.point))<1e-6,connection.id);
      assert.ok(curve.getPoint(1).distanceTo(new Vector3(...connection.to.point))<1e-6,connection.id);
      for(const p of curve.getPoints(200))assert.ok(Number.isFinite(p.x+p.y+p.z)&&p.y>.03,`${connection.id} cannot dip through the floor`);
      if(!connection.wireless){
        assert.ok(curve.getTangent(0).dot(new Vector3(...connection.from.normal))>.999,connection.id);
        assert.ok(curve.getTangent(1).dot(new Vector3(...connection.to.normal))<-.999,connection.id);
      }
    }
  }
});
test('the twin uses distinct modeled fiber, phone and LAN sockets, with an internal cellular antenna',()=>{
  const connections=makeConnections({offering:'failover',variant:'fiber'},false,false);
  const wired=connections.filter(link=>link.from.device==='gateway'&&!link.wireless);
  assert.equal(wired.length,5);
  assert.equal(new Set(wired.map(link=>link.from.point.join(','))).size,5);
  for(const link of wired){
    assert.ok(link.from.point[1]>1.4&&link.from.point[1]<2.5);
    assert.ok(link.from.normal[2]>.9,'the rotated rear port bay faces the cable exits');
  }
  const radio=connections.find(link=>link.id==='5g')!;
  assert.equal(radio.wireless,true);
  assert.ok(radio.from.point[1]>2.4&&radio.to.point[1]>3.9);
});
test('both independent camera feeds terminate at the analytics server, with its own CPE uplink',()=>{
  const connections=makeConnections({offering:'video',variant:'man-down'},true,true);
  const feeds=connections.filter(link=>link.id==='camera'||link.id==='camera-back');
  assert.equal(feeds.length,2);
  for(const feed of feeds){assert.equal(feed.to.device,'analytics');assert.equal(feed.lit,true);assert.equal(feed.wireless,undefined);}
  assert.notDeepEqual(feeds[0].to.point,feeds[1].to.point);
  const uplink=connections.find(link=>link.id==='analytics')!;
  assert.equal(uplink.from.device,'gateway');assert.equal(uplink.to.device,'analytics');
  assert.ok(feeds.every(feed=>feed.to.point.join(',')!==uplink.to.point.join(',')));
});
test('an interrupted fiber link retains the physical cable instead of severing its geometry',()=>{
  const healthy=makeConnections({offering:'failover',variant:'fiber'},false,false).find(link=>link.id==='fiber')!;
  const failed=makeConnections({offering:'failover',variant:'fiber'},true,false).find(link=>link.id==='fiber')!;
  assert.equal(failed.failed,true);
  assert.deepEqual(connectionCurve(healthy).getPoints(100),connectionCurve(failed).getPoints(100));
});
test('exploded gateway ports keep their cable ends attached while remote sockets stay fixed',()=>{
  const connections=makeConnections({offering:'twin',variant:'exploded'},true,true);
  for(const link of connections.filter(link=>link.from.device==='gateway')){
    const before=connectionCurve(link,0),after=connectionCurve(link,1);
    if(link.wireless)assert.ok(after.getPoint(0).distanceTo(before.getPoint(0))>.3);
    else assert.ok(after.getPoint(0).distanceTo(before.getPoint(0))<1e-6,'Gemtek ports remain on the fixed base frame');
    assert.ok(after.getPoint(1).distanceTo(before.getPoint(1))<1e-6);
  }
});
