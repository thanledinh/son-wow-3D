import * as THREE from 'three';
import { HEX_GLSL } from '../studio.js';

const GOLD = new THREE.Color(0xf4b223);
const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
const glsl3 = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

/**
 * PPF on the roll / the cut piece: a clear, glossy, slightly milky sheet (the film's PPF_FilmSheet).
 * With rim, uniforms.uRim 0→1 turns the sheet milkier with a thin gold glint at grazing angles, so the cut piece
 * reads while it flies.
 */
export function filmSheet({ rim = false } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xe4eef8, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
    transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.1,
  });
  if (rim) {
    const uniforms = { uRim: { value: 0 } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uRim;')
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          float fres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.82, 0.88, 0.94) * (0.55 + 0.45 * fres), 0.3 * uRim)
            + ${glsl3(GOLD)} * pow(fres, 8.0) * 0.5 * uRim;
          gl_FragColor.a = clamp(gl_FragColor.a + 0.22 * uRim, 0.0, 1.0);`);
    };
    m.userData.uniforms = uniforms;
  }
  return m;
}

// The shop's five PPF layers, top → bottom (colours and opacities from blender/scripts/film_2_hood_layers.py).
export const LAYER_LOOK = [
  { key: 'L1', color: lin(0.92, 0.96, 0.98), alpha: 0.35, iridescence: 1 },
  { key: 'L2', color: lin(0.56, 0.89, 0.93), alpha: 0.5 },
  { key: 'L3', color: lin(0.05, 0.54, 0.58), alpha: 0.88, hex: 1 },
  { key: 'L4', color: lin(0.35, 0.05, 0.14), alpha: 0.85 },
  { key: 'L5', color: lin(0.44, 0.52, 0.6), alpha: 0.92 },
];

export function layerMaterial(look) {
  const m = new THREE.MeshPhysicalMaterial({
    color: look.color, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
    iridescence: look.iridescence || 0, iridescenceIOR: 1.4, iridescenceThicknessRange: [260, 620],
    emissive: look.color, emissiveIntensity: 0.15,
    transparent: true, opacity: look.alpha, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2,
  });
  if (look.hex) {
    // the TPU core carries the brand's honeycomb, glowing cyan on the cell edges
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vLocal;\n${HEX_GLSL}`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          gl_FragColor.rgb += vec3(0.5, 0.95, 1.0) * hexEdge(vLocal.xz * 26.0) * 0.9;`);
    };
  }
  return m;
}

/**
 * The film once it is on the car (every panel + the hood, PPF_Applied): almost invisible at rest, a gold-rimmed
 * honeycomb glow while it is lifted off the car. uniforms.uGlow 0→1.
 */
export function appliedFilm() {
  const uniforms = { uGlow: { value: 0 } };
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xf2f8ff, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uGlow;\nvarying vec3 vLocal;\n${HEX_GLSL}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - clamp(abs(dot(normal, V)), 0.0, 1.0), 2.0);
        float hx = hexEdge(vLocal.xz * 11.0 + vLocal.y * 3.0);
        gl_FragColor.rgb += ${glsl3(GOLD)} * (fres * 1.3 + hx * 0.9) * uGlow;
        gl_FragColor.a = clamp(mix(0.05, 0.42, uGlow) + fres * mix(0.12, 0.45, uGlow) + hx * 0.25 * uGlow, 0.0, 1.0);`);
  };
  m.userData.uniforms = uniforms;
  return m;
}

/**
 * Key scratches on the applied hood film: three strokes (one channel each of scratches.png, blender/textures),
 * each revealed up to where the key tip has reached (uReveal), all fading as the top coat heals (uHeal).
 * The texture is mapped from above over the hood's box (hoodUV = [xmin, xmax, ymin, ymax], Blender axes).
 */
export function scratchMaterial(tex, hoodUV) {
  const uniforms = {
    uScr: { value: tex },
    uReveal: { value: new THREE.Vector3() },
    uHeal: { value: 0 },
    uBox: { value: new THREE.Vector4(...hoodUV) },
  };
  const m = new THREE.MeshStandardMaterial({
    color: 0xf2f4f7, roughness: 0.45, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uBox;\nvarying vec2 vHoodUv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vHoodUv = vec2((position.x - uBox.x) / (uBox.y - uBox.x), (-position.z - uBox.z) / (uBox.w - uBox.z));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uScr; uniform vec3 uReveal; uniform float uHeal; varying vec2 vHoodUv;')
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        vec3 sc = texture2D(uScr, vHoodUv).rgb;
        vec3 on = step(vec3(vHoodUv.x), uReveal);
        diffuseColor.a = clamp(dot(sc, on), 0.0, 1.0) * (1.0 - uHeal);`);
  };
  m.userData.uniforms = uniforms;
  return m;
}

/**
 * Warm heat shimmer over the scratched part of the hood while it self-heals (additive): thin wavering crests of
 * heat haze over a faint warm wash, strongest where the key went. uniforms.uHeat 0→~0.55, uTime.
 */
export function heatMaterial(hoodUV) {
  const uniforms = { uHeat: { value: 0 }, uTime: { value: 0 }, uBox: { value: new THREE.Vector4(...hoodUV) } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uHeat; uniform float uTime; uniform vec4 uBox;
      varying vec3 vP;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec2 p = vP.xz;
        vec2 uv = vec2((vP.x - uBox.x) / (uBox.y - uBox.x), (-vP.z - uBox.z) / (uBox.w - uBox.z));
        float area = exp(-pow((uv.x - 0.5) / 0.34, 2.0) - pow((uv.y - 0.52) / 0.16, 2.0));
        float d = noise(p * 9.0 + uTime * 0.3) * 1.5 + noise(p * 22.0 - uTime * 0.5) * 0.5;
        float crest = pow(0.5 + 0.5 * sin((p.x * 11.0 + p.y * 6.0) * 6.2831 + d * 4.0 - uTime * 2.2), 14.0);
        // added straight onto the (sRGB) frame, so these are small display-space increments
        vec3 col = vec3(1.0, 0.45, 0.12) * (crest * 0.35 + 0.06) * uHeat * area;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  m.userData.uniforms = uniforms;
  return m;
}

export const keyMaterials = () => ({
  blade: new THREE.MeshStandardMaterial({ color: 0xd9dbde, metalness: 1, roughness: 0.28 }),
  head: new THREE.MeshPhysicalMaterial({ color: 0x111114, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }),
});
