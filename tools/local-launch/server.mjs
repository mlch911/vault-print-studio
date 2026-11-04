import http from 'node:http';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {readFile, realpath, stat, lstat, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';

export const APP_ID = 'vault-print-studio-local-enhanced';
export const DEFAULT_PORT = 5187;
const types = new Map(Object.entries({
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.wasm':'application/wasm',
  '.pdf':'application/pdf', '.svg':'image/svg+xml', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp',
  '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8',
}));
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative);
}
function secretEqual(value, expected) {
  if(typeof value !== 'string') return false;
  const a=Buffer.from(value), b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
function respond(res,status,text,extra={}) {
  res.writeHead(status, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store',...extra});
  res.end(text);
}

// Only the supplied static dist directory is served. Models and progress are
// never read by this server; they remain browser File objects and local storage.
export async function startLocalServer({root,port=DEFAULT_PORT,instanceId,controlToken,version='local',onListening}={}) {
  if(!root || !instanceId || !/^[a-f0-9]{64}$/.test(controlToken||'')) throw Error('Invalid local server configuration');
  if((await lstat(root)).isSymbolicLink()) throw Error('Static root cannot be a symbolic link');
  const rootReal=await realpath(root);
  if(!(await stat(path.join(rootReal,'index.html'))).isFile()) throw Error('Missing dist/index.html');
  let expectedHost,origin;
  const server=http.createServer(async (req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    if(req.headers.host!==expectedHost) return respond(res,403,'Invalid host');
    const rawPath=String(req.url||'').split('?')[0];
    if(rawPath==='/__vault/health') {
      if(req.method!=='GET'&&req.method!=='HEAD') return respond(res,405,'Method not allowed',{Allow:'GET, HEAD'});
      const body=JSON.stringify({appId:APP_ID,instanceId,version,port:server.address().port,pid:process.pid});
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(req.method==='HEAD'?'':body);
    }
    if(rawPath==='/__vault/stop') {
      if(req.method!=='POST') return respond(res,405,'Method not allowed',{Allow:'POST'});
      if(req.headers.origin && req.headers.origin!==origin) return respond(res,403,'Invalid origin');
      if(!secretEqual(req.headers['x-vault-control'],controlToken)) return respond(res,403,'Invalid control token');
      req.resume();
      res.on('finish',()=>{server.close();server.closeIdleConnections?.();});
      return respond(res,200,'VAULT local server stopped');
    }
    if(req.method!=='GET'&&req.method!=='HEAD') return respond(res,405,'Method not allowed',{Allow:'GET, HEAD'});
    let pathname;
    try{pathname=decodeURIComponent(rawPath);}catch{return respond(res,400,'Invalid URL');}
    if(!pathname.startsWith('/')||pathname.includes('\\')||pathname.includes('\0')||pathname.split('/').some(p=>p==='..'||p==='.')||pathname.includes(':')) return respond(res,400,'Invalid path');
    if(pathname==='/') pathname='/index.html';
    const candidate=path.resolve(rootReal,'.'+pathname);
    if(!inside(rootReal,candidate)) return respond(res,403,'Invalid path');
    try{
      const resolved=await realpath(candidate);
      if(!inside(rootReal,resolved)) return respond(res,403,'Invalid path');
      // Reject symbolic links anywhere below dist, including links pointing in.
      let component=rootReal;
      for(const segment of path.relative(rootReal,candidate).split(path.sep)) {
        component=path.join(component,segment);
        if((await lstat(component)).isSymbolicLink()) return respond(res,403,'Symbolic links are not served');
      }
      const info=await stat(resolved);
      if(!info.isFile()) return respond(res,404,'Not found');
      const type=types.get(path.extname(resolved).toLowerCase())||'application/octet-stream';
      res.writeHead(200,{'Content-Type':type,'Content-Length':info.size,'Cache-Control':'no-cache'});
      if(req.method==='HEAD') return res.end();
      const stream=createReadStream(resolved);
      stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
    }catch(error){
      if(!res.headersSent) respond(res,error.code==='ENOENT'||error.code==='ENOTDIR'?404:500,'File unavailable');
      else res.destroy();
    }
  });
  server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
  });
  expectedHost='127.0.0.1:'+server.address().port;origin='http://'+expectedHost;
  server.on('error',error=>process.stderr.write(error.message+'\n'));
  try{await onListening?.({origin,port:server.address().port,pid:process.pid});}
  catch(error){server.close();server.closeIdleConnections?.();throw error;}
  return {server,origin,close:()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections?.();})};
}

async function main(){
  const appRoot=path.dirname(fileURLToPath(import.meta.url));
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--control-file') throw Error('Usage: node server.mjs --control-file runtime.json');
  const controlPath=path.resolve(args[1]);
  if(!inside(path.join(appRoot,'.launcher'),controlPath)) throw Error('Control file must be within .launcher');
  const config=JSON.parse((await readFile(controlPath,'utf8')).replace(/^\uFEFF/,''));
  if(config.appId!==APP_ID||config.port!==DEFAULT_PORT||typeof config.instanceId!=='string') throw Error('Invalid launcher state');
  let version='0.2.4-local';
  try{version=JSON.parse(await readFile(path.join(appRoot,'dist/version.json'),'utf8')).version||version;}catch{}
  await startLocalServer({root:path.join(appRoot,'dist'),port:DEFAULT_PORT,instanceId:config.instanceId,controlToken:config.controlToken,version,
    onListening:async ({pid,port})=>{
      await writeFile(controlPath,JSON.stringify({...config,pid,port,status:'running',startedAt:new Date().toISOString()},null,2),'utf8');
      process.stdout.write('VAULT ready at http://127.0.0.1:'+port+'\n');
    }});
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{process.stderr.write((error.code==='EADDRINUSE'?'Port 5187 is already in use. ': '')+error.message+'\n');process.exitCode=1;});
