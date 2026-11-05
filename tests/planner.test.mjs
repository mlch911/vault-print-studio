import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import * as stateAPI from '../src/state.js';
import * as plannerAPI from '../src/planner.js';
import * as queueAPI from '../src/queue.js';
import * as drawerLayoutAPI from '../src/drawer-layout.js';
import * as directoryInputAPI from '../src/directory-input.js';
import {compositionProblem} from '../src/composition.js';
import books from '../src/manual-library.json' with {type:'json'};
import catalog from '../src/catalog.json' with {type:'json'};
import {buildBOM,defaults,configurationOptions} from '../src/rules.js';
import {buildScene,componentFrames} from '../src/assembly.js';
import {buildComposition} from '../src/composition.js';
import {patterns,moduleConfig,configProblem,layerConfigs,layerChoices,changePlan,unitBOM,effectiveProgress,printProgress,printedState,libraryRows,validateManualPDF} from '../src/planner.js';

const makeUnit=(id,w='L',d=3,h='1F')=>({id,name:id,config:moduleConfig('drawer',w,d,h),progress:{},colors:{}});
const tier=id=>({pattern:'single',ids:[id]});
const identities=rows=>rows.map(r=>r.id).sort();
const byId=new Map(catalog.map(p=>[p.id,p]));

test('planner offers only catalog-backed kind/pattern/depth/height configurations',()=>{
  for(const kind of ['drawer','sustainer'])for(const [pattern]of patterns){
    const choices=layerChoices(kind,pattern);assert.ok(choices.length);
    for(const choice of choices){const configs=layerConfigs({kind,pattern,...choice});assert.ok(configs.length);for(const c of configs)assert.equal(configProblem(c),'');}
    if(pattern==='XL')assert.ok(choices.every(c=>c.h==='1F'));
  }
  assert.deepEqual(layerConfigs({kind:'drawer',pattern:'XL',d:3,h:'4F'}),[]);
  assert.deepEqual(layerConfigs({kind:'drawer',pattern:'L',d:8,h:'1F'}),[]);
  assert.deepEqual(layerConfigs({kind:'mods',pattern:'L',d:3,h:'1F'}),[]);
});

test('deleting any single layer preserves all other layers, module identities and print records',()=>{
  const units=['a','b','c'].map(id=>makeUnit(id)),plan={id:'p',tiers:units.map(u=>tier(u.id))};
  units[1].progress.m0010={printed:2,downloadedAt:'2026-01-01'};
  for(let index=0;index<3;index++){
    const result=changePlan(plan,units,{type:'remove',index});assert.equal(result.error,undefined);
    assert.deepEqual(result.plan.tiers,plan.tiers.filter((_,i)=>i!==index));assert.deepEqual(result.units,units);
    assert.equal(result.units[1].progress,units[1].progress);
  }
  assert.equal(plan.tiers.length,3);
});

test('insertion and reordering obey L=SS, XL=SM and the roof rule without mutation',()=>{
  const units=[makeUnit('l'),makeUnit('s1','S'),makeUnit('s2','S')],plan={id:'p',tiers:[tier('l')]};
  const inserted=changePlan(plan,[units[0]],{type:'insert',index:0,tier:{pattern:'SS',ids:['s1','s2']},units:units.slice(1)});
  assert.equal(inserted.error,undefined);assert.equal(inserted.plan.tiers[0].pattern,'SS');
  assert.equal(changePlan(inserted.plan,inserted.units,{type:'move',index:0,to:1}).error,undefined);
  const cap=makeUnit('cap');cap.config.roof='Grid Roof';
  const capped={id:'p',tiers:[tier('l'),tier('cap')]};
  assert.match(changePlan(capped,[units[0],cap],{type:'move',index:1,to:0}).error,/顶盖/);
  assert.deepEqual(capped.tiers,[tier('l'),tier('cap')]);
  const xl=makeUnit('xl','XL'),s=makeUnit('s','S'),m=makeUnit('m','M');
  assert.equal(changePlan({tiers:[tier('xl')]},[xl],{type:'insert',index:1,tier:{pattern:'SM',ids:['s','m']},units:[s,m]}).error,undefined);
});

test('depth and height edits are transactional and retain progress on accepted changes',()=>{
  const a=makeUnit('a'),b=makeUnit('b'),units=[a,b],plan={id:'p',tiers:[tier('a'),tier('b')]};
  a.progress.m0010={printed:1};
  assert.match(changePlan(plan,units,{type:'edit',index:0,patch:{d:'4'}}).error,/同宽同深/);
  assert.equal(a.config.d,'3');
  const changed=changePlan(plan,units,{type:'edit',index:0,patch:{h:'4F'}});
  assert.equal(changed.error,undefined);assert.equal(changed.units[0].config.h,'4F');assert.equal(changed.units[0].progress,a.progress);assert.equal(a.config.h,'1F');
  const xl=makeUnit('xl','XL');assert.ok(changePlan({tiers:[tier('xl')]},[xl],{type:'edit',index:0,patch:{h:'2F'}}).error);
});

test('default library identities exactly match selected BOM, including universal parts',()=>{
  for(const config of [defaults('drawer'),moduleConfig('sustainer','S',3,'2F'),moduleConfig('sustainer','L',4,'1F')]){
    const rows=libraryRows(config);assert.deepEqual(identities(rows),identities(buildBOM(config).rows));
    assert.ok(rows.some(r=>byId.get(r.id).old.includes(' Universal/')));
  }
});

test('optional drawer library is a BOM union, excludes other sizes, and describes purpose',()=>{
  const config={...moduleConfig('drawer','L',3,'1F'),rails:false,label:false},rows=libraryRows(config,true),base=new Set(identities(buildBOM(config).rows));
  const expected=new Set(base);
  for(const f of configurationOptions.drawer.inputs){if(['w','d','h'].includes(f.key))continue;for(const value of f.type==='boolean'?[true]:f.choices||[]){const b=buildBOM({...config,[f.key]:value});if(!b.errors.length&&!b.missing.length)b.rows.forEach(r=>expected.add(r.id));}}
  assert.deepEqual(new Set(identities(rows)),expected);
  assert.ok(rows.some(r=>!base.has(r.id)&&r.optionalPurpose));
  assert.ok(rows.every(r=>!/^L[4-7] |^XL/.test(byId.get(r.id).name)));
  assert.ok(rows.some(r=>byId.get(r.id).name==='L Rails.stl'));
});

