import datums from './drawer-slot-data.json' with {type:'json'};
import {frameRoles,runnerRoles,drawerHeight} from './drawer-layout.js';

// Preserve existing copy identities and fill only the unused 1F rail positions.
export function fullRunnerScene(config,bom,options,build,framesForId){
 const base={...config,fullRunners:false},scene=build(base,options);
 const datum=datums[`${config.w}${config.d}-${config.h}`];
 const drawers=config.drawers||[config.h],starts=[];let start=0;
 for(const h of drawers){starts.push(start);start+=drawerHeight(h);}
 const existing=new Set(starts),original=scene.parts.slice();
 const host=build({...base,drawers:undefined},{...options,open:0});
 const copies=new Map(bom.rows.map(row=>[row.id,original.filter(p=>p.id===row.id).reduce((n,p)=>Math.max(n,p.copy+1),0)]));
 for(let slot=0;slot<drawerHeight(config.h);slot++){
  if(existing.has(slot))continue;
  const owner=starts.findIndex((s,i)=>slot>=s&&slot<s+drawerHeight(drawers[i]));
  const sources=owner<0?host.parts:original.filter(p=>!config.drawers||p.drawerSlot===owner||(owner===0&&p.drawerSlot===undefined));
  const delta=datum.slotAxes[slot]-datum.slotAxes[owner<0?0:starts[owner]],offsets=new Map(copies);
  for(const source of sources){
   if(!runnerRoles.has(source.role))continue;
   const copy=offsets.get(source.id)+source.copy%2;
   const p={...source,copy,position:source.position.map((v,j)=>v+(j===2?delta:0)),move:source.move.slice()};
   p.key=`${config.id||'current'}:${p.id}:${copy}:${p.component}`;
   const saved=config.colors?.[p.key]||config.colors?.[`${p.id}:${copy}:${p.component}`];
   if(/^#[0-9a-f]{6}$/i.test(saved||''))p.color=[1,3,5].map(i=>parseInt(saved.slice(i,i+2),16)/255);
   if(owner<0){delete p.drawerSlot;p.operates=false;}
   scene.parts.push(p);
   copies.set(p.id,Math.max(copies.get(p.id),copy+1));
  }
 }
 for(const part of scene.parts)part.rowIndex=bom.rows.findIndex(row=>row.id===part.id);
 scene.bom=bom;scene.hardware=bom.hardware;
 scene.audit=bom.rows.map(row=>{
  const parts=scene.parts.filter(p=>p.id===row.id),expected=row.qty*framesForId(row.id).length;
  return {...scene.audit.find(a=>a.id===row.id),id:row.id,copies:row.qty,expected,represented:parts.length,inferred:parts.filter(p=>p.evidence==='inferred').length,unplaced:parts.filter(p=>p.evidence==='unplaced').length};
 });
 scene.quantityComplete=bom.complete&&scene.audit.every(a=>a.expected===a.represented);
 return scene;
}

// Only rigid translation of source-calibrated parts. Slot axes are measured
// source features, distinct from the outside stacking planes of a whole frame.
export function packedDrawerScene(config,bom,options,build,framesForId){
 const {origin=[0,0,0]}=options,base={...config};delete base.drawers;
 const localOptions={...options,origin:[0,0,0]},host=build(base,localOptions);
 if(config.drawers.length===1&&config.drawers[0]===config.h){
  const scene=build(base,options);scene.bom=bom;scene.hardware=bom.hardware;return scene;
 }
 const datum=datums[`${config.w}${config.d}-${config.h}`];
 if(!datum)throw Error('此外框尚无可靠的内部槽位基准');
 const parts=[],copies=new Map(),warnings=new Set(host.fitWarnings||[]);
 const append=(source,copy,delta,slot=null)=>{
  const p={...source,copy,position:source.position.map((v,j)=>v+delta[j]+origin[j]),move:source.move.slice()};
  p.key=`${config.id||'current'}:${p.id}:${p.copy}:${p.component}`;
  p.instance=config.id||'current';p.rowIndex=bom.rows.findIndex(r=>r.id===p.id);
  if(slot!==null)p.drawerSlot=slot;
  const saved=config.colors?.[p.key]||config.colors?.[`${p.id}:${p.copy}:${p.component}`];
  if(/^#[0-9a-f]{6}$/i.test(saved||''))p.color=[1,3,5].map(i=>parseInt(saved.slice(i,i+2),16)/255);
  parts.push(p);
 };
 for(const p of host.parts)if(frameRoles.has(p.role))append(p,p.copy,[0,0,0]);
 for(const p of parts)copies.set(p.id,Math.max(copies.get(p.id)||0,p.copy+1));
 let start=0;
 for(const [index,h]of config.drawers.entries()){
  const child=build({...base,h,roof:'none',handle:false},localOptions),donor=datums[`${config.w}${config.d}-${h}`];
  if(!donor||datum.slotAxes[start]===undefined)throw Error('此抽屉缺少匹配的内部安装槽位');
  const axis=datum.slotAxes[start],translation=[datum.midX-donor.midX,datum.frontContactY-donor.frontContactY,axis-donor.axisZ],offsets=new Map(copies);
  for(const p of child.parts){
   if(frameRoles.has(p.role))continue;
   const runner=['runner-guide','runner-slide','runner-stopper'].includes(p.role),reference=runner?host.parts.find(q=>q.id===p.id&&q.copy===p.copy&&q.component===p.component):p;
   if(!reference)throw Error('外框缺少配套导轨或止挡的源定位');
   const copy=(offsets.get(p.id)||0)+p.copy;
   append(reference,copy,runner?[0,0,axis-datum.axisZ]:translation,index);
  }
  for(const row of child.bom.rows)if(!frameRoles.has(row.role))copies.set(row.id,(offsets.get(row.id)||0)+row.qty);
  for(const warning of child.fitWarnings||[])warnings.add(warning);
  start+=drawerHeight(h);
 }
 const audit=bom.rows.map(row=>{
  const ps=parts.filter(p=>p.id===row.id),perFile=framesForId(row.id).length;
  return {id:row.id,copies:row.qty,componentsPerFile:perFile,expected:row.qty*perFile,represented:ps.length,inferred:ps.filter(p=>p.evidence==='inferred').length,unplaced:ps.filter(p=>p.evidence==='unplaced').length,verified:0};
 });
 if(!config.rails&&config.drawers.length>1)warnings.add('多盒共用一个 2F/4F 框时，原手册建议每个抽屉配齐齿条；当前已关闭，请核对。');
 warnings.add('框内抽屉按实测 48 mm 槽阵列定位，保持原尺寸；五金及实体配合请按原手册和源孔位核对。');
 return {...host,parts,bom,hardware:bom.hardware,audit,fitWarnings:[...warnings],warnings:[...new Set([...bom.warnings,...warnings])],unplaced:bom.rows.filter(r=>parts.some(p=>p.id===r.id&&p.evidence==='unplaced')),unknowns:[...warnings],quantityComplete:bom.complete&&audit.every(a=>a.expected===a.represented),physicalFitVerified:false,fitDrawer:{...host.fitDrawer,packed:true,drawerCount:config.drawers.length,slotPitch:48},errors:bom.errors,needsInput:bom.needsInput};
}
