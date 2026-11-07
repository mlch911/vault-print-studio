import catalog from './catalog.json' with { type: 'json' };
import {frameRoles,runnerRoles,drawerHeight,drawerLayoutProblem} from './drawer-layout.js';
// Quantities count complete STL files. Geometry is never loaded by this module.
const CATALOG = catalog;
const byId = Object.fromEntries(catalog.map(item => [item.id, item]));
const byOld = new Map(catalog.map(item => [item.old.trim().toLowerCase(), item]));
const findOld = path => byOld.get(path.trim().toLowerCase());
// Family and universal facades have one lock seat on S/M, two on L/XL.
// Each lock uses one holder, inner, outer and complete four-pin STL set.
const sustainerLockCount = w => ({S:1,M:1,L:2,XL:2})[w];
const titles={drawer:'抽屉',sustainer:'翻盖箱',mods:'改装配件',trolley:'小推车',base:'底座',wheels:'打印轮组',mobileBase:'双轮底座',casters:'脚轮底座',feet:'支脚',backbone:'背板',moduleConnector:'模块连接件',baseConnector:'底座连接件',pullOutHandle:'伸缩拉手',stationaryHandle:'固定提手',pegboard:'洞洞板连接件',wallMount:'壁挂组件',underTableMount:'桌底安装顶盖',w:'宽度',d:'深度',h:'层高',key:'钥匙类型',roof:'顶盖',rails:'齿条',fullRunners:'满滑轨',label:'标签',baseplate:'Gridfinity 底板',handle:'顶部提手',interior:'内腔',facade:'面板',lockCount:'锁扣数量',splitRoofConnectorQty:'顶盖连接件份数',dividers:'分隔板份数',dividerLayout:'分区方式',towerLayers:'抽屉塔层数',form:'底座形式',qty:'文件份数',splitBaseConnectorQty:'底座连接件份数',splitBaseFasteners:'分体底座紧固方案',jig:'装配治具',stopperOuterDiameter:'止动环外径',casterBoltLength:'脚轮螺栓长度',variant:'背板类型',boltLength:'背板螺栓长度',fastenersPerBoard:'每块背板的紧固件数',backboneFastenerQty:'背板紧固件总数',lockMountQty:'锁板紧固件数',lockMountBoltLength:'锁板螺栓长度',lockVariant:'拉手锁座类型',lockQty:'拉手锁座份数',rodLength:'立杆长度',lockBoltThread:'锁紧螺纹',threadsVerified:'螺纹匹配确认',sLockPart2Qty:'S 锁座第二部分份数',backboneConfirmed:'背板配套确认',standard:'洞洞板制式',boardCount:'洞洞板数量',mountingSystem:'固定方式',fastenerQty:'紧固件数量',fastenerSpec:'紧固件规格',moduleFastenerSpec:'模块侧紧固件规格',moduleFastenerQty:'模块侧紧固件数量',wallFastenerSpec:'墙侧紧固件规格',wallFastenerQty:'墙侧紧固件数量',baseplateFitConfirmed:'底板配合确认',drawerBuilder:'宿主抽屉清单',flat:'平底内腔',standardInterior:'标准内腔',sealed:'封闭分区',none:'不添加',whole:'整体',split:'分体',family:'系列配套',universal:'通用',hidden:'隐藏式',both:'两种标签',custom:'自定义',width:'宽度配套',screws:'螺钉',anchors:'锚固件',inserts:'嵌件'};
const title=key=>typeof key==='string'&&Object.hasOwn(titles,key)?titles[key]:'其他设置';
const purposes={w:'选择模块宽度代号。',d:'选择网格深度代号。',h:'选择层高；XL 仅提供 1F。',key:'标准式和隐藏式钥匙二选一。',roof:'选择与当前尺寸匹配的顶盖。',rails:'一份文件包含一对齿条，建议配合齿轮钥匙。',fullRunners:'按外框每个 1F 层位配齐左右导向件、滑动件和止挡。',label:'按需添加标签片。',baseplate:'按需添加内置 Gridfinity 底板。',handle:'按需添加顶部提手及配套螺栓。',interior:'选择收纳内腔形式。',facade:'系列面板和通用面板二选一。',lockCount:'按面板实际位置确认锁扣数量。',splitRoofConnectorQty:'填写连接分体顶盖所需的文件份数。',dividers:'按自定义分区填写各类分隔板份数。',dividerLayout:'不分区或自行配置分隔板。',towerLayers:'选择 1–6 层；S/M/L 每层 2F，XL 每层 1F。',form:'整体底座与分体底座二选一。',qty:'按完整 STL 文件填写打印份数。',splitBaseConnectorQty:'按分体底座连接位置填写份数。',splitBaseFasteners:'填写分体底座采用的紧固方案。',jig:'治具用于装配定位，完成后取下。',stopperOuterDiameter:'外径按实物选择 30 或 35 毫米。',casterBoltLength:'填写 M8 脚轮固定螺栓的实测长度。',variant:'选择宽度配套背板或通用窄背板。',boltLength:'填写 60–100 毫米范围内的背板螺栓长度。',fastenersPerBoard:'按实际孔位填写每块背板的紧固件数。',backboneFastenerQty:'填写所有选定连接处的背板紧固件总数。',lockMountQty:'填写锁板独立安装的紧固件数量。',lockMountBoltLength:'按穿透厚度填写锁板螺栓长度，单位毫米。',lockVariant:'选择宽度配套锁座或通用锁座。',lockQty:'按两根立杆的实际布局填写通用锁座份数。',rodLength:'填写两根立杆各自采用的长度，单位毫米。',lockBoltThread:'核对实物后选择 M4 或 M6。',threadsVerified:'确认螺栓与嵌件的螺纹配合方案。',sLockPart2Qty:'按实际布局填写 S 锁座第二部分的份数。',backboneConfirmed:'确认已有或另行配齐所需背板。',standard:'选择 IKEA 或 USSA 洞洞板制式。',boardCount:'填写外购洞洞板数量。',mountingSystem:'按安装基材选择固定方式。',fastenerQty:'填写实际安装需要的紧固件数量。',fastenerSpec:'填写经接口核对的紧固件规格。',moduleFastenerSpec:'填写模块侧固定件的规格。',moduleFastenerQty:'填写模块侧固定件的数量。',wallFastenerSpec:'按墙体选择固定件规格。',wallFastenerQty:'填写墙侧固定件的数量。',baseplateFitConfirmed:'确认所选底板与分区内腔无冲突。',drawerBuilder:'检查宿主抽屉清单是否可用。'};
const purpose=key=>Object.hasOwn(purposes,key)?purposes[key]:'填写当前方案需要的设置值。';
function drawerFiles(c){let rows=[],missing=[];const prefix={'S':'01. S Families','M':'02. M Families','L':'03. L Families','XL':'05. XL Families'}[c.w],wd=c.w+c.d,root=`01. DRAWERS/${prefix}/${wd}/`,uni='01. DRAWERS/07. Universal/';
 function add(p,qty,note,source,required=true){let item=findOld(p);if(!item){missing.push(p);return}rows.push({item,qty,note,required})}
 add(root+`Modules/${wd} Module ${c.h}.stl`,1,"抽屉","当前方案配套件。");
 if(c.w==='XL'&&Number(c.d)>=6){for(let n of [1,2])add(root+`Boxes/${wd} Box 1F Part ${n}.stl`,1,`XL 1 ${n} `,"当前方案配套件。")}
 else add(root+`Boxes/${wd} Box ${c.h}.stl`,1,"抽屉","当前方案配套件。");
 if(c.w==='XL'&&Number(c.d)<=5)add(root+`Boxes/${wd} Back Panel.stl`,1,"封闭抽屉盒后部开口，配套后面板一份。","实际源模型后槽与后面板接口。");
 const facade=c.w==='XL'?'XL Facade 1F.stl':`${c.w}${c.h} (Turn On Supports).stl`;
 add(c.w==='XL'?`01. DRAWERS/${prefix}/${facade}`:`01. DRAWERS/${prefix}/Facades/${facade}`,1,"打印支撑或装配工具，不作为成品结构件。","当前方案配套件。");
 const runner=uni+'Runners/'+(c.w==='XL'?'XL Runners/':'');
 add(runner+`x${c.d} Runner Guide${c.w==='XL'?' XL':''}.stl`,2,"当前方案配套件。","当前方案配套件。");
 add(runner+`x${c.d} Runner Slide${c.w==='XL'?' XL':''}.stl`,2,"当前方案配套件。","当前方案配套件。");
 add(uni+'Runners/Runner Stopper.stl',2,"抽屉","当前方案配套件。");
 add(uni+'Springs.stl',1,"抽屉","当前方案配套件。");
 add(uni+'Key Cap.stl',1,"当前方案配套件。","当前方案配套件。");
 add(uni+'Facade Cap.stl',1,"面板","当前方案配套件。");
 add(uni+'Latch.stl',1,"当前方案配套件。","当前方案配套件。");
 if(c.key==='hidden'){add(uni+'Hidden Key (Turn On Supports).stl',1,"打印支撑或装配工具，不作为成品结构件。","当前方案配套件。");add(uni+'Hidden Key Part 2 (Turn on Supports).stl',1,"打印支撑或装配工具，不作为成品结构件。","当前方案配套件。")}
 else add(uni+'Key (Turn On Supports).stl',1,"打印支撑或装配工具，不作为成品结构件。","当前方案配套件。");
 if(c.rails)add(uni+`Geared Rails/${c.w} Rails.stl`,1,"齿条为成对选配件，建议配合齿轮钥匙使用。","当前方案配套件。",false);
 if(c.label)add(uni+'Label.stl',1,"按需选配。","当前方案配套件。",false);
 if(c.baseplate){let candidates=CATALOG.filter(x=>x.old.startsWith(root+'Gridfinity Baseplate/'));let plain=candidates.filter(x=>/Baseplate(?: Part [12])?\.stl$/i.test(x.name)&&!x.name.includes('With'));if(plain.length)for(let x of plain)rows.push({item:x,qty:1,note:"按需选配。",source:'',required:false});else missing.push(root+"当前方案配套件。")}
 if(c.roof!=='none')add(root+`Roofs/${wd} ${c.roof}.stl`,1,"当前方案配套件。","当前方案配套件。",true);
 if(c.roof==='Heawyweight Roof'){add(uni+'Heawyweight Roof Handle.stl',1,"顶盖","顶盖");add(uni+'Heawyweight Roof Insert.stl',1,"顶盖","顶盖")}
 if(c.handle)add(uni+'Top Handle (Turn On Supports).stl',1,"打印支撑或装配工具，不作为成品结构件。","当前方案配套件。",false);
 return {rows,missing}}