test('optional sustainer library includes size-compatible interior, lid, facade and divider BOMs',()=>{
  const config=moduleConfig('sustainer','L',3,'2F'),rows=libraryRows(config,true),ids=new Set(identities(rows));
  const variants=configurationOptions.sustainer.variants.filter(v=>v.w==='L'&&v.d===3&&v.h==='2F');
  for(const v of variants)assert.ok(ids.has(v.id));
  for(const c of [{...config,facade:'universal'},{...config,interior:'dividers',dividerLayout:'custom',dividers:{width:1,depth:1}},{...config,interior:'sealed',dividerLayout:'custom',dividers:{seal:1}}]){
    const b=buildBOM(c);assert.deepEqual(b.errors,[]);for(const r of b.rows)assert.ok(ids.has(r.id),byId.get(r.id).old);
  }
  assert.ok(rows.every(r=>!/^L[4-7] |^XL/.test(byId.get(r.id).name)));
  assert.equal(ids.size,rows.length);
});

test('mods retain exact selected BOM identities',()=>{
  for(const family of ['trolley','feet','wallMount','base']){const c={...defaults('mods'),family};assert.deepEqual(identities(libraryRows(c,true)),identities(buildBOM(c).rows));}
});

test('printed descriptors track complete STL copies and every component, independently per instance',()=>{
  const a=makeUnit('a','S'),b=makeUnit('b','S'),sa=buildScene({...a.config,id:a.id}),sb=buildScene({...b.config,id:b.id});
  const scene={parts:[...sa.parts,...sb.parts]};assert.equal(new Set(scene.parts.map(p=>p.key)).size,scene.parts.length);
  const runner=buildBOM(a.config).rows.find(r=>r.role==='runner-guide'),pair=buildBOM(a.config).rows.find(r=>r.role==='springs');
  a.progress[runner.id]={printed:1};a.progress[pair.id]={printed:1};let statuses=printedState(scene,[a,b]);
  for(const p of scene.parts){if(p.id===runner.id){assert.equal(statuses[p.key].done,p.instance==='a'&&p.copy===0);assert.equal(statuses[p.key].partial,p.instance==='a');}if(p.id===pair.id)assert.equal(statuses[p.key].done,p.instance==='a');}
  a.progress[runner.id].printed=2;statuses=printedState(scene,[a,b]);assert.ok(sa.parts.filter(p=>p.id===runner.id).every(p=>statuses[p.key].done&&!statuses[p.key].partial));
  a.progress[runner.id].printed=0;statuses=printedState(scene,[a,b]);assert.ok(sa.parts.filter(p=>p.id===runner.id).every(p=>!statuses[p.key].done&&!statuses[p.key].partial));
});

test('paired runner variant needs one file while two unchanged physical descriptors complete and undo together',()=>{
  const u=makeUnit('paired','S'),baseline=buildBOM(u.config),runner=baseline.rows.find(r=>r.role==='runner-guide');
  assert.equal(runner.qty,2);
  const matches=new Map([[runner.id,{variant:{piecesPerFile:2,referencePiecesPerFile:1,previewAligned:true}}]]);
  const row=unitBOM(u,matches).rows.find(r=>r.id===runner.id);
  assert.equal(row.qty,1);assert.equal(row.referenceQty,2);assert.match(row.reason,/每份 STL 含 2 个实体/);assert.match(row.reason,/需要 2 个实体/);assert.match(row.reason,/采样对齐.*不代表机械配合已验证/);
  const scene=buildScene({...u.config,id:u.id}),before=structuredClone(scene),parts=scene.parts.filter(p=>p.id===runner.id);
  assert.equal(parts.length,2);assert.deepEqual(parts.map(p=>p.copy).sort(),[0,1]);
  for(const printed of [1,0]){
    stateAPI.setPrinted(u,runner.id,printed,2);const status=printedState(scene,[u],matches);
    for(const p of parts)assert.deepEqual(status[p.key],{done:printed===1,partial:false,printed,required:1});
  }
  assert.deepEqual(scene,before);assert.equal(buildBOM(u.config).rows.find(r=>r.id===runner.id).qty,2);
});

test('legacy baseline one-of-two remains one physical runner after importing a paired file',()=>{
  const u=makeUnit('legacy','S'),runner=buildBOM(u.config).rows.find(r=>r.role==='runner-guide');
  u.progress[runner.id]={printed:1,downloadedAt:'2026-10-28T00:00:00.000Z'};const before=structuredClone(u.progress);
  const matches=new Map([[runner.id,{variant:{piecesPerFile:2,referencePiecesPerFile:1}}]]),row=unitBOM(u,matches).rows.find(r=>r.id===runner.id),effective=effectiveProgress(u,row);
  assert.equal(row.qty,1);assert.equal(effective.printed,0);assert.equal(effective.remainder,1);assert.equal(effective.physicalDone,1);assert.equal(effective.done,false);assert.match(effective.note,/1\/2 个实体.*不足一整份/);
  const scene=buildScene({...u.config,id:u.id}),status=printedState(scene,[u],matches),parts=scene.parts.filter(p=>p.id===runner.id);
  assert.equal(parts.filter(p=>status[p.key].done).length,1);assert.ok(parts.every(p=>status[p.key].partial));assert.ok(parts.every(p=>status[p.key].printed===0));
  assert.equal(printProgress(u,[row]).done,false);assert.deepEqual(u.progress,before);
  u.progress[runner.id].printed=2;assert.equal(effectiveProgress(u,row).printed,1);assert.equal(effectiveProgress(u,row).done,true);
  assert.ok(parts.every(p=>printedState(scene,[u],matches)[p.key].done));
});

test('one paired-file record becomes two baseline files, survives export, and undoes without losing download state',()=>{
  const u=makeUnit('pair','S'),runner=buildBOM(u.config).rows.find(r=>r.role==='runner-guide');
  stateAPI.downloaded(u,runner.id);stateAPI.setPrinted(u,runner.id,1,2);const downloadedAt=u.progress[runner.id].downloadedAt;
  const state={version:1,units:[u],activeUnit:u.id,plans:[]};const restored=stateAPI.sanitizeState(JSON.parse(JSON.stringify(state)),new Set([runner.id])).units[0];
  const row=unitBOM(restored).rows.find(r=>r.id===runner.id),effective=effectiveProgress(restored,row);
  assert.equal(effective.printed,2);assert.equal(effective.done,true);assert.equal(restored.progress[runner.id].printed,1);assert.equal(restored.progress[runner.id].piecesPerFile,2);
  const scene=buildScene({...restored.config,id:restored.id}),parts=scene.parts.filter(p=>p.id===runner.id);assert.ok(parts.every(p=>printedState(scene,[restored])[p.key].done));
  stateAPI.setPrinted(restored,runner.id,0,1);assert.equal(effectiveProgress(restored,row).printed,0);assert.ok(parts.every(p=>!printedState(scene,[restored])[p.key].done));assert.equal(restored.progress[runner.id].downloadedAt,downloadedAt);
});

