import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gltfLoader, asset, HEX_GLSL } from './studio.js';

// Car space = the GLB root: y up, front of the car at -Z, rear at +Z. Lamborghini Urus: 5.11 m long, 1.65 m tall.
export const CAR_LEN = { front: -2.56, rear: 2.56 };
export const CHIP_SLOTS = 4;
const WHEEL_RADIUS = 0.34;
const WEAR_TILE = 1.4; // metres of paint per repeat of the wear texture

const HEADER = /* glsl */ `
uniform vec2 uMouse; uniform float uRadius; uniform float uHover; uniform float uWrap; uniform float uTime; uniform vec2 uRes;
uniform float uSplit; uniform float uCompare; uniform sampler2D uWear;
uniform vec4 uChips[${CHIP_SLOTS}];     // xyz = impact point (car space), w = how visible the mark is
uniform float uChipHeat[${CHIP_SLOTS}]; // self-healing glow
uniform float uGloss;                   // -1 before the film: one flat colour · 0 factory paint · 1 under PPF: deep and mirror-wet
uniform float uSweep;                   // 0→1 a band of light runs nose → tail as the film goes on (off outside 0..1)
uniform float uStudio;                  // the studio softboxes seen in a glossy finish (off when the sun takes over)
uniform float uForm;                    // 0 off · 1 a photo studio's top light: lit tops, deeper sides (the paint's own light)
uniform float uCeramic;                 // 0 off · 1 a ceramic coat: glass-smooth and razor-sharp reflections from the start
uniform float uBoxes;                   // the softboxes' strength for this paint (a dark paint has no colour to hold them)
uniform float uSwirl; uniform float uSwirlHeat; uniform float uSwirlR;
uniform vec3 uSwirlC; uniform vec3 uSwirlN; // swirl marks ring the sun's reflection at uSwirlC (car space, plane normal)
varying vec3 vCarPos; varying vec3 vCarNrm;
${HEX_GLSL}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 carPlane() {
  vec3 an = abs(vCarNrm);
  return an.x > max(an.y, an.z) ? vCarPos.zy : (an.y > an.z ? vCarPos.xz : vCarPos.xy);
}
// 1 on the unprotected (front) side of the before/after split
float wornMask() { return uCompare * (1.0 - smoothstep(uSplit - 0.01, uSplit + 0.01, vCarPos.z)); }
// Stones hit the nose and the forward-facing panels; the roof and rear barely get any.
float chipDensity() {
  float nose = 1.0 - smoothstep(-2.6, -1.0, vCarPos.z);
  return clamp(nose * (0.35 + 0.65 * clamp(-vCarNrm.z, 0.0, 1.0)) + 0.03, 0.0, 1.0);
}
vec3 gWear; float gChip; // set before lighting, reused after it
`;

// Three years of city driving without film. Sampled before the early-out so mip selection stays smooth.
const WEAR_LIGHTING = /* glsl */ `
{
  float wm = wornMask();
  gWear = texture2D(uWear, carPlane() / ${WEAR_TILE.toFixed(2)}).rgb;
  gChip = smoothstep(1.0 - chipDensity() * 0.9, 1.06 - chipDensity() * 0.9, gWear.g) * wm;
  if (wm > 0.001) {
    // car-wash haze lives in the clearcoat; the black base under it stays deep
    #ifdef USE_CLEARCOAT
      material.clearcoat = mix(material.clearcoat, 0.85, wm) * (1.0 - gChip);
      material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.12, wm);
    #endif
    // a chip knocks out clearcoat and colour down to the grey primer
    material.diffuseContribution = mix(material.diffuseContribution, vec3(0.36), gChip);
    material.specularColorBlended = mix(material.specularColorBlended, vec3(0.04), gChip);
    material.roughness = mix(material.roughness, 0.85, gChip);
  }
  // under PPF the colour reads cleaner and more saturated (same brightness) and the clear layer is glass-smooth;
  // before it the paint is one flat colour: its clear coat barely reflects and the base sheen is soft
  float gp = max(uGloss, 0.0), gn = max(-uGloss, 0.0);
  float gc = max(gp, uCeramic);           // a ceramic coat gives factory paint the film's clean, glass-smooth top
  vec3 dc = material.diffuseContribution;
  vec3 dl = vec3(dot(dc, vec3(0.2126, 0.7152, 0.0722)));
  material.diffuseContribution = mix(dc, max(dl + (dc - dl) * 1.1, 0.0), gc);
  // a big softbox overhead: bonnet and roof take the light, the flanks fall off into a deeper gold
  material.diffuseContribution *= mix(1.0, mix(0.58, 1.12, smoothstep(-0.35, 0.85, vCarNrm.y)), uForm);
  material.roughness = mix(material.roughness * mix(1.0, 0.8, gc), 0.62, gn);
  #ifdef USE_CLEARCOAT
    material.clearcoat = mix(material.clearcoat, 0.12, gn);
    material.clearcoatRoughness = mix(mix(material.clearcoatRoughness, 0.0, gc), 0.35, gn);
  #endif
}
`;

