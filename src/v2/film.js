import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { makeStudioEnv, radialTexture, hdrLoader, asset, gltfLoader, SOFT_REFLECTOR, isTouch } from '../studio.js';
import { loadCar, createUniforms } from '../car.js';
import { cuttingMat } from '../cutter.js';
import { createTracks } from './tracks.js';
import { createPlotterFilm } from './plotter-film.js';
import { filmSheet, LAYER_LOOK, layerMaterial, appliedFilm, scratchMaterial, heatMaterial, keyMaterials } from './looks.js';

const BG = 0x060708;
const FILM_OPACITY = 0.34;      // the sheet at the film's full alpha (0.93)
const ROLL_R = 0.0605;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/**
 * The PPF film from blender/ppf-panels.blend, replayed in real time. The camera path, every moving piece and the
 * animated material values come from film.json / film.glb (blender/scripts/export_film_web.py); the car, the plotter
 * and the studio are the site's own assets. Car space == film world (the Urus at the origin, nose at -Z).
 * setFrame(f) poses everything for a (fractional) film frame 1…1310; render() draws it.
 */
export function createFilm({ canvas }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio, 1.75);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.environment = makeStudioEnv(renderer);
  scene.fog = new THREE.Fog(BG, 14, 34);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 120);

  const envReady = hdrLoader.loadAsync(asset('textures/studio.hdr')).then((hdr) => {
    const old = scene.environment;
    scene.environment = makeStudioEnv(renderer, { hdr, strips: 0.7 });
    old.dispose();
    hdr.dispose();
  }).catch((err) => console.warn('studio HDRI unavailable, keeping the procedural studio', err));

  // ---- floor: soft glossy epoxy that fades into the dark, centred between the car and the plotter
  const FLOOR_X = -1.6;
  const mirror = new Reflector(new THREE.PlaneGeometry(44, 44), { color: 0x5a5a5a, textureWidth: 1024, textureHeight: 1024, shader: SOFT_REFLECTOR });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.x = FLOOR_X;
  scene.add(mirror);
  const overFloor = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  const fade = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshBasicMaterial({ color: BG, transparent: true, depthWrite: false, alphaMap: radialTexture('rgb(140,140,140)', 'rgb(255,255,255)', 512), ...overFloor }),
  );
  fade.rotation.x = -Math.PI / 2;
  fade.position.set(FLOOR_X, 0.01, 0);
  scene.add(fade);
  const outer = new THREE.Mesh(new THREE.RingGeometry(14.9, 44, 64), new THREE.MeshBasicMaterial({ color: BG, ...overFloor }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(FLOOR_X, 0.01, 0);
  scene.add(outer);

  // contact shadows: the Urus's ambient occlusion baked in Blender, a soft pool under the plotter and table
  const shadowMat = (map, strength) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { map: { value: map }, uStrength: { value: strength } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float uStrength; varying vec2 vUv; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, pow(1.0 - texture2D(map, vUv).r, 1.1) * uStrength); }',
  });
  const carShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 6.6), shadowMat(new THREE.TextureLoader().load(asset('textures/car-shadow.jpg')), 0.96));
  carShadow.rotation.x = -Math.PI / 2;
  carShadow.position.y = 0.006;
  scene.add(carShadow);
  const rigShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.0, 2.6),
    shadowMat(radialTexture('rgb(40,40,40)', 'rgb(255,255,255)', 256), 0.75),
  );
  rigShadow.rotation.x = -Math.PI / 2;
  rigShadow.position.set(-3.05, 0.006, -0.6);
  scene.add(rigShadow);

  // pools of light over the plotter and the cutting table (the film's Studio_Machine / Studio_Table). They stay in
  // the scene at zero intensity while the plotter is away: adding or removing lights recompiles every material.
  const pools = [
    { at: [-4.1, 3.1, -0.6], to: [-4.2, 1.0, -0.6], i: 3.2 },
    { at: [-2.8, 3.0, -0.6], to: [-2.8, 1.0, -0.6], i: 3.6 },
  ].map(({ at, to, i }) => {
    const l = new THREE.SpotLight(0xfff4e6, 0, 0, 0.75, 1, 2);
    l.position.fromArray(at);
    l.target.position.fromArray(to);
    l.userData.full = i;
    scene.add(l, l.target);
    return l;
  });

  const uniforms = createUniforms();
  const rig = new THREE.Group();          // plotter + table + film web + knife line, gone once the camera leaves
  scene.add(rig);
  let T = null, car = null, pf = null, carriage = null, roll = null, data = null;
  const rollAxis = new THREE.Vector3();
  const rollBase = new THREE.Quaternion();
  const carriageBase = new THREE.Vector3();
  const pieces = [];
  let hoodFilmMat = null, applied = null, scratch = null, heat = null, stripMat = null;

  const ready = Promise.all([
    loadCar(uniforms),
    gltfLoader.loadAsync(asset('models/plotter.glb')),
    gltfLoader.loadAsync(asset('film/film.glb')),
    fetch(asset('film/film.json')).then((r) => r.json()),
    new THREE.TextureLoader().loadAsync(asset('film/scratches.png')),
    envReady,
  ]).then(async ([c, plotter, glb, json, scrTex]) => {
    data = json;
    T = createTracks(data);
    car = c;
    scene.add(c.root);
    c.root.updateMatrixWorld(true);
    uniforms.uCarInv.value.copy(c.root.matrixWorld).invert();

    // the plotter and its cutting table
    rig.add(plotter.scene);
    plotter.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.material.envMapIntensity = 0.9;
      if (o.material.name.startsWith('Table_CutMat')) o.material = cuttingMat();
    });
    carriage = plotter.scene.getObjectByName('Plotter_Carriage');
    roll = plotter.scene.getObjectByName('Plotter_Roll');
    carriageBase.copy(carriage.position);
    rollBase.copy(roll.quaternion);
    const m = data.path.matrix;           // row-major: the path plane's k axis (across the film) = the roll's axis
    rollAxis.set(m[2], m[6], m[10]).normalize();

    // the film web on the plotter + the knife line
    pf = createPlotterFilm(data.path, { filmMaterial: filmSheet() });
    stripMat = pf.strip.material;
    rig.add(pf.strip, pf.line);

    // the baked pieces
    const keyMats = keyMaterials();
    applied = appliedFilm();
    scrTex.colorSpace = THREE.NoColorSpace;
    scrTex.anisotropy = 8;
    scratch = scratchMaterial(scrTex, data.hoodUV);
    heat = heatMaterial(data.hoodUV);
    hoodFilmMat = filmSheet({ rim: true });
    const looks = Object.fromEntries(LAYER_LOOK.map((l, i) => [l.key, { mat: layerMaterial(l), order: 14 - i }]));
    for (const [key, track] of Object.entries(T.pieces)) {
      const obj = glb.scene.getObjectByName(`F_${key}`);
      if (!obj) { console.warn('film piece missing', key); continue; }
      let mat, order = 6;
      if (key === 'HoodFilm') { mat = hoodFilmMat; order = 8; }
      else if (looks[key]) { mat = looks[key].mat; order = looks[key].order; }
      else if (key === 'Key') mat = keyMats.blade;
      else if (key === 'KeyHead') mat = keyMats.head;
      else if (key === 'Scratch') { mat = scratch; order = 20; }
      else if (key === 'Heat') { mat = heat; order = 21; }
      else mat = applied;                       // Hood + Panel_*: the film on the car
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.material = mat;
        o.renderOrder = order;
        o.frustumCulled = false;
      });
      scene.add(obj);
      obj.visible = false;
      // the burst panels are only shown once the camera has left the plotter (the hood film is its own piece)
      const from = key.startsWith('Panel_') ? 613 : -Infinity;
      pieces.push({ key, obj, track, from, mesh: obj.isMesh ? obj : obj.children.find((o) => o.isMesh) });
    }
    await warmUp();
  });

  // compile every program up front (pieces start hidden) so nothing hitches the first time it appears
  async function warmUp() {
    const hidden = [];
    scene.traverse((o) => {
      if (!o.visible && (o.isMesh || o.isGroup)) { hidden.push(o); o.visible = true; }
    });
    setFrame(300, { keepVisibility: true });
    camera.updateMatrixWorld();
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    hidden.forEach((o) => { o.visible = false; });
  }

  // ---- sizing
  let W = 1, H = 1;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    W = w;
    H = h;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    renderer.getDrawingBufferSize(uniforms.uRes.value);
    mirror.getRenderTarget().setSize(Math.round(W * dpr * 0.5), Math.round(H * dpr * 0.5));
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);

  // ---- pointer parallax: the camera leans a little with the mouse, the studio reflections slide over the paint
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, inside: false, px: 0.5, py: 0.5 };
  if (!isTouch) {
    canvas.parentElement.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      pointer.px = (e.clientX - r.left) / r.width;
      pointer.py = (e.clientY - r.top) / r.height;
      pointer.x = pointer.px * 2 - 1;
      pointer.y = pointer.py * 2 - 1;
      pointer.inside = true;
    });
    canvas.parentElement.addEventListener('pointerleave', () => { pointer.x = pointer.y = 0; pointer.inside = false; });
  }

  // ---- per frame
  const eye = new THREE.Vector3(), target = new THREE.Vector3(), tmp = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  let frame = 1, lens = 30;

  /** the film framing is 16:9 (36 mm sensor, horizontal fit): wide screens keep its height, narrow ones its width,
   * portrait phones crop the sides a little so the subject is not tiny */
  const fitFov = (lensMm) => {
    const A = W / H;
    const tanH = 18 / lensMm, tanV = (tanH * 9) / 16;
    let need = tanV;
    if (A < 16 / 9) {
      const keep = A >= 1 ? 1 : 0.64 + 0.36 * clamp01((A - 0.5) / 0.5);
      need = Math.max(tanV, (tanH * keep) / A);
    }
    return (2 * Math.atan(need) * 180) / Math.PI;
  };

  function setFrame(f, { keepVisibility = false } = {}) {
    if (!T) return;
    frame = f;
    lens = T.camera(f, eye, target);
    const S = T.scalar;

    // plotter: feed, roll, carriage, knife line
    const machineOn = T.vis.machine(f);
    if (!keepVisibility) rig.visible = machineOn;
    const light = machineOn ? S.machineLight(f) : 0;
    pools.forEach((l) => { l.intensity = l.userData.full * light; });
    rigShadow.visible = machineOn;
    if (machineOn || keepVisibility) {
      const F = S.feed(f);
      const dist = eye.distanceTo(tmp.set(-3.0, 1.0, -0.6));
      const pxSize = (2 * dist * Math.tan((fitFov(lens) * Math.PI) / 360)) / H;
      pf.update(F, Math.max(0.0028, pxSize * 1.1));
      const reveal = S.reveal(f);
      pf.setReveal(reveal);
      pf.setHole(T.vis.hole(f));
      pf.line.visible = keepVisibility || (T.vis.cutline(f) && reveal > 0.001);
      roll.quaternion.setFromAxisAngle(rollAxis, -F / ROLL_R).multiply(rollBase);
      carriage.position.copy(carriageBase).add(T.carriage(f, tmp));
    }

    // the film sheet fades as it is laid onto the hood
    const alpha = S.filmAlpha(f) / 0.93;
    hoodFilmMat.opacity = FILM_OPACITY * alpha;
    stripMat.opacity = FILM_OPACITY;
    // the cut piece glows gold at the edges while it lifts off the table and flies, then settles clear
    hoodFilmMat.userData.uniforms.uRim.value = smooth(clamp01((f - 314) / 20)) * (1 - smooth(clamp01((f - 398) / 18)));

    for (const p of pieces) {
      const on = keepVisibility || (p.track.vis(f) && f >= p.from);
      if (!keepVisibility) p.obj.visible = on;
      if (!on) continue;
      p.track.apply(f, p.obj);
      if (p.mesh && p.mesh.morphTargetInfluences) p.track.weights(f, p.mesh.morphTargetInfluences);
    }
    applied.userData.uniforms.uGlow.value = S.glow(f);
    const su = scratch.userData.uniforms;
    su.uReveal.value.set(S.scr0(f), S.scr1(f), S.scr2(f));
    su.uHeal.value = S.heal(f);
    heat.userData.uniforms.uHeat.value = S.heat(f);

    // the film settles on the whole car after the burst: one sealing sweep along the paint
    uniforms.uWrap.value = smooth(clamp01((f - 792) / 44));
    // end card: the car lights drop so the brand reads; the last frames fade to black
    scene.environmentIntensity = Math.max(0.25, S.carLight(f));
    const ev = f < 20 ? -0.7 : S.exposure(f);
    renderer.toneMappingExposure = Math.pow(2, Math.min(0, ev + 0.7));
  }

  const render = (time) => {
    if (!T) return;
    uniforms.uTime.value = time;
    heat.userData.uniforms.uTime.value = time;
    pointer.sx += (pointer.x - pointer.sx) * 0.06;
    pointer.sy += (pointer.y - pointer.sy) * 0.06;

    // camera: the film's eye and target, nudged by the pointer
    camera.fov = fitFov(lens);
    camera.position.copy(eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    const d = eye.distanceTo(target);
    right.setFromMatrixColumn(camera.matrix, 0);
    up.setFromMatrixColumn(camera.matrix, 1);
    camera.position.addScaledVector(right, pointer.sx * d * 0.035).addScaledVector(up, -pointer.sy * d * 0.02);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    scene.environmentRotation.y = pointer.sx * 0.5;
    scene.fog.near = d + 4;
    scene.fog.far = d + 22;

    // film torch on the paint during the closing orbit: hover the car to see the film's honeycomb
    const torch = pointer.inside && frame > 1121 && frame < 1246 ? 1 : 0;
    uniforms.uHover.value += (torch - uniforms.uHover.value) * 0.08;
    uniforms.uMouse.value.set(pointer.px, 1 - pointer.py);

    renderer.render(scene, camera);
  };

  /** world point → CSS pixels on the canvas */
  const project = (v) => {
    tmp.fromArray(v).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H, front: tmp.z < 1 };
  };

  return {
    ready,
    setFrame,
    render,
    resize,
    project,
    get data() { return data; },
    get size() { return { W, H }; },
    debug: { scene, camera, renderer, pieces, get tracks() { return T; } },
  };
}
