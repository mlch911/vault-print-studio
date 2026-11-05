import {PRINT_DEVICES} from './print-devices.js';

export const DEFAULT_PLATE_OPTIONS=Object.freeze({byColor:true,width:256,depth:256,nozzle:0.4});
export const PLATE_MARGIN=5,PART_GAP=5,MAX_PLATES=36;

export function normalizePlateOptions(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('请选择有效的分盘设置');
  const options={...DEFAULT_PLATE_OPTIONS,...value};
  const device=options.deviceId===undefined?null:PRINT_DEVICES.find(device=>device.id===options.deviceId);
  if(options.deviceId!==undefined&&!device)throw Error('请选择有效的设备型号');
  if(device){options.width=device.width;options.depth=device.depth;}
  if(typeof options.byColor!=='boolean'||![options.width,options.depth].every(n=>Number.isFinite(n)&&n>=50&&n<=1000)||![0.2,0.4,0.6,0.8].includes(options.nozzle))throw Error('请选择有效的热床尺寸（50–1000 mm）和喷嘴直径');
  return {byColor:options.byColor,width:options.width,depth:options.depth,nozzle:options.nozzle,...(device?{deviceId:device.id}:{})};
}

const fits=(w,d,r)=>w<=r.width&&d<=r.depth;
const contained=(a,b)=>a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.depth<=b.y+b.depth;
const compare=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};

// Keep the former row layout as a candidate so optimization cannot increase its
// plate count. The other candidates reuse gaps rather than reserving entire rows.
function packRows(jobs,width,depth){
  const bins=[];
  for(const job of jobs.slice().sort((a,b)=>b.depth-a.depth||b.width-a.width)){
    if(job.width>width||job.depth>depth)return null;
    let bin,shelf;
    for(const candidate of bins){
      shelf=candidate.shelves.find(s=>job.depth<=s.depth&&s.x+job.width<=width);
      if(shelf){bin=candidate;break;}
      const y=candidate.shelves.at(-1)?.end??0;
      if(y+job.depth<=depth){bin=candidate;shelf={x:0,y,depth:job.depth,end:y+job.depth+PART_GAP};bin.shelves.push(shelf);break;}
    }
    if(!bin){if(bins.length>=MAX_PLATES)return null;bin={shelves:[],items:[]};shelf={x:0,y:0,depth:job.depth,end:job.depth+PART_GAP};bin.shelves.push(shelf);bins.push(bin);}
    bin.items.push({...job,x:shelf.x,y:shelf.y,rotation:0});shelf.x+=job.width+PART_GAP;
  }
  return bins;
}

function splitFreeRectangles(free,used){
  const result=[];
  for(const r of free){
    if(used.x>=r.x+r.width||used.x+used.width<=r.x||used.y>=r.y+r.depth||used.y+used.depth<=r.y){result.push(r);continue;}
    if(used.x>r.x)result.push({x:r.x,y:r.y,width:used.x-r.x,depth:r.depth});
    if(used.x+used.width<r.x+r.width)result.push({x:used.x+used.width,y:r.y,width:r.x+r.width-used.x-used.width,depth:r.depth});
    if(used.y>r.y)result.push({x:r.x,y:r.y,width:r.width,depth:used.y-r.y});
    if(used.y+used.depth<r.y+r.depth)result.push({x:r.x,y:used.y+used.depth,width:r.width,depth:r.y+r.depth-used.y-used.depth});
  }
  return result.filter((r,i)=>r.width>0&&r.depth>0&&!result.some((other,j)=>j!==i&&contained(r,other)&&(!contained(other,r)||j<i)));
}

function packRectangles(jobs,width,depth,order,heuristic,limit){
  const bins=[];
  for(const job of jobs.slice().sort(order)){
    let best;
    const search=(bin,index)=>{
      for(const r of bin.free)for(const rotation of [0,90]){
        const w=(rotation?job.depth:job.width)+PART_GAP,d=(rotation?job.width:job.depth)+PART_GAP;
        if(!fits(w,d,r))continue;
        const short=Math.min(r.width-w,r.depth-d),long=Math.max(r.width-w,r.depth-d);
        const score=[heuristic==='area'?r.width*r.depth-w*d:short,long,r.y,r.x,rotation,index];
        if(!best||compare(score,best.score)<0)best={bin,r,rotation,score,width:w,depth:d};
      }
    };
    bins.forEach(search);
    if(!best){
      if(bins.length>=limit)return null;
      const bin={free:[{x:0,y:0,width:width+PART_GAP,depth:depth+PART_GAP}],items:[]};bins.push(bin);search(bin,bins.length-1);
    }
    if(!best)return null;
    const {bin,r,rotation}=best,used={x:r.x,y:r.y,width:best.width,depth:best.depth};
    bin.items.push({...job,x:r.x,y:r.y,rotation});bin.free=splitFreeRectangles(bin.free,used);
  }
  return bins;
}

