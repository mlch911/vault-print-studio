import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSTLGeometry} from '../src/geometry-signature.js';

// Entirely synthetic fixtures. The benchmark's virtual file generates only the
// requested slice; it never allocates a full mesh or reads external STL data.
const A = [[0, 0, 0], [4, 0, 0], [0, 3, 0]];
const B = [[0, 0, 2], [4, 0, 0], [0, 3, 0]];
const C = [[1, 1, 0], [2, 1, 0], [1, 2, 0]];
const MiB = 1024 * 1024;

function binaryBuffer(triangles, {header = 'synthetic', normal = [0, 0, 1], attribute = 0} = {}) {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  bytes.set(new TextEncoder().encode(header).subarray(0, 80));
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, index) => {
    const offset = 84 + index * 50;
    normal.forEach((value, axis) => view.setFloat32(offset + axis * 4, value, true));
    triangle.flat().forEach((value, axis) => view.setFloat32(offset + 12 + axis * 4, value, true));
    view.setUint16(offset + 48, attribute, true);
  });
  return bytes.buffer;
}

const binary = (triangles, options) => new Blob([binaryBuffer(triangles, options)]);
function asciiText(triangles, {name = 'synthetic', normal = '0 0 1', eol = '\n'} = {}) {
  return [
    `solid ${name}`,
    ...triangles.flatMap(triangle => [
      `facet normal ${normal}`, 'outer loop',
      ...triangle.map(vertex => `vertex ${vertex.join(' ')}`), 'endloop', 'endfacet',
    ]),
    `endsolid ${name}`, '',
  ].join(eol);
}
const ascii = (triangles, options) => new Blob([asciiText(triangles, options)]);
const signature = async file => (await analyzeSTLGeometry(file)).signature;
const mapped = (triangles, fn) => triangles.map(triangle => triangle.map(fn));

function guarded(file) {
  const reads = [];
  return {
    size: file.size, reads,
    arrayBuffer() { throw new Error('Whole-file read forbidden'); },
    text() { throw new Error('Whole-file text forbidden'); },
    slice(start, end) {
      assert.ok(start >= 0 && end <= file.size && end >= start);
      assert.ok(end - start <= MiB, 'read must be <= 1 MiB');
      reads.push([start, end]);
      return file.slice(start, end);
    },
  };
}

function repeatedBinary(count) {
  const sample = new Uint8Array(binaryBuffer([A]));
  const header = sample.slice(0, 84);
  new DataView(header.buffer).setUint32(80, count, true);
  const record = sample.subarray(84);
  return guarded({
    size: 84 + count * 50,
    slice(start, end) {
      return {async arrayBuffer() {
        const bytes = new Uint8Array(end - start);
        let cursor = 0;
        while (start + cursor < 84 && cursor < bytes.length) {
          bytes[cursor] = header[start + cursor]; cursor++;
        }
        const body = bytes.subarray(cursor);
        const first = Math.min(50, body.length);
        for (let i = 0; i < first; i++) body[i] = record[(start + cursor - 84 + i) % 50];
        for (let filled = first; filled < body.length;) {
          const next = Math.min(filled, body.length - filled);
          body.set(body.subarray(0, next), filled); filled += next;
        }
        return bytes.buffer;
      }};
    },
  });
}

test('API metadata, known bounds/area, and deterministic 64-digit lowercase signature', async () => {
  const result = await analyzeSTLGeometry(binary([A]));
  assert.deepEqual(Object.keys(result).sort(), ['bbox', 'format', 'signature', 'surfaceArea', 'triangles']);
  assert.equal(result.format, 'binary');
  assert.equal(result.triangles, 1);
  assert.deepEqual(result.bbox, [[0, 0, 0], [4, 3, 0]]);
  assert.equal(result.surfaceArea, 6);
  assert.match(result.signature, /^[a-f0-9]{64}$/);
  // Versioned regression vector: changing the algorithm requires rebuilding
  // catalogue references rather than silently reusing their stored digests.
  assert.equal(result.signature, '0fcfe88d89e79a29dfe1eed181834bf14118e392b74393ca56a40125aa9eb4e0');
  assert.equal(result.signature, await signature(binary([A])));
});

