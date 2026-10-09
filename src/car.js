import * as THREE from 'three';
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

export async function loadCar(uniforms) {
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