function layoutScore(bins){
  return [bins.length,bins.reduce((sum,bin)=>sum+Math.max(...bin.items.map(i=>i.x+(i.rotation?i.depth:i.width)))*Math.max(...bin.items.map(i=>i.y+(i.rotation?i.width:i.depth))),0),bins.reduce((sum,bin)=>sum+bin.items.filter(i=>i.rotation).length,0)];
}

/** Compare row packing with several MaxRects orders/fit scores. Only rotate
 * around Z by 90 degrees; retain the source's bed-facing surface and geometry. */
export function arrangeColorPlates(objects,options){
  const {width,depth}=normalizePlateOptions(options),plates=[],instances=[],groups=new Map();
  for(const object of objects){
    const colors=[...new Set(object.colors||['#BFC2C4'])].sort(),key=colors.join(',');
    if(!groups.has(key))groups.set(key,{colors,objects:[]});
    groups.get(key).objects.push(object);
  }
  for(const {colors,objects:group} of groups.values()){
    const jobs=[],innerWidth=width-2*PLATE_MARGIN,innerDepth=depth-2*PLATE_MARGIN;
    for(const object of group){
      const [min,max]=object.bbox,w=max[0]-min[0],d=max[1]-min[1];
      if(!fits(w,d,{width:innerWidth,depth:innerDepth})&&!fits(d,w,{width:innerWidth,depth:innerDepth}))throw Error(`${object.name}：占地 ${w.toFixed(1)} × ${d.toFixed(1)} mm，平面旋转后仍超过所选热床的可用区域；请选择更大热床或在切片软件中调整朝向`);
      for(let copy=1;copy<=object.quantity;copy++)jobs.push({object,copy,width:w,depth:d});
    }
    const orders=[(a,b)=>b.width*b.depth-a.width*a.depth,(a,b)=>Math.max(b.width,b.depth)-Math.max(a.width,a.depth),(a,b)=>b.depth-a.depth||b.width-a.width,(a,b)=>b.width-a.width||b.depth-a.depth];
    let best=packRows(jobs,innerWidth,innerDepth);
    for(const order of orders)for(const heuristic of ['short','area']){
      const candidate=packRectangles(jobs,innerWidth,innerDepth,order,heuristic,Math.min(best?.length??MAX_PLATES,MAX_PLATES));
      if(candidate&&(!best||compare(layoutScore(candidate),layoutScore(best))<0))best=candidate;
    }
    if(!best||plates.length+best.length>MAX_PLATES)throw Error('分盘超过 Bambu Studio 的 36 盘上限，请按模块分批导出');
    for(const bin of best){
      const plate={id:plates.length+1,colors,instances:[]};plates.push(plate);
      for(const item of bin.items){
        const {object,rotation,copy}=item,[min,max]=object.bbox,x=item.x+PLATE_MARGIN,y=item.y+PLATE_MARGIN;
        const localTranslation=rotation?[x+max[1],y-min[0],-min[2]]:[x-min[0],y-min[1],-min[2]];
        const instance={objectId:object.objectId,copy,plate:plate.id,rotation,localTranslation};
        plate.instances.push(instance);instances.push(instance);
      }
    }
  }
  // Match Bambu Studio's plate grid: ceil(sqrt(count)) columns, 20% gap,
  // increasing columns along +X and rows along -Y.
  const columns=Math.ceil(Math.sqrt(plates.length));
  for(const plate of plates){
    plate.origin=[((plate.id-1)%columns)*width*1.2,-Math.floor((plate.id-1)/columns)*depth*1.2||0,0];
    for(const instance of plate.instances)instance.translation=instance.localTranslation.map((n,a)=>n+plate.origin[a]);
  }
  return {plates,instances};
}

// Bambu's unsplit-triangle paint encoding, shared with its TriangleSelector.
export function filamentPaint(filament){
  if(!Number.isInteger(filament)||filament<1||filament>32)throw Error('Bambu Studio 项目最多支持 32 种导出颜色');
  return (filament<3?(filament*4).toString(16):((filament-3)%15).toString(16)+'F'.repeat(Math.floor((filament-3)/15))+'C').toUpperCase();
}
