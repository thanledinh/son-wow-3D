import * as THREE from 'three';
import { gltfLoader, asset } from '../studio.js';

const GOLD = 0xf4b223;
const BLADE_U = 0.0327;        // blade tip along the film path (path-plane u, from blender/scripts/film_1_cut.py)
const NOSE_U = 0.135;          // where the film leaves the platen
const TABLE_U = 0.23;          // where it lies flat on the cutting table
const CARRIAGE_REST_Z = -1.374;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const URUS_KIT = 'v3/';           // our Urus's kit; a trial car may bring its own (car.js TRIAL_CARS kit)

/**
 * Pixels from a fragment to the piece's cut edge, for a light kit's panels (faceCorners: aBary where in its face a
 * corner is, aCut which of the face's sides lie on the edge, aTip which of its corners do). The corners close the gaps
 * that the faces meeting the edge at a corner only would leave in the line.
 */
export const CUT_EDGE_GLSL = /* glsl */ `
float cutEdgePx(vec3 bary, vec3 cut, vec3 tip) {
  vec3 w = max(fwidth(bary), vec3(1e-6));
  vec3 side = bary / w + (1.0 - cut) * 1e4;
  vec3 corner = (1.0 - bary) / w + (1.0 - tip) * 1e4;
  return min(min(min(side.x, side.y), side.z), min(min(corner.x, corner.y), corner.z));
}
`;

/**
 * The car's PPF kit, from the roll to the car (blender/scripts/export_patterns_web.py):
 *  - the 1.52 m film web follows the plotter's film path (roll → platen → table), sliding with the feed;
 *  - the knife traces every piece of the nested layout in one run, the film jogging so each point passes under it;
 *  - once cut and fed out, the pieces lift off the table (their holes stay in the web), grow to full size, bend into
 *    their panel shapes and fly to the car.
 * Each panel mesh carries one morph target: where its vertices lie flat on the table (world space), so weight 1 = the
 * pattern on the table, 0 = the panel shape, and the node's position moves it (0 on the table).
 * state: cut 0→1, push 0→1 (feed out), hole 0/1, lift 0→1, fly 0→1, merge 0→1, explode (hover distance scale)
 * base: the folder of the kit's patterns.json + patterns.glb. A kit that fails to load gives way to the Urus's (with a
 * warning; kit.base says which one came, so the car can stretch it to its own shape: fitTo).
 * light: the film made for a light studio (a pale room shows none of the sheen it has on the dark one)
 */
