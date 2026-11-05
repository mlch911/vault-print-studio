import catalog from './catalog.json' with {type:'json'};
import {scanFiles} from './importer.js';
import {canPickDirectory,pickDirectory,collectDirectoryFiles,collectDroppedFiles} from './directory-input.js';
import {buildBOM,defaults,configurationOptions,normalizeConfig} from './rules.js';
import {buildScene,componentFrames} from './assembly.js';
import {buildComposition,compositionProblem} from './composition.js';
import {tierColumns,drawerLayouts,drawerLayoutLabel,drawerLayoutProblem} from './drawer-layout.js';
import {Viewer,thumbnail,moduleThumbnail,clearGeometry,clearThumbnails} from './viewer.js';
import {queueUnits,reconcileQueue,selectQueue,selectQueueUnit,nextIncomplete,deleteIndependent,deleteIndependents,deletionBatch,undoIndependentDelete} from './queue.js';
import {books,bundledManual} from './manual-library.js';
import {initUpdates} from './update-ui.js';
import {workspaceRecovery} from './workspace-checkpoint.js';
import {restoreModelCache} from './model-cache.js';
import './manual-library.css';
import './update-ui.css';
import {LocalManualViewer} from './manual-viewer.js';
import {STORAGE_KEY,uid,clone,freshState,sanitizeState,setPrinted,downloaded,validateTiers} from './state.js';
import {patterns,layerConfigs,layerChoices,changePlan,configProblem,unitBOM,printProgress,effectiveProgress,printedState,libraryRows,validateManualPDF,moduleConfig} from './planner.js';
import {initPendingExport} from './pending-export-ui.js';
import {initColorPalette} from './color-palette-ui.js';