test('legacy provenance uses baseline component-frame counts for already paired baseline files',()=>{
  const u=makeUnit('springs','S'),spring=buildBOM(u.config).rows.find(r=>r.role==='springs');assert.equal(componentFrames(spring.id).length,2);
  u.progress[spring.id]={printed:1};const matches=new Map([[spring.id,{variant:{piecesPerFile:1,referencePiecesPerFile:2}}]]),row=unitBOM(u,matches).rows.find(r=>r.id===spring.id);
  const progress=effectiveProgress(u,row);assert.equal(row.qty,2);assert.equal(progress.physicalDone,2);assert.equal(progress.printed,2);assert.equal(progress.done,true);
});

test('variant quantities round up and partial progress maps baseline copies to physical file groups',()=>{
  const u={id:'batch',config:{kind:'mods',family:'wheels',qty:5,stopperOuterDiameter:30},progress:{},colors:{}},row=buildBOM(u.config).rows.find(r=>r.role==='bushing');
  assert.equal(row.qty,5);
  const matches=new Map([[row.id,{variant:{piecesPerFile:2,referencePiecesPerFile:1}}]]);
  assert.equal(unitBOM(u,matches).rows.find(r=>r.id===row.id).qty,3);
  const scene={parts:Array.from({length:5},(_,copy)=>({id:row.id,instance:u.id,copy,component:0,key:`${u.id}:${row.id}:${copy}:0`}))};
  for(const printed of [1,2,3]){
    stateAPI.setPrinted(u,row.id,printed,2);const status=printedState(scene,[u],matches);
    for(const p of scene.parts){assert.equal(status[p.key].done,p.copy<printed*2);assert.equal(status[p.key].partial,printed<3);assert.equal(status[p.key].required,3);}
  }
  matches.get(row.id).variant={piecesPerFile:3,referencePiecesPerFile:2};
  assert.equal(unitBOM(u,matches).rows.find(r=>r.id===row.id).qty,4);
  stateAPI.setPrinted(u,row.id,2,3);const status=printedState(scene,[u],matches);
  for(const p of scene.parts)assert.equal(status[p.key].done,Math.floor(p.copy*2/3)<2);
});

test('variant metadata does not bypass manual confirmation or turn unknown quantities into zero',()=>{
  const u=makeUnit('manual','S'),runner=buildBOM(u.config).rows.find(r=>r.role==='runner-guide');
  const match={manual:true,variant:{piecesPerFile:2,referencePiecesPerFile:1},quantityByUnit:{}},matches=new Map([[runner.id,match]]);
  assert.equal(unitBOM(u,matches).rows.find(r=>r.id===runner.id).qty,null);
  match.quantityByUnit[u.id]={configKey:JSON.stringify(u.config),qty:3};assert.equal(unitBOM(u,matches).rows.find(r=>r.id===runner.id).qty,3);
  const box={id:'box',config:{...moduleConfig('sustainer','S',3,'1F'),lockCount:null},progress:{},colors:{}},unknown=buildBOM(box.config).rows.find(r=>r.qty===null);
  assert.ok(unknown);assert.equal(unitBOM(box,new Map([[unknown.id,{variant:match.variant}]])).rows.find(r=>r.id===unknown.id).qty,null);
});

test('variant notes survive both known and unknown piece counts without inventing unknown quantities',()=>{
  const u=makeUnit('noted','S'),base=buildBOM(u.config).rows.find(r=>r.role==='runner-guide');
  for(const piecesPerFile of [2,null]){
    const variant={piecesPerFile,referencePiecesPerFile:1,note:'原文件布局需人工复核'},row=unitBOM(u,new Map([[base.id,{variant}]])).rows.find(r=>r.id===base.id);
    assert.equal(row.qty,piecesPerFile===null?base.qty:1);assert.equal(row.referenceQty,base.qty);assert.ok(row.reason.includes(variant.note));
    if(piecesPerFile===null)assert.doesNotMatch(row.reason,/每份 STL 含|需要 \d+ 个实体/);
  }
});

test('manual quantity confirmation stays scoped to unit and exact config and blocks false completion',()=>{
  const a=makeUnit('a','S'),b=makeUnit('b','S'),row=buildBOM(a.config).rows[0];a.progress[row.id]={printed:8};
  const matches=new Map([[row.id,{manual:true,quantityByUnit:{a:{configKey:JSON.stringify(a.config),qty:2}}}]]);
  assert.equal(unitBOM(a,matches).rows[0].qty,2);assert.equal(unitBOM(b,matches).rows[0].qty,null);
  assert.equal(printProgress(b,unitBOM(b,matches).rows).pending,true);
  a.config.h='2F';a.config.h='1F';a.config.label=!a.config.label;
  assert.equal(unitBOM(a,matches).rows[0].qty,null);
  const scene=buildScene({...a.config,id:a.id});assert.ok(scene.parts.filter(p=>p.id===row.id).every(p=>!printedState(scene,[a],matches)[p.key].done));
});

test('progress counts file copies, caps restored surplus and requires all quantities known',()=>{
  const u=makeUnit('a');u.progress={one:{printed:9},two:{printed:1}};
  assert.deepEqual(printProgress(u,[{id:'one',qty:2},{id:'two',qty:2}]),{printed:3,required:4,pending:false,done:false});
  assert.equal(printProgress(u,[{id:'one',qty:2}]).done,true);
  assert.equal(printProgress(u,[{id:'one',qty:2},{id:'unknown',qty:null}]).done,false);
});

test('manuals require PDF bytes and enforce the 100 MB cap regardless of extension or MIME',async()=>{
  const file=new Blob(['%PDF-1.7\nlocal manual']);assert.equal(await validateManualPDF(file),file);
  await assert.rejects(validateManualPDF(new Blob(['<html>not PDF</html>'],{type:'application/pdf'})),/PDF/);
  await assert.rejects(validateManualPDF({size:100*1024*1024+1,slice(){throw Error('must not read oversized file');}}),/100 MB/);
  await assert.rejects(validateManualPDF(new Blob(['%PDF'])),/PDF/);
});

