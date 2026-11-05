import test from 'node:test';
import assert from 'node:assert/strict';
import {validCheckpoint,workspaceRecovery} from '../src/workspace-checkpoint.js';

const pointer='vault-print-studio-model-checkpoint';
function harness(){
  const saved=new Map([[pointer,'previous'],['vault-print-studio-v1','previous-state']]);
  globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  const file=new File(['model'],'original.stl'),matches=new Map([['part',{file,manual:true,quantityByUnit:{unit:2}}]]);
  let release,started;
  const startedPromise=new Promise(r=>started=r),pending=new Promise(r=>release=r);
  const state={version:1,units:[{id:'unit',progress:{part:{printed:1}}}]};
  const recovery=workspaceRecovery({getState:()=>state,getFiles:()=>[file],getMatches:()=>matches,isImporting:()=>false,restore(){},notify(){},persist:async()=>{started();await pending;}});
  return {recovery,saved,matches,state,release,startedPromise};
}
test('checkpoint rejects a mismatched file list without replacing previous recovery',async()=>{
  const h=harness();h.matches.get('part').file=new File(['other'],'other.stl');
  await assert.rejects(h.recovery.prepare(),/清单与当前模型不一致/);
  assert.equal(h.saved.get(pointer),'previous');assert.equal(h.saved.get('vault-print-studio-v1'),'previous-state');
});
test('manual quantities changed during save keep the old recovery and require retry',async()=>{
  const h=harness(),saving=h.recovery.prepare();await h.startedPromise;h.matches.get('part').quantityByUnit.unit=1;h.release();
  await assert.rejects(saving,/人工匹配或打印份数发生变化/);
  assert.equal(h.saved.get(pointer),'previous');assert.equal(h.saved.get('vault-print-studio-v1'),'previous-state');
});
test('model invalidation during save prevents publishing a stale checkpoint',async()=>{
  const h=harness(),saving=h.recovery.prepare();await h.startedPromise;h.recovery.invalidate();h.release();
  await assert.rejects(saving,/模型目录发生变化/);assert.equal(h.saved.has(pointer),false);
  assert.equal(h.saved.get('vault-print-studio-v1'),'previous-state');
});
test('progress edited during blob saving is saved in its latest form',async()=>{
  const h=harness(),saving=h.recovery.prepare();await h.startedPromise;h.state.units[0].progress.part.printed=2;h.release();await saving;
  assert.notEqual(h.saved.get(pointer),'previous');assert.equal(JSON.parse(h.saved.get('vault-print-studio-v1')).units[0].progress.part.printed,2);
});

function pathFile(bytes,name,path,lastModified=123,type='application/octet-stream'){
  const file=new File([new Uint8Array(bytes)],name,{type,lastModified});
  if(path)Object.defineProperty(file,'webkitRelativePath',{value:path,enumerable:true});
  return file;
}
function memoryStorage(t){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const saved=new Map([[pointer,'previous'],['vault-print-studio-v1','previous-state'],['unrelated','keep']]),writes=[];
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:key=>saved.get(key)??null,
    setItem(key,value){writes.push(['set',key,value]);saved.set(key,value);},
    removeItem(key){writes.push(['remove',key]);saved.delete(key);},
    clear(){writes.push(['clear']);saved.clear();},
  }});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
  return {saved,writes};
}
function checkpoint(files){
  return {schema:1,id:'previous',files,manual:[],state:{version:1,units:[{id:'unit',progress:{part:{printed:1}}}]}};
}

// Exercise a real structuredClone boundary. Node may deserialize a File as a
// Blob, so carry its standard File metadata separately and rehydrate it. This
// models loss of custom properties; it is NOT an IndexedDB or Safari test.
function cloneFileBoundary(files){
  return structuredClone(files.map(file=>({blob:file,name:file.name,type:file.type,lastModified:file.lastModified})))
    .map(({blob,name,type,lastModified})=>{
      assert.equal(Object.hasOwn(blob,'webkitRelativePath'),false);
      return blob instanceof File?blob:new File([blob],name,{type,lastModified});
    });
}

