import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBOM,defaults,configurationOptions} from '../src/rules.js';
import {buildScene,componentFrames} from '../src/assembly.js';
import {drawerLayouts,runnerRoles} from '../src/drawer-layout.js';
import datums from '../src/drawer-slot-data.json' with {type:'json'};
import {unitBOM,printedState} from '../src/planner.js';
import {setPrinted,sanitizeState} from '../src/state.js';
import {buildPendingExport} from '../src/pending-export.js';

test('full runners default off, reject non-booleans and preserve legacy quantities',()=>{
 assert.equal(defaults().fullRunners,false);
 assert.equal(configurationOptions.drawer.inputs.find(f=>f.key==='fullRunners').default,false);
 const old={kind:'drawer',w:'S',d:5,h:'4F'};
 assert.deepEqual(buildBOM(old),buildBOM({...old,fullRunners:false}));
 for(const row of buildBOM(old).rows.filter(r=>runnerRoles.has(r.role)))assert.equal(row.qty,2);
 assert.equal(buildBOM({...old,fullRunners:'true'}).complete,false);
});

test('all sizes and packed layouts fill each measured slot once without changing other parts',()=>{
 for(const w of ['S','M','L','XL'])for(const d of [3,4,5,6,7])for(const h of w==='XL'?['1F']:['1F','2F','4F']){
  for(const drawers of [undefined,...drawerLayouts(h)]){
   const config={kind:'drawer',w,d,h,drawers},base=buildScene(config),bom=buildBOM({...config,fullRunners:true}),scene=buildScene({...config,fullRunners:true});
   assert.equal(bom.complete,true);assert.equal(scene.quantityComplete,true,JSON.stringify(config));
   assert.equal(new Set(scene.parts.map(p=>p.key)).size,scene.parts.length);
   assert.deepEqual(scene.parts.slice(0,base.parts.length),base.parts.map(p=>({...p,rowIndex:bom.rows.findIndex(row=>row.id===p.id)})));
   for(const p of scene.parts)assert.equal(bom.rows[p.rowIndex].id,p.id);
   assert.deepEqual(bom.rows.filter(r=>!runnerRoles.has(r.role)),base.bom.rows.filter(r=>!runnerRoles.has(r.role)));
   for(const row of bom.rows){
    assert.equal(scene.parts.filter(p=>p.id===row.id).length,row.qty*componentFrames(row.id).length);
    if(runnerRoles.has(row.role)){
     assert.equal(row.qty,2*parseInt(h));
     const parts=scene.parts.filter(p=>p.id===row.id&&p.copy%2===0),z0=base.parts.find(p=>p.id===row.id&&p.copy===0).position[2];
     const heights=parts.map(p=>p.position[2]).sort((a,b)=>a-b);
     datums[`${w}${d}-${h}`].slotAxes.forEach((axis,i)=>assert.ok(Math.abs(heights[i]-z0-axis+datums[`${w}${d}-${h}`].axisZ)<1e-6));
    }
   }
  }
 }
});

test('extra slides move with their drawer; guides, stoppers and empty slots stay fixed',()=>{
 for(const drawers of [undefined,['2F','2F'],['1F']]){
  const config={kind:'drawer',w:'S',d:5,h:'4F',drawers,fullRunners:true};
  const closed=buildScene(config),open=buildScene(config,{open:1}),shifted=buildScene(config,{origin:[7,8,9]});
  closed.parts.forEach((p,i)=>{
   assert.deepEqual(shifted.parts[i].position,p.position.map((v,j)=>v+[7,8,9][j]));
   if(runnerRoles.has(p.role)){
    if(p.role==='runner-slide'&&p.operates)assert.ok(open.parts[i].move[1]>p.move[1]);
    else assert.deepEqual(open.parts[i].move,p.move);
   }
  });
 }
});

test('progress, saved configuration, extra copy colors and pending exports include full runners',()=>{
 const unit={id:'full',name:'满滑轨',config:{kind:'drawer',w:'S',d:5,h:'4F',fullRunners:true},progress:{},colors:{}};
 const bom=unitBOM(unit),guide=bom.rows.find(r=>r.role==='runner-guide');
 setPrinted(unit,guide.id,3,1);
 const scene=buildScene({...unit.config,id:unit.id}),status=printedState(scene,[unit]);
 assert.equal(scene.parts.filter(p=>p.id===guide.id&&status[p.key].done).length,3);
 const key=scene.parts.find(p=>p.id===guide.id&&p.copy===6).key;unit.colors[key]='#123456';
 assert.deepEqual(buildScene({...unit.config,id:unit.id,colors:unit.colors}).parts.find(p=>p.key===key).color,[0x12/255,0x34/255,0x56/255]);
 const restored=sanitizeState({version:1,units:[unit],activeUnit:unit.id,plans:[]},new Set(bom.rows.map(r=>r.id))).units[0];
 assert.deepEqual(restored,unit);
 const matches=new Map(bom.rows.map(row=>[row.id,{file:new Blob(['model'])}]));
 const pending=buildPendingExport(unit,matches);
 assert.equal(pending.canExport,true);
 assert.equal(pending.entries.find(e=>e.id===guide.id).quantity,5);
 unit.config.fullRunners=false;
 assert.equal(unitBOM(unit).rows.find(r=>r.id===guide.id).qty,2);
 assert.equal(unit.progress[guide.id].printed,3);
});