// Exercise app event wiring without a browser/server or WebGL. Scene/BOM logic remains real.
async function appHarness({pdfFactory}={}){
  const nodes=new Map(),listeners={},revoked=[],pdfCalls=[],pdfDocs=[],pdfRenders=[],timers=new Map();let timerId=0,canvasId=0;
  function node(id){if(!nodes.has(id))nodes.set(id,{id,value:['library-category','print-filter'].includes(id)?'all':'',checked:id==='library-optional',innerHTML:'',textContent:'',style:{},clientWidth:600,children:[],appendChild(child){this.children.push(child);},getContext(){return {};},dataset:{},options:[],listeners:{},classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.listeners[k]=fn;},querySelector(selector){return node(id+' '+selector);},querySelectorAll(){return [];},closest(selector){return selector==='.manual-view'?node(id+' view'):this;},showModal(){},close(){}});return nodes.get(id);}
  class FakeViewer{
    constructor(canvas,options){this.canvas=canvas;this.options=options;this.calls=[];this.printedCalls=[];}
    async setScene(scene,matches,options){this.calls.push({scene,options});}
    update(scene,mode){this.mode=mode;}
    setPrintedState(status,options){this.printedCalls.push({status,options});}
    selectKeys(keys){this.selectedKeys=keys;}
    fit(){this.fits=(this.fits||0)+1;}
    fitIfNeeded(){this.frameChecks=(this.frameChecks||0)+1;}
    select(){}
    clear(){}
  }
  let urlIndex=0;
  const getDocument=options=>{
    pdfCalls.push(options);if(pdfFactory)return pdfFactory(options);
    const text=new TextDecoder().decode(options.data),pages=Number(text.match(/pages=(\d+)/)?.[1]||3);
    const doc={numPages:pages,destroyed:0,async destroy(){this.destroyed++;},async getPage(number){
      return {getViewport({scale}){return {width:600*scale,height:900*scale};},render(options){pdfRenders.push({number,options});return {promise:Promise.resolve(),cancel(){}};}};
    }};pdfDocs.push(doc);
    return {promise:Promise.resolve(doc),destroy:()=>doc.destroy()};
  };
  const context=createContext({books,AbortController,bundledManual:async()=>{throw Error("offline test");},initUpdates(){},initPendingExport(){},initColorPalette(){return {render(){},close(){}};},workspaceRecovery:()=>({prepare(){},resume(){},invalidate(){}}),...stateAPI,...plannerAPI,...queueAPI,...drawerLayoutAPI,...directoryInputAPI,compositionProblem,catalog,buildBOM,defaults,configurationOptions,buildScene,buildComposition,componentFrames,Viewer:FakeViewer,crypto,structuredClone,Blob,clearGeometry(){},clearThumbnails(){},scanFiles(){},thumbnail(){return Promise.reject(Error('Invalid geometry'));},moduleThumbnail(){return Promise.resolve({url:'data:image/webp;base64,test',missing:0,unresolved:false});},
    getDocument,GlobalWorkerOptions:{},pdfWorkerURL:'/assets/pdf.worker.min.mjs',
    requestAnimationFrame(fn){fn();},document:{getElementById:node,querySelector:node,createElement:tag=>node(tag+'-'+(++canvasId)),querySelectorAll(){return [];},addEventListener(k,fn){listeners[k]=fn;}},window:{devicePixelRatio:3,addEventListener(){}},IntersectionObserver:class{constructor(callback){this.callback=callback;}observe(){}unobserve(){}disconnect(){}},ResizeObserver:class{constructor(callback){this.callback=callback;}observe(){}disconnect(){this.disconnected=true;}},localStorage:{getItem(){return null;},setItem(){}},URL:{createObjectURL(){return 'blob:local-'+(++urlIndex);},revokeObjectURL(url){revoked.push(url);}},setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},clearInterval(){}});
  const manualSource=(await readFile(new URL('../src/manual-viewer.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export class LocalManualViewer','class LocalManualViewer');runInContext(manualSource,context);
  const source=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  runInContext(source,context);
  return {node,listeners,revoked,pdfCalls,pdfDocs,pdfRenders,runTimers(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());},run:code=>runInContext(code,context),flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('selected column depth edit updates both sides and retains progress',async()=>{
 const app=await appHarness();app.run("pickedPattern='SS';pickedHeight='2F';addTier();selectTier(0)");await app.flush();
 app.run("state.units.find(u=>u.id===selectedPlanUnit).progress.m0010={printed:1}");
 app.node('plan-selection [name="edit-kind"]').value='drawer';app.node('plan-selection [name="edit-height"]').value='2F';app.node('plan-selection [name="edit-depth"]').value='4';app.node('plan-selection [name="edit-drawers"]').value='2F';
 app.run('editTier()');await app.flush();
 assert.equal(app.run("currentPlan().tiers[0].ids.every(id=>state.units.find(u=>u.id===id).config.d==='4')"),true);
 assert.equal(app.run('state.units.find(u=>u.id===selectedPlanUnit).progress.m0010.printed'),1);
});

test('clearing models invalidates pending directory reads without restoring stale files',async()=>{
 const app=await appHarness();app.run('globalThis.readPending=new Promise(resolve=>globalThis.finishRead=resolve);globalThis.importCalls=0;importFiles=async()=>{importCalls++};globalThis.acquiring=acquireModels(()=>readPending)');
 assert.equal(app.run('directoryBusy'),true);app.node('clear-models').onclick();
 app.run('finishRead([new Blob(["stale model"])]);');await app.run('acquiring');
 assert.equal(app.run('importCalls'),0);assert.equal(app.run('directoryBusy'),false);assert.equal(app.run('matches.size'),0);
});

test('restoring an uneven bridged combination refuses the file before replacing records',async()=>{
 const app=await appHarness();const a=makeUnit('a','S',3,'1F'),b=makeUnit('b','S',3,'1F'),c=makeUnit('c','S',3,'2F'),l=makeUnit('l','L',3,'1F');
 const data={version:1,units:[a,b,c,l],plans:[{id:'bad',tiers:[{pattern:'SS',ids:['a','b','c'],columns:[['a','b'],['c']]},tier('l')]}],activeUnit:'a',activePlan:'bad'};
 const prior=app.run('JSON.stringify(state)');await app.node('restore-project').onchange({target:{files:[new Blob([JSON.stringify(data)])],value:'test.json'}});
 assert.equal(app.run('JSON.stringify(state)'),prior);
});

test('app selects layers in place, adds with camera preserved, and only finishes on explicit action',async()=>{
  const app=await appHarness();app.run("showTab('combine')");await app.flush();
  app.run('addTier()');await app.flush();assert.equal(app.run('planViewer.calls.at(-1).options.fit'),true);
  app.run('addTier()');await app.flush();assert.equal(app.run('planViewer.calls.at(-1).options.fit'),false);assert.equal(app.run('planViewer.calls.at(-1).options.animate'),true);
  const before=app.run('state.activeUnit'),callCount=app.run('planViewer.calls.length');
  app.run('selectTier(0)');assert.equal(app.run('tab'),'combine');assert.equal(app.run('state.activeUnit'),before);assert.equal(app.run('planViewer.calls.length'),callCount);assert.ok(app.run('planViewer.selectedKeys.length')>0);assert.equal(app.node('plan-selection').hidden,false);
  app.node('plan-finish').listeners.click();await app.flush();assert.equal(app.run('tab'),'config');assert.equal(app.run('state.activeUnit'),app.run('currentPlan().tiers[0].ids[0]'));
});

test('app mark/undo refresh both viewer states and ghost toggle preserves print records',async()=>{
  const app=await appHarness();app.run("mainViewer=makeViewer('stage',{});showTab('combine');addTier()");await app.flush();app.run('finishPlan()');await app.flush();
  app.run('mark(bom.rows[0].id,bom.rows[0].qty)');assert.equal(app.run('Object.values(mainViewer.printedCalls.at(-1).status).some(s=>s.done)'),true);assert.equal(app.run('Object.values(planViewer.printedCalls.at(-1).status).some(s=>s.done)'),true);
  app.node('printed-visibility').listeners.click();assert.equal(app.run('mainViewer.printedCalls.at(-1).options.ghost'),false);assert.equal(app.run('Object.values(mainViewer.printedCalls.at(-1).status).some(s=>s.done)'),true);
  app.run('mark(bom.rows[0].id,0)');assert.equal(app.run('Object.values(planViewer.printedCalls.at(-1).status).some(s=>s.done)'),false);
  app.listeners.click({target:{closest(){return {dataset:{view:'flat'}};}}});assert.equal(app.run('mainViewer.fits||0'),0);
});

test('app preserves physical print progress across runner imports in cards, filters, selection and module completion',async()=>{
  const app=await appHarness();app.run("mainViewer=makeViewer('stage',{})");await app.run('render()');
  app.run("var runner=bom.rows.find(r=>r.role==='runner-guide');downloaded(unit(),runner.id);for(const row of bom.rows)if(row.id!==runner.id)setPrinted(unit(),row.id,row.qty,row.piecesPerFile);mark(runner.id,1);ensurePlan().tiers=[{pattern:'single',ids:[unit().id]}];selectQueueUnit(state,unit().id)");
  assert.equal(app.run('unit().progress[runner.id].piecesPerFile'),1);const record=app.run('JSON.stringify(unit().progress[runner.id])');
  app.run("matches.set(runner.id,{file:new Blob(),variant:{piecesPerFile:2,referencePiecesPerFile:1}})");await app.run('render()');await app.run('renderPlan()');
  assert.equal(app.run('JSON.stringify(unit().progress[runner.id])'),record);assert.equal(app.run('unitComplete(unit())'),false);assert.ok(app.node('module-progress').value<100);
  const card=app.run('card(bom.rows.find(r=>r.id===runner.id))');assert.doesNotMatch(card,/part-card is-complete/);assert.match(card,/已打印 0\/1 份/);assert.match(card,/已完成 1\/2 个实体/);assert.match(card,/不足一整份/);
  app.run('selected=scene.parts.find(p=>p.id===runner.id);refreshSelection()');assert.equal(app.node('selected-print').textContent,'标记已打印 ✓');assert.match(app.node('selected-options').textContent,/不足一整份/);
  app.node('print-filter').value='done';app.run('renderPrint()');assert.ok(!app.node('print-list').innerHTML.includes(`data-part="${app.run('runner.id')}"`));
  assert.equal(app.run('planScene.parts.filter(p=>p.id===runner.id&&planViewer.printedCalls.at(-1).status[p.key].done).length'),1);
  app.run('mark(runner.id,1)');assert.equal(app.run('unit().progress[runner.id].piecesPerFile'),2);assert.equal(app.run('unitComplete(unit())'),true);
  app.run('matches.delete(runner.id)');await app.run('render()');assert.equal(app.run('effectiveProgress(unit(),bom.rows.find(r=>r.id===runner.id)).printed'),2);assert.match(app.run('card(bom.rows.find(r=>r.id===runner.id))'),/value="2" aria-label="[^"]*已打印份数/);
  app.run('mark(runner.id,0)');assert.equal(app.run('unitComplete(unit())'),false);assert.ok(app.run('unit().progress[runner.id].downloadedAt'));assert.equal(app.run('scene.parts.filter(p=>p.id===runner.id&&mainViewer.printedCalls.at(-1).status[p.key].done).length'),0);
});

test('local PDF canvases synchronize pages, clamp shorter documents, and destroy replacements',async()=>{
  const app=await appHarness();await app.run("loadManual('en',new Blob(['%PDF-1.7 English pages=4']))");await app.run("loadManual('zh',new Blob(['%PDF-1.7 Chinese pages=2']))");
  for(const language of ['en','zh']){assert.equal(app.node('manual-'+language+'-frame').src,'about:blank');assert.equal(app.node('manual-'+language+'-frame').style.display,'none');assert.equal(app.run(`manualReaders.${language}.canvas.style.display`),'block');}
  for(const options of app.pdfCalls){assert.equal(options.isEvalSupported,false);assert.equal(options.useWasm,false);assert.equal(options.useSystemFonts,true);assert.equal(options.useWorkerFetch,false);assert.equal(options.url,undefined);assert.equal(options.cMapUrl,undefined);assert.equal(options.standardFontDataUrl,undefined);assert.equal(options.data.constructor.name,'Uint8Array');}
  app.node('manual-next').listeners.click();await app.flush();assert.equal(app.run('manualReaders.en.canvas.dataset.page'),'2');assert.equal(app.run('manualReaders.zh.canvas.dataset.page'),'2');
  app.node('manual-next').listeners.click();await app.flush();assert.equal(app.run('manualReaders.en.canvas.dataset.page'),'3');assert.equal(app.run('manualReaders.zh.canvas.dataset.page'),'2');assert.match(app.node('manual-status').textContent,/已限到末页/);assert.match(app.node('manual-status').textContent,/英文 3\/4/);assert.match(app.node('manual-status').textContent,/中文 2\/2/);
  app.node('manual-page').listeners.change({target:{value:'999'}});await app.flush();assert.equal(app.node('manual-page').value,4);assert.equal(app.node('manual-next').disabled,true);
  const old=app.pdfDocs[0];await app.run("loadManual('en',new Blob(['%PDF-1.7 replacement pages=5']))");assert.equal(old.destroyed,1);assert.equal(app.run('manualReaders.en.canvas.dataset.page'),'4');
  const latest=app.pdfDocs.at(-1);await app.run("loadManual('en',new Blob(['not a PDF']))");assert.equal(latest.destroyed,0);assert.match(app.node('manual-status').textContent,/PDF 加载失败/);
  app.run("showTab('manuals')");await app.flush();assert.equal(app.node('tab-manuals').hidden,false);assert.equal(app.node('tab-config').hidden,true);
});

test('local PDF canvas caps HiDPI at two and eight million pixels with debounced width changes',async()=>{
  const app=await appHarness();await app.run("loadManual('en',new Blob(['%PDF-1.7 pages=2']))");assert.equal(app.run('manualReaders.en.canvas.width'),1200);assert.equal(app.run('manualReaders.en.canvas.height'),1800);
  const before=app.pdfRenders.length;app.run('manualReaders.en.container.clientWidth=3000;manualReaders.en.resizeObserver.callback();manualReaders.en.container.clientWidth=4000;manualReaders.en.resizeObserver.callback()');assert.equal(app.pdfRenders.length,before);
  app.runTimers();await app.flush();assert.equal(app.pdfRenders.length,before+1);assert.ok(app.run('manualReaders.en.canvas.width*manualReaders.en.canvas.height')<=8_000_000);assert.equal(app.run('manualReaders.en.canvas.style.width'),'100%');assert.equal(app.run('manualReaders.en.canvas.style.height'),'auto');
  app.run('manualReaders.en.container.clientWidth=0');await app.run('manualReaders.en.refresh()');const hiddenCount=app.pdfRenders.length;
  app.run('manualReaders.en.container.clientWidth=500;manualReaders.en.resizeObserver.callback()');app.runTimers();await app.flush();assert.equal(app.pdfRenders.length,hiddenCount+1);assert.equal(app.run('manualReaders.en.canvas.width'),1000);
  await app.run('manualReaders.en.destroy()');assert.equal(app.run('manualReaders.en.resizeObserver.disconnected'),true);assert.equal(app.pdfDocs[0].destroyed,1);
});

test('selecting another PDF destroys a pending loading task and ignores its stale result',async()=>{
  let calls=0,cancelled=0,rejectOld;
  const pending=new Promise((_,reject)=>{rejectOld=reject;});
  const doc={numPages:7,async destroy(){},async getPage(){return {getViewport:({scale})=>({width:600*scale,height:900*scale}),render:()=>({promise:Promise.resolve(),cancel(){}})};}};
  const app=await appHarness({pdfFactory:()=>++calls===1?{promise:pending,async destroy(){cancelled++;rejectOld(Error('Loading cancelled'));}}:{promise:Promise.resolve(doc),destroy:()=>doc.destroy()}});
  const old=app.run("loadManual('en',new Blob(['%PDF-1.7 old']))");await app.flush();assert.equal(calls,1);
  await app.run("loadManual('en',new Blob(['%PDF-1.7 new']))");await old;
  assert.equal(cancelled,1);assert.equal(app.run('manualReaders.en.snapshot().pages'),7);assert.equal(app.run('manualReaders.en.snapshot().error'),'');
});

test('replacement cancels an active PDF render before reusing its canvas and destroys the old document',async()=>{
  let calls=0,cancelled=0,active=0,destroyed=0,rejectRender;
  const firstRender=new Promise((_,reject)=>{rejectRender=reject;});
  function doc(first){return {numPages:first?2:5,async destroy(){if(first)destroyed++;},async getPage(){return {
    getViewport:({scale})=>({width:600*scale,height:900*scale}),render(){
      assert.equal(active,0,'one render at a time per canvas');
      if(!first)return {promise:Promise.resolve(),cancel(){}};
      active++;return {promise:firstRender,cancel(){if(active){active--;cancelled++;rejectRender(Object.assign(Error('cancelled'),{name:'RenderingCancelledException'}));}}};
    }
  };}};}
  const app=await appHarness({pdfFactory:()=>{const document=doc(++calls===1);return {promise:Promise.resolve(document),destroy:()=>document.destroy()};}});
  const old=app.run("loadManual('en',new Blob(['%PDF-1.7 old']))");await app.flush();assert.equal(active,1);
  await app.run("loadManual('en',new Blob(['%PDF-1.7 new']))");await old;
  assert.equal(cancelled,1);assert.equal(destroyed,1);assert.equal(active,0);assert.equal(app.run('manualReaders.en.canvas.dataset.pages'),'5');assert.equal(app.run('manualReaders.en.snapshot().error'),'');
});

test('app library starts with the exact current BOM and makes full-catalog browsing explicit',async()=>{
  const app=await appHarness(),shown=()=>[...app.node('library-list').innerHTML.matchAll(/data-part="([^"]+)"/g)].map(m=>m[1]).sort();
  assert.equal(app.node('library-optional').checked,false);app.run("showTab('library')");assert.deepEqual(shown(),identities(buildBOM(defaults('drawer')).rows));
  app.run("changeLibrary({target:{id:'library-width',value:'L'}})");assert.equal(app.node('library-scope').value,'fit');assert.deepEqual(shown(),identities(buildBOM({...defaults('drawer'),w:'L'}).rows));
  app.node('library-scope').value='all';app.run('renderLibrary()');assert.equal(shown().length,catalog.length);assert.ok(shown().includes(catalog.find(p=>p.system==='mods').id));
});

test('variant part preview keeps every source component in one raw coordinate frame',async()=>{
  const app=await appHarness();
  app.run("var runner=buildBOM(unit().config).rows.find(r=>r.role==='runner-guide');matches.set(runner.id,{file:new Blob(),variant:{sourceFrames:[{},{}],bbox:[[-12,5,-2],[91,150,33]],piecesPerFile:2,referencePiecesPerFile:1}})");
  await app.run('preview(runner.id)');
  const result=JSON.parse(app.run('JSON.stringify(partViewer.calls.at(-1))'));
  assert.deepEqual(result.options,{mode:'assembled',raw:true,animate:false});assert.equal(result.scene.parts.length,2);
  assert.deepEqual(result.scene.parts.map(p=>p.component),[0,1]);
  for(const p of result.scene.parts){assert.deepEqual(p.cal.min,[-12,5,-2]);assert.deepEqual(p.cal.max,[91,150,33]);assert.deepEqual(p.cal.center,[0,0,0]);assert.deepEqual(p.position,[0,0,0]);}
});

test('missing files and failed thumbnails render placeholders instead of broken images',async()=>{
  const app=await appHarness();let html=app.run('card(buildBOM(unit().config).rows[0])');
  assert.match(html,/part-missing-placeholder/);assert.doesNotMatch(html,/<img\b/);
  app.run("var row=buildBOM(unit().config).rows.find(r=>r.role==='springs');matches.set(row.id,{file:new Blob(),variant:{piecesPerFile:null,referencePiecesPerFile:2}})");
  html=app.run('card(row)');assert.doesNotMatch(html,/每份含/);
  app.run("var img={dataset:{thumb:row.id},isConnected:true,parentElement:$('test-thumb')};thumbObserver.callback([{isIntersecting:true,target:img}])");await app.flush();
  assert.match(app.node('test-thumb').innerHTML,/part-missing-placeholder/);assert.match(app.node('test-thumb').innerHTML,/模型预览不可用/);assert.doesNotMatch(app.node('test-thumb').innerHTML,/<img\b/);
});

test('completed module chips and mini-layer buttons gain and lose completion classes',async()=>{
  const app=await appHarness();app.run("showTab('combine');pickedPattern='SS';addTier()");await app.flush();
  const finish=index=>app.run(`{const u=state.units.find(u=>u.id===currentPlan().tiers[0].ids[${index}]);for(const row of unitBOM(u,matches).rows)setPrinted(u,row.id,row.qty);renderPlanUI();}`);
  finish(0);assert.equal((app.node('plan-units').innerHTML.match(/unit-chip is-complete/g)||[]).length,1);assert.equal((app.node('plan-grid').innerHTML.match(/<button class="is-complete"/g)||[]).length,1);assert.doesNotMatch(app.node('plan-grid').innerHTML,/class="plan-tier [^"]*is-complete/);
  finish(1);assert.match(app.node('plan-grid').innerHTML,/class="plan-tier [^"]*is-complete/);assert.equal((app.node('plan-units').innerHTML.match(/unit-chip is-complete/g)||[]).length,2);
  app.run('{const u=state.units.find(u=>u.id===currentPlan().tiers[0].ids[0]);setPrinted(u,unitBOM(u,matches).rows[0].id,0);renderPlanUI();}');
  assert.equal((app.node('plan-grid').innerHTML.match(/<button class="is-complete"/g)||[]).length,1);assert.doesNotMatch(app.node('plan-grid').innerHTML,/class="plan-tier [^"]*is-complete/);
});

