import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/catalog.json' with {type:'json'};
import {buildBOM,defaults} from '../src/rules.js';
import {unitBOM,moduleConfig,effectiveProgress} from '../src/planner.js';
import {setPrinted} from '../src/state.js';
import {buildPendingExport} from '../src/pending-export.js';

const unit=(id='current',config=moduleConfig('drawer','S',3,'1F'))=>({id,name:id,config,progress:{},colors:{}});
const blob=()=>new Blob(['synthetic source; mesh validation belongs to the 3MF writer']);
const matchesFor=u=>new Map(buildBOM(u.config).rows.map(row=>[row.id,{file:blob()}]));
const rowFor=(u,role)=>buildBOM(u.config).rows.find(row=>row.role===role);
const exported=(result,id)=>result.entries.find(entry=>entry.id===id);
function completeOthers(u,matches,id){for(const row of unitBOM(u,matches).rows)if(row.id!==id)setPrinted(u,row.id,row.qty,row.piecesPerFile);}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

test('current BOM exports all required and chosen optional files, independent of names and unrelated matches',()=>{
  const u=unit('one',{...moduleConfig('drawer','S',3,'1F'),baseplate:true,handle:true,label:true}),matches=matchesFor(u),rows=unitBOM(u,matches).rows;
  matches.set('unrelated-part',{file:blob()});
  const result=buildPendingExport(u,matches,catalog);
  assert.equal(result.canExport,true);assert.equal(result.summary.status,'ready');assert.deepEqual(result.issues,[]);
  assert.deepEqual(result.entries.map(x=>x.id),rows.map(x=>x.id));
  assert.equal(result.summary.fileCopies,rows.reduce((n,r)=>n+r.qty,0));
  assert.ok(rows.filter(row=>!row.required).every(row=>exported(result,row.id)));
  for(const entry of result.entries){assert.equal(entry.file,matches.get(entry.id).file);assert.equal(entry.name,catalog.find(x=>x.id===entry.id).zh);}
});

test('partially printed files export remaining copies, while downloaded-only remains unprinted',()=>{
  const u=unit(),matches=matchesFor(u),runner=rowFor(u,'runner-guide'),body=rowFor(u,'body');
  setPrinted(u,runner.id,1,1);u.progress[body.id]={downloadedAt:'2026-11-01T00:00:00Z'};
  const result=buildPendingExport(u,matches,catalog);
  assert.equal(exported(result,runner.id).quantity,1);assert.equal(exported(result,body.id).quantity,1);
});

test('completed rows need no reimport and are omitted; fully complete produces no empty export',()=>{
  const u=unit(),matches=matchesFor(u),body=rowFor(u,'body');setPrinted(u,body.id,1,1);matches.delete(body.id);
  let result=buildPendingExport(u,matches);
  assert.equal(result.canExport,true);assert.equal(exported(result,body.id),undefined);assert.equal(result.summary.completedTypes,1);
  for(const row of unitBOM(u,matches).rows)setPrinted(u,row.id,row.qty,row.piecesPerFile);
  result=buildPendingExport(u,new Map());
  assert.equal(result.canExport,false);assert.equal(result.summary.status,'complete');assert.equal(result.summary.pendingTypes,0);assert.deepEqual(result.issues,[]);assert.deepEqual(result.entries,[]);
});

test('file progress is scoped to the supplied module, including shared universal parts',()=>{
  const a=unit('a'),b=unit('b'),matches=matchesFor(a),spring=rowFor(a,'springs');
  setPrinted(a,spring.id,1,2);
  assert.equal(exported(buildPendingExport(a,matches),spring.id),undefined);
  assert.equal(exported(buildPendingExport(b,matches),spring.id).quantity,1);
});

test('known paired-file version keeps all internal entities and uses one remaining STL copy',()=>{
  const u=unit(),matches=matchesFor(u),runner=rowFor(u,'runner-guide');
  matches.get(runner.id).variant={piecesPerFile:2,referencePiecesPerFile:1};
  let result=buildPendingExport(u,matches);
  assert.equal(exported(result,runner.id).quantity,1);assert.equal(exported(result,runner.id).remainingPieces,2);
  setPrinted(u,runner.id,1,2);result=buildPendingExport(u,matches);
  assert.equal(exported(result,runner.id),undefined);
});