export function createKit(base = URUS_KIT, { light = false } = {}) {
  const state = { show: 0, cut: 0, push: 0, lift: 0, fly: 0, merge: 0, alpha: 1, edge: 0 };
  const rig = new THREE.Group();          // film web + knife line (on the plotter)
  const pieces = new THREE.Group();       // the flying panels
  rig.visible = false;
  pieces.visible = false;
  let path = null, layout = null, deform = null, sBlade = 0, F0 = 0, Fend = 0;
  let strip = null, line = null, stripGeo = null, lineGeo = null, lineU = null, holeU = null;
  let knife = null;                        // [{x, z, t}] points along the whole knife path (strip coords), t = 0..1
  const panels = [];
  const filmU = { uAlpha: { value: 0.16 } };

  let from = base;
  const loadKit = (dir) => Promise.all([
    fetch(asset(`${dir}patterns.json`)).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.url}`);
      return r.json();
    }),
    gltfLoader.loadAsync(asset(`${dir}patterns.glb`)),
  ]);
  const ready = Promise.all([
    fetch(asset('v3/plotter-path.json')).then((r) => r.json()),
    loadKit(base).catch((err) => {
      if (base === URUS_KIT) throw err;
      console.warn(`kit: ${base} unavailable, cutting the Urus kit instead`, err);
      from = URUS_KIT;
      return loadKit(URUS_KIT);
    }),
  ]).then(([p, [pat, glb]]) => {
    path = p;
    layout = pat;
    buildPath();
    buildStrip();
    buildKnife();
    buildPieces(glb);
  });

  // ---------------------------------------------------------------- film path
  function buildPath() {
    const n = path.pts.length / 2;
    const U = new Float64Array(n), W = new Float64Array(n), S = new Float64Array(n);
    const TU = new Float64Array(n), TW = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      U[i] = path.pts[i * 2];
      W[i] = path.pts[i * 2 + 1];
      if (i) {
        const du = U[i] - U[i - 1], dw = W[i] - W[i - 1];
        const l = Math.hypot(du, dw);
        S[i] = S[i - 1] + l;
        TU[i] = l > 1e-12 ? du / l : TU[i - 1];
        TW[i] = l > 1e-12 ? dw / l : TW[i - 1];
      }
    }
    TU[0] = TU[1];
    TW[0] = TW[1];
    const total = S[n - 1];
    const e = new THREE.Matrix4().set(...path.matrix).elements;
    // arc length where the flat run (platen, then table) reaches u
    const sAtU = (u, minW) => {
      for (let i = 1; i < n; i++) {
        if (W[i] > minW && W[i - 1] > minW && U[i - 1] <= u && u <= U[i] && U[i] > U[i - 1]) {
          return S[i - 1] + ((u - U[i - 1]) / (U[i] - U[i - 1])) * (S[i] - S[i - 1]);
        }
      }
      throw new Error(`film path: u ${u} not found`);
    };
    sBlade = sAtU(BLADE_U, 0.9);
    const sTable = sAtU(TABLE_U, 0.9);
    deform = (x, y, z, F, pos, nor, o) => {
      let s = x + F;
      if (s < 0) s = 0;
      else if (s > total) s = total;
      let lo = 1, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (S[mid] < s) lo = mid + 1;
        else hi = mid;
      }
      const i = lo;
      const seg = S[i] - S[i - 1];
      const k = seg > 1e-12 ? (s - S[i - 1]) / seg : 0;
      const tu = TU[i], tw = TW[i];
      const u = U[i - 1] + (U[i] - U[i - 1]) * k - tw * y;
      const w = W[i - 1] + (W[i] - W[i - 1]) * k + tu * y;
      pos[o] = e[0] * u + e[4] * w + e[8] * z + e[12];
      pos[o + 1] = e[1] * u + e[5] * w + e[9] * z + e[13];
      pos[o + 2] = e[2] * u + e[6] * w + e[10] * z + e[14];
      if (nor) {
        nor[o] = -e[0] * tw + e[4] * tu;
        nor[o + 1] = -e[1] * tw + e[5] * tu;
        nor[o + 2] = -e[2] * tw + e[6] * tu;
      }
    };
    // the strip: its front edge hangs 18 cm past the blade before cutting; its back end stays wound on the roll
    path.xFront = sBlade + 0.18;
    path.xBack = 0.06;
    // the layout starts 8 cm behind the front edge; strip x = xL0 - layout x, z = film edge + layout y
    path.xL0 = path.xFront - 0.08;
    path.z0 = -layout.filmWidth / 2;
    // after cutting, the whole layout is fed out onto the table
    Fend = sTable + 0.06 - (path.xL0 - layout.length);
    path.total = total;
  }
  const toStrip = (lx, ly) => [path.xL0 - lx, path.z0 + ly];

  // ---------------------------------------------------------------- film web
  function buildStrip() {
    const segs = Math.ceil((path.xFront - path.xBack) / 0.006);
    const sx = new Float32Array(segs + 1);
    const pos = new Float32Array((segs + 1) * 6), nor = new Float32Array((segs + 1) * 6), uv = new Float32Array((segs + 1) * 4);
    const idx = [];
    for (let k = 0; k <= segs; k++) {
      sx[k] = path.xBack + ((path.xFront - path.xBack) * k) / segs;
      uv.set([k / segs, 0, k / segs, 1], k * 4);
      if (k < segs) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
    }
    stripGeo = new THREE.BufferGeometry();
    stripGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    stripGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    stripGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    stripGeo.setIndex(idx);
    stripGeo.userData.sx = sx;

    // the holes the pieces leave, drawn over the strip's (x, z)
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    for (const pc of layout.pieces) {
      g.beginPath();
      for (const loop of pc.loops) {
        loop.forEach(([lx, ly], i) => {
          const [x, z] = toStrip(lx, ly);
          const px = ((x - path.xBack) / (path.xFront - path.xBack)) * c.width;
          const py = (1 - (z - path.z0) / layout.filmWidth) * c.height;
          if (i) g.lineTo(px, py);
          else g.moveTo(px, py);
        });
        g.closePath();
      }
      g.fill('evenodd');
    }
    const mask = new THREE.CanvasTexture(c);
    mask.generateMipmaps = false;
    mask.minFilter = THREE.LinearFilter;
    holeU = { uHole: { value: 0 }, uMask: { value: mask } };

    // (both faces in one draw: a film this clear shows no difference, and the second pass cost as much as the first)
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xf4f8fc, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, envMapIntensity: 1.3,
    });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, holeU, filmU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vStripUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStripUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uHole; uniform float uAlpha; uniform sampler2D uMask; varying vec2 vStripUv;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uHole > 0.5 && texture2D(uMask, vStripUv).r > 0.5) discard;')
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
          gl_FragColor.a = clamp(uAlpha + fr * 0.35, 0.0, 1.0);`);
    };
    strip = new THREE.Mesh(stripGeo, mat);
    strip.frustumCulled = false;
    strip.renderOrder = 2;
    rig.add(strip);
  }

  // ---------------------------------------------------------------- the knife path through every piece
  function buildKnife() {
    // cut order: front of the layout first, so the film only ever feeds outwards
    const order = layout.pieces
      .map((pc) => ({ pc, x: Math.min(...pc.loops[0].map((p) => p[0])), y: Math.min(...pc.loops[0].map((p) => p[1])) }))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const pts = [];                 // {lx, ly, d, cut}
    let d = 0, prev = null;
    const loops = [];
    for (const { pc } of order) {
      for (const loop of pc.loops) {
        const closed = [...loop, loop[0]];
        if (prev) d += Math.hypot(closed[0][0] - prev[0], closed[0][1] - prev[1]) * 0.25; // blade up: quick travel
        const first = pts.length;
        closed.forEach((p, i) => {
          if (i) d += Math.hypot(p[0] - closed[i - 1][0], p[1] - closed[i - 1][1]);
          pts.push({ lx: p[0], ly: p[1], d });
        });
        loops.push([first, pts.length - 1]);
        prev = closed[closed.length - 1];
      }
    }
    pts.forEach((p) => { p.t = p.d / d; });
    knife = { pts, loops };

    // ribbon: two vertices per point, quads only inside a loop
    const m = pts.length;
    const side = new Float32Array(m * 2);
    loops.forEach(([a, b]) => {
      for (let i = a; i <= b; i++) {
        const p0 = pts[Math.max(a, i - 1)], p1 = pts[Math.min(b, i + 1)];
        let tx = p1.lx - p0.lx, ty = p1.ly - p0.ly;
        const l = Math.hypot(tx, ty) || 1;
        side[i * 2] = -ty / l;
        side[i * 2 + 1] = tx / l;
      }
    });
    const prog = new Float32Array(m * 2);
    const idx = [];
    pts.forEach((p, i) => { prog[i * 2] = prog[i * 2 + 1] = p.t; });
    loops.forEach(([a, b]) => {
      for (let i = a; i < b; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    });
    lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m * 6), 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setAttribute('aProg', new THREE.BufferAttribute(prog, 1));
    lineGeo.setIndex(idx);
    lineGeo.userData.side = side;
    lineU = { uReveal: { value: 0 }, uFade: { value: 1 } };
    const mat = new THREE.MeshBasicMaterial({ color: GOLD, side: THREE.DoubleSide, toneMapped: false, transparent: true });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, lineU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aProg;\nvarying float vProg;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvProg = aProg;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uReveal; uniform float uFade; varying float vProg;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vProg > uReveal) discard;')
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= uFade;');
    };
    line = new THREE.Mesh(lineGeo, mat);
    line.frustumCulled = false;
    line.renderOrder = 3;
    rig.add(line);
  }

  // where the blade is at cut progress u: {lx, ly} on the layout
  const bladeAt = (u) => {
    const pts = knife.pts;
    if (u <= 0) return pts[0];
    if (u >= 1) return pts[pts.length - 1];
    let lo = 1, hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t < u) lo = mid + 1;
      else hi = mid;
    }
    const a = pts[lo - 1], b = pts[lo];
    const k = (u - a.t) / Math.max(1e-9, b.t - a.t);
    return { lx: a.lx + (b.lx - a.lx) * k, ly: a.ly + (b.ly - a.ly) * k };
  };

  // ---------------------------------------------------------------- the panels
  function buildPieces(glb) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, envMapIntensity: 1.7,
    });
    const u = { uAlpha: { value: 1 }, uEdge: { value: 0 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uAlpha; uniform float uEdge; varying float vEdge;')
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          // clear film: almost invisible face-on, a glassy sheen at grazing angles, the cut edge catches the light
          float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
          float edge = smoothstep(0.55, 1.0, vEdge);
          gl_FragColor.rgb += vec3(1.0, 0.97, 0.9) * edge * (0.35 + 0.9 * uEdge);
          gl_FragColor.a = clamp(0.05 + fr * 0.42 + edge * (0.35 + 0.5 * uEdge), 0.0, 1.0) * uAlpha;`);
    };
    if (light) lightFilm(mat, u);
    pieces.userData.uniforms = u;

    // where every vertex lies on the table once the layout is fed out (strip coords → world at Fend)
    const tmp = new Float32Array(3);
    layout.panels.forEach((info, i) => {
      const obj = glb.scene.getObjectByName(info.name);
      const mesh = obj.isMesh ? obj : obj.getObjectByProperty('isMesh', true);
      const geo = mesh.geometry;
      const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
      const n = pos.count;
      const dPos = new Float32Array(n * 3), dNrm = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        const [x, z] = toStrip(uv.getX(v), 1 - uv.getY(v));
        deform(x, 0.0012, z, Fend, tmp, null, 0);
        dPos[v * 3] = tmp[0] - pos.getX(v);
        dPos[v * 3 + 1] = tmp[1] - pos.getY(v);
        dPos[v * 3 + 2] = tmp[2] - pos.getZ(v);
        dNrm[v * 3] = 0 - nrm.getX(v);
        dNrm[v * 3 + 1] = 1 - nrm.getY(v);
        dNrm[v * 3 + 2] = 0 - nrm.getZ(v);
      }
      geo.morphAttributes.position = [new THREE.BufferAttribute(dPos, 3)];
      geo.morphAttributes.normal = [new THREE.BufferAttribute(dNrm, 3)];
      geo.morphTargetsRelative = true;
      // the cut edge: vertices on boundary edges
      const index = geo.index.array;
      const count = new Map();
      for (let t = 0; t < index.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const a = index[t + k], b = index[t + ((k + 1) % 3)];
          const key = a < b ? a * 1e6 + b : b * 1e6 + a;
          count.set(key, (count.get(key) || 0) + 1);
        }
      }
      const edge = new Float32Array(n);
      count.forEach((c, key) => {
        if (c !== 1) return;
        edge[Math.floor(key / 1e6)] = 1;
        edge[key % 1e6] = 1;
      });
      geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
      if (light) faceCorners(mesh, (a, b) => count.get(a < b ? a * 1e6 + b : b * 1e6 + a) === 1, edge);
      mesh.updateMorphTargets();
      mesh.morphTargetInfluences[0] = 1;
      mesh.material = mat;
      mesh.renderOrder = 6;
      mesh.frustumCulled = false;
      mesh.position.set(0, 0, 0);
      pieces.add(mesh);
      const rest = new THREE.Vector3().fromArray(info.rest);
      const dir = new THREE.Vector3().fromArray(info.dir).normalize();
      const r = Math.sin(i * 12.9898) * 43758.5453;
      const rnd = r - Math.floor(r);
      panels.push({
        mesh,
        rest,
        out: rest.clone().addScaledVector(dir, 1.05 + rnd * 0.35).add(new THREE.Vector3(0, 0.22, 0)),
        delay: rnd * 0.25,
        phase: rnd * 6.28,
      });
    });
    // nose first when they land
    const zs = panels.map((p) => p.rest.z);
    const z0 = Math.min(...zs), z1 = Math.max(...zs);
    panels.forEach((p) => { p.land = ((p.rest.z - z0) / (z1 - z0)) * 0.45; });
  }

  /**
   * The film on a light studio, where its sheen and a white edge vanish against the pale room: a faint cool tint with
   * a touch more body, and the cut edge a fine line in the gold the knife drew it in, a soft glow just inside it. The
   * line keeps one width on screen however big the faces are (CUT_EDGE_GLSL; lit by aEdge instead, a small piece,
   * all edge vertices, went solid gold).
   */
  function lightFilm(mat, u) {
    mat.color.set(0xd2dde8);
    u.uGold = { value: new THREE.Color(GOLD) };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aBary; attribute vec3 aCut; attribute vec3 aTip;\nvarying vec3 vBary; varying vec3 vCut; varying vec3 vTip;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBary = aBary; vCut = aCut; vTip = aTip;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uAlpha; uniform float uEdge; uniform vec3 uGold; varying vec3 vBary; varying vec3 vCut; varying vec3 vTip;
          ${CUT_EDGE_GLSL}`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
          float d = cutEdgePx(vBary, vCut, vTip);
          float gold = max(1.0 - smoothstep(1.0, 2.2, d), exp(-d * 0.3) * 0.3) * (0.6 + 0.4 * uEdge);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uGold, gold);
          gl_FragColor.a = clamp(max(0.07 + fr * 0.32, gold), 0.0, 1.0) * uAlpha;`);
    };
  }

  /**
   * (light kit) the faces stop sharing corners, each corner gets aBary, and its face's aCut and aTip (CUT_EDGE_GLSL;
   * onEdge(a, b): a side on the cut edge, edge[v]: a corner on it)
   */
  function faceCorners(mesh, onEdge, edge) {
    const index = mesh.geometry.index.array, tris = index.length / 3;
    const bary = new Float32Array(tris * 9), cut = new Float32Array(tris * 9), tip = new Float32Array(tris * 9);
    for (let t = 0; t < tris; t++) {
      const v = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
      const side = [onEdge(v[1], v[2]), onEdge(v[2], v[0]), onEdge(v[0], v[1])];      // the side across from each corner
      for (let k = 0; k < 3; k++) {
        bary[t * 9 + k * 4] = 1;
        for (let j = 0; j < 3; j++) {
          cut[t * 9 + k * 3 + j] = side[j] ? 1 : 0;
          tip[t * 9 + k * 3 + j] = edge[v[j]];
        }
      }
    }
    const geo = mesh.geometry.toNonIndexed();
    geo.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
    geo.setAttribute('aCut', new THREE.BufferAttribute(cut, 3));
    geo.setAttribute('aTip', new THREE.BufferAttribute(tip, 3));
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }

  // ---------------------------------------------------------------- per frame
  let lastF = NaN, lastW = NaN;
  const tmp3 = new Float32Array(3);
  const lay = (F, halfWidth) => {
    if (F !== lastF) {
      const sx = stripGeo.userData.sx;
      const p = stripGeo.attributes.position.array, nr = stripGeo.attributes.normal.array;
      for (let k = 0; k < sx.length; k++) {
        deform(sx[k], 0, path.z0, F, p, nr, k * 6);
        deform(sx[k], 0, -path.z0, F, p, nr, k * 6 + 3);
      }
      stripGeo.attributes.position.needsUpdate = true;
      stripGeo.attributes.normal.needsUpdate = true;
    }
    if (F !== lastF || Math.abs(halfWidth - lastW) > 1e-5) {
      const p = lineGeo.attributes.position.array, side = lineGeo.userData.side;
      knife.pts.forEach((pt, i) => {
        const ox = side[i * 2] * halfWidth, oy = side[i * 2 + 1] * halfWidth;
        const [xa, za] = toStrip(pt.lx + ox, pt.ly + oy);
        const [xb, zb] = toStrip(pt.lx - ox, pt.ly - oy);
        deform(xa, 0.0008, za, F, p, null, i * 6);
        deform(xb, 0.0008, zb, F, p, null, i * 6 + 3);
      });
      lineGeo.attributes.position.needsUpdate = true;
      lastW = halfWidth;
    }
    lastF = F;
  };

  /** pose the film, knife and pieces; plotter = { carriage, carriageBase, roll, rollBase, rollAxis } */
  const tmpV = new THREE.Vector3();
  const update = (time, plotter, halfWidth) => {
    if (!knife) return;
    rig.visible = state.show > 0.001;
    if (rig.visible) {
      // feed: while cutting the point being cut sits under the blade; then the layout is fed out onto the table
      const b = bladeAt(state.cut);
      const [bx, bz] = toStrip(b.lx, b.ly);
      const cutF = state.cut > 0 ? sBlade - bx : sBlade - path.xL0;
      const F = cutF + (Fend - cutF) * smooth(clamp01(state.push));
      lay(F, halfWidth);
      lineU.uReveal.value = state.cut >= 1 ? 1.01 : state.cut;
      lineU.uFade.value = 1 - smooth(clamp01(state.lift * 1.4));
      holeU.uHole.value = state.lift > 0.02 ? 1 : 0;
      if (plotter.roll) plotter.roll.quaternion.setFromAxisAngle(plotter.rollAxis, -F / path.rollRadius).multiply(plotter.rollBase);
      if (plotter.carriage) {
        // the blade rides across the film over the point being cut, then parks while the film is fed out
        deform(bx, 0, bz, F, tmp3, null, 0);
        const park = state.cut > 0 ? smooth(clamp01(state.push * 1.5)) : 1;
        tmpV.set(0, 0, (tmp3[2] - CARRIAGE_REST_Z) * (1 - park));
        plotter.carriage.position.copy(plotter.carriageBase).add(tmpV);
      }
    }
    pieces.visible = state.lift > 0.001 && state.alpha > 0.001;
    if (!pieces.visible) return;
    const u = pieces.userData.uniforms;
    u.uAlpha.value = state.alpha;
    u.uEdge.value = state.edge;
    const lift = smooth(clamp01(state.lift));
    for (const p of panels) {
      // fly: each piece leaves a little after the previous one, grows and bends into shape on the way
      const f = smooth(clamp01((state.fly - p.delay) / (1 - p.delay)));
      const m = smooth(clamp01((state.merge - p.land) / (1 - p.land)));
      tmpV.copy(p.out);
      tmpV.y += Math.sin(time * 1.1 + p.phase) * 0.025 * f * (1 - m);
      p.mesh.position.set(0, 0.28 * lift * (1 - f), 0).addScaledVector(tmpV, f).lerp(p.rest, m);
      p.mesh.morphTargetInfluences[0] = 1 - smooth(clamp01(f * 1.6));
    }
  };

  /** world centre of the cut layout once fed out (for camera framing) */
  const layoutCentre = (out) => {
    if (!knife) return out.set(-2.8, 1.0, -0.6);
    const [x, z] = toStrip(layout.length / 2, layout.filmWidth / 2);
    deform(x, 0, z, Fend, tmp3, null, 0);
    return out.set(tmp3[0], tmp3[1], tmp3[2]);
  };

  /**
   * Stretch the pieces' shapes on the car (not their flat layout on the table) to another car's paint box, so they
   * land on its body, roof and bumpers (for a trial car with no kit of its own; their outlines stay our Urus's).
   * Across and along the car they scale about its centre, upwards about the floor; the flat layout is a delta from the
   * shape, so it is put back.
   */
  const fitTo = (box) => {
    const kb = new THREE.Box3();
    panels.forEach((p) => { p.mesh.geometry.computeBoundingBox(); kb.union(p.mesh.geometry.boundingBox); });
    const s = [
      (box.max.x - box.min.x) / (kb.max.x - kb.min.x),
      box.max.y / kb.max.y,
      (box.max.z - box.min.z) / (kb.max.z - kb.min.z),
    ];
    const scale = new THREE.Vector3(...s);
    panels.forEach((p) => {
      const geo = p.mesh.geometry, pos = geo.attributes.position, d = geo.morphAttributes.position[0];
      for (let v = 0; v < pos.count; v++) {
        for (let a = 0; a < 3; a++) {
          const b = pos.getComponent(v, a);
          d.setComponent(v, a, d.getComponent(v, a) + b - b * s[a]);
          pos.setComponent(v, a, b * s[a]);
        }
      }
      pos.needsUpdate = true;
      d.needsUpdate = true;
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      p.rest.multiply(scale);
      p.out.multiply(scale);
    });
  };

  return {
    state, ready, rig, pieces, update, layoutCentre, fitTo,
    get layout() { return layout; }, get panels() { return panels; }, get base() { return from; },
  };
}
