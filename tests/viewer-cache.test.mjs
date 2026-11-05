import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import * as THREE from 'three';
import {createSourceKey,assembledThumbnailKey,ThumbnailQueue} from '../src/navigation.js';
import {buildScene} from '../src/assembly.js';
import {moduleConfig} from '../src/planner.js';
import {frameCorners,interpolateRigid} from '../src/rigid-preview.js';
import {separateRectangles,easeInOut} from '../src/viewer-layout.js';

// Real THREE geometry/materials and Viewer scene/cache code; no WebGL/browser/server.
async function harness({reducedMotion=true}={}){
  const context=createContext({THREE,frames:{},buildScene,createSourceKey,assembledThumbnailKey,ThumbnailQueue,frameCorners,interpolateRigid,separateRectangles,easeInOut,Blob,performance,URL,
    matchMedia:()=>({matches:reducedMotion}),Worker:class{postMessage({key,buffer}){const x=new Uint8Array(buffer)[0]||0;queueMicrotask(()=>this.onmessage({data:{key,resolved:true,parts:[new Float32Array([x,0,0,x+10,0,0,x,20,5])]}}));}}
  });
  let source=await readFile(new URL('../src/viewer.js',import.meta.url),'utf8');
  source=source.replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',"'file:///viewer.js'").replaceAll('export ','');runInContext(source,context);
  runInContext(`function fakeViewer(){const v=Object.create(Viewer.prototype);Object.assign(v,{ticket:0,meshes:[],pinned:[],selectedKeys:new Set(),printStates:{},ghostPrinted:true,mode:'assembled',canvas:{dataset:{},style:{},setAttribute(){}},scene:new THREE.Scene(),group:new THREE.Group(),onStatus(){},camera:new THREE.PerspectiveCamera(35,1.5,.1,100000),controls:{target:new THREE.Vector3(),update(){}},capture(){this.captured=this.meshes.map(m=>({id:m.userData.id,scale:m.scale.toArray(),position:m.position.toArray()}));return 'image';}});v.camera.up.set(0,0,1);viewers.add(v);return v;}
  var part={id:'same',key:'part',copy:0,component:0,cal:{size:[10,20,5],matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[0,0,0],min:[0,0,0]},position:[30,40,50]};`,context);
  return {run:code=>runInContext(code,context),context};
}

test('same-ID geometry versions coexist while pinned; eviction disposes only released geometry',async()=>{
  const h=await harness();await h.run(`var a=fakeViewer(),b=fakeViewer(),fileA=new Blob([new Uint8Array([1])]),fileB=new Blob([new Uint8Array([2])]),variant={previewAligned:true};
    awaitA=a.setScene({parts:[part]},new Map([['same',{file:fileA}]]),{fit:false,animate:false})`);
  await h.run("b.setScene({parts:[part]},new Map([['same',{file:fileB,variant}]]),{fit:false,animate:false})");
  h.run("var ga=a.meshes[0].geometry,gb=b.meshes[0].geometry,disposedA=0,disposedB=0;ga.addEventListener('dispose',()=>disposedA++);gb.addEventListener('dispose',()=>disposedB++)");
  assert.equal(h.run('ga===gb'),false);assert.equal(h.run('ga.attributes.position.array[0]'),1);assert.equal(h.run('gb.attributes.position.array[0]'),2);
  assert.equal(h.run('a.meshes[0].scale.equals(new THREE.Vector3(1,1,1))'),true);assert.deepEqual(Array.from(h.run('a.meshes[0].position.toArray()')),[30,40,50]);
  for(let i=0;i<40;i++)await h.run(`geometryFor('other${i}',new Blob([new Uint8Array([3])]))`);
  h.run('trimCache()');await Promise.resolve();assert.equal(h.run('cache.size'),36);assert.equal(h.run('disposedA+disposedB'),0);
  h.run('a.clear()');await h.run("geometryFor('extra',new Blob([new Uint8Array([4])]))");h.run('trimCache()');await Promise.resolve();
  assert.equal(h.run('disposedA'),1);assert.equal(h.run('disposedB'),0);assert.equal(h.run('pins.size'),1);
  h.run('clearGeometry()');await Promise.resolve();assert.equal(h.run('pins.size'),0);assert.equal(h.run('cache.size'),0);assert.equal(h.run('disposedB'),1);
});

