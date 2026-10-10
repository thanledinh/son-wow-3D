import * as THREE from 'three';
import { gltfLoader, asset, HEX_GLSL } from './studio.js';

const GOLD = new THREE.Color(0xf4b223);
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Every painted panel's PPF (hood, bumpers, fenders, doors, quarters, roof, tailgate: 13 pieces cut in Blender,
 * scripts/export_web.py) lifts off the car along its own direction and comes back: "PPF covers every panel".
 * state.appear 0→1 lights the film up (clear with a gold rim and a faint hex weave),
 * state.explode 0→1 pushes the panels out, the nose first.
 */
export function createBurst() {
  const group = new THREE.Group();
  group.visible = false;
  const state = { appear: 0, explode: 0 };
  const pieces = [];
  const uniforms = { uAlpha: { value: 0 }, uGlow: { value: 0 } };

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xf2f8ff, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uAlpha; uniform float uGlow;\nvarying vec3 vLocal;\n${HEX_GLSL}`)
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - clamp(abs(dot(normal, V)), 0.0, 1.0), 2.0);
        float hx = hexEdge(vLocal.xz * 9.0 + vLocal.y * 2.0);
        gl_FragColor.rgb += vec3(${GOLD.r.toFixed(3)}, ${GOLD.g.toFixed(3)}, ${GOLD.b.toFixed(3)}) * (fres * 1.4 + hx * 0.35) * uGlow;
        gl_FragColor.a = uAlpha * clamp(0.16 + fres * 0.7 + hx * 0.18, 0.0, 1.0);`,
      );
  };

  const ready = gltfLoader.loadAsync(asset('models/ppf-panels.glb')).then((gltf) => {
    const found = [];
    gltf.scene.traverse((o) => { if (o.userData && o.userData.dir) found.push(o); });
    const zs = found.map((o) => o.position.z);
    const zMin = Math.min(...zs), zMax = Math.max(...zs);
    found.forEach((o, i) => {
      o.traverse((m) => {
        if (!m.isMesh) return;
        m.material = mat;
        m.renderOrder = 6;
        m.frustumCulled = false;
      });
      const r = Math.sin(i * 12.9898) * 43758.5453;
      const rnd = r - Math.floor(r);
      pieces.push({
        obj: o,
        rest: o.position.clone(),
        dir: new THREE.Vector3().fromArray(o.userData.dir).normalize(),
        dist: 0.75 + rnd * 0.25,
        // the nose (car-space -Z) leaves first
        delay: ((o.position.z - zMin) / Math.max(1e-6, zMax - zMin)) * 0.3,
        spin: new THREE.Euler((rnd - 0.5) * 0.25, (0.5 - rnd) * 0.2, (rnd - 0.5) * 0.3),
      });
    });
    group.add(gltf.scene);
  });

  const attach = (carRoot) => carRoot.add(group);

  const update = () => {
    group.visible = state.appear > 0.001;
    if (!group.visible) return;
    uniforms.uAlpha.value = state.appear;
    uniforms.uGlow.value = state.appear;
    for (const p of pieces) {
      const k = smooth(Math.min(1, Math.max(0, (state.explode - p.delay) / (1 - p.delay))));
      p.obj.position.copy(p.rest).addScaledVector(p.dir, p.dist * k);
      p.obj.rotation.set(p.spin.x * k, p.spin.y * k, p.spin.z * k);
    }
  };

  return { state, ready, attach, update, group };
}