test('schema 1 checkpoints without relativePaths still resume with their original File references',async t=>{
  const storage=memoryStorage(t),before=[...storage.saved],files=[pathFile([0,1,255],'legacy.stl','')];
  const data=checkpoint(files);data.manual=[{id:'part',index:0,quantityByUnit:{unit:{qty:1,configKey:'legacy'}}}];
  assert.equal(Object.hasOwn(data,'relativePaths'),false);
  assert.equal(validCheckpoint(data),true);
  const restored=[],notices=[];
  const recovery=workspaceRecovery({getState:()=>data.state,getFiles:()=>[],getMatches:()=>new Map(),isImporting:()=>false,
    read:async id=>{assert.equal(id,data.id);return data;},restore:value=>restored.push(value),notify:message=>notices.push(message)});
  await recovery.resume();
  assert.equal(restored.length,1);
  assert.equal(restored[0].files,files);
  assert.equal(restored[0].files[restored[0].manual[0].index],files[0]);
  assert.deepEqual(restored[0].manual,data.manual);
  assert.deepEqual([...storage.saved],before);assert.deepEqual(storage.writes,[]);
  assert.equal(notices.some(message=>message.includes('暂未完成')),false);
});

test('cloned files recover bytes, standard metadata, order and same-batch manual references through a second save',async t=>{
  const storage=memoryStorage(t),before=[...storage.saved];
  const original=[
    pathFile([0,255,1,128],'same.stl','模型/左/same.stl',1001,'model/stl'),
    pathFile([5,4,3,2,1],'same.stl','模型/右/same.stl',2002),
    pathFile([],'零件.stl','',3003,'model/stl'),
  ];
  const serializedFiles=cloneFileBoundary(original);
  assert.ok(serializedFiles.every(file=>!file.webkitRelativePath));
  const data={...checkpoint(serializedFiles),relativePaths:original.map(file=>file.webkitRelativePath||''),manual:[
    {id:'right',index:1,quantityByUnit:{unit:{qty:2,configKey:'layout'}}},
    {id:'left',index:0,quantityByUnit:{unit:{qty:1,configKey:'layout'}}},
  ]};
  assert.equal(validCheckpoint(data),true);
  let importedFiles=[],currentState=data.state;
  const matches=new Map(),restored=[],persisted=[],notices=[];
  const recovery=workspaceRecovery({getState:()=>currentState,getFiles:()=>importedFiles,getMatches:()=>matches,isImporting:()=>false,
    read:async()=>data,notify:message=>notices.push(message),persist:async value=>persisted.push(value),
    restore(value){
      restored.push(value);importedFiles=value.files;currentState=value.state;
      // Same indexing contract as app.js's recovered.manual loop. prepare()
      // below verifies these references against the actual imported File list.
      for(const entry of value.manual)matches.set(entry.id,{file:value.files[entry.index],manual:true,quantityByUnit:entry.quantityByUnit});
    },
  });
  await recovery.resume();
  assert.equal(restored.length,1);
  assert.equal(importedFiles,restored[0].files);
  assert.equal(importedFiles.length,original.length);
  assert.deepEqual(importedFiles.map(file=>file.webkitRelativePath||''),data.relativePaths);
  for(const [index,file]of importedFiles.entries()){
    assert.ok(file instanceof File);
    assert.equal(file.name,original[index].name);assert.equal(file.type,original[index].type);
    assert.equal(file.lastModified,original[index].lastModified);assert.equal(file.size,original[index].size);
    assert.deepEqual(await file.arrayBuffer(),await original[index].arrayBuffer());
    assert.equal(serializedFiles[index].webkitRelativePath||'','');
  }
  assert.notEqual(importedFiles[0],importedFiles[1]);
  assert.deepEqual(restored[0].manual,data.manual);
  assert.equal(matches.get('right').file,importedFiles[1]);
  assert.equal(matches.get('left').file,importedFiles[0]);
  assert.deepEqual([...storage.saved],before);assert.deepEqual(storage.writes,[]);
  assert.equal(notices.some(message=>message.includes('暂未完成')),false);
  await recovery.prepare(); // Would reject if manual matches use pre-recovery Files.
  assert.equal(persisted.length,1);
  assert.deepEqual(persisted[0].relativePaths,data.relativePaths);
  assert.deepEqual(persisted[0].manual,data.manual);
  for(const [index,file]of persisted[0].files.entries())assert.equal(file,importedFiles[index]);
  assert.equal(storage.saved.get(pointer),persisted[0].id);
  assert.equal(storage.saved.get('unrelated'),'keep');
});