test('bulk material colors update together while keeping printed shading and unrelated components intact',async()=>{
  const h=await harness();
  h.run(`var v=fakeViewer();v.meshes=['done','partial','other'].map(key=>{const mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:'#ffffff'}));mesh.userData={key,originalColor:new THREE.Color('#ffffff')};return mesh;});
    v.setPrintedState({done:{done:true},partial:{partial:true}},{ghost:true});
    v.colorMany(['done','partial'],'#123456');`);
  assert.equal(h.run("v.meshes[0].userData.originalColor.getHexString()"),'123456');
  assert.equal(h.run("v.meshes[1].userData.originalColor.getHexString()"),'123456');
  assert.equal(h.run("v.meshes[2].material.color.getHexString()"),'ffffff');
  assert.equal(h.run("v.meshes[0].material.color.equals(new THREE.Color('#123456').lerp(new THREE.Color('#82909a'),.85))"),true);
  assert.equal(h.run("v.meshes[1].material.color.equals(new THREE.Color('#123456').lerp(new THREE.Color('#ff9a40'),.3))"),true);
  assert.equal(h.run("v.meshes[0].userData.opacityTarget"),.26);assert.equal(h.run('v.canvas.dataset.printedCount'),'1');
  h.run("v.color('other','#abcdef')");assert.equal(h.run('v.meshes[2].material.color.getHexString()'),'abcdef');
});

test('adding out-of-frame layers reframes smoothly without rotating the camera or changing model scale',async()=>{
 const h=await harness({reducedMotion:false});
 await h.run(`var v=fakeViewer();var matches=new Map([['same',{file:new Blob([new Uint8Array([1])])}]]);v.controls.update=()=>{v.camera.lookAt(v.controls.target);v.camera.updateMatrixWorld();};v.camera.position.set(200,300,150);v.controls.update();v.setScene({parts:[part]},matches,{fit:false,animate:false})`);
 h.run(`v.fit({animate:false,preserveDirection:true});var direction=v.camera.position.clone().sub(v.controls.target).normalize(),position=v.camera.position.clone();`);
 assert.equal(h.run('v.fitIfNeeded()'),false);
 await h.run(`v.setScene({parts:[part,{...part,key:'upper',position:[30,40,300]}]},matches,{fit:false,animate:true})`);
 assert.equal(h.run('v.fitIfNeeded()'),true);
 assert.equal(h.run('v.camera.position.equals(position)'),true,'camera must tween rather than jump');
 assert.ok(h.run('v.cameraMotion.to.clone().sub(v.cameraMotion.toTarget).normalize().distanceTo(direction)')<1e-7);
 h.run('v.camera.position.copy(v.cameraMotion.to);v.controls.target.copy(v.cameraMotion.toTarget);v.cameraMotion=null;v.controls.update();');
 assert.equal(h.run('v.fitIfNeeded()'),false);
 assert.equal(h.run('v.meshes.every(m=>m.scale.equals(new THREE.Vector3(1,1,1)))'),true);
 await h.run(`v.setScene({parts:[part]},matches,{fit:false,animate:true})`);
 assert.equal(h.run('v.fitIfNeeded()'),false,'removing a layer must not zoom back in');
});

test('assembled thumbnails use available imported parts, report missing meshes and release every pin after capture',async()=>{
  const h=await harness();h.context.config=moduleConfig('drawer','S','3','1F');
  const result=await h.run(`var thumb=fakeViewer();getThumbnailViewer=()=>thumb;var u={id:'unit',config,colors:{}},s=buildScene({...config,id:u.id}),id=s.parts[0].id;
    moduleThumbnail(u,new Map([[id,{file:new Blob([new Uint8Array([1])])}]]))`);
  assert.equal(result.url,'image');assert.ok(result.missing>0);assert.ok(h.run('thumb.captured.length')>0);
  assert.equal(h.run('thumb.captured.every(m=>m.id===id&&m.scale.every(x=>x===1))'),true);assert.equal(h.run('pins.size'),0);assert.equal(h.run('thumb.meshes.length'),0);
  await assert.rejects(h.run('moduleThumbnail(u,new Map())'),/尚未导入/);
});

