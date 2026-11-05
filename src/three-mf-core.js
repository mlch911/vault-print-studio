// 3MF Core 1.4 / OPC + standard Materials color groups, no printer or slicing settings.
// https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md
import {Zip,ZipDeflate,strToU8} from 'three/addons/libs/fflate.module.js';
import {partitionMesh} from './partition-mesh.js';
import {normalizePlateOptions,arrangeColorPlates,filamentPaint} from './print-plates.js';

export const EXPORT_LIMITS=Object.freeze({files:1000,instances:10000,fileBytes:512*1024*1024,totalBytes:2*1024*1024*1024,triangles:10000000,vertices:4000000,zipBytes:512*1024*1024,xmlBytes:3500000000});
const CORE='http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const SLICE=1024*1024,BATCH=8192,GAP=10;
const DECIMAL=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NORMAL=/^[+-]?(?:nan|inf(?:inity)?)$/i;
const FACET=['normal',null,null,null,'outer','loop','vertex',0,1,2,'vertex',3,4,5,'vertex',6,7,8,'endloop','endfacet'];
const abort=signal=>{if(signal?.aborted)throw signal.reason??new DOMException('导出已取消','AbortError');};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const label=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/g,'').slice(0,200).toWellFormed();
const basename=value=>label(value).replace(/\\/g,'/').split('/').pop()||'零件';
const xml=value=>label(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

// Fixed production limits also exposed as small counters so boundary tests do not
// allocate hundreds of megabytes. Callers cannot raise these per-export limits.
export function createExportBudget(){
  let compressed=0;
  return {
    vertexCount(count){
      if(!Number.isSafeInteger(count)||count<0||count>EXPORT_LIMITS.vertices)throw Error('单个 STL 超过 400 万个唯一顶点，无法在浏览器中完整导出；请使用较小模块');
    },
    compressedBytes(bytes){
      if(!Number.isSafeInteger(bytes)||bytes<0||compressed+bytes>EXPORT_LIMITS.zipBytes)throw Error('3MF 压缩结果超过 512 MiB，请按模块分批导出');
      compressed+=bytes;
    },
  };
}

export function validateExportEntries(entries){
  if(!Array.isArray(entries)||!entries.length)throw Error('当前配置没有待打印零件');
  if(entries.length>EXPORT_LIMITS.files)throw Error('导出零件种类过多，请分批导出');
  let bytes=0,instances=0;const ids=new Set();
  return entries.map((entry,index)=>{
    const file=entry?.file,quantity=entry?.quantity,id=basename(entry?.id??`part-${index+1}`),name=basename(entry?.name??file?.name??id);
    if(!Number.isSafeInteger(quantity)||quantity<1)throw Error(`${name}：待打印份数必须是正整数`);
    if(!file||!Number.isSafeInteger(file.size)||file.size<=0||typeof file.slice!=='function')throw Error(`${name}：没有可读取的 STL 文件`);
    if(file.size>EXPORT_LIMITS.fileBytes)throw Error(`${name}：单文件超过 512 MiB，无法导出`);
    if(ids.has(id))throw Error('导出清单含重复零件标识，请先合并份数');ids.add(id);
    bytes+=file.size;instances+=quantity;
    if(bytes>EXPORT_LIMITS.totalBytes||instances>EXPORT_LIMITS.instances)throw Error('导出内容过多，请按模块分批导出');
    const copyColors=entry.copyColors;
    if(copyColors!==undefined&&(!Array.isArray(copyColors)||copyColors.length!==quantity||Array.from(copyColors).some(colors=>!Array.isArray(colors)||!colors.length||colors.length>32||colors.length!==copyColors[0].length||Array.from(colors).some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))))throw Error(`${name}：导出配色无效`);
    return {id,name,file,quantity,...(copyColors?{copyColors:copyColors.map(colors=>colors.map(c=>c.toUpperCase())),colorFrames:structuredClone(entry.colorFrames||[])}:{})};
  });
}

// XML decimal syntax does not accept exponential notation. Preserve all JS digits.
export function decimal(value){
  if(!Number.isFinite(value))throw Error('STL 含无效的顶点坐标');
  if(value===0)return '0';
  const s=String(value);if(!/[eE]/.test(s))return s;
  const sign=s.startsWith('-')?'-':'',positive=sign?s.slice(1):s;
  const [mantissa,exponent]=positive.toLowerCase().split('e'),point=mantissa.indexOf('.'),digits=mantissa.replace('.','');
  const offset=(point<0?mantissa.length:point)+Number(exponent);
  return sign+(offset<=0?'0.'+'0'.repeat(-offset)+digits:offset>=digits.length?digits+'0'.repeat(offset-digits.length):digits.slice(0,offset)+'.'+digits.slice(offset));
}