test('queue workflow: finish chooses first incomplete, completion stays put, explicit next and card undo stay in the selected plan',async()=>{
  const app=await appHarness();app.run("mainViewer=makeViewer('stage',{});showTab('combine');addTier();addTier();var planId=state.activePlan,first=currentPlan().tiers[0].ids[0],second=currentPlan().tiers[1].ids[0];selectedPlanUnit=second;finishPlan()");await app.flush();
  assert.equal(app.run('state.queuePlan'),app.run('planId'));assert.equal(app.run('state.activeUnit'),app.run('first'));
  assert.equal((app.node('module-cards').innerHTML.match(/data-queue-unit=/g)||[]).length,2);
  assert.match(app.node('module-cards').innerHTML,/尚未导入此模块的 STL/);
  app.run('for(const row of [...bom.rows])mark(row.id,row.qty)');assert.equal(app.run('state.activeUnit'),app.run('first'));
  assert.match(app.node('module-cards').innerHTML,/module-card is-selected is-complete/);assert.match(app.node('module-cards').innerHTML,/✓ 已打印/);assert.equal(app.node('module-next').disabled,false);
  app.node('module-next').onclick();await app.flush();assert.equal(app.run('state.activeUnit'),app.run('second'));
  app.node('module-cards').onclick({target:{closest(){return {dataset:{queueUnit:app.run('first')}};}}});await app.flush();app.run('mark(bom.rows[0].id,0)');
  assert.equal(app.run('state.activeUnit'),app.run('first'));assert.doesNotMatch(app.node('module-cards').innerHTML,/is-complete/);assert.match(app.node('module-cards').innerHTML,/aria-pressed="true"/);
  app.run('selectedPlanUnit=second;finishPlan()');await app.flush();assert.equal(app.run('state.activeUnit'),app.run('first'));
});