test('filename, paths, headers, normals (including nonfinite), and attributes are not identity', async () => {
  const original = await signature(binary([A, B]));
  const file = binary([A, B], {header: 'solid misleading binary header', normal: [NaN, Infinity, -Infinity], attribute: 65535});
  Object.defineProperties(file, {
    name: {get() { throw new Error('Filename must not be read'); }},
    webkitRelativePath: {get() { throw new Error('Path must not be read'); }},
  });
  const result = await analyzeSTLGeometry(file);
  assert.equal(result.format, 'binary');
  assert.equal(result.signature, original);
  const arbitraryHeader = binaryBuffer([A, B]);
  new Uint8Array(arbitraryHeader, 0, 80).fill(255);
  assert.equal(await signature(new Blob([arbitraryHeader])), original);
});

test('triangle order and all six vertex permutations preserve identity and multiplicity', async () => {
  const triangles = [A, B, C, A];
  const expected = await signature(binary(triangles));
  for (const permutation of [[0, 1, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0], [1, 0, 2], [0, 2, 1]]) {
    const reordered = [...triangles].reverse().map(t => permutation.map(i => t[i]));
    assert.equal(await signature(binary(reordered)), expected);
  }
  assert.notEqual(await signature(binary([A, B, C])), expected);
  assert.notEqual(await signature(binary([A, B, C, B])), expected);
  assert.notEqual(await signature(binary([A, A])), await signature(binary([B, B])));
  assert.equal((await analyzeSTLGeometry(binary([A, A]))).surfaceArea, 12);
});

test('ASCII and binary normalize exact Float32, signed zero, and ignored solid labels', async () => {
  const triangles = [[[0.1, -0, 0], [0, 0.3, 0], [0, 0, 0.7]], A];
  const expected = await signature(binary(triangles));
  const text = asciiText(triangles, {name: 'different header', normal: 'NaN -Infinity +Inf', eol: '\r\n'})
    .replace('endsolid different header', 'endsolid unrelated label')
    .replace('vertex 0.1 0 0', 'vertex +1e-1 -0.0 0.000e30');
  const result = await analyzeSTLGeometry(new Blob(['\ufeff', text]));
  assert.equal(result.format, 'ascii');
  assert.equal(result.signature, expected);
  assert.deepEqual(result.bbox, (await analyzeSTLGeometry(binary(triangles))).bbox);
  const rounded = mapped(triangles, p => p.map(Math.fround));
  assert.equal(await signature(ascii(rounded, {normal: '1e999 -1e999 nan'})), expected);
  assert.equal(await signature(ascii([A], {eol: '\r'})), await signature(binary([A])));
});

test('ASCII facet grammar allows arbitrary body whitespace and case, with final EOF token', async () => {
  const body = asciiText([A]).split('\n').slice(1, -2).join('\t \v\f\n');
  const text = `  \n SOLID\n${body.toUpperCase()}\nENDSOLID`;
  assert.equal(await signature(new Blob([text])), await signature(binary([A])));
});

test('UTF-8 Chinese solid labels are ignored while non-ASCII body tokens and label controls remain invalid', async () => {
  const expected = await signature(binary([A, B]));
  const text = asciiText([A, B], {name: '抽屉零件__中文文件名.stl'})
    .replace('endsolid 抽屉零件__中文文件名.stl', 'endsolid 另一个中文标签');
  assert.equal(await signature(new Blob([text])), expected);
  assert.equal(await signature(new Blob([text.trimEnd()])), expected, 'UTF-8 closing label may end at EOF');
  assert.equal(await signature(new Blob(['\ufeff', text.replaceAll('\n', '\r\n')])), expected);
  await assert.rejects(analyzeSTLGeometry(new Blob([text.replace('vertex 4', 'vertex 四')])), {code: 'invalid-ascii'});
  for (const control of ['\0', '\x01', '\x0b', '\x0c', '\x1f', '\x7f']) {
    for (const marker of ['solid 抽屉', 'endsolid 另一个']) {
      await assert.rejects(analyzeSTLGeometry(new Blob([text.replace(marker, marker + control)])), {code: 'invalid-ascii'});
    }
  }
  for (const delimiter of ['\x0b', '\x0c']) {
    await assert.rejects(analyzeSTLGeometry(new Blob([text.replace('solid 抽屉', 'solid' + delimiter + '抽屉')])), {code: 'invalid-ascii'});
  }
});

test('same bounds, counts and even area do not hide changed interior geometry', async () => {
  const original = await analyzeSTLGeometry(binary([A, B, C]));
  const shiftedInterior = C.map(([x, y, z]) => [x + 0.25, y, z]);
  const changed = await analyzeSTLGeometry(binary([A, B, shiftedInterior]));
  assert.deepEqual(changed.bbox, original.bbox);
  assert.equal(changed.triangles, original.triangles);
  assert.equal(changed.surfaceArea, original.surfaceArea);
  assert.notEqual(changed.signature, original.signature);
});

