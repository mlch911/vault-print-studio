import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, relative, extname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import manualBooks from '../src/manual-library.json' with {type:'json'};

// Read-only release audit. Does not run Git mutations, upload, or copy files.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ROOT_FILES = new Set(['index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '.gitignore', '.gitattributes']);
const ROOT_DIRS = new Set(['.github', 'scripts', 'src', 'tests']);
const LAUNCH_FILES = new Set(['server.mjs','launch.ps1','stop.ps1','open-enhanced.cmd','stop-enhanced.cmd','LOCAL-LAUNCH.txt','smoke-launch.ps1'].map(name=>'tools/local-launch/'+name));
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.html', '.css', '.md', '.yml', '.yaml']);
const ASSET_EXTENSIONS = new Set(('.stl .obj .3mf .ply .off .dae .fbx .blend .step .stp .iges .igs .gcode .glb .gltf .bin .wasm .pdf .png .jpg .jpeg .webp .gif .avif .svg .ico .bmp .tif .tiff .psd .ai .eps .exr .hdr .mp4 .webm .mov .avi .mp3 .wav .ogg .flac .woff .woff2 .ttf .otf .eot .zip .gz .tgz .tar .bz2 .xz .br .7z .rar .zst .doc .docx .ppt .pptx .xls .xlsx .map').split(' '));
const PAYLOAD_KEYS = new Set(['vertices', 'positions', 'normals', 'indices', 'faces', 'uvs', 'meshdata', 'geometrydata', 'meshpayload', 'previewmesh', 'triangleindices', 'triangleids', 'membership', 'memberships', 'selectors', 'selector', 'runs']);
const CATALOG_KEYS = new Set(['id', 'old', 'name', 'zh', 'system', 'size', 'bbox', 'triangles', 'fingerprint', 'contentSignature', 'geometrySignature', 'geometryArea', 'variants']);
const FRAME_KEYS = new Set(['rotation', 'origin', 'min', 'max', 'extent', 'hingeRotation', 'hingeMin', 'hingeMax', 'hingeBarrel', 'barrelSide']);
const CATALOG_COUNT = 733;
const SOURCE_LIMIT = 2 * 1024 * 1024;
const DIST_LIMIT = 4 * 1024 * 1024;
const TOTAL_LIMIT = 24 * 1024 * 1024;
const MANUAL_LIMIT = 80 * 1024 * 1024; // Includes both source and copied distribution PDFs.
const MANUAL_RECORDS = new Map(manualBooks.flatMap(book=>['en','zh'].map(language=>[book.files[language].path,book.files[language]])));
const manualRecord=(path,dist=false)=>MANUAL_RECORDS.get(dist?path:path.startsWith('public/')?path.slice(7):'');
function manualProblems(bytes,record){
  const issues=[];
  if(bytes.length!==record.size||bytes.length>12*1024*1024)issues.push('manual size differs from reviewed manifest');
  if(bytes.subarray(0,5).toString('ascii')!=='%PDF-')issues.push('manual is not a PDF');
  if(createHash('sha256').update(bytes).digest('hex')!==record.sha256)issues.push('manual bytes differ from reviewed manifest');
  return issues;
}
const canonicalKey = key => key.toLowerCase().replace(/[^a-z]/g, '');
const forward = path => path.split(sep).join('/');
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const matrix = value => Array.isArray(value) && value.length === 3 && value.every(vector);
const normalizedText = value => value.replace(/\r\n/g, '\n').trim();

