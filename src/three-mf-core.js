// 3MF Core 1.4 / OPC, no proprietary printer or slicing settings.
// https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md
import {Zip,ZipDeflate,strToU8} from 'three/addons/libs/fflate.module.js';

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
    return {id,name,file,quantity};
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
export async function create3MF(entries,{title='VAULT 待打印零件',onProgress,signal}={}){
  abort(signal);entries=validateExportEntries(entries);
  const chunks=[],budget=createExportBudget();let zipError=null,finished=false,xmlBytes=0;
  const zip=new Zip((error,data,final)=>{
    if(error)zipError=error;
    else if(data?.length&&!zipError){try{budget.compressedBytes(data.length);chunks.push(data);}catch(error){zipError=error;}}
    if(final)finished=true;
  });
  const addText=(path,text)=>{const file=new ZipDeflate(path,{level:6});zip.add(file);file.push(strToU8(text),true);};
  addText('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="json" ContentType="application/json"/></Types>');
  addText('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel-model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/><Relationship Id="rel-manifest" Type="http://schemas.openxmlformats.org/package/2006/relationships/mustpreserve" Target="/Metadata/print-manifest.json"/></Relationships>');
  const model=new ZipDeflate('3D/3dmodel.model',{level:6});zip.add(model);
  const write=(text,final=false)=>{abort(signal);const bytes=strToU8(text);xmlBytes+=bytes.length;if(xmlBytes>EXPORT_LIMITS.xmlBytes)throw Error('3MF 内容过大，请分批导出');model.push(bytes,final);if(zipError)throw zipError;};
  const manifest={version:1,title:label(title),unit:'millimeter',unitAssumption:'STL has no unit; coordinates are interpreted as millimeters without scaling.',layout:'Original orientations, translated apart and grounded; arrange plates in your slicer.',objects:[],instances:[],sourceTriangles:0,triangles:0,discardedDegenerateTriangles:0,totalQuantity:0};
  const report=(phase,completed,name,percent)=>onProgress?.({phase,completed,total:entries.length,name,percent});
  try{
    write(`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="zh-CN" xmlns="${CORE}"><metadata name="Title">${xml(title)}</metadata><metadata name="Application">VAULT Print Studio</metadata><metadata name="Description">保留原始 STL 有效几何；仅跳过含完全重合顶点的零面积面，不按容差合并或简化。仅平移，不缩放。按毫米解释无单位 STL；请在切片软件中核对尺寸并重新排盘。源文件和打印记录保持不变。</metadata><resources>`);
    for(let index=0;index<entries.length;index++){
      abort(signal);const entry=entries[index],objectId=index+1,lookup=new Map(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      let vertices=0,triangles=0,sourceTriangles=0,discardedDegenerateTriangles=0,text='',faceBlock=new Uint32Array(BATCH*3),faceLength=0;
      const faces=[];
      const flush=()=>{if(text){write(text);text='';}};
      write(`<object id="${objectId}" type="model" name="${xml(entry.name)}" partnumber="${xml(entry.id)}"><mesh><vertices>`);
      const add=values=>{
        if(++sourceTriangles>EXPORT_LIMITS.triangles)throw Error(`${entry.name}：单个 STL 三角面过多`);
        if(!values.every(Number.isFinite))throw Error(`${entry.name}：STL 含无效顶点`);
        // Exact equality only: these faces cannot enclose area and 3MF cannot
        // reference one vertex twice within a triangle. Do not use a tolerance,
        // remove near-coincident/collinear faces, or alter the source STL.
        const same=(a,b)=>values[a]===values[b]&&values[a+1]===values[b+1]&&values[a+2]===values[b+2];
        if(same(0,3)||same(3,6)||same(0,6)){discardedDegenerateTriangles++;return;}
        triangles++;
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
      flush();write('</vertices><triangles>');lookup.clear();
      if(faceLength)faces.push(faceBlock.subarray(0,faceLength));
      for(let block=0;block<faces.length;block++){
        abort(signal);const indices=faces[block];text='';
        for(let i=0;i<indices.length;i+=3)text+=`<triangle v1="${indices[i]}" v2="${indices[i+1]}" v3="${indices[i+2]}"/>`;
        write(text);faces[block]=null;
        report('packaging',index,entry.name,(index+.65+.35*(block+1)/faces.length)/entries.length*90);
        await pause();
      }
      write('</triangles></mesh></object>');
      manifest.objects.push({objectId,id:entry.id,name:entry.name,quantity:entry.quantity,vertices,sourceTriangles,triangles,discardedDegenerateTriangles,bbox:[min,max],format});
      manifest.sourceTriangles+=sourceTriangles;manifest.triangles+=triangles;manifest.discardedDegenerateTriangles+=discardedDegenerateTriangles;manifest.totalQuantity+=entry.quantity;
    }
    write('</resources><build>');
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
    write('</build></model>',true);
    addText('Metadata/print-manifest.json',JSON.stringify(manifest));
    abort(signal);zip.end();if(zipError)throw zipError;if(!finished)throw Error('3MF ZIP 未完成');
    report('complete',entries.length,'',100);
    return {blob:new Blob(chunks,{type:'model/3mf'}),manifest};
  }catch(error){zip.terminate();chunks.length=0;throw error;}
}
