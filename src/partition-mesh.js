// Partition original triangle soup. Connectivity is exact; tolerances only compare
// measured component signatures with reference frames. Input vertices never move.
const LIMITS = Object.freeze({
  maxTriangles: 1_000_000,
  maxFrames: 32,
  centerMM: 0.5,
  boundsMM: 0.5,
  separationMM: 1,
  centerRatio: 4,
});
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const triple = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);

function validFrame(f) {
  if (!f || !triple(f.origin) || !triple(f.min) || !triple(f.max) ||
      !Array.isArray(f.rotation) || f.rotation.length !== 3 || !f.rotation.every(triple) ||
      f.min.some((x, j) => x > f.max[j])) return false;
  const r = f.rotation;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    const dot = r[a].reduce((s, x, j) => s + x * r[b][j], 0);
    if (Math.abs(dot - (a === b ? 1 : 0)) > 1e-4) return false;
  }
  const det = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1])
    - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0])
    + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  return Math.abs(det - 1) <= 1e-4;
}

/**
 * @param {Float32Array} raw Non-indexed original STL positions, nine floats/triangle.
 * @param {Array} frames Semantic slots in output order: {rotation, origin, min, max}.
 * @returns {{parts: Float32Array[], resolved: boolean, diagnostic: object}}
 * A failed/ambiguous match returns [raw], including every original triangle.
 * Call on original coordinates before any preview decimation or centering.
 * membershipOnly returns each original triangle's semantic slot without copying meshes.
 */
