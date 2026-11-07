import catalog from './catalog.json' with {type:'json'};
import frameData from './assembly-data.json' with {type:'json'};
import orientation from './orientation.json' with {type:'json'};
import {buildBOM,normalizeConfig} from './rules.js';
import {fitSustainer} from './sustainer-fit.js';
import {fitDrawer} from './drawer-fit.js';
import {packedDrawerScene,fullRunnerScene} from './packed-drawer.js';
const byId=Object.fromEntries(catalog.map(p=>[p.id,p]));
const MESH_META=byId,ORIENTATION=orientation,ASSEMBLY_V4_DATA=frameData;
// Frames define source coordinates; no triangle memberships or geometry are bundled.
export function componentFrames(id){
 if(frameData[id])return structuredClone(frameData[id]);
 const item=byId[id];if(!item)return [];
 if(orientation[id]){const {rotation,origin,min,max}=orientation[id];return structuredClone([{rotation,origin,min,max}]);}
 const [lo,hi]=item.bbox,origin=lo.map((v,j)=>(v+hi[j])/2);
 return [{rotation:[[1,0,0],[0,1,0],[0,0,1]],origin,min:lo.map((v,j)=>v-origin[j]),max:hi.map((v,j)=>v-origin[j])}];
}
const stepNames={drawer:['面板','钥匙','钥匙端帽','弹簧','抽屉盒','齿条','滑动件','前部组合','标签与端盖','导向件','外壳','止挡','锁扣','选配附件'],sustainer:['锁扣座','锁扣内件','锁扣外件','前部组合','固定件','上铰链','下铰链','顶盖','销轴','面板','标签','准备','内部分区'],mods:['底座','轴套','轮盘','轴承','轮胎','轮盖','支脚','宿主模块','连接位置','背板','层间连接','提手','旋钮','锁板','握把','其他附件']};
const ASSEMBLY_STEPS=Object.fromEntries(Object.entries(stepNames).map(([k,v])=>[k,v.map(label=>[label,null])]));
function createBuilders(config,bom){
 const asLegacy=b=>({...b,rows:b.rows.map(r=>({...r,item:byId[r.id],note:r.reason}))});
 const makeBOM=c=>asLegacy(c===config?bom:buildBOM(c));
 const EXTENSION_RULES={buildModification:c=>{const b=(config.kind==='mods'&&(c.family||c.optionId||c.type)===(config.family||config.optionId||config.type))?bom:buildBOM({...c,kind:'mods'});return {...b,bom:b.rows};}};
const V3COLORS={shell:[.72,.73,.73],box:[.24,.25,.25],facade:[.72,.73,.73],roof:[.72,.73,.73],hardware:[1,.39,.12],accessory:[.72,.73,.73]};
const I3=[[1,0,0],[0,1,0],[0,0,1]],RX=[[1,0,0],[0,0,1],[0,-1,0]],FX=[[1,0,0],[0,0,-1],[0,1,0]];
function mv(m,p){return m.map(r=>r[0]*p[0]+r[1]*p[1]+r[2]*p[2])}
function mm(a,b){return a.map(r=>[0,1,2].map(j=>r.reduce((s,v,k)=>s+v*b[k][j],0)))}
function calibration(id,kind){let a=ORIENTATION[id],raw=MESH_META[id].bbox,rot=a?a.rotation:I3,center=a?a.origin:raw[0].map((v,j)=>(v+raw[1][j])/2),axes=I3;
 if(kind==='shell'||kind==='facade'||kind==='roof')axes=RX;
 if(kind==='xlbox'||kind==='xlplate')axes=FX;

 if(kind==='box'||kind==='plate')rot=I3;
 const matrix=mm(axes,rot),corners=[];let lo=a?a.min:raw[0].map((v,j)=>v-center[j]),hi=a?a.max:raw[1].map((v,j)=>v-center[j]);
 if(kind==='box'||kind==='plate'){lo=raw[0].map((v,j)=>v-center[j]);hi=raw[1].map((v,j)=>v-center[j])}
 for(let i=0;i<8;i++)corners.push(mv(axes,[i&1?hi[0]:lo[0],i&2?hi[1]:lo[1],i&4?hi[2]:lo[2]]));
 let min=[0,1,2].map(j=>Math.min(...corners.map(p=>p[j]))),max=[0,1,2].map(j=>Math.max(...corners.map(p=>p[j])));return {matrix,center,min,max,size:max.map((v,j)=>v-min[j])}}
function partAt(id,kind,x,y,z,color,move=[0,0,0]){let cal=calibration(id,kind);return {id,kind,cal,position:[x,y,z],color:color||V3COLORS[kind]||V3COLORS.accessory,move}}
const V4_GRAY=[.72,.73,.73],V4_DARK=[.24,.25,.25],V4_ORANGE=[1,.39,.12];
const V4_TO_Y=[[0,0,1],[1,0,0],[0,1,0]],V4_FACE=[[1,0,0],[0,0,-1],[0,1,0]];
function v4Data(id){return typeof ASSEMBLY_V4_DATA==='undefined'?null:ASSEMBLY_V4_DATA[id]}
function v4Frame(id,component=0,axes=I3,frameName=''){
 let d=v4Data(id)?.[component];if(!d)return calibration(id,'raw');
 if(frameName==='hinge'&&d.hingeRotation)d={...d,rotation:d.hingeRotation,min:d.hingeMin,max:d.hingeMax};
 const corners=[];for(let i=0;i<8;i++)corners.push(mv(axes,[i&1?d.max[0]:d.min[0],i&2?d.max[1]:d.min[1],i&4?d.max[2]:d.min[2]]));
 const min=[0,1,2].map(j=>Math.min(...corners.map(p=>p[j]))),max=[0,1,2].map(j=>Math.max(...corners.map(p=>p[j])));
 return {matrix:mm(axes,d.rotation),center:d.origin,min,max,size:max.map((v,j)=>v-min[j])};
}
function v4Color(item){let n=item.name;return /Springs| Rails|Stopper|^Latch| Rods/.test(n)?V4_ORANGE: / Box |Key \(|Hidden Key|Runner Slide|LOCK (INNER|OUTER)|Hinge|Divider|Tyre|Backbone|Pull-out/.test(n)?V4_DARK:V4_GRAY}
function v4BodyFrame(id,kind){
 const old=calibration(id,kind),data=v4Data(id)?.[0];if(!data)return old;
 const used=new Set(),axes=old.matrix.map(row=>{let best=-1,score=0,sign=1;for(let k=0;k<3;k++){const dot=row.reduce((s,v,j)=>s+v*data.rotation[k][j],0);if(!used.has(k)&&Math.abs(dot)>score){best=k;score=Math.abs(dot);sign=Math.sign(dot)}}used.add(best);return [0,1,2].map(j=>j===best?sign:0)});
 return v4Frame(id,0,axes);
}
function v4Part(row,copy,component,kind,axes){
 const p=partAt(row.item.id,kind,0,0,0,v4Color(row.item));if(axes)p.cal=v4Frame(p.id,component,axes);else p.cal=v4BodyFrame(p.id,kind);
 Object.assign(p,{copy,component,step:0,evidence:'inferred',reason:"安装位置与接口配合尚待核对。",source:'',explodeVector:[0,0,80],operates:false});

 return p;
}
function v4At(p,x,y,z,step,vector=[0,0,80],operates=false){p.position=[x,y,z];p.step=step;p.explodeVector=vector;p.operates=operates;return p}
function v4Complete(scene,rows,c,origin,open,explode,progress){
 const family=c.kind==='sustainer'?'sustainer':c.kind==='mods'?'mods':'drawer',steps=ASSEMBLY_STEPS[family],limit=steps.length-1;
 progress=Number.isFinite(progress)?Math.max(0,Math.min(limit,progress)):limit;
 for(const p of scene.parts){
  p.instance=c.id||'current';p.key=p.instance+':'+p.id+':'+p.copy+':'+p.component;
  p.defaultColor=p.color.slice();const savedColor=c.colors?.[p.id+':'+p.copy+':'+p.component];if(/^#[0-9a-f]{6}$/i.test(savedColor||''))p.color=[1,3,5].map(i=>parseInt(savedColor.slice(i,i+2),16)/255);
  const enter=Math.max(0,Math.min(1,p.step-progress));const ease=enter*enter*(3-2*enter);
  p.move=p.explodeVector.map(v=>v*(explode+ease));
  if(p.evidence!=='unplaced'&&family==='drawer'){
   if(p.operates)p.move[1]+=open*scene.size[1]*.72;

   if(p.frontGroup)p.move[1]+=Math.max(0,Math.min(1,7-progress))*70;
   if(p.operates&&p.step<10)p.move[1]+=Math.max(0,Math.min(1,10-progress))*scene.size[1]*.85;
  }
  if(p.lidGroup){p.hinge={pivot:[scene.size[0]/2,10,scene.size[2]-5],angle:open*Math.PI*.55};p.move[2]+=Math.max(0,Math.min(1,7-progress))*70}
  p.position=p.position.map((v,j)=>v+origin[j]);if(p.hinge)p.hinge.pivot=p.hinge.pivot.map((v,j)=>v+origin[j]);
 }
 scene.steps=steps;scene.progress=progress;
 scene.audit=rows.map((r,rowIndex)=>{const ps=scene.parts.filter(p=>p.rowIndex===rowIndex),perFile=v4Data(r.item.id)?.length||1;return {id:r.item.id,name:r.item.name,copies:r.qty,componentsPerFile:perFile,expected:Number.isInteger(r.qty)&&r.qty>0?r.qty*perFile:null,represented:ps.length,inferred:ps.filter(p=>p.evidence==='inferred').length,unplaced:ps.filter(p=>p.evidence==='unplaced').length,verified:0}});
 scene.unplaced=rows.filter((r,i)=>scene.parts.some(p=>p.rowIndex===i&&p.evidence==='unplaced')||!Number.isInteger(r.qty)||r.qty<=0);
 scene.unknowns=[...scene.audit.filter(a=>a.unplaced||a.expected===null).map(a=>a.name+'：'+(a.expected===null?"数量需按当前安装布局确认。":"目录中没有匹配零件。")), ...(scene.missing||[])];
 scene.quantityComplete=rows.length>0&&!(scene.missing||[]).length&&scene.audit.every(a=>a.expected!==null&&a.expected===a.represented);

 scene.precision="安装位置与接口配合尚待核对。";return scene;
}
function baseSceneForModule(c,origin=[0,0,0],open=0,explode=0,progress=Infinity){
 const b=makeBOM(c),rows=b.rows,isS=c.kind==='sustainer',main=rows.find(r=>/\/Modules\//.test(r.item.old));
 const shell=main?v4BodyFrame(main.item.id,'shell'):null,[W,D,H]=shell?shell.size:[0,0,0];
 const scene={parts:[],unplaced:[],size:[W,D,H],pitch:isS?H:48*Number(c.h?.[0]||1),missing:b.missing||[]};
 let trayX=W+65,trayY=0,trayDepth=0;
 const boxRows=rows.filter(r=>/\/Boxes\//.test(r.item.old)&&/ Box /.test(r.item.name)),plateRows=rows.filter(r=>/Baseplate/.test(r.item.name));
 for(let rowIndex=0;rowIndex<rows.length;rowIndex++){
  const row=rows[rowIndex],item=row.item,n=item.name,path=item.old,count=v4Data(item.id)?.length||1;
  if(!Number.isInteger(row.qty)||row.qty<=0)continue;
  for(let copy=0;copy<row.qty;copy++)for(let comp=0;comp<count;comp++){
   let kind='raw',axes=I3;if(/\/Modules\//.test(path))kind='shell';else if(/\/Boxes\//.test(path)&&/ Box /.test(n))kind=c.w==='XL'?'xlbox':'box';else if(/\/Facades\//.test(path)||(/Facade/.test(n)&&!/Cap/.test(n)))kind='facade';else if(isS?row.role==='roof':/\/Roofs\//.test(path))kind='roof';else if(/Baseplate/.test(n))kind=c.w==='XL'?'xlplate':'plate';
   let p=v4Part(row,copy,comp,kind,kind==='raw'?axes:null),s=p.cal.size;
   const frame=a=>{p.cal=v4Frame(item.id,comp,a);s=p.cal.size;return p};
   if(!main){p.evidence='unplaced';p.reason='缺少外壳定位基准，零件暂放待装区。'}
   else if(kind==='shell')v4At(p,0,0,0,isS?6:10,[-100,0,30]);
   else if(kind==='box'||kind==='xlbox'){
    let idx=boxRows.indexOf(row),rear=boxRows.slice(0,idx).reduce((a,r)=>a+calibration(r.item.id,kind).size[1],0);
    v4At(p,(W-s[0])/2,Math.max(0,D-boxRows.reduce((a,r)=>a+calibration(r.item.id,kind).size[1],0))+rear,5,4,[0,70,15],true);
   }else if(kind==='facade'){v4At(p,(W-s[0])/2,D-2,4,isS?3:0,[0,120,0],!isS);p.frontGroup=!isS}
   else if(kind==='roof'){v4At(p,(W-s[0])/2,0,H-8,isS?5:13,[0,0,120]);p.lidGroup=isS}
   else if(/Baseplate/.test(n)){
    const idx=plateRows.indexOf(row);v4At(p,(W-s[0])/2,5+idx*s[1],isS?5:8,isS?12:13,[0,0,80],!isS);
   }else if(!isS&&/Runner (Guide|Slide)/.test(n)){
    frame(V4_TO_Y);const guide=/Guide/.test(n),side=copy%2,half=guide?0:1;
    v4At(p,side?W-s[0]-7+half:7-half,D-s[1],7,guide?9:6,[side?85:-85,0,0],true);
    if(side){p.cal=v4Frame(item.id,comp,mm([[ -1,0,0],[0,1,0],[0,0,-1]],V4_TO_Y));s=p.cal.size}
   }else if(!isS&&/Runner Stopper/.test(n)){
    frame(V4_TO_Y);v4At(p,copy%2?W-s[0]-4:4,D-s[1],12,11,[copy%2?75:-75,45,0]);
   }else if(!isS&&/ Rails/.test(n)&&count===2){
    frame(V4_FACE);v4At(p,(W-s[0])/2,D-8,comp?5:35-s[2],5,[comp?-90:90,25,0],true);
   }else if(!isS&&/Springs/.test(n)&&count===2){
    frame(V4_FACE);v4At(p,W/2+(comp?24:-24-s[0]),D-4-s[1],8,3,[comp?40:-40,95,20],true);p.frontGroup=true;
   }else if(!isS&&/^Key \(|^Hidden Key/.test(n)){
    frame(V4_FACE);v4At(p,(W-s[0])/2,D-s[1]+13,9,1,[0,150,0],true);p.frontGroup=true;
   }else if(!isS&&/Key Cap/.test(n)){
    frame(V4_FACE);v4At(p,(W-s[0])/2,D+10,16,2,[0,170,0],true);p.frontGroup=true;
   }else if(!isS&&/Facade Cap/.test(n)){
    frame(V4_FACE);v4At(p,W-28,D+4,18,8,[75,70,0],true);p.frontGroup=true;
   }else if(/Label/.test(n)){
    frame(V4_FACE);v4At(p,W*.23-s[0]/2,D+7,14,isS?10:8,[-70,90,0],!isS);p.frontGroup=!isS;
   }else if(!isS&&/^Latch/.test(n)){
    frame(I3);v4At(p,(W-s[0])/2,(D-s[1])/2,0,12,[0,-50,-85]);
   }else if(!isS&&/Back Panel/.test(n)){
    p.cal=calibration(item.id,'facade');s=p.cal.size;v4At(p,(W-s[0])/2,2,5,4,[0,-100,0],true);
   }else if(!isS&&/Handle|Roof Insert/.test(n)){
    frame(V4_FACE);v4At(p,(W-s[0])/2+(copy?60:-0),(D-s[1])/2,H,13,[copy?70:0,0,150]);
   }else if(isS&&/LOCK HOLDER|LOCK INNER|LOCK OUTER|SET OF PINS/.test(n)){
    frame(V4_FACE);const x=W*(copy+1)/(row.qty+1)-s[0]/2,inner=/INNER/.test(n),outer=/OUTER/.test(n),pins=/PINS/.test(n);
    v4At(p,x+(pins?(comp%2?24:-24):0),D+3+(outer?12:inner?6:0),H*.45-s[2]/2+(pins&&comp>1?12:0),outer?2:inner?1:pins?(comp<2?2:1):0,[pins?(comp%2?65:-65):0,outer?210:inner?160:pins?180+comp*12:110,pins?40+comp*10:20]);
   }else if(isS&&/Hinge/.test(n)){
    const top=/Top/.test(n),hingeAxes=top?RX:[[-1,0,0],[0,-1,0],[0,0,1]];p.cal=v4Frame(item.id,comp,hingeAxes,'hinge');s=p.cal.size;
    const total=row.qty*count,index=copy*count+comp;
    const center=total===1?W/2:W*(index+.5)/total,offset=total===1?0:(index%2?-1:1)*(top?25:-20);
    const hd=v4Data(item.id)?.[comp],localBarrel=hd?.hingeBarrel?mv(hingeAxes,hd.hingeMin.map((v,j)=>v+hd.hingeBarrel[j])).map((v,j)=>v-p.cal.min[j]):[s[0]/2,7,top?7:s[2]-7];
    v4At(p,center+offset-localBarrel[0],10-localBarrel[1],H-5-localBarrel[2],top?5:6,[index%2?30:-30,-85,top?100:0]);p.lidGroup=top;p.barrelCenter=[center+offset,10,H-5];
   }else if(isS&&/ Rods/.test(n)&&count===2){
    frame(I3);v4At(p,W*(comp+.5)/count-s[0]/2,10-s[1]/2,H-5-s[2]/2,8,[comp?110:-110,-35,0]);
   }else if(isS&&/Divider/.test(n)&&!(/Seal/.test(n))){
    frame(/Depth/.test(n)?V4_TO_Y:V4_FACE);v4At(p,(W-s[0])/2,(D-s[1])/2,6,12,[0,0,110+copy*25]);
   }else {p.evidence='unplaced';p.reason=/Manual Supports|Jig/.test(path)?"打印支撑或装配工具，不作为成品结构件。":"安装位置与接口配合尚待核对。"}
   if(p.evidence==='unplaced'){
    if(trayY>500){trayX+=trayDepth+35;trayY=0;trayDepth=0}
    p.position=[trayX,trayY,0];trayY+=s[1]+25;trayDepth=Math.max(trayDepth,s[0]);p.step=ASSEMBLY_STEPS[isS?'sustainer':'drawer'].length-1;p.explodeVector=[0,0,0];
   }
   p.rowIndex=rowIndex;scene.parts.push(p);
  }
 }
 return v4Complete(scene,rows,c,origin,open,explode,progress);
}
const MOD_ASSEMBLY_V4_I=[[1,0,0],[0,1,0],[0,0,1]];
const MOD_ASSEMBLY_V4_BASE=[[1,0,0],[0,0,-1],[0,1,0]];
const MOD_ASSEMBLY_V4_WHEEL=[[0,0,1],[1,0,0],[0,1,0]];
const MOD_ASSEMBLY_V4_WHEEL_REVERSE=[[0,0,-1],[-1,0,0],[0,1,0]];
const MOD_ASSEMBLY_V4_KNOB=[[1,0,0],[0,0,-1],[0,1,0]];
const MOD_ASSEMBLY_V4_EVIDENCE={
 wheel:"当前方案所需外购五金。",
 base:"安装位置与接口配合尚待核对。",
 knob:"旋钮按锁座位置推定，螺纹配合待核对。",
 handle:"提手依赖背板或立杆，接口与高度待核对。",
 unsupported:"缺少宿主安装基准，零件暂放待装区。"
};


const MOD_ASSEMBLY_V4_TROLLEY_CAL={
m0637:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[-6651.072509765625,-506.9044189453125,75.54243755340576],min:[-17.023193359375,-10.971980094909668,-17.023193359375],max:[17.023193359375,10.971980094909668,17.023193359375]},
m0638:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[-6651.187255859375,-514.0691251754761,75.62196636199951],min:[-18.899658203125,-5.8323163986206055,-6.570584297180176],max:[18.899658203125,5.8323163986206055,6.570584297180176]},
m0639:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[-3015.181640625,-514.0644454956055,92.58216094970703],min:[-164.802734375,-17.38153839111328,-23.81914520263672],max:[164.802734375,17.38153839111328,23.81914520263672]},
m0640:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[-3015.181640625,-557.8738479614258,105.6709976196289],min:[-164.802734375,-16.737777709960938,-23.81914520263672],max:[164.802734375,16.737777709960938,23.81914520263672]},
m0641:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[-3515.181396484375,-532.1951370239258,105.67100524902344],min:[-164.802734375,-16.737777709960938,-49.56957244873047],max:[164.802734375,16.737777709960938,49.56957244873047]},
m0642:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[6001.464599609375,-480.71775913238525,-24.86449146270752],min:[-127.001220703125,-17.36344814300537,-23.316630363464355],max:[127.001220703125,17.36344814300537,23.316630363464355]},
m0643:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[6001.558837890625,-558.3775224685669,68.61665439605713],min:[-127.001220703125,-16.371251106262207,-23.316630363464355],max:[127.001220703125,16.371251106262207,23.316630363464355]},
m0644:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[5501.558837890625,-476.1478385925293,49.36802387237549],min:[-127.001220703125,-16.371251106262207,-49.6098518371582],max:[127.001220703125,16.371251106262207,49.6098518371582]},
m0645:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[9001.3720703125,-490.56507110595703,-24.64385986328125],min:[-40.2001953125,-23.55480194091797,-7.53753662109375],max:[40.2001953125,23.55480194091797,7.53753662109375]},
m0646:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[9001.37255859375,-480.7389259338379,-24.683774948120117],min:[-82.40087890625,-17.38143539428711,-23.49712562561035],max:[82.40087890625,17.38143539428711,23.49712562561035]},
m0647:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[9001.55859375,-558.1968879699707,68.66131591796875],min:[-82.4013671875,-16.415897369384766,-23.497264862060547],max:[82.4013671875,16.415897369384766,23.497264862060547]},
m0648:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[8501.55859375,-532.1245803833008,68.66131591796875],min:[-82.4013671875,-16.415897369384766,-49.56957244873047],max:[82.4013671875,16.415897369384766,49.56957244873047]},
m0652:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[-6501.288330078125,-484.749228477478,75.77050876617432],min:[-209.399658203125,-17.177315711975098,-23.721055030822754],max:[209.399658203125,17.177315711975098,23.721055030822754]},
m0653:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[-6501.290771484375,-557.9208517074585,75.77313613891602],min:[-209.399658203125,-16.35934829711914,-23.721055030822754],max:[209.399658203125,16.35934829711914,23.721055030822754]},
m0655:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[3001.554443359375,1799.5436735153198,-81.90407085418701],min:[-134.802001953125,-45.811617851257324,-30.01450824737549],max:[134.802001953125,45.811617851257324,30.01450824737549]},
m0656:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[6001.55419921875,1799.579942703247,-81.60698699951172],min:[-97.00048828125,-45.84788703918457,-30.312652587890625],max:[97.00048828125,45.84788703918457,30.312652587890625]},
m0657:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[9001.5546875,1799.786964416504,-81.62610626220703],min:[-52.400390625,-46.055030822753906,-30.293975830078125],max:[52.400390625,46.055030822753906,30.293975830078125]},
m0658:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[-6499.870849609375,1806.5928974151611,-81.8364610671997],min:[-179.398681640625,-46.25122261047363,-30.13337230682373],max:[179.398681640625,46.25122261047363,30.13337230682373]},
m0659:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[2288.6400146484375,-1680.369369506836,479.29109621047974],min:[-138.8028564453125,-17.350357055664062,-30.90532350540161],max:[138.8028564453125,17.350357055664062,30.90532350540161]},
m0660:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[5658.850341796875,-1680.3601417541504,447.1088619232178],min:[-101.001220703125,-17.35958480834961,-30.7738094329834],max:[101.001220703125,17.35958480834961,30.7738094329834]},
m0661:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[8029.1748046875,-1680.3147678375244,307.9757308959961],min:[-56.40087890625,-17.404958724975586,-30.84423065185547],max:[56.40087890625,17.404958724975586,30.84423065185547]},
m0662:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[-5868.088134765625,-814.0076370239258,614.8216466903687],min:[-183.399658203125,-17.19371795654297,-30.805411338806152],max:[183.399658203125,17.19371795654297,30.805411338806152]},
m0678:{matrix:[[0,0,1],[1,0,0],[0,1,0]],center:[7239.53955078125,3974.122314453125,27.000370025634766],min:[-16.5,-15.59765625,-15.59765625],max:[16.5,15.59765625,15.59765625]},
m0679:{matrix:[[0,0,1],[1,0,0],[0,1,0]],center:[7130.10205078125,3974.124755859375,8.531522274017334],min:[-12.03125,-70,-70],max:[12.03125,70,70]},
m0680:{matrix:[[0,0,1],[1,0,0],[0,1,0]],center:[6773.9892578125,3974.124755859375,30.384239196777344],min:[-9.984375,-71,-71],max:[9.984375,71,71]},
m0682:{matrix:[[0,0,1],[1,0,0],[0,1,0]],center:[6945.6783447265625,3974.1248779296875,20.21239433437586],min:[-20.312530994415283,-80.0001220703125,-80.0001220703125],max:[20.312530994415283,80.0001220703125,80.0001220703125]},
m0683:{matrix:[[0.7071067811865476,0.7071067811865476,0],[0,0,-1],[-0.7071067811865476,0.7071067811865476,0]],center:[3019.7540893554688,677.3816528320312,1032.3078649044037],min:[-164.81990411392673,-78.20801138877869,-26.74708970269864],max:[164.81990411392673,78.20801138877869,26.024195386409488]},
m0684:{matrix:[[0.7071067811865476,0.7071067811865476,0],[0,0,-1],[-0.7071067811865476,0.7071067811865476,0]],center:[3019.7540893554688,677.3816528320312,511.265597820282],min:[-164.81990411392673,-99.16571378707886,-26.74708970269864],max:[164.81990411392673,99.16571378707886,26.024195386409488]},
m0685:{matrix:[[0.7071067811865476,0.7071067811865476,0],[0,0,-1],[-0.7071067811865476,0.7071067811865476,0]],center:[3019.7540893554688,677.3816528320312,-9.776699781417847],min:[-164.81990411392673,-120.12341618537903,-26.74708970269864],max:[164.81990411392673,120.12341618537903,26.024195386409488]},
m0688:{matrix:[[0.7071067811865476,0.7071067811865476,0],[0,0,-1],[-0.7071067811865476,0.7071067811865476,0]],center:[2983.25901722908,714.4258873462677,-530.8502502441406],min:[-165.19025218071462,-141.05014038085938,-26.49277629313348],max:[165.19025218071462,141.05014038085938,26.492776293133485]},
m0691:{matrix:[[0.7071067811865476,0.7071067811865476,0],[0,0,-1],[-0.7071067811865476,0.7071067811865476,0]],center:[2983.1591955423355,714.326065659523,-1051.8502502441406],min:[-165.61366667011302,-162.05014038085938,-26.856270270829143],max:[164.71845766108538,162.05014038085938,26.856270270829143]},
m0692:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[6001.461181640625,-2164.324698448181,1032.0065469741821],min:[-127.001220703125,-77.88746738433838,-26.293221473693848],max:[127.001220703125,77.88746738433838,26.293221473693848]},
m0693:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[6001.461181640625,-2164.324698448181,511.33875274658203],min:[-127.001220703125,-99.2197036743164,-26.293221473693848],max:[127.001220703125,99.2197036743164,26.293221473693848]},
m0694:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[6001.461181640625,-2164.324698448181,-9.825109481811523],min:[-127.001220703125,-120.05584144592285,-26.293221473693848],max:[127.001220703125,120.05584144592285,26.293221473693848]},
m0697:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[6001.733720421791,-2112.7219957113266,-530.8310852050781],min:[-127.27571260929108,-141.05014038085938,-25.8959242105484],max:[127.27571260929108,141.05014038085938,25.8959242105484]},
m0700:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[6001.692712306976,-2112.664572238922,-1051.8310546875],min:[-127.23470449447632,-162.0501708984375,-25.95334768295288],max:[127.23470449447632,162.0501708984375,25.95334768295288]},
m0701:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[9001.46142578125,-2164.5460109710693,1032.013111114502],min:[-82.40087890625,-77.89458084106445,-26.072153091430664],max:[82.40087890625,77.89458084106445,26.072153091430664]},
m0702:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[9001.473244726658,-2164.6949210762978,511.16929626464844],min:[-82.41269785165787,-99.05000305175781,-25.92324298620224],max:[82.41269785165787,99.05000305175781,25.92324298620224]},
m0703:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[9001.594923973083,-2164.357225894928,-9.831451416015625],min:[-82.5343770980835,-120.05000305175781,-26.26093816757202],max:[82.5343770980835,120.05000305175781,26.26093816757202]},
m0706:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[9001.61230647564,-2112.7222650647163,-530.8698577880859],min:[-82.64648616313934,-141.0500030517578,-25.89589899778366],max:[82.64648616313934,141.0500030517578,25.89589899778366]},
m0709:{matrix:[[1,0,0],[0,0,-1],[0,1,0]],center:[9001.257806301117,-2112.6648457050323,-1051.8700561523438],min:[-82.29100942611694,-162.04998779296875,-25.95331835746765],max:[82.29100942611694,162.04998779296875,25.95331835746765]},
m0710:{matrix:[[0.7071067811865476,0.7071067811865476,0],[0,0,-1],[-0.7071067811865476,0.7071067811865476,0]],center:[-6482.328369140625,683.6541147232056,1031.9066534042358],min:[-210.29848797359,-77.78336238861084,-33.74019697158697],max:[210.29848797358997,77.78336238861084,33.74019697158697]},
m0711:{matrix:[[0.7071067811865476,0.7071067811865476,0],[0,0,-1],[-0.7071067811865476,0.7071067811865476,0]],center:[-6482.32861328125,683.6543445587158,511.45057678222656],min:[-210.29879480264714,-99.35368347167969,-33.74024619910603],max:[210.29879480264714,99.35368347167969,33.74024619910603]},
m0712:{matrix:[[0.7071067811865476,0.7071067811865476,0],[0,0,-1],[-0.7071067811865476,0.7071067811865476,0]],center:[-6482.3271484375,683.6529655456543,-9.659194946289062],min:[-210.2969538283042,-120.26919555664062,-33.73995083399167],max:[210.2969538283042,120.26919555664062,33.73995083399167]},
m0715:{matrix:[[0.7071067811865476,0.7071067811865476,0],[0,0,-1],[-0.7071067811865476,0.7071067811865476,0]],center:[-6517.659423828125,721.8080453872681,-530.7154312133789],min:[-210.29848797359,-141.18660736083984,-33.74019697158697],max:[210.29848797358997,141.18660736083984,33.74019697158697]},
m0718:{matrix:[[0.7071067811865476,0.7071067811865476,0],[0,0,-1],[-0.7071067811865476,0.7071067811865476,0]],center:[-6517.65966796875,721.8082752227783,-1051.782485961914],min:[-210.29879480264714,-162.10337829589844,-33.74024619910603],max:[210.29879480264714,162.10337829589844,33.74024619910603]}
};
const MOD_ASSEMBLY_V4_GRIP_FLIP=[[1,0,0],[0,-1,0],[0,0,-1]];
const MOD_ASSEMBLY_V4_ROD_FEATURES={
 m0639:{rodX:122.802,knobX:105.18,lockRodY:1.5,gripRodY:-3,lockRadius:8.499,gripRadius:7.998,lockOuterY:-17.38153839111328,evidence:'astra-rawBBox-center'},
 m0642:{rodX:85,knobX:67.386,lockRodY:1.5,gripRodY:-3,lockRadius:8.2,gripRadius:8,lockOuterY:-17.36344814300537,evidence:'astra-rawBBox-center'},
 m0646:{rodX:40.4,knobX:null,lockRodY:1.5,gripRodY:-3,lockRadius:8.2,gripRadius:8,lockOuterY:-17.38143539428711,evidence:'astra-rawBBox-center'},
 m0652:{rodX:167.399,knobX:149.784,lockRodY:1.5,gripRodY:-3,lockRadius:8.2,gripRadius:8,lockOuterY:-17.177315711975098,evidence:'astra-rawBBox-center'},
 m0659:{rodX:122.802,lockRodY:1.5,gripRodY:-3,lockRadius:8.499,gripRadius:7.998,socketPlaneLocalZ:30.90532350540161,evidence:'astra-rawBBox-center'},
 m0660:{rodX:85,lockRodY:1.5,gripRodY:-3,lockRadius:8.2,gripRadius:8,socketPlaneLocalZ:30.7738094329834,evidence:'astra-rawBBox-center'},
 m0661:{rodX:40.4,lockRodY:1.5,gripRodY:-3,lockRadius:8.2,gripRadius:8,socketPlaneLocalZ:30.84423065185547,evidence:'astra-rawBBox-center'},
 m0662:{rodX:167.399,lockRodY:1.5,gripRodY:-3,lockRadius:8.2,gripRadius:8,socketPlaneLocalZ:30.805411338806152,evidence:'astra-rawBBox-center'},
 m0645:{seatRawLocal:[-.115,0,0],seatAxis:'raw-Z',installedPlacementKnown:false,evidence:'astra-rawBBox-center'}
};
function modAssemblyV4Frame(id,rotation=MOD_ASSEMBLY_V4_I){
 const bbox=MESH_META[id].bbox,center=bbox[0].map((v,j)=>(v+bbox[1][j])/2),half=bbox[0].map((v,j)=>(bbox[1][j]-v)/2);
 const corners=[];for(let i=0;i<8;i++)corners.push(mv(rotation,half.map((v,j)=>i&(1<<j)?v:-v)));
 const min=[0,1,2].map(j=>Math.min(...corners.map(p=>p[j]))),max=[0,1,2].map(j=>Math.max(...corners.map(p=>p[j])));
 return {matrix:rotation,center,min,max,size:max.map((v,j)=>v-min[j])};
}
function modAssemblyV4Center(p,x,y,z){return [x-p.cal.size[0]/2,y-p.cal.size[1]/2,z-p.cal.size[2]/2]}
function modAssemblyV4Place(p,x,y,z,step,vector,evidence,reason){
 v4At(p,...modAssemblyV4Center(p,x,y,z),step,vector);
 p.evidence=evidence;p.reason=reason;return p;
}
function modAssemblyV4TrolleyFrame(id){
 const d=MOD_ASSEMBLY_V4_TROLLEY_CAL[id];
 if(!d)return modAssemblyV4Frame(id,MOD_ASSEMBLY_V4_I);
 return {
  matrix:d.matrix.map(row=>row.slice()),center:d.center.slice(),
  min:d.min.slice(),max:d.max.slice(),size:d.max.map((v,i)=>v-d.min[i])
 };
}
function modAssemblyV4LocalToWorld(part,local,includeMove=false){
 const rotated=part.cal.matrix.map(row=>row.reduce((sum,value,index)=>sum+value*local[index],0));
 return rotated.map((value,axis)=>value-part.cal.min[axis]+part.position[axis]+(includeMove?part.move[axis]:0));
}
function modAssemblyV4TrolleyScene(c,origin=[0,0,0],explode=0,progress=Infinity){
 const built=EXTENSION_RULES.buildModification({...c,family:'trolley'});
 const rows=(built.bom||[]).filter(row=>byId[row.id]).map(row=>({...row,item:byId[row.id]}));
 const scene={
  parts:[],size:[0,0,0],pitch:0,
  missing:[...(built.errors||[]),...(built.needsInput||[]).map(row=>row.reason),...(built.missing||[])],
  hardware:built.hardware||[],hostModules:built.hostModules||[],hostBOMs:built.hostBOMs||[],
  connections:built.connections||[],constraints:built.constraints||{},
  referenceRods:[],
  controls:['assembled','exploded','flat','paint','picking','steps']
 };
 if(!rows.length)return scene;
 const nextCopy={},globalCopies=new Map(),groups={};
 function copyIndex(id,token){
  const mapKey=id+':'+token;
  if(!globalCopies.has(mapKey))globalCopies.set(mapKey,nextCopy[id]||0);
  const copy=globalCopies.get(mapKey);nextCopy[id]=Math.max(nextCopy[id]||0,copy+1);return copy;
 }
 function addRow(row,rowIndex,token){
  const count=v4Data(row.item.id)?.length||1,copy=copyIndex(row.item.id,token);
  const added=[];
  for(let component=0;component<count;component++){
   const p=v4Part(row,copy,component,'raw',MOD_ASSEMBLY_V4_I);
   p.copy=copy;
   p.cal=v4Data(row.item.id)?.[component]?v4Frame(row.item.id,component,MOD_ASSEMBLY_V4_I):modAssemblyV4TrolleyFrame(row.item.id);
   p.rowIndex=rowIndex;p.role=row.role;p.evidence='inferred';
   p.reason="安装位置与接口配合尚待核对。";
   scene.parts.push(p);(groups[row.role]||=([])).push(p);added.push(p);
  }
  return added[0];
 }
 rows.forEach((row,rowIndex)=>{
  if(row.role==='host-drawer')return;
  if(!Number.isInteger(row.qty)||row.qty<=0)return;
  for(let copy=0;copy<row.qty;copy++)addRow(row,rowIndex,'attachment:'+rowIndex+':'+copy);
 });
 const group=role=>groups[role]||[];
 const base=group('base')[0];
 if(!base)return scene;
 base.cal=modAssemblyV4TrolleyFrame(base.id);
 const [baseW,baseD,baseH]=base.cal.size;
 const tires=group('tpu-tire'),disks=group('wheel-disk'),covers=group('wheel-cover'),bushings=group('bushing');
 if(tires.length)tires[0].cal=modAssemblyV4TrolleyFrame(tires[0].id);
 const tireSize=tires.length?tires[0].cal.size:[40,160,160];
 const wheelRadius=Math.max(tireSize[1],tireSize[2])/2;
 const baseZ=Math.max(0,wheelRadius-baseH/2);
 base.position=[0,0,baseZ];base.step=0;base.explodeVector=[0,0,-80];
 base.reason="安装位置与接口配合尚待核对。";

 const wheelY=baseD*.18,wheelZ=wheelRadius;
 const wheelRoles=[
  [bushings,'bushing',1,MOD_ASSEMBLY_V4_I],
  [disks,'wheel-disk',2,MOD_ASSEMBLY_V4_WHEEL],
  [tires,'tpu-tire',4,MOD_ASSEMBLY_V4_WHEEL],
  [covers,'wheel-cover',5,MOD_ASSEMBLY_V4_WHEEL]
 ];
 for(let wheel=0;wheel<Math.max(tires.length,disks.length,covers.length,bushings.length);wheel++){
  const side=wheel%2?-1:1,axisX=side<0?-2:baseW+2;
  for(const [parts,role,step,rotation] of wheelRoles){
   const p=parts[wheel];if(!p)continue;
   p.cal=modAssemblyV4TrolleyFrame(p.id);
   const cover=role==='wheel-cover';
   const axisOffset=cover?side*(tireSize[0]/2+p.cal.size[0]/2-8):0;
   p.position=modAssemblyV4Center(p,axisX+axisOffset,wheelY,wheelZ);
   p.step=step;p.explodeVector=[side*(95+(cover?80:role==='wheel-disk'?45:0)),0,0];
   p.reason="当前方案所需外购五金。";
  }
 }
 const foot=group('foot')[0];
 if(foot){
  foot.cal=modAssemblyV4TrolleyFrame(foot.id);
  const sz=foot.cal.size;
  foot.position=modAssemblyV4Center(foot,baseW/2,baseD-sz[1]/2,Math.max(0,baseZ-sz[2])+sz[2]/2);
  foot.step=6;foot.explodeVector=[0,-130,-80];
  foot.reason="底座";
 }

 const hostScenes=[];
 for(let layer=0;layer<scene.hostModules.length;layer++){
  hostScenes.push(sceneForModule({...scene.hostModules[layer]},[0,0,0],0,0,Infinity));
 }
 const hostSize=hostScenes.find(s=>s?.size?.[0]>0)?.size||[baseW,baseD,96];
 const hostPitch=hostScenes.find(s=>s?.pitch>0)?.pitch||96;
 const hostX=(baseW-hostSize[0])/2,hostY=(baseD-hostSize[1])/2,towerBottom=baseZ+baseH;
 scene.pitch=hostPitch;scene.towerBottom=towerBottom;

 const hostRowIndexById=new Map(rows.map((row,rowIndex)=>row.role==='host-drawer'?[row.id,rowIndex]:null).filter(Boolean));
 for(let layer=0;layer<hostScenes.length;layer++){
  const hostScene=hostScenes[layer];
  const sourceRows=scene.hostBOMs[layer]||hostScene.audit.map(a=>({id:a.id,qty:a.copies}));
  const localToGlobal=sourceRows.map(source=>hostRowIndexById.get(source.id)??null);
  const layerZ=towerBottom+layer*hostPitch,localCopies=new Map();
  for(const original of hostScene.parts){
   const p={...original,cal:{...original.cal,matrix:original.cal.matrix.map(row=>row.slice()),min:original.cal.min.slice(),max:original.cal.max.slice(),size:original.cal.size.slice(),center:original.cal.center.slice()},position:original.position.slice(),explodeVector:(original.explodeVector||[0,0,80]).slice()};
   const localCopyKey=p.id+':'+p.copy;
   if(!localCopies.has(localCopyKey))localCopies.set(localCopyKey,copyIndex(p.id,'host:'+layer+':'+p.copy));
   p.copy=localCopies.get(localCopyKey);
   p.rowIndex=localToGlobal[p.rowIndex]??localToGlobal[0]??null;
   p.role=rows[p.rowIndex]?.role||'host-drawer';
   p.position=[p.position[0]+hostX,p.position[1]+hostY,p.position[2]+layerZ];
   if(p.hinge&&p.hinge.pivot)p.hinge.pivot=[p.hinge.pivot[0]+hostX,p.hinge.pivot[1]+hostY,p.hinge.pivot[2]+layerZ];
   p.explodeVector[2]+=layer*150;
   p.step=p.step===13?14:Math.min(14,7+layer);
   p.reason="安装位置与接口配合尚待核对。";
   scene.parts.push(p);(groups[p.role]||=([])).push(p);
  }
 }
 const hostTop=Math.max(towerBottom,...hostScenes.map((s,i)=>towerBottom+i*hostPitch+(s.size?.[2]||0)));

 for(const p of group('backbone')){
  p.cal=modAssemblyV4TrolleyFrame(p.id);
  const sz=p.cal.size,layer=p.copy;
  p.position=modAssemblyV4Center(p,baseW/2,hostY-sz[1]/2,towerBottom-sz[2]*.42+layer*hostPitch);
  p.step=8+Math.min(layer,3);p.explodeVector=[0,-90-layer*8,10];
  p.reason="按底座与宿主关系推定位置，固定孔位待核对。";
 }
 const locks=group('handle-lock');
 const mainLocks=locks.filter(p=>!/Part 2/i.test(byId[p.id].name));
 const secondLocks=[...locks.filter(p=>/Part 2/i.test(byId[p.id].name)),...group('handle-lock-second')];
 const lockTop=hostTop;
 for(const lock of mainLocks){
  lock.cal=modAssemblyV4TrolleyFrame(lock.id);
  const sz=lock.cal.size;
  lock.position=modAssemblyV4Center(lock,baseW/2,hostY-sz[1]/2,lockTop-sz[2]/2);
  const features=MOD_ASSEMBLY_V4_ROD_FEATURES[lock.id];
  if(features)lock.localFeatures={
   rodAnchorsLocal:[
    {x:-features.rodX,y:features.lockRodY,z:0,r:features.lockRadius},
    {x:features.rodX,y:features.lockRodY,z:0,r:features.lockRadius}
   ],
   rodCentersLocalX:[-features.rodX,features.rodX],
   knobRecessCentersLocalX:features.knobX==null?null:[-features.knobX,features.knobX],
   lockOuterLocalY:features.lockOuterY,mountFace:'host-rear',anchorEvidence:features.evidence
  };
  lock.step=13;lock.explodeVector=[0,-165,35];
  lock.reason="数量需按当前安装布局确认。";
 }
 const mainLock=mainLocks[0]||null;
 const lockSize=mainLock?mainLock.cal.size:[0,0,0];
 const rodFeature=mainLock?MOD_ASSEMBLY_V4_ROD_FEATURES[mainLock.id]:null;
 const rodX=rodFeature?.rodX||baseW*.24;
 const knobX=rodFeature?.knobX||rodX;
 const lockRodY=rodFeature?.lockRodY??0,gripRodY=rodFeature?.gripRodY??0;
 const lockCenterY=mainLock?mainLock.position[1]+lockSize[1]/2:hostY;
 const lockCenterZ=mainLock?mainLock.position[2]+lockSize[2]/2:lockTop-24;
 const lockOuterY=lockCenterY-lockSize[1]/2;
 const rodLength=Number(c.rodLength),rodLengthValid=Number.isFinite(rodLength)&&rodLength>0;
 const lockRodAnchorsWorld=mainLock?(mainLock.localFeatures?.rodAnchorsLocal||[]).map(a=>modAssemblyV4LocalToWorld(mainLock,[a.x,a.y,a.z])):[];
 const isS=mainLock?.id==='m0646';
 const knobParts=group('handle-knob');
 const knobBody=knobParts.find(p=>!/Part 2/i.test(byId[p.id].name));
 const knobBodySize=knobBody?.cal.size||[34.04638671875,21.943960189819336,34.04638671875];
 const looseParts=isS?[...secondLocks,...knobParts]:[];
 if(isS)looseParts.forEach((p,index)=>{
  p.cal=modAssemblyV4TrolleyFrame(p.id);
  const sz=p.cal.size,column=Math.floor(index/2),row=index%2;
  p.position=modAssemblyV4Center(p,baseW+70+column*55,hostY+15+row*70,sz[2]/2);
  p.step=13;p.explodeVector=[0,0,0];p.evidence='unplaced';
  if(/Part 2/i.test(byId[p.id].name)&&p.role==='handle-lock-second')p.localFeatures={
   ...MOD_ASSEMBLY_V4_ROD_FEATURES.m0645,lockId:'m0646',installedPlacementKnown:false,
   placementAnchor:null,countBasis:'sLockPart2Qty-user-input'
  };
  else p.localFeatures={
   lockId:'m0646',installedPlacementKnown:false,placementAnchor:null,
   sourcePositiveZ:'world-negative-Y',knobCenterLocalX:null,rodCenterLocalX:null
  };
  p.reason="S 锁座第二部分的份数与安装位置需另行确认。";
 });
 if(!isS)for(const p of knobParts){
   p.cal=modAssemblyV4TrolleyFrame(p.id);
   const sz=p.cal.size,side=p.copy%2,cap=/Part 2/i.test(byId[p.id].name);
   const x=baseW/2+(side?knobX:-knobX);
   const bodyMinY=lockOuterY-knobBodySize[1],capExtent=11.673;
   const centerY=cap?bodyMinY-capExtent/2:lockOuterY-sz[1]/2;
   p.position=modAssemblyV4Center(p,x,centerY,lockCenterZ);
   p.step=13;p.explodeVector=[side?95:-95,-175-(cap?25:0),25];
   p.localFeatures={
    lockId:mainLock?.id||null,rodAxis:'Y',sourcePositiveZ:'world-negative-Y',
    knobCenterLocalX:side?knobX:-knobX,rodCenterLocalX:side?rodX:-rodX,socketCenterLocalZ:0,
    lockOuterLocalY:rodFeature?.lockOuterY??null,
    sourceShoulderZ:71.511,sourceStemTipZ:86.527,stemProjection:15.016,capExtent,
    capPlacement:cap?'touch-assumption':'broad-disk-flush-to-lock-outer',
    seatingVerified:false
   };
   p.reason=cap?"端帽按接触关系展示，实际插入深度尚未验证。":"旋钮按锁板外侧定位，螺纹与嵌件配合待核对。";
 }
 for(const p of group('pullout-handle')){
  p.cal=modAssemblyV4TrolleyFrame(p.id);
  const oldMin=p.cal.min.slice(),oldMax=p.cal.max.slice(),sz=p.cal.size;
  p.cal.matrix=MOD_ASSEMBLY_V4_GRIP_FLIP.map(row=>row.slice());
  p.cal.min=oldMax.map(value=>-value);p.cal.max=oldMin.map(value=>-value);
  const gripFeatures=MOD_ASSEMBLY_V4_ROD_FEATURES[p.id]||{rodX,socketPlaneLocalZ:oldMax[2]};
  const gripZ=rodLengthValid?towerBottom+rodLength:hostTop+80;
  p.position=modAssemblyV4Center(p,baseW/2,lockCenterY,gripZ+sz[2]/2);
  const socketLocal=[[-gripFeatures.rodX,gripFeatures.gripRodY,gripFeatures.socketPlaneLocalZ],[gripFeatures.rodX,gripFeatures.gripRodY,gripFeatures.socketPlaneLocalZ]];
  const provisional=modAssemblyV4LocalToWorld(p,socketLocal[0]);
  if(lockRodAnchorsWorld.length)p.position[1]+=lockRodAnchorsWorld[0][1]-provisional[1];
  if(rodLengthValid)p.position[2]+=towerBottom+rodLength-provisional[2];
  const installedSockets=socketLocal.map(socket=>modAssemblyV4LocalToWorld(p,socket));
  p.step=14;p.explodeVector=[0,-205,150];
  p.localFeatures={
   rodAxis:'Z',socketPlane:'negative-world-Z',socketCentersLocal:socketLocal,
   installedSocketCenters:installedSockets,installedTipWorldZ:installedSockets[0][2],
   socketRadius:gripFeatures.gripRadius,anchorEvidence:gripFeatures.evidence,rodLengthKnown:rodLengthValid
  };
  p.reason=rodLengthValid?"握把高度采用输入的立杆长度，端部配合待核对。":"立杆长度未填写，握把仅作位置示意。";
 }
 const sceneMin=[0,1,2].map(axis=>Math.min(0,...scene.parts.map(p=>p.position[axis])));
 const sceneMax=[0,1,2].map(axis=>Math.max(axis===0?baseW:axis===1?baseD:hostTop,...scene.parts.map(p=>p.position[axis]+p.cal.size[axis])));
 scene.size=sceneMax.map((value,axis)=>Math.max(1,value-sceneMin[axis]));
 v4Complete(scene,rows,{...c,kind:'mods'},origin,0,explode,progress);
 const worldOrigin=[origin[0]||0,origin[1]||0,origin[2]||0];
 const axleHardware=(built.hardware||[]).find(row=>/底座通轴/.test(`${row.note||''} ${row.name||''}`));
 const axleMatch=String(axleHardware?.spec||'').match(/M16\s*rod\s*×\s*([\d.]+)\s*mm/i);
 const axleLength=axleMatch?Number(axleMatch[1]):NaN;
 if(Number.isFinite(axleLength)&&axleLength>0){
  scene.referenceRods.push({
   id:'reference-base-axle',kind:'base-axle',hardwareRole:'wheel-axle',length:axleLength,radius:8,color:[.65,.68,.70],
   start:[worldOrigin[0]+baseW/2-axleLength/2,worldOrigin[1]+wheelY,worldOrigin[2]+wheelZ],
   end:[worldOrigin[0]+baseW/2+axleLength/2,worldOrigin[1]+wheelY,worldOrigin[2]+wheelZ]
  });
 }
 if(rodLengthValid){
  const gripPart=group('pullout-handle')[0];
  for(let rod=0;rod<2;rod++){
   const anchor=lockRodAnchorsWorld[rod]||[baseW/2+(rod?rodX:-rodX),lockCenterY+lockRodY,lockTop];
   const endZ=gripPart?.localFeatures?.installedTipWorldZ??towerBottom+rodLength;
   scene.referenceRods.push({
   id:'reference-upright-rod-'+rod,kind:'upright-rod',hardwareRole:'pullout-upright',length:rodLength,radius:8,color:[.65,.68,.70],
   start:[worldOrigin[0]+anchor[0],worldOrigin[1]+anchor[1],worldOrigin[2]+towerBottom],
   end:[worldOrigin[0]+anchor[0],worldOrigin[1]+anchor[1],worldOrigin[2]+endZ]
   });
  }
 }

 scene.precision="安装位置与接口配合尚待核对。";
 scene.bom=rows.map(row=>({id:row.id,qty:row.qty,role:row.role,reason:row.reason||row.note||'',source:''}));
 scene.auditMatchesBOM=scene.audit.length===scene.bom.length&&scene.audit.every((audit,i)=>audit.id===scene.bom[i].id&&audit.copies===scene.bom[i].qty&&audit.expected===audit.represented);
 return scene;
}
function modAssemblyV4Scene(c,origin=[0,0,0],explode=0,progress=Infinity){
 const family=c.family||c.optionId||c.type;
 if(family==='trolley')return modAssemblyV4TrolleyScene(c,origin,explode,progress);
 const b=EXTENSION_RULES.buildModification(c),rows=(b.bom||[]).filter(r=>byId[r.id]).map(r=>({...r,item:byId[r.id]}));
 const scene={parts:[],size:[0,0,0],pitch:0,missing:[...(b.errors||[]),...(b.needsInput||[]).map(r=>r.reason)],hardware:b.hardware||[]};
 const groups={};
 const add=(r,rowIndex,copy,component,rotation=MOD_ASSEMBLY_V4_I)=>{
  const p=v4Part(r,copy,component,'raw',rotation);p.cal=modAssemblyV4Frame(p.id,rotation);p.rowIndex=rowIndex;
  p.evidence='unplaced';p.reason=MOD_ASSEMBLY_V4_EVIDENCE.unsupported;p.explodeVector=[0,0,0];
  scene.parts.push(p);(groups[r.role]||=([])).push(p);return p;
 };
 rows.forEach((r,rowIndex)=>{if(!Number.isInteger(r.qty)||r.qty<=0)return;
  for(let copy=0;copy<r.qty;copy++)for(let component=0;component<(v4Data(r.item.id)?.length||1);component++){
   let rot=/^base$/.test(r.role)?MOD_ASSEMBLY_V4_BASE:
    /^(wheel-disk|wheel-cover|tpu-tire|bushing)$/.test(r.role)?MOD_ASSEMBLY_V4_WHEEL:
    r.role==='handle-knob'?MOD_ASSEMBLY_V4_KNOB:MOD_ASSEMBLY_V4_I;
   add(r,rowIndex,copy,component,rot);
  }
 });
 const g=role=>groups[role]||[],put=(p,xyz,step,vector,evidence,reason)=>modAssemblyV4Place(p,...xyz,step,vector,evidence,reason);
 const base=g('base'),foot=g('foot');
 let baseW=0,baseD=0,baseH=0,baseZ=0,baseY=0;
 if(base.length===1){const p=base[0];[baseW,baseD,baseH]=p.cal.size;baseZ=60;baseY=0;
  put(p,[baseW/2,baseD/2,baseZ+baseH/2],0,[0,0,75],'inferred',MOD_ASSEMBLY_V4_EVIDENCE.base);
 }else if(base.length===2){

  baseW=Math.max(...base.map(p=>p.cal.size[0]));baseD=base.reduce((s,p)=>s+p.cal.size[1],0);baseH=Math.max(...base.map(p=>p.cal.size[2]));baseZ=60;
  let y=0;for(const p of base){put(p,[baseW/2,y+p.cal.size[1]/2,baseZ+p.cal.size[2]/2],0,[0,y?95:-95,70],'inferred',MOD_ASSEMBLY_V4_EVIDENCE.base+"当前方案配套件。");y+=p.cal.size[1]}
 }
 if(baseW){scene.size=[baseW,baseD,baseZ+baseH];scene.pitch=baseH;

  for(const [i,p] of foot.entries()){
   if(family==='mobileBase'&&i===0)put(p,[baseW/2,Math.min(baseD*.22,48),baseZ-p.cal.size[2]/2],6,[0,-70,-80],'inferred',MOD_ASSEMBLY_V4_EVIDENCE.base);
  }
 }
 const disks=g('wheel-disk'),tires=g('tpu-tire'),covers=g('wheel-cover'),bushings=g('bushing');
 const wheelCount=Math.max(disks.length,tires.length,covers.length,bushings.length);
 for(let i=0;i<wheelCount;i++){
  const mounted=family==='mobileBase'&&baseW>0;
  const side=i%2===0?-1:1,group=Math.floor(i/2);
  const cy=mounted?baseD*.77:80+group*190;
  const cz=mounted?baseZ+Math.min(20,baseH*.4):80;
  const cx=mounted?(side<0?-17:baseW+17):80+i*210;
  for(const [arr,step,offset,vec] of [[bushings,1,0,[side*95,0,0]],[disks,2,0,[side*115,0,0]],[tires,4,0,[side*135,0,0]],[covers,5,side*19,[side*155,0,0]]]){
   const p=arr[i];if(!p)continue;

   p.cal=modAssemblyV4Frame(p.id,side<0?MOD_ASSEMBLY_V4_WHEEL_REVERSE:MOD_ASSEMBLY_V4_WHEEL);
   put(p,[cx+offset,cy,cz],step,vec,'inferred',MOD_ASSEMBLY_V4_EVIDENCE.wheel);
  }
 }
 if(!baseW&&wheelCount){scene.size=[wheelCount*210,160,160];scene.pitch=160}
 const locks=g('handle-lock'),knobs=g('handle-knob'),grips=g('pullout-handle');
 if(family==='pullOutHandle'&&locks.length&&c.lockVariant!=='universal'){
  const lock=locks[0],W=lock.cal.size[0],D=lock.cal.size[1],H=lock.cal.size[2];
  const center=[W/2,D/2,50];put(lock,center,13,[0,-100,0],'inferred',MOD_ASSEMBLY_V4_EVIDENCE.knob);

  for(let rod=0;rod<2;rod++){
   const x=rod?W-40:40,y=5,z=50;
   for(let piece=0;piece<2;piece++){
    const p=knobs.find(q=>q.copy===rod&&byId[q.id].name.includes(`Part ${piece+1}`));
    if(!p)continue;
    put(p,[x,y-(piece===1?15:0),z],12,[rod?85:-85,-90-piece*20,0],'inferred',MOD_ASSEMBLY_V4_EVIDENCE.knob);
   }
  }

  for(const p of grips)put(p,[W/2,D/2,155],14,[0,0,130],'unplaced',"请填写实测长度，单位为毫米。");
  scene.size=[W,Math.max(D,70),190];scene.pitch=190;
 }else if(family==='pullOutHandle'&&knobs.length){

  for(const p of knobs){const rod=p.copy,cap=byId[p.id].name.includes('Part 2');
   put(p,[55+rod*110,cap?-15:0,35],12,[rod?85:-85,-95,0],'inferred',MOD_ASSEMBLY_V4_EVIDENCE.knob);
  }
  scene.size=[Math.max(220,...locks.map(p=>p.cal.size[0])),80,80];scene.pitch=80;
 }


 const loose=scene.parts.filter(p=>p.evidence==='unplaced');
 let lx=(scene.size[0]||0)+85,ly=0,column=0;
 for(const p of loose){if(ly+p.cal.size[1]>420&&ly){lx+=column+35;ly=0;column=0}
  p.position=[lx,ly,0];p.step=ASSEMBLY_STEPS.mods.length-1;p.explodeVector=[0,0,0];ly+=p.cal.size[1]+24;column=Math.max(column,p.cal.size[0]);
 }
 if(!scene.size[0])scene.size=[Math.max(1,lx+column),Math.max(1,ly),Math.max(1,...scene.parts.map(p=>p.cal.size[2]))];
 v4Complete(scene,rows,{...c,kind:'mods'},origin,0,explode,progress);

 scene.precision="安装位置与接口配合尚待核对。";
 return scene;
}
 const previous=baseSceneForModule;
 const identity=[[1,0,0],[0,1,0],[0,0,1]],turn=[[ -1,0,0],[0,1,0],[0,0,-1]];
 const F={
  shell:{id:'m0021',front:146.10009765625,backInside:2.0002,sideInside:3.0107,
   channelBottom:14.5856,channelTop:42.5856,width:164.8017578125},
  facade:{id:'m0012',holes:[[30.9478,23.4941],[133.8482,23.4941]],rear:0},
  box:{id:'m0015',holes:[[15.6465,18.5],[118.5469,18.5]],front:143.800048828125,grooveEnd:2.2002,slideStart:25.8},
  guide:{id:'m0300',maxX:9.52928876876831,minX:0.12929105758666992,backWallX:4.9293,height:27,length:143.4998779296875},
  slide:{id:'m0301',minX:-0.22115325927734375,maxX:8.7578125,height:18.2197265625,length:118}
 };
 const signatures={
  m0021:{matrix:[[1,0,0],[0,0,1],[0,-1,0]],center:[9001.55419921875,751.031457901001,1198.0683574676514],min:[-82.40087890625,-73.06640434265137,-28.647180557250977]},
  m0015:{matrix:identity,center:[9001.581468105316,1782.4417724609375,23.816901206970215],min:[-67.12541341781616,-71.9000244140625,-18.81758451461792]},
  m0012:{matrix:[[1,0,0],[0,0,1],[0,-1,0]],center:[9001.55517578125,1931.600118637085,143.4872589111328],min:[-82.39990234375,-5.149993896484375,-23.49684715270996]},
  m0300:{matrix:[[0,0,-1],[0,1,0],[1,0,0]],center:[9616.383777618408,1869.6764526367188,55.40992331504822],min:[-4.764644384384155,-71.74993896484375,-13.453113555908203]},
  m0301:{matrix:[[0,0,-1],[0,1,0],[1,0,0]],center:[9712.7216796875,1882.4263916015625,59.876380920410156],min:[-4.37890625,-59,-9.21875]}
 };
 const mountSignatures={"m0299:0":{"matrix":[[-0.7081062197685242,0,0.7061058878898621],[0,-0.9999999403953552,0],[0.7061058878898621,0,0.7081062197685242]],"center":[9079.875225305557,1809.5912475585938,23.516836881637573],"min":[-5.547808981762387,-8.966735305384645,-5.597693937342939]},"m0010:0":{"matrix":[[1,0,0],[0,0,-1],[0,1,0]],"center":[9039.992908000946,1857.6431784629822,23.46492338180542],"min":[-23.771228313446045,-2.510005474090576,-18.455922603607178]},"m0010:1":{"matrix":[[1,0,0],[0,0,-1],[0,1,0]],"center":[9039.992908000946,1896.3267922401428,23.46492338180542],"min":[-23.771228313446045,-2.510005474090576,-18.455922603607178]},"m0007:0":{"matrix":[[1,0,0],[0,0,-1],[0,1,0]],"center":[9001.5576171875,1875.6878089904785,23.604127883911133],"min":[-18.8994140625,-5.832241058349609,-6.570499420166016]},"m0001:0":{"matrix":[[0.7487866282463074,0.6628111004829407,0],[0,0,-0.9999998807907104],[-0.6628110408782959,0.7487865686416626,0]],"center":[8950.100708007812,1862.4417724609375,23.506186962127686],"min":[-4.916336648506103,-1.9026730176599926,-4.916336236112784]},"m0009:0":{"matrix":[[1,0,0],[0,1,0],[0,0,1]],"center":[9001.55712890625,1734.620891571045,-2.2363905906677246],"min":[-48.27783203125,-37.33988571166992,-2.2630233764648438]},"m0006:0":{"matrix":[[1,0,0],[0,0,-1],[0,1,0]],"center":[9001.65576171875,1862.8537902832031,23.600367069244385],"min":[-22.50048828125,-16.699581146240234,-18.281646728515625]},"m0280:0":{"matrix":[[1,0,0],[0,0,-1],[0,1,0]],"center":[9001.55419921875,2058.4161586761475,40.3291015625],"min":[-60.52685546875,-1.8914642333984375,-3.073629379272461]},"m0280:1":{"matrix":[[1,0,0],[0,0,-1],[0,1,0]],"center":[9001.55419921875,2065.036283493042,40.3291015625],"min":[-60.52685546875,-1.8914642333984375,-2.6007633209228516]},"m0008:0":{"matrix":[[1,0,0],[0,0,-1],[0,1,0]],"center":[9057.408203125,1863.2182693481445,23.527786254882812],"min":[-23.9287109375,-1.0281867980957031,-10.281867980957031]},"m0025:0":{"matrix":[[0.7071067690849304,0.7071067690849304,0],[0,0,1],[0.7071067690849304,-0.7071067690849304,0]],"center":[7849.920607805252,3314.352492570877,1299.9182739257812],"min":[-82.65337566654452,-72.98468017578125,-6.450995173974206]}};
 const near=(a,b)=>a.flat(Infinity).length===b.flat(Infinity).length&&a.flat(Infinity).every((v,i)=>Math.abs(v-b.flat(Infinity)[i])<1e-6);
 function applyFrame(p,cal,rotation,translation,origin){
  const corners=[];for(let i=0;i<8;i++)corners.push(mv(rotation,[i&1?cal.max[0]:cal.min[0],i&2?cal.max[1]:cal.min[1],i&4?cal.max[2]:cal.min[2]]));
  const min=[0,1,2].map(j=>Math.min(...corners.map(q=>q[j]))),max=[0,1,2].map(j=>Math.max(...corners.map(q=>q[j])));
  p.cal={...cal,matrix:mm(rotation,cal.matrix),min,max,size:max.map((v,j)=>v-min[j])};
  const rotatedMin=mv(rotation,cal.min);
  p.position=translation.map((v,j)=>v-rotatedMin[j]+min[j]+origin[j]);
  p.fitV6={referenceRotation:rotation,referenceTranslation:translation,referenceFrame:cal,
   status:'source-feature-constrained',physicalFitVerified:false};
 }
 function sceneForModule(c,origin=[0,0,0],open=0,explode=0,progress=Infinity){
  const scene=previous(c,origin,open,explode,progress);
  if((c.kind&&c.kind!=='drawer')||c.w!=='S'||String(c.d)!=='3'||c.h!=='1F')return scene;
  const refs={},mountRefs={};
  for(const [id,sig] of Object.entries(signatures)){
   const p=scene.parts.find(p=>p.id===id&&p.copy===0&&p.component===0);
   if(!p||!near(p.cal.matrix,sig.matrix)||!near(p.cal.center,sig.center)||!near(p.cal.min,sig.min)){
    scene.fitV6={applied:false,reason:"S3 1F 参考坐标系不匹配，未应用定位修正。"};return scene;
   }
   refs[id]=p.cal;
  }
  for(const p of scene.parts){const key=p.id+':'+p.component,sig=mountSignatures[key];if(!sig)continue;
   if(!near(p.cal.matrix,sig.matrix)||!near(p.cal.center,sig.center)||!near(p.cal.min,sig.min)){
    scene.fitV6={applied:false,reason:"S3 1F 机构坐标系不匹配，未应用定位修正。"};return scene;
   }mountRefs[key]=p.cal;
  }
  const axis=(F.shell.channelBottom+F.shell.channelTop)/2,center=F.shell.width/2;
  const front=F.shell.front,boxX=center-(F.box.holes[0][0]+F.box.holes[1][0])/2;
  const boxY=front-F.box.front,boxZ=axis-F.box.holes[0][1];

  const facadeT=[center-(F.facade.holes[0][0]+F.facade.holes[1][0])/2,front,axis-F.facade.holes[0][1]];

  const guideT=[F.shell.sideInside+.5+F.guide.maxX,boxY,axis+F.guide.height/2];
  const slideT=[boxX+F.box.grooveEnd-.2+F.slide.minX,boxY+F.box.slideStart,axis+F.slide.height/2];
  const mirror=t=>[F.shell.width-t[0],t[1],2*axis-t[2]];
  const core=new Set(Object.keys(signatures));
  const flipX=[[1,0,0],[0,-1,0],[0,0,-1]],flipZ=[[-1,0,0],[0,-1,0],[0,0,1]];
  const plans={};
  const plan=(id,component,rotation,translation,vector,reason,frontGroup=true)=>{
   if(mountRefs[id+':'+component])plans[id+':'+component]={rotation,translation,vector,reason,frontGroup};
  };
  const keyAxis=[facadeT[0]+82.3994,front,facadeT[2]+23.505];
  if(scene.parts.some(p=>p.id==='m0006')){
   plan('m0006',0,flipX,[keyAxis[0]-22.5005,front+25,keyAxis[2]+18.2508],[0,190,0],
    "钥匙轴按面板孔定位，齿轮啮合仍需核对。");
   plan('m0007',0,identity,[keyAxis[0]-18.8989,front+25+.01787+.05-9.66448,keyAxis[2]-6.587],[0,235,0],
    "端帽按钥匙柄定位，压装配合尚未验证。");
  }
  plan('m0010',0,flipX,[facadeT[0]+133.8482-36.83557,front+5.61508,axis+18.49875],[55,105,35],
   "弹簧按定位柱布置，未模拟弹性变形。");
  plan('m0010',1,flipZ,[facadeT[0]+30.9478+36.83368,front+5.61508,axis-18.41080],[-55,105,35],
   "弹簧按定位柱布置，未模拟弹性变形。");
  const railY=boxY+138.8004+.0170715;
  plan('m0280',0,turn,[center+121.0537109375/2,railY,boxZ+36.612],[-100,55,45],
   "齿条按抽屉盒槽位布置，齿相与锁止行程待验证。",false);
  plan('m0280',1,identity,[center-121.0537109375/2,railY,boxZ+1.8067-.21316],[100,55,45],
   "齿条按抽屉盒槽位布置，齿相与锁止行程待验证。",false);
  plan('m0008',0,flipX,[facadeT[0]+124.697-10.318,front+10.05633354,axis+10.3134],[100,160,0],
   "标签按面板槽位定位。");
  plan('m0001',0,flipX,[facadeT[0]+30.9473-4.916245,front+10.00534725,axis+4.916417],[-100,160,0],
   "端盖按面板孔位定位，实际配合待验证。");


  const stopAngle=Math.atan2(.7081062197685242,.7061058878898621),cs=Math.cos(stopAngle),sn=Math.sin(stopAngle);
  const stopR=[[cs,0,sn],[0,1,0],[-sn,0,cs]],stopT=[-4.7841,101.5496-17.93347061076929/2,28.5861-.0131591];
  plan('m0299',0,stopR,stopT,[-95,0,0],
   "止挡按侧孔定位，卡装变形与干涉待验证。",false);
  if(plans['m0299:0'])plans['m0299:0'].operates=false;
  plan('m0009',0,identity,[center-48.27783203125,63.4799-74.578125,.4360],[0,-55,-95],
   "底锁扣按壳体基准定位，弹性压入尚未验证。",false);
  if(plans['m0009:0'])plans['m0009:0'].operates=false;
  plan('m0025',0,identity,[-.2177,0,52.2],[0,0,150],
   "顶盖按参考平面定位，卡接侧面配合待核对。",false);
  if(plans['m0025:0'])plans['m0025:0'].operates=false;
  const constrained=p=>core.has(p.id)||!!plans[p.id+':'+p.component];
  const enter=p=>{const n=Math.max(0,Math.min(1,p.step-scene.progress));return n*n*(3-2*n)};
  for(const p of scene.parts){
   if(!constrained(p))continue;
   const mount=plans[p.id+':'+p.component];
   let rotation=identity,translation=[0,0,0],vector=[-80,-35,10],operates=false;
   if(p.id===F.box.id){translation=[boxX,boxY,boxZ];vector=[0,55,45];operates=true}
   if(p.id===F.facade.id){translation=facadeT;vector=[0,140,0];operates=true}
   if(p.id===F.guide.id){rotation=p.copy?identity:turn;translation=p.copy?mirror(guideT):guideT;vector=[p.copy?100:-100,0,0]}
   if(p.id===F.slide.id){rotation=p.copy?identity:turn;translation=p.copy?mirror(slideT):slideT;vector=[p.copy?55:-55,55,45];operates=true}
   if(mount){rotation=mount.rotation;translation=mount.translation;vector=mount.vector;operates=mount.operates!==false;p.frontGroup=mount.frontGroup;
    if(p.id==='m0299'&&p.copy){rotation=mm(turn,stopR);translation=mirror(stopT);vector=[95,0,0]}
   }
   applyFrame(p,mount?mountRefs[p.id+':'+p.component]:refs[p.id],rotation,translation,origin);
   if(p.id==='m0025')p.fitV6.status='roof-planes-aligned-interlock-unresolved';
   if(p.id==='m0009'||p.id==='m0299')p.fitV6.status='snap-datums-aligned-elastic-fit-unresolved';
   p.operates=operates;p.explodeVector=vector;
   p.move=vector.map(v=>v*(explode+enter(p)));
   if(operates)p.move[1]+=open*scene.size[1]*.72;
   if(p.frontGroup)p.move[1]+=Math.max(0,Math.min(1,7-scene.progress))*70;
   if((operates||p.id===F.guide.id)&&p.step<10)p.move[1]+=Math.max(0,Math.min(1,10-scene.progress))*scene.size[1]*.85;
   p.evidence='inferred';
   p.reason=mount?mount.reason:p.id===F.facade.id||p.id===F.box.id
    ?"安装位置与接口配合尚待核对。"
    :p.id===F.shell.id?"当前方案配套件。"
    :"安装位置与接口配合尚待核对。";
  }

  let x=F.shell.width+130,y=0,column=0;
  for(const p of scene.parts.filter(p=>!constrained(p))){
   if(y+p.cal.size[1]>280&&y){x+=column+30;y=0;column=0}
   p.position=[x+origin[0],y+origin[1],origin[2]];y+=p.cal.size[1]+20;column=Math.max(column,p.cal.size[0]);
   p.move=[0,0,0];p.explodeVector=[0,0,0];p.operates=false;p.frontGroup=false;delete p.hinge;delete p.lidGroup;
   p.evidence='unplaced';p.fitV6={status:'unresolved-mount',physicalFitVerified:false};
   p.reason="安装位置尚未确定，零件保留在待装区。";
  }
  const rows=makeBOM(c).rows;
  scene.audit=scene.audit.map(a=>{const ps=scene.parts.filter(p=>p.id===a.id);return {...a,inferred:ps.filter(p=>p.evidence==='inferred').length,unplaced:ps.filter(p=>p.evidence==='unplaced').length,verified:0}});
  scene.unplaced=rows.filter(r=>scene.parts.some(p=>p.id===r.item.id&&p.evidence==='unplaced'));
  scene.unknowns=[...scene.unplaced.map(r=>r.item.name+'：安装位置待确认'),...(scene.missing||[]),
   '原模型中的打印支撑仍保留，装配前需确认处理方式。',
   '齿轮与齿条的啮合位置、齿相和锁止行程尚未验证。',
   '弹簧按未变形形状展示，未模拟弹性压装。',
   '卡扣与止挡可能存在压入干涉，尚未模拟变形。',
   '顶盖已按参考面定位，卡接与堆叠配合仍需核对。',
   '抽拉行程用于展示，未验证全行程接触及制造公差。'];

  scene.precision="S3/1F 按特征定位展示，尚未验证实物配合。";
  scene.fitV6={applied:true,scope:'S3 1F core and front mechanism source-feature poses',assemblyComplete:false,
   poseComplete:scene.parts.every(constrained),
   physicalFitVerified:false,constrainedInstances:scene.parts.filter(constrained).length,
   unresolvedInstances:scene.parts.filter(p=>!constrained(p)).length,
   axisZ:axis,facadeHoleCenters:F.facade.holes.map(q=>[facadeT[0]+q[0],front,facadeT[2]+q[1]]),
   boxHoleCenters:F.box.holes.map(q=>[q[0]+boxX,front,q[1]+boxZ]),
   gapsMM:{boxRearToShell:boxY-F.shell.backInside,guideBackToShell:.5,guideTopBottom:.5,
    slideToBoxGroove:.2,guideToSlideSide:slideT[0]-F.slide.maxX-(guideT[0]-F.guide.backWallX),
    boxFrontToFacade:0,guideFrontToShellFront:front-boxY-F.guide.length},
   notes:["保持输入模型的原始比例与形状。","导轨间隙用于展示定位，不代表制造公差。","其他尺寸与翻盖箱沿用推定位置，配合仍需核对。"]};
  return scene;
 }
 return {module:sceneForModule,mods:modAssemblyV4Scene};
}
// q = R*(v-center) - min + position; hinge(q); then add move. All units are mm.
export function buildScene(input={},options={}){
 const config=normalizeConfig(input),bom=buildBOM(input);
 const {open=0,explode=0,progress=Infinity,origin=[0,0,0]}=options;
 if(!Array.isArray(origin)||origin.length!==3||origin.some(v=>!Number.isFinite(v))||!Number.isFinite(open)||!Number.isFinite(explode)||(progress!==Infinity&&!Number.isFinite(progress)))throw new TypeError("场景参数无效，请检查原点、开合量、展开量与步骤。");
 const invalid=bom.rows.filter(r=>!byId[r.id]?.bbox).map(r=>r.id);
 if(invalid.length||!bom.rows.length)return {parts:[],size:[0,0,0],pitch:0,bom,hardware:bom.hardware,errors:bom.errors,missing:[...bom.missing,...invalid],warnings:[...bom.warnings],audit:[],quantityComplete:false,physicalFitVerified:false};
 if(config.kind==='drawer'&&config.fullRunners)return fullRunnerScene(config,bom,options,buildScene,componentFrames);
 if(config.kind==='drawer'&&config.drawers!==undefined)return packedDrawerScene(config,bom,options,buildScene,componentFrames);
 const builders=createBuilders(config,bom),scene=config.kind==='mods'?builders.mods(config,origin,Math.max(0,explode),progress):builders.module(config,origin,Math.max(0,Math.min(1,open)),Math.max(0,explode),progress);
 if(config.kind==='sustainer')fitSustainer(scene,config,{origin,open:Math.max(0,Math.min(1,open)),explode:Math.max(0,explode)});
 for(const p of scene.parts)p.role=p.role||bom.rows[p.rowIndex]?.role||'accessory';
 if(config.kind==='drawer')fitDrawer(scene,config,{origin,open:Math.max(0,Math.min(1,open)),explode:Math.max(0,explode)});
 for(const p of scene.parts){p.matrix=p.cal.matrix;p.role=p.role||bom.rows[p.rowIndex]?.role||'accessory';delete p.source;}
 if(config.kind==='sustainer'){
  // Summarize final fitted poses, not the preliminary placement pass.
  scene.audit=scene.audit.map(a=>{const ps=scene.parts.filter(p=>p.id===a.id);return {...a,inferred:ps.filter(p=>p.evidence==='inferred').length,unplaced:ps.filter(p=>p.evidence==='unplaced').length};});
  scene.unplaced=bom.rows.filter(r=>scene.parts.some(p=>p.id===r.id&&p.evidence==='unplaced')||!Number.isInteger(r.qty)||r.qty<=0).map(r=>({...r,item:byId[r.id]}));
  const pending=scene.audit.filter(a=>a.unplaced||a.expected===null).map(a=>a.name+'：'+(a.expected===null?'数量需按当前安装布局确认。':'安装位置待确认，零件保留在待装区。'));
  scene.unknowns=[...pending,...(scene.missing||[]),...(scene.fitWarnings||[])];
  scene.fitWarnings=[...(scene.fitWarnings||[]),...pending];
 }
 delete scene.source;
 scene.bom=bom;scene.hardware=bom.hardware;scene.errors=bom.errors;scene.warnings=[...new Set([...bom.warnings,...(scene.unknowns||[])])];scene.needsInput=bom.needsInput;
 scene.quantityComplete=!!scene.quantityComplete&&bom.complete;scene.physicalFitVerified=false;
 return scene;
}
