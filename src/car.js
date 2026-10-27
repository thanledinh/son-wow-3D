import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gltfLoader, asset } from './studio.js';

// The car: "Porsche 911" (a 2021 911 Targa 4S, 992) by Outlaw Games (CC BY-NC 4.0, credited in the footer; a game car
// re-uploaded from Ddiaz Design's "2021 Porsche 911 Targa 4S (992)"), 4.52 m long.
// Car space = the group it is loaded into: y up, nose at -z, centred, wheels on the floor.
const LENGTH = 4.52;
export const CAR = { title: 'Porsche 911 Targa 4S', short: 'Porsche 911' };   // its names in the laptop's app

const HEADER = /* glsl */ `
uniform float uTime;
uniform float uGloss;                   // 0 factory paint · 1 under PPF: deeper colour, a second mirror-sharp reflection
uniform float uSweep;                   // 0→1 a band of light runs nose → tail as the film goes on (off outside 0..1)
uniform float uSwirl; uniform float uSwirlHeat; uniform float uSwirlR;
uniform vec3 uSwirlC; uniform vec3 uSwirlN; // swirl marks ring the sun's reflection at uSwirlC (car space, plane normal)
varying vec3 vCarPos; varying vec3 vCarNrm;  // the fragment's position and normal in car space
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

// Under PPF the colour reads cleaner and more saturated (same brightness) and the clear layer is glass-smooth.
const GLOSS_LIGHTING = /* glsl */ `
{
  vec3 dc = material.diffuseContribution;
  vec3 dl = vec3(dot(dc, vec3(0.2126, 0.7152, 0.0722)));
  material.diffuseContribution = mix(dc, max(dl + (dc - dl) * 1.1, 0.0), uGloss);
  material.roughness *= mix(1.0, 0.8, uGloss);
  #ifdef USE_CLEARCOAT
    // (down to the surface's own curvature term, three's specular anti-aliasing: at 0 the outline and the reflections'
    // edges came out a mirror's hard, stair-stepped line)
    material.clearcoatRoughness = mix(material.clearcoatRoughness, geometryRoughness, uGloss);
  #endif
}
`;

const OVERLAYS = /* glsl */ `
{
  #ifdef USE_ENVMAP
  // under the film: its own mirror-smooth top layer adds a second, sharper reflection
  if (uGloss > 0.001) {
    vec3 Vg = normalize(vViewPosition);
    float fg = pow(1.0 - clamp(dot(normal, Vg), 0.0, 1.0), 5.0);
    gl_FragColor.rgb += getIBLRadiance(Vg, normal, geometryRoughness) * (0.02 + 0.4 * fg) * uGloss;
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
      for (int o = 0; o < 12; o++) {
        // a centimetre or two of fine hairline per cell, not every cell scratched (longer or brighter read as a car
        // keyed rather than washed); each of the three sizes four times, on grids offset from each other
        int k = o % 3;
        float cell = k == 0 ? 0.03 : (k == 1 ? 0.02 : 0.013);
        vec2 q = sp / cell + vec2(float(o) * 17.13, float(o) * 9.71);
        vec2 id = floor(q);
        vec2 f = fract(q) - 0.5;
        float ang = hash12(id) * 6.2831853;
        vec2 dir = vec2(cos(ang), sin(ang));
        float off = (hash12(id + 7.7) - 0.5) * 0.6;
        float across = abs(dot(f, vec2(-dir.y, dir.x)) - off);
        float along = abs(dot(f, dir));
        float px = length(fwidth(q));
        float m = (1.0 - smoothstep(px * 0.14, px * 0.6, across)) * (1.0 - smoothstep(0.22, 0.36, along));
        float has = step(0.3, hash12(id + 5.3));
        lines += m * has * pow(abs(dot(dir, tang)), 8.0) * (0.45 + 0.55 * hash12(id + 3.1));
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
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },     // the page's drawing buffer (px), kept by the stage
    uCarInv: { value: new THREE.Matrix4() },
    uGloss: { value: 0 },
    uSweep: { value: -1 },
    uSwirl: { value: 0 },
    uSwirlHeat: { value: 0 },
    uSwirlR: { value: 0.35 },
    uSwirlC: { value: new THREE.Vector3(0, 1.1, -1.7) },
    uSwirlN: { value: new THREE.Vector3(0, 1, 0) },
    sfCoatLight: { value: 0 },                     // the lights' highlights in the clear coat (sflook.js patchShading)
  };
}

/**
 * The body paint: the model's own (its colour, a metal under a clear coat, as Sketchfab has it), its reflections a
 * touch stronger, with the film's look (uGloss), the light sweeping on with it (uSweep) and the swirl marks in the sun
 * (uSwirl*) worked in, all in car space (uCarInv).
 */
function makePaint(uniforms, own) {
  const m = new THREE.MeshPhysicalMaterial({
    color: own.color, side: own.side, metalness: own.metalness, roughness: own.roughness,
    clearcoat: own.clearcoat, clearcoatRoughness: own.clearcoatRoughness, envMapIntensity: 1.15,
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
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${GLOSS_LIGHTING}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${OVERLAYS}`);
  };
  return m;
}

/**
 * The car as Sketchfab has it (sflook.js gives it Sketchfab's light): turned nose to -z, scaled to its real length,
 * centred, wheels on the floor. The meshes of its body paint become one Paint mesh in our paint material (the film's
 * gloss, sweep and swirl marks live there; one mesh also serves the bonnet raycast). The rest keeps its own materials:
 * their specular 1 is an F0 of 8% (ior 1.79 in three), and two parts at opacity 0 never show.
 * sfModel: its Sketchfab_model node, whose frame is Sketchfab's world (?sfcam).
 * The file is the download made lighter: the parts never seen from outside dropped, the cabin seen through the glass
 * simplified a little, then Draco geometry and WebP textures, its materials as they came (2 MB instead of 7.4).
 */
export async function loadCar(uniforms) {
  const gltf = await gltfLoader.loadAsync(asset('models/porsche911/porsche911.glb'));
  const model = gltf.scene;
  model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(LENGTH / Math.max(size.x, size.z));
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const mid = box.getCenter(new THREE.Vector3());
  model.position.set(-mid.x, -box.min.y, -mid.z);
  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);

  const shells = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.name === 'PAINT_COLOR_4') shells.push(o);
    else if (o.material.opacity === 0) o.visible = false;
    else if (o.material.isMeshPhysicalMaterial) o.material.ior = 1.78885;
  });
  // the paint meshes in the root's space, merged (one plain colour: position and normal are all it needs)
  let parts = shells.map((m) => {
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(m.matrixWorld);
    m.removeFromParent();
    return g;
  });
  if (!parts.every((g) => g.index)) parts = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const paint = new THREE.Mesh(mergeGeometries(parts), makePaint(uniforms, shells[0].material));
  paint.name = 'Paint';
  root.add(paint);
  return { root, paint, sfModel: model.getObjectByName('Sketchfab_model') };
}
