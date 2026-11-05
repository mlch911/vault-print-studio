import {create3MF,validateExportEntries} from './three-mf-core.js';

/** Full-resolution local export. A dedicated worker keeps large STL jobs off the UI. */
export async function export3MF(entries,{title='VAULT 待打印零件',onProgress,signal,plateOptions}={}){
  const clean=validateExportEntries(entries);
  if(signal?.aborted)throw signal.reason??new DOMException('导出已取消','AbortError');
  if(typeof Worker==='undefined')return create3MF(clean,{title,onProgress,signal,plateOptions});
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./three-mf-worker.js',import.meta.url),{type:'module'});
    let settled=false;
    const finish=(fn,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);worker.terminate();fn(value);};
    const abort=()=>finish(reject,signal.reason??new DOMException('导出已取消','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{
      if(data.type==='progress'){try{onProgress?.(data.progress);}catch(error){finish(reject,error);}}
      else if(data.type==='result')finish(resolve,{blob:data.blob,manifest:data.manifest});
      else if(data.type==='error'){const error=new Error(data.message);error.name=data.name||'Error';finish(reject,error);}
    };
    worker.onerror=event=>{event.preventDefault();finish(reject,new Error('3MF 导出失败：'+(event.message||'工作线程无法启动')));};
    worker.onmessageerror=()=>finish(reject,new Error('3MF 导出结果传输失败'));
    if(signal?.aborted){abort();return;}
    try{worker.postMessage({entries:clean,title:String(title),plateOptions});}catch(error){finish(reject,error);}
  });
}

export {create3MF,validateExportEntries} from './three-mf-core.js';
