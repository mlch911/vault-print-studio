import {checkVersion,newerVersion,validateVersion,PROJECT_URL} from './update-check.js';
const PREF='vault-print-studio-updates-v1',INTERVAL=6*60*60*1000;
export function initUpdates({prepareUpdate}){
  const local=__BUILD_INFO__,toolbar=document.querySelector('.header-actions');if(!toolbar)return;
  let prefs={automatic:true,lastChecked:0};try{Object.assign(prefs,JSON.parse(localStorage.getItem(PREF))||{});}catch{}
  let busy=false,latest=null,available=false;
  const button=document.createElement('button');button.id='update-check';button.className='btn btn-quiet update-check';button.type='button';button.textContent='↻ 更新';toolbar.insertBefore(button,document.getElementById('export-project'));
  const dialog=document.createElement('dialog');dialog.id='updates-dialog';dialog.className='updates-dialog';dialog.setAttribute('aria-labelledby','updates-title');
  dialog.innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">KEEP YOUR WORKSPACE</p><h2 id="updates-title">工具更新</h2></div><button id="updates-close" class="btn btn-icon" type="button" aria-label="关闭更新窗口">×</button></div><div class="dialog-body"><p id="updates-current" class="muted"></p><h3 id="updates-state" role="status" aria-live="polite">可以检查最新版本</h3><p id="updates-detail" class="muted">检查更新不会刷新页面，导入的模型与打印进度保持不变。</p><ul id="updates-notes"></ul><label class="update-auto"><input id="updates-auto" type="checkbox">启动时自动检查更新</label><p class="muted">只读取公开版本信息，模型和打印清单不会上传。</p><a class="btn btn-text" href="${PROJECT_URL}/commits/main" target="_blank" rel="noopener noreferrer">查看 GitHub 更新记录 ↗</a></div><div class="dialog-footer"><button id="updates-now" class="btn btn-outline" type="button">检查更新</button><button id="updates-apply" class="btn btn-primary" type="button" hidden>保存工作台并更新</button><a id="updates-download" class="btn btn-primary" href="${PROJECT_URL}/archive/refs/heads/main.zip" hidden>下载新版源码</a></div>`;
  document.body.appendChild(dialog);const $=id=>dialog.querySelector('#'+id),online=location.origin==='https://six111211.github.io';
  $('updates-current').textContent=`当前版本 ${local.version}${local.localEnhanced?' · 本地增强版':''} · ${local.commit.slice(0,7)}`;
  $('updates-auto').checked=prefs.automatic!==false;
  const savePrefs=()=>{try{localStorage.setItem(PREF,JSON.stringify(prefs));}catch{}};
  function showLatest(){
    button.classList.toggle('has-update',available);button.textContent=available?'● 有新版':'↻ 更新';
    $('updates-state').textContent=available?`发现新版 ${latest.version}`:'当前已是最新发布版本';
    $('updates-detail').textContent=available?(online?'先在本机保存模型与打印进度，保存成功后刷新到新版。':local.localEnhanced?'这是上游更新，未必包含本地的待打印 3MF 功能。请保留当前增强版，并先导出进度，再决定是否替换程序。':'先保存当前工作台，再下载新版源码替换本地程序。继续使用相同浏览器和本地端口，即可自动恢复。'):'当前模型、组合方案和打印记录均保持不变。';
    $('updates-apply').hidden=!available;$('updates-apply').textContent=online?'保存工作台并更新':'保存工作台，获取新版';
    $('updates-notes').replaceChildren();for(const text of latest.notes){const li=document.createElement('li');li.textContent=text;$('updates-notes').appendChild(li);}
  }
  async function check(manual=false){
    if(busy)return;busy=true;$('updates-now').disabled=true;$('updates-state').textContent='正在检查 GitHub 发布版本…';
    try{const result=await checkVersion(local);latest=result.latest;available=result.available;prefs.lastChecked=Date.now();prefs.latest=latest;savePrefs();showLatest();}
    catch(error){$('updates-state').textContent='暂时无法检查更新';$('updates-detail').textContent='可以继续使用当前工具，联网后再试。'+(manual?' '+(error.name==='AbortError'?'连接超时。':error.message):'');}
    finally{busy=false;$('updates-now').disabled=false;}
  }
  button.onclick=()=>{dialog.showModal();if(!latest)check(true);};$('updates-close').onclick=()=>dialog.close();$('updates-now').onclick=()=>check(true);
  $('updates-auto').onchange=()=>{prefs.automatic=$('updates-auto').checked;savePrefs();};
  $('updates-apply').onclick=async()=>{
    if(busy)return;busy=true;$('updates-apply').disabled=true;$('updates-now').disabled=true;$('updates-download').hidden=true;
    $('updates-state').textContent='正在本机保存模型与打印进度…';$('updates-detail').textContent='保存完成前不会刷新或退出。大型模型可能需要一些时间。';
    try{
      await prepareUpdate(message=>{$('updates-detail').textContent=message;});
      if(online){$('updates-state').textContent='已保存，正在打开新版…';const url=new URL(location.href);url.searchParams.set('v',latest.commit.slice(0,12));location.replace(url.href);}
      else{$('updates-state').textContent='工作台已安全保存';$('updates-detail').textContent='下载并替换本地程序后，以相同端口重新启动。新版会自动恢复已导入模型，打印记录继续保留。';$('updates-download').hidden=false;}
    }catch(error){$('updates-state').textContent='暂未更新，当前工作台保持打开';$('updates-detail').textContent=error.message;}
    finally{busy=false;$('updates-apply').disabled=false;$('updates-now').disabled=false;}
  };
  if(prefs.latest)try{latest=validateVersion(prefs.latest);available=newerVersion(local,latest);showLatest();}catch{}
  if(prefs.automatic!==false&&Date.now()-(Number(prefs.lastChecked)||0)>INTERVAL)setTimeout(()=>check(false),1800);
  return {check};
}
