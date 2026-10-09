import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

const BASE = import.meta.env.BASE_URL;

export const loadingManager = THREE.DefaultLoadingManager;

const draco = new DRACOLoader().setDecoderPath(`${BASE}draco/`);
export const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
// Bump when re-exporting models from Blender so browsers don't serve a stale GLB.
const ASSET_VERSION = 10;
export const asset = (p) => `${BASE}${p}?v=${ASSET_VERSION}`;
export const hdrLoader = new HDRLoader();

/**
 * Photo studio rendered into a PMREM environment map: long softbox strips give the classic
 * car-showroom reflection lines. With `hdr` (a real studio HDRI) the strips sit inside a photographed
 * room, which gives reflections the uneven, believable falloff a hand-built room lacks; its lower
 * half is darkened so it agrees with the black floor.
 */
export function makeStudioEnv(renderer, { warm = 1, cool = 1, hdr = null, hdrGain = 0.55, strips = 1 } = {}) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x030304);
  if (hdr) {
    const room = new THREE.Mesh(
      new THREE.SphereGeometry(20, 64, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { map: { value: hdr }, uGain: { value: hdrGain } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map; uniform float uGain;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
            vec3 c = texture2D(map, uv).rgb * uGain;
            c *= mix(0.08, 1.0, smoothstep(-0.2, 0.3, d.y));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    env.add(room);
  }
  const plane = new THREE.PlaneGeometry(1, 1);
  const add = (color, intensity, pos, scale) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity * strips), side: THREE.DoubleSide });
    const m = new THREE.Mesh(plane, mat);
    m.position.set(...pos);
    m.scale.set(scale[0], scale[1], 1);
    m.lookAt(0, 0.5, 0);
    env.add(m);
  };
  add(0xffffff, 2.4, [0, 8, 0], [5, 14]);            // overhead softbox
  add(0xffffff, 7.0, [-8, 2.6, 0], [16, 0.5]);       // left strip
  add(0xffffff, 7.0, [8, 2.6, 0], [16, 0.5]);        // right strip
  add(0xffffff, 3.0, [-8, 0.9, 0], [16, 0.18]);      // low left strip
  add(0xffffff, 3.0, [8, 0.9, 0], [16, 0.18]);       // low right strip
  add(0xffffff, 1.6, [0, 2.5, 9], [7, 2.2]);         // front fill
  add(0xffb347, 3.2 * warm, [-6, 1.5, -7], [4, 3]);  // warm rim
  add(0x7fe7ef, 1.8 * cool, [6, 1.2, -7], [3, 2]);   // cool rim
  add(0x15171a, 1.0, [0, -2, 0], [30, 30]);          // floor bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  env.traverse((o) => o.material && o.material.dispose());
  return tex;
}

/** Soft radial gradient texture (white center → transparent edge), for shadows and fades. */
export function radialTexture(inner = 'rgba(0,0,0,1)', outer = 'rgba(0,0,0,0)', size = 256, stop = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, size * stop * 0.5, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Shared GLSL: distance to the nearest hex edge, 0 at cell centre → 1 on the edge. */
export const HEX_GLSL = /* glsl */ `
float hexEdge(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  float d = max(dot(q, normalize(s)), q.x);
  return smoothstep(0.43, 0.5, d);
}
`;

/** Renders only while the element is on screen. */
export function whenVisible(el, cb) {
  const io = new IntersectionObserver(([e]) => cb(e.isIntersecting), { rootMargin: '100px' });
  io.observe(el);
  return io;
}

export const isTouch = matchMedia('(hover: none), (pointer: coarse)').matches;
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