test('queue duplication and deletion retain independent modules, isolate progress and copy per-instance colors',async()=>{
  const app=await appHarness();app.run("showTab('combine');addTier();finishPlan();var oldPlan=state.queuePlan,oldUnit=state.activeUnit;unit().colors[oldUnit+':m0010:0:0']='#376680';for(const row of bom.rows)setPrinted(unit(),row.id,row.qty)");await app.flush();
  app.node('plan-duplicate').onclick();await app.flush();assert.equal(app.run('state.queuePlan'),app.run('oldPlan'));assert.equal(app.run('state.activeUnit'),app.run('oldUnit'));
  assert.equal(app.run('state.plans.length'),2);app.run('finishPlan()');await app.flush();assert.notEqual(app.run('state.activeUnit'),app.run('oldUnit'));assert.equal(app.run('Object.keys(unit().progress).length'),0);
  assert.equal(app.run("unit().colors[unit().id+':m0010:0:0']"),'#376680');assert.equal(app.run("Object.hasOwn(unit().colors,oldUnit+':m0010:0:0')"),false);
  const count=app.run('state.units.length'),removed=app.run('state.activeUnit');app.node('plan-remove').onclick();await app.flush();
  assert.equal(app.run('state.units.length'),count);assert.equal(app.run('state.queuePlan'),null);assert.equal(app.run('state.activeUnit'),removed);
  assert.match(app.node('queue-plan-select').innerHTML,/独立模块 · 2 个/);assert.equal((app.node('module-cards').innerHTML.match(/data-queue-unit=/g)||[]).length,2);
  assert.equal(app.run('unitComplete(state.units.find(u=>u.id===oldUnit))'),true);
});

