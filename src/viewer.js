import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import frames from './assembly-data.json' with {type:'json'};
import {separateRectangles,easeInOut} from './viewer-layout.js';
import {buildScene} from './assembly.js';
import {createSourceKey,assembledThumbnailKey,ThumbnailQueue} from './navigation.js';
import {frameCorners,interpolateRigid} from './rigid-preview.js';

const worker=new Worker(new URL('./mesh-worker.js',import.meta.url),{type:'module'});
const pending=new Map(),cache=new Map(),pins=new Map(),viewers=new Set();let sequence=0,epoch=0,tail=Promise.resolve();
const sourceKey=createSourceKey();
function pin(ids,change){for(const id of ids){const count=Math.max(0,(pins.get(id)||0)+change);if(count)pins.set(id,count);else pins.delete(id);}}
function disposeGeometry(v){for(const g of new Set([...v.geometries,...(v.alignedGeometries||[])]))g.dispose();}
function trimCache(){for(const [id,promise]of cache){if(cache.size<=36)break;if(pins.get(id))continue;cache.delete(id);promise.then(disposeGeometry).catch(()=>{});}}
worker.onmessage=({data})=>{const p=pending.get(data.key);if(!p)return;pending.delete(data.key);data.error?p.reject(Error(data.error)):p.resolve(data);};
worker.onerror=()=>{for(const p of pending.values())p.reject(Error('模型解析失败'));pending.clear();};
export function clearGeometry(){epoch++;for(const v of viewers)v.clear();for(const r of cache.values())r.then(disposeGeometry).catch(()=>{});cache.clear();}
export function geometryFor(id,file,variant=null){
  if(!file)return Promise.reject(Error('请先导入此零件'));
  const cacheKey=sourceKey(id,file,variant);
  if(cache.has(cacheKey)){const p=cache.get(cacheKey);cache.delete(cacheKey);cache.set(cacheKey,p);return p;}
  const currentEpoch=epoch;
  const promise=tail.then(async()=>{
    if(epoch!==currentEpoch)throw Error('模型目录已切换');
    const buffer=await file.arrayBuffer(); const key=++sequence;
    const data=await new Promise((resolve,reject)=>{pending.set(key,{resolve,reject});worker.postMessage({key,buffer,frames:variant?.sourceFrames||frames[id]||[]},[buffer]);});
    if(epoch!==currentEpoch)throw Error('模型目录已切换');
    const geometries=data.parts.map(p=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;});
    const alignedGeometries=variant?.previewAligned&&data.resolved?geometries.map((g,i)=>{const t=variant.transforms?.[i];if(!t)return g;const r=t.rotation,v=t.translation;return g.clone().applyMatrix4(new THREE.Matrix4().set(r[0][0],r[0][1],r[0][2],v[0],r[1][0],r[1][1],r[1][2],v[1],r[2][0],r[2][1],r[2][2],v[2],0,0,0,1));}):geometries;
    return {...data,parts:undefined,geometries,alignedGeometries};
  });
  tail=promise.catch(()=>{});cache.set(cacheKey,promise);promise.catch(()=>{if(cache.get(cacheKey)===promise)cache.delete(cacheKey);});
  return promise;
}
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
function matrixFor(p){
  const {matrix:r,center:c,min}=p.cal;
  const t=p.position.map((v,i)=>v-min[i]-r[i].reduce((a,x,j)=>a+x*c[j],0));
  let m=new THREE.Matrix4().set(r[0][0],r[0][1],r[0][2],t[0],r[1][0],r[1][1],r[1][2],t[1],r[2][0],r[2][1],r[2][2],t[2],0,0,0,1);
  if(p.hinge){const v=p.hinge.pivot;const h=new THREE.Matrix4().makeTranslation(...v).multiply(new THREE.Matrix4().makeRotationX(p.hinge.angle)).multiply(new THREE.Matrix4().makeTranslation(...v.map(n=>-n)));m.premultiply(h);}
  m.premultiply(new THREE.Matrix4().makeTranslation(...(p.move||[0,0,0])));return m;
}
export class Viewer {
  constructor(canvas,{onSelect=()=>{},onStatus=()=>{}}={}){
    this.canvas=canvas;this.onSelect=onSelect;this.onStatus=onStatus;this.meshes=[];this.ticket=0;this.selected=null;this.mode='assembled';this.pinned=[];this.printStates={};this.ghostPrinted=true;this.selectedKeys=new Set();this.cameraMotion=null;this.resizeFrame=0;
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true});
    viewers.add(this);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.85;
    this.scene=new THREE.Scene();this.group=new THREE.Group();this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(0xffedd9,0x424951,1.8));
    for(const [color,intensity,pos] of [[0xffffff,3,[150,-100,350]],[0xff823d,1.3,[-250,200,150]],[0xb5dbff,2,[0,300,250]]]){const l=new THREE.DirectionalLight(color,intensity);l.position.set(...pos);this.scene.add(l);}
    this.camera=new THREE.PerspectiveCamera(35,1,.1,100000);this.camera.up.set(0,0,1);this.camera.position.set(400,500,350);
    this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.09;this.controls.minDistance=5;this.controls.maxDistance=10000;
    this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    canvas.addEventListener('pointerdown',e=>this.down=[e.clientX,e.clientY]);
    canvas.addEventListener('pointerup',e=>{if(!this.down||Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1])>5)return;const b=canvas.getBoundingClientRect();this.pointer.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);const hit=this.ray.intersectObjects(this.meshes).find(x=>x.object.visible);if(hit){this.select(hit.object.userData.key);this.onSelect(hit.object.userData);}});
    canvas.addEventListener('dblclick',()=>this.fit());
    this.controls.addEventListener('start',()=>{this.cameraMotion=null;});
    this.resize=new ResizeObserver(()=>{cancelAnimationFrame(this.resizeFrame);this.resizeFrame=requestAnimationFrame(()=>{const b=canvas.getBoundingClientRect(),w=Math.round(b.width),h=Math.round(b.height);if(!w||!h||this.lastWidth===w&&this.lastHeight===h)return;const previousAspect=this.camera.aspect;this.lastWidth=w;this.lastHeight=h;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();if(this.meshes.length&&Math.abs(Math.log(previousAspect/this.camera.aspect))>.15)this.fit({animate:false,preserveDirection:true});});});this.resize.observe(canvas);
    this.renderer.setAnimationLoop(()=>this.tick());
  }
  tick(){
    if(!this.canvas.getClientRects().length)return;const now=performance.now();let moving=false;
    const operation=this.operation;
    if(operation){
      const t=reduced.matches?1:Math.min(1,(now-operation.start)/operation.duration);
      operation.value=operation.from+(operation.to-operation.from)*easeInOut(t);
      const parts=new Map(operation.at(operation.value).parts.map(p=>[p.key||`${p.id}:${p.copy||0}:${p.component||0}`,p]));
      for(const m of this.meshes){const p=parts.get(m.userData.key);if(!p||m.userData.unresolved)continue;Object.assign(m.userData,p);const matrix=matrixFor(p);matrix.decompose(m.position,m.quaternion,new THREE.Vector3());m.userData.motion=null;}
      if(t===1)this.operation=null;else moving=true;
    }
    for(const m of this.meshes){const motion=m.userData.motion;if(motion){const t=reduced.matches?1:Math.min(1,(now-motion.start)/motion.duration),a=easeInOut(t);interpolateRigid(motion,m.userData.target,m.geometry.boundingSphere.center,a,m.position,m.quaternion);if(t===1)m.userData.motion=null;else moving=true;}
      const opacity=m.userData.opacityTarget??1;const fade=m.userData.fadeStart;if(fade!==undefined){const a=reduced.matches?1:Math.min(1,(now-fade)/500);m.material.opacity=opacity*a;if(a===1)delete m.userData.fadeStart;else moving=true;}else m.material.opacity+=(opacity-m.material.opacity)*.2;
    }
    if(this.cameraMotion){const c=this.cameraMotion,t=reduced.matches?1:Math.min(1,(now-c.start)/650),a=easeInOut(t);this.camera.position.lerpVectors(c.from,c.to,a);this.controls.target.lerpVectors(c.fromTarget,c.toTarget,a);if(t===1)this.cameraMotion=null;else moving=true;}
    this.canvas.dataset.animating=String(moving);this.controls.update();this.updateOutline();this.renderer.render(this.scene,this.camera);
  }
  async setScene(scene,matches,{mode=this.mode,fit=true,animate=true,colors={},raw=false}={}){
    this.operation=null;
    const ticket=++this.ticket;this.mode=mode;this.descriptors=scene.parts||[];
    this.canvas.setAttribute('aria-busy','true');this.canvas.dataset.modelCount='0';
    this.onStatus('正在读取本地模型…');
    const ids=[...new Set(this.descriptors.map(p=>p.id))],keys=ids.filter(id=>matches.has(id)).map(id=>sourceKey(id,matches.get(id).file,matches.get(id).variant));
    pin(keys,1);let transferred=false;const loaded=new Map(),warnings=[];
    try{
    for(const id of ids){if(ticket!==this.ticket)return;try{if(matches.has(id)){const match=matches.get(id);loaded.set(id,await geometryFor(id,match.file,match.variant));}}catch(e){warnings.push(id+'：'+e.message);}}
    if(ticket!==this.ticket)return;
    const previous=new Map(this.meshes.map(m=>[m.userData.key,{position:m.position.clone(),quaternion:m.quaternion.clone()}]));
    this.group.clear();for(const m of this.meshes)m.material.dispose();for(const m of this.rods||[]){m.geometry.dispose();m.material.dispose();}this.rods=[];this.meshes=[];
    pin(this.pinned,-1);this.pinned=keys;transferred=true;
    const unresolved=new Set();
    for(const p of this.descriptors){
      const data=loaded.get(p.id);if(!data)continue;
      const match=matches.get(p.id),variant=match?.variant;
      const component=!raw&&variant?.referencePiecesPerFile===1&&variant.piecesPerFile>1?(p.copy||0)%variant.piecesPerFile:p.component||0;
      if(!data.resolved&&component>0)continue;
      const geometries=raw?data.geometries:data.alignedGeometries;
      let g=geometries[component]||geometries[0];
      const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:new THREE.Color(...(p.color||[.65,.66,.66])),roughness:.43,metalness:.16,side:THREE.DoubleSide}));
      const key=p.key||`${p.id}:${p.copy||0}:${p.component||0}`;
      m.userData={...p,key,unresolved:!raw&&(!data.resolved||!!match?.manual||!!variant&&!variant.previewAligned),baseColor:colors[key]||colors[`${p.id}:${p.copy||0}:${p.component||0}`]||null};
      if(m.userData.baseColor)m.material.color.set(m.userData.baseColor);
      m.userData.originalColor=m.material.color.clone();
      if(m.userData.unresolved)unresolved.add(p.id);
      this.group.add(m);this.meshes.push(m);
    }
    for(const rod of scene.referenceRods||[]){const start=new THREE.Vector3(...rod.start),end=new THREE.Vector3(...rod.end),direction=end.clone().sub(start);if(!direction.length())continue;const m=new THREE.Mesh(new THREE.CylinderGeometry(rod.radius,rod.radius,direction.length(),16),new THREE.MeshStandardMaterial({color:0x6f7b81,metalness:.6,roughness:.45,transparent:true,opacity:.55}));m.position.copy(start).add(end).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());this.group.add(m);this.rods.push(m);}
    this.layout(mode,true);
    if(animate&&previous.size&&!reduced.matches){for(const m of this.meshes){const old=previous.get(m.userData.key);if(old){m.position.copy(old.position);m.quaternion.copy(old.quaternion);}else{m.position.z+=45;m.material.transparent=true;m.material.opacity=0;m.userData.fadeStart=performance.now();}this.startMotion(m);}}
    this.setPrintedState(this.printStates,{ghost:this.ghostPrinted});this.selectKeys([...this.selectedKeys]);if(fit)this.fit({animate:animate&&previous.size>0});trimCache();
    this.canvas.dataset.modelCount=String(this.meshes.length);this.canvas.setAttribute('aria-busy','false');
    const missing=ids.length-loaded.size,simplified=[...loaded.values()].some(x=>x.simplified);
    this.onStatus(`${this.meshes.length} 个模型实例 · 原尺寸${simplified?' · 密集网格已简化预览':''}${missing?` · 缺 ${missing} 类文件`:''}${unresolved.size?' · '+unresolved.size+' 类位置待核对':''}${warnings.length?' · '+warnings[0]:''}`);
    }finally{if(!transferred)pin(keys,-1);trimCache();}
  }
  layout(mode=this.mode,immediate=false){
    for(const rod of this.rods||[])rod.visible=mode!=='flat';
    this.mode=mode;let x=mode==='flat'?0:500,y=0,rowDepth=0;const area=Math.max(220,Math.sqrt(this.meshes.reduce((s,m)=>{const a=m.userData.cal.size;return s+(a[0]+30)*(a[1]+30)},0))*1.35)+(mode==='flat'?0:500);
    for(const m of this.meshes){const p=m.userData;let matrix;
      if(mode==='flat'||p.unresolved){
        const box=m.geometry.boundingBox,s=box.getSize(new THREE.Vector3());if(x+s.x>area&&x){x=mode==='flat'?0:500;y+=rowDepth+35;rowDepth=0;}
        matrix=new THREE.Matrix4().makeTranslation(x-box.min.x,y-box.min.y,-box.min.z);x+=s.x+30;rowDepth=Math.max(rowDepth,s.y);
      }else matrix=matrixFor(p);
      const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,quaternion,scale);m.userData.target={position,quaternion};
      // Rigid transforms only. Never rescale imported meshes.
    }
    if(mode==='exploded')this.spaceExploded();
    for(const m of this.meshes){if(immediate){m.position.copy(m.userData.target.position);m.quaternion.copy(m.userData.target.quaternion);m.userData.motion=null;}else this.startMotion(m);m.updateMatrixWorld();}
  }
  startMotion(m){m.userData.motion={position:m.position.clone(),quaternion:m.quaternion.clone(),start:performance.now(),duration:720};}
  sourceCorners(m){if(this.mode!=='flat'&&!m.userData.unresolved)return frameCorners(m.userData.cal);const b=m.geometry.boundingBox;return Array.from({length:8},(_,i)=>new THREE.Vector3(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z));}
  targetBox(m){const matrix=new THREE.Matrix4().compose(m.userData.target.position,m.userData.target.quaternion,new THREE.Vector3(1,1,1));return new THREE.Box3().setFromPoints(this.sourceCorners(m).map(v=>v.applyMatrix4(matrix)));}
  spaceExploded(){
    const right=new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion);
    const rectangles=this.meshes.map(m=>{const b=this.targetBox(m),xs=[],ys=[];for(let i=0;i<8;i++){const v=new THREE.Vector3(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z);xs.push(v.dot(right));ys.push(v.dot(up));}return {key:m.userData.key,x:(Math.max(...xs)+Math.min(...xs))/2,y:(Math.max(...ys)+Math.min(...ys))/2,width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};});
    const offsets=separateRectangles(rectangles,12);for(const m of this.meshes){const d=offsets.get(m.userData.key);m.userData.target.position.addScaledVector(right,d.x).addScaledVector(up,d.y);}
  }
  update(scene,mode=this.mode,{operation=null}={}){
    const from=this.operation?.value??operation?.from;this.operation=null;
    const byKey=new Map((scene.parts||[]).map(p=>[p.key||`${p.id}:${p.copy||0}:${p.component||0}`,p]));
    const changed=mode!==this.mode;for(const m of this.meshes){const p=byKey.get(m.userData.key);if(p)Object.assign(m.userData,p);}this.layout(mode);if(changed)this.fit({animate:true,preserveDirection:true});
    // Opening is an articulated mechanism, not a straight-line mesh transition.
    // Keep the final targets for camera framing, but sample the actual joints
    // each frame. Reversing uses the current amount, not the previous endpoint.
    if(operation&&mode==='assembled'&&!changed&&!reduced.matches){
      this.operation={...operation,from,value:from,start:performance.now(),duration:1100*Math.max(.15,Math.abs(operation.to-from))};
      for(const m of this.meshes)if(!m.userData.unresolved)m.userData.motion=null;
    }else if(operation&&reduced.matches)this.layout(mode,true);
  }
  fitIfNeeded(){
    this.camera.updateMatrixWorld();
    for(const m of this.meshes){
      const matrix=new THREE.Matrix4().compose(m.userData.target.position,m.userData.target.quaternion,new THREE.Vector3(1,1,1));
      if(this.sourceCorners(m).some(v=>{v.applyMatrix4(matrix).project(this.camera);return Math.abs(v.x)>.94||Math.abs(v.y)>.94||v.z< -1||v.z>1;})){
        this.fit({animate:true,preserveDirection:true});return true;
      }
    }
    return false;
  }
  fit({animate=true,preserveDirection=false}={}){if(!this.meshes.length)return;const box=new THREE.Box3();for(const m of this.meshes)box.union(this.targetBox(m));const center=box.getCenter(new THREE.Vector3());const direction=preserveDirection?this.camera.position.clone().sub(this.controls.target).normalize():new THREE.Vector3(1,1,.85).normalize();
    const right=new THREE.Vector3().crossVectors(this.camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right),tan=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2));let radius=20;
    for(const mesh of this.meshes){const matrix=new THREE.Matrix4().compose(mesh.userData.target.position,mesh.userData.target.quaternion,new THREE.Vector3(1,1,1));for(const corner of this.sourceCorners(mesh)){const v=corner.applyMatrix4(matrix).sub(center),z=v.dot(direction);radius=Math.max(radius,z+Math.abs(v.dot(up))/tan,z+Math.abs(v.dot(right))/(tan*this.camera.aspect));}}
    radius*=1.12;const to=center.clone().addScaledVector(direction,radius);if(animate&&!reduced.matches)this.cameraMotion={from:this.camera.position.clone(),to,fromTarget:this.controls.target.clone(),toTarget:center,start:performance.now()};else{this.cameraMotion=null;this.controls.target.copy(center);this.camera.position.copy(to);}this.camera.near=Math.max(.1,radius/1000);this.camera.far=radius*30;this.camera.updateProjectionMatrix();this.controls.update();}
  updateOutline(){if(!this.outline)return;this.outline.box.makeEmpty();for(const m of this.meshes)if(this.selectedKeys.has(m.userData.key)){m.updateMatrixWorld();for(const v of this.sourceCorners(m))this.outline.box.expandByPoint(v.applyMatrix4(m.matrixWorld));}}
  select(key){this.selected=key;this.selectKeys(key?[key]:[]);}
  selectGroup(instance){this.selectKeys(this.meshes.filter(m=>m.userData.instance===instance).map(m=>m.userData.key));}
  selectKeys(keys){this.selectedKeys=new Set(keys);if(this.outline){this.scene.remove(this.outline);this.outline.geometry.dispose();this.outline.material.dispose();this.outline=null;}for(const m of this.meshes){const selected=this.selectedKeys.has(m.userData.key);m.material.emissive.set(selected?0xff6b20:0x000000);m.material.emissiveIntensity=selected?.65:0;}if(this.meshes.some(m=>this.selectedKeys.has(m.userData.key))){this.outline=new THREE.Box3Helper(new THREE.Box3(),0xff702e);this.scene.add(this.outline);this.updateOutline();}this.canvas.style.cursor=keys.length?'pointer':'grab';}
  setPrintedState(statuses={}, {ghost=true}={}){this.printStates=statuses;this.ghostPrinted=ghost;let done=0;for(const m of this.meshes){const status=statuses[m.userData.key]||{},finished=!!status.done;done+=Number(finished);m.userData.printStatus=status;m.userData.opacityTarget=finished&&ghost?.26:1;m.material.transparent=finished&&ghost||m.userData.fadeStart!==undefined;m.material.depthWrite=!finished||!ghost;m.material.color.copy(m.userData.originalColor||new THREE.Color(.7,.7,.7));if(finished)m.material.color.lerp(new THREE.Color('#82909a'),.85);else if(status.partial)m.material.color.lerp(new THREE.Color('#ff9a40'),.3);m.material.needsUpdate=true;}this.canvas.dataset.printedCount=String(done);}
  color(key,color){this.colorMany([key],color);}
  colorMany(keys,color){const selected=new Set(keys);let changed=false;for(const m of this.meshes)if(selected.has(m.userData.key)){m.userData.originalColor=new THREE.Color(color);m.userData.baseColor=color;changed=true;}if(changed)this.setPrintedState(this.printStates,{ghost:this.ghostPrinted});}
  capture(){this.renderer.render(this.scene,this.camera);return this.canvas.toDataURL('image/webp',.75);}
  clear(){this.ticket++;this.operation=null;this.select(null);pin(this.pinned,-1);this.pinned=[];for(const m of this.meshes)m.material.dispose();for(const m of this.rods||[]){m.geometry.dispose();m.material.dispose();}this.meshes=[];this.rods=[];this.group.clear();this.canvas.dataset.modelCount='0';this.canvas.setAttribute('aria-busy','false');}
  dispose(){this.clear();viewers.delete(this);this.resize.disconnect();cancelAnimationFrame(this.resizeFrame);this.renderer.setAnimationLoop(null);this.controls.dispose();this.renderer.dispose();trimCache();}
}