function asciiParser(add){
  let state='opening',token='',step=0;const values=new Array(9);
  const invalid=()=>{throw Error('ASCII STL 内容不完整或格式无效');};
  function accept(word){
    if(state==='opening'){if(word.toLowerCase()!=='solid')invalid();state='opening-label';}
    else if(state==='between'){
      if(word.toLowerCase()==='facet'){state='facet';step=0;}
      else if(word.toLowerCase()==='endsolid')state='closing-label';else invalid();
    }else if(state==='facet'){
      const expected=FACET[step];
      if(typeof expected==='string'){if(word.toLowerCase()!==expected)invalid();}
      else if(expected===null){if(!DECIMAL.test(word)&&!NORMAL.test(word))invalid();}
      else{if(!DECIMAL.test(word)||!Number.isFinite(Number(word)))invalid();values[expected]=Number(word);}
      if(++step===FACET.length){add(values);state='between';}
    }else invalid();
  }
  return {
    consume(bytes){for(const code of bytes){
      const newline=code===10||code===13,whitespace=code===32||(code>=9&&code<=13);
      if(state==='opening-label'||state==='closing-label'){
        if(newline)state=state==='opening-label'?'between':'done';
        else if((code<32&&code!==9)||code===127)invalid();
        continue;
      }
      if(code>126||(code<32&&!whitespace))invalid();
      if(whitespace){if(token){accept(token);token='';}if(newline&&state==='opening-label')state='between';else if(newline&&state==='closing-label')state='done';}
      else{if(state==='done'||token.length>=256)invalid();token+=String.fromCharCode(code);}
    }},
    finish(){if(token)accept(token);if(state!=='done'&&state!=='closing-label')invalid();},
  };
}

async function walkSTL(file,add,{signal,onProgress}){
  const read=async(start,end)=>{abort(signal);const b=await file.slice(start,end).arrayBuffer();abort(signal);if(b.byteLength!==end-start)throw Error('STL 文件读取不完整');return b;};
  const head=await read(0,Math.min(84,file.size));
  const count=head.byteLength===84?new DataView(head).getUint32(80,true):0;
  if(head.byteLength===84&&84+count*50===file.size){
    if(!count)throw Error('STL 没有三角面');
    if(count>EXPORT_LIMITS.triangles)throw Error('单个 STL 三角面过多，请分批或使用较小模块');
    const values=new Array(9);
    for(let start=0;start<count;start+=BATCH){
      const n=Math.min(BATCH,count-start),view=new DataView(await read(84+start*50,84+(start+n)*50));
      for(let i=0;i<n;i++){for(let j=0;j<9;j++)values[j]=view.getFloat32(i*50+12+j*4,true);add(values);}
      onProgress((84+(start+n)*50)/file.size);await pause();abort(signal);
    }
    return 'binary';
  }
  const parser=asciiParser(add);
  for(let offset=0;offset<file.size;offset+=SLICE){
    let bytes=new Uint8Array(await read(offset,Math.min(file.size,offset+SLICE)));
    if(offset===0&&bytes[0]===239&&bytes[1]===187&&bytes[2]===191)bytes=bytes.subarray(3);
    parser.consume(bytes);onProgress(Math.min(file.size,offset+SLICE)/file.size);await pause();abort(signal);
  }
  parser.finish();return 'ascii';
}

