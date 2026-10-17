import * as THREE from 'three';

/**
 * The plotter's data cable, run from its socket at the back of the machine across the floor and up the desk into the
 * laptop. While the kit is sent, pulses of light travel along it from the laptop to the plotter.
 * points: the route, plotter socket first, laptop port last.
 * state: flow 0→1 (the data front runs laptop → plotter), pulse 0→1 (how bright), alpha (fades with the laptop)
 */
export function createCable(points) {
  const state = { flow: 0, pulse: 0, alpha: 1 };
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  const geo = new THREE.TubeGeometry(curve, 320, 0.0042, 8, false);
  const u = { uFlow: { value: 0 }, uPulse: { value: 0 }, uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: 0x8ccbf0, roughness: 0.4, metalness: 0, transparent: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCableU;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCableU = uv.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFlow; uniform float uPulse; uniform float uTime; varying float vCableU;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // u = 0 at the plotter, 1 at the laptop: the data front leaves the laptop and runs to the plotter,
        // trains of light follow it
        float head = 1.0 - uFlow * 1.04;
        float behind = smoothstep(head - 0.015, head + 0.015, vCableU);
        float dash = smoothstep(0.5, 1.0, fract(vCableU * 30.0 + uTime * 2.6));
        float front = exp(-pow((vCableU - head) * 45.0, 2.0));
        totalEmissiveRadiance += vec3(1.0, 0.76, 0.28) * (dash * behind * 2.4 + front * 5.0) * uPulse;`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);

  // a plug at each end, along the cable
  const plugMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.35, metalness: 0.3, transparent: true });
  const plug = (t, len) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.009, len), plugMat);
    const at = curve.getPointAt(t), tan = curve.getTangentAt(t);
    p.position.copy(at).addScaledVector(tan, t === 0 ? len / 2 - 0.004 : -(len / 2 - 0.004));
    p.lookAt(p.position.clone().add(tan));
    group.add(p);
  };
  plug(0, 0.03);
  plug(1, 0.026);

  const update = (time) => {
    u.uTime.value = time;
    u.uFlow.value = state.flow;
    u.uPulse.value = state.pulse;
    mat.opacity = plugMat.opacity = state.alpha;
    group.visible = state.alpha > 0.002;
  };
  return { state, group, update };
}
