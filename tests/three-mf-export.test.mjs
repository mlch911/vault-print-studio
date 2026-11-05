import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'three/addons/libs/fflate.module.js';
import {create3MF,export3MF,validateExportEntries} from '../src/three-mf-export.js';
import {decimal,EXPORT_LIMITS,createExportBudget} from '../src/three-mf-core.js';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

// Entirely procedural synthetic tetrahedron; no captured model payload.
const axisLengths=[3,2,4];
const corners=Array.from({length:4},(_,corner)=>Array.from({length:3},(_,axis)=>corner===axis+1?axisLengths[axis]:0));
const tetra=corners.map((opposite,omitted)=>{
  const face=corners.filter((_,index)=>index!==omitted),a=face[0],b=face[1],c=face[2];
  const ab=b.map((v,axis)=>v-a[axis]),ac=c.map((v,axis)=>v-a[axis]);
  const normal=Array.from({length:3},(_,axis)=>ab[(axis+1)%3]*ac[(axis+2)%3]-ab[(axis+2)%3]*ac[(axis+1)%3]);
  if(normal.reduce((sum,n,axis)=>sum+n*(opposite[axis]-a[axis]),0)>0)face.reverse();
  return face;
});
const moved=(mesh,offset)=>mesh.map(face=>face.map(v=>v.map((n,a)=>n+offset[a])));
function binary(mesh){
  const bytes=new Uint8Array(84+mesh.length*50),view=new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('solid binary header'));
  view.setUint32(80,mesh.length,true);
  mesh.forEach((face,index)=>face.flat().forEach((n,axis)=>view.setFloat32(84+50*index+12+4*axis,n,true)));
  return new Blob([bytes]);
}
function ascii(mesh){return new Blob(['\ufeffsolid 中文\n',...mesh.map(face=>`facet normal nan 0 1\n outer loop\n ${face.map(v=>'vertex '+v.join(' ')).join('\n')}\n endloop\n endfacet\n`),'endsolid 中文\n']);}
const hash=async file=>createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex');
const entry=(file,quantity=1,extra={})=>({id:'p1',name:'测试.stl',file,quantity,...extra});
async function unpack(result){
  const files=unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  return {files,model:strFromU8(files['3D/3dmodel.model']),manifest:JSON.parse(strFromU8(files['Metadata/print-manifest.json']))};
}
function meshes(xml){
  return [...xml.matchAll(/<object\b[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)].map(match=>({
    id:Number(match[1]),vertices:Array.from(match[2].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g),v=>v.slice(1).map(Number)),
    triangles:Array.from(match[2].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"[^>]*\/>/g),v=>v.slice(1).map(Number)),
  }));
}

test('3MF package contains complete indexed meshes, OPC relationships, instance counts and source coordinates',async()=>{
  const first=binary(moved(tetra,[120,-40,8])),second=ascii(moved(tetra,[-10,9,-4]));
  const before=await Promise.all([hash(first),hash(second)]),progress=[];
  const result=await export3MF([entry(first,3),entry(second,2,{id:'p2',name:'另一零件.stl'})],{title:'待打印配置',onProgress:p=>progress.push(p)});
  assert.equal(result.blob.type,'model/3mf');
  const {files,model,manifest}=await unpack(result);
  assert.deepEqual(Object.keys(files).sort(),['3D/3dmodel.model','Metadata/print-manifest.json','[Content_Types].xml','_rels/.rels'].sort());
  assert.match(strFromU8(files['[Content_Types].xml']),/application\/vnd\.ms-package\.3dmanufacturing-3dmodel\+xml/);
  assert.match(strFromU8(files['_rels/.rels']),/Target="\/3D\/3dmodel.model"/);
  assert.match(model,/unit="millimeter"/);
  const parsed=meshes(model);assert.equal(parsed.length,2);
  for(let i=0;i<2;i++){
    assert.equal(parsed[i].vertices.length,4,'coincident corners share indexed vertices');
    assert.equal(parsed[i].triangles.length,4);
    const reconstructed=parsed[i].triangles.map(face=>face.map(v=>parsed[i].vertices[v]));
    assert.deepEqual(reconstructed,i===0?moved(tetra,[120,-40,8]):moved(tetra,[-10,9,-4]));
  }
  assert.equal([...model.matchAll(/<item /g)].length,5);
  assert.equal(manifest.totalQuantity,5);assert.equal(manifest.triangles,8);
  assert.deepEqual(manifest.objects.map(o=>o.quantity),[3,2]);
  assert.deepEqual(await Promise.all([hash(first),hash(second)]),before,'source bytes remain untouched');
  assert.equal(progress.at(-1).phase,'complete');assert.equal(progress.at(-1).percent,100);
  assert.deepEqual(manifest,result.manifest);
});

test('colors survive validation twice, worker transfer and 3MF material bindings; equal-color copies share geometry',async()=>{
  const source=entry(binary(tetra),3,{copyColors:[['#ff6b24'],['#376680'],['#FF6B24']]});
  let payload;
  const originalWorker=globalThis.Worker;
  globalThis.Worker=class{
    postMessage(data){payload=structuredClone(data);create3MF(payload.entries,{plateOptions:payload.plateOptions}).then(result=>this.onmessage({data:{type:'result',...result}}));}
    terminate(){}
  };
  let result,nativeResult;
  const plateOptions={byColor:true,width:180,depth:180,nozzle:0.4};
  try{result=await export3MF([source]);nativeResult=await export3MF([source],{plateOptions});}finally{if(originalWorker===undefined)delete globalThis.Worker;else globalThis.Worker=originalWorker;}
  assert.deepEqual(payload.plateOptions,plateOptions);assert.equal(nativeResult.manifest.plates.length,2);
  assert.deepEqual(payload.entries[0].copyColors,[['#FF6B24'],['#376680'],['#FF6B24']]);
  const {model,manifest}=await unpack(result);
  assert.match(model,/xmlns:m="http:\/\/schemas.microsoft.com\/3dmanufacturing\/material\/2015\/02"/);
  assert.match(model,/<m:colorgroup id="3"><m:color color="#FF6B24FF"\/><m:color color="#376680FF"\/><\/m:colorgroup>/);
  const objects=[...model.matchAll(/<object\b([^>]+)>([\s\S]*?)<\/object>/g)];
  assert.equal(objects.length,2);
  objects.forEach((object,index)=>{
    assert.match(object[1],new RegExp(`pid="3" pindex="${index}"`));
    const faces=[...object[2].matchAll(/<triangle[^>]+pid="3" p1="(\d+)" p2="(\d+)" p3="(\d+)"/g)];
    assert.equal(faces.length,4);faces.forEach(f=>assert.deepEqual(f.slice(1),Array(3).fill(String(index))));
  });
  assert.deepEqual(manifest.objects.map(o=>o.quantity),[2,1]);
  assert.equal(manifest.totalQuantity,3);
  for(const mesh of meshes(model))assert.deepEqual(mesh.triangles.map(face=>face.map(v=>mesh.vertices[v])),tetra);
});

test('a paired STL retains its original complete mesh and binds each component color to its original faces',async()=>{
  const shifted=moved(tetra,[20,0,0]),pair=tetra.flatMap((face,i)=>[face,shifted[i]]),file=binary(pair),before=await hash(file);
  const frames=[0,20].map(x=>({rotation:Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>Number(i===j))),origin:[x+1.5,1,2],min:[-1.5,-1,-2],max:[1.5,1,2]}));
  const {model,manifest}=await unpack(await create3MF([entry(file,1,{copyColors:[['#FF0000','#0000FF']],colorFrames:frames})]));
  const parsed=meshes(model);assert.equal(parsed.length,1);
  assert.deepEqual(parsed[0].triangles.map(face=>face.map(v=>parsed[0].vertices[v])),pair);
  assert.deepEqual([...model.matchAll(/<triangle[^>]+p1="(\d+)"/g)].map(m=>Number(m[1])),Array.from({length:8},(_,i)=>i%2));
  assert.deepEqual(manifest.objects[0].colors,['#FF0000','#0000FF']);
  assert.equal(await hash(file),before);
  await assert.rejects(create3MF([entry(file,1,{copyColors:[['#FF0000','#0000FF']],colorFrames:[]})]),/无法可靠匹配/);
});

