import * as THREE from 'three';

/**
 * The self-healing cutting mat on the table: dark green with a 5 cm grid and brighter 50 cm lines (as in the
 * Blender film). The table mesh is baked in car space, so the grid comes straight from the vertex x/z.
 * Lines thinner than a pixel fade into the base colour instead of shimmering.
 */
export function cuttingMat() {
  const m = new THREE.MeshStandardMaterial({ color: 0x173528, roughness: 0.82, metalness: 0, envMapIntensity: 0.55 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = position.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vMat;
        float gridLines(vec2 p, float w) {
          vec2 fw = max(fwidth(p), vec2(1e-4));
          vec2 d = abs(fract(p + 0.5) - 0.5);
          vec2 l = (1.0 - smoothstep(vec2(w * 0.5), vec2(w * 0.5) + fw * 1.2, d)) * clamp(1.4 - fw * 4.0, 0.0, 1.0);
          return max(l.x, l.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.12, 0.085), gridLines(vMat / 0.05, 0.05) * 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.19, 0.14), gridLines(vMat / 0.5, 0.012));`,
      );
  };
  return m;
}
