import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {APP_ID,startLocalServer} from '../tools/local-launch/server.mjs';

const token='a'.repeat(64);
async function fixture(t){
  const base=await mkdtemp(path.join(tmpdir(),'vault-local-server-'));
  const root=path.join(base,'dist');await mkdir(root);
  await writeFile(path.join(root,'index.html'),'<!doctype html><h1>VAULT test</h1>');
  await writeFile(path.join(root,'module.js'),'export const test=1;');
  await writeFile(path.join(root,'version.json'),'{}');
  await writeFile(path.join(root,'test.pdf'),'%PDF');
  await writeFile(path.join(root,'test.wasm'),'wasm');
  await writeFile(path.join(root,'中文 名称.txt'),'本地');
  await writeFile(path.join(base,'private.txt'),'Never serve this');
  const active=[];
  t.after(async()=>{
    for(const s of active)await s.close();
    assert.equal(path.dirname(path.resolve(base)),path.resolve(tmpdir()));
    assert.ok(path.basename(base).startsWith('vault-local-server-'));
    await rm(base,{recursive:true,force:true});
  });
  return {base,root,start:async options=>{const s=await startLocalServer({root,port:0,instanceId:'test-installation',controlToken:token,version:'test',...options});active.push(s);return s;}};
}
async function request(origin,rawPath,{method='GET',headers={}}={}){
  const url=new URL(origin);
  return await new Promise((resolve,reject)=>{
    const req=http.request({hostname:url.hostname,port:url.port,path:rawPath,method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });req.on('error',reject);req.end();
  });
}
test('serves dist only with browser-compatible MIME, no-cache and HEAD',async t=>{
  const f=await fixture(t),s=await f.start();
  for(const [file,mime]of [['/','text/html'],['/module.js','text/javascript'],['/version.json','application/json'],['/test.pdf','application/pdf'],['/test.wasm','application/wasm']]){
    const r=await request(s.origin,file);assert.equal(r.status,200);assert.ok(r.headers['content-type'].startsWith(mime));assert.equal(r.headers['cache-control'],'no-cache');assert.equal(r.headers['x-content-type-options'],'nosniff');
  }
  const head=await request(s.origin,'/module.js',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body,'');assert.ok(Number(head.headers['content-length'])>0);
  assert.equal((await request(s.origin,'/'+encodeURIComponent('中文 名称.txt'))).body,'本地');
  assert.equal((await request(s.origin,'/unknown.js')).status,404);
  assert.equal((await request(s.origin,'/module.js',{method:'POST'})).status,405);
});
test('rejects raw and encoded path traversal and wrong Host',async t=>{
  const f=await fixture(t),s=await f.start();
  for(const p of ['/../private.txt','/%2e%2e/private.txt','/%2E%2E%2fprivate.txt','/..\\private.txt','/%00','/C:/private.txt']){
    const r=await request(s.origin,p);assert.equal(r.status,400,p);assert.ok(!r.body.includes('Never serve'));
  }
  assert.equal((await request(s.origin,'/%252e%252e/private.txt')).status,404);
  assert.equal((await request(s.origin,'/',{headers:{Host:'attacker.example'}})).status,403);
  assert.equal((await request(s.origin,'/__vault/health',{headers:{Host:'localhost:'+new URL(s.origin).port}})).status,403);
});
test('rejects symbolic link escape and does not list directories',async t=>{
  const f=await fixture(t),s=await f.start();
  await mkdir(path.join(f.root,'folder'));
  assert.equal((await request(s.origin,'/folder/')).status,404);
  await symlink(f.base,path.join(f.root,'external'),'junction');
  assert.equal((await request(s.origin,'/external/private.txt')).status,403);
  assert.equal((await request(s.origin,'/external/dist/index.html')).status,403);
});
test('health identifies the installation without exposing secret or local paths',async t=>{
  const f=await fixture(t),s=await f.start();
  const r=await request(s.origin,'/__vault/health'),data=JSON.parse(r.body);
  assert.equal(data.appId,APP_ID);assert.equal(data.instanceId,'test-installation');assert.equal(data.version,'test');
  assert.equal(data.port,Number(new URL(s.origin).port));assert.equal(r.headers['cache-control'],'no-store');
  assert.ok(!r.body.includes(token));assert.ok(!r.body.includes(f.root));assert.equal(r.headers['access-control-allow-origin'],undefined);
});
test('only token-authenticated local POST can stop the matching service',async t=>{
  const f=await fixture(t),s=await f.start();
  assert.equal((await request(s.origin,'/__vault/stop')).status,405);
  assert.equal((await request(s.origin,'/__vault/stop',{method:'POST'})).status,403);
  assert.equal((await request(s.origin,'/__vault/stop',{method:'POST',headers:{'X-Vault-Control':'wrong'}})).status,403);
  assert.equal((await request(s.origin,'/__vault/stop',{method:'POST',headers:{'X-Vault-Control':token,Origin:'https://attacker.example'}})).status,403);
  assert.equal((await request(s.origin,'/__vault/health')).status,200);
  const closed=once(s.server,'close');
  const stopped=await request(s.origin,'/__vault/stop',{method:'POST',headers:{'X-Vault-Control':token,Origin:s.origin}});
  assert.equal(stopped.status,200);await closed;
});
test('port collision is reported without stopping the existing service',async t=>{
  const f=await fixture(t),s=await f.start();
  await assert.rejects(f.start({port:Number(new URL(s.origin).port),instanceId:'another-installation'}),{code:'EADDRINUSE'});
  const health=JSON.parse((await request(s.origin,'/__vault/health')).body);assert.equal(health.instanceId,'test-installation');
});
test('missing build and invalid control token fail before listening',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.start({controlToken:'short'}),/Invalid local server/);
  await assert.rejects(f.start({root:f.base}),{code:'ENOENT'});
});