test('queue dropdown is separate from combine selection, handles empty plans, new independent module and restore',async()=>{
  const app=await appHarness();app.run("showTab('combine');addTier();finishPlan();var saved=JSON.stringify(state),savedPlan=state.queuePlan,savedUnit=state.activeUnit");await app.flush();
  app.node('plan-new').onclick();await app.flush();const editor=app.run('state.activePlan');assert.notEqual(editor,app.run('savedPlan'));assert.equal(app.run('state.queuePlan'),app.run('savedPlan'));
  app.node('queue-plan-select').onchange({target:{value:editor}});await app.flush();assert.equal(app.node('.workbench').hidden,true);assert.equal(app.node('module-next').disabled,true);assert.equal(app.node('module-cards').innerHTML,'');
  app.node('module-new').onclick();await app.flush();assert.equal(app.run('state.queuePlan'),null);assert.equal(app.run('state.activePlan'),editor);assert.equal(app.node('.workbench').hidden,false);
  app.run("matches.set(buildBOM(state.units.find(u=>u.id===savedUnit).config).rows[0].id,{file:new Blob()})");
  await app.node('restore-project').onchange({target:{files:[new Blob([app.run('saved')])],value:'saved.json'}});await app.flush();
  assert.equal(app.run('state.queuePlan'),app.run('savedPlan'));assert.equal(app.run('state.activeUnit'),app.run('savedUnit'));assert.equal(app.node('.workbench').hidden,false);
  assert.match(app.node('module-cards').innerHTML,/data-module-thumb=/);assert.match(app.node('module-cards').innerHTML,/待打印/);
});