const $=id=>document.getElementById(id), byId=new Map(catalog.map(p=>[p.id,p]));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state,stateWasRestored=true;try{state=sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)),new Set(byId.keys()));}catch{stateWasRestored=false;state=freshState(defaults('drawer'));}
let matches=new Map(),report=null,bom=null,selected=null,view='assembled',open=0,explode=0,step=Infinity,playing=null,scene,mainViewer,planViewer,partViewer,selectedLibrary=null,tab='config',soundContext,toastTimer,importBusy=false,renderTicket=0,importedFiles=[],recovery,importGeneration=0,importAbort,batchMode=false,batchSelection=new Set();
const unit=()=>state.units.find(u=>u.id===state.activeUnit);
let colorPaletteUI;
initPendingExport({getUnit:unit,getMatches:()=>matches,catalog,isImporting:()=>importBusy,notify:message=>toast(message)});
function save(){stateWasRestored=true;try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch{toast('浏览器存储不可用，请导出进度文件');}recovery?.save();}
function toast(text){$('toast').textContent=text;$('toast').classList.add('is-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').classList.remove('is-visible');$('toast').textContent='';},4500);}
function sound(kind='click'){if(!state.sound)return;try{soundContext ||= new AudioContext();soundContext.resume();const o=soundContext.createOscillator(),g=soundContext.createGain(),t=soundContext.currentTime,add=kind==='add';o.type='sine';o.frequency.setValueAtTime(add?420:650,t);o.frequency.exponentialRampToValueAtTime(add?820:480,t+(add ? .08 : .045));o.frequency.exponentialRampToValueAtTime(add?520:440,t+(add ? .17 : .065));g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(add ? .022 : .008,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+(add ? .2 : .075));o.connect(g).connect(soundContext.destination);o.start();o.stop(t+(add ? .22 : .09));o.onended=()=>{o.disconnect();g.disconnect();};}catch{}}
function makeViewer(id,options){try{return new Viewer($(id),options);}catch(e){toast('三维功能不可用：'+e.message);return null;}}
function showWorkspace(){if(!matches.size){toast('请先导入至少一个匹配的 STL');return;}$('gate').hidden=true;$('workspace').hidden=false;$('models-dialog').close();mainViewer ||= makeViewer('stage',{onSelect:selectPart,onStatus:text=>$('stage-status').textContent=text});render();if(tab==='combine')renderPlan();if(tab==='library')renderLibrary();}
function showTab(name){if(name!=='config'&&batchMode){clearBatchSelection();renderQueue();}tab=name;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('is-active',b.dataset.tab===name);b.setAttribute('aria-current',b.dataset.tab===name?'page':'false');});for(const t of ['config','combine','library','manuals'])if($('tab-'+t))$('tab-'+t).hidden=t!==name;if(name==='combine')renderPlan();if(name==='library')renderLibrary();if(name==='manuals')ensureBundledManuals();sound();}
function button(text,action,id='',cls='btn btn-outline'){return `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}">${esc(text)}</button>`;}
function field(key,label,value,choices,type='text'){
  const control=choices?`<select name="${esc(key)}">${choices.map(x=>{const [v,t]=Array.isArray(x)?x:[x,x];return `<option value="${esc(v)}" ${String(value)===String(v)?'selected':''}>${esc(t)}</option>`;}).join('')}</select>`:type==='checkbox'?`<input type="checkbox" name="${esc(key)}" ${value?'checked':''}>`:`<input name="${esc(key)}" type="${type}" value="${esc(value??'')}" ${type==='number'?'min="0" max="10000" step="1"':''}>`;
  return `<label class="field ${type==='checkbox'?'checkbox-field':''}"><span>${esc(label)}</span>${control}</label>`;
}
function optionsObject(){return typeof configurationOptions==='function'?configurationOptions():configurationOptions;}
function renderFields(){const c=unit().config,o=optionsObject();$('kind').value=c.kind;$('module-name').value=unit().name;let html='';
  if(c.kind==='mods'){
    const mods=o.mods?.variants||o.modifications||o.modificationOptions||[];const option=mods.find(x=>x.id===c.family)||mods[0];
    html+=field('family','改装方案',c.family,mods.map(x=>[x.id,x.title]));
    if(option){html+=`<p class="muted">${esc(option.purpose||'选择对应规格，核对所需五金。')}</p>`;for(const f of option.inputs||[]){if(f.key==='qty')continue;const values=f.choices?.map(x=>[x,({whole:'整体',split:'分体',width:'按宽度',universal:'通用',anchors:'膨胀锚固',screws:'螺钉',inserts:'嵌件'})[x]||x]);html+=field(f.key,f.purpose||f.label||f.key,c[f.key],values,f.type==='boolean'?'checkbox':['integer','number'].includes(f.type)?'number':'text');}}
  }else{
    html+=`<div class="field-row">${field('w','宽度',c.w,['S','M','L','XL'])}${field('d','深度',c.d,[3,4,5,6,7])}${field('h',c.kind==='drawer'?'外框层高':'层高',c.h,c.w==='XL'?['1F']:['1F','2F','4F'])}</div>`;
    if(c.kind==='drawer'){
      html+=field('drawer-layout','框内抽屉 · 从下到上',(c.drawers||[c.h]).join('+'),drawerLayouts(c.h).map(parts=>[parts.join('+'),drawerLayoutLabel(parts,c.h)]));
      html+='<p class="muted">多个抽屉共用一个外框；导轨、止挡、钥匙与弹簧按每个抽屉自动配齐。</p>';
      html+=field('key','钥匙机构',c.key,[['standard','旋转钥匙'],['hidden','隐藏钥匙']]);
      html+=field('roof','顶部用途',c.roof,[['none','继续堆叠 · 无顶盖'],['Grid Roof','网格顶盖'],['Table Roof','平顶盖'],['Bowl Roof','托盘顶盖'],['Under Table Mount Roof','桌下安装'],['Heawyweight Roof','重载顶盖']]);
      html+=field('rails','齿条 · 配合钥匙齿轮锁止',c.rails,null,'checkbox')+'<p class="muted">默认配齐上下齿条。一份 STL 包含一对，与左右滑轨不同。</p>';
      html+=field('label','标签片 · 标识内容',c.label,null,'checkbox');
      html+=field('baseplate','Gridfinity 底板 · 网格收纳',c.baseplate,null,'checkbox');
      html+=field('handle','顶部提手 · 搬运模块',c.handle,null,'checkbox');
    }else{
      html+=field('interior','内腔',c.interior,c.w==='S'||c.w==='M'?[['standard','标准内腔']]:[['flat','平底'],['dividers','分隔板型'],['sealed','封闭分区']]);
      html+=field('roof','顶盖',c.roof,[['whole','整体顶盖'],['split','分体顶盖']]);
      html+=field('facade','前面板',c.facade,c.w==='XL'?[['family','系列面板']]:[['family','系列面板'],['universal','通用面板']]);
      html+=field('lockCount','锁扣套数 · S/M 一套，L/XL 两套',normalizeConfig(c).lockCount,null,'number');
      if(c.roof==='split')html+=field('splitRoofConnectorQty','分体顶盖连接件份数',c.splitRoofConnectorQty,null,'number');
      html+=field('label','标签片',c.label,[['none','不安装'],['sustainer','翻盖箱标签']]);html+=field('baseplate','Gridfinity 底板',c.baseplate,null,'checkbox');
      html+=`<details><summary>分隔板选配数量</summary>${['width','depth','seal','sealCenter','sealSides'].map((k,i)=>field('dividers.'+k,['横向隔板','纵向隔板','封闭分区隔板','中央隔板','侧面隔板'][i],c.dividers?.[k]||0,null,'number')).join('')}</details>`;
    }
  }$('config-fields').innerHTML=html;
}
function stopPlay(){clearInterval(playing);playing=null;$('step-play').textContent='▶';$('step-play').setAttribute('aria-pressed','false');}
function sceneNow(){return buildScene({...unit().config,id:unit().id,colors:unit().colors},{open,explode:view==='exploded'?Math.max(.3,explode):explode,progress:step});}
function updateAnimation(operation=null){if(!mainViewer||!unit())return;scene=sceneNow();mainViewer.update(scene,view,{operation});syncPrintedViewers();const n=scene.steps?.length||1;const value=Number.isFinite(step)?Math.min(n-1,step):n-1;$('step-range').max=n-1;$('step-range').value=value;$('step-label').textContent=`${value+1}/${n} · ${Array.isArray(scene.steps?.[value])?scene.steps[value][0]:scene.steps?.[value]||'装配预览'}`;$('step-prev').disabled=value<=0;$('step-next').disabled=value>=n-1;}
async function render(){const ticket=++renderTicket;stopPlay();selected=null;$('model-popover').hidden=true;colorPaletteUI?.close();
  const queued=renderQueue();document.querySelector('.workbench').hidden=!queued.length;
  if(!queued.length){bom=null;scene=null;$('print-list').innerHTML='';mainViewer?.clear();$('current-module').textContent='当前集合暂无模块';$('module-progress').value=0;return;}
  $('module-switch').innerHTML=state.units.map(u=>`<option value="${esc(u.id)}" ${u.id===unit().id?'selected':''}>${esc(u.name)}</option>`).join('');$('current-module').textContent=unit().name;renderFields();
  try{bom=unitBOM(unit(),matches);}catch(e){bom={rows:[],errors:[e.message]};}
  const missing=(bom.rows||[]).filter(r=>!matches.has(r.id));const errors=[...(bom.errors||[]),...(bom.needsInput||[]).map(x=>x.reason||x),...(bom.missing||[]),...bom.rows.filter(r=>matches.get(r.id)?.manual&&!Number.isInteger(r.qty)).map(r=>`${byId.get(r.id).zh}：请在打印清单确认此版本的 STL 份数`)];
  $('module-summary').textContent=`${unit().config.drawers?.length>1?unit().config.drawers.length+' 个框内抽屉 · ':''}${bom.rows.length} 类文件 · ${bom.rows.reduce((s,r)=>s+(Number.isInteger(r.qty)?r.qty:0),0)} 份打印`;
  $('missing-notice').hidden=!missing.length&&!errors.length;$('missing-notice').innerHTML=[...errors.map(x=>`<p>${esc(typeof x==='object'?JSON.stringify(x):x)}</p>`),...(missing.length?[`<p>当前配置有 ${missing.length} 类尚未匹配：${missing.map(r=>esc(byId.get(r.id)?.zh||r.id)).join('、')}</p>`]:[])].join('');
  $('hardware-list').innerHTML=(bom.hardware||[]).map(h=>`<li><strong>${esc(h.name||h.spec||h.item||h.description||'五金')}</strong> ${esc(h.qty??'待确认')} ${esc(h.unit||'件')}<small>${esc(h.reason||h.note||'')}</small></li>`).join('')||'<li>当前配置未列额外五金</li>';
  renderPrint();try{scene=sceneNow();$('assembly-notice').hidden=!scene.fitWarnings?.length;$('assembly-notice').textContent=(scene.fitWarnings||[]).join(' ');await mainViewer?.setScene(scene,matches,{mode:view,colors:unit().colors,fit:lastMainUnit!==unit().id});if(ticket!==renderTicket)return;lastMainUnit=unit().id;updateAnimation();syncPrintedViewers();}catch(e){$('stage-status').textContent='预览暂不可用：'+e.message;}
}
function thumbnailPlaceholder(message='尚未导入模型'){return `<span class="part-missing-placeholder"><span>${esc(message)}</span><small>可在模型管理中查看匹配情况</small></span>`;}
function replaceThumbnail(img,message){if(img.isConnected&&img.parentElement)img.parentElement.innerHTML=thumbnailPlaceholder(message);}
const thumbObserver=new IntersectionObserver(entries=>{for(const e of entries){if(!e.isIntersecting)continue;const img=e.target;thumbObserver.unobserve(img);const id=img.dataset.thumb,m=matches.get(id);if(!m){replaceThumbnail(img,'尚未导入模型');continue;}img.onerror=()=>replaceThumbnail(img,'模型预览不可用');thumbnail(id,m.file,m.variant).then(url=>{if(img.isConnected)img.src=url;}).catch(()=>replaceThumbnail(img,'模型预览不可用'));}},{rootMargin:'160px'});
function watchThumbs(root){root.querySelectorAll('[data-thumb]').forEach(img=>thumbObserver.observe(img));}
const moduleThumbObserver=new IntersectionObserver(entries=>{for(const entry of entries){
  if(!entry.isIntersecting)continue;const target=entry.target;moduleThumbObserver.unobserve(target);
  const u=state.units.find(u=>u.id===target.dataset.moduleThumb);if(!u)continue;
  const current=()=>target.isConnected&&queueUnits(state).some(x=>x.id===u.id);
  moduleThumbnail(clone(u),matches,current).then(result=>{
    if(!current())return;const img=document.createElement('img');img.src=result.url;img.alt='';target.replaceChildren(img);
    if(result.missing||result.unresolved){const note=document.createElement('small');note.textContent=result.missing?`部分模型 · 缺 ${result.missing} 类 STL`:'装配位置待核对';target.append(note);}
  }).catch(()=>{if(current())target.textContent='模型预览不可用';});
}},{root:$('module-cards'),rootMargin:'0px 100px',threshold:.01});
function queueProgress(u){
  try{const b=unitBOM(u,matches),p=printProgress(u,b.rows),invalid=!!(b.errors?.length||b.missing?.length||b.needsInput?.length);return {...p,done:p.done&&!invalid,pending:p.pending||invalid,rows:b.rows};}
  catch{return {printed:0,required:0,pending:true,done:false,rows:[]};}
}
function renderQueue(){
  const units=reconcileQueue(state),root=$('module-cards'),group=state.queuePlan??'',changed=root.dataset.group!==group||root.dataset.active!==state.activeUnit,left=root.dataset.group===group?root.scrollLeft:0,focused=document.activeElement?.closest('[data-queue-unit]')?.dataset.queueUnit;
  $('queue-plan-select').innerHTML=state.plans.map(p=>`<option value="${esc(p.id)}" ${p.id===state.queuePlan?'selected':''}>${esc(p.name)} · ${queueUnits(state,p.id).length} 个模块</option>`).join('')+`<option value="" ${state.queuePlan===null?'selected':''}>独立模块 · ${queueUnits(state,null).length} 个</option>`;
  if(state.queuePlan!==null||!units.length)clearBatchSelection();
  const visibleIds=new Set(units.map(u=>u.id));batchSelection=new Set([...batchSelection].filter(id=>visibleIds.has(id)));
  const summaries=new Map(units.map(u=>[u.id,queueProgress(u)]));moduleThumbObserver.disconnect();
  root.innerHTML=units.map(u=>{
    const p=summaries.get(u.id),active=u.id===state.activeUnit,c=u.config,available=p.rows.some(r=>matches.has(r.id));
    const label=p.done?'✓ 已打印':p.pending?'待确认份数':p.printed?'打印中':'待打印';
    const model=({drawer:'抽屉',sustainer:'翻盖箱',mods:'改装件'})[c.kind]||c.kind;
    return `<button type="button" class="module-card ${active?'is-selected':''} ${p.done?'is-complete':''} ${batchMode&&batchSelection.has(u.id)?'is-batch-selected':''}" data-queue-unit="${esc(u.id)}" ${batchMode?`role="checkbox" aria-checked="${batchSelection.has(u.id)}"`:`aria-pressed="${active}"`} aria-label="${esc((batchMode?'选择 ':'')+u.name+' · '+label)}"><span class="module-card-thumb" ${available?`data-module-thumb="${esc(u.id)}"`:''}>${available?'正在生成装配预览':'尚未导入此模块的 STL'}</span><span class="module-card-info"><strong>${esc(u.name)}</strong><span>${esc(model)} · W ${esc(c.w||'—')} / D ${esc(c.d||'—')} / H ${esc(c.h||'—')}</span><span class="module-card-state">${label} · ${p.printed}/${p.required} 份</span></span><span class="module-card-selected">${active?'当前模块':''}</span>${batchMode?`<span class="module-batch-check" aria-hidden="true">${batchSelection.has(u.id)?'✓':''}</span>`:''}</button>`;
  }).join('');
  root.scrollLeft=left;root.dataset.group=group;root.dataset.active=state.activeUnit;if(changed){const selected=Array.from(root.children).find(el=>el.dataset.queueUnit===state.activeUnit);if(selected)root.scrollLeft=Math.max(0,selected.offsetLeft-root.offsetLeft-4);}root.querySelectorAll('[data-module-thumb]').forEach(el=>moduleThumbObserver.observe(el));
  if(focused)Array.from(root.children).find(el=>el.dataset.queueUnit===focused)?.focus({preventScroll:true});
  const next=nextIncomplete(state,u=>summaries.get(u.id)?.done),done=[...summaries.values()].filter(p=>p.done).length,current=summaries.get(state.activeUnit);
  $('module-multi').hidden=state.queuePlan!==null||!units.length;$('module-multi').textContent=batchMode?'退出多选':'多选';$('module-multi').setAttribute('aria-pressed',String(batchMode));$('module-batch').hidden=!batchMode;
  $('module-batch-count').textContent=`已选 ${batchSelection.size} / ${units.length} 个模块`;$('module-delete-batch').textContent=`删除选中（${batchSelection.size}）`;$('module-delete-batch').disabled=!batchSelection.size;$('module-select-none').disabled=!batchSelection.size;
  $('module-new').hidden=batchMode;$('module-next').hidden=batchMode;
  $('module-delete').hidden=batchMode||state.queuePlan!==null||!units.some(u=>u.id===state.activeUnit);$('module-delete').title='删除 '+(unit()?.name||'当前模块');
  const deleted=deletionBatch(state),count=deleted?.entries.length||0,undoFits=state.units.length+count<=200;
  $('module-deleted').hidden=!count;$('module-deleted-label').textContent=count?`已删除${count===1?'「'+deleted.entries[0].unit.name+'」':count+' 个模块'}，可一起恢复原配置和打印记录。${undoFits?'':'恢复后将超过 200 个模块，整组撤销记录仍保留。'}`:'';$('module-undo-delete').disabled=!undoFits;$('module-undo-delete').textContent=count>1?`撤销本次删除（${count} 个）`:'撤销上次删除';
  $('module-next').disabled=!next;$('module-next').classList.toggle('is-ready',!!next&&!!current?.done);$('module-next').title=next?'下一未完成模块：'+next.name:'当前集合没有其他未完成模块';
  $('module-queue-status').textContent=!units.length?(state.queuePlan===null?'暂无独立模块。点击「＋ 独立模块」新建。':'此方案暂无模块。请在组合规划中添加层。'):done===units.length?`✓ 本组 ${units.length} 个模块均已打印`:`${done}/${units.length} 个模块已打印${current?.done&&next?' · 当前模块已完成，点击「下一未完成模块」继续':''}`;
  return units;
}
function clearBatchSelection(){batchMode=false;batchSelection.clear();}
function openQueueUnit(id){clearBatchSelection();if(!selectQueueUnit(state,id))return;step=Infinity;save();showTab('config');render();requestAnimationFrame(()=>Array.from($('module-cards').children).find(el=>el.dataset.queueUnit===id)?.scrollIntoView({block:'nearest',inline:'nearest'}));}
function pendingCandidate(id){return (report?.conflicts||[]).some(x=>(x.candidates||[]).some(c=>(typeof c==='string'?c:c.id)===id));}
function cardNotes(reason=''){const [purpose,...version]=reason.split(' 版本说明：');return `<small>${esc(purpose)}</small>${version.length?`<details class="part-version"><summary>版本与装配说明</summary><small>${esc(version.join(' '))}</small></details>`:''}`;}
function card(row,library=false){const p=byId.get(row.id);if(!p)return '';const active=unit()||{progress:{}},record=active.progress[p.id]||{},qty=row.qty,progress=effectiveProgress(active,library?(bom?.rows.find(r=>r.id===p.id)||row):row,matches),done=progress.done,available=matches.has(p.id);const variant=matches.get(p.id)?.variant,perFile=variant?variant.piecesPerFile:componentFrames(p.id).length;const pair=perFile>1,pending=!available&&pendingCandidate(p.id);
  return `<article class="part-card ${done?'is-complete':''}" data-part="${p.id}"><button class="part-thumb" data-action="preview" data-id="${p.id}" aria-label="查看 ${esc(p.zh)} 三维模型">${available?`<img data-thumb="${p.id}" alt="正在生成本地预览" loading="lazy">`:thumbnailPlaceholder(pending?'有候选版本待核对':'尚未导入模型')}</button><div class="part-meta"><span class="badge ${available?'':'missing'}">${available?(row.required===false?'选配':'当前配置'): pending?'版本待确认':'尚未导入'}</span><h3>${esc(p.zh)}</h3><p>${esc(p.name)}</p>${library?`<small>${esc(row.optionalPurpose?'选配用途：'+row.optionalPurpose:row.reason||'')}</small>`:`<p>打印 <strong>${qty??'待确认'}</strong> 份${pair&&!matches.get(p.id)?.manual?' · 每份含 '+perFile+' 个零件':''}</p>${cardNotes(row.reason)}<p class="progress-text">${record.downloadedAt?'已下载':'未下载'} · 已打印 ${progress.printed}/${qty??'?'} 份${progress.note?' · '+esc(progress.note):''}</p>`}</div><div class="part-actions">${button(record.downloadedAt?'再次下载':'下载 STL','download',p.id)}${library?'':button(done?'撤销已打印':'标记已打印',done?'undo-print':'printed',p.id,done?'btn btn-quiet':'btn btn-primary')}${!library&&!done&&record.printed>0?button('撤销已打印','undo-print',p.id,'btn btn-quiet'):''}${!library&&matches.get(p.id)?.manual?`<label class="partial-count">核对打印份数<input data-manual-qty="${p.id}" type="number" min="1" max="10000" value="${qty??''}" aria-label="${esc(p.zh)} 此版本需要打印几份"></label>`:''}${!library&&qty>1?`<label class="partial-count">完成份数<input data-count="${p.id}" type="number" min="0" max="${qty}" value="${progress.printed}" aria-label="${esc(p.zh)} 已打印份数"></label>`:''}</div></article>`;
}
function renderPrint(){
  if(!bom)return;const q=$('print-search').value.toLowerCase(),filter=$('print-filter').value;
  const rows=bom.rows.filter(r=>{const p=byId.get(r.id),done=effectiveProgress(unit(),r).done;return (!q||(p.zh+p.name).toLowerCase().includes(q))&&(filter==='all'||(filter==='done'?done:!done));});
  $('print-list').innerHTML=rows.map(r=>card(r)).join('')||'<div class="empty-state">当前筛选没有零件</div>';watchThumbs($('print-list'));
  const summary=printProgress(unit(),bom.rows),progress=bom.rows.map(r=>effectiveProgress(unit(),r)),remainder=progress.reduce((n,p)=>n+p.remainder,0);
  const completed=progress.reduce((n,p)=>n+(p.done?p.required:!p.pending&&p.physicalRequired>0&&p.physicalDone!==null?Math.min(p.required,p.required*p.physicalDone/p.physicalRequired):p.printed),0);
  $('module-progress').value=summary.required?completed/summary.required*100:0;
  $('print-summary').textContent=`${summary.printed} / ${summary.required} 份已打印${remainder?' · 另有 '+remainder+' 个实体不足对应文件的一整份':''}${summary.pending?' · 还有份数或实体数待确认':''} · 下载与打印分别记录`;
}

