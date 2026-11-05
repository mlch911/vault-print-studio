import {create3MF} from './three-mf-core.js';

self.onmessage=async({data:{entries,title,plateOptions}})=>{
  try{
    const result=await create3MF(entries,{title,plateOptions,onProgress:progress=>self.postMessage({type:'progress',progress})});
    self.postMessage({type:'result',...result});
  }catch(error){self.postMessage({type:'error',name:error?.name||'Error',message:error?.message||String(error)});}
};