test('malformed color assignments cannot silently produce uncolored output',()=>{
  for(const copyColors of [[],[['red']],[['#000000'],['#FFFFFF']],[[]],[['#FF0000','bad']],[new Array(1)],new Array(1)]){
    assert.throws(()=>validateExportEntries([entry(binary(tetra),1,{copyColors})]),/配色无效/);
  }
});

test('color-separated project includes usable Bambu settings, unique instance references and real plate transforms',async()=>{
  const result=await create3MF([entry(binary(tetra),3,{copyColors:[['#FF0000'],['#0000FF'],['#FF0000']]})],{plateOptions:{byColor:true,width:180,depth:180,nozzle:0.6}});
  const {model,manifest,files}=await unpack(result),project=JSON.parse(strFromU8(files['Metadata/project_settings.config'])),settings=strFromU8(files['Metadata/model_settings.config']);
  assert.match(model,/<metadata name="Application">BambuStudio-02\.00\.00\.00<\/metadata>/);
  assert.match(model,/<metadata name="Designer">VAULT Print Studio<\/metadata>/);
  assert.deepEqual(project.nozzle_diameter,['0.6']);assert.deepEqual(project.filament_colour,['#FF0000','#0000FF']);
  assert.deepEqual(project.printable_area,['0x0','180x0','180x180','0x180']);
  assert.match(project.printer_settings_id,/未指定机型/);assert.ok(project.filament_settings_id.every(name=>/未指定耗材/.test(name)));
  assert.ok(Object.keys(project).every(key=>!key.toLowerCase().includes('gcode')));
  assert.ok(Object.keys(files).every(path=>!/(?:machine|filament|process)_settings_/.test(path)));
  assert.equal(manifest.plates.length,2);assert.equal(manifest.instances.length,3);
  assert.equal((settings.match(/<plate>/g)||[]).length,2);assert.equal((settings.match(/<model_instance>/g)||[]).length,3);
  assert.match(settings,/<metadata key="instance_id" value="1"\/>/);
  for(const instance of manifest.instances){
    const plate=manifest.plates.find(p=>p.id===instance.plate),object=manifest.objects.find(o=>o.objectId===instance.objectId);
    assert.deepEqual(plate.colors,object.colors);
    assert.deepEqual(instance.translation,instance.localTranslation.map((n,a)=>n+plate.origin[a]));
  }
  assert.ok(model.includes('1 0 0 0 1 0 0 0 1 221 5 0'),'second plate is positioned in Bambu grid coordinates');
  await assert.rejects(create3MF([entry(binary(tetra))],{plateOptions:{width:0}}),/有效/);
});

