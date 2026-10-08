import * as THREE from 'three';
import { gltfLoader, asset, HEX_GLSL } from './studio.js';

// Car space = the GLB root: y up, front of the car at -Z, rear at +Z, length ≈ 4.6 m.
export const CAR_LEN = { front: -2.4, rear: 2.4 };
export const CHIP_SLOTS = 4;
const WHEEL_RADIUS = 0.34;

const HEADER = /* glsl */ `
uniform vec2 uMouse; uniform float uRadius; uniform float uHover; uniform float uWrap; uniform float uTime; uniform vec2 uRes;
uniform float uSplit; uniform float uCompare;
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
`;

const WEAR_LIGHTING = /* glsl */ `
{
  float wm = wornMask();
  material.roughness = mix(material.roughness, 0.6, wm);
  #ifdef USE_CLEARCOAT
    material.clearcoat = mix(material.clearcoat, 0.12, wm);
    material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.45, wm);
  #endif
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
  float edge = mix(-2.75, 2.75, uWrap);
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

  // --- three years of city driving without film: swirls, stone chips, oxidised haze
  if (wm > 0.001) {
    vec2 p = hp;
    vec2 cell = floor(p * 3.0);
    vec2 f = fract(p * 3.0) - 0.5 + (vec2(hash12(cell), hash12(cell + 7.1)) - 0.5) * 0.6;
    float ring = fract(length(f) * 38.0 + hash12(cell + 3.0) * 5.0);
    float swirl = smoothstep(0.92, 1.0, ring) * step(0.5, hash12(floor(p * 40.0)));
    vec2 cc = floor(p * 28.0);
    float frontLow = 1.0 - smoothstep(-1.4, -0.4, vCarPos.z) * 0.85;
    float chip = step(0.962, hash12(cc)) * frontLow * (1.0 - smoothstep(0.12, 0.2, length(fract(p * 28.0) - 0.5)));
    gl_FragColor.rgb += vec3(0.55) * swirl * wm * (0.1 + fres * 0.5);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.55, 0.55, 0.57), chip * wm);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(1.0, 0.93, 0.82) + 0.025, wm * 0.6);
  }
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
  };
}

function makePaint(uniforms) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x07080a,
    metalness: 0.55,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.3,
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
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${OVERLAYS}`);
  };
  return m;
}

// The model's green accents become the brand amber.
function recolor(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        float gEx = diffuseColor.g - max(diffuseColor.r, diffuseColor.b);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.56, 0.07) * diffuseColor.g * 1.3, smoothstep(0.05, 0.16, gEx));
      }`,
    );
  };
  mat.needsUpdate = true;
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
      if (o.material.map) recolor(o.material);
    }
  });
  const roll = setupWheels(root);
  const body = root.getObjectByName('Body');
  return { root, paint, body, roll };
}