test('mixed geometry remains order-independent across slices and concurrent analyses', async () => {
  let seed = 0x12345678;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const triangles = Array.from({length: 23000}, () => Array.from({length: 3}, () =>
    Array.from({length: 3}, () => Math.fround((random() - 0.5) * 200))));
  const shuffled = triangles.map((triangle, index) => index % 2 ? [...triangle].reverse() : [triangle[1], triangle[2], triangle[0]]);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const [first, second] = await Promise.all([
    analyzeSTLGeometry(guarded(binary(triangles))), analyzeSTLGeometry(guarded(binary(shuffled))),
  ]);
  assert.equal(first.signature, second.signature);
  assert.deepEqual(first.bbox, second.bbox);
  assert.equal(first.triangles, second.triangles);
  assert.ok(Math.abs(first.surfaceArea - second.surfaceArea) <= first.surfaceArea * Number.EPSILON);
  assert.equal(await signature(ascii(triangles.slice(0, 200))), await signature(binary(triangles.slice(0, 200))));
});

test('absolute translation, rotation, reflection, scale and one Float32 ULP change identity', async () => {
  const triangles = [A, B, C], expected = await signature(binary(triangles));
  for (const transform of [
    ([x, y, z]) => [x + 1, y, z],
    ([x, y, z]) => [-y, x, z],
    ([x, y, z]) => [-x, y, z],
    p => p.map(v => v * 2),
  ]) assert.notEqual(await signature(binary(mapped(triangles, transform))), expected);
  const changed = structuredClone(triangles);
  changed[2][0][0] = 1 + 2 ** -23;
  assert.notEqual(await signature(binary(changed)), expected);
  changed[2][0][0] = 1 + 2 ** -25;
  assert.equal(await signature(ascii(changed)), expected, 'sub-ULP decimal difference rounds to same Float32');
  assert.equal((await analyzeSTLGeometry(binary(mapped(triangles, p => p.map(v => v * 2))))).surfaceArea,
    4 * (await analyzeSTLGeometry(binary(triangles))).surfaceArea);
});

test('retriangulation is conservative and does not equate different triangle multisets', async () => {
  const a = [0, 0, 0], b = [1, 0, 0], c = [1, 1, 0], d = [0, 1, 0];
  const first = await analyzeSTLGeometry(binary([[a, b, c], [a, c, d]]));
  const second = await analyzeSTLGeometry(binary([[a, b, d], [b, c, d]]));
  assert.deepEqual(first.bbox, second.bbox);
  assert.equal(first.surfaceArea, second.surfaceArea);
  assert.notEqual(first.signature, second.signature);
});

test('finite degenerate and extreme Float32 vertices are accepted, with normalized zero bounds', async () => {
  const extreme = Math.fround(3.4028234663852886e38), tiny = 2 ** -149;
  const triangles = [[[-extreme, 0, 0], [extreme, 0, 0], [0, extreme, tiny]]];
  const result = await analyzeSTLGeometry(binary(triangles));
  assert.ok(Number.isFinite(result.surfaceArea));
  assert.equal(result.signature, await signature(ascii(triangles)));
  const zero = await analyzeSTLGeometry(binary([[[-0, -0, -0], [0, 0, 0], [-0, 0, 0]]]));
  assert.deepEqual(zero.bbox, [[0, 0, 0], [0, 0, 0]]);
  assert.equal(zero.surfaceArea, 0);
});

test('all binary vertices are inspected, including a bad middle facet beyond initial slices', async () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const bad = structuredClone(A); bad[1][2] = value;
    await assert.rejects(analyzeSTLGeometry(binary([bad])), {code: 'non-finite-coordinate'});
  }
  const file = repeatedBinary(50000);
  const originalSlice = file.slice.bind(file);
  const badOffset = 84 + 30000 * 50 + 12;
  file.slice = (start, end) => ({async arrayBuffer() {
    const buffer = await originalSlice(start, end).arrayBuffer();
    if (start <= badOffset && badOffset + 4 <= end) new DataView(buffer).setFloat32(badOffset - start, NaN, true);
    return buffer;
  }});
  await assert.rejects(analyzeSTLGeometry(file), {code: 'non-finite-coordinate'});
});

