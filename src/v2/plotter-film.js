import * as THREE from 'three';

/**
 * The film web on the plotter, laid out exactly like the Blender film's curve modifier does it: a 1.52 m strip whose
 * local x runs along the film path (wound round the roll, over the platen and the nose, out along the cutting table)
 * and slides along it with the feed. The knife line rides on the strip and is revealed as the blade runs; once the
 * cut piece lifts out it leaves its hole behind.
 * path = film.json "path": pts (u, w pairs in the path plane), matrix (path plane → world, row-major),
 * strip {x0, x1, n, z0, z1}, outline [[x, y, z, progress], …] in strip coordinates.
 */
export function createPlotterFilm(path, { filmMaterial, lineColor = 0xf4b223 }) {
  // ---- the path polyline, its arc length and per-segment unit tangents
  const n = path.pts.length / 2;
  const U = new Float64Array(n);
  const Wp = new Float64Array(n);
  const S = new Float64Array(n);
  const TU = new Float64Array(n);
  const TW = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    U[i] = path.pts[i * 2];
    Wp[i] = path.pts[i * 2 + 1];
    if (i) {
      const du = U[i] - U[i - 1], dw = Wp[i] - Wp[i - 1];
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

  /** strip coordinates (x along the film, y off its face, z across) at feed F → world position (+ face normal) */
  const deform = (x, y, z, F, pos, nor, o) => {
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
    const w = Wp[i - 1] + (Wp[i] - Wp[i - 1]) * k + tu * y;
    pos[o] = e[0] * u + e[4] * w + e[8] * z + e[12];
    pos[o + 1] = e[1] * u + e[5] * w + e[9] * z + e[13];
    pos[o + 2] = e[2] * u + e[6] * w + e[10] * z + e[14];
    if (nor) {
      nor[o] = -e[0] * tw + e[4] * tu;
      nor[o + 1] = -e[1] * tw + e[5] * tu;
      nor[o + 2] = -e[2] * tw + e[6] * tu;
    }
  };

  // ---- the strip: a ribbon, (n + 1) × 2 vertices
  const { x0, x1, z0, z1 } = path.strip;
  const segs = path.strip.n;
  const sx = new Float32Array(segs + 1);
  const sPos = new Float32Array((segs + 1) * 6);
  const sNor = new Float32Array((segs + 1) * 6);
  const sUv = new Float32Array((segs + 1) * 4);
  const sIdx = [];
  for (let k = 0; k <= segs; k++) {
    sx[k] = x0 + ((x1 - x0) * k) / segs;
    sUv.set([k / segs, 0, k / segs, 1], k * 4);
    if (k < segs) {
      const a = k * 2;
      sIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const stripGeo = new THREE.BufferGeometry();
  stripGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  stripGeo.setAttribute('normal', new THREE.BufferAttribute(sNor, 3).setUsage(THREE.DynamicDrawUsage));
  stripGeo.setAttribute('uv', new THREE.BufferAttribute(sUv, 2));
  stripGeo.setIndex(sIdx);

  // the hole the cut piece leaves: its outline drawn into a mask over the strip's (x, z)
  const mask = (() => {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.beginPath();
    path.outline.forEach(([x, , z], i) => {
      const px = ((x - x0) / (x1 - x0)) * c.width;
      const py = (1 - (z - z0) / (z1 - z0)) * c.height;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.closePath();
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t;
  })();
  const stripMat = filmMaterial.clone();
  const holeU = { uHole: { value: 0 }, uMask: { value: mask } };
  stripMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, holeU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStripUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStripUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHole; uniform sampler2D uMask; varying vec2 vStripUv;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uHole > 0.5 && texture2D(uMask, vStripUv).r > 0.5) discard;');
  };
  const strip = new THREE.Mesh(stripGeo, stripMat);
  strip.frustumCulled = false;
  strip.renderOrder = 2;

  // ---- the knife line: a ribbon along the outline, 2 vertices per outline point, revealed by 'progress'
  const out = path.outline;
  const m = out.length;
  const side = new Float32Array(m * 2);
  for (let i = 0; i < m; i++) {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(m - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[2] - a[2];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    side[i * 2] = -tz;
    side[i * 2 + 1] = tx;
  }
  const lPos = new Float32Array(m * 6);
  const lProg = new Float32Array(m * 2);
  const lIdx = [];
  for (let i = 0; i < m; i++) {
    lProg[i * 2] = lProg[i * 2 + 1] = out[i][3];
    if (i < m - 1) {
      const a = i * 2;
      lIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute('aProg', new THREE.BufferAttribute(lProg, 1));
  lineGeo.setIndex(lIdx);
  const lineU = { uReveal: { value: 0 } };
  const lineMat = new THREE.MeshBasicMaterial({ color: lineColor, side: THREE.DoubleSide, toneMapped: false });
  lineMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lineU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aProg;\nvarying float vProg;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvProg = aProg;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReveal; varying float vProg;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vProg > uReveal) discard;');
  };
  const line = new THREE.Mesh(lineGeo, lineMat);
  line.frustumCulled = false;
  line.renderOrder = 3;

  let lastF = NaN, lastW = NaN;
  /** lay the strip and the knife line out for feed F; halfWidth = knife line half width in metres */
  const update = (F, halfWidth) => {
    if (F !== lastF) {
      for (let k = 0; k <= segs; k++) {
        deform(sx[k], 0, z0, F, sPos, sNor, k * 6);
        deform(sx[k], 0, z1, F, sPos, sNor, k * 6 + 3);
      }
      stripGeo.attributes.position.needsUpdate = true;
      stripGeo.attributes.normal.needsUpdate = true;
    }
    if (F !== lastF || Math.abs(halfWidth - lastW) > 1e-5) {
      for (let i = 0; i < m; i++) {
        const [x, y, z] = out[i];
        const ox = side[i * 2] * halfWidth, oz = side[i * 2 + 1] * halfWidth;
        deform(x + ox, y, z + oz, F, lPos, null, i * 6);
        deform(x - ox, y, z - oz, F, lPos, null, i * 6 + 3);
      }
      lineGeo.attributes.position.needsUpdate = true;
      lastW = halfWidth;
    }
    lastF = F;
  };

  return { strip, line, update, setHole: (on) => { holeU.uHole.value = on ? 1 : 0; }, setReveal: (v) => { lineU.uReveal.value = v; } };
}