function pathProblems(path, dist = false) {
  const issues = [];
  if (!path || path.includes('\\') || path.startsWith('/') || path.split('/').some(part => part === '..' || part === '.')) issues.push('unsafe relative path');
  const extension = extname(path).toLowerCase();
  const manual=manualRecord(path,dist);
  if (ASSET_EXTENSIONS.has(extension)&&!manual) issues.push('model, media, unlisted document, archive or binary asset is forbidden');
  if (/(^|\/)(?:node_modules|private|local-models|\.git|coverage)(\/|$)/i.test(path)) issues.push('non-release directory');
  if (/(^|\/)(?:\.env(?:\..*)?|\.npmrc|credentials(?:\..*)?|id_rsa|id_ed25519)$/i.test(path) || /\.(?:pem|p12|pfx|key)$/i.test(path)) issues.push('credential file');
  if (dist) {
    if (!manual&&!['index.html', 'version.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '.nojekyll'].includes(path) && !/^assets\/[a-zA-Z0-9_.-]+\.(?:js|mjs|css)$/.test(path)) issues.push('unexpected static output path');
  } else if (!manual&&!ROOT_FILES.has(path)&&!LAUNCH_FILES.has(path) && !(ROOT_DIRS.has(path.split('/')[0]) && SOURCE_EXTENSIONS.has(extension))) issues.push('outside the source release allowlist');
  return issues;
}

function jsonProblems(value, context = '$', depth = 0, issues = []) {
  if (depth > 35) { issues.push(`${context}: excessively nested data`); return issues; }
  if (Array.isArray(value)) {
    if (value.length > 64 && value.every(item => typeof item === 'number')) issues.push(`${context}: large numeric payload`);
    value.forEach((item, i) => jsonProblems(item, `${context}[${i}]`, depth + 1, issues));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const normalized = canonicalKey(key);
      if (PAYLOAD_KEYS.has(normalized)) issues.push(`${context}.${key}: geometry/membership payload key`);
      if (normalized === 'triangles' && (!Number.isSafeInteger(item) || item < 0)) issues.push(`${context}.${key}: triangle metadata must be a numeric count`);
      jsonProblems(item, `${context}.${key}`, depth + 1, issues);
    }
  }
  return issues;
}

function catalogProblems(records) {
  const issues = [];
  if (!Array.isArray(records) || records.length !== CATALOG_COUNT) return [`catalog must contain exactly ${CATALOG_COUNT} factual records`];
  const ids = new Set();
  for (const [i, record] of records.entries()) {
    const at = `catalog[${i}]`;
    if (!record || typeof record !== 'object' || Array.isArray(record)) { issues.push(`${at}: invalid record`); continue; }
    if (Object.keys(record).some(key => !CATALOG_KEYS.has(key))) issues.push(`${at}: unexpected metadata field`);
    if (!/^m\d{4}$/.test(record.id) || ids.has(record.id)) issues.push(`${at}: invalid/duplicate id`);
    ids.add(record.id);
    if (!['drawer', 'sustainer', 'mods'].includes(record.system)) issues.push(`${at}: unknown system`);
    if (!Number.isSafeInteger(record.size) || record.size < 1 || !Number.isSafeInteger(record.triangles) || record.triangles < 1) issues.push(`${at}: invalid size/triangle count`);
    if (!/^[a-f0-9]{64}$/.test(record.fingerprint)) issues.push(`${at}: invalid matching signature`);
    if ('contentSignature' in record && !/^[a-f0-9]{64}$/.test(record.contentSignature)) issues.push(`${at}: invalid content signature`);
    if ('geometrySignature' in record && !/^[a-f0-9]{64}$/.test(record.geometrySignature)) issues.push(`${at}: invalid geometry signature`);
    if ('geometryArea' in record && (!Number.isFinite(record.geometryArea) || record.geometryArea < 0)) issues.push(`${at}: invalid surface-area metadata`);
    if('variants' in record){
      const allowed=new Set(['size','triangles','bbox','contentSignature','geometrySignature','geometryArea','piecesPerFile','referencePiecesPerFile','previewAligned','sourceFrames','transforms','note','requiresConfirmation']);
      if(!Array.isArray(record.variants)||record.variants.length>8)issues.push(`${at}: invalid version list`);
      else for(const v of record.variants){
        if(Object.keys(v).some(k=>!allowed.has(k))||!Number.isSafeInteger(v.size)||v.size<1||!Number.isSafeInteger(v.triangles)||v.triangles<1||!['contentSignature','geometrySignature'].every(k=>/^[a-f0-9]{64}$/.test(v[k])))issues.push(`${at}: invalid version identity`);
        if(!Array.isArray(v.bbox)||v.bbox.length!==2||!v.bbox.every(vector)||typeof v.previewAligned!=='boolean'||!Number.isInteger(v.referencePiecesPerFile)||v.referencePiecesPerFile<1||v.referencePiecesPerFile>32||v.piecesPerFile!==null&&(!Number.isInteger(v.piecesPerFile)||v.piecesPerFile<1||v.piecesPerFile>32))issues.push(`${at}: invalid version quantity/bounds`);
        issues.push(...frameProblems({[record.id]:v.sourceFrames},true,new Set([record.id])));
        if(!Array.isArray(v.transforms)||v.transforms.length!==v.sourceFrames?.length||v.transforms.some(t=>Object.keys(t).some(k=>!['rotation','translation'].includes(k))||!matrix(t.rotation)||!vector(t.translation)))issues.push(`${at}: invalid rigid preview transforms`);
        if(typeof v.note!=='string'||v.note.length>300)issues.push(`${at}: invalid version note`);
      }
    }
    for (const key of ['old', 'name', 'zh']) if (typeof record[key] !== 'string' || !record[key].trim() || record[key].length > 500) issues.push(`${at}: invalid ${key}`);
    if (typeof record.old === 'string' && (/^(?:[a-z]:|[\\/])/i.test(record.old) || record.old.split(/[\\/]/).includes('..'))) issues.push(`${at}: original path must be relative`);
    if (!Array.isArray(record.bbox) || record.bbox.length !== 2 || !record.bbox.every(vector) || record.bbox[0].some((v, axis) => v > record.bbox[1][axis])) issues.push(`${at}: invalid bounding box`);
  }
  return issues;
}

function frameProblems(data, multiple, ids) {
  if (!data || Array.isArray(data) || typeof data !== 'object') return ['frame metadata must be an object'];
  const issues = [];
  for (const [id, value] of Object.entries(data)) {
    if (!ids.has(id)) issues.push(`${id}: frame ID is absent from catalog`);
    const frames = multiple ? value : [value];
    if (!Array.isArray(frames) || !frames.length || frames.length > 32) { issues.push(`${id}: invalid frame count`); continue; }
    for (const frame of frames) {
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) { issues.push(`${id}: invalid frame`); continue; }
      for (const [key, item] of Object.entries(frame)) {
        if (!FRAME_KEYS.has(key)) issues.push(`${id}: forbidden frame field ${key}`);
        else if (key === 'barrelSide') { if (!['top', 'bottom', 'left', 'right'].includes(item)) issues.push(`${id}: invalid barrel side`); }
        else if (key.endsWith('Rotation') || key === 'rotation') { if (!matrix(item)) issues.push(`${id}: invalid rotation matrix`); }
        else if (!vector(item)) issues.push(`${id}: expected a three-number frame vector`);
      }
      for (const key of ['rotation', 'origin', 'min', 'max']) if (!(key in frame)) issues.push(`${id}: missing frame field ${key}`);
    }
  }
  return issues;
}