test('rotated native build transforms preserve source mesh scale, bed-facing Z and source coordinates',async()=>{
  const source=tetra.map(face=>face.map(v=>[v[0]*35/3+100,v[1]*35-20,v[2]+12]));
  const {model,manifest}=await unpack(await create3MF([entry(ascii(source),1,{copyColors:[['#FF0000']]})],{plateOptions:{width:100,depth:60,byColor:true}}));
  const mesh=meshes(model)[0];assert.deepEqual(mesh.triangles.map(face=>face.map(v=>mesh.vertices[v])),source);
  const instance=manifest.instances[0];assert.equal(instance.rotation,90);assert.equal(instance.instanceId,0);
  const transform=[...model.matchAll(/<item objectid="\d+" transform="([^"]+)"/g)][0][1].split(' ').map(Number);
  assert.deepEqual(transform.slice(0,9),[0,1,0,-1,0,0,0,0,1]);
  const projected=mesh.vertices.map(v=>[-v[1]+transform[9],v[0]+transform[10],v[2]+transform[11]]);
  assert.equal(Math.min(...projected.map(v=>v[2])),0);assert.equal(Math.max(...projected.map(v=>v[2])),4);
  assert.ok(projected.every(v=>v[0]>=5&&v[0]<=95&&v[1]>=5&&v[1]<=55));
});