function createExtensionRules(files){
const canon = s => String(s).trim().toLowerCase().replace(/\s+/g,' ');
const oldMap = new Map(files.map(x=>[canon(x.old),x]));
const byId = new Map(files.map(x=>[x.id,x]));
const S='02. SUSTAINERS/', U=S+'05. Universal/', M='03. MODIFICATIONS/';
const src = {s:'',hw:'',mod:'',cat:''};
const field=(key,type,purpose,choices,required=false)=>({key,type,...(choices?{choices}:{}),required});
function result(title){return {title,titles:[title],bom:[],hardware:[],errors:[],warnings:[],needsInput:[],missing:[],complete:false};}
const inputReasons=purposes;
function need(r,key,reason,choices){if(!r.needsInput.some(x=>x.field===key))r.needsInput.push({field:key,reason:inputReasons[key]||'请确认'+title(key)+'。',...(choices?{choices}:{})});r.warnings.push(inputReasons[key]||'请确认'+title(key)+'。');return null;}
function count(r,c,key,def,min=1){const raw=c[key],n=raw===undefined?def:(typeof raw==='number'||typeof raw==='string'&&raw.trim()!==''?Number(raw):NaN);if(n===undefined||n===null||!Number.isSafeInteger(n)||n<min||n>10000)return need(r,key,'请确认'+title(key));return n;}
function choose(r,c,key,def,choices){const value=c[key]===undefined?def:c[key];if(!choices.includes(value)){r.errors.push(title(key)+'选项无效，可选值：'+choices.join('、'));return null;}return value;}
function add(r,p,qty,role,reason,source,required=true){if(typeof source==='boolean')required=source;const x=byId.get(p)||oldMap.get(canon(p));if(!x){r.missing.push(p);r.errors.push('目录缺少零件：'+p);return;}const prev=r.bom.find(a=>a.id===x.id);if(prev){prev.qty=prev.qty===null||qty===null?null:prev.qty+qty;prev.required ||= required;return;}r.bom.push({id:x.id,qty,role,reason:role,required,name:x.name,title:x.zh||x.name});}
function hw(r,spec,qty,note,source=src.hw){r.hardware.push({name:spec,spec,qty,note});}
function done(r){r.warnings=[...new Set(r.warnings)];r.complete=!r.errors.length&&!r.missing.length&&!r.needsInput.length&&r.bom.every(x=>Number.isSafeInteger(x.qty)&&x.qty>0)&&r.hardware.every(x=>Number.isSafeInteger(x.qty)&&x.qty>0);return r;}
function dims(r,c,depth=true){const w=choose(r,c,'w',undefined,['S','M','L','XL']);const d=depth?Number(c.d):undefined;if(depth&&![3,4,5,6,7].includes(d))r.errors.push("深度代号仅支持 3、4、5、6、7。");return {w,d,wd:w+String(d)};}
function matching(prefix,re){return files.filter(x=>x.old.startsWith(prefix)&&re.test(x.name));}
function systitle(t){return ({standard:'标准内腔',flat:'平底内腔',dividers:'分隔板内腔',sealed:'封闭分区'})[t]||'内腔待选';}
const sustainerInputs=[field('roof','enum',"顶盖",['whole','split']),field('facade','enum',"面板",['family','universal']),field('label','enum',"按需选配。",['none','sustainer','drawer','both']),field('baseplate','boolean',"按需选配。"),field('lockCount','integer',"数量需按当前安装布局确认。"),field('splitRoofConnectorQty','integer',"数量需按当前安装布局确认。"),field('dividers','object',"数量需按当前安装布局确认。")];
const sustainerOptions=[];
for(const x of files){if(!x.old.startsWith(S)||!x.old.includes('/Modules/'))continue;const m=x.name.match(/^(XL|S|M|L)([3-7])\s+([124])F\s+(?:(Flat|Dividers|Sealed)\s+)?Module\s*\.stl$/i);if(!m)continue;const w=m[1].toUpperCase(),d=Number(m[2]),h=m[3]+'F',type=(m[4]||'standard').toLowerCase();sustainerOptions.push({id:x.id,optionId:x.id,w,d,h,type,interior:type,title:`${w}${d} ${h} ${systitle(type)}翻盖箱`,bodyIds:[x.id],inputs:sustainerInputs,source:''});}
function buildSustainer(input={}){
 const c={...input};const r=result("翻盖箱");let opt;
 if(c.optionId){opt=sustainerOptions.find(x=>x.id===c.optionId);if(!opt){r.errors.push("选项组合无效，请检查尺寸与配套方案。");return done(r);}for(const k of ['w','d','h'])if(c[k]!==undefined&&String(c[k])!==String(opt[k]))r.errors.push("所选外壳与参数冲突："+k);Object.assign(c,{w:opt.w,d:opt.d,h:opt.h});}
 const {w,d,wd}=dims(r,c);const h=choose(r,c,'h','1F',['1F','2F','4F']);let type=c.type||c.interior||opt?.type||(w==='S'||w==='M'?'standard':'flat');
 if((w==='S'||w==='M')&&type==='flat'){type='standard';r.warnings.push("此宽度使用标准内腔。");}
 if(opt&&type!==opt.type)r.errors.push("选项组合无效，请检查尺寸与配套方案。");
 opt=opt||sustainerOptions.find(x=>x.w===w&&x.d===d&&x.h===h&&x.type===type);
 if(!opt)r.errors.push("目录中没有匹配零件。");
 if(r.errors.length)return done(r);r.title=opt.title;r.titles=[r.title];
 const family={'S':'01. S Families','M':'02. M Families','L':'03. L Families','XL':'04. XL Families'}[w];const prefix=S+family+'/'+wd+'/';
 add(r,opt.id,1,'body',"当前方案配套件。",src.cat);
 const roof=choose(r,c,'roof','whole',['whole','split']);const roofs=matching(prefix,/Roof/i);
 if(roof==='split'){
   const parts=roofs.filter(x=>/Roof Part [12]\.stl$/i.test(x.name));if(parts.length!==2)r.errors.push("此尺寸没有完整的分体顶盖。");else for(const p of parts)add(r,p.id,1,'roof',"顶盖",src.cat);
   const conn=roofs.find(x=>/Connector For Split Roof/i.test(x.name));if(conn)add(r,conn.id,count(r,c,'splitRoofConnectorQty',undefined), 'split-roof-connector',"数量需按当前安装布局确认。",src.cat);else r.errors.push("找不到配套的分体顶盖连接件。");
 }else if(roof==='whole'){const p=roofs.find(x=>/Roof(?: Whole)?\.stl$/i.test(x.name)&&!/^Connector/i.test(x.name));if(p)add(r,p.id,1,'roof',"顶盖",src.s);else r.errors.push("目录中没有匹配零件。");}
 const facade=choose(r,c,'facade','family',['family','universal']);
 if(facade==='universal'&&w==='XL')r.errors.push("XL 请使用对应系列的面板。");
 else if(facade){const candidates=files.filter(x=>x.old.startsWith(facade==='universal'?U+'Facades/':S+family+'/')&&!x.old.includes('/Modules/')&&/Facade|\/Facades\//i.test(x.old));const x=candidates.find(x=>canon(x.name).replace(/[ '\-]/g,'')===canon(`${w}${h}${facade==='family'?' Facade':''}.stl`).replace(/[ '\-]/g,''));if(x)add(r,x.id,1,'facade',"面板",src.cat);else r.errors.push("目录中没有匹配零件。");}

 const low=(w==='L'||w==='XL')?(h==='1F'?'L-XL 1F Hinge':'L 2-4F Hinge'):(h==='1F'?'S-M 1F Hinge':'S-M 2-4F Hinge');
 add(r,U+'Hinges/'+low+'.stl',1,'hinge-bottom',"当前方案配套件。",'');
 add(r,U+'Hinges/'+((w==='L'||w==='XL')?'L-XL':w)+' Hinge Top.stl',1,'hinge-top',(w==='L'||w==='XL')?"当前方案配套件。":"当前方案配套件。",'');
 add(r,U+'Rods/'+((w==='L'||w==='XL')?'L-XL':'S-M')+' Rods.stl',1,'hinge-rods',"当前方案配套件。",'');
 const locks=count(r,c,'lockCount',sustainerLockCount(w));
 add(r,U+'Locks/LOCK HOLDER.stl',locks,'lock-holder',"当前方案配套件。",'');
 add(r,U+'Locks/LOCK INNER PART.stl',locks,'lock-inner',"当前方案配套件。",'');
 add(r,U+'Locks/LOCK OUTER PART '+(h==='1F'?'1F':'2-4F')+'.stl',locks,'lock-outer',"当前方案配套件。",''+src.cat);
 add(r,U+'Locks/1 SET OF PINS FOR 1 LOCK.stl',locks,'lock-pins',"当前方案配套件。",'');
 const label=typeof c.label==='boolean'?(c.label?'sustainer':'none'):(c.label||'none');if(!['none','sustainer','drawer','both'].includes(label))r.errors.push("选项组合无效，请检查尺寸与配套方案。");
 if(['sustainer','both'].includes(label))add(r,U+'Label for Sustainers.stl',1,'label',"翻盖箱",false);
 if(['drawer','both'].includes(label))add(r,'01. DRAWERS/07. Universal/Label.stl',1,'label',"翻盖箱",false);
 const bp=c.baseplate===true;if(c.baseplate!==undefined&&typeof c.baseplate!=='boolean')r.errors.push("底板选项必须为开或关。");
 if(bp){if(type==='sealed'||type==='dividers'){need(r,'baseplateFitConfirmed',"安装位置与接口配合尚待核对。");if(c.baseplateFitConfirmed===true){r.needsInput=r.needsInput.filter(x=>x.field!=='baseplateFitConfirmed');}}
 const list=matching(U+'Baseplates/',new RegExp('^'+wd+'(?: |\\b)'));for(const p of list)add(r,p.id,1,'baseplate',"按需选配。",''+src.cat,false);if(!list.length)r.errors.push("目录中没有匹配零件。");}
 if(c.dividerLayout!==undefined&&!['none','custom'].includes(c.dividerLayout))r.errors.push("分区方式请选择不分区或自定义。");
 if(c.dividerLayout==='none'&&c.dividers&&Object.values(c.dividers).some(x=>Number(x)>0))r.errors.push("选项组合无效，请检查尺寸与配套方案。");
 const div=c.dividers||{};for(const key of Object.keys(div)){if(!['width','depth','seal','sealCenter','sealSides'].includes(key)){r.errors.push("选项组合无效，请检查尺寸与配套方案。"+key);continue;}const q=count(r,div,key,0,0);if(!q)continue;let name;
 if((w==='S'||w==='M')&&key==='width')name=`${w}${h} Divider.stl`;
 if(w==='L'&&key==='width'&&type==='dividers')name=`L-${h} Width Divider.stl`;
 if(w==='L'&&key==='depth'&&type==='dividers')name=`${wd}-${h} Depth Divider.stl`;
 if(w==='L'&&key==='seal'&&type==='sealed')name=`L-${h} Seal Divider.stl`;
 if(w==='XL'&&key==='width'&&type==='dividers')name='XL Width Divider.stl';
 if(w==='XL'&&key==='depth'&&type==='dividers')name=`${wd} Depth Divider.stl`;
 if(w==='XL'&&key==='sealCenter'&&type==='sealed')name='XL Seal Divider (Center).stl';
 if(w==='XL'&&key==='sealSides'&&type==='sealed')name='XL Seal Divider (Sides).stl';
 if(!name){r.errors.push(`当前内腔不支持此类分隔板：${key}。`);continue;}const p=files.find(x=>x.old.startsWith(U+'Dividers/')&&x.name===name);if(p)add(r,p.id,q,'divider',"数量需按当前安装布局确认。",false);else r.errors.push("目录中没有匹配零件。"+name);}
 hw(r,'M4 × 10 mm',8,"当前方案配套件。",src.hw);hw(r,'M4 × 14 mm',16,"当前方案配套件。",src.hw);hw(r,'M4 × 20 mm',7,"面板",src.hw);
 r.warnings.push("翻盖箱五金数量需结合箱体尺寸和锁扣布局复核。","打印辅助件不计入永久装配结构。","层高代号相同不表示实际堆叠高度相同。");
 if(c.rails)r.warnings.push("翻盖箱清单不包含抽屉齿条。");
 r.constraints={geometryVerified:false,nominalHeightDoesNotProveEqualPhysicalHeight:true,stackingSource:'',roofRequiredPerSustainer:true};return done(r);
}
const explicitCountCap=10000;
function explicitCount(r,c,key){const raw=c[key],n=typeof raw==='number'||typeof raw==='string'&&raw.trim()!==''?Number(raw):NaN;if(!Number.isSafeInteger(n)||n<1||n>explicitCountCap)return need(r,key,`${key} 1 ${explicitCountCap} `);return n;}
const common=[field('w','enum',"当前方案配套件。",['S','M','L','XL']),field('qty','integer',"数量需按当前安装布局确认。")];
const mods=[
 ['trolley',"抽屉","底座",['w','d','towerLayers','stopperOuterDiameter','boltLength','backboneFastenerQty','lockMountQty','lockMountBoltLength','rodLength','lockBoltThread','threadsVerified','sLockPart2Qty']],
 ['base',"底座","当前方案配套件。",['w','d','form','splitBaseConnectorQty']],
 ['wheels',"当前方案配套件。","底座",['qty','jig','stopperOuterDiameter']],
 ['mobileBase',"底座","请填写实测长度，单位为毫米。",['w','d','form','splitBaseConnectorQty','jig','stopperOuterDiameter']],
 ['casters',"底座","当前方案配套件。",['w','d','form','splitBaseConnectorQty','casterBoltLength']],
 ['feet',"当前方案配套件。","按需选配。",['w','qty']],
 ['backbone',"背板","当前方案配套件。",['w','h','variant','qty','boltLength','fastenersPerBoard']],
 ['moduleConnector',"当前方案配套件。","数量需按当前安装布局确认。",['h','qty','fastenerQty','fastenerSpec']],
 ['baseConnector',"底座","数量需按当前安装布局确认。",['qty','fastenerQty','fastenerSpec']],
 ['pullOutHandle',"提手","当前方案配套件。",['w','lockVariant','lockQty','rodLength','lockBoltThread','threadsVerified','sLockPart2Qty','backboneConfirmed']],
 ['stationaryHandle',"提手","背板",['w','qty','backboneConfirmed']],
 ['pegboard',"当前方案配套件。","当前方案配套件。",['w','h','standard','qty','boardCount','backboneConfirmed']],
 ['wallMount',"当前方案配套件。","当前方案配套件。",['w','h','qty','mountingSystem','moduleFastenerSpec','moduleFastenerQty','wallFastenerSpec','wallFastenerQty']],
 ['underTableMount',"顶盖","顶盖",['w','d','qty','mountingSystem','fastenerSpec','fastenerQty']]
];
const defs={w:common[0],qty:common[1],d:field('d','enum',"当前方案配套件。",[3,4,5,6,7]),h:field('h','enum',"当前方案配套件。",['1F','2F','4F']),form:field('form','enum',"当前方案配套件。",['whole','split']),splitBaseConnectorQty:field('splitBaseConnectorQty','integer',"数量需按当前安装布局确认。"),jig:field('jig','boolean',"打印支撑或装配工具，不作为成品结构件。"),stopperOuterDiameter:field('stopperOuterDiameter','number',"止动环外径存在 30/35 毫米两种记录，请按实物选择。",[30,35]),casterBoltLength:field('casterBoltLength','number',"请填写实测长度，单位为毫米。"),variant:field('variant','enum',"当前方案配套件。",['width','universal']),boltLength:field('boltLength','number',"背板"),fastenersPerBoard:field('fastenersPerBoard','integer',"数量需按当前安装布局确认。"),lockVariant:field('lockVariant','enum',"当前方案配套件。",['width','universal']),lockQty:field('lockQty','integer',"数量需按当前安装布局确认。"),rodLength:field('rodLength','number',"请填写实测长度，单位为毫米。"),lockBoltThread:field('lockBoltThread','enum',"请核对锁紧螺栓的 M4/M6 螺纹与嵌件是否匹配。",['M4','M6']),threadsVerified:field('threadsVerified','boolean',"请核对锁紧螺栓的 M4/M6 螺纹与嵌件是否匹配。"),sLockPart2Qty:field('sLockPart2Qty','integer',"S 锁座第二部分的份数与安装位置需另行确认。"),backboneConfirmed:field('backboneConfirmed','boolean',"背板"),standard:field('standard','enum',"当前方案配套件。",['IKEA','USSA']),boardCount:field('boardCount','integer',"数量需按当前安装布局确认。"),mountingSystem:field('mountingSystem','enum',"当前方案配套件。",['anchors','screws','inserts'])};
for(const [key,purpose] of [['backboneFastenerQty',"选项组合无效，请检查尺寸与配套方案。"],['lockMountQty',"数量需按当前安装布局确认。"]])defs[key]={...field(key,'integer',purpose,undefined,true),min:1,max:explicitCountCap};
defs.lockMountBoltLength=field('lockMountBoltLength','number',"请填写实测长度，单位为毫米。",undefined,true);
defs.sLockPart2Qty={...defs.sLockPart2Qty,min:1,max:explicitCountCap};
for(const k of ['fastenerQty','fastenerSpec','moduleFastenerSpec','moduleFastenerQty','wallFastenerSpec','wallFastenerQty'])defs[k]=field(k,k.endsWith('Qty')?'integer':'string',"数量需按当前安装布局确认。");
function modFiles(f){return files.filter(x=>f==='underTableMount'?/Under Table Mount Roof/.test(x.name):x.old.startsWith(M+({base:'Base/',wheels:'Wheels/',mobileBase:'Base/',casters:'Base/',feet:'Feet/',backbone:'Backbone/',moduleConnector:'Backbone/Connector for Modules',baseConnector:'Base/Base Connector',pullOutHandle:'Pull-out Handle/',stationaryHandle:'Stationary Handle/',pegboard:'Pegboard Attachment/',wallMount:'Wall Mounts/'}[f])));}
const modificationOptions=mods.map(([id,title,purpose,keys])=>({id,family:id,title,purpose,optional:true,inputs:keys.map(k=>defs[k]||field(k,'string',"当前方案配套件。")),variants:modFiles(id).map(x=>({id:x.id,title:x.zh||x.name,name:x.name})),source:''}));
const trolleyOption=modificationOptions.find(x=>x.id==='trolley');
trolleyOption.defaults={w:'L',d:3,towerLayers:3};
trolleyOption.inputs=trolleyOption.inputs.map(x=>x.key==='towerLayers'?{...field('towerLayers','integer',"抽屉"),default:3,min:1,max:6}:x);
trolleyOption.variants=files.filter(x=>x.old.startsWith(M)&&/\/(Base|Backbone|Feet|Wheels|Pull-out Handle)\//.test(x.old)&&!/Jig|Connector for Modules|Base Connector/.test(x.name)).map(x=>({id:x.id,title:x.zh||x.name,name:x.name}));

function buildTrolley(input){
 const c={...trolleyOption.defaults,...input},r=result(trolleyOption.title),{w,d}=dims(r,c);
 const layers=Number(c.towerLayers),h=w==='XL'?'1F':'2F';
 if(!Number.isInteger(layers)||layers<1||layers>6)r.errors.push("抽屉塔层数须为 1–6 的整数。");
 if(c.form!==undefined&&c.form!=='whole')r.errors.push("小推车方案使用整体底座。");
 if(c.h!==undefined&&c.h!==h)r.errors.push("此小推车方案的抽屉层高应为 "+h);
 if(c.lockVariant!==undefined&&c.lockVariant!=='width')r.errors.push("小推车方案请选择与宽度对应的拉手锁座。");
 if(r.errors.length)return done(r);
 r.title=` ${w}${d} · ${layers} ${h} `;r.titles=[r.title];
 r.hostModules=Array.from({length:layers},(_,i)=>({kind:'drawer',w,d:String(d),h,key:'standard',roof:i===layers-1?'Grid Roof':'none',rails:true,label:true,baseplate:false,handle:false}));
 const merge=part=>{
  for(const row of part.bom)add(r,row.id,row.qty,row.role,row.reason,row.source,row.required);
  r.hardware.push(...part.hardware);r.errors.push(...part.errors);r.warnings.push(...part.warnings);r.missing.push(...part.missing);
  for(const n of part.needsInput)if(!r.needsInput.some(x=>x.field===n.field))r.needsInput.push(n);
 };
 merge(buildModification({...c,family:'mobileBase',w,d,form:'whole',jig:false}));
 const backbone=buildModification({...c,family:'backbone',w,h,variant:'width',qty:layers});
 const backboneNote="背板紧固件填写所有选定连接处的总数，不能仅按层数代入。";
 backbone.hardware=backbone.hardware.map(row=>({...row,qty:explicitCount(r,c,'backboneFastenerQty'),role:'backbone-mount',qtyInput:'backboneFastenerQty',lengthInput:'boltLength',note:backboneNote,source:'',evidence:{summaryPerBoard:4,summarySource:'',drawingSource:'',quantityConflict:true,quantityBasis:'explicit-total-for-selected-joints'}}));
 r.warnings.push(backboneNote);
 merge(backbone);
 merge(buildModification({...c,family:'pullOutHandle',w,lockVariant:'width',backboneConfirmed:true}));
 const lockMountQty=explicitCount(r,c,'lockMountQty'),rawLockLength=c.lockMountBoltLength;
 const lockMountLength=typeof rawLockLength==='number'||typeof rawLockLength==='string'&&rawLockLength.trim()!==''?Number(rawLockLength):NaN;
 const lockLengthValid=Number.isFinite(lockMountLength)&&lockMountLength>0;
 if(!lockLengthValid)need(r,'lockMountBoltLength',"请填写实测长度，单位为毫米。");
 const lockMountSpec=`M4 × ${lockLengthValid?lockMountLength:"待确认"} mm`;
 r.hardware.push({name:lockMountSpec,spec:lockMountSpec,qty:lockMountQty,role:'lock-board-mount',qtyInput:'lockMountQty',lengthInput:'lockMountBoltLength',note:"数量需按当前安装布局确认。",source:'',evidence:{quantityBasis:'explicit-lock-board-mount-count',lengthBasis:'explicit-measured-mounting-length'}});
 r.hostBOMs=[];
 if(typeof api.drawerBuilder!=='function')need(r,'drawerBuilder',"安装位置与接口配合尚待核对。");
 else for(const [i,host] of r.hostModules.entries()){
  const built=api.drawerBuilder({...host});
  if(!built||!Array.isArray(built.rows)||!built.rows.length){r.errors.push(`第 ${i+1} 层抽屉清单无效。`);continue;}
  const hostRows=[];
  for(const row of built.rows){
   const id=row.item?.id||row.id;
   if(!byId.has(id)||!Number.isSafeInteger(row.qty)||row.qty<=0){r.errors.push(`第 ${i+1} 层抽屉的零件或份数无效。`);continue;}
   add(r,id,row.qty,'host-drawer',` ${i+1} ${row.note||row.reason||"抽屉"}`,row.source||'',row.required!==false);
   hostRows.push({id,qty:row.qty});
  }
  r.hostBOMs.push(hostRows);r.missing.push(...(built.missing||[]));r.errors.push(...(built.errors||[]));
 }
 hw(r,'M4 × 14 mm',layers*(h==='1F'?4:6),"面板",'');
 r.connections=[
  {from:'base',to:'wheel-assemblies',qty:2,source:''},
  {from:'base',to:'foot',qty:1,source:''},
  {from:'base',to:'host-0',via:'backbone',qty:1,source:''},
  ...Array.from({length:layers-1},(_,i)=>({from:`host-${i}`,to:`host-${i+1}`,via:'backbone',qty:1,source:''})),
  {from:`host-${layers-1}`,to:'handle-lock',qty:1,source:''},
  {from:'handle-lock',to:'pullout-handle',via:'M16 rods',qty:2,source:''}
 ];
 r.warnings.push("抽屉塔按名义层高布置，实际连接与支承高度需核对。","立杆长度按塔体与握把位置确认。","通轴、立杆、轴承与紧固件作为外购五金另列。");
 r.constraints={geometryVerified:false,nominalHeightDoesNotProveEqualPhysicalHeight:true,hostRequired:true,wholeBaseOnly:true,uniformHostHeight:h,maxLayers:6};
 return done(r);
}
function buildModification(c={}){
 if((c.family||c.optionId||c.type)==='trolley')return buildTrolley(c);
 const family=c.family||c.optionId||c.type;const option=modificationOptions.find(x=>x.id===family);const r=result(option?.title||"当前方案配套件。");if(!option){r.errors.push("选项组合无效，请检查尺寸与配套方案。");return done(r);}const source=option.source;let w=c.w,h=c.h||'1F',d=Number(c.d),wd=w+String(d);
 const requireW=()=>{w=choose(r,c,'w',undefined,['S','M','L','XL']);return w;};
 const amount=(key='qty',def=1)=>count(r,c,key,def);
 const addMod=(p,q,role,why)=>add(r,M+p,q,role,why,source);
 const confirmedBackbone=()=>{if(c.backboneConfirmed!==true)need(r,'backboneConfirmed',"背板",[true]);};
 function base(){const ds=dims(r,c);w=ds.w;d=ds.d;wd=ds.wd;if(r.errors.length)return;const form=choose(r,c,'form','whole',['whole','split']);if(form==='split'){if(d<6){r.errors.push("分体底座仅支持深度 6 或 7。");return;}for(const n of [1,2])addMod(`Base/${w}/${wd} Base Part ${n}.stl`,1,'base',"底座");addMod('Base/Base Connector.stl',amount('splitBaseConnectorQty',undefined),'base-connector',"数量需按当前安装布局确认。");need(r,'splitBaseFasteners',"数量需按当前安装布局确认。");if(c.splitBaseFasteners){r.needsInput=r.needsInput.filter(x=>x.field!=='splitBaseFasteners');r.warnings.push("已填写分体底座紧固方案："+String(c.splitBaseFasteners));}}
 else if(form==='whole')addMod(`Base/${w}/${wd} Base${d>=6?' Whole':''}.stl`,1,'base',"底座");}
 function wheels(n){for(const [p,role] of [['Bushing.stl','bushing'],['Disk.stl','wheel-disk'],['Tyre (TPU).stl','tpu-tire'],['Cover.stl','wheel-cover']])addMod('Wheels/'+p,n,role,"当前方案配套件。");hw(r,'M4 × 25 mm',n===null?null:6*n,"当前方案配套件。",'');hw(r,'6205ZZ 25×52×15 mm',n,"当前方案配套件。",'');const od=c.stopperOuterDiameter;if(![30,35].includes(Number(od)))need(r,'stopperOuterDiameter',"止动环外径存在 30/35 毫米两种记录，请按实物选择。",[30,35]);hw(r,`SCSAW d16 × D${od||"待确认"} × 10 mm`,n,"止动环外径存在 30/35 毫米两种记录，请按实物选择。",'');if(c.jig===true)addMod('Wheels/Jig.stl',1,'assembly-tool',"打印支撑或装配工具，不作为成品结构件。");}
 function foot(n=1){addMod(`Feet/${w} Feet.stl`,n,'foot',"当前方案配套件。");hw(r,'M6 × 90 mm',n===null?null:2*n,"当前方案配套件。",'');}
 function customHardware(specKey,qtyKey,note){const spec=typeof c[specKey]==='string'&&c[specKey].trim()?c[specKey]:null;if(!spec)need(r,specKey,note+"当前方案配套件。");hw(r,spec||"待确认",amount(qtyKey,undefined),note,source);}
 switch(family){
 case 'base':base();break;
 case 'wheels':wheels(amount());break;
 case 'mobileBase':base();if(r.errors.length)break;wheels(2);foot();hw(r,`M16 rod × ${{XL:504,L:414,M:338,S:248}[w]} mm`,1,"底座通轴",'');r.warnings.push("请核对附件与宿主模块的接口。");break;
 case 'casters':base();if(r.errors.length)break;hw(r,"M8 外购脚轮",4,"当前方案配套件。",'');if(!Number.isFinite(Number(c.casterBoltLength))||Number(c.casterBoltLength)<=0)need(r,'casterBoltLength',"请填写实测长度，单位为毫米。");hw(r,`M8 × ${c.casterBoltLength||"待确认"} mm`,4,"当前方案配套件。",'');break;
 case 'feet':requireW();foot(amount());break;
 case 'backbone':{const v=choose(r,c,'variant','width',['width','universal']);if(v==='width')requireW();if(!['1F','2F'].includes(h)||(v==='width'&&w==='XL'&&h!=='1F')){r.errors.push("此宽度没有所选层高的背板。");break;}const q=amount('qty',v==='universal'?undefined:1);addMod('Backbone/'+(v==='universal'?'Universal ':w)+h+' Backbone.stl',q,'backbone',"当前方案配套件。");let per=v==='universal'?amount('fastenersPerBoard',undefined):4;const len=Number(c.boltLength);if(!Number.isFinite(len)||len<60||len>100)need(r,'boltLength',"请填写实测长度，单位为毫米。");hw(r,`M4 × ${c.boltLength||"待确认"} mm`,q===null||per===null?null:q*per,"数量需按当前安装布局确认。");r.warnings.push("背板固定孔位需按实际连接位置选择。");break;}
 case 'moduleConnector':if(!['1F','2F'].includes(h)){r.errors.push("此附件不支持所选尺寸或布局。");break;}addMod(`Backbone/Connector for Modules ${h}.stl`,amount('qty',undefined),'module-connector',"数量需按当前安装布局确认。");customHardware('fastenerSpec','fastenerQty',"当前方案所需外购五金。");break;
 case 'baseConnector':addMod('Base/Base Connector.stl',amount('qty',undefined),'base-connector',"数量需按当前安装布局确认。");customHardware('fastenerSpec','fastenerQty',"当前方案所需外购五金。");break;
 case 'stationaryHandle':{requireW();const q=amount();addMod(`Stationary Handle/${w} Stationary Handle.stl`,q,'stationary-handle',"背板");hw(r,'M4 × 60 mm',q===null?null:8*q,"提手",'');confirmedBackbone();break;}
 case 'pullOutHandle':{requireW();addMod(`Pull-out Handle/${w} Pull-out Handle.stl`,1,'pullout-handle',"当前方案配套件。");const v=choose(r,c,'lockVariant','width',['width','universal']);const q=v==='universal'?amount('lockQty',undefined):1;addMod('Backbone/'+(v==='universal'?'Universal':w)+' Pull-out Handle Lock.stl',q,'handle-lock',"当前方案配套件。");if(w==='S'&&v==='width')addMod('Backbone/S Pull-out Handle Lock Part 2.stl',explicitCount(r,c,'sLockPart2Qty'),'handle-lock-second',"S 锁座第二部分的份数与安装位置需另行确认。");for(const n of [1,2])addMod(`Backbone/Handle Lock Knob Part ${n}.stl`,2,'handle-knob',"当前方案配套件。");const len=Number(c.rodLength);if(!Number.isFinite(len)||len<=0)need(r,'rodLength',"请填写实测长度，单位为毫米。");hw(r,`M16 rod × ${c.rodLength||"待确认"} mm`,2,"当前方案配套件。",'');hw(r,'M6 × 30 mm',4,"提手",'');hw(r,'M6×8×8 heat insert',2,"提手",'');let t=c.lockBoltThread;if(!['M4','M6'].includes(t))need(r,'lockBoltThread',"请核对锁紧螺栓的 M4/M6 螺纹与嵌件是否匹配。",['M4','M6']);if(t==='M4'&&c.threadsVerified!==true)need(r,'threadsVerified',"请核对锁紧螺栓的 M4/M6 螺纹与嵌件是否匹配。",[true]);hw(r,`${t||"待确认"} × 35 mm hex`,2,"请核对锁紧螺栓的 M4/M6 螺纹与嵌件是否匹配。",'');r.warnings.push("请核对立杆端部连接方式与五金螺纹。");confirmedBackbone();break;}
 case 'pegboard':{requireW();if(!['1F','2F'].includes(h)||(w==='XL'&&h!=='1F')){r.errors.push("此附件不支持所选尺寸或布局。");break;}const standard=choose(r,c,'standard',undefined,['IKEA','USSA']);if(standard)addMod('Pegboard Attachment/'+(standard==='IKEA'?'IKEA Skadis Pegboard':'USSA Pegboard')+'/'+w+h+'.stl',amount('qty',undefined),'pegboard-attachment',"数量需按当前安装布局确认。");const boards=amount('boardCount',undefined);hw(r,(standard||"待确认")+" 洞洞板",boards,"当前方案配套件。",'');hw(r,'M4 × 40 mm',boards===null?null:boards*4,"数量需按当前安装布局确认。",'');confirmedBackbone();break;}
 case 'wallMount':{requireW();if(!['1F','2F','4F'].includes(h)||(w==='XL'&&h!=='1F')){r.errors.push("目录中没有匹配零件。");break;}const q=amount();addMod(`Wall Mounts/${w}${h} Wall Mount.stl`,q,'wall-mount',"当前方案配套件。");addMod('Wall Mounts/Wall Mount Second Part.stl',q,'wall-mount-second',"当前方案配套件。");choose(r,c,'mountingSystem',undefined,['anchors','screws']);customHardware('moduleFastenerSpec','moduleFastenerQty',"当前方案所需外购五金。");customHardware('wallFastenerSpec','wallFastenerQty',"当前方案配套件。");r.warnings.push("安装位置与接口配合尚待核对。");break;}
 case 'underTableMount':{const ds=dims(r,c);w=ds.w;wd=ds.wd;const p=files.find(x=>x.name===wd+' Under Table Mount Roof.stl');if(p)add(r,p.id,amount(),'under-table-roof',"顶盖",'');else r.errors.push("目录中没有匹配零件。");choose(r,c,'mountingSystem',undefined,['screws','inserts']);customHardware('fastenerSpec','fastenerQty',"当前方案所需外购五金。");r.warnings.push("请核对桌板固定方式及顶盖接口。");break;}
 }
 r.title=[option.title,c.w?(c.w+(c.d===undefined?'':c.d)):'',c.h||'',c.form==='split'?"当前方案配套件。":'',c.standard||'',c.variant==='universal'?"当前方案配套件。":''].filter(Boolean).join(' · ');r.titles=[r.title];
 r.constraints={geometryVerified:false,nominalHeightDoesNotProveEqualPhysicalHeight:true};return done(r);
}
const api={sustainerOptions,modificationOptions,buildSustainer,buildModification};return api;
}

const extension = createExtensionRules(catalog);
extension.drawerBuilder = config => {const bom=buildBOM({...config,kind:'drawer'});return {...bom,rows:bom.rows.map(r=>({...r,item:byId[r.id],note:r.reason}))};};
const field = (key,type,choices,extra={}) => ({key,type,label:title(key),purpose:purpose(key),...(choices?{choices}:{}),...extra});
const drawerInputs = [field('w','enum',['S','M','L','XL']),field('d','enum',[3,4,5,6,7]),field('h','enum',['1F','2F','4F']),field('key','enum',['standard','hidden']),field('roof','enum',['none','Grid Roof','Table Roof','Bowl Roof','Under Table Mount Roof','Heawyweight Roof']),field('rails','boolean',undefined,{default:true,label:'齿条（建议添加）'}),field('fullRunners','boolean',undefined,{default:false}),...['label','baseplate','handle'].map(k=>field(k,'boolean'))];
const inputView = f => {
 const type=['enum','boolean','integer','number','string','object'].includes(f.type)?f.type:'string';
 const result={key:f.key,type,label:title(f.key),purpose:purpose(f.key),...(Array.isArray(f.choices)?{choices:[...f.choices]}:{}),...Object.fromEntries(['required','min','max'].filter(k=>f[k]!==undefined).map(k=>[k,f[k]]))};
 const validDefault=f.default!==undefined&&(type==='enum'?result.choices?.includes(f.default):type==='boolean'?typeof f.default==='boolean':type==='integer'?Number.isSafeInteger(f.default):type==='number'?Number.isFinite(f.default):type==='object'?f.default!==null&&typeof f.default==='object':typeof f.default==='string');
 if(validDefault)result.default=f.default;
 return result;
};
export const sustainerOptions = extension.sustainerOptions.map(o=>({id:o.id,optionId:o.id,w:o.w,d:o.d,h:o.h,interior:o.interior,type:o.type,title:o.w+o.d+' '+o.h+' '+({standard:'标准内腔',flat:'平底内腔',dividers:'分隔板内腔',sealed:'封闭分区'})[o.interior],inputs:o.inputs.map(inputView)}));
export const modificationOptions = extension.modificationOptions.map(o=>({id:o.id,family:o.id,title:title(o.id),purpose:({trolley:'组合抽屉塔、底座、轮组与伸缩拉手。',base:'选择塔体底部的承托件。',wheels:'配置独立打印轮组。',mobileBase:'组合底座、双轮与支脚。',casters:'采用四只外购脚轮。',feet:'按宽度配置支脚。',backbone:'连接模块与底座或相邻层。',moduleConnector:'按实际位置配置模块连接件。',baseConnector:'连接分体底座。',pullOutHandle:'配置锁座、旋钮、立杆与握把。',stationaryHandle:'配置背板上的固定提手。',pegboard:'选择洞洞板制式与连接件。',wallMount:'配置模块侧与墙侧安装件。',underTableMount:'配置桌底安装顶盖与固定五金。'})[o.id],inputs:o.inputs.map(inputView),variants:o.variants.map(v=>({id:v.id,name:v.name,title:byId[v.id]?.zh||v.name})),...(o.defaults?{defaults:{...o.defaults}}:{})}));
export const configurationOptions = {drawer:{inputs:drawerInputs},sustainer:{inputs:[field('w','enum',['S','M','L','XL']),field('d','enum',[3,4,5,6,7]),field('h','enum',['1F','2F','4F']),field('interior','enum',['standard','flat','dividers','sealed']),...(sustainerOptions[0]?.inputs||[])],variants:sustainerOptions},mods:{variants:modificationOptions}};
export function defaults(kind='drawer') {
 if(kind==='sustainer')return {kind,w:'L',d:'3',h:'1F',interior:'flat',roof:'whole',facade:'family',label:'none',baseplate:false,dividerLayout:'none',dividers:{},lockCount:2};
 if(kind==='mods'||modificationOptions.some(o=>o.id===kind))return {kind:'mods',family:kind==='mods'?'trolley':kind,w:'L',d:'3',towerLayers:3};
 if(kind!=='drawer')throw new RangeError('未知配置类型：'+String(kind));
 return {kind:'drawer',w:'S',d:'3',h:'1F',key:'standard',roof:'Grid Roof',rails:true,fullRunners:false,label:true,baseplate:false,handle:false};
}
export function normalizeConfig(input={}) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError("配置应为对象。");
 const kind=input.kind || (input.family?'mods':'drawer');
 const opt=kind==='sustainer'&&input.optionId?sustainerOptions.find(o=>o.id===input.optionId):null;
 const requested=kind==='mods'?(input.family||input.optionId||input.type||'mods'):kind;
 const recognized=kind==='mods'?(requested==='mods'||modificationOptions.some(o=>o.id===requested)):['drawer','sustainer'].includes(kind);
 const base=recognized?defaults(requested):{};
 // Option-id dimensions take precedence over defaults, but not explicit conflicting inputs.
 const result={...base,...(opt?{w:opt.w,d:opt.d,h:opt.h,interior:opt.interior}:{}),...input,kind};
 if(kind==='sustainer'&&input.lockCount===undefined)result.lockCount=sustainerLockCount(result.w);
 if(input.type!==undefined&&kind==='sustainer'&&input.interior===undefined)result.interior=input.type;
 if(kind==='drawer'&&input.rails===undefined)result.rails=result.key==='standard';
 if(result.d!==undefined)result.d=String(result.d);
 return result;
}
function roleFor(item){const n=item.name,p=item.old;if(p.includes('/Modules/'))return 'body';if(/Back Panel/.test(n))return 'back-panel';if(p.includes('/Boxes/'))return 'box';if(/Runner Guide/.test(n))return 'runner-guide';if(/Runner Slide/.test(n))return 'runner-slide';if(/Runner Stopper/.test(n))return 'runner-stopper';if(/ Rails/.test(n))return 'geared-rails';if(/Springs/.test(n))return 'springs';if(/Baseplate/.test(n))return 'baseplate';if(p.includes('/Roofs/'))return 'roof';if(/Facade Cap/.test(n))return 'facade-cap';if((/Facade/.test(n)&&!/Cap/.test(n))||p.includes('/Facades/'))return 'facade';if(/Key Cap/.test(n))return 'key-cap';if(/Key/.test(n))return 'key';if(/Label/.test(n))return 'label';if(/Latch/.test(n))return 'latch';if(/Handle/.test(n))return 'handle';if(/Insert/.test(n))return 'roof-insert';return 'accessory';}
const roleReasons={"back-panel":"封闭 XL 抽屉盒后部开口，配套后面板一份。","body":"按所选尺寸配置外壳。","box":"抽屉盒文件按份数打印，分体型号需配齐各部分。","facade":"配置与尺寸相符的前面板。","runner-guide":"左右导向件各一份。","runner-slide":"左右滑动件各一份。","runner-stopper":"左右止挡各一份。","geared-rails":"一份 STL 含一对齿条，建议用于齿轮传动。","springs":"一份 STL 含两只弹簧。","key-cap":"钥匙配套端帽。","facade-cap":"面板配套端盖。","key":"按所选钥匙方案配齐零件。","latch":"模块配套锁扣。","label":"按需添加标签片。","baseplate":"按尺寸配置底板，分体文件各打一份。","roof":"所选顶盖的配套打印件。","handle":"选配顶部提手，并补齐固定五金。","roof-insert":"重载顶盖配套嵌件。","hinge-bottom":"一份文件包含所需的一对下铰链。","hinge-top":"按宽度选配上铰链，以整份文件计数。","hinge-rods":"一份文件包含两根铰链销轴。","lock-holder":"每个锁扣配一个锁扣座。","lock-inner":"每个锁扣配一个内件。","lock-outer":"按层高选配锁扣外件。","lock-pins":"每个锁扣配一套销钉文件。","split-roof-connector":"按连接位置填写顶盖连接件份数。","divider":"按自定义分区填写打印份数。","base":"按宽深选择底座，分体方案需配齐两部分。","base-connector":"按分体底座连接位置配置。","bushing":"每只打印轮配一个轴套。","wheel-disk":"每只轮配一个轮盘。","tpu-tire":"每只轮配一个 TPU 轮胎。","wheel-cover":"每只轮配一个轮盖。","assembly-tool":"装配定位工具，完成后取下。","foot":"按宽度选择支脚。","backbone":"按所选连接处配置背板。","module-connector":"按实际模块连接位置填写份数。","stationary-handle":"固定提手需另配背板与五金。","pullout-handle":"顶部握把需配合两根外购立杆。","handle-lock":"按宽度或通用方案配置拉手锁座。","handle-lock-second":"S 专用锁座第二部分，份数需明确填写。","handle-knob":"两根立杆各配一套两件式旋钮。","pegboard-attachment":"按洞洞板制式和布局配置连接件。","wall-mount":"模块侧壁挂件，与墙侧件配套。","wall-mount-second":"每个安装位置配一个墙侧件。","under-table-roof":"按尺寸选配桌底安装顶盖。","host-drawer":"所选抽屉塔各层的打印件合计。","accessory":"当前方案的配套打印件。"};
function reasonFor(role){return roleReasons[role]||'当前方案的配套打印件。';}
function empty(errors=[]){return {rows:[],hardware:[],errors,warnings:[],missing:[],needsInput:[],complete:false};}
export function buildBOM(input={}) {
 if(!input||typeof input!=='object'||Array.isArray(input))return empty(["配置应为对象。"]);
 const c=normalizeConfig(input);
 if(c.kind==='drawer'&&typeof c.fullRunners!=='boolean')return empty(['满滑轨必须为开或关。']);
 if(c.kind==='drawer'&&c.fullRunners){
  const bom=buildBOM({...c,fullRunners:false});
  return {...bom,rows:bom.rows.map(row=>runnerRoles.has(row.role)?{...row,qty:2*drawerHeight(c.h),reason:`满滑轨 · 外框 ${drawerHeight(c.h)} 个层位各配左右一份。`}:row)};
 }
 if(c.kind==='drawer'&&c.drawers!==undefined){
  const problem=drawerLayoutProblem(c);if(problem)return empty([problem]);
  const hostConfig={...c};delete hostConfig.drawers;
  const host=buildBOM(hostConfig);if(host.errors.length||host.missing.length)return host;
  const rows=new Map(),hardware=new Map(),warnings=[...host.warnings],missing=[],errors=[];
  const add=row=>{const old=rows.get(row.id);if(old){old.qty+=row.qty;old.required ||= row.required!==false;}else rows.set(row.id,{...row});};
  const addHardware=h=>{const key=JSON.stringify([h.spec,h.role]);if(hardware.has(key))hardware.get(key).qty+=h.qty;else hardware.set(key,{...h});};
  for(const row of host.rows)if(frameRoles.has(row.role))add({...row,reason:'外框共用 · '+row.reason});
  for(const h of host.hardware)if(h.role!=='facade-fastener')addHardware(h);
  const drawerSlots=c.drawers.map((h,index)=>{
   const child=buildBOM({...hostConfig,h,roof:'none',handle:false});errors.push(...child.errors);missing.push(...child.missing);warnings.push(...child.warnings);
   const childRows=child.rows.filter(r=>!frameRoles.has(r.role));
   for(const row of childRows)add({...row,reason:`框内第 ${index+1} 个 ${h} 抽屉 · `+row.reason});
   child.hardware.forEach(addHardware);return {index,h,rows:childRows};
  });
  for(const row of rows.values())if(drawerSlots.filter(s=>s.rows.some(r=>r.id===row.id)).length>1)row.reason='多个框内抽屉合计，按完整 STL 文件计份。 '+row.reason;
  return {rows:[...rows.values()],hardware:[...hardware.values()],errors:[...new Set(errors)],missing:[...new Set(missing)],warnings:[...new Set(warnings)],needsInput:[],complete:!errors.length&&!missing.length,drawerSlots};
 }
 if(!['drawer','sustainer','mods'].includes(c.kind))return empty(["未知配置类型。"]);
 if(c.kind==='drawer'){
  const errors=[];
  if(!['S','M','L','XL'].includes(c.w)||!['3','4','5','6','7'].includes(c.d)||!['1F','2F','4F'].includes(c.h)||(c.w==='XL'&&c.h!=='1F'))errors.push("不支持此抽屉尺寸组合。");
  if(!['standard','hidden'].includes(c.key))errors.push("请选择标准钥匙或隐藏钥匙。");
  if(!drawerInputs.find(f=>f.key==='roof').choices.includes(c.roof)||(c.roof==='Heawyweight Roof'&&!['L','XL'].includes(c.w)))errors.push("此尺寸不支持所选顶盖。");
  for(const k of ['rails','label','baseplate','handle'])if(typeof c[k]!=='boolean')errors.push(title(k)+'必须为开或关。');
  if(errors.length)return empty(errors);
  const b=drawerFiles(c),rows=b.rows.map(r=>{const role=roleFor(r.item);return {id:r.item.id,qty:r.qty,required:r.required,role,reason:reasonFor(role)};});
  const hardware=[{spec:'M4 × 14 mm',name:'M4 × 14 mm',qty:c.h==='1F'?4:6,role:'facade-fastener'}];
  if(c.handle)hardware.push({spec:'M6 × 50 mm',name:'M6 × 50 mm',qty:2,role:'top-handle-fastener'});
  const warnings=[];
  if(c.key==='standard'&&!c.rails)warnings.push("标准钥匙建议配合齿条使用；当前已选择不加齿条。");
  if(c.roof==='Heawyweight Roof')warnings.push("重载顶盖的固定五金需按实际方案确认。");
  return {rows,hardware,errors:[],warnings,missing:b.missing,needsInput:[],complete:!b.missing.length};
 }
 const raw=c.kind==='sustainer'?extension.buildSustainer(c):extension.buildModification(c);
 const rows=raw.bom.map(r=>({id:r.id,qty:r.qty,required:r.required!==false,role:r.role,reason:reasonFor(r.role)}));
 const hardware=raw.hardware.map(h=>({spec:h.spec,name:h.name,qty:h.qty,note:h.note,...(h.role?{role:h.role}:{}),...(h.qtyInput?{qtyInput:h.qtyInput}:{}),...(h.lengthInput?{lengthInput:h.lengthInput}:{})}));
 const result={rows,hardware,errors:[...raw.errors],warnings:[...new Set(raw.warnings)],missing:[...raw.missing],needsInput:raw.needsInput.map(n=>({...n})),complete:raw.complete};
 for(const k of ['hostModules','hostBOMs','connections','constraints'])if(raw[k]!==undefined)result[k]=structuredClone(raw[k]);
 if(result.connections)result.connections=result.connections.map(({source,...edge})=>edge);
 if(result.constraints)delete result.constraints.stackingSource;
 return result;
}