function selectPart(p){selected=p;mainViewer?.select(p.key);const item=byId.get(p.id);if(!item)return;$('model-popover').hidden=false;$('selected-name').textContent=item.zh;$('selected-subtitle').textContent=item.name;refreshSelection();colorPaletteUI?.render();sound();}
function refreshSelection(){if(!selected)return;const r=bom?.rows.find(r=>r.id===selected.id),p=unit().progress[selected.id]||{},progress=r?effectiveProgress(unit(),r):null;$('selected-qty').textContent=`${r?.qty??'待确认'} 份 STL`;$('selected-options').textContent=(selected.drawerSlot!==undefined?'框内第 '+(selected.drawerSlot+1)+' 个抽屉。 ':'')+(unit().config.drawers?.length>1&&r?.qty>1?'本框此文件合计 '+r.qty+' 份；分批完成可在下方清单填写份数。 ':'')+(r?.reason||'')+(progress?.note?' · '+progress.note:'')+(selected.unresolved?' · 此文件尚未可靠拆分，显示完整原始模型':'');$('selected-download').disabled=!matches.has(selected.id);$('selected-print').disabled=!Number.isInteger(r?.qty);$('selected-print').hidden=false;$('selected-undo').hidden=!(p.printed>0);$('selected-print').textContent=progress?.done?'已打印 ✓':'标记已打印 ✓';}
function mark(id,value){if(!unit()||!bom)return;const row=bom.rows.find(r=>r.id===id);if(!row||!Number.isInteger(row.qty)){toast('先确认此零件的打印份数');return;}setPrinted(unit(),id,Math.min(row.qty,Math.max(0,value)),row.piecesPerFile);save();renderPrint();renderQueue();refreshSelection();syncPrintedViewers();if(currentPlan())renderPlanUI();sound();toast(value?'已标记打印完成，可随时撤销':'已撤销打印标记');}
function download(id){const item=matches.get(id);if(!item){toast('此零件尚未导入，请到模型管理查看');return;}const a=document.createElement('a'),url=URL.createObjectURL(item.file);a.href=url;a.download=item.file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);if(unit()){downloaded(unit(),id);save();}renderPrint();refreshSelection();sound();const row=bom?.rows.find(r=>r.id===id);toast(`已下载原始 STL${row?.qty?` · 切片时打印 ${row.qty} 份`:''}，打印完成后手动标记`);}
async function preview(id){if(!matches.has(id)){toast('请先导入这个零件的 STL');return;}selectedLibrary=id;$('part-title').textContent=byId.get(id).zh;$('part-dialog').showModal();partViewer ||= makeViewer('part-canvas',{onStatus:text=>{$('part-dialog').querySelector('.dialog-footer p').textContent=text;}});const p=byId.get(id),variant=matches.get(id).variant,[min,max]=variant?.bbox||p.bbox,count=variant?Math.max(1,variant.sourceFrames?.length||0):componentFrames(id).length;await partViewer?.setScene({parts:Array.from({length:count},(_,component)=>({id,component,copy:0,cal:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[0,0,0],min,max,size:max.map((v,i)=>v-min[i])},position:[0,0,0]}))},matches,{mode:'assembled',raw:true,animate:false});}
function category(p){if(p.system==='mods')return '改装 / '+p.old.split('/')[1];if(/Universal/.test(p.old))return (p.system==='drawer'?'抽屉':'翻盖箱')+' / 通用件';return (p.system==='drawer'?'抽屉':'翻盖箱')+' / '+(p.name.match(/^(XL|[SML])/i)?.[1]||'其他');}
function renderLibrary(){
  if($('library-scope').value==='current'&&!unit()){$('library-count').textContent='当前没有选中的模块';$('library-list').innerHTML='<div class="empty-state">先选择或新建模块，也可切换到指定规格浏览零件。</div>';return;}
  if($('library-scope').value==='current'||!libraryConfig)libraryConfig=clone(unit()?.config||defaults('drawer'));
  for(const [id,key]of [['library-kind','kind'],['library-width','w'],['library-depth','d'],['library-height','h']])if($(id))$(id).value=libraryConfig[key]||'';
  const q=$('library-search').value.toLowerCase(),cat=$('library-category').value,scope=$('library-scope').value,all=scope==='all';
  const selectedRows=libraryRows(libraryConfig,$('library-optional')?.checked===true),current=new Map(selectedRows.map(r=>[r.id,r]));
  const rows=catalog.filter(p=>(all||current.has(p.id))&&(!q||(p.zh+p.name+p.old).toLowerCase().includes(q))&&(cat==='all'||category(p)===cat)&&(scope!=='missing'||!matches.has(p.id)));
  $('library-count').textContent=`${rows.length} 类 · ${all?'全部零件':libraryConfig.kind==='mods'?'所选改装方案':libraryConfig.w+libraryConfig.d+' '+libraryConfig.h} · 已导入 ${matches.size}/${catalog.length}`;
  $('library-list').innerHTML=rows.map(p=>card(current.get(p.id)||{id:p.id},true)).join('')||'<div class="empty-state">没有符合条件的零件</div>';watchThumbs($('library-list'));
  for(const id of ['library-width','library-depth','library-height','library-optional'])if($(id))$(id).disabled=all||libraryConfig.kind==='mods';
  if($('library-height'))for(const option of $('library-height').options)option.disabled=!layerConfigs({kind:libraryConfig.kind,pattern:libraryConfig.w,d:libraryConfig.d,h:option.value}).length;
}
function changeLibrary(e){
  const key=({'library-kind':'kind','library-width':'w','library-depth':'d','library-height':'h'})[e.target.id];
  if(key){libraryConfig ||= clone(unit()?.config||defaults('drawer'));const dims={w:libraryConfig.w||'L',d:libraryConfig.d||'3',h:libraryConfig.h||'1F',[key]:e.target.value},kind=key==='kind'?e.target.value:libraryConfig.kind;
    libraryConfig=kind==='mods'?clone(unit()?.config.kind==='mods'?unit().config:defaults('mods')):moduleConfig(kind,dims.w,dims.d,dims.w==='XL'?'1F':dims.h);
    if(kind==='drawer')libraryConfig.roof=defaults('drawer').roof;
    $('library-scope').value='fit';$('library-category').value='all';
  }renderLibrary();
}