test('sustainer operation preserves hinge axes throughout opening and reverses continuously',async()=>{
 const h=await harness({reducedMotion:false});let now=0;h.context.performance={now:()=>now};
 await h.run(`var v=fakeViewer(),config={kind:'sustainer',w:'S',d:'3',h:'1F'},at=value=>buildScene(config,{open:value}),closed=at(0),opened=at(1);
 v.canvas.getClientRects=()=>[{}];v.renderer={render(){}};
 var matches=new Map(closed.parts.map(p=>[p.id,{file:new Blob([new Uint8Array([1])])}]));
 setup=v.setScene(closed,matches,{fit:false,animate:false})`);
 h.run(`var axes=v.meshes.filter(m=>['roof','hinge-top','lock-inner'].includes(m.userData.role)).map(m=>{m.updateMatrixWorld();const pivot=new THREE.Vector3(...m.userData.hinge.pivot);return {key:m.userData.key,pivot,source:m.worldToLocal(pivot.clone())};});
 v.update(opened,'assembled',{operation:{from:0,to:1,at}})`);
 for(now=0;now<=1100;now+=55){
  h.run('v.tick()');
  assert.ok(h.run(`axes.every(a=>{const m=v.meshes.find(m=>m.userData.key===a.key);m.updateMatrixWorld();return m.localToWorld(a.source.clone()).distanceTo(a.pivot)<1e-7;})`));
  assert.ok(h.run(`v.meshes.every(m=>m.scale.equals(new THREE.Vector3(1,1,1)))`));
  if(now===220){assert.equal(h.run(`v.meshes.find(m=>m.userData.role==='roof').userData.hinge.angle`),0);assert.ok(h.run(`v.meshes.find(m=>m.userData.role==='lock-inner').userData.hinge.angle`)>0);}
 }
 assert.equal(h.run('v.operation'),null);
 h.run(`v.update(closed,'assembled',{operation:{from:1,to:0,at}})`);now+=440;h.run('v.tick()');
 const mid=h.run('v.operation.value'),before=Array.from(h.run('v.meshes.find(m=>m.userData.role===\'roof\').position.toArray()'));
 h.run(`v.update(opened,'assembled',{operation:{from:0,to:1,at}})`);assert.equal(h.run('v.operation.from'),mid);h.run('v.tick()');
 const after=Array.from(h.run('v.meshes.find(m=>m.userData.role===\'roof\').position.toArray()'));
 assert.ok(Math.hypot(...before.map((v,i)=>v-after[i]))<1e-7);
 h.run(`v.update(opened,'flat')`);assert.equal(h.run('v.operation'),null);
 h.run(`v.update(opened,'assembled');v.update(closed,'assembled',{operation:{from:1,to:0,at}});v.clear()`);assert.equal(h.run('v.operation'),null);
});

test('reduced-motion opening uses the final rigid pose immediately',async()=>{
 const h=await harness();
 await h.run(`var v=fakeViewer(),at=value=>buildScene({kind:'sustainer',w:'L',d:'3',h:'1F'},{open:value}),s=at(0),files=new Map(s.parts.map(p=>[p.id,{file:new Blob([new Uint8Array([1])])}]));v.setScene(s,files,{fit:false,animate:false})`);
 h.run(`v.update(at(1),'assembled',{operation:{from:0,to:1,at}})`);
 assert.equal(h.run('v.operation'),null);
 assert.ok(h.run('v.meshes.every(m=>!m.userData.motion && m.position.distanceTo(m.userData.target.position)<1e-8)'));
});