test('corrupt binary counts, truncated records and trailing bytes are rejected, including solid headers', async () => {
  for (const header of ['binary', 'solid deceptive']) {
    const valid = binaryBuffer([A, B], {header});
    const countMismatch = valid.slice(0); new DataView(countMismatch).setUint32(80, 3, true);
    for (const data of [valid.slice(0, -1), valid.slice(0, 83), countMismatch]) {
      await assert.rejects(analyzeSTLGeometry(new Blob([data])));
    }
    await assert.rejects(analyzeSTLGeometry(new Blob([valid, new Uint8Array([0])])));
  }
});

test('strict ASCII rejects missing, reordered, extra, truncated or invalid grammar and numbers', async () => {
  const valid = asciiText([A]);
  for (const text of [
    valid.replace('solid synthetic\n', ''), valid.replace('endsolid synthetic', ''),
    valid.replace('facet normal', 'facet'), valid.replace('outer loop', 'loop outer'),
    valid.replace('vertex 0 0 0\n', ''), valid.replace('endloop', 'vertex 1 2 3\nendloop'),
    valid.replace('endloop', ''), valid.replace('endfacet', ''),
    valid.replace('vertex 4', 'vertex 4garbage'), valid.replace('vertex 4', 'vertex 0x4'),
    valid.replace('vertex 4', 'vertex NaN'), valid.replace('normal 0', 'normal nonsense'),
    valid.replace('vertex 4', 'vertex ' + '1'.repeat(257)),
    valid.replace('vertex 4', 'vertex 4\0'), valid.replace('vertex 4', 'vertex ٤'),
    valid + 'garbage', valid + valid, valid.replace('endfacet', 'solid nested\nendfacet'),
  ]) await assert.rejects(analyzeSTLGeometry(new Blob([text])), {code: 'invalid-ascii'}, text.slice(0, 120));
  for (const value of ['1e999', '1e39', '-1e39']) {
    await assert.rejects(analyzeSTLGeometry(new Blob([valid.replace('vertex 4', `vertex ${value}`)])), {code: 'non-finite-coordinate'});
  }
});

test('empty, invalid file shape, oversized and incomplete slice reads fail', async () => {
  for (const file of [new Blob(), binary([]), ascii([])]) {
    await assert.rejects(analyzeSTLGeometry(file), {code: 'empty-stl'});
  }
  for (const file of [null, {}, {size: -1, slice() {}}, {size: 1.5, slice() {}}]) {
    await assert.rejects(analyzeSTLGeometry(file), TypeError);
  }
  await assert.rejects(analyzeSTLGeometry({size: 512 * MiB + 1, slice() {throw new Error('Must reject before reading');}}), {code: 'file-too-large'});
  await assert.rejects(analyzeSTLGeometry({size: 100, slice() {return {async arrayBuffer() {return new ArrayBuffer(1);}};}}), {code: 'read-error'});
  await assert.rejects(analyzeSTLGeometry(binary([A]), {onProgress: 42}), TypeError);
});

test('ASCII labels, tokens and numbers cross slice boundaries without accumulating a file', async () => {
  const target = await signature(binary([A]));
  const body = asciiText([A]).slice('solid synthetic\n'.length);
  // Move a slice boundary through every character of the first normal token.
  for (const shift of [0, 1, 3, 6, 9, 12]) {
    const label = 'x'.repeat(MiB - 'solid \n'.length - shift);
    const file = guarded(new Blob([`solid ${label}\n`, body]));
    assert.equal(await signature(file), target);
    assert.ok(file.reads.length >= 3);
  }
  const prefix = 'solid s\nfacet normal 0 0 1\nouter loop\nvertex ';
  const text = prefix + ' '.repeat(MiB - prefix.length - 2) + '0.0 0 0\nvertex 4 0 0\nvertex 0 3 0\nendloop\nendfacet\nendsolid';
  assert.equal(await signature(guarded(new Blob([text]))), target);
});