export function partitionMesh(raw, frames, {membershipOnly=false}={}) {
  if (!(raw instanceof Float32Array) || !raw.length || raw.length % 9 ||
      !raw.every(Number.isFinite)) {
    throw new TypeError('分区输入须为有限坐标组成的 Float32Array 三角形数组。');
  }
  const triangles = raw.length / 9;
  const diagnostic = {
    method: 'exact-vertex-components', triangles,
    expectedComponents: Array.isArray(frames) ? frames.length : 0,
    componentCount: null, thresholds: {...LIMITS},
  };
  const fallback = reason => ({
    parts: [raw], resolved: false,
    diagnostic: {...diagnostic, reason, returnedTriangles: triangles},
  });
  if (!Array.isArray(frames) || !frames.length || !frames.every(validFrame)) {
    return fallback('invalid-frames');
  }
  if (triangles > LIMITS.maxTriangles || frames.length > LIMITS.maxFrames) {
    return fallback('budget-exceeded');
  }

  const parent = Int32Array.from({length: triangles}, (_, i) => i);
  const rank = new Uint8Array(triangles);
  function find(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(a, b) {
    a = find(a); b = find(b);
    if (a === b) return;
    if (rank[a] < rank[b]) [a, b] = [b, a];
    parent[b] = a;
    if (rank[a] === rank[b]) rank[a]++;
  }
  // Number stringification is lossless for finite Float32 values. Signed zeros
  // denote the same position; the original signed-zero bits are still copied out.
  const owner = new Map();
  for (let t = 0; t < triangles; t++) for (let v = 0; v < 3; v++) {
    const k = t * 9 + v * 3;
    const key = `${raw[k]},${raw[k + 1]},${raw[k + 2]}`;
    const previous = owner.get(key);
    if (previous === undefined) owner.set(key, t);
    else union(t, previous);
  }
  diagnostic.uniqueVertices = owner.size;
  owner.clear();

  const roots = new Map(), counts = [], membership = new Int32Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const root = find(t);
    if (!roots.has(root)) { roots.set(root, roots.size); counts.push(0); }
    const c = roots.get(root);
    membership[t] = c; counts[c]++;
  }
  diagnostic.componentCount = counts.length;
  diagnostic.componentTriangles = counts.slice(0, 64);
  diagnostic.componentCountsTruncated = counts.length > 64;
  if (counts.length !== frames.length) return fallback('component-count-mismatch');

  const components = counts.map((count, component) => ({
    component, triangles: count,
    min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
    weightedCenter: [0, 0, 0], areaWeight: 0,
  }));
  for (let t = 0; t < triangles; t++) {
    const c = components[membership[t]], k = t * 9;
    for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
      const x = raw[k + v * 3 + a];
      c.min[a] = Math.min(c.min[a], x); c.max[a] = Math.max(c.max[a], x);
    }
    const ux = raw[k + 3] - raw[k], uy = raw[k + 4] - raw[k + 1], uz = raw[k + 5] - raw[k + 2];
    const vx = raw[k + 6] - raw[k], vy = raw[k + 7] - raw[k + 1], vz = raw[k + 8] - raw[k + 2];
    const weight = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    c.areaWeight += weight;
    for (let a = 0; a < 3; a++) c.weightedCenter[a] += weight *
      (raw[k + a] + raw[k + 3 + a] + raw[k + 6 + a]) / 3;
  }
  const claimed = new Set();
  diagnostic.components = components.map(c => {
    const sourceCenter = c.min.map((x, a) => (x + c.max[a]) / 2);
    const centroid = c.areaWeight > 0 ? c.weightedCenter.map(x => x / c.areaWeight) : null;
    const candidates = frames.map((f, frame) => ({frame, error: distance(sourceCenter, f.origin)}))
      .sort((a, b) => a.error - b.error);
    const best = candidates[0], next = candidates[1];
    const centroidDistance = centroid ? distance(centroid, frames[best.frame].origin) : null;
    const nextCentroidDistance = centroid && frames.length > 1 ? Math.min(...frames
      .filter((_, j) => j !== best.frame).map(f => distance(centroid, f.origin))) : null;
    return {
      component: c.component, triangles: c.triangles, sourceCenter, centroid,
      frame: best.frame, centerError: best.error,
      nextCenterDistance: next?.error ?? null, centroidDistance, nextCentroidDistance,
    };
  });
  // A unique local winner must also give a bijection. Do not force a globally
  // optimal permutation when any component's identity is uncertain.
  for (const c of diagnostic.components) {
    if (!c.centroid) return fallback('degenerate-component');
    if (c.centerError > LIMITS.centerMM) return fallback('frame-signature-mismatch');
    if (c.nextCenterDistance !== null &&
        (c.nextCenterDistance - c.centerError < LIMITS.separationMM ||
         c.nextCenterDistance <= LIMITS.centerRatio * c.centerError)) return fallback('ambiguous-frame');
    if (c.nextCentroidDistance !== null &&
        c.nextCentroidDistance - c.centroidDistance < LIMITS.separationMM) return fallback('ambiguous-centroid');
    if (claimed.has(c.frame)) return fallback('non-bijective-match');
    claimed.add(c.frame);
  }

  const bounds = components.map(() => ({min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]}));
  for (let t = 0; t < triangles; t++) {
    const c = membership[t], f = frames[diagnostic.components[c].frame], b = bounds[c];
    for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
      let q = 0;
      for (let j = 0; j < 3; j++) q += f.rotation[a][j] * (raw[t * 9 + v * 3 + j] - f.origin[j]);
      b.min[a] = Math.min(b.min[a], q); b.max[a] = Math.max(b.max[a], q);
    }
  }
  for (const c of diagnostic.components) {
    const b = bounds[c.component], f = frames[c.frame];
    c.boundsError = Math.max(...b.min.map((x, a) => Math.abs(x - f.min[a])),
      ...b.max.map((x, a) => Math.abs(x - f.max[a])));
    if (c.boundsError > LIMITS.boundsMM) return fallback('frame-signature-mismatch');
  }

  if(membershipOnly){
    for(let t=0;t<triangles;t++)membership[t]=diagnostic.components[membership[t]].frame;
    return {resolved:true,triangleSlots:membership,diagnostic};
  }
  const parts = new Array(frames.length), offsets = new Uint32Array(frames.length);
  for (const c of diagnostic.components) parts[c.frame] = new Float32Array(c.triangles * 9);
  for (let t = 0; t < triangles; t++) {
    const slot = diagnostic.components[membership[t]].frame;
    parts[slot].set(raw.subarray(t * 9, t * 9 + 9), offsets[slot]); offsets[slot] += 9;
  }
  return {
    parts, resolved: true,
    diagnostic: {...diagnostic, reason: 'resolved', returnedTriangles: triangles,
      assignment: diagnostic.components.map(c => ({frame: c.frame, component: c.component, triangles: c.triangles}))
        .sort((a, b) => a.frame - b.frame)},
  };
}
