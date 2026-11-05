import test from 'node:test';
import assert from 'node:assert/strict';
import {arrangeColorPlates,normalizePlateOptions,filamentPaint} from '../src/print-plates.js';
import {readExportSettings,saveExportSettings} from '../src/export-settings.js';

const object=(objectId,colors,quantity=1,width=30,depth=25)=>({objectId,name:`part ${objectId}`,colors,quantity,bbox:[[100,-20,-5],[100+width,-20+depth,5]]});
function boundsAfterPlacement(o,i){
  const [min,max]=o.bbox,bounds=i.rotation?[[-max[1],min[0],min[2]],[-min[1],max[0],max[2]]]:o.bbox;
  return bounds.map(v=>v.map((n,a)=>n+i.localTranslation[a]));
}
function verifyLayout(objects,layout,width,depth){
  const identities=new Set();
  for(const plate of layout.plates){
    const boxes=plate.instances.map(instance=>{
      const identity=instance.objectId+':'+instance.copy;assert.ok(!identities.has(identity));identities.add(identity);
      const o=objects.find(o=>o.objectId===instance.objectId);assert.ok(instance.copy>=1&&instance.copy<=o.quantity);
      const bounds=boundsAfterPlacement(o,instance);assert.equal(bounds[0][2],0);
      assert.ok(bounds[0][0]>=5&&bounds[0][1]>=5&&bounds[1][0]<=width-5+1e-9&&bounds[1][1]<=depth-5+1e-9);
      assert.deepEqual(instance.translation,instance.localTranslation.map((n,a)=>n+plate.origin[a]));
      assert.deepEqual([...new Set(o.colors)].sort(),plate.colors);return bounds;
    });
    for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++)assert.ok(boxes[a][1][0]+5<=boxes[b][0][0]+1e-9||boxes[b][1][0]+5<=boxes[a][0][0]+1e-9||boxes[a][1][1]+5<=boxes[b][0][1]+1e-9||boxes[b][1][1]+5<=boxes[a][0][1]+1e-9);
  }
  assert.equal(identities.size,objects.reduce((sum,o)=>sum+o.quantity,0));
}

test('color packing separates palettes, spills full plates and preserves quantities and bed-facing direction',()=>{
  const objects=[object(1,['#FF0000'],5),object(2,['#0000FF'],2),object(3,['#FF0000','#0000FF'])];
  const before=structuredClone(objects),options={width:80,depth:70};
  const {plates,instances}=arrangeColorPlates(objects,options);
  assert.deepEqual(objects,before);assert.equal(instances.length,8);assert.equal(plates.length,4);
  assert.deepEqual(instances.filter(i=>i.objectId===1).map(i=>i.copy).sort(),[1,2,3,4,5]);
  for(const plate of plates){
    const boxes=plate.instances.map(i=>{
      const o=objects.find(o=>o.objectId===i.objectId);
      assert.deepEqual([...new Set(o.colors)].sort(),plate.colors);
      const bounds=boundsAfterPlacement(o,i);
      assert.ok(bounds[0][0]>=5&&bounds[0][1]>=5&&bounds[1][0]<=75&&bounds[1][1]<=65);
      assert.equal(bounds[0][2],0);return bounds;
    });
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.ok(boxes[i][1][0]+5<=boxes[j][0][0]||boxes[j][1][0]+5<=boxes[i][0][0]||boxes[i][1][1]+5<=boxes[j][0][1]||boxes[j][1][1]+5<=boxes[i][0][1]);
  }
  assert.deepEqual(plates.map(p=>p.origin),[[0,0,0],[96,0,0],[0,-84,0],[96,-84,0]]);
});

test('planar quarter turns and gap reuse combine rectangles that formerly needed separate rows',()=>{
  const objects=[object(1,['#FFFFFF'],1,40,60),object(2,['#FFFFFF'],1,50,30),object(3,['#FFFFFF'],1,45,25)];
  const layout=arrangeColorPlates(objects,{width:100,depth:100});
  assert.equal(layout.plates.length,1);assert.ok(layout.instances.some(i=>i.rotation===90));verifyLayout(objects,layout,100,100);
  const rotated=arrangeColorPlates([object(1,['#FFFFFF'],1,70,30)],{width:50,depth:90});
  assert.equal(rotated.instances[0].rotation,90);verifyLayout([object(1,['#FFFFFF'],1,70,30)],rotated,50,90);
});

test('S5 packed-drawer footprint regression reduces eight plates to seven and merges white panels with bases',()=>{
  // Dimensions/counts only, taken from the reported export; no model geometry.
  const specs=[[164.80323,201.0091,1,0],[96.55567,74.57813,1,1],[134.19922,227.80011,2,2],[164.79981,94.99878,2,0],[27,227.50153,4,0],[18.22071,202,4,2],[7.75391,17.93348,4,1],[47.47364,75.59546,2,1],[37.79883,13.172,2,0],[9.83985,9.84009,2,0],[45.00098,36.5011,2,2],[121.05372,12.11109,2,1],[47.85743,20.62684,2,0],[125.79883,218.00031,2,0]];
  const colors=['#DDDEDE','#FFA861','#868989'],objects=specs.map(([w,d,qty,color],i)=>object(i+1,[colors[color]],qty,w,d));
  const layout=arrangeColorPlates(objects,{width:256,depth:256});
  assert.equal(layout.plates.length,7);assert.equal(layout.plates.filter(p=>p.colors[0]==='#DDDEDE').length,4);
  assert.equal(layout.plates.filter(p=>p.instances.some(i=>i.objectId===4)&&p.instances.some(i=>i.objectId===14)).length,2);
  verifyLayout(objects,layout,256,256);
});

test('oversized source meshes, invalid beds and more than 36 plates fail explicitly',()=>{
  assert.throws(()=>arrangeColorPlates([object(1,['#FFFFFF'],1,71)],{width:80,depth:70}),/超过所选热床/);
  assert.throws(()=>arrangeColorPlates([object(1,['#FFFFFF'],37,40,40)],{width:50,depth:50}),/36 盘/);
  for(const value of [{width:0},{depth:NaN},{width:Infinity},{nozzle:0},{byColor:'true'}])assert.throws(()=>normalizePlateOptions(value),/有效/);
  assert.equal(filamentPaint(1),'4');assert.equal(filamentPaint(2),'8');assert.equal(filamentPaint(3),'0C');assert.equal(filamentPaint(18),'0FC');assert.equal(filamentPaint(32),'EFC');
});

test('remembered export options validate, survive reload, can be forgotten and tolerate denied storage',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),data=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}});
  try{
    const options={byColor:true,width:350,depth:320,nozzle:0.6};
    assert.equal(readExportSettings(),null);assert.equal(saveExportSettings(options,true),true);
    assert.deepEqual(readExportSettings(),{...options,remember:true});
    saveExportSettings({...options,deviceId:'a1-mini'},true);
    assert.deepEqual(readExportSettings(),{...options,width:180,depth:180,deviceId:'a1-mini',remember:true});
    assert.throws(()=>normalizePlateOptions({...options,deviceId:'missing-device'}),/设备型号/);
    assert.equal(saveExportSettings(options,false),true);assert.equal(readExportSettings(),null);
    data.set('vault-print-studio:export-settings:v1','{"width":-1}');assert.equal(readExportSettings(),null);
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('denied');}});
    assert.equal(readExportSettings(),null);assert.equal(saveExportSettings(options,true),false);
  }finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});
