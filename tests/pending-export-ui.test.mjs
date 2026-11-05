import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import catalog from '../src/catalog.json' with {type:'json'};
import {buildBOM} from '../src/rules.js';
import {moduleConfig,unitBOM} from '../src/planner.js';
import {setPrinted} from '../src/state.js';
import {buildPendingExport} from '../src/pending-export.js';
import {DEFAULT_PLATE_OPTIONS,normalizePlateOptions} from '../src/print-plates.js';
import {PRINT_DEVICES} from '../src/print-devices.js';
import {BAMBU_MATERIALS,bambuPresetReference} from '../src/bambu-presets.js';

function fixture(){
  const unit={id:'current',name:'S3:当前/模块',config:moduleConfig('drawer','S',3,'1F'),progress:{},colors:{}};
  const matches=new Map(buildBOM(unit.config).rows.map(row=>[row.id,{file:new Blob(['unchanged local STL fixture'])}]));
  return {unit,matches};
}

// Only DOM/download and asynchronous mesh packaging are replaced. Actual BOM,
// progress conversion, pending selection and production UI event wiring run here.
async function harness({unit,matches,deferred=false,honorAbort=true,savedSettings=null,storageWorks=true}={}){
  ({unit,matches}=unit?{unit,matches}:fixture());
  const nodes=new Map(),jobs=[],downloads=[],urls=[],revoked=[],timers=[],notifications=[],settingsWrites=[];
  let importing=false;
  function makeNode(tag,id=''){
    return {tagName:tag.toUpperCase(),id,children:[],listeners:{},attributes:{},disabled:false,hidden:false,open:false,value:0,_text:'',parentElement:null,
      set textContent(value){this._text=String(value);this.children=[];},
      get textContent(){return this._text+this.children.map(child=>child.textContent).join('');},
      append(...children){for(const child of children)this.appendChild(child);},
      appendChild(child){child.parentElement=this;this.children.push(child);return child;},
      replaceChildren(...children){this._text='';this.children=[];this.append(...children);},
      setAttribute(key,value){this.attributes[key]=String(value);},
      addEventListener(type,callback){this.listeners[type]=callback;},
      fire(type='click'){return this.listeners[type]?.({type,target:this,preventDefault(){}});},
      click(){if(this.disabled)return;if(this.tagName==='A')downloads.push({filename:this.download,url:this.href});return this.fire();},
      showModal(){this.open=true;},
      close(){if(this.open){this.open=false;this.fire('close');}},
      remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;},
    };
  }
  const node=id=>{if(!nodes.has(id))nodes.set(id,makeNode(id==='pending-export-dialog'?'dialog':'div',id));return nodes.get(id);};
  const body=makeNode('body');
  const export3MF=(entries,options)=>new Promise((resolve,reject)=>{
    const finish=(callback,value)=>{options.signal.removeEventListener('abort',aborted);callback(value);};
    const job={entries,options,resolve(){finish(resolve,{blob:new Blob(['synthetic packaged 3MF'],{type:'model/3mf'}),manifest:{totalQuantity:entries.reduce((n,r)=>n+r.quantity,0)}});},reject(error){finish(reject,error);}};
    const aborted=()=>{if(honorAbort)job.reject(options.signal.reason);};
    jobs.push(job);options.signal.addEventListener('abort',aborted,{once:true});
    if(!deferred)job.resolve();
  });
  const context=createContext({buildPendingExport,export3MF,catalog,AbortController,DOMException,Blob,DEFAULT_PLATE_OPTIONS,normalizePlateOptions,PRINT_DEVICES,BAMBU_MATERIALS,bambuPresetReference,
    readExportSettings:()=>savedSettings,saveExportSettings:(options,remember)=>{settingsWrites.push({options,remember});return storageWorks;},
    getUnit:()=>unit,getMatches:()=>matches,isImporting:()=>importing,notify:message=>notifications.push(message),
    document:{getElementById:node,createElement:tag=>makeNode(tag),body},
    URL:{createObjectURL(blob){const url='blob:local-'+urls.length;urls.push({url,blob});return url;},revokeObjectURL(url){revoked.push(url);}},
    setTimeout(callback,delay){timers.push({callback,delay});},
  });
  const source=(await readFile(new URL('../src/pending-export-ui.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function initPendingExport','function initPendingExport');
  runInContext(source,context);
  runInContext('initPendingExport({getUnit,getMatches,catalog,isImporting,notify})',context);
  return {unit,matches,node,jobs,downloads,urls,revoked,timers,notifications,settingsWrites,body,setImporting:value=>{importing=value;}};
}

test('preview uses current pending quantities and download is a named 3MF without changing progress',async()=>{
  const {unit,matches}=fixture(),rows=unitBOM(unit,matches).rows,runner=rows.find(row=>row.role==='runner-guide'),body=rows.find(row=>row.role==='body');
  setPrinted(unit,runner.id,1,1);setPrinted(unit,body.id,1,1);
  const before=structuredClone(unit.progress),expected=buildPendingExport(unit,matches,catalog),ui=await harness({unit,matches});
  ui.node('export-pending-3mf').fire();
  assert.equal(ui.node('pending-export-dialog').open,true);
  assert.match(ui.node('pending-export-summary').textContent,new RegExp(`${expected.summary.fileCopies} 份原文件`));
  const list=ui.node('pending-export-list').children;
  assert.equal(list.length,expected.entries.length);assert.ok(list.some(li=>li.children[0].textContent===catalog.find(p=>p.id===runner.id).zh&&li.children[1].textContent==='1 份'));
  assert.equal(ui.node('pending-export-start').disabled,false);
  await ui.node('pending-export-start').fire();
  assert.equal(ui.jobs.length,1);assert.equal(ui.jobs[0].entries.find(entry=>entry.id===runner.id).quantity,1);assert.equal(ui.jobs[0].entries.some(entry=>entry.id===body.id),false);
  assert.deepEqual(ui.downloads,[{filename:'VAULT_S3_当前_模块_待打印.3mf',url:'blob:local-0'}]);
  assert.equal(ui.urls[0].blob.type,'model/3mf');assert.equal(ui.body.children.length,0,'temporary anchor removed');
  assert.deepEqual(unit.progress,before);assert.match(ui.node('pending-export-status').textContent,/进度保持不变/);
  assert.equal(ui.timers.length,1);assert.equal(ui.timers[0].delay,120000);ui.timers[0].callback();assert.deepEqual(ui.revoked,['blob:local-0']);
});

test('missing pending source disables export and even forced start does not call the packager',async()=>{
  const {unit,matches}=fixture(),id=buildBOM(unit.config).rows[0].id;matches.delete(id);
  const ui=await harness({unit,matches}),before=structuredClone(unit.progress);
  ui.node('export-pending-3mf').fire();
  assert.equal(ui.node('pending-export-start').disabled,true);assert.equal(ui.node('pending-export-issues').hidden,false);assert.match(ui.node('pending-export-issues').textContent,/尚未导入/);
  await ui.node('pending-export-start').fire();
  assert.equal(ui.jobs.length,0);assert.equal(ui.downloads.length,0);assert.deepEqual(unit.progress,before);
});

test('export dialog offers bed presets, custom dimensions and remembered settings and sends them to packaging',async()=>{
  const savedSettings={byColor:true,width:275,depth:210,nozzle:0.6,remember:true},ui=await harness({savedSettings});
  ui.node('export-pending-3mf').fire();
  assert.equal(ui.node('pending-export-bed').value,'custom');assert.equal(ui.node('pending-export-custom-bed').hidden,false);
  assert.equal(ui.node('pending-export-width').value,'275');assert.equal(ui.node('pending-export-depth').value,'210');assert.equal(ui.node('pending-export-remember').checked,true);
  ui.node('pending-export-bed').value='180x180';ui.node('pending-export-bed').fire('change');
  assert.equal(ui.node('pending-export-custom-bed').hidden,true);
  ui.node('pending-export-remember').checked=false;
  await ui.node('pending-export-start').fire();
  assert.deepEqual(ui.jobs[0].options.plateOptions,{byColor:true,width:180,depth:180,nozzle:0.6});
  assert.equal(ui.settingsWrites[0].remember,false);
});

test('invalid custom bed never starts export; denied preferences do not prevent a valid download',async()=>{
  const ui=await harness({storageWorks:false});ui.node('export-pending-3mf').fire();
  ui.node('pending-export-bed').value='custom';ui.node('pending-export-width').value='';
  await ui.node('pending-export-start').fire();assert.equal(ui.jobs.length,0);assert.match(ui.node('pending-export-status').textContent,/有效/);
  ui.node('pending-export-width').value='256';ui.node('pending-export-remember').checked=true;
  await ui.node('pending-export-start').fire();assert.equal(ui.downloads.length,1);assert.ok(ui.notifications.some(n=>/未能保存/.test(n)));
  ui.node('pending-export-width').value='';ui.node('pending-export-by-color').checked=false;ui.node('pending-export-by-color').fire('change');
  assert.equal(ui.node('pending-export-plate-fields').hidden,true);
  await ui.node('pending-export-start').fire();assert.equal(ui.jobs.at(-1).options.plateOptions.byColor,false);assert.equal(ui.downloads.length,2);
});

test('device and size selection restore separately and remembered device dimensions reach the exporter',async()=>{
  const ui=await harness({savedSettings:{...DEFAULT_PLATE_OPTIONS,width:180,depth:180,deviceId:'a1-mini',remember:true}});
  ui.node('export-pending-3mf').fire();
  assert.equal(ui.node('pending-export-size-mode').value,'device');assert.equal(ui.node('pending-export-device').value,'a1-mini');
  assert.equal(ui.node('pending-export-device-field').hidden,false);assert.equal(ui.node('pending-export-bed-field').hidden,true);
  assert.match(ui.node('pending-export-selected-bed').textContent,/180 × 180/);
  ui.node('pending-export-device').value='h2d-single';ui.node('pending-export-device').fire('change');
  ui.node('pending-export-material').value='pla';ui.node('pending-export-material').fire('change');
  await ui.node('pending-export-start').fire();
  assert.deepEqual(ui.jobs[0].options.plateOptions,{...DEFAULT_PLATE_OPTIONS,width:325,depth:320,deviceId:'h2d-single',materialId:'pla'});
  assert.equal(ui.settingsWrites[0].remember,true);assert.equal(ui.settingsWrites[0].options.deviceId,'h2d-single');
  ui.node('pending-export-size-mode').value='size';ui.node('pending-export-size-mode').fire('change');
  assert.equal(ui.node('pending-export-device-field').hidden,true);assert.equal(ui.node('pending-export-bed-field').hidden,false);
  ui.node('pending-export-bed').value='custom';ui.node('pending-export-width').value='275';ui.node('pending-export-depth').value='210';
  await ui.node('pending-export-start').fire();
  assert.deepEqual(ui.jobs[1].options.plateOptions,{...DEFAULT_PLATE_OPTIONS,width:275,depth:210});
  assert.equal(Object.hasOwn(ui.settingsWrites[1].options,'deviceId'),false);
});

test('Bambu device export requires a compatible material, restores it and clears it when a nozzle cannot use it',async()=>{
  const ui=await harness({savedSettings:{...DEFAULT_PLATE_OPTIONS,deviceId:'a1-mini',materialId:'tpu',remember:true}});
  ui.node('export-pending-3mf').fire();assert.equal(ui.node('pending-export-material').value,'tpu');
  ui.node('pending-export-nozzle').value='0.2';ui.node('pending-export-nozzle').fire('change');
  assert.equal(ui.node('pending-export-material').value,'');
  await ui.node('pending-export-start').fire();assert.equal(ui.jobs.length,0);assert.match(ui.node('pending-export-status').textContent,/耗材/);
  ui.node('pending-export-material').value='petg';ui.node('pending-export-material').fire('change');
  await ui.node('pending-export-start').fire();assert.equal(ui.jobs[0].options.plateOptions.materialId,'petg');assert.equal(ui.settingsWrites[0].options.materialId,'petg');
  assert.match(ui.node('pending-export-preset-info').textContent,/Generic PETG/);
});

test('cancel aborts an active export, closes dialog and cannot download a late successful result',async()=>{
  const ui=await harness({deferred:true,honorAbort:false}),before=structuredClone(ui.unit.progress);
  ui.node('export-pending-3mf').fire();const task=ui.node('pending-export-start').fire();
  assert.equal(ui.jobs.length,1);assert.equal(ui.node('pending-export-cancel').textContent,'取消生成');
  ui.jobs[0].options.onProgress({percent:42,name:'测试零件'});assert.equal(ui.node('pending-export-progress').value,42);
  ui.node('pending-export-cancel').fire();
  assert.equal(ui.jobs[0].options.signal.aborted,true);assert.equal(ui.node('pending-export-dialog').open,false);
  ui.jobs[0].resolve();await task;
  assert.equal(ui.downloads.length,0);assert.equal(ui.urls.length,0);assert.match(ui.node('pending-export-status').textContent,/已取消/);
  assert.equal(ui.node('export-pending-3mf').disabled,false);assert.deepEqual(ui.unit.progress,before);
});

test('double start cannot spawn concurrent jobs and a subsequent attempt can run after cancellation',async()=>{
  const ui=await harness({deferred:true});ui.node('export-pending-3mf').fire();
  const first=ui.node('pending-export-start').fire();
  await ui.node('pending-export-start').fire();ui.node('export-pending-3mf').fire();
  assert.equal(ui.jobs.length,1);assert.equal(ui.node('export-pending-3mf').disabled,true);
  ui.node('pending-export-close').fire();await first;
  assert.equal(ui.downloads.length,0);
  ui.node('export-pending-3mf').fire();const second=ui.node('pending-export-start').fire();
  assert.equal(ui.jobs.length,2);assert.equal(ui.jobs[1].options.signal.aborted,false);
  ui.jobs[1].resolve();await second;assert.equal(ui.downloads.length,1);
});

test('packaging errors show a useful message, leave no download and preserve retry state',async()=>{
  const ui=await harness({deferred:true}),before=structuredClone(ui.unit.progress);
  ui.node('export-pending-3mf').fire();const task=ui.node('pending-export-start').fire();
  ui.jobs[0].reject(new Error('模型顶点超出导出内存上限'));await task;
  assert.match(ui.node('pending-export-status').textContent,/生成失败：模型顶点/);assert.ok(ui.notifications.some(message=>/3MF 生成失败/.test(message)));
  assert.equal(ui.downloads.length,0);assert.equal(ui.node('pending-export-start').disabled,false);assert.deepEqual(ui.unit.progress,before);
});

test('start rechecks the live current configuration and blocks while import is in progress',async()=>{
  const ui=await harness();ui.setImporting(true);ui.node('export-pending-3mf').fire();
  assert.equal(ui.node('pending-export-dialog').open,false);assert.match(ui.notifications[0],/正在导入/);
  ui.setImporting(false);ui.node('export-pending-3mf').fire();
  const pending=unitBOM(ui.unit,ui.matches).rows;for(const row of pending)setPrinted(ui.unit,row.id,row.qty,row.piecesPerFile);
  await ui.node('pending-export-start').fire();
  assert.equal(ui.jobs.length,0);assert.equal(ui.node('pending-export-start').disabled,true);assert.match(ui.node('pending-export-summary').textContent,/全部打印/);
});
