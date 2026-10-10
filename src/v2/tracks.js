import * as THREE from 'three';

const lerp = (a, b, k) => a + (b - a) * k;

/**
 * Reads the film baked from Blender (blender/scripts/export_film_web.py). Everything is sampled per frame at 24 fps;
 * fractional frames interpolate, so slow scrolling between two frames stays smooth. The camera never interpolates
 * across a hard cut.
 */
export function createTracks(data) {
  const [F0, F1] = data.frames;
  const clampF = (f) => Math.min(F1, Math.max(F0, f));

  /** {c} → constant; {from, to, v} → per-frame values, held at the ends */
  const scalar = (t) => {
    if (t.c !== undefined) return () => t.c;
    const { from, to, v } = t;
    return (f) => {
      const x = Math.min(to, Math.max(from, f)) - from;
      const i = Math.min(v.length - 1, Math.floor(x));
      const j = Math.min(v.length - 1, i + 1);
      return lerp(v[i], v[j], x - i);
    };
  };

  /** inclusive frame runs [[a, b], …]; a fractional frame belongs to the nearest whole frame */
  const shown = (runs) => (f) => runs.some(([a, b]) => f >= a - 0.5 && f < b + 0.5);

  // whole-frame span for f: [index a, index b, blend k]; a hard cut snaps to the nearer side
  const cuts = new Set(data.cuts);
  const span = (f) => {
    f = clampF(f);
    let i = Math.floor(f);
    let k = f - i;
    if (i >= F1) return [F1 - F0, F1 - F0, 0];
    if (cuts.has(i + 1)) {
      if (k >= 0.5) i += 1;
      k = 0;
    }
    return [i - F0, Math.min(i + 1, F1) - F0, k];
  };
  const vec3 = (arr, f, out) => {
    const [a, b, k] = span(f);
    return out.set(lerp(arr[a * 3], arr[b * 3], k), lerp(arr[a * 3 + 1], arr[b * 3 + 1], k), lerp(arr[a * 3 + 2], arr[b * 3 + 2], k));
  };
  const cam = data.camera;
  const camera = (f, eye, target) => {
    vec3(cam.eye, f, eye);
    vec3(cam.target, f, target);
    const [a, b, k] = span(f);
    return lerp(cam.lens[a], cam.lens[b], k);
  };

  const tmp = new THREE.Vector3();
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion();
  /** a moving piece: visibility, world transform and morph weights */
  const piece = (p) => {
    const vis = shown(p.vis || []);
    const T = p.T;
    const scale = new THREE.Vector3().fromArray(p.scale || [1, 1, 1]);
    const W = p.W;
    const apply = (f, obj) => {
      if (!T) return;
      if (T.c) {
        obj.position.fromArray(T.c, 0);
        obj.quaternion.fromArray(T.c, 3);
      } else {
        const n = T.v.length / 7;
        const x = Math.min(T.to, Math.max(T.from, f)) - T.from;
        const i = Math.min(n - 1, Math.floor(x));
        const j = Math.min(n - 1, i + 1);
        const k = x - i;
        obj.position.fromArray(T.v, i * 7).lerp(tmp.fromArray(T.v, j * 7), k);
        q0.fromArray(T.v, i * 7 + 3);
        q1.fromArray(T.v, j * 7 + 3);
        obj.quaternion.slerpQuaternions(q0, q1, k);
      }
      obj.scale.copy(scale);
    };
    const weights = (f, out) => {
      if (!W || !out) return;
      const m = W.names.length;
      if (W.c) {
        for (let i = 0; i < m; i++) out[i] = W.c[i];
        return;
      }
      const n = W.v.length / m;
      const x = Math.min(W.to, Math.max(W.from, f)) - W.from;
      const i = Math.min(n - 1, Math.floor(x));
      const j = Math.min(n - 1, i + 1);
      for (let c = 0; c < m; c++) out[c] = lerp(W.v[i * m + c], W.v[j * m + c], x - i);
    };
    return { vis, apply, weights, names: W ? W.names : [] };
  };

  const s = data.scalars;
  return {
    F0,
    F1,
    camera,
    carriage: (f, out) => vec3(data.carriage, f, out),
    scalar: Object.fromEntries(Object.entries(s).map(([k, t]) => [k, scalar(t)])),
    vis: Object.fromEntries(Object.entries(data.vis).map(([k, runs]) => [k, shown(runs)])),
    pieces: Object.fromEntries(Object.entries(data.pieces).map(([k, p]) => [k, piece(p)])),
  };
}

/**
 * The film's own pacing (blender/scripts/film_framelist.py): how many source frames one output frame advances in
 * each part. Scrolling moves through output frames at an even rate, so slow parts get more scroll.
 */
export const PACING = [
  [1, 71, 2], [72, 252, 3], [253, 312, 3], [313, 419, 2], [420, 500, 1], [501, 528, 2], [529, 612, 2],
  [613, 649, 2], [650, 806, 1.5], [807, 860, 2], [861, 1000, 2], [1001, 1120, 2], [1121, 1240, 2], [1241, 1310, 1],
];

export function outputFrames() {
  const frames = [];
  for (const [a, b, step] of PACING) {
    for (let k = 0; ; k++) {
      const f = a + Math.floor(k * step);
      if (f > b) break;
      if (!frames.length || f > frames[frames.length - 1]) frames.push(f);
    }
  }
  return frames;
}
