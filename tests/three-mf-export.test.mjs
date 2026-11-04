import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'three/addons/libs/fflate.module.js';
import {create3MF,export3MF,validateExportEntries} from '../src/three-mf-export.js';
import {decimal,EXPORT_LIMITS,createExportBudget} from '../src/three-mf-core.js';

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
    triangles:Array.from(match[2].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g),v=>v.slice(1).map(Number)),
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
  const {model,manifest}=await unpack(await create3MF([entry(virtual)]));
  assert.equal(manifest.objects[0].triangles,count);
  assert.equal((model.match(/<triangle /g)||[]).length,count);
  assert.equal(manifest.objects[0].vertices,3);
});
