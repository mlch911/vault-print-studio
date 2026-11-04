import {buildPendingExport} from './pending-export.js';
import {export3MF} from './three-mf-export.js';
import './pending-export.css';

const element=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
const safeName=value=>String(value||'当前模块').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80).replace(/[. ]+$/g,'')||'当前模块';

export function initPendingExport({getUnit,getMatches,catalog,isImporting=()=>false,notify=()=>{}}){
  const $=id=>document.getElementById('pending-export-'+id);
  const dialog=$('dialog'),trigger=document.getElementById('export-pending-3mf');
  let controller=null,busy=false;
  function setBusy(value){
    busy=value;trigger.disabled=value;$('start').disabled=value;$('cancel').textContent=value?'取消生成':'关闭';
    $('close').setAttribute('aria-label',value?'取消生成并关闭':'关闭导出窗口');
    $('progress').hidden=!value;dialog.setAttribute('aria-busy',String(value));
  }
  function preview(){
    const current=getUnit();
    if(!current){notify('请先选择当前模块');return null;}
    const selection=buildPendingExport(current,getMatches(),catalog);
    $('scope').textContent='当前模块：'+current.name;
    const entries=selection.previewEntries||selection.entries;
    $('summary').textContent=selection.issues.length?'还有需要处理的项目，暂不能导出完整 3MF':selection.entries.length?`${selection.entries.length} 类零件 · ${selection.entries.reduce((n,r)=>n+r.quantity,0)} 份原文件 · 仅剩余未打印数量`:'当前模块所需零件已全部打印，无需导出';
    $('issues').replaceChildren(...selection.issues.map(message=>element('p',message)));
    $('issues').hidden=!selection.issues.length;
    $('warnings').replaceChildren(...(selection.warnings||[]).map(message=>element('li',message)));
    $('warnings').hidden=!selection.warnings?.length;
    $('list').replaceChildren(...entries.map(entry=>{
      const li=document.createElement('li');li.append(element('span',entry.name),element('strong',`${entry.quantity} 份`));return li;
    }));
    $('start').disabled=!selection.canExport||busy;
    return {selection,name:current.name};
  }
  trigger.addEventListener('click',()=>{
    if(busy)return;
    if(isImporting()){notify('模型正在导入，请稍后导出');return;}
    $('status').textContent='';$('progress').value=0;
    if(preview())dialog.showModal();
  });
  function close(){if(busy)controller?.abort();dialog.close();}
  $('close').addEventListener('click',close);$('cancel').addEventListener('click',close);
  dialog.addEventListener('cancel',()=>controller?.abort());
  dialog.addEventListener('close',()=>controller?.abort());
  $('start').addEventListener('click',async()=>{
    if(busy||isImporting())return;
    const snapshot=preview();if(!snapshot?.selection.canExport)return;
    const abort=new AbortController();controller=abort;setBusy(true);
    $('progress').value=0;$('status').textContent='正在读取完整原始模型…';
    try{
      const {blob,manifest}=await export3MF(snapshot.selection.entries,{
        title:snapshot.name+' · 待打印零件',signal:abort.signal,
        onProgress:progress=>{
          if(abort.signal.aborted)return;
          $('progress').value=Math.max(0,Math.min(100,progress.percent||0));
          $('status').textContent=`正在生成 3MF${progress.name?'：'+progress.name:''} · ${Math.round(progress.percent||0)}%`;
        },
      });
      if(abort.signal.aborted)throw new DOMException('已取消','AbortError');
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`VAULT_${safeName(snapshot.name)}_待打印.3mf`;
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);
      const cleaned=manifest?.discardedDegenerateTriangles||0;
      $('status').textContent=`已生成并开始下载 ${(blob.size/1024/1024).toFixed(1)} MB 的 3MF。${cleaned?`导出时跳过了 ${cleaned.toLocaleString('zh-CN')} 个重复顶点造成的零面积面，原 STL 未改动。`:''}打印进度保持不变；请在切片软件中排盘。`;
      notify('待打印 3MF 已生成，打印进度未改变');
    }catch(error){
      $('status').textContent=error.name==='AbortError'?'已取消生成，打印进度保持不变。':'生成失败：'+error.message;
      if(error.name!=='AbortError')notify('3MF 生成失败：'+error.message);
    }finally{
      if(controller===abort){controller=null;setBusy(false);if(dialog.open)preview();}
    }
  });
}
