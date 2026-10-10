import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { gltfLoader, asset } from './studio.js';

const GOLD = 0xf4b223;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

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

/**
 * The shop's ZAPPA M-1600 cuts the hood pattern out of the film, then the piece flies onto the bonnet.
 * Everything is in car space (the Urus GLB root), exported from blender/ppf-panels.blend (scripts/export_web.py).
 *  state.cut  0→1  knife runs the outline; the film jogs so the cut point always sits under the blade
 *  state.push 0→1  the finished pattern is fed out onto the table, the carriage parks
 *  state.lift 0→1  the cut piece rises off the table
 *  state.fly  0→1  it flies to the hood and bends to its shape
 *  state.piece 1→0 the landed piece fades as the full-car wrap takes over
 */
export function createCutter() {
  const machine = new THREE.Group();   // plotter + table + film sheet + knife line
  const flyer = new THREE.Group();     // the cut piece (separate, so the machine can leave first)
  machine.visible = false;
  flyer.visible = false;
  const state = { show: 0, cut: 0, push: 0, lift: 0, fly: 0, piece: 1 };

  let C = null, carriage = null, roll = null, piece = null, pieceMat = null;
  let sheet = null, line = null, lineMat = null, segCount = 0;
  let pts = [], cum = [], total = 1, xFront = 0;
  const feed = new THREE.Group();      // sheet + line slide along x with the feed
  machine.add(feed);
  const start = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
  const end = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
  const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

  const ready = Promise.all([
    gltfLoader.loadAsync(asset('models/plotter.glb')),
    gltfLoader.loadAsync(asset('models/hood-fly.glb')),
    fetch(asset('models/cut.json')).then((r) => r.json()),
  ]).then(([plotter, hf, cut]) => {
    C = cut;
    machine.add(plotter.scene);
    carriage = plotter.scene.getObjectByName('Plotter_Carriage');
    roll = plotter.scene.getObjectByName('Plotter_Roll');
    plotter.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.material.envMapIntensity = 0.9;
      // procedural Blender materials export as plain colours: rebuild the green cutting mat with its grid
      if (o.material.name.startsWith('Table_CutMat')) o.material = cuttingMat();
    });

    // the knife outline, in the pose the cut piece ends up in on the table
    pts = cut.outline.map(([x, y, z]) => new THREE.Vector3(x, y + 0.0016, z));
    cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    total = cum[cum.length - 1];
    xFront = Math.max(...pts.map((p) => p.x)) + 0.22;
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    lineMat = new LineMaterial({ color: GOLD, linewidth: 3, transparent: true, depthWrite: false });
    line = new Line2(geo, lineMat);
    line.computeLineDistances();
    line.renderOrder = 3;
    segCount = pts.length - 1;
    geo.instanceCount = 0;
    feed.add(line);

    // the 1.52 m film web over the table (a unit plane, stretched every frame)
    sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({
        color: 0x9fb3c2, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
        transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 0.7,
      }),
    );
    sheet.position.set(0, cut.tableTopY + 0.0008, cut.filmCenterZ);
    sheet.scale.set(1, 1, cut.filmWidth);
    sheet.renderOrder = 2;
    feed.add(sheet);

    // the cut hood piece: flat on the table at the start, bent to the hood (morph 'OnHood') at the end
    const startNode = hf.scene.getObjectByName('HoodFlyStart');
    hf.scene.traverse((o) => { if (o.isMesh && !piece) piece = o; });
    startNode.updateMatrix();
    startNode.matrix.decompose(start.p, start.q, start.s);
    piece.updateMatrix();
    piece.matrix.decompose(end.p, end.q, end.s);
    pieceMat = new THREE.MeshPhysicalMaterial({
      color: 0xeaf6ff, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
      transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
      emissive: new THREE.Color(GOLD), emissiveIntensity: 0.12, envMapIntensity: 1.4,
    });
    piece.material = pieceMat;
    piece.renderOrder = 4;
    piece.frustumCulled = false;
    flyer.add(piece);
  });

  // pools of light over the plotter and the cutting table (the film's Studio_Machine / Studio_Table lights).
  // They stay in the scene at zero intensity while the plotter is away: adding or removing lights recompiles
  // every material.
  const pools = [
    { at: [-4.1, 3.1, -0.6], to: [-4.2, 1.0, -0.6], i: 3.2 },
    { at: [-2.8, 3.0, -0.6], to: [-2.8, 1.0, -0.6], i: 3.6 },
  ].map(({ at, to, i }) => {
    const l = new THREE.SpotLight(0xfff4e6, 0, 0, 0.75, 1, 2);
    l.position.fromArray(at);
    l.target.position.fromArray(to);
    l.userData.full = i;
    return l;
  });

  /** Mount under the car root: the assets were exported in the car's own coordinates. */
  const attach = (carRoot) => {
    carRoot.add(machine);
    carRoot.add(flyer);
    pools.forEach((l) => carRoot.add(l, l.target));
  };

  const pointAt = (u) => {
    const d = clamp01(u) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const k = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return { p: tmpP.copy(pts[i - 1]).lerp(pts[i], k), seg: i - 1 + k };
  };

  const update = (W, H) => {
    if (!C) return;
    machine.visible = state.show > 0.001;
    flyer.visible = state.push > 0.985 && state.piece > 0.001;
    pools.forEach((l) => { l.intensity = machine.visible ? l.userData.full * state.show : 0; });
    if (!machine.visible && !flyer.visible) return;
    lineMat.resolution.set(W, H);

    // feed: while cutting, the outline point being cut sits under the blade; then the pattern is fed out
    const { p, seg } = pointAt(state.cut);
    const cutOff = C.bladeX - p.x;
    const off = state.cut > 0 ? cutOff * (1 - smooth(state.push)) : cutOff;
    feed.position.x = off;
    if (roll) roll.rotation.z = off / C.rollRadius;
    if (carriage) carriage.position.z = (p.z - C.carriageRestZ) * (1 - smooth(state.push)) * (state.cut > 0 ? 1 : 0);

    // film web from just inside the machine to its leading edge
    const back = C.bladeX - 0.12 - off;
    sheet.scale.x = Math.max(0.01, xFront - back);
    sheet.position.x = (xFront + back) / 2;

    // knife line drawn up to the blade, fading once the piece is lifted out
    line.geometry.instanceCount = state.cut >= 1 ? segCount : Math.floor(seg);
    lineMat.opacity = 1 - smooth(clamp01(state.lift * 1.5));
    line.visible = lineMat.opacity > 0.01 && state.cut > 0;

    // the cut piece: lift, arc to the hood, bend onto it
    if (flyer.visible) {
      const lift = smooth(state.lift), u = smooth(state.fly);
      piece.position.copy(start.p).addScaledVector(THREE.Object3D.DEFAULT_UP, 0.35 * lift);
      piece.position.lerp(end.p, u).addScaledVector(THREE.Object3D.DEFAULT_UP, Math.sin(Math.PI * u) * 0.55);
      piece.quaternion.copy(start.q).slerp(end.q, u);
      piece.scale.copy(start.s).lerp(end.s, u);
      if (piece.morphTargetInfluences) piece.morphTargetInfluences[0] = smooth(clamp01((state.fly - 0.55) / 0.45));
      pieceMat.opacity = 0.6 * state.piece;
      pieceMat.emissiveIntensity = 0.12 + 0.35 * Math.sin(Math.PI * u);
    }
  };

  return { state, ready, attach, update, machine, flyer };
}