function textProblems(text, { dist = false, json = false } = {}) {
  const issues = [];
  if (text.includes('\u0000') || text.includes('\ufffd')) issues.push('binary or invalid UTF-8 content');
  const checks = [
    [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'private key material'],
    [/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/, 'credential-like token'],
    [/\bsk-[A-Za-z0-9_-]{32,}\b/, 'credential-like API key'],
    [/(?:api[_-]?key|secret|password|access[_-]?token)\s*[=:]\s*["'][A-Za-z0-9+/_=-]{20,}["']/i, 'embedded credential assignment'],
    [/(?:^|[\s"'`(])[a-z]:[\\/]|(?:^|[\s"'`])\\\\[a-z0-9_.-]+\\/im, 'absolute local drive or share path'],
    [/(?:^|[\s"'`(])\/(?:Users|home|Volumes|mnt|private|tmp|etc|var|opt|root|srv|run|workspace|workspaces)\/[A-Za-z0-9_.-]+\//m, 'absolute local directory path'],
    [/data:[^\s"'`]{0,100};base64,[a-z0-9+/=\r\n]{128,}/i, 'embedded base64 asset'],
    [/["'`][A-Za-z0-9+/_=-]{4096,}["'`]/, 'oversized encoded string'],
    [/^\s*solid[^\r\n]*\r?\n\s*facet\s+normal\s+[-+\d.]/m, 'raw ASCII STL content'],
  ];
  for (const [pattern, message] of checks) if (pattern.test(text)) issues.push(message);
  // Keyed literal arrays identify embedded data; property accesses and runtime
  // Three.js BufferGeometry/typed-array operations are not geometry payloads.
  if (/(?:["']?(?:vertices|positions|normals|indices|faces|uvs|triangles|selectors|runs)["']?)\s*:\s*\[/i.test(text)) issues.push('literal geometry/membership array');
  if (!json) {
    // Bundled Three.js contains legitimate small lookup tables. Source is stricter.
    const count = dist ? 4096 : 256;
    // Scan number runs linearly. A repeated ambiguous numeric regex can
    // backtrack exponentially on a normal minified dependency lookup table.
    const starts=/\[\s*(?=[+\-.\d])/g,number=/\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?\s*([,\]])/iy;
    for(let start;(start=starts.exec(text));){let position=starts.lastIndex,n=0;
      while(n<count){number.lastIndex=position;const token=number.exec(text);if(!token)break;position=number.lastIndex;n++;if(token[1]===']')break;}
      if(n>=count){issues.push('oversized numeric literal array');break;}
      starts.lastIndex=Math.max(starts.lastIndex,position);
    }
  }
  return issues;
}

async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

async function walk(root, start) {
  const result = [];
  async function visit(path) {
    const full = resolve(root, path), stat = await lstat(full);
    if (stat.isSymbolicLink() || !stat.isDirectory()) { result.push(forward(path)); return; }
    for (const entry of await readdir(full)) await visit(`${path}/${entry}`);
  }
  if (await exists(resolve(root, start))) await visit(start);
  return result;
}

async function sourcePaths(root) {
  const probe = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true });
  if (probe.status === 0 && probe.stdout.trim() === 'true') {
    const result = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--', '.'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    if (result.status !== 0) throw new Error('Cannot enumerate Git-tracked release files');
    return { mode: 'git-tracked', paths: [...new Set(result.stdout.split('\0').filter(Boolean))] };
  }
  const paths = [];
  for (const name of ROOT_FILES) if (await exists(resolve(root, name))) paths.push(name);
  for (const name of ROOT_DIRS) paths.push(...await walk(root, name));
  paths.push(...await walk(root,'public/manuals'));
  return { mode: 'source-allowlist', paths };
}

export async function auditRelease(root = ROOT, { requireDist = false } = {}) {
  root = resolve(root);
  const issues = [], jsonFiles = new Map(), texts = new Map();
  const { mode, paths } = await sourcePaths(root);
  let count = 0, bytes = 0,manualBytes=0;
  async function inspect(path, dist = false) {
    const problems = pathProblems(path, dist);
    const label = dist ? `dist/${path}` : path;
    const full = resolve(root, label);
    const rel = relative(root, full);
    if (rel.startsWith(`..${sep}`) || rel === '..') problems.push('resolved path escapes release root');
    if (problems.length) { issues.push(...problems.map(message => `${label}: ${message}`)); return; }
    let stat;
    try { stat = await lstat(full); } catch { issues.push(`${label}: tracked/required file is missing`); return; }
    // Git stores regular-file content, not hard-link identity; editor snapshots may add links.
    // Continue to inspect every byte and forbid symlinks/special files.
    if (stat.isSymbolicLink() || !stat.isFile()) { issues.push(`${label}: symbolic links and special files are forbidden`); return; }
    bytes += stat.size; count++;
    const record=manualRecord(path,dist);
    if(record){
      manualBytes+=stat.size;
      if(manualBytes>MANUAL_LIMIT){issues.push(`${label}: manual size budget exceeded`);return;}
      issues.push(...manualProblems(await readFile(full),record).map(message=>`${label}: ${message}`));return;
    }
    if (stat.size > (dist ? DIST_LIMIT : SOURCE_LIMIT) || bytes-manualBytes > TOTAL_LIMIT) { issues.push(`${label}: release size budget exceeded`); return; }
    const text = await readFile(full, 'utf8');
    texts.set(label, text);
    issues.push(...textProblems(text, { dist, json: extname(path) === '.json' }).map(message => `${label}: ${message}`));
    if (extname(path) === '.json') {
      try {
        const data = JSON.parse(text); jsonFiles.set(label, data);
        issues.push(...jsonProblems(data).slice(0, 30).map(message => `${label}: ${message}`));
      } catch { issues.push(`${label}: invalid JSON`); }
    }
  }
  for (const path of paths.sort()) await inspect(path);
  for (const required of [...ROOT_FILES, 'src/catalog.json', 'src/orientation.json', 'src/assembly-data.json','src/manual-library.json',...MANUAL_RECORDS.keys().map(path=>'public/'+path), 'scripts/audit-release.mjs', '.github/workflows/check.yml', '.github/workflows/pages.yml']) {
    if (!paths.includes(required)) issues.push(`${required}: required release file is not in the ${mode} set`);
  }
  const catalog = jsonFiles.get('src/catalog.json');
  issues.push(...catalogProblems(catalog).map(message => `src/catalog.json: ${message}`));
  const ids = new Set(Array.isArray(catalog) ? catalog.map(record => record?.id) : []);
  for (const [path, multiple] of [['src/orientation.json', false], ['src/assembly-data.json', true]]) issues.push(...frameProblems(jsonFiles.get(path), multiple, ids).map(message => `${path}: ${message}`));
  const notices = texts.get('THIRD_PARTY_NOTICES.md') ?? '';
  const license = texts.get('LICENSE') ?? '';
  if (!license.includes('Copyright (c) 2026 VAULT Print Studio contributors') || !license.includes('Permission is hereby granted, free of charge') || !license.includes('THE SOFTWARE IS PROVIDED "AS IS"')) issues.push('LICENSE: original-code MIT license is missing or incomplete');
  const pkg = jsonFiles.get('package.json');
  if (pkg?.dependencies?.vite || !pkg?.devDependencies?.vite) issues.push('package.json: Vite must be a development dependency only');
  if (!notices.includes('Copyright © 2010-2025 three.js authors') || !notices.includes('THE SOFTWARE IS PROVIDED "AS IS"')) issues.push('THIRD_PARTY_NOTICES.md: complete Three.js notice is required');
  const installedLicense = resolve(root, 'node_modules/three/LICENSE');
  if (await exists(installedLicense)) {
    const official = normalizedText(await readFile(installedLicense, 'utf8'));
    if (!normalizedText(notices).includes(official)) issues.push('THIRD_PARTY_NOTICES.md: installed Three.js license is not reproduced verbatim');
  }
  const pdfLicense=resolve(root,'node_modules/pdfjs-dist/LICENSE');
  if(pkg?.dependencies?.['pdfjs-dist']&&await exists(pdfLicense)&&!normalizedText(notices).includes(normalizedText(await readFile(pdfLicense,'utf8'))))issues.push('THIRD_PARTY_NOTICES.md: installed PDF.js license is not reproduced verbatim');
  const distRoot = resolve(root, 'dist');
  const hasDist = await exists(distRoot);
  if (hasDist) {
    const stat = await lstat(distRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) issues.push('dist: must be a real directory');
    else {
      const distPaths = (await walk(root, 'dist')).map(path => path.slice(5));
      for (const path of distPaths.sort()) await inspect(path, true);
      for(const path of MANUAL_RECORDS.keys())if(!distPaths.includes(path))issues.push(`dist/${path}: bundled manual missing`);
      if (!distPaths.includes('index.html') || !distPaths.some(path => path.endsWith('.js')) || !distPaths.some(path => path.endsWith('.css'))) issues.push('dist: incomplete static build');
      if (requireDist) for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
        if (!texts.has(`dist/${name}`) || normalizedText(texts.get(`dist/${name}`)) !== normalizedText(texts.get(name) ?? '')) issues.push(`dist/${name}: missing or stale distribution notice`);
      }
      // Verify actual emitted asset URLs work below a GitHub Pages project base.
      for (const match of (texts.get('dist/index.html') ?? '').matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        const url = match[1];
        if (/^(?:\/assets\/|\/src\/)/.test(url)) issues.push('dist/index.html: root-absolute asset URL breaks project-base deployment');
        if (url.startsWith('./assets/') && !distPaths.includes(url.slice(2))) issues.push('dist/index.html: referenced asset is missing');
      }
    }
  } else if (requireDist) issues.push('dist: build output is required');
  return { ok: issues.length === 0, issues: [...new Set(issues)], mode, scannedFiles: count, scannedBytes: bytes, distScanned: hasDist };
}

function selfTest() {
  let checks = 0;
  const check = (condition, message) => { assert.ok(condition, message); checks++; };
  for (const extension of ASSET_EXTENSIONS) check(pathProblems(`src/imported${extension.toUpperCase()}`).length > 0, `asset ${extension}`);
  check(!pathProblems('src/importer.js').length, 'source allowed');
  check(!pathProblems('assets/index-Ab1.js', true).length, 'bundled JS allowed');
  check(!pathProblems('public/manuals/drawer-en.pdf').length,'reviewed source manual allowed');
  check(!pathProblems('manuals/drawer-en.pdf',true).length,'reviewed distribution manual allowed');
  check(pathProblems('public/manuals/arbitrary.pdf').length>0,'unlisted manual blocked');
  check(pathProblems('manuals/model.stl',true).length>0,'model beside manuals blocked');
  check(manualProblems(Buffer.from('%PDF-incorrect'),MANUAL_RECORDS.get('manuals/drawer-en.pdf')).length>0,'altered listed PDF blocked');
  check(manualProblems(Buffer.from('solid fake'),MANUAL_RECORDS.get('manuals/drawer-en.pdf')).length>0,'model renamed to reviewed PDF blocked');
  check(pathProblems('assets/model.json', true).length > 0, 'extra dist data blocked');
  check(pathProblems('../outside.js').length > 0, 'traversal blocked');
  check(pathProblems('.env').length > 0, 'environment secret blocked');
  check(!jsonProblems({ triangles: 100, bbox: [[0, 0, 0], [1, 1, 1]] }).length, 'numeric count allowed');
  for (const key of [...PAYLOAD_KEYS, 'triangles']) check(jsonProblems({ [key]: [0, 1, 2] }).length > 0, `payload key ${key}`);
  check(jsonProblems({ opaque: Array(65).fill(1) }).length > 0, 'unlabelled numeric payload blocked');
  const frame = { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], origin: [0, 0, 0], min: [0, 0, 0], max: [1, 1, 1] };
  check(!frameProblems({ m0000: [frame] }, true, new Set(['m0000'])).length, 'coordinate metadata allowed');
  for (const key of ['selectors', 'runs']) check(frameProblems({ m0000: [{ ...frame, [key]: 1 }] }, true, new Set(['m0000'])).length > 0, 'frame membership field blocked');
  check(textProblems(JSON.stringify({ ['pos' + 'itions']: [0, 1, 2] })).length > 0, 'literal payload blocked');
  check(textProblems('const x="' + 'A'.repeat(5000) + '"').length > 0, 'large encoding blocked');
  check(textProblems('"' + ['C:', 'Users', 'person', 'model'].join('\\') + '"').length > 0, 'Windows local path blocked');
  check(textProblems('source ' + ['E:', 'System', 'private'].join('/')).length > 0, 'unquoted local path blocked');
  check(textProblems('"' + ['', 'home', 'person', 'model'].join('/') + '"').length > 0, 'Unix local path blocked');
  check(textProblems('"' + 'gh' + 'p_' + 'a'.repeat(40) + '"').length > 0, 'credential blocked');
  check(!textProblems('geometry.setAttribute("position", new BufferAttribute(raw, 3)); const triangles = raw.length / 9;', { dist: true }).length, 'runtime geometry code allowed');
  check(!textProblems('const color=test?g:/ Box |Key/.test(name)?h:j;', { dist: true }).length, 'minified ternary regex is not a drive path');
  check(!textProblems('const table=[' + Array(512).fill(1).join(',') + '];', { dist: true }).length, 'small bundled lookup table allowed');
  check(textProblems('const data=[' + Array(4098).fill(1).join(',') + '];', { dist: true }).length > 0, 'large bundled numeric payload blocked');
  console.log(`Release audit self-test passed (${checks} assertions).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--self-test', '--require-dist'].includes(arg))) throw new Error('Usage: node scripts/audit-release.mjs [--self-test] [--require-dist]');
    if (args.includes('--self-test')) selfTest();
    else {
      const result = await auditRelease(ROOT, { requireDist: args.includes('--require-dist') });
      if (!result.ok) {
        console.error(`Release audit FAILED (${result.issues.length} findings):`);
        for (const issue of result.issues.slice(0, 100)) console.error(`- ${issue}`);
        process.exitCode = 1;
      } else console.log(`Release audit passed: ${result.scannedFiles} files, ${result.scannedBytes} bytes; ${result.mode}; dist ${result.distScanned ? 'scanned' : 'absent (not checked)'}.`);
    }
  } catch (error) { console.error(`Release audit failed: ${error.message}`); process.exitCode = 1; }
}