test('prepare snapshots relativePaths in the final identity-deduplicated file order and aligns manual indices',async t=>{
  const storage=memoryStorage(t);
  const left=pathFile([1],'same.stl','包/左/same.stl'),right=pathFile([2],'same.stl','包/右/same.stl'),loose=pathFile([3],'loose.stl','');
  const files=[right,left,right,loose],matches=new Map([
    ['left',{file:left,manual:true,quantityByUnit:{unit:{qty:3,configKey:'left'}}}],
    ['right',{file:right,manual:true,quantityByUnit:{unit:{qty:2,configKey:'right'}}}],
  ]),state={version:1,units:[]},persisted=[];
  const recovery=workspaceRecovery({getState:()=>state,getFiles:()=>files,getMatches:()=>matches,isImporting:()=>false,
    restore(){assert.fail('prepare must not restore');},notify(){},persist:async value=>persisted.push(value)});
  await recovery.prepare();
  assert.equal(persisted.length,1);
  const data=persisted[0];
  assert.equal(data.schema,1);assert.equal(validCheckpoint(data),true);
  assert.equal(data.files.length,3);
  assert.equal(data.files[0],right);assert.equal(data.files[1],left);assert.equal(data.files[2],loose);
  assert.deepEqual(data.relativePaths,['包/右/same.stl','包/左/same.stl','']);
  assert.deepEqual(data.manual.map(({id,index})=>({id,index})),[{id:'left',index:1},{id:'right',index:0}]);
  for(const entry of data.manual)assert.equal(data.files[entry.index],matches.get(entry.id).file);
  assert.equal(storage.saved.get(pointer),data.id);
  assert.deepEqual(JSON.parse(storage.saved.get('vault-print-studio-v1')),state);
});

const invalidPathMetadata=()=>[
  ['null',null],['string','root/file.stl'],['array-like object',{0:'root/a.stl',1:'root/b.stl',length:2}],
  ['too few',[]],['too many',['root/a.stl','root/b.stl','extra.stl']],
  ['non-string member',['root/a.stl',42]],['undefined member',['root/a.stl',undefined]],
  ['oversized member',['root/a.stl','x'.repeat(4097)]],['sparse array',Array(2)],
];

test('validCheckpoint rejects malformed optional relativePaths but allows absent and empty-path entries',()=>{
  const data=checkpoint([pathFile([1],'a.stl',''),pathFile([2],'b.stl','')]);
  assert.equal(validCheckpoint(data),true);
  assert.equal(validCheckpoint({...data,relativePaths:['root/a.stl','']}),true);
  for(const [label,relativePaths]of invalidPathMetadata())assert.equal(validCheckpoint({...data,relativePaths}),false,label);
});

test('malformed path metadata never calls restore or writes localStorage during resume',async t=>{
  for(const [label,relativePaths]of invalidPathMetadata())await t.test(label,async t=>{
    const storage=memoryStorage(t),before=[...storage.saved],restored=[],notices=[];
    const data={...checkpoint([pathFile([1],'a.stl',''),pathFile([2],'b.stl','')]),relativePaths};
    const recovery=workspaceRecovery({getState:()=>data.state,getFiles:()=>[],getMatches:()=>new Map(),isImporting:()=>false,
      // Bypass readCheckpoint to check that resume's path-restoration boundary
      // also rejects corrupt data instead of handing a partial result to app.js.
      read:async()=>data,restore:value=>restored.push(value),notify:message=>notices.push(message)});
    await recovery.resume();
    assert.equal(restored.length,0);
    assert.ok(notices.some(message=>message.includes('暂未完成')));
    assert.deepEqual([...storage.saved],before);assert.deepEqual(storage.writes,[]);
    assert.ok(data.files.every(file=>!file.webkitRelativePath));
  });
});