let catalogKeyPromise;
function modelCatalogKey(){return catalogKeyPromise||=new Blob([JSON.stringify(catalog)]).arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(hash=>Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join(''));}
async function importFiles(files,{recovered=null}={}){if(importBusy)return;const generation=++importGeneration;importAbort=new AbortController();const signal=importAbort.signal;importBusy=true;let succeeded=false;stopPlay();$('import-summary').textContent='正在读取本地模型…';$('import-progress').value=0;$('import-status').textContent=recovered?'正在恢复本地模型…':'检查模型文件…';
  try{const cached=recovered?restoreModelCache(recovered,await modelCatalogKey(),new Set(byId.keys())):null;if(generation!==importGeneration)return;const result=cached||await scanFiles(files,catalog,{signal,onProgress:p=>{const n=typeof p==='number'?p:p.percent??(p.total?p.processed/p.total*100:0);$('import-progress').value=n;$('import-status').textContent=['geometry','content'].includes(p.status)?`正在分析模型内容：${p.fileName} · ${Math.round((p.fileProgress||0)*100)}%`:`正在匹配模型 ${Math.round(n)}%`;$('import-summary').textContent=$('import-status').textContent;}});if(generation!==importGeneration)return;if(!recovered)recovery?.invalidate();importedFiles=files.filter(f=>/\.stl$/i.test(f.name));report=result;matches=result.matches;if(recovered&&!cached)for(const entry of recovered.manual){const file=recovered.files[entry.index];if(byId.has(entry.id)&&file&&entry.quantityByUnit&&typeof entry.quantityByUnit==='object')matches.set(entry.id,{file,method:'人工确认',manual:true,quantityByUnit:entry.quantityByUnit});}clearGeometry();clearThumbnails();renderMatches();if(!recovered||!matches.size)$('models-dialog').showModal();$('import-status').textContent=importHint(result)||`已匹配 ${matches.size}/${catalog.length} 类零件`;succeeded=true;}catch(e){if(generation===importGeneration&&e.name!=='AbortError'){toast('导入失败：'+e.message);$('import-status').textContent=e.message;}}finally{if(generation===importGeneration){importBusy=false;if(succeeded)recovery?.save();if(succeeded&&recovered&&matches.size){showWorkspace();toast('已恢复导入模型、组合方案与打印记录');}}}
}
function importHint(result){const d=result?.diagnostics;return d?.emptyReason==='macos-metadata'?'选中的是 macOS 附属信息目录，不是模型。请返回上一级，选择与 __MACOSX 并列的模型主目录。':d?.emptyReason==='archive-only'?'选中的目录只有压缩包，请先解压，再选择包含 STL 模型的文件夹。':d?.emptyReason==='no-stl'?'此目录没有 STL 模型。说明书或原始文档备份目录不能用于模型导入，请选择实际模型目录。':'';}
function renderMatches(){const q=$('match-search').value.toLowerCase();$('import-summary').textContent=`已匹配 ${matches.size} / ${catalog.length} · 未匹配 ${catalog.length-matches.size} · 待确认 ${report?.conflicts?.length||0} · 无效 ${report?.invalid?.length||0} · 重复 ${report?.duplicates?.length||0}`;$('confirm-import').disabled=!matches.size;$('dialog-import-feedback').textContent=importHint(report)||(report?.diagnostics?.metadataCount?`已跳过 ${report.diagnostics.metadataCount} 个 macOS 附属文件。`:'');let html='';
  for(const [i,x]of (report?.conflicts||[]).entries()){const file=x.file||x.input?.file;const candidates=x.candidates||[];html+=`<div class="match-row missing"><strong>待确认：${esc(file?.name||x.path||'文件')}</strong><span>${esc(({'name-only':'名称相符，内容版本需确认','geometry-version':'尺寸相近，但完整几何不同：请选择版本并核对外形与数量','geometry-mismatch':'几何数据与已知版本不同','ambiguous-name':'名称对应多个零件','catalog-size-mismatch':'文件长度与记录不同'})[x.reason]||'文件版本或名称不唯一')}</span><select data-resolve="${i}"><option value="">选择对应零件</option>${candidates.map(v=>{const id=typeof v==='string'?v:v.id;const p=byId.get(id);return p?`<option value="${id}">${esc(p.zh+' · '+p.old)}</option>`:'';}).join('')}</select></div>`;}
  for(const p of catalog){if(q&&!(p.name+p.zh+p.old).toLowerCase().includes(q))continue;const m=matches.get(p.id);html+=`<div class="match-row ${m?'':'missing'}"><strong>${esc(p.zh)}</strong><span>${esc(p.name)}</span><span>${m?'已匹配 · '+esc(({geometry:'完整几何一致',content:'完整文件内容一致',fingerprint:'已知文件内容',人工确认:'人工确认 · 装配位置待核对'})[m.method]||m.method||'文件内容'):pendingCandidate(p.id)?'有候选 · 待确认版本':'尚未匹配'}</span></div>`;}
  for(const x of report?.invalid||[])html+=`<div class="match-row missing">${esc(x.file?.name||x.name||x.path)} · ${esc(x.message||x.reason||x.error||'无效 STL')}</div>`;
  for(const [i,x]of (report?.unmatched||[]).entries()){if(['unsupported-extension','system-metadata'].includes(x.reason))continue;html+=`<div class="match-row missing"><strong>未识别 · ${esc(x.file?.name||x.path||'STL')}</strong><span>几何版本未收录，可搜索对应零件后人工核对；打印份数也需确认。</span><input data-match-unknown="${i}" list="part-identities" aria-label="为 ${esc(x.file?.name||'文件')} 选择对应零件" placeholder="搜索型号或零件名"></div>`;}
  html+=`<datalist id="part-identities">${catalog.map(p=>`<option value="${esc(p.id+' · '+p.zh+' · '+p.name)}"></option>`).join('')}</datalist>`;
  $('match-list').innerHTML=html;
}
function exportState(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download='vault-print-progress.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('已导出配置和进度；不含模型文件');}
function addUnit(config,name){const u={id:uid(),name:name||`模块 ${state.units.length+1}`,config:clone(config),progress:{},colors:{}};state.units.push(u);state.activeUnit=u.id;save();return u;}

// Scene construction keeps assembly.js's measured size and pitch.
let pickedPattern='L',pickedKind='drawer',pickedDepth='3',pickedHeight='1F',pickedRightKind=null,pickedRightHeight=null;
let selectedTier=-1,selectedPlanUnit=null,planScene=null,lastPlan=null,lastMainUnit=null,planTicket=0;
let libraryConfig=null,manualPage=1,manualBookId='drawer',manualLoadedBook=null,manualLoadToken=0,manualAbort,manualFetching=false,manualFailures={};
const manualReaders={};
function currentPlan(){return state.plans.find(p=>p.id===state.activePlan);}
function ensurePlan(){if(!currentPlan()){const p={id:uid(),name:'我的组合方案',tiers:[]};state.plans.push(p);state.activePlan=p.id;save();}return currentPlan();}
function progressText(u){const rows=unitBOM(u,matches).rows,p=printProgress(u,rows),remainder=rows.reduce((n,r)=>n+effectiveProgress(u,r).remainder,0);return `${p.done?'✓ 已完成 · ':''}${p.printed}/${p.required} 份${remainder?' · 另有 '+remainder+' 个实体不足整份':''}${p.pending?' · 份数或实体数待确认':''}`;}
function unitComplete(u){return queueProgress(u).done;}
function tierProgressText(tier){const progress=tier.ids.map(id=>{const u=state.units.find(u=>u.id===id);return printProgress(u,unitBOM(u,matches).rows);}),printed=progress.reduce((n,p)=>n+p.printed,0),required=progress.reduce((n,p)=>n+p.required,0);return `${progress.every(p=>p.done)?'✓ 已完成 · ':''}${printed}/${required} 份${progress.some(p=>p.pending)?' · 份数待确认':''}`;}
function syncPrintedViewers(){mainViewer?.setPrintedState?.(printedState(scene,unit()?[unit()]:[],matches),{ghost:state.printedGhost!==false});planViewer?.setPrintedState?.(printedState(planScene,state.units,matches),{ghost:state.printedGhost!==false});}
function selectTier(index,id){const p=currentPlan();if(!p?.tiers[index])return;selectedTier=index;selectedPlanUnit=p.tiers[index].ids.includes(id)?id:p.tiers[index].ids[0];renderPlanUI();highlightTier();sound();}
function highlightTier(){const ids=selectedPlanUnit?[selectedPlanUnit]:currentPlan()?.tiers[selectedTier]?.ids||[];planViewer?.selectKeys?.((planScene?.parts||[]).filter(p=>ids.includes(p.instance)).map(p=>p.key));}
function renderPlanUI(){
  const p=ensurePlan();if(!p.tiers[selectedTier]){selectedTier=-1;selectedPlanUnit=null;}
  $('plan-select').innerHTML=state.plans.map(x=>`<option value="${esc(x.id)}" ${p.id===x.id?'selected':''}>${esc(x.name)}</option>`).join('');$('plan-name').value=p.name;
  const choices=layerChoices(pickedKind,pickedPattern),depths=[...new Set(choices.map(c=>c.d))],heights=choices.filter(c=>c.d===pickedDepth).map(c=>c.h);
  $('plan-palette').innerHTML=field('layer-kind','新层类型',pickedKind,[['drawer','抽屉'],['sustainer','翻盖箱']])+patterns.map(([id,ws])=>`<button type="button" class="plan-cell ${pickedPattern===id?'is-selected':''}" data-pattern="${id}" aria-pressed="${pickedPattern===id}"><span class="mini-layer">${ws.map(w=>`<i style="flex:${{S:2,M:3,L:4,XL:5}[w]}">${w}</i>`).join('')}</span><span>${ws.join(' ＋ ')}</span></button>`).join('')+field('layer-depth','深度',pickedDepth,depths)+field('layer-height','层高',pickedHeight,heights);
  if(['SS','SM'].includes(pickedPattern))$('plan-palette').innerHTML+='<p class="muted">左右列独立配置：上方类型与层高用于左列，右列在此设置；添加后可分别向上叠放。</p>'+field('layer-right-kind','右列类型',pickedRightKind||pickedKind,[['drawer','抽屉'],['sustainer','翻盖箱']])+field('layer-right-height','右列外框层高',pickedRightHeight||pickedHeight,['1F','2F','4F']);
  const insertAt=selectedTier<0?p.tiers.length:selectedTier+1;
  $('plan-grid').innerHTML=button(selectedTier<0?'＋ 在顶部添加这一层':`＋ 在第 ${selectedTier+1} 组上方添加整层`,'add-tier','','btn btn-primary')+p.tiers.slice().reverse().map((t,j)=>{const i=p.tiers.length-j-1,cols=tierColumns(t);return `<div class="plan-tier ${selectedTier===i?'is-selected':''} ${t.ids.every(id=>unitComplete(state.units.find(u=>u.id===id)))?'is-complete':''}"><span>第 ${i+1} 组 · ${esc(tierProgressText(t))}</span><div class="plan-columns">${cols.map((col,k)=>`<div class="plan-column" style="flex:${{S:2,M:3,L:4,XL:5}[state.units.find(u=>u.id===col[0]).config.w]}"><small>${cols.length===1?'独立列':k?'右列':'左列'}</small><div class="mini-layer column-modules">${col.slice().reverse().map(id=>{const u=state.units.find(u=>u.id===id);return `<button class="${unitComplete(u)?'is-complete':''}" data-action="select-tier" data-id="${esc(id)}" data-tier="${i}" aria-pressed="${selectedPlanUnit===id}" style="--module-f:${parseInt(u.config.h)}">${esc(u.config.w+u.config.d+' '+u.config.h)} · ${u.config.kind==='drawer'?'抽屉':'翻盖箱'}<small>${u.config.drawers?esc(u.config.drawers.join('＋'))+' · ':''}${esc(progressText(u))}</small></button>`;}).join('')}</div><button class="btn btn-outline column-add" data-action="add-column" data-tier="${i}" data-column="${k}" aria-label="在第 ${i+1} 组${k?'右':'左'}列顶部添加模块">＋ 此列上方添加</button></div>`).join('')}</div>${button('删除整组','remove-tier',String(i),'btn btn-quiet')}</div>`;}).join('');
  const candidate=makeTier(insertAt),problem=candidate?changePlan(p,state.units,{type:'insert',index:insertAt,...candidate}).error:'目录中没有此尺寸配置';
  const addButton=$('plan-grid').querySelector('[data-action="add-tier"]');addButton.disabled=!!problem;addButton.title=problem||'';
  const used=p.tiers.flatMap(t=>t.ids);$('plan-units').innerHTML=used.map(id=>{const u=state.units.find(u=>u.id===id),i=p.tiers.findIndex(t=>t.ids.includes(id));return `<button class="unit-chip ${unitComplete(u)?'is-complete':''}" data-action="select-tier" data-tier="${i}" data-id="${esc(id)}">${esc(u.name)}<span>${esc(progressText(u))}</span></button>`;}).join('');
  $('plan-validation').textContent=validateTiers(p.tiers,state.units)||problem||(p.tiers.length?'尺寸规则通过 · 点击层可调整，完成组合后进入打印':'先选类型、宽度布局、深度和层高，再添加。每个模块独立记录打印进度。');
  const overlay=$('plan-selection');
  if(overlay){overlay.hidden=selectedTier<0;if(selectedTier>=0){
    const t=p.tiers[selectedTier],u=state.units.find(u=>u.id===selectedPlanUnit)||state.units.find(u=>u.id===t.ids[0]),columns=tierColumns(t),col=columns.findIndex(c=>c.includes(u.id));
    overlay.innerHTML=`<h3>第 ${selectedTier+1} 组 · ${columns.length===1?'独立列':col?'右列':'左列'} · ${esc(u.config.w+u.config.d+' '+u.config.h)}</h3><p>${esc(u.name+' · '+progressText(u))}</p>${field('edit-kind','此模块类型',u.config.kind,[['drawer','抽屉'],['sustainer','翻盖箱']])}${field('edit-depth','整组深度',u.config.d,[3,4,5,6,7])}${field('edit-height','此模块外框层高',u.config.h,u.config.w==='XL'?['1F']:['1F','2F','4F'])}${u.config.kind==='drawer'?field('edit-drawers','此框内部抽屉',(u.config.drawers||[u.config.h]).join('+'),drawerLayouts(u.config.h).map(parts=>[parts.join('+'),drawerLayoutLabel(parts,u.config.h)])):''}<div class="popover-actions">${button('应用配置','edit-tier')}${button('此列上方添加','add-column',String(col))}${button('删除此模块','remove-plan-unit',u.id)}${button('上移整组','move-tier','1')}${button('下移整组','move-tier','-1')}${button('删除整组','remove-tier',String(selectedTier))}${button('取消选择','clear-tier')}</div>`;
    const add=overlay.querySelector('[data-action="add-column"]');add.dataset.tier=String(selectedTier);add.dataset.column=String(col);
    for(const [action,delta]of [['move-tier',1],['move-tier',-1]]){const b=overlay.querySelector(`[data-action="${action}"][data-id="${delta}"]`);b.disabled=!!changePlan(p,state.units,{type:'move',index:selectedTier,to:selectedTier+delta}).error;}
  }}
  if($('plan-finish'))$('plan-finish').disabled=!used.length;renderQueue();
}
function normalizeLayerChoice(){const choices=layerChoices(pickedKind,pickedPattern);if(!choices.some(c=>c.d===pickedDepth))pickedDepth=choices[0]?.d||'3';if(!choices.some(c=>c.d===pickedDepth&&c.h===pickedHeight))pickedHeight=choices.find(c=>c.d===pickedDepth)?.h||'1F';}
function makeTier(index){const configs=layerConfigs({kind:pickedKind,pattern:pickedPattern,d:pickedDepth,h:pickedHeight,rightKind:pickedRightKind||pickedKind,rightHeight:pickedRightHeight||pickedHeight});if(!configs.length)return null;const units=configs.map(config=>({id:uid(),name:`${config.w}${config.d} ${config.h} · 模块 ${state.units.length+configs.indexOf(config)+1}`,config,progress:{},colors:{}}));return {units,tier:{pattern:units.length===1?'single':pickedPattern,ids:units.map(u=>u.id)}};}
async function renderPlan({animate=false}={}){
  const p=ensurePlan(),ticket=++planTicket;renderPlanUI();
  planViewer ||= makeViewer('plan-canvas',{onSelect:part=>{const i=currentPlan()?.tiers.findIndex(t=>t.ids.includes(part.instance));if(i>=0)selectTier(i,part.instance);}});
  const combined=buildComposition(p,state.units);if(combined.warnings.length)$('plan-validation').textContent=combined.warnings.join(' ');
  planScene=combined;const fit=lastPlan!==p.id,colors=Object.assign({},...p.tiers.flatMap(t=>t.ids).map(id=>state.units.find(u=>u.id===id).colors));await planViewer?.setScene(combined,matches,{fit,animate,colors});if(ticket!==planTicket)return;if(!fit&&animate)planViewer?.fitIfNeeded();if(combined.parts.length)lastPlan=p.id;syncPrintedViewers();highlightTier();
}
function applyPlanChange(operation,selection=selectedTier){
  const p=ensurePlan(),result=changePlan(p,state.units,operation);if(result.error){toast(result.error);return false;}
  const problem=state.plans.filter(other=>other.id!==p.id).map(other=>validateTiers(other.tiers,result.units)||compositionProblem(other,result.units)).find(Boolean);if(problem){toast(problem);return false;}
  state.units=result.units;state.plans[state.plans.indexOf(p)]=result.plan;selectedTier=selection;selectedPlanUnit=result.plan.tiers[selection]?.ids.includes(selectedPlanUnit)?selectedPlanUnit:result.plan.tiers[selection]?.ids[0]||null;reconcileQueue(state);save();renderPlan({animate:['insert','insert-column','edit-unit'].includes(operation.type)});render();sound(operation.type==='insert'?'add':'click');return true;
}
function addTier(index=selectedTier<0?ensurePlan().tiers.length:selectedTier+1){const candidate=makeTier(index);if(!candidate){toast('目录中没有此尺寸配置');return;}applyPlanChange({type:'insert',index,...candidate},index);}
function removeTier(index){const next=selectedTier===index?-1:selectedTier>index?selectedTier-1:selectedTier;applyPlanChange({type:'remove',index},next);}
function editTier(){
 const overlay=$('plan-selection'),u=state.units.find(u=>u.id===selectedPlanUnit);if(!overlay||!u)return;
 const kind=overlay.querySelector('[name="edit-kind"]').value,h=overlay.querySelector('[name="edit-height"]').value,d=overlay.querySelector('[name="edit-depth"]').value;
 const config=kind===u.config.kind?{...u.config,h,d}:{...moduleConfig(kind,u.config.w,d,h),drawers:undefined},layout=overlay.querySelector('[name="edit-drawers"]');
 if(kind==='drawer'&&layout){if(u.config.drawers!==undefined||layout.value!==u.config.h)config.drawers=layout.value.split('+');else delete config.drawers;}
 applyPlanChange({type:'edit-unit',index:selectedTier,id:u.id,sharedPatch:{d},patch:config});
}
function addColumnModule(index,column){const t=currentPlan()?.tiers[index],ids=t&&tierColumns(t)[column];if(!ids)return;const top=state.units.find(u=>u.id===ids.at(-1));const config=moduleConfig(pickedKind,top.config.w,top.config.d,pickedHeight);const u={id:uid(),name:`${config.w}${config.d} ${config.h} · 模块 ${state.units.length+1}`,config,progress:{},colors:{}};if(applyPlanChange({type:'insert-column',index,column,at:ids.length,unit:u},index)){selectedPlanUnit=u.id;renderPlanUI();highlightTier();}}
function finishPlan(){const p=currentPlan();if(!p?.tiers.length)return;selectQueue(state,p.id,unitComplete);step=Infinity;save();showTab('config');render();}
function resetPlanSelection(){selectedTier=-1;selectedPlanUnit=null;}
function initManualViewers(){
  for(const language of ['en','zh']){const iframe=$('manual-'+language+'-frame'),container=iframe?.closest('.manual-view');if(container)manualReaders[language]=new LocalManualViewer({container,iframe,onChange:renderManualStatus});}
}
function renderManualStatus(){
  const entries=['en','zh'].map(language=>({language,...(manualReaders[language]?.snapshot()||{})})),max=Math.max(1,...entries.map(s=>s.pages||0)),loaded=entries.some(s=>s.pages>0);
  if($('manual-page')){$('manual-page').value=manualPage;$('manual-page').max=max;$('manual-page').disabled=!loaded;}
  if($('manual-prev'))$('manual-prev').disabled=!loaded||manualPage<=1;
  if($('manual-next'))$('manual-next').disabled=!loaded||manualPage>=max;
  if($('manual-status'))$('manual-status').textContent=entries.map(s=>{const label=s.language==='en'?'英文':'中文';if(manualFetching)return label+' · 正在加载内置手册';if(manualFailures[s.language])return label+' · '+manualFailures[s.language];if(s.error)return label+' · '+s.error;if(s.loading)return label+' · 正在读取本地 PDF';if(!s.pages)return label+' · 选择章节即可阅读';return `${label} ${s.page||1}/${s.pages} 页${manualPage>s.pages?'（已限到末页，共同页码 '+manualPage+'）':''}${s.rendering?' · 正在绘制':''}`;}).join(' · ');
}
function syncManualPage(){
  const max=Math.max(1,...Object.values(manualReaders).map(reader=>reader.snapshot().pages));manualPage=Math.min(max,Math.max(1,manualPage));
  const renders=Object.values(manualReaders).map(reader=>reader.setPage(manualPage));renderManualStatus();return Promise.all(renders);
}
async function loadManual(language,file){manualLoadToken++;manualAbort?.abort();manualFetching=false;manualFailures={};manualLoadedBook='custom';if($('manual-source-'+language))$('manual-source-'+language).textContent='自选 PDF · '+file.name;const reader=manualReaders[language];if(!reader)return;if(await reader.load(file,manualPage))await syncManualPage();else renderManualStatus();}


function renderManualBooks(){const container=$('manual-books');if(container)container.innerHTML=books.map(b=>`<button type="button" class="manual-book" data-manual-book="${b.id}" aria-pressed="${b.id===manualBookId}"><strong>${esc(b.title)}</strong><small>${esc(b.englishTitle)} · ${b.files.en.pages} 页</small></button>`).join('');}
async function ensureBundledManuals(force=false){
  if(!force&&(manualLoadedBook===manualBookId||manualLoadedBook==='custom'))return syncManualPage();
  if(manualFetching&&!force)return;
  const token=++manualLoadToken;manualAbort?.abort();manualAbort=new AbortController();const signal=manualAbort.signal;manualFetching=true;manualFailures={};renderManualStatus();
  const results=await Promise.allSettled(['en','zh'].map(async language=>{await manualReaders[language]?.reset();const file=await bundledManual(manualBookId,language,{signal});if(token!==manualLoadToken)return;await manualReaders[language]?.load(file,manualPage);if($('manual-source-'+language))$('manual-source-'+language).textContent=language==='en'?'USSA Design 英文原文':'中文对照 · 非官方译文';}));
  if(token!==manualLoadToken)return;manualFetching=false;manualLoadedBook=results.every(r=>r.status==='fulfilled')?manualBookId:null;
  results.forEach((r,i)=>{if(r.status==='rejected'&&r.reason?.name!=='AbortError')manualFailures[['en','zh'][i]]=r.reason?.message||'加载失败，可重试';});await syncManualPage();
}

document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.tab){showTab(b.dataset.tab);return;}if(b.dataset.view){if(view===b.dataset.view&&explode===(view==='exploded'?1:0))return;view=b.dataset.view;explode=view==='exploded'?1:0;$('explode-range').value=explode*100;$('explode-label').value=Math.round(explode*100)+'%';document.querySelectorAll('[data-view]').forEach(x=>{x.classList.toggle('is-active',x===b);x.setAttribute('aria-pressed',x===b?'true':'false');});updateAnimation();sound();return;}if(b.dataset.pattern){pickedPattern=b.dataset.pattern;normalizeLayerChoice();renderPlanUI();sound();return;}
  const id=b.dataset.id;switch(b.dataset.action){case'preview':preview(id);break;case'download':download(id);break;case'printed':mark(id,bom.rows.find(r=>r.id===id)?.qty);break;case'undo-print':mark(id,0);break;case'import-folder':chooseModelFolder();break;case'add-tier':addTier();break;case'add-column':addColumnModule(Number(b.dataset.tier),Number(b.dataset.column));break;case'remove-plan-unit':applyPlanChange({type:'remove-unit',index:selectedTier,id});break;case'remove-tier':removeTier(Number(id));break;case'select-tier':selectTier(Number(b.dataset.tier),id);break;case'edit-tier':editTier();break;case'move-tier':applyPlanChange({type:'move',index:selectedTier,to:selectedTier+Number(id)},selectedTier+Number(id));break;case'insert-below':addTier(selectedTier);break;case'clear-tier':resetPlanSelection();renderPlanUI();highlightTier();break;case'switch-unit':openQueueUnit(id);break;}
});
let directoryBusy=false,useFolderInput=false,directoryGeneration=0;
async function acquireModels(read){
 if(importBusy||directoryBusy)return;directoryBusy=true;const token=++directoryGeneration;
 try{const files=await read();if(token!==directoryGeneration||files===null)return;if(!files.length){const message='未读取到文件。请选择包含 STL 的整个文件夹，或使用“选择 STL 文件”。';$('import-status').textContent=message;toast(message);return;}await importFiles(files);}
 catch(e){if(token!==directoryGeneration)return;if(e.code==='directory-read-error')useFolderInput=true;$('import-status').textContent=e.message;toast(e.message);}
 finally{if(token===directoryGeneration){directoryBusy=false;if(matches.size)recovery?.save();}}
}
function chooseModelFolder(){
 if(importBusy||directoryBusy)return;
 if(useFolderInput||!canPickDirectory()){
  const input=$('folder-input');if('webkitdirectory' in input)input.click();else{toast('当前浏览器不支持整个文件夹选择，请多选 STL，或拖入模型总目录。');$('files-input').click();}return;
 }
 return acquireModels(async()=>{const result=await pickDirectory();if(result.status==='selected')return result.files;if(result.status==='fallback'){useFolderInput=true;const message=result.message+' 再次点击“选择文件夹”即可使用普通选择。';$('import-status').textContent=message;toast(message);}return null;});
}
$('choose-folder').onclick=chooseModelFolder;$('choose-files').onclick=()=>{if(!directoryBusy&&!importBusy)$('files-input').click();};
for(const id of ['folder-input','files-input'])$(id).onchange=e=>{void acquireModels(()=>collectDirectoryFiles(e.target.files));e.target.value='';};
for(const zone of [$('gate'),$('models-dialog')]){
 zone.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files'))e.preventDefault();});
 zone.addEventListener('drop',e=>{if(!Array.from(e.dataTransfer?.types||[]).includes('Files'))return;e.preventDefault();void acquireModels(()=>collectDroppedFiles(e.dataTransfer));});
}
$('open-models').onclick=()=>{renderMatches();$('models-dialog').showModal();};$('models-close').onclick=()=>$('models-dialog').close();$('confirm-import').onclick=showWorkspace;
$('clear-models').onclick=()=>{directoryGeneration++;directoryBusy=false;importGeneration++;importAbort?.abort();importBusy=false;recovery?.invalidate({remove:true});importedFiles=[];matches=new Map();report=null;clearGeometry();clearThumbnails();renderMatches();$('workspace').hidden=true;$('gate').hidden=false;toast('已清除本次导入；配置与打印记录保留');};$('match-search').oninput=renderMatches;
$('match-list').onchange=e=>{const unknown=e.target.dataset.matchUnknown!==undefined,index=Number(unknown?e.target.dataset.matchUnknown:e.target.dataset.resolve);if(!unknown&&e.target.dataset.resolve===undefined)return;const id=unknown?e.target.value.split(' · ')[0]:e.target.value;if(!byId.has(id))return;const items=unknown?report.unmatched:report.conflicts,x=items[index],file=x?.file||x?.input?.file;if(!file)return;matches.set(id,{file,method:'人工确认',manual:true,quantityByUnit:{}});items.splice(index,1);clearGeometry();clearThumbnails();renderMatches();recovery?.save();toast('已关联零件；进入工作台后请核对外形、实体数量与打印份数');};
$('config-form').onsubmit=e=>e.preventDefault();$('config-form').onchange=e=>{const {name,type,value,checked}=e.target;if(!name)return;const priorConfig=clone(unit().config);if(name==='name'){unit().name=value;save();$('current-module').textContent=value;renderQueue();return;}if(name==='kind'){unit().config=defaults(value);step=Infinity;}else{const c=unit().config,v=type==='checkbox'?checked:type==='number'?(value===''?undefined:Number(value)):value;if(name.startsWith('dividers.')){c.dividers||={};c.dividers[name.split('.')[1]]=v;c.dividerLayout='custom';}else if(name==='drawer-layout')c.drawers=v.split('+');else c[name]=v;if(c.w==='XL')c.h='1F';if(['w','h'].includes(name)&&c.drawers&&drawerLayoutProblem(c))c.drawers=[c.h];if(c.kind==='sustainer'&&name==='w'){c.interior=['S','M'].includes(c.w)?'standard':'flat';c.lockCount=['S','M'].includes(c.w)?1:2;}if(name==='family')c.qty=1;}const conflict=state.plans.map(p=>validateTiers(p.tiers,state.units)||compositionProblem(p,state.units)).find(Boolean)||(state.plans.some(p=>p.tiers.some(t=>t.ids.includes(unit().id)))?configProblem(unit().config):'');if(conflict){unit().config=priorConfig;toast(conflict+'；请先调整组合层。');renderFields();return;}save();render();if(currentPlan())renderPlan();};
$('module-switch').onchange=e=>openQueueUnit(e.target.value);
$('module-multi').onclick=()=>{batchMode=!batchMode;batchSelection.clear();renderQueue();};
$('module-select-all').onclick=()=>{if(!batchMode)return;batchSelection=new Set(queueUnits(state,null).map(u=>u.id));renderQueue();};
$('module-select-none').onclick=()=>{batchSelection.clear();renderQueue();};
$('module-delete-batch').onclick=()=>{if(!batchMode)return;const removed=deleteIndependents(state,[...batchSelection]);if(!removed){clearBatchSelection();renderQueue();toast('模块列表已变化，请重新选择');return;}clearBatchSelection();step=Infinity;lastMainUnit=null;save();render();sound();toast('已删除 '+removed.length+' 个模块，可整组撤销');};
$('module-delete').onclick=()=>{const removed=deleteIndependent(state,state.activeUnit);if(!removed)return;step=Infinity;lastMainUnit=null;save();render();sound();toast('已删除「'+removed.name+'」，可撤销恢复');};
$('module-undo-delete').onclick=()=>{const restored=undoIndependentDelete(state);if(!restored)return;clearBatchSelection();step=Infinity;lastMainUnit=null;save();showTab('config');render();sound();toast('已恢复模块、配置和打印记录');};
$('module-new').onclick=()=>{if(state.units.length>=200){toast('最多保存 200 个模块');return;}const u=addUnit(defaults('drawer'));openQueueUnit(u.id);};
$('queue-plan-select').onchange=e=>{clearBatchSelection();selectQueue(state,e.target.value||null,unitComplete);step=Infinity;save();render();};
$('module-cards').onclick=e=>{const b=e.target.closest('[data-queue-unit]');if(!b)return;if(batchMode){const id=b.dataset.queueUnit;if(batchSelection.has(id))batchSelection.delete(id);else batchSelection.add(id);renderQueue();sound();}else openQueueUnit(b.dataset.queueUnit);};
$('module-cards').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const cards=Array.from($('module-cards').children),i=cards.indexOf(e.target.closest('[data-queue-unit]'));if(i<0)return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?cards.length-1:Math.max(0,Math.min(cards.length-1,i+(e.key==='ArrowRight'?1:-1)));cards[n].focus();};
$('module-next').onclick=()=>{const next=nextIncomplete(state,unitComplete);if(next)openQueueUnit(next.id);};
$('stage-reset').onclick=()=>mainViewer?.fit();$('open-toggle').onclick=()=>{const from=open;open=open?0:1;$('open-toggle').setAttribute('aria-pressed',String(!!open));const c={...unit().config,id:unit().id,colors:unit().colors},options={explode,progress:step};updateAnimation(c.kind==='sustainer'?{from,to:open,at:value=>buildScene(c,{...options,open:value})}:null);mainViewer?.fit({animate:true,preserveDirection:true});};
$('step-prev').onclick=()=>{stopPlay();step=Math.max(0,(Number.isFinite(step)?step:(scene.steps?.length||1)-1)-1);updateAnimation();};$('step-next').onclick=()=>{stopPlay();step=Math.min((scene.steps?.length||1)-1,(Number.isFinite(step)?step:0)+1);updateAnimation();};$('step-play').onclick=()=>{if(playing){stopPlay();return;}step=0;updateAnimation();$('step-play').textContent='Ⅱ';$('step-play').setAttribute('aria-pressed','true');playing=setInterval(()=>{step++;if(step>=(scene.steps?.length||1)){step=(scene.steps?.length||1)-1;stopPlay();}updateAnimation();},1500);};$('step-range').oninput=e=>{stopPlay();step=Number(e.target.value);updateAnimation();};$('explode-range').oninput=e=>{explode=Number(e.target.value)/100;$('explode-label').value=e.target.value+'%';updateAnimation();};
$('selected-close').onclick=()=>{selected=null;mainViewer?.select(null);$('model-popover').hidden=true;colorPaletteUI?.render();};$('selected-download').onclick=()=>selected&&download(selected.id);$('selected-print').onclick=()=>selected&&mark(selected.id,bom.rows.find(r=>r.id===selected.id)?.qty);$('selected-undo').onclick=()=>selected&&mark(selected.id,0);
function colorsChanged(keys,color){mainViewer?.colorMany(keys,color);planViewer?.colorMany(keys,color);save();renderQueue();sound();}
const colorPart=color=>{if(!selected)return;unit().colors[selected.key]=color;colorsChanged([selected.key],color);};
colorPaletteUI=initColorPalette({getUnit:unit,getParts:()=>scene?.parts||[],getSelected:()=>selected,onChange:colorsChanged,onSingleColor:colorPart,notify:toast});
for(const id of ['print-search','print-filter'])$(id).addEventListener('input',renderPrint);$('print-list').onchange=e=>{const id=e.target.dataset.manualQty;if(id){const m=matches.get(id),qty=Number(e.target.value);if(m?.manual&&Number.isSafeInteger(qty)&&qty>=1&&qty<=10000){m.quantityByUnit||={};m.quantityByUnit[unit().id]={configKey:JSON.stringify(unit().config),qty};render();if(currentPlan())renderPlanUI();syncPrintedViewers();recovery?.save();}return;}if(e.target.dataset.count)mark(e.target.dataset.count,Number(e.target.value));};
$('part-close').onclick=()=>$('part-dialog').close();$('part-download').onclick=()=>selectedLibrary&&download(selectedLibrary);
$('library-category').innerHTML+=[...new Set(catalog.map(category))].map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');$('library-scope').value='current';if($('library-optional'))$('library-optional').checked=false;for(const id of ['library-search','library-category','library-scope','library-kind','library-width','library-depth','library-height','library-optional'])$(id)?.addEventListener('input',changeLibrary);
$('sound-toggle').onclick=()=>{state.sound=!state.sound;$('sound-toggle').setAttribute('aria-pressed',String(state.sound));$('sound-toggle').title=state.sound?'音效已开启':'音效已关闭';save();sound();};$('export-project').onclick=exportState;$('restore-project').onchange=async e=>{const file=e.target.files[0];try{if(!file||file.size>2e6)throw Error('请选择小于 2 MB 的进度文件');const next=sanitizeState(JSON.parse(await file.text()),new Set(byId.keys()));for(const u of next.units){const b=buildBOM(u.config);if(b.errors.length||b.missing.length||!b.rows.length)throw Error('文件包含无效模块配置');}for(const p of next.plans){const problem=validateTiers(p.tiers,next.units)||compositionProblem(p,next.units);if(problem)throw Error('组合配置无效：'+problem);}state=next;clearBatchSelection();clearThumbnails();resetPlanSelection();lastPlan=null;lastMainUnit=null;libraryConfig=null;save();syncPreferences();render();if(matches.size){if(tab==='combine')renderPlan();if(tab==='library')renderLibrary();}toast('已恢复配置和打印记录，请重新选择模型目录');}catch(err){toast(err.message);}e.target.value='';};
$('plan-new').onclick=()=>{if(state.plans.length>=30){toast('最多保存 30 个组合方案');return;}state.activePlan=null;resetPlanSelection();ensurePlan();renderPlan();};$('plan-select').onchange=e=>{state.activePlan=e.target.value;resetPlanSelection();save();renderPlan();};$('plan-name').onchange=e=>{currentPlan().name=e.target.value;save();renderPlan();};$('plan-remove').onclick=()=>{state.plans=state.plans.filter(p=>p.id!==state.activePlan);state.activePlan=state.plans[0]?.id||null;resetPlanSelection();reconcileQueue(state);save();render();renderPlan();};$('plan-duplicate').onclick=()=>{const old=currentPlan();if(state.plans.length>=30||state.units.length+old.tiers.flatMap(t=>t.ids).length>200){toast('组合或模块数量已达上限');return;}const priorActiveUnit=state.activeUnit,mapping=new Map(),p={id:uid(),name:old.name+' 副本',tiers:[]};for(const t of old.tiers){for(const id of t.ids)if(!mapping.has(id)){const u=state.units.find(u=>u.id===id),copy=addUnit(u.config,u.name+' 副本');copy.colors=Object.fromEntries(Object.entries(u.colors).map(([key,color])=>[key.startsWith(u.id+':')?copy.id+key.slice(u.id.length):key,color]));mapping.set(id,copy.id);}p.tiers.push({pattern:t.pattern,ids:t.ids.map(id=>mapping.get(id)),...(t.columns?{columns:t.columns.map(col=>col.map(id=>mapping.get(id)))}:{})});}state.plans.push(p);state.activePlan=p.id;state.activeUnit=priorActiveUnit;resetPlanSelection();save();renderPlan();};
window.addEventListener('error',e=>toast('操作未完成：'+e.message));window.addEventListener('unhandledrejection',e=>toast('操作未完成：'+(e.reason?.message||e.reason)));
$('import-status').textContent='首次导入后自动保存在当前浏览器，正在检查本机模型缓存…';

