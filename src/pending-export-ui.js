import {buildPendingExport} from './pending-export.js';
import {export3MF} from './three-mf-export.js';
import {DEFAULT_PLATE_OPTIONS,normalizePlateOptions} from './print-plates.js';
import {readExportSettings,saveExportSettings} from './export-settings.js';
import {PRINT_DEVICES} from './print-devices.js';
import {BAMBU_MATERIALS,bambuPresetReference} from './bambu-presets.js';
import './pending-export.css';

const element=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
const safeName=value=>String(value||'当前模块').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80).replace(/[. ]+$/g,'')||'当前模块';

export function initPendingExport({getUnit,getMatches,catalog,isImporting=()=>false,notify=()=>{}}){
  const $=id=>document.getElementById('pending-export-'+id);
  const dialog=$('dialog'),trigger=document.getElementById('export-pending-3mf');
  let controller=null,busy=false;
  const presetBeds=['180x180','220x220','256x256','300x300','325x320','350x320','350x350'];
  const settingIds=['by-color','size-mode','device','bed','width','depth','nozzle','material','remember'];
  const deviceGroups=new Map();
  for(const device of PRINT_DEVICES){
    if(!deviceGroups.has(device.series)){const group=document.createElement('optgroup');group.label=device.series;deviceGroups.set(device.series,group);}
    const option=element('option',`${device.name} · ${device.width} × ${device.depth} mm`);option.value=device.id;deviceGroups.get(device.series).append(option);
  }
  $('device').replaceChildren(...deviceGroups.values());
  function showSettings(preferredMaterial=$('material').value){
    const byDevice=$('size-mode').value==='device',device=PRINT_DEVICES.find(device=>device.id===$('device').value);
    $('plate-fields').hidden=!$('by-color').checked;
    $('device-field').hidden=!byDevice;$('bed-field').hidden=byDevice;
    $('custom-bed').hidden=byDevice||$('bed').value!=='custom';
    $('selected-bed').textContent=byDevice&&device?`用于排盘的热床尺寸：${device.width} × ${device.depth} mm`:'';
    let reference=null,message='';
    try{if(byDevice)reference=bambuPresetReference(device?.id,Number($('nozzle').value));}catch(error){message=error.message;}
    $('material-field').hidden=!reference;
    const placeholder=element('option','请选择实际使用的耗材');placeholder.value='';
    $('material').replaceChildren(placeholder,...BAMBU_MATERIALS.filter(material=>reference?.materials[material.id]).map(material=>{const option=element('option',material.name);option.value=material.id;return option;}));
    $('material').value=reference?.materials[preferredMaterial]?preferredMaterial:'';
    $('preset-info').textContent=message||(reference?`将引用官方预设：${reference.printer}；${reference.process}。打印高度 ${reference.height} mm；耗材预设：${reference.materials[$('material').value]?.name||'尚未选择'}。需在 Bambu Studio 中安装对应系统预设。`:'按尺寸或其他品牌设备导出时没有对应的拓竹系统预设，打开后需自行选择打印机与耗材。');
  }
  function loadSettings(){
    const saved=readExportSettings(),options=saved||DEFAULT_PLATE_OPTIONS,key=`${options.width}x${options.depth}`;
    $('by-color').checked=options.byColor;$('bed').value=presetBeds.includes(key)?key:'custom';
    $('size-mode').value=options.deviceId?'device':'size';$('device').value=options.deviceId||'p1s';
    $('width').value=String(options.width);$('depth').value=String(options.depth);$('nozzle').value=String(options.nozzle);$('remember').checked=!!saved;
    showSettings(options.materialId);
  }
  function currentSettings(){
    const custom=$('bed').value==='custom',[width,depth]=custom?[Number($('width').value),Number($('depth').value)]:$('bed').value.split('x').map(Number);
    const options={byColor:$('by-color').checked,width,depth,nozzle:Number($('nozzle').value)};
    if($('size-mode').value==='device')options.deviceId=$('device').value;
    if(options.deviceId&&$('material').value)options.materialId=$('material').value;
    try{return normalizePlateOptions(options);}catch(error){if(!options.byColor)return {...DEFAULT_PLATE_OPTIONS,byColor:false};throw error;}
  }
  for(const id of ['by-color','bed','size-mode','device','nozzle','material'])$(id).addEventListener('change',()=>showSettings());
  function setBusy(value){
    busy=value;trigger.disabled=value;$('start').disabled=value;$('cancel').textContent=value?'取消生成':'关闭';
    $('close').setAttribute('aria-label',value?'取消生成并关闭':'关闭导出窗口');
    $('progress').hidden=!value;dialog.setAttribute('aria-busy',String(value));
    for(const id of settingIds)$(id).disabled=value;
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
    loadSettings();
    if(preview())dialog.showModal();
  });
  function close(){if(busy)controller?.abort();dialog.close();}
  $('close').addEventListener('click',close);$('cancel').addEventListener('click',close);
  dialog.addEventListener('cancel',()=>controller?.abort());
  dialog.addEventListener('close',()=>controller?.abort());
  $('start').addEventListener('click',async()=>{
    if(busy||isImporting())return;
    const snapshot=preview();if(!snapshot?.selection.canExport)return;
    let plateOptions;
    try{
      plateOptions=currentSettings();
      if(plateOptions.byColor){const reference=bambuPresetReference(plateOptions.deviceId,plateOptions.nozzle);if(reference&&!reference.materials[plateOptions.materialId])throw Error('请先选择实际使用的耗材预设');}
    }catch(error){$('status').textContent=error.message;return;}
    if(!saveExportSettings(plateOptions,$('remember').checked)&&$('remember').checked)notify('浏览器未能保存导出设置，本次仍可继续导出');
    const abort=new AbortController();controller=abort;setBusy(true);
    $('progress').value=0;$('status').textContent='正在读取完整原始模型…';
    try{
      const {blob,manifest}=await export3MF(snapshot.selection.entries,{
        title:snapshot.name+' · 待打印零件',signal:abort.signal,plateOptions,
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
      $('status').textContent=`已生成并开始下载 ${(blob.size/1024/1024).toFixed(1)} MB 的 3MF。${manifest?.plates?`已按颜色分为 ${manifest.plates.length} 盘（${plateOptions.width} × ${plateOptions.depth} mm）。`:''}${cleaned?`导出时跳过了 ${cleaned.toLocaleString('zh-CN')} 个重复顶点造成的零面积面，原 STL 未改动。`:''}打印进度保持不变；请在切片软件中核对打印设置。`;
      notify('待打印 3MF 已生成，打印进度未改变');
    }catch(error){
      $('status').textContent=error.name==='AbortError'?'已取消生成，打印进度保持不变。':'生成失败：'+error.message;
      if(error.name!=='AbortError')notify('3MF 生成失败：'+error.message);
    }finally{
      if(controller===abort){controller=null;setBusy(false);if(dialog.open)preview();}
    }
  });
}