test('ordinary autosave persists model bytes once; later progress/manual changes reopen from metadata without rewriting models',async t=>{
  const storage=memoryStorage(t),models=new Map(),metadata=new Map(),writes=[];
  const file=pathFile([1,2,3],'model.stl','folder/model.stl'),files=[file],matches=new Map([['part',{file,manual:true,quantityByUnit:{unit:{qty:1}}}]]);
  const state={version:1,units:[{id:'unit',progress:{part:{printed:0}},colors:{}}]};
  const options={getState:()=>state,getFiles:()=>files,getMatches:()=>matches,getCatalogKey:async()=>'catalog-v1',getReport:()=>({}),isImporting:()=>false,notify(){},restore(){},
    persist:async data=>{writes.push('models');models.set(data.id,{...structuredClone({...data,files:[]}),files:cloneFileBoundary(data.files)});},
    persistMetadata:async data=>{writes.push('metadata');metadata.set(data.id,structuredClone(data));},
  };
  const recovery=workspaceRecovery(options);assert.equal(await recovery.save(),true);const id=storage.saved.get(pointer);assert.ok(models.has(id));
  state.units[0].progress.part.printed=2;state.units[0].colors.part='#123456';matches.get('part').quantityByUnit.unit.qty=3;
  assert.equal(await recovery.save(),true);assert.deepEqual(writes,['models','metadata']);assert.equal(Object.hasOwn(metadata.get(id),'files'),false);
  const restored=[];
  const fresh=workspaceRecovery({...options,getFiles:()=>[],getMatches:()=>new Map(),read:async key=>models.get(key),readMetadata:async key=>metadata.get(key),restore:data=>restored.push(data)});
  await fresh.resume();assert.equal(restored.length,1);assert.equal(restored[0].state.units[0].progress.part.printed,2);
  assert.equal(restored[0].state.units[0].colors.part,'#123456');assert.equal(restored[0].manual[0].quantityByUnit.unit.qty,3);
  assert.equal(restored[0].files[0].webkitRelativePath,'folder/model.stl');assert.deepEqual(new Uint8Array(await restored[0].files[0].arrayBuffer()),new Uint8Array([1,2,3]));
  assert.equal(restored[0].cache.catalogKey,'catalog-v1');
});

test('autosave failures keep the previous checkpoint and report that closing would lose unsaved models',async t=>{
  const storage=memoryStorage(t),notices=[];
  const file=pathFile([1],'model.stl',''),recovery=workspaceRecovery({getState:()=>({version:1}),getFiles:()=>[file],getMatches:()=>new Map([['part',{file}]]),isImporting:()=>false,restore(){},notify:message=>notices.push(message),persist:async()=>{throw Error('quota exceeded');}});
  assert.equal(await recovery.save(),false);assert.equal(storage.saved.get(pointer),'previous');assert.ok(notices.some(message=>/自动保存失败.*暂勿关闭/.test(message)));
});

test('clearing during a pending model save cannot republish cached models after the clear',async t=>{
  const storage=memoryStorage(t),file=pathFile([1],'model.stl','');let files=[file],started,release;
  let removed;const cleared=new Promise(resolve=>removed=resolve);
  const began=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>release=resolve),records=new Map();
  const recovery=workspaceRecovery({getState:()=>({version:1}),getFiles:()=>files,getMatches:()=>new Map(files.map(file=>['part',{file}])),isImporting:()=>false,restore(){},notify(){},persist:async data=>{started();await pending;records.set(data.id,data);},remove:async()=>{records.clear();removed();}});
  const saving=recovery.save();await began;files=[];recovery.invalidate({remove:true});release();await saving;
  await cleared;
  assert.equal(storage.saved.has(pointer),false);assert.equal(records.size,0);
});