// Swirls and water spots only scatter light where a highlight already sits, like on a real car.
const WEAR_GLINT = /* glsl */ `
if (wornMask() > 0.001) {
  vec3 spec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  #ifdef USE_CLEARCOAT
    spec += (clearcoatSpecularDirect + clearcoatSpecularIndirect) * material.clearcoat;
  #endif
  float hl = pow(dot(spec, vec3(0.2126, 0.7152, 0.0722)), 0.85);
  float marks = gWear.r + gWear.b * 0.7 * clamp(vCarNrm.y, 0.0, 1.0);
  reflectedLight.directSpecular += vec3(marks * hl * 1.15 * wornMask() * (1.0 - gChip));
}
`;

const OVERLAYS = /* glsl */ `
{
  vec2 hp = carPlane();
  float hex = hexEdge(hp * 7.0);
  vec3 V = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(abs(dot(normal, V)), 0.0, 1.0), 2.0);
  float wm = wornMask();
  vec3 cyan = vec3(0.45, 0.92, 0.98);
  vec3 amber = vec3(1.0, 0.7, 0.28);

  // --- film torch under the cursor (hero)
  vec2 d = gl_FragCoord.xy / uRes - uMouse; d.x *= uRes.x / uRes.y;
  float r = length(d);
  float torch = (1.0 - smoothstep(uRadius * 0.55, uRadius, r)) * uHover;
  float lens = exp(-pow((r - uRadius * 0.92) * 90.0, 2.0)) * uHover;

  // --- film laminated front → rear on scroll
  float edge = mix(-2.9, 2.9, uWrap);
  float wrapped = 1.0 - smoothstep(edge - 0.05, edge + 0.05, vCarPos.z);
  float scan = exp(-pow((vCarPos.z - edge) * 7.0, 2.0)) * step(0.002, uWrap) * step(uWrap, 0.998);

  float ph = fres * 1.6 + vCarPos.z * 0.15 + uTime * 0.05;
  vec3 irid = mix(vec3(0.35, 0.85, 0.95), vec3(0.62, 0.45, 0.95), 0.5 + 0.5 * sin(ph * 6.28318));
  irid = mix(irid, vec3(1.0, 0.72, 0.3), 0.5 + 0.5 * sin(ph * 6.28318 + 2.1));

  gl_FragColor.rgb += (cyan * hex * 0.45 + irid * (0.03 + fres * 0.3)) * torch;
  gl_FragColor.rgb += cyan * lens * 0.35;
  gl_FragColor.rgb += irid * fres * 0.07 * wrapped * (1.0 - wm);
  gl_FragColor.rgb += (amber * 1.3 + cyan * hex * 2.4) * scan;

  // --- stone-chip marks on the film and their self-healing glow
  for (int i = 0; i < ${CHIP_SLOTS}; i++) {
    vec4 c = uChips[i];
    float heat = uChipHeat[i];
    if (c.w < 0.001 && heat < 0.001) continue;
    vec3 rel = vCarPos - c.xyz;
    float dd = length(rel);
    if (dd > 0.14) continue;
    // scaled up from a real ~4 mm chip so it reads on screen
    float a = atan(rel.x + rel.y, rel.z - rel.y);
    float rad = 0.009 + 0.0035 * sin(a * 7.0 + c.x * 91.0) + 0.002 * sin(a * 13.0 + c.z * 57.0);
    float core = 1.0 - smoothstep(rad, rad + 0.0025, dd);
    float halo = (1.0 - smoothstep(rad + 0.002, rad + 0.02, dd)) * (1.0 - core);
    float crack = smoothstep(0.94, 1.0, abs(sin(a * 4.0 + c.y * 40.0))) * (1.0 - smoothstep(0.008, 0.05, dd)) * step(rad, dd);
    float grain = hash12(floor(vCarPos.xz * 2400.0 + vCarPos.y * 900.0));
    vec3 scuff = mix(vec3(0.62, 0.63, 0.66), vec3(0.85, 0.86, 0.88), grain);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, scuff, core * c.w);
    gl_FragColor.rgb += vec3(0.35) * (halo * 0.6 + crack * 0.8) * c.w;
    float warm = exp(-pow(dd / 0.03, 2.0)) * 1.1 + exp(-pow((dd - 0.03) / 0.008, 2.0)) * 0.35;
    gl_FragColor.rgb += vec3(1.0, 0.58, 0.16) * heat * warm;
  }

  // --- faded black goes milky grey, not yellow
  gl_FragColor.rgb += vec3(0.01) * wm * (1.0 - gChip);
  float splitLine = exp(-pow((vCarPos.z - uSplit) * 40.0, 2.0)) * uCompare;
  gl_FragColor.rgb += amber * splitLine * 1.6;

  #ifdef USE_ENVMAP
  float gpo = max(uGloss, 0.0);
  // the studio's softboxes in the clear coat, as a photographer sets them for a car (uForm: the v3 look). Factory
  // paint is glossy but calm: the boxes show as soft, broad glows. Under the film they firm up and brighten a step,
  // no more (real film deepens the paint; pushed further it reads as plastic).
  // A ceramic coat (uCeramic) turns the boxes into crisp, bright shapes, razor-edged and seen face-on too, factory paint
  // already past the film's look and the film a step on. The even sheen of the second reflection stays where the film
  // had it: spread over the whole body it greys the colour, which is what reads as plastic.
  float boxW = uForm * uStudio * uBoxes * (uGloss >= 0.0 ? mix(mix(0.4, 0.62, gpo), mix(0.85, 1.0, gpo), uCeramic) : 0.4 * max(0.0, 1.0 + uGloss));
  float soft = mix(mix(0.12, 0.05, gpo), mix(0.02, 0.006, gpo), uCeramic);    // how blurred the reflected boxes are
  float face = mix(0.12, 0.34, uCeramic);                  // how much of a box shows on a panel seen face-on
  if (gpo > 0.001 || boxW > 0.001) {
    vec3 Vg = normalize(vViewPosition);
    float fg = pow(1.0 - clamp(dot(normal, Vg), 0.0, 1.0), 5.0);
    // --- PPF finish: the film's own mirror-smooth top layer adds a second, sharper reflection (so does a ceramic coat)
    gl_FragColor.rgb += getIBLRadiance(Vg, normal, 0.0) * (0.02 + 0.4 * fg) * mix(gpo, 0.5 + 0.5 * gpo, uCeramic);
    // the softboxes: a lit band round the horizon cut into tall panels, a thin strip above it (crisp, film only), and
    // two long strips overhead running nose to tail. Only the mirror layer sees them; the paint's own light is unchanged.
    vec3 rw = inverseTransformDirection(reflect(-Vg, normal), viewMatrix);
    float ay = fwidth(rw.y) * 0.75 + 1e-4 + soft;
    float band = smoothstep(-0.05 - ay, -0.05 + ay, rw.y) * (1.0 - smoothstep(0.24 - ay, 0.24 + ay, rw.y));
    float ly = fwidth(rw.y) * 0.75 + 1e-4;
    float line = smoothstep(0.35 - ly, 0.35 + ly, rw.y) * (1.0 - smoothstep(0.39 - ly, 0.39 + ly, rw.y)) * max(gpo, 0.75 * uCeramic);
    float az = atan(rw.z, rw.x) * 0.63661977;                 // quarter turns
    float pa = fract(az + 0.5), pw = min(fwidth(az), fwidth(pa)) * 0.75 + 1e-4 + soft * 0.7;   // (atan's seam, fract's wrap)
    float panel = smoothstep(0.1 - pw, 0.1 + pw, pa) * (1.0 - smoothstep(0.86 - pw, 0.86 + pw, pa));
    float ox = abs(rw.x) / max(rw.y, 0.05), ow = fwidth(ox) * 0.75 + 1e-4 + soft * 0.9;
    float over = (smoothstep(0.2 - ow, 0.2 + ow, ox) - smoothstep(0.29 - ow, 0.29 + ow, ox)) * smoothstep(0.5, 0.56, rw.y);
    vec3 boxes = vec3(1.0, 0.98, 0.95) * ((band * 3.0 + line * 2.2) * panel + over * 2.6) * mix(1.0, 1.5, uCeramic);
    gl_FragColor.rgb += boxes * (face + (1.0 - face) * fg) * boxW;
  }
  #endif
  // the film going on: one band of light sweeps the car from nose to tail
  if (uSweep > 0.0 && uSweep < 1.0) {
    float bz = mix(-3.2, 3.2, uSweep);
    float band = exp(-pow((vCarPos.z - bz) * 3.2, 2.0));
    float fs = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 1.5);
    gl_FragColor.rgb += vec3(1.0, 0.97, 0.9) * band * (0.18 + 0.7 * fs) * sin(3.14159 * uSweep);
  }

  // --- swirl marks: random hairline scratches; only the ones lying across the line to the sun's reflection catch
  // its light, so they show as fine rings around the highlight (as on a washed car in sunshine)
  if (uSwirl > 0.001 || uSwirlHeat > 0.001) {
    vec3 sn = normalize(uSwirlN);
    vec3 s1 = normalize(cross(sn, abs(sn.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 s2 = cross(sn, s1);
    vec3 rel = vCarPos - uSwirlC;
    vec2 sp = vec2(dot(rel, s1), dot(rel, s2));
    float sr = length(sp);
    float halo = exp(-pow(sr / uSwirlR, 2.0)) * smoothstep(0.0, uSwirlR * 0.12, sr);
    if (halo > 0.002 && uSwirl > 0.001) {
      vec2 tang = vec2(-sp.y, sp.x) / max(sr, 1e-4);
      float lines = 0.0;
      for (int o = 0; o < 3; o++) {
        // a few centimetres of hairline per cell, not every cell scratched
        float cell = o == 0 ? 0.046 : (o == 1 ? 0.031 : 0.021);
        vec2 q = sp / cell + vec2(float(o) * 17.13, float(o) * 9.71);
        vec2 id = floor(q);
        vec2 f = fract(q) - 0.5;
        float ang = hash12(id) * 6.2831853;
        vec2 dir = vec2(cos(ang), sin(ang));
        float off = (hash12(id + 7.7) - 0.5) * 0.6;
        float across = abs(dot(f, vec2(-dir.y, dir.x)) - off);
        float along = abs(dot(f, dir));
        float px = length(fwidth(q));
        float m = (1.0 - smoothstep(px * 0.18, px * 0.7, across)) * (1.0 - smoothstep(0.3, 0.47, along));
        float has = step(0.28, hash12(id + 5.3));
        lines += m * has * pow(abs(dot(dir, tang)), 16.0) * (0.45 + 0.55 * hash12(id + 3.1));
      }
      gl_FragColor.rgb += vec3(1.0, 0.97, 0.9) * min(lines, 1.0) * halo * uSwirl * 1.35;
    }
    // warm haze while the top coat heals
    float hz = 0.5 + 0.5 * sin(sp.x * 70.0 + sp.y * 40.0 + 6.0 * hash12(floor(sp * 9.0)) + uTime * 2.4);
    gl_FragColor.rgb += vec3(1.0, 0.5, 0.16) * uSwirlHeat * exp(-pow(sr / (uSwirlR * 1.4), 2.0)) * (0.06 + 0.1 * pow(hz, 6.0));
  }
}
`;