test('Bambu Studio native importer preserves colors, plate assignments and painted component faces on roundtrip',{
  skip:!process.env.BAMBU_STUDIO_CLI,
},async()=>{
  const frames=[0,20].map(x=>({rotation:[[1,0,0],[0,1,0],[0,0,1]],origin:[x+1.5,1,2],min:[-1.5,-1,-2],max:[1.5,1,2]}));
  const entries=[entry(binary(tetra),2,{copyColors:[['#FF0000'],['#FF0000']]}),entry(binary(tetra),1,{id:'blue',copyColors:[['#0000FF']]}),entry(binary([...tetra,...moved(tetra,[20,0,0])]),1,{id:'mixed',copyColors:[['#FF0000','#0000FF']],colorFrames:frames})];
  const {blob}=await create3MF(entries,{plateOptions:{byColor:true,width:180,depth:180,nozzle:0.4}});
  const directory=await mkdtemp(join(tmpdir(),'vault-bambu-'));
  try{
    const input=join(directory,'input.3mf'),output=join(directory,'roundtrip.3mf');await writeFile(input,new Uint8Array(await blob.arrayBuffer()));
    const run=spawnSync(process.env.BAMBU_STUDIO_CLI,['--debug','3','--arrange','0','--orient','0','--export-3mf',output,input],{cwd:directory,encoding:'utf8',timeout:60000});
    assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
    const files=unzipSync(await readFile(output)),project=JSON.parse(strFromU8(files['Metadata/project_settings.config'])),settings=strFromU8(files['Metadata/model_settings.config']);
    assert.deepEqual(project.filament_colour,['#FF0000','#0000FF']);
    const plates=[...settings.matchAll(/<plate>([\s\S]*?)<\/plate>/g)];
    assert.equal(plates.length,3);assert.deepEqual(plates.map(p=>(p[1].match(/<model_instance>/g)||[]).length),[2,1,1]);
    const colors=Object.entries(files).filter(([p])=>p.endsWith('.model')).flatMap(([,bytes])=>[...strFromU8(bytes).matchAll(/paint_color="([^"]+)"/g)].map(m=>m[1]));
    assert.deepEqual(colors.sort(),[...Array(4).fill('4'),...Array(4).fill('8')].sort());
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('Bambu device selection writes real machine/material presets and survives native import and export',{
  skip:!process.env.BAMBU_STUDIO_CLI,
},async()=>{
  for(const [deviceId,nozzle,materialId,printer,filament] of [
    ['p1s',0.4,'petg','Bambu Lab P1S 0.4 nozzle','Generic PETG'],
    ['a1-mini',0.2,'pla','Bambu Lab A1 mini 0.2 nozzle','Generic PLA @BBL A1M 0.2 nozzle'],
    ['h2d-single',0.4,'pla','Bambu Lab H2D 0.4 nozzle','Generic PLA @BBL H2D'],
  ]){
    const options={byColor:true,deviceId,nozzle,materialId},palette=[['#FFFFFF'],['#FF0000']];
    const result=await create3MF([entry(binary(tetra),2,{copyColors:palette})],{plateOptions:options}),original=await unpack(result);
    const config=JSON.parse(strFromU8(original.files['Metadata/project_settings.config']));
    assert.equal(config.printer_settings_id,printer);assert.deepEqual(config.filament_settings_id,[filament,filament]);assert.equal(config.different_settings_to_system.length,4);
    assert.ok(Object.keys(config).every(key=>!key.toLowerCase().includes('gcode')));
    const directory=await mkdtemp(join(tmpdir(),'vault-device-'));
    try{
      const input=join(directory,'input.3mf'),output=join(directory,'roundtrip.3mf');await writeFile(input,new Uint8Array(await result.blob.arrayBuffer()));
      const run=spawnSync(process.env.BAMBU_STUDIO_CLI,['--debug','3','--arrange','0','--orient','0','--export-3mf',output,input],{cwd:directory,encoding:'utf8',timeout:60000});
      assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
      const files=unzipSync(await readFile(output)),project=JSON.parse(strFromU8(files['Metadata/project_settings.config']));
      assert.equal(project.printer_settings_id,printer);assert.deepEqual(project.filament_settings_id,[filament,filament]);
      assert.deepEqual(project.filament_colour,['#FFFFFF','#FF0000']);
      assert.equal((strFromU8(files['Metadata/model_settings.config']).match(/<plate>/g)||[]).length,2);
    }finally{await rm(directory,{recursive:true,force:true});}
  }
});

test('missing Bambu material selection fails before reading a potentially large model',async()=>{
  let reads=0;
  await assert.rejects(create3MF([entry({size:134,slice(){reads++;throw Error('must not read');}})],{plateOptions:{byColor:true,deviceId:'p1s',nozzle:0.4}}),/耗材/);
  assert.equal(reads,0);
});

test('translated build copies do not overlap in XY and each rests at z=0; no rotation or scale',async()=>{
  const {model,manifest}=await unpack(await create3MF([entry(binary(moved(tetra,[100,200,-12])),4)]));
  const items=[...model.matchAll(/<item objectid="(\d+)" transform="([^"]+)"/g)].map(m=>m[2].split(' ').map(Number));
  const boxes=manifest.instances.map((instance,index)=>{
    assert.deepEqual(items[index].slice(0,9),[1,0,0,0,1,0,0,0,1]);
    const object=manifest.objects.find(o=>o.objectId===instance.objectId);
    const bounds=object.bbox.map(p=>p.map((v,a)=>v+instance.translation[a]));
    assert.equal(bounds[0][2],0);assert.ok(bounds[0][0]>=0&&bounds[0][1]>=0);
    return bounds;
  });
  for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++){
    assert.ok(boxes[a][1][0]<boxes[b][0][0]||boxes[b][1][0]<boxes[a][0][0]||boxes[a][1][1]<boxes[b][0][1]||boxes[b][1][1]<boxes[a][0][1]);
  }
});

test('one STL containing a pair stays one complete object; copies multiply complete file, not individual shells',async()=>{
  const pair=[...tetra,...moved(tetra,[20,0,0])];
  const {model,manifest}=await unpack(await create3MF([entry(binary(pair),2)]));
  const parsed=meshes(model);
  assert.equal(parsed.length,1);assert.equal(parsed[0].triangles.length,8);assert.equal(parsed[0].vertices.length,8);
  assert.equal(manifest.instances.length,2);assert.equal(manifest.objects[0].bbox[1][0],23);
});

test('XML text is escaped, control chars excluded, and file paths are not emitted',async()=>{
  const control=String.fromCharCode(1),id=['C:','private','id'].join('/'),name=['E:','models','A<&"'+control+'.stl'].join('/');
  const {model,manifest}=await unpack(await create3MF([entry(binary(tetra),1,{id,name})],{title:'Test <&"'+String.fromCharCode(2)}));
  assert.match(model,/name="A&lt;&amp;&quot;\.stl"/);
  assert.match(model,/<metadata name="Title">Test &lt;&amp;&quot;<\/metadata>/);
  assert.ok(!model.includes('private')&&!model.includes('E:')&&!model.includes(control));
  assert.equal(manifest.objects[0].name,'A<&".stl');
});

test('XML text excludes forbidden BMP noncharacters and repairs a surrogate cut by truncation',async()=>{
  const title='a'.repeat(199)+String.fromCodePoint(0x1f600),noncharacters=String.fromCharCode(0xfffe,0xffff),replacement=String.fromCharCode(0xfffd);
  const {model,manifest}=await unpack(await create3MF([entry(binary(tetra),1,{name:'name'+noncharacters+'.stl'})],{title}));
  assert.ok(Array.from(noncharacters).every(character=>!model.includes(character)));
  assert.equal(manifest.objects[0].name,'name.stl');
  assert.ok(manifest.title.isWellFormed());assert.equal(manifest.title,'a'.repeat(199)+replacement);
  assert.ok(model.includes('<metadata name="Title">'+'a'.repeat(199)+replacement+'</metadata>'));
});

test('unique-vertex and compressed-output limits reject the boundary plus one with fixed production limits',()=>{
  const budget=createExportBudget();
  budget.vertexCount(EXPORT_LIMITS.vertices);
  assert.throws(()=>budget.vertexCount(EXPORT_LIMITS.vertices+1),/400 万/);
  budget.compressedBytes(EXPORT_LIMITS.zipBytes-1);budget.compressedBytes(1);
  assert.throws(()=>budget.compressedBytes(1),/512 MiB/);
  assert.ok(Object.isFrozen(EXPORT_LIMITS));
});

test('decimal XML preserves very small, negative, large and signed-zero coordinates',()=>{
  for(const value of [0,-0,1e-40,-3.4e-9,1.234e22,-1e30,1.25]){
    const rendered=decimal(value);assert.ok(!/[eE]/.test(rendered));assert.equal(Number(rendered),value===0?0:value);
  }
  assert.throws(()=>decimal(Infinity));
});

test('rejects bad counts, missing files, oversized jobs and duplicate identities before export',()=>{
  for(const quantity of [0,-1,1.5,NaN,Infinity])assert.throws(()=>validateExportEntries([entry(binary(tetra),quantity)]));
  assert.throws(()=>validateExportEntries([]));assert.throws(()=>validateExportEntries([entry(null)]));
  assert.throws(()=>validateExportEntries([entry(binary(tetra)),entry(binary(tetra))]),/重复/);
  assert.throws(()=>validateExportEntries([entry(binary(tetra),EXPORT_LIMITS.instances+1)]),/分批/);
  assert.throws(()=>validateExportEntries([entry({size:EXPORT_LIMITS.fileBytes+1,slice(){}})]),/512 MiB/);
});

test('invalid / truncated meshes fail without producing a partial archive',async()=>{
  await assert.rejects(create3MF([entry(new Blob(['solid bad\nfacet normal 0 0 1\nendsolid']))]),/ASCII/);
  await assert.rejects(create3MF([entry(new Blob(['solid empty\nendsolid empty\n']))]),/三角面/);
  const nan=binary(tetra),bytes=new Uint8Array(await nan.arrayBuffer());new DataView(bytes.buffer).setFloat32(96,NaN,true);
  await assert.rejects(create3MF([entry(new Blob([bytes]))]),/无效顶点/);
  await assert.rejects(create3MF([entry(binary(tetra).slice(0,-1))]),/ASCII/);
  const short={size:84,slice(){return new Blob([new Uint8Array(2)]);}};
  await assert.rejects(create3MF([entry(short)]),/读取不完整/);
});

test('only exact duplicate-vertex zero-area faces are skipped, counted, and excluded from bounds without changing source bytes',async()=>{
  const degenerate=[[999,999,999],[999,999,999],[9999,9999,9999]],source=[...tetra,degenerate];
  for(const file of [binary(source),ascii(source)]){
    const before=await hash(file),{model,manifest}=await unpack(await create3MF([entry(file)]));
    const object=manifest.objects[0];
    assert.equal(object.sourceTriangles,5);assert.equal(object.discardedDegenerateTriangles,1);assert.equal(object.triangles,4);
    assert.equal(manifest.sourceTriangles,5);assert.equal(manifest.discardedDegenerateTriangles,1);assert.equal(manifest.triangles,4);
    assert.deepEqual(object.bbox,[[0,0,0],[3,2,4]]);assert.equal(object.vertices,4);
    const parsed=meshes(model)[0];assert.deepEqual(parsed.triangles.map(face=>face.map(v=>parsed.vertices[v])),tetra);
    assert.equal(await hash(file),before);
  }
});

test('fewer than four valid faces still fail; no tolerance-based or general degenerate-face repair is performed',async()=>{
  const degenerate=[[0,0,0],[-0,0,0],[0,1,0]];
  await assert.rejects(create3MF([entry(binary(tetra.slice(0,3)))]),/有效三角面少于 4 个/);
  await assert.rejects(create3MF([entry(ascii([tetra[0]]))]),/有效三角面少于 4 个/);
  await assert.rejects(create3MF([entry(binary([...tetra.slice(0,3),degenerate]))]),/有效三角面少于 4 个/);
  await assert.rejects(create3MF([entry(binary(Array(4).fill(degenerate)))]),/有效三角面少于 4 个/);
  const distinct=[...tetra,[[100,0,0],[100+1e-10,0,0],[100,1,0]],[[10,0,0],[11,0,0],[12,0,0]]];
  const {manifest}=await unpack(await create3MF([entry(ascii(distinct))]));
  assert.equal(manifest.sourceTriangles,6);assert.equal(manifest.triangles,6);assert.equal(manifest.discardedDegenerateTriangles,0);
});

test('cancellation before and during parsing rejects with AbortError and cannot report success',async()=>{
  const before=new AbortController();before.abort();
  await assert.rejects(export3MF([entry(binary(tetra))],{signal:before.signal}),{name:'AbortError'});
  const during=new AbortController();let complete=false;
  await assert.rejects(create3MF([entry(binary(tetra))],{signal:during.signal,onProgress:p=>{if(p.phase==='reading')during.abort();if(p.phase==='complete')complete=true;}}),{name:'AbortError'});
  assert.equal(complete,false);
});

test('above preview simplification threshold, every original face remains in exported 3MF',async()=>{
  const count=1000001,sample=new Uint8Array(await binary([tetra[0]]).arrayBuffer()),header=sample.slice(0,84);
  new DataView(header.buffer).setUint32(80,count,true);const record=sample.subarray(84);
  const virtual={size:84+count*50,slice(start,end){
    assert.ok(end-start<=1024*1024,'reads remain bounded');
    const bytes=new Uint8Array(end-start);let at=0;
    while(start+at<84&&at<bytes.length){bytes[at]=header[start+at];at++;}
    const body=bytes.subarray(at),first=Math.min(50,body.length);
    for(let i=0;i<first;i++)body[i]=record[(start+at-84+i)%50];
    for(let filled=first;filled<body.length;){const next=Math.min(filled,body.length-filled);body.set(body.subarray(0,next),filled);filled+=next;}
    return new Blob([bytes]);
  }};
  const {model,manifest}=await unpack(await create3MF([entry(virtual,1,{copyColors:[['#FF6B24']]})]));
  assert.equal(manifest.objects[0].triangles,count);
  assert.equal((model.match(/<triangle /g)||[]).length,count);
  assert.equal(manifest.objects[0].vertices,3);
});