test('failed or cancelled imports cannot replace the active model recovery list',async()=>{
  const app=await appHarness();
  app.run("var original=new Blob(['original']);original.name='original.stl';importedFiles=[original];matches=new Map([['existing',{file:original}]]);scanFiles=async()=>{throw Error('read failed');}");
  await app.run("importFiles([new Blob(['new'])])");
  assert.equal(app.run('importedFiles[0]===original'),true);assert.equal(app.run("matches.get('existing').file===original"),true);
  app.run('var resolveScan;scanFiles=()=>new Promise(resolve=>resolveScan=resolve);var pendingImport=importFiles([original])');
  app.node('clear-models').onclick();
  app.run("resolveScan({matches:new Map([['stale',{file:original}]])})");await app.run('pendingImport');
  assert.equal(app.run('importedFiles.length'),0);assert.equal(app.run('matches.size'),0);assert.equal(app.run('importBusy'),false);
});

test('delete and undo buttons preserve imported models, handle empty state, and exclude plan members',async()=>{
  const app=await appHarness();app.run("var originalId=unit().id;unit().progress.m0010={printed:1};var model=new Blob();matches.set('m0010',{file:model});mainViewer=makeViewer('stage',{});render()");await app.flush();
  app.node('module-new').onclick();await app.flush();assert.equal(app.node('module-delete').hidden,false);const added=app.run('unit().id');
  app.node('module-delete').onclick();await app.flush();assert.equal(app.run('unit().id'),app.run('originalId'));assert.equal(app.run('unit().progress.m0010.printed'),1);assert.equal(app.run("matches.get('m0010').file===model"),true);assert.equal(app.node('module-deleted').hidden,false);
  app.node('module-undo-delete').onclick();await app.flush();assert.equal(app.run('unit().id'),added);assert.equal(app.node('module-deleted').hidden,true);
  app.node('module-delete').onclick();app.node('module-delete').onclick();await app.flush();assert.equal(app.run('state.units.length'),0);assert.equal(app.node('.workbench').hidden,true);assert.equal(app.node('module-delete').hidden,true);
  app.run("showTab('library');syncPreferences()");await app.flush();app.node('module-undo-delete').onclick();await app.flush();assert.equal(app.run('unit().progress.m0010.printed'),1);assert.equal(app.node('.workbench').hidden,false);
  app.run("showTab('combine');addTier();finishPlan()");await app.flush();assert.equal(app.node('module-delete').hidden,true);const count=app.run('state.units.length');app.node('module-delete').onclick();assert.equal(app.run('state.units.length'),count);
});

test('multiselect checks cards without switching the printer, clears on navigation, and deletes as one undo group',async()=>{
  const app=await appHarness();app.run("var initial=unit().id;addUnit(defaults('drawer'));addUnit(defaults('drawer'));var current=unit().id;matches.set('m0010',{file:new Blob()});render()");await app.flush();
  app.node('module-multi').onclick();assert.equal(app.run('batchMode'),true);assert.equal(app.node('module-delete-batch').disabled,true);assert.equal(app.node('module-delete').hidden,true);assert.match(app.node('module-cards').innerHTML,/role="checkbox"/);
  app.node('module-cards').onclick({target:{closest(){return {dataset:{queueUnit:app.run('initial')}};}}});assert.equal(app.run('unit().id'),app.run('current'));assert.equal(app.run('batchSelection.size'),1);
  app.node('module-select-all').onclick();assert.equal(app.run('batchSelection.size'),3);app.node('module-select-none').onclick();assert.equal(app.run('batchSelection.size'),0);
  app.node('module-select-all').onclick();app.node('module-delete-batch').onclick();await app.flush();assert.equal(app.run('state.units.length'),0);assert.equal(app.run('state.deletedBatch.entries.length'),3);assert.equal(app.run('matches.size'),1);assert.equal(app.run('batchMode'),false);
  assert.match(app.node('module-undo-delete').textContent,/3/);app.node('module-undo-delete').onclick();await app.flush();assert.equal(app.run('state.units.length'),3);assert.equal(app.run('unit().id'),app.run('current'));
  app.node('module-multi').onclick();app.node('module-select-all').onclick();app.run("showTab('combine');addTier();finishPlan()");await app.flush();assert.equal(app.run('batchMode'),false);assert.equal(app.run('batchSelection.size'),0);assert.equal(app.node('module-multi').hidden,true);
});