export function createUniforms() {
  return {
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uRadius: { value: 0.13 },
    uHover: { value: 0 },
    uWrap: { value: 0 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uCarInv: { value: new THREE.Matrix4() },
    uSplit: { value: CAR_LEN.front - 0.2 },
    uCompare: { value: 0 },
    uChips: { value: Array.from({ length: CHIP_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uChipHeat: { value: new Array(CHIP_SLOTS).fill(0) },
    uWear: { value: makeWearTexture() },
    uGloss: { value: 0 },
    uSweep: { value: -1 },
    uStudio: { value: 1 },
    uForm: { value: 0 },
    uCeramic: { value: 0 },
    uBoxes: { value: 1 },
    uSwirl: { value: 0 },
    uSwirlHeat: { value: 0 },
    uSwirlR: { value: 0.35 },
    uSwirlC: { value: new THREE.Vector3(0, 1.1, -1.7) },
    uSwirlN: { value: new THREE.Vector3(0, 1, 0) },
  };
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tileable wear maps for the unprotected paint, drawn once (seeded, so every visit looks the same).
 * R = rotary-buffer swirl arcs, G = stone chips (value is a per-chip id, culled by density in the
 * shader), B = dried water-spot rings. Mipmapped, so fine marks blur into haze instead of glittering.
 */
function makeWearTexture(size = 2048) {
  const rnd = mulberry32(20261008);
  const pxPerM = size / WEAR_TILE;
  const layer = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    // repeat a mark across the edges it overlaps so the tile has no seams
    const at = (x, y, r, fn) => {
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
        const px = x + dx, py = y + dy;
        if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
        g.save(); g.translate(px, py); fn(g); g.restore();
      }
    };
    draw(g, at);
    return g.getImageData(0, 0, size, size).data;
  };

  const swirls = layer((g, at) => {
    g.globalCompositeOperation = 'lighter';
    // each buffer-pad position leaves a cluster of concentric hairline arcs
    for (let k = 0; k < 110; k++) {
      const x = rnd() * size, y = rnd() * size;
      const maxR = (0.06 + rnd() * 0.3) * pxPerM;
      at(x, y, maxR, (c) => {
        for (let i = 0; i < 60; i++) {
          const r = maxR * (0.08 + rnd() * 0.92);
          const a0 = rnd() * Math.PI * 2;
          c.strokeStyle = `rgba(255,255,255,${0.08 + rnd() * 0.3})`;
          c.lineWidth = 0.8 + rnd() * 1.0;
          c.beginPath(); c.arc(0, 0, r, a0, a0 + 0.25 + rnd() * 1.4); c.stroke();
        }
      });
    }
    // a few longer wash and wipe scratches
    for (let i = 0; i < 45; i++) {
      const len = (0.08 + rnd() * 0.4) * pxPerM, a = rnd() * Math.PI;
      at(rnd() * size, rnd() * size, len, (c) => {
        c.rotate(a);
        c.strokeStyle = `rgba(255,255,255,${0.12 + rnd() * 0.3})`;
        c.lineWidth = 0.7 + rnd() * 0.6;
        c.beginPath(); c.moveTo(-len / 2, 0); c.quadraticCurveTo(0, (rnd() - 0.5) * len * 0.15, len / 2, 0); c.stroke();
      });
    }
  });

  const chips = layer((g, at) => {
    for (let i = 0; i < 2200; i++) {
      // mostly 2–4 mm, the odd 1 cm hit
      const r = (0.0015 + Math.pow(rnd(), 3) * 0.0045) * pxPerM;
      const id = Math.round((0.15 + rnd() * 0.85) * 255);
      const n = 7 + Math.floor(rnd() * 5);
      const pts = Array.from({ length: n }, (_, j) => {
        const a = (j / n) * Math.PI * 2 + rnd() * 0.5, rr = r * (0.55 + rnd() * 0.45);
        return [Math.cos(a) * rr, Math.sin(a) * rr];
      });
      at(rnd() * size, rnd() * size, r, (c) => {
        c.fillStyle = `rgb(${id},${id},${id})`;
        c.beginPath(); pts.forEach(([px, py], j) => (j ? c.lineTo(px, py) : c.moveTo(px, py))); c.fill();
      });
    }
  });

  const spots = layer((g, at) => {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 520; i++) {
      const r = (0.003 + rnd() * 0.011) * pxPerM;
      at(rnd() * size, rnd() * size, r + 2, (c) => {
        c.scale(1, 0.8 + rnd() * 0.4);
        c.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.04})`;
        c.strokeStyle = `rgba(255,255,255,${0.18 + rnd() * 0.3})`;
        c.lineWidth = 0.8 + rnd() * 1.2;
        c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); c.stroke();
      });
    }
  });

  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = swirls[i];
    data[i + 1] = chips[i];
    data[i + 2] = spots[i];
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function makePaint(uniforms) {
  // Giallo: a solid yellow with a hint of pearl under a thick clearcoat
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xf2b200,
    metalness: 0.2,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.15,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uCarInv;\nvarying vec3 vCarPos;\nvarying vec3 vCarNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vCarPos = (uCarInv * modelMatrix * vec4(transformed, 1.0)).xyz;
        vCarNrm = normalize(mat3(uCarInv) * mat3(modelMatrix) * objectNormal);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${WEAR_LIGHTING}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${WEAR_GLINT}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${OVERLAYS}`);
  };
  return m;
}

/**
 * Roll each rim + tyre about its own axle. The wheels sit with ~3° camber, so spinning them about the
 * car's X axis makes them wobble; in each mesh's local space the hub is at the origin and the axle is
 * local X, so the spin goes there (applied before the camber in the parent chain).
 */
function setupWheels(root) {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const wheels = [];
  const radius = {};
  root.traverse((o) => {
    const m = o.isMesh && o.name.match(/^car_wheel_(FL|FR|BL|BR)_car_(tire|body)_0$/);
    if (!m) return;
    // which way local X points along the car decides the sign that rolls the wheel forwards
    const axis = new THREE.Vector3(1, 0, 0).transformDirection(o.matrixWorld).transformDirection(inv);
    wheels.push({ mesh: o, key: m[1], base: o.rotation.x, sign: axis.x >= 0 ? -1 : 1 });
    if (m[2] === 'tire') {
      // rear tyres are larger than the fronts; each wheel turns at its own rate to match the road
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      const s = new THREE.Vector3().setFromMatrixScale(o.matrixWorld).y / new THREE.Vector3().setFromMatrixScale(root.matrixWorld).y;
      radius[m[1]] = ((b.max.y - b.min.y) / 2) * s;
    }
  });
  const angle = { FL: 0, FR: 0, BL: 0, BR: 0 };
  return (dist) => {
    for (const k in angle) angle[k] += dist / (radius[k] || WHEEL_RADIUS);
    wheels.forEach((w) => { w.mesh.rotation.x = w.base + angle[w.key] * w.sign; });
  };
}

// the car on show: the Porsche 911 since 2026-10-26 (?car=urus or another key still loads the others)
export const CAR_KEY = new URLSearchParams(location.search).get('car') ?? 'porsche911';

export async function loadCar(uniforms, { exact = false } = {}) {
  const trial = TRIAL_CARS[CAR_KEY];
  if (trial) return loadTrial(trial, uniforms, exact);
  const gltf = await gltfLoader.loadAsync(asset('models/car.glb'));
  const root = gltf.scene;
  let paint = null;
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'Paint') {
      o.material = makePaint(uniforms);
      paint = o;
    } else if (o.name === 'Glass') {
      o.material = new THREE.MeshPhysicalMaterial({
        color: 0x020304, metalness: 0, roughness: 0.03, clearcoat: 1,
        transparent: true, opacity: 0.86, envMapIntensity: 1.8,
      });
    } else if (o.material && !seen.has(o.material)) {
      seen.add(o.material);
      o.material.envMapIntensity = 1.15;
    }
  });
  const roll = setupWheels(root);
  const body = root.getObjectByName('Body');
  return { root, paint, body, roll };
}