test('binary processing uses bounded slices, yields to timers, and emits monotonic progress', async () => {
  const file = repeatedBinary(100000), progress = [];
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  let result;
  try { result = await analyzeSTLGeometry(file, {onProgress: p => progress.push(p)}); }
  finally { clearInterval(timer); }
  assert.equal(result.triangles, 100000);
  assert.equal(result.surfaceArea, 600000);
  assert.deepEqual(result.bbox, [[0, 0, 0], [4, 3, 0]]);
  assert.ok(ticks >= 2, `expected repeated event-loop yields, got ${ticks}`);
  assert.ok(file.reads.length >= 6);
  assert.equal(progress[0].bytesRead, 0);
  assert.equal(progress.at(-1).bytesRead, file.size);
  assert.equal(progress.at(-1).triangles, 100000);
  for (let i = 0; i < progress.length; i++) {
    assert.equal(progress[i].totalBytes, file.size);
    assert.equal(progress[i].format, 'binary');
    if (i) {
      assert.ok(progress[i].bytesRead >= progress[i - 1].bytesRead);
      assert.ok(progress[i].triangles >= progress[i - 1].triangles);
    }
  }
});

test('pre-abort, progress-triggered cancellation, pending-read cancellation, and callback errors propagate', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(analyzeSTLGeometry({size: 100, slice() {throw new Error('must not read');}}, {signal: before.signal}), {name: 'AbortError'});
  const controller = new AbortController(), reason = new Error('custom cancellation');
  const file = repeatedBinary(100000);
  await assert.rejects(analyzeSTLGeometry(file, {signal: controller.signal, onProgress(p) {
    if (p.triangles >= 2048) controller.abort(reason);
  }}), error => error === reason);
  assert.ok(file.reads.length < 6, 'cancellation must stop subsequent reads');
  const pending = new AbortController();
  await assert.rejects(analyzeSTLGeometry({size: 134, slice() {return {async arrayBuffer() {
    pending.abort(reason); return binaryBuffer([A]);
  }};}}, {signal: pending.signal}), error => error === reason);
  await assert.rejects(analyzeSTLGeometry(binary([A]), {onProgress() {throw reason;}}), error => error === reason);
});

test('timers can cancel ongoing binary and ASCII processing, without a progress callback', async () => {
  for (const file of [repeatedBinary(300000), guarded(new Blob(['solid ', 'x'.repeat(8 * MiB), '\n', asciiText([A]).split('\n').slice(1).join('\n')]))]) {
    const controller = new AbortController();
    let timer;
    // Arm after the first body read: a fixed delay from invocation races fast
    // parsers, while arming before invocation only exercises the initial yield.
    const source={size:file.size,slice(start,end){return {async arrayBuffer(){
      const bytes=await file.slice(start,end).arrayBuffer();
      if(bytes.byteLength>84&&timer===undefined)timer=setTimeout(()=>controller.abort(),0);
      return bytes;
    }};}};
    try { await assert.rejects(analyzeSTLGeometry(source, {signal: controller.signal}), {name: 'AbortError'}); }
    finally { clearTimeout(timer); }
  }
});

test('synthetic 7.26M-triangle throughput and memory benchmark', {
  skip: process.env.GEOMETRY_SIGNATURE_BENCHMARK !== '1',
}, async t => {
  const count = 7260000, file = repeatedBinary(count);
  const initial = process.memoryUsage();
  let peakArrayBuffers = initial.arrayBuffers, peakRss = initial.rss, ticks = 0;
  let maxTickGap = 0, previousTick = performance.now();
  const timer = setInterval(() => {
    const now = performance.now(); maxTickGap = Math.max(maxTickGap, now - previousTick); previousTick = now; ticks++;
  }, 0);
  const start = performance.now();
  let result;
  try {
    result = await analyzeSTLGeometry(file, {onProgress() {
      const memory = process.memoryUsage();
      peakArrayBuffers = Math.max(peakArrayBuffers, memory.arrayBuffers);
      peakRss = Math.max(peakRss, memory.rss);
    }});
  } finally { clearInterval(timer); }
  const seconds = (performance.now() - start) / 1000;
  assert.equal(result.triangles, count);
  assert.equal(result.surfaceArea, count * 6);
  assert.equal(result.signature, '42a8c839c886a3ea4fda443d2a70203361c7a41508af3cd880d4812d1ab79ea7');
  t.diagnostic(JSON.stringify({triangles: count, MiB: file.size / MiB, seconds,
    millionTrianglesPerSecond: count / seconds / 1e6, reads: file.reads.length,
    maxReadBytes: Math.max(...file.reads.map(([a, b]) => b - a)), ticks, maxTickGap,
    peakArrayBuffersMiB: peakArrayBuffers / MiB, peakRssMiB: peakRss / MiB,
    rssIncreaseMiB: (peakRss - initial.rss) / MiB, signature: result.signature}));
});