/** One mesh in memory at a time; ZIP and XML are streamed, original faces never simplified. */
export async function create3MF(entries,{title='VAULT 待打印零件',onProgress,signal,plateOptions}={}){
  abort(signal);entries=validateExportEntries(entries);
  const plateSettings=plateOptions?normalizePlateOptions(plateOptions):null,native=!!plateSettings?.byColor;
  // A build item cannot override its object's materials. Share a mesh only among
  // copies with the same component colors; keep differently colored copies distinct.
  entries=entries.flatMap(entry=>{
    if(!entry.copyColors)return [entry];
    const groups=new Map();
    for(const colors of entry.copyColors){const key=colors.join(',');if(groups.has(key))groups.get(key).quantity++;else groups.set(key,{...entry,colors,quantity:1});}
    return [...groups.values()];
  });
  if(native)entries=entries.map(entry=>({...entry,colors:entry.colors||['#BFC2C4']}));
  const palette=[...new Set(entries.flatMap(e=>e.colors||[]))],materialId=entries.length+1;
  if(native&&palette.length>32)throw Error('Bambu Studio 项目最多支持 32 种导出颜色，请减少配色或改用通用 3MF');
  const colorIndices=new Map(palette.map((color,index)=>[color,index]));
  const chunks=[],budget=createExportBudget();let zipError=null,finished=false,xmlBytes=0;
  const zip=new Zip((error,data,final)=>{
    if(error)zipError=error;
    else if(data?.length&&!zipError){try{budget.compressedBytes(data.length);chunks.push(data);}catch(error){zipError=error;}}
    if(final)finished=true;
  });
  const addText=(path,text)=>{const file=new ZipDeflate(path,{level:6});zip.add(file);file.push(strToU8(text),true);};
  addText('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="json" ContentType="application/json"/>'+(native?'<Default Extension="config" ContentType="application/xml"/><Override PartName="/Metadata/project_settings.config" ContentType="application/json"/>':'')+'</Types>');
  addText('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel-model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/><Relationship Id="rel-manifest" Type="http://schemas.openxmlformats.org/package/2006/relationships/mustpreserve" Target="/Metadata/print-manifest.json"/></Relationships>');
  const model=new ZipDeflate('3D/3dmodel.model',{level:6});zip.add(model);
  const write=(text,final=false)=>{abort(signal);const bytes=strToU8(text);xmlBytes+=bytes.length;if(xmlBytes>EXPORT_LIMITS.xmlBytes)throw Error('3MF 内容过大，请分批导出');model.push(bytes,final);if(zipError)throw zipError;};
  const manifest={version:1,title:label(title),unit:'millimeter',unitAssumption:'STL has no unit; coordinates are interpreted as millimeters without scaling.',layout:'Original orientations, translated apart and grounded; arrange plates in your slicer.',objects:[],instances:[],sourceTriangles:0,triangles:0,discardedDegenerateTriangles:0,totalQuantity:0};
  const report=(phase,completed,name,percent)=>onProgress?.({phase,completed,total:entries.length,name,percent});
  try{
    // Bambu only loads project settings when this compatibility header has its
    // version prefix. Keep the actual producing tool in Designer, and use the
    // baseline format version rather than claiming the installed app version.
    const application=native?'BambuStudio-02.00.00.00':'VAULT Print Studio';
    write(`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="zh-CN" xmlns="${CORE}"${palette.length?' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"':''}><metadata name="Title">${xml(title)}</metadata><metadata name="Application">${application}</metadata>${native?'<metadata name="Designer">VAULT Print Studio</metadata><metadata name="BambuStudio:3mfVersion">1</metadata>':''}<metadata name="Description">保留原始 STL 有效几何；仅跳过含完全重合顶点的零面积面，不按容差合并或简化。${native?'允许热床平面内旋转 90 度，不翻转、不缩放。':'仅平移，不缩放。'}按毫米解释无单位 STL；请在切片软件中核对尺寸并重新排盘。源文件和打印记录保持不变。${native?'分盘项目含基础热床、喷嘴及颜色设置；切片前请选择实际打印机、耗材和工艺，并重新计算冲刷量。':''}</metadata><resources>`);
    if(palette.length)write(`<m:colorgroup id="${materialId}">${palette.map(color=>`<m:color color="${color}FF"/>`).join('')}</m:colorgroup>`);
    for(let index=0;index<entries.length;index++){
      abort(signal);const entry=entries[index],objectId=index+1,lookup=new Map(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      let vertices=0,triangles=0,sourceTriangles=0,discardedDegenerateTriangles=0,text='',faceBlock=new Uint32Array(BATCH*3),faceLength=0;
      const faces=[];
      const properties=entry.colors?.map(color=>colorIndices.get(color));
      const mixed=entry.colors?.some(c=>c!==entry.colors[0]),rawBlocks=[];
      let rawBlock=mixed?new Float32Array(BATCH*9):null,rawLength=0;
      const flush=()=>{if(text){write(text);text='';}};
      write(`<object id="${objectId}" type="model" name="${xml(entry.name)}" partnumber="${xml(entry.id)}"${properties?` pid="${materialId}" pindex="${properties[0]}"`:''}><mesh><vertices>`);
      const add=values=>{
        if(++sourceTriangles>EXPORT_LIMITS.triangles)throw Error(`${entry.name}：单个 STL 三角面过多`);
        if(!values.every(Number.isFinite))throw Error(`${entry.name}：STL 含无效顶点`);
        // Exact equality only: these faces cannot enclose area and 3MF cannot
        // reference one vertex twice within a triangle. Do not use a tolerance,
        // remove near-coincident/collinear faces, or alter the source STL.
        const same=(a,b)=>values[a]===values[b]&&values[a+1]===values[b+1]&&values[a+2]===values[b+2];
        if(same(0,3)||same(3,6)||same(0,6)){discardedDegenerateTriangles++;return;}
        triangles++;
        if(mixed){
          if(triangles>1000000)throw Error(`${entry.name}：多组件分别配色超过完整分区上限，无法可靠保留颜色；请使用统一配色或较小模型`);
          rawBlock.set(values,rawLength);rawLength+=9;
          if(rawLength===rawBlock.length){rawBlocks.push(rawBlock);rawBlock=new Float32Array(BATCH*9);rawLength=0;}
        }
        for(let offset=0;offset<9;offset+=3){
          const x=values[offset],y=values[offset+1],z=values[offset+2];
          if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))throw Error(`${entry.name}：STL 含无效顶点`);
          const key=`${x},${y},${z}`;let vertex=lookup.get(key);
          if(vertex===undefined){
            budget.vertexCount(vertices+1);
            vertex=vertices++;lookup.set(key,vertex);
            text+=`<vertex x="${decimal(x)}" y="${decimal(y)}" z="${decimal(z)}"/>`;
            for(let a=0;a<3;a++){const v=values[offset+a];min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}
            if(text.length>=131072)flush();
          }
          faceBlock[faceLength++]=vertex;
          if(faceLength===faceBlock.length){faces.push(faceBlock);faceBlock=new Uint32Array(BATCH*3);faceLength=0;}
        }
      };
      report('reading',index,entry.name,index/entries.length*90);
      const format=await walkSTL(entry.file,add,{signal,onProgress:f=>report('reading',index,entry.name,(index+f*.65)/entries.length*90)});
      if(triangles<4)throw Error(`${entry.name}：STL 有效三角面少于 4 个，不能作为 3MF 实体导出`);
      if(vertices<3)throw Error(`${entry.name}：STL 顶点不足`);
      let triangleSlots;
      if(mixed){
        const raw=new Float32Array(triangles*9);let offset=0;
        for(const block of [...rawBlocks,rawBlock.subarray(0,rawLength)]){raw.set(block,offset);offset+=block.length;}
        rawBlocks.length=0;rawBlock=null;
        const partition=partitionMesh(raw,entry.colorFrames,{membershipOnly:true});
        if(!partition.resolved||entry.colorFrames.length!==entry.colors.length)throw Error(`${entry.name}：无法可靠匹配原文件各组件的颜色，请核对模型版本或使用统一配色`);
        triangleSlots=partition.triangleSlots;
      }
      flush();write('</vertices><triangles>');lookup.clear();
      if(faceLength)faces.push(faceBlock.subarray(0,faceLength));
      let faceIndex=0;
      for(let block=0;block<faces.length;block++){
        abort(signal);const indices=faces[block];text='';
        for(let i=0;i<indices.length;i+=3){
          const property=properties?.[triangleSlots?triangleSlots[faceIndex]:0];
          text+=`<triangle v1="${indices[i]}" v2="${indices[i+1]}" v3="${indices[i+2]}"${property!==undefined?` pid="${materialId}" p1="${property}" p2="${property}" p3="${property}"`:''}${native&&mixed?` paint_color="${filamentPaint(property+1)}"`:''}/>`;
          faceIndex++;
        }
        write(text);faces[block]=null;
        report('packaging',index,entry.name,(index+.65+.35*(block+1)/faces.length)/entries.length*90);
        await pause();
      }
      write('</triangles></mesh></object>');
      manifest.objects.push({objectId,id:entry.id,name:entry.name,quantity:entry.quantity,...(entry.colors?{colors:entry.colors}:{}),vertices,sourceTriangles,triangles,discardedDegenerateTriangles,bbox:[min,max],format});
      manifest.sourceTriangles+=sourceTriangles;manifest.triangles+=triangles;manifest.discardedDegenerateTriangles+=discardedDegenerateTriangles;manifest.totalQuantity+=entry.quantity;
    }
    write('</resources><build>');
    if(native){
      const layout=arrangeColorPlates(manifest.objects,plateSettings);
      manifest.plateOptions=plateSettings;manifest.plates=layout.plates;
      manifest.layout='Color-separated Bambu Studio plates, optional 90-degree Z rotation, 5 mm edge margins and part gaps.';
      manifest.instances=layout.instances;
      const instanceCounts=new Map();
      for(const instance of layout.instances){
        abort(signal);
        // Native instance ids follow build-item order for each object. A packing
        // strategy can put later copies on earlier plates, changing that order.
        instance.instanceId=instanceCounts.get(instance.objectId)||0;instanceCounts.set(instance.objectId,instance.instanceId+1);
        const rotation=instance.rotation?'0 1 0 -1 0 0 0 0 1':'1 0 0 0 1 0 0 0 1';
        write(`<item objectid="${instance.objectId}" transform="${rotation} ${instance.translation.map(decimal).join(' ')}" printable="1"/>`);
      }
    }else{
    const area=manifest.objects.reduce((sum,o)=>sum+(o.bbox[1][0]-o.bbox[0][0]+GAP)*(o.bbox[1][1]-o.bbox[0][1]+GAP)*o.quantity,0);
    const rowWidth=Math.max(Math.sqrt(area),...manifest.objects.map(o=>o.bbox[1][0]-o.bbox[0][0]+GAP));
    let x=GAP,y=GAP,rowHeight=0;
    for(const object of manifest.objects){
      const [min,max]=object.bbox,width=max[0]-min[0],depth=max[1]-min[1];
      for(let copy=0;copy<object.quantity;copy++){
        abort(signal);if(x>GAP&&x+width>rowWidth+GAP){x=GAP;y+=rowHeight+GAP;rowHeight=0;}
        const translation=[x-min[0],y-min[1],-min[2]],transform='1 0 0 0 1 0 0 0 1 '+translation.map(decimal).join(' ');
        write(`<item objectid="${object.objectId}" transform="${transform}" partnumber="${xml(object.id)}-${copy+1}"/>`);
        manifest.instances.push({objectId:object.objectId,copy:copy+1,translation});
        x+=width+GAP;rowHeight=Math.max(rowHeight,depth);
      }
    }
    }
    write('</build></model>',true);
    if(native){
      const {width,depth,nozzle}=plateSettings;
      // These are descriptive placeholders, not claims to inherit an official
      // printer/material profile. Bambu may show its custom-preset confirmation.
      const project={version:'02.00.00.00',name:'project_settings',from:'project',printer_technology:'FFF',printer_settings_id:'VAULT 排盘项目（未指定机型）',print_settings_id:'VAULT 排盘（未指定工艺）',filament_settings_id:palette.map(color=>`VAULT ${color}（未指定耗材）`),nozzle_diameter:[String(nozzle)],filament_colour:palette,printable_area:['0x0',`${width}x0`,`${width}x${depth}`,`0x${depth}`],printable_height:'256',flush_volumes_matrix:palette.flatMap((_,i)=>palette.map((_,j)=>i===j?'0':'280'))};
      addText('Metadata/project_settings.config',JSON.stringify(project));
      const meta=(key,value)=>`<metadata key="${key}" value="${xml(value)}"/>`;
      const objects=manifest.objects.map(object=>{
        const extruder=colorIndices.get(object.colors[0])+1;
        return `<object id="${object.objectId}">${meta('name',object.name)}${meta('extruder',extruder)}<part id="${object.objectId}" subtype="normal_part">${meta('name',object.name)}${meta('extruder',extruder)}</part></object>`;
      }).join('');
      const plates=manifest.plates.map(plate=>`<plate>${meta('plater_id',plate.id)}${meta('plater_name',plate.colors.length===1?plate.colors[0]:'多色 '+plate.colors.join(' / '))}${meta('locked','false')}${plate.instances.map((instance,index)=>`<model_instance>${meta('object_id',instance.objectId)}${meta('instance_id',instance.instanceId)}${meta('identify_id',plate.id*10000+index+1)}</model_instance>`).join('')}</plate>`).join('');
      addText('Metadata/model_settings.config',`<?xml version="1.0" encoding="UTF-8"?><config>${objects}${plates}</config>`);
    }
    addText('Metadata/print-manifest.json',JSON.stringify(manifest));
    abort(signal);zip.end();if(zipError)throw zipError;if(!finished)throw Error('3MF ZIP 未完成');
    report('complete',entries.length,'',100);
    return {blob:new Blob(chunks,{type:'model/3mf'}),manifest};
  }catch(error){zip.terminate();chunks.length=0;throw error;}
}