$('plan-palette').addEventListener('change',e=>{if(e.target.name==='layer-kind')pickedKind=e.target.value;if(e.target.name==='layer-depth')pickedDepth=e.target.value;if(e.target.name==='layer-height')pickedHeight=e.target.value;if(e.target.name==='layer-right-kind')pickedRightKind=e.target.value;if(e.target.name==='layer-right-height')pickedRightHeight=e.target.value;normalizeLayerChoice();renderPlanUI();});
$('plan-finish')?.addEventListener('click',finishPlan);$('plan-reset')?.addEventListener('click',()=>planViewer?.fit());
function syncPreferences(){const visible=state.printedGhost!==false,b=$('printed-visibility');if(b){if(b.type==='checkbox')b.checked=visible;b.setAttribute('aria-pressed',String(visible));b.title=visible?'已打印零件淡化显示':'已打印零件灰色不透明显示';if(b.type!=='checkbox')b.textContent='已打印淡化';}$('sound-toggle').setAttribute('aria-pressed',String(state.sound));$('sound-toggle').title=state.sound?'音效已开启':'音效已关闭';syncPrintedViewers();}
$('printed-visibility')?.addEventListener('click',()=>{state.printedGhost=state.printedGhost===false;save();syncPreferences();});
for(const language of ['en','zh'])$('manual-'+language+'-file')?.addEventListener('change',e=>{const file=e.target.files[0];if(file)loadManual(language,file);e.target.value='';});
$('manual-prev')?.addEventListener('click',()=>{manualPage=Math.max(1,manualPage-1);syncManualPage();});$('manual-next')?.addEventListener('click',()=>{manualPage++;syncManualPage();});$('manual-page')?.addEventListener('change',e=>{const page=Number(e.target.value);if(Number.isSafeInteger(page)&&page>0)manualPage=page;syncManualPage();});
window.addEventListener('pagehide',e=>{if(!e.persisted)for(const reader of Object.values(manualReaders))reader.destroy().catch(()=>{});});
syncPreferences();initManualViewers();syncManualPage();
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(batchMode){clearBatchSelection();renderQueue();return;}resetPlanSelection();if(tab==='combine'){renderPlanUI();highlightTier();}selected=null;mainViewer?.select(null);$('model-popover').hidden=true;colorPaletteUI?.close();}});

renderManualBooks();
$('manual-books')?.addEventListener('click',e=>{const b=e.target.closest('[data-manual-book]');if(!b)return;manualBookId=b.dataset.manualBook;manualPage=1;manualLoadedBook=null;renderManualBooks();ensureBundledManuals(true);});
$('manual-builtins')?.addEventListener('click',()=>{manualPage=1;manualLoadedBook=null;ensureBundledManuals(true);});
recovery=workspaceRecovery({getState:()=>state,getFiles:()=>importedFiles,getMatches:()=>matches,getReport:()=>report,getCatalogKey:modelCatalogKey,isImporting:()=>importBusy||directoryBusy,notify:text=>{$('import-status').textContent=text;$('model-cache-status').textContent=text;$('dialog-cache-status').textContent=text;},restore:async data=>{if(!stateWasRestored){state=sanitizeState(data.state,new Set(byId.keys()));save();syncPreferences();}await importFiles(data.files,{recovered:data});}});
initUpdates({prepareUpdate:progress=>recovery.prepare(progress)});
recovery.resume();