let thumbnailViewer;const thumbnails=new ThumbnailQueue(48);
function getThumbnailViewer(){
  if(!thumbnailViewer){const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;thumbnailViewer=new Viewer(canvas);thumbnailViewer.resize.disconnect();thumbnailViewer.renderer.setAnimationLoop(null);thumbnailViewer.renderer.setPixelRatio(1);thumbnailViewer.renderer.setSize(240,160,false);thumbnailViewer.camera.aspect=1.5;thumbnailViewer.camera.updateProjectionMatrix();thumbnailViewer.controls.enabled=false;}
  return thumbnailViewer;
}
export function clearThumbnails(){thumbnails.clear();thumbnailViewer?.clear();trimCache();}
export function thumbnail(id,file,variant=null){
  const key=sourceKey(id,file,variant);
  return thumbnails.get('part:'+key,async valid=>{
    pin([key],1);let viewer;
    try{
      const data=await geometryFor(id,file,variant);if(!valid())throw Error('缩略图任务已取消');const box=new THREE.Box3();data.geometries.forEach(g=>box.union(g.boundingBox));const min=box.min.toArray(),max=box.max.toArray();const parts=data.geometries.map((g,component)=>({id,component,copy:0,key:`${id}:${component}`,cal:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[0,0,0],min,max,size:max.map((v,i)=>v-min[i])},position:[0,0,0],color:[.76,.78,.79]}));
      viewer=getThumbnailViewer();await viewer.setScene({parts},new Map([[id,{file,variant}]]),{mode:'assembled',animate:false,raw:true});if(!valid())throw Error('缩略图任务已取消');return viewer.capture();
    }finally{viewer?.clear();pin([key],-1);trimCache();}
  });
}
export async function moduleThumbnail(unit,matches,isCurrent=()=>true){
  const scene=buildScene({...unit.config,id:unit.id,colors:unit.colors},{open:0,explode:0,progress:Infinity});
  const ids=[...new Set(scene.parts.map(p=>p.id))],sources=ids.map(id=>{const m=matches.get(id);return [sourceKey(id,m?.file,m?.variant),!!m?.manual];});
  const key=assembledThumbnailKey(unit,thumbnails.generation,sources);
  // Copy the map: a later manual association must not alter an already queued scene.
  const snapshot=new Map(ids.filter(id=>matches.has(id)).map(id=>[id,{...matches.get(id)}]));
  return thumbnails.get('module:'+key,async valid=>{
    if(!snapshot.size)throw Error('尚未导入此模块的 STL');
    const viewer=getThumbnailViewer();
    try{
      await viewer.setScene(scene,snapshot,{mode:'assembled',animate:false,colors:unit.colors});
      if(!valid())throw Error('缩略图任务已取消');
      if(!viewer.meshes.length)throw Error('模型预览不可用');
      const loaded=new Set(viewer.meshes.map(m=>m.userData.id));
      return {url:viewer.capture(),missing:ids.length-loaded.size,unresolved:viewer.meshes.some(m=>m.userData.unresolved)};
    }finally{viewer.clear();trimCache();}
  },isCurrent);
}