/**
 * Trials (?car=…): other Sketchfab models in place of ours (each credited in the footer under its own licence; only
 * the 911's files are deployed). Each is turned nose to -z, scaled to its real
 * length, centred, wheels on the floor. The meshes that carry its body paint become one Paint mesh in our paint
 * material (the film's gloss, sweep and swirl marks live there; one mesh also serves the bonnet raycast), and
 * dress() sees to the rest. ownColor: the paint keeps the model's own colour (stage.js leaves it unless ?paint=).
 * kit: the folder of its own PPF kit (patterns.json + patterns.glb in its car space; without one, the Urus kit is
 * stretched to it). title, short: its name in the laptop's app (top bar, outliner); without them, the Urus's.
 * (three drops the dots from glTF node names: Plane.077 → Plane077.)
 */
const TRIAL_CARS = {
  // "Lamborghini Urus" by sepp: every part in one black lacquer, its paint two shells; nose +z, about 3× too big
  sepp: {
    url: 'models/sepp/scene.gltf', length: 5.11,
    isPaint: (o) => /^Plane\.?077/.test(o.name),
    dress(o, m) {
      const n = o.name;
      if (/^Plane\.?(092|078|073)/.test(n)) o.material = m.darkGlass;   // greenhouse, sunroof, a side pane
      else if (/^Cube\.?0(63|64|65|70)_/.test(n)) o.material = m.caliper;
      else if (/^Plane\.?076/.test(n)) o.material = m.badge;
      else o.material = m.trim;
    },
  },
  // "2019 Porsche 911 Carrera S Cabriolet (992)" by Ddiaz Design: fully dressed (cabin, lights, rims, the cloth roof).
  // Its paint is a colour atlas, a blue-grey silver with small swatches for trim, kept with its own finish; glass
  // that refracts (transmission: an extra pass every frame) becomes ours
  porsche: {
    url: 'models/porsche/scene.gltf', length: 4.52, ownColor: true, ownFinish: true,
    title: 'Porsche 911 Carrera S Cabriolet', short: 'Porsche 911',
    isPaint: (o) => o.material?.name === 'SMI_1228010001_002',
    dress(o, m) {
      if (o.material.transmission > 0) o.material = m.glass;
      else o.material.envMapIntensity = 1.15;
    },
  },
  // "Porsche 911" (a 2021 911 Targa 4S, 992) by Outlaw Games (CC BY-NC 4.0, credited in the footer; on the live site
  // only through ?car=porsche911, the user's call; a game car re-uploaded from Ddiaz Design's "2021 Porsche 911 Targa
  // 4S (992)"): its paint one plain colour,
  // Racing Yellow, with a finish made for the game's shader (metal 1, rough 0.6), so it takes ours. Its glass (cabin,
  // headlamp covers, targa panel) was black at 40%, which in three dims the reflections with the see-through: clear
  // glass instead, as on Sketchfab, and the lamps' chrome made to catch the light.
  // (viewerColor: the lemon yellow Sketchfab's viewer shows it in, measured off a screenshot; its export carries a
  // warmer yellow, 253/222/0)
  // exact (?studio=sketchfab): everything as Sketchfab has it instead, its own paint (metal under a clear coat) and its
  // 40% black glass included; its specular 1 is an F0 of 8% (ior 1.79 in three), and two parts at opacity 0 never show
  porsche911: {
    url: 'models/porsche911/scene.gltf', length: 4.52, ownColor: true, viewerColor: 0xf4e600,
    kit: 'v3/porsche911/', title: 'Porsche 911 Targa 4S', short: 'Porsche 911',
    isPaint: (o) => o.material?.name === 'PAINT_COLOR_4',
    dress(o, m) {
      const n = o.material.name;
      if (m.exact) {
        if (o.material.opacity === 0) o.visible = false;
        else if (o.material.isMeshPhysicalMaterial) o.material.ior = 1.78885;
        return;
      }
      if (n === 'GLASS_7') o.material = m.clearGlass;
      else if (n === 'LIGHTS_5') o.material.setValues({ envMapIntensity: 2.2, roughness: 0.22 });
      else o.material.envMapIntensity = 1.15;
    },
  },
};