test('partial progress after single-to-pair switch rounds remaining physical demand, not full-file deficit',()=>{
  const u=unit('wheels',{kind:'mods',family:'wheels',qty:5,stopperOuterDiameter:30}),matches=matchesFor(u),bushing=rowFor(u,'bushing');
  matches.get(bushing.id).variant={piecesPerFile:2,referencePiecesPerFile:1};
  setPrinted(u,bushing.id,1,1);
  const row=unitBOM(u,matches).rows.find(r=>r.id===bushing.id),progress=effectiveProgress(u,row);
  assert.equal(row.qty-progress.printed,3); // Naive subtraction overprints by one pair.
  const result=buildPendingExport(u,matches),entry=exported(result,bushing.id);
  assert.equal(entry.quantity,2);assert.equal(entry.remainingPieces,4);assert.equal(entry.extraPieces,0);
});

test('a remaining single entity in a paired STL is explicit and never silently split',()=>{
  const u=unit(),matches=matchesFor(u),runner=rowFor(u,'runner-guide');
  matches.get(runner.id).variant={piecesPerFile:2,referencePiecesPerFile:1};setPrinted(u,runner.id,1,1);
  const result=buildPendingExport(u,matches),entry=exported(result,runner.id);
  assert.equal(entry.quantity,1);assert.equal(entry.remainingPieces,1);assert.equal(entry.extraPieces,1);assert.equal(result.summary.extraPieces,1);
  assert.ok(result.warnings.some(x=>/多出 1 个实体/.test(x)));
});

test('completed physical requirement omits a variant even if rounded whole-file display is lower',()=>{
  const u=unit('wheels',{kind:'mods',family:'wheels',qty:5,stopperOuterDiameter:30}),matches=matchesFor(u),bushing=rowFor(u,'bushing');
  matches.get(bushing.id).variant={piecesPerFile:2,referencePiecesPerFile:1};setPrinted(u,bushing.id,5,1);
  const row=unitBOM(u,matches).rows.find(r=>r.id===bushing.id),progress=effectiveProgress(u,row);
  assert.equal(progress.printed,2);assert.equal(row.qty,3);assert.equal(progress.done,true);
  assert.equal(exported(buildPendingExport(u,matches),bushing.id),undefined);
});

test('pair-to-single change converts the stored physical completion before selecting copies',()=>{
  const u=unit('wheels',{kind:'mods',family:'wheels',qty:5,stopperOuterDiameter:30}),matches=matchesFor(u),bushing=rowFor(u,'bushing');
  setPrinted(u,bushing.id,1,2);
  assert.equal(exported(buildPendingExport(u,matches),bushing.id).quantity,3);
});

test('missing pending geometry blocks the entire package instead of producing partial output',()=>{
  const u=unit(),matches=matchesFor(u),body=rowFor(u,'body');matches.delete(body.id);
  const result=buildPendingExport(u,matches);
  assert.equal(result.canExport,false);assert.equal(result.summary.status,'blocked');assert.deepEqual(result.entries,[]);
  assert.ok(result.previewEntries.length);assert.ok(result.issues.some(x=>/尚未导入/.test(x)));
});

test('empty and unreadable sources are blocked',()=>{
  for(const file of [new Blob(),{},null]){
    const u=unit(),matches=matchesFor(u);matches.get(rowFor(u,'body').id).file=file;
    assert.ok(buildPendingExport(u,matches).issues.some(x=>/可读取/.test(x)));
  }
});

test('manual quantities are tied to exact unit and configuration and must be confirmed',()=>{
  const u=unit(),matches=matchesFor(u),runner=rowFor(u,'runner-guide'),m=matches.get(runner.id);
  m.manual=true;m.quantityByUnit={};
  assert.ok(buildPendingExport(u,matches).issues.some(x=>/STL 份数/.test(x)));
  m.quantityByUnit[u.id]={configKey:JSON.stringify(u.config),qty:3};
  let result=buildPendingExport(u,matches);
  assert.equal(exported(result,runner.id).quantity,3);assert.equal(exported(result,runner.id).piecesPerFile,null);
  setPrinted(u,runner.id,1,null);result=buildPendingExport(u,matches);
  assert.equal(exported(result,runner.id).quantity,2);
  assert.equal(buildPendingExport({...u,id:'other'},matches).canExport,false);
  u.config.label=!u.config.label;assert.equal(buildPendingExport(u,matches).canExport,false);
});

test('known-to-unknown or unknown-to-known progress cannot be silently discarded',()=>{
  for(const type of ['known-to-unknown','unknown-to-known']){
    const u=unit(),matches=matchesFor(u),runner=rowFor(u,'runner-guide'),m=matches.get(runner.id);
    if(type==='known-to-unknown'){m.manual=true;m.quantityByUnit={[u.id]:{configKey:JSON.stringify(u.config),qty:2}};setPrinted(u,runner.id,1,1);}
    else setPrinted(u,runner.id,1,null);
    const result=buildPendingExport(u,matches);assert.equal(result.canExport,false);assert.deepEqual(result.entries,[]);assert.ok(result.issues.some(x=>/无法换算/.test(x)));
  }
});

