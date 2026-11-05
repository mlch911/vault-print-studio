import {restoreDirectoryPaths} from './directory-input.js';
import {snapshotModelCache} from './model-cache.js';
const DATABASE='vault-print-studio-model-recovery',STORE='workspace',KEY='current';
function openDatabase(){return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(Error('浏览器不支持模型本地保存，当前工作台将保持打开'));return;}
  const request=indexedDB.open(DATABASE,1);
  request.onupgradeneeded=()=>{request.result.createObjectStore(STORE);};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
export function validCheckpoint(data){
  return !!data&&data.schema===1&&typeof data.id==='string'&&data.id.length<100&&Array.isArray(data.files)&&data.files.length<=2000&&data.files.every(file=>file instanceof Blob&&typeof file.name==='string')&&(data.relativePaths===undefined||(Array.isArray(data.relativePaths)&&data.relativePaths.length===data.files.length&&Array.from(data.relativePaths).every(path=>typeof path==='string'&&path.length<=4096)))&&Array.isArray(data.manual)&&data.manual.length<=1000&&data.state?.version===1;
}
export async function saveCheckpoint(data){
  if(!validCheckpoint(data))throw Error('本地恢复数据不完整，已取消更新');
  const db=await openDatabase();
  try{await new Promise((resolve,reject)=>{
    const transaction=db.transaction(STORE,'readwrite');
    transaction.objectStore(STORE).put(data,data.id);
    transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('模型保存被中断'));
  });}catch(error){throw Error(error?.name==='QuotaExceededError'?'浏览器存储空间不足，当前模型和打印记录保持不变；请继续使用当前版本':'保存模型失败，当前工作台保持打开：'+(error?.message||error));}finally{db.close();}
}
export async function readCheckpoint(id=KEY){
  const db=await openDatabase();try{return await new Promise((resolve,reject)=>{
    const request=db.transaction(STORE,'readonly').objectStore(STORE).get(id);
    request.onsuccess=()=>resolve(validCheckpoint(request.result)?request.result:null);request.onerror=()=>reject(request.error);
  });}finally{db.close();}
}
export async function clearCheckpoint(){
  const db=await openDatabase();try{await new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,'readwrite');transaction.objectStore(STORE).clear();transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error);transaction.onerror=()=>reject(transaction.error);});}finally{db.close();}
}
async function pruneCheckpoints(id){const db=await openDatabase();try{await new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,'readwrite'),store=transaction.objectStore(STORE),cursor=store.openKeyCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c){if(c.key!==id&&c.key!==metadataKey(id))store.delete(c.key);c.continue();}};transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);transaction.onerror=()=>reject(transaction.error);});}finally{db.close();}}
const metadataKey=id=>id+':metadata';
async function saveCheckpointMetadata(data){
  const db=await openDatabase();try{await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(data,metadataKey(data.id));
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('本地保存被中断'));
  });}finally{db.close();}
}
async function readCheckpointMetadata(id){
  const db=await openDatabase();try{return await new Promise((resolve,reject)=>{
    const request=db.transaction(STORE,'readonly').objectStore(STORE).get(metadataKey(id));request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);
  });}finally{db.close();}
}
const POINTER='vault-print-studio-model-checkpoint';
export function workspaceRecovery({getState,getFiles,getMatches,getReport=()=>null,getCatalogKey=async()=>null,isImporting,restore,notify,persist=saveCheckpoint,read=readCheckpoint,persistMetadata=saveCheckpointMetadata,readMetadata=readCheckpointMetadata,remove=clearCheckpoint}){
  let epoch=0,committed=null,tail=Promise.resolve(),saving=null,dirty=false;
  const enqueue=work=>{const task=tail.then(work);tail=task.catch(()=>{});return task;};
  const sameFiles=files=>committed&&committed.epoch===epoch&&committed.files.length===files.length&&files.every((file,index)=>file===committed.files[index]);
  function invalidate({remove:clear=false}={}){
    epoch++;committed=null;dirty=false;try{localStorage.removeItem(POINTER);}catch{}
    if(clear){const token=epoch;notify('正在清除本机模型缓存…');enqueue(remove).then(()=>{if(token===epoch)notify('本机模型缓存已清除，配置和打印记录保留；下次需要重新选择模型目录。');}).catch(error=>{if(token===epoch)notify('模型缓存清除失败：'+error.message);});}
  }
  function metadata(files,catalogKey,id){
    const indices=new Map(files.map((file,index)=>[file,index]));
    if([...getMatches().values()].some(match=>!indices.has(match.file)))throw Error('模型恢复清单与当前模型不一致，已取消更新；请重新选择当前模型目录');
    return {schema:1,id,manual:[...getMatches()].filter(([,match])=>match.manual).map(([id,match])=>({id,index:indices.get(match.file),quantityByUnit:structuredClone(match.quantityByUnit||{})})),state:structuredClone(getState()),cache:snapshotModelCache(files,getMatches(),getReport(),catalogKey)};
  }
  async function writeCheckpoint(onProgress=()=>{}){
    if(isImporting())throw Error('模型仍在导入，请等待导入完成后更新');
    const token=epoch,files=[...new Set(getFiles())],indices=new Map(files.map((f,i)=>[f,i])),id=crypto.randomUUID();
    // Keep the last committed recovery until the new one has been saved successfully.
    try{await pruneCheckpoints(localStorage.getItem(POINTER));}catch{}
    if([...getMatches().values()].some(m=>!indices.has(m.file)))throw Error('模型恢复清单与当前模型不一致，已取消更新；请重新选择当前模型目录');
    const manualNow=()=>[...getMatches()].filter(([,m])=>m.manual&&indices.has(m.file)).map(([part,m])=>({id:part,index:indices.get(m.file),quantityByUnit:structuredClone(m.quantityByUnit||{})}));
    const manual=manualNow(),manualSignature=JSON.stringify(manual);
    onProgress(`正在保存 ${files.length} 个本地模型（${Math.ceil(files.reduce((n,f)=>n+f.size,0)/1048576)} MB）与打印记录…`);
    const catalogKey=await getCatalogKey();
    await persist({...metadata(files,catalogKey,id),createdAt:new Date().toISOString(),files,relativePaths:files.map(f=>f.webkitRelativePath||'')});
    if(token!==epoch||isImporting())throw Error('保存期间模型目录发生变化，请完成导入后重新更新');
    if(JSON.stringify(manualNow())!==manualSignature)throw Error('保存期间人工匹配或打印份数发生变化，请重新点击更新以保存最新配置');
    // Capture the latest progress, including marks made while the large blobs were saving.
    const serialized=JSON.stringify(getState());
    try{localStorage.setItem('vault-print-studio-v1',serialized);if(localStorage.getItem('vault-print-studio-v1')!==serialized)throw Error();localStorage.setItem(POINTER,id);if(localStorage.getItem(POINTER)!==id)throw Error();}
    catch{throw Error('打印记录未能安全保存，已取消更新；当前页面保持打开');}
    committed={id,files,epoch:token};
    onProgress('模型、组合和打印记录已在本机保存，下次打开会自动恢复。');
  }
  function prepare(onProgress){return enqueue(()=>writeCheckpoint(onProgress));}
  function save(){
    dirty=true;if(saving)return saving;
    saving=enqueue(async()=>{
      while(dirty){
        dirty=false;if(isImporting()||!getFiles().length)continue;
        const token=epoch,files=[...new Set(getFiles())];
        try{
          if(!sameFiles(files)){await writeCheckpoint(notify);}
          else{
            const data=metadata(files,await getCatalogKey(),committed.id);
            await persistMetadata(data);
            if(token!==epoch)continue;
            notify('模型和最新进度已在本机保存，下次打开会自动恢复。');
          }
        }catch(error){
          if(token!==epoch||dirty){dirty=true;continue;}
          notify('自动保存失败，请暂勿关闭页面：'+error.message);return false;
        }
      }
      return true;
    }).finally(()=>{saving=null;});
    return saving;
  }
  async function resume(){
    let pointer;try{pointer=localStorage.getItem(POINTER);}catch{return;}if(!pointer){notify('请先选择一次模型目录；保存成功后，下次打开会自动恢复。');return;}
    const token=epoch;
    try{let data=await read(pointer);if(token!==epoch||isImporting()||getMatches().size)return;
      if(!data||data.id!==pointer){notify('没有找到更新恢复数据，打印记录仍保留，请重新选择模型目录');return;}
      let latest=null;try{latest=await readMetadata(pointer);}catch(error){if(globalThis.indexedDB)throw error;}
      if(token!==epoch||isImporting()||getMatches().size)return;
      if(latest){if(latest.id!==pointer||latest.schema!==1)throw Error('模型恢复元数据无效');data={...data,...latest,files:data.files,relativePaths:data.relativePaths};}
      if(!validCheckpoint(data))throw Error('模型恢复数据不完整');
      const files=restoreDirectoryPaths(data.files,data.relativePaths);committed={id:pointer,files,epoch:token};
      notify(`正在恢复 ${files.length} 个本地模型与打印记录…`);await restore({...data,files});
    }catch(error){notify('模型自动恢复暂未完成，打印记录仍保留：'+error.message);}
  }
  return {prepare,resume,invalidate,save};
}