/**
 * The car on show (?car=…), known before it loads: its names in the laptop's app (title in the top bar, short in the
 * outliner) and kit, the folder of its own PPF kit (undefined: the Urus kit).
 */
export const SHOWN_CAR = (() => {
  const urus = { title: 'Lamborghini Urus 2018', short: 'Lamborghini Urus', kit: undefined };
  const trial = TRIAL_CARS[CAR_KEY];
  return trial ? { title: trial.title ?? urus.title, short: trial.short ?? urus.short, kit: trial.kit } : urus;
})();

async function loadTrial(trial, uniforms, exact) {
  const gltf = await gltfLoader.loadAsync(asset(trial.url));
  const model = gltf.scene;
  model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(trial.length / Math.max(size.x, size.z));
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const mid = box.getCenter(new THREE.Vector3());
  model.position.set(-mid.x, -box.min.y, -mid.z);
  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x020304, metalness: 0, roughness: 0.03, clearcoat: 1, transparent: true, opacity: 0.86, envMapIntensity: 1.8,
  });
  // (for a model with no cabin: the far side's inner panels and wheels would show through, and some panes face in)
  const darkGlass = glass.clone();
  darkGlass.setValues({ color: 0x010102, opacity: 0.97, side: THREE.DoubleSide });
  const mats = {
    exact,
    glass,
    darkGlass,
    // clear glass that refracts (transmission: one more pass of the opaque scene a frame), reflections at full strength
    clearGlass: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, thickness: 0, ior: 1.5, envMapIntensity: 1.6,
      side: THREE.DoubleSide,
    }),
    trim: new THREE.MeshPhysicalMaterial({
      color: 0x0b0c0e, metalness: 0.25, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.15,
    }),
    caliper: new THREE.MeshPhysicalMaterial({ color: 0xf2bf00, roughness: 0.35, clearcoat: 1, envMapIntensity: 1.15 }),
    badge: new THREE.MeshPhysicalMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.22, envMapIntensity: 1.15 }),
  };
  const shells = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (trial.isPaint(o)) shells.push(o);
    else trial.dress(o, mats);
  });
  const own = shells[0].material;
  // the paint meshes in the root's space, merged (uv kept when they all have it: the colour atlas needs it)
  const keep = shells.every((m) => m.geometry.attributes.uv) && trial.ownColor ? ['position', 'normal', 'uv'] : ['position', 'normal'];
  let parts = shells.map((m) => {
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(m.matrixWorld);
    m.removeFromParent();
    return g;
  });
  if (!parts.every((g) => g.index)) parts = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const material = makePaint(uniforms);
  if (trial.ownColor) {
    material.setValues({ map: own.map, side: own.side });
    material.color.copy(own.color);
  }
  if (trial.ownFinish) material.setValues({ metalness: own.metalness, roughness: own.roughness });
  if (exact) {
    material.setValues({ metalness: own.metalness, roughness: own.roughness, clearcoat: own.clearcoat ?? 0, clearcoatRoughness: own.clearcoatRoughness ?? 0 });
  }
  const paint = new THREE.Mesh(mergeGeometries(parts), material);
  paint.name = 'Paint';
  root.add(paint);
  return { root, paint, body: null, roll: () => {}, ownColor: !!trial.ownColor, trial: true, own, viewerColor: trial.viewerColor, sfModel: model.getObjectByName('Sketchfab_model') };
}