test('unknown variant entity counts require manual confirmation even if a reference quantity exists',()=>{
  const u=unit(),matches=matchesFor(u),runner=rowFor(u,'runner-guide');matches.get(runner.id).variant={piecesPerFile:null,referencePiecesPerFile:1};
  const result=buildPendingExport(u,matches);assert.equal(result.canExport,false);assert.ok(result.issues.some(x=>/实体数未知/.test(x)));
});

test('zero printed copies with unknown prior provenance do not block a now-known source',()=>{
  const u=unit(),matches=matchesFor(u),runner=rowFor(u,'runner-guide');
  setPrinted(u,runner.id,0,null);
  const result=buildPendingExport(u,matches);
  assert.equal(result.canExport,true);assert.equal(exported(result,runner.id).quantity,runner.qty);
});

test('variants marked requiresConfirmation do not bypass an explicit manual quantity decision',()=>{
  const u=unit(),matches=matchesFor(u),runner=rowFor(u,'runner-guide'),m=matches.get(runner.id);
  m.variant={piecesPerFile:2,referencePiecesPerFile:1,requiresConfirmation:true};
  assert.ok(buildPendingExport(u,matches).issues.some(x=>/文件版本需人工确认/.test(x)));
  m.manual=true;m.quantityByUnit={[u.id]:{configKey:JSON.stringify(u.config),qty:1}};
  assert.equal(exported(buildPendingExport(u,matches),runner.id).quantity,1);
});

test('unresolved configuration inputs and invalid BOM block even with every source available',()=>{
  const u=unit('mods',defaults('mods')),matches=matchesFor(u);
  const result=buildPendingExport(u,matches);assert.equal(result.canExport,false);assert.ok(result.issues.some(x=>/确认配置/.test(x)));assert.deepEqual(result.entries,[]);
  u.config={kind:'drawer',w:'XL',d:3,h:'4F'};
  assert.ok(buildPendingExport(u,matches).issues.some(x=>/配置错误/.test(x)));
});

test('surplus recorded prints do not generate negative quantities',()=>{
  const u=unit(),matches=matchesFor(u),runner=rowFor(u,'runner-guide');setPrinted(u,runner.id,100,1);
  assert.equal(exported(buildPendingExport(u,matches),runner.id),undefined);
});

test('corrupt progress values are reported rather than normalized away',()=>{
  for(const record of [null,false,1,[],{printed:-1},{printed:1.5},{printed:'1'},{printed:Infinity},{printed:1,piecesPerFile:0}]){
    const u=unit(),matches=matchesFor(u);u.progress[rowFor(u,'body').id]=record;
    const result=buildPendingExport(u,matches);assert.equal(result.canExport,false);assert.ok(result.issues.some(x=>/记录.*无效/.test(x)));
  }
});

test('read-only planning preserves all configuration, progress, source and manual match objects',async()=>{
  const u=unit(),matches=matchesFor(u),runner=rowFor(u,'runner-guide');setPrinted(u,runner.id,1,1);
  const original=structuredClone(u),before=[...matches].map(([id,m])=>[id,m, m.file]),bytes=await matches.get(runner.id).file.text();
  freeze(u);for(const m of matches.values())Object.freeze(m);
  const result=buildPendingExport(u,matches);assert.equal(result.canExport,true);assert.deepEqual(u,original);
  for(const [id,m,file]of before){assert.equal(matches.get(id),m);assert.equal(m.file,file);}
  assert.equal(await matches.get(runner.id).file.text(),bytes);
});

test('identical file objects under another catalog alias never pull another configuration into export',()=>{
  const u=unit('s6',moduleConfig('sustainer','S',6,'1F'));u.config.roof='split';u.config.splitRoofConnectorQty=2;
  const matches=matchesFor(u),row=rowFor(u,'split-roof-connector'),file=matches.get(row.id).file;
  const alias=catalog.find(p=>p.name==='Connector For Split Roof.stl'&&p.id!==row.id);
  matches.set(alias.id,{file});
  const result=buildPendingExport(u,matches);assert.equal(result.canExport,true);assert.equal(exported(result,row.id).quantity,2);assert.equal(exported(result,alias.id),undefined);
});

test('invalid current-unit input reports a clear issue without throwing',()=>{
  for(const u of [undefined,null,{},unit('',{}),{...unit(),progress:[]}])assert.equal(buildPendingExport(u).canExport,false);
});
