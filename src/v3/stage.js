import * as THREE from 'three';
import gsap from 'gsap';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { makeStudioEnv, radialTexture, hdrLoader, asset, gltfLoader, SOFT_REFLECTOR, isTouch } from '../studio.js';
import { loadCar, createUniforms } from '../car.js';
import { cuttingMat } from '../cutter.js';
import { createKit } from './kit.js';
import { createLaptop } from './laptop.js';
import { createCable } from './cable.js';
import { createSample } from './sample.js';

const TAU = Math.PI * 2;

// the studio: a dark room with a pool of light under the car
const STUDIO = {
  bg: 0x060708, centre: '#1c1f23', edge: '#060708', mirror: 0x5a5a5a, pool: 0.16, fade: 'rgb(140,140,140)',
  env: { strips: 0.95, hdrGain: 0.7 },
};
const BG = STUDIO.bg;
const DESK = new THREE.Vector3(-3.95, 0, -2.78);   // standing desk in front of the plotter's control-panel end
const CAR_T = new THREE.Vector3(0, 0.72, 0);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);
// frame shapes. The page layout reads the same media queries as v3.css (keep them in step):
// - COPY_TOP: the copy goes on top of the picture, as on a phone (frames up to 23:20, and windows under 820 px wide
//   that are not a phone on its side); otherwise it sits in a left column
// - the five-layer scene keeps the car big in the middle and the square of film beside it: on its right with the tags
//   at the frame's edge, or under it (the car raised) when the copy goes on top
// The camera's own choices go by the canvas: taller than TALL is a phone held upright (its own lens for the close shot
// by the car); wider than WIDE and under SHORT px high is a phone on its side, whose end card moves to the left column.
const COPY_TOP = '(max-aspect-ratio: 23/20), (max-width: 819px) and (min-height: 500px)';
const WIDE = 1.15, TALL = 0.9, SHORT = 500;
// the car's body for framing (car space ≈ world: nose at -z), a touch inside its true box
const CAR_BOX = [-1.05, 0, -2.5, 1.05, 1.6, 2.5];

// timeline seconds where each part starts (the page maps scroll onto this)
export const T = {
  reveal: 0.55, design: 2.2, send: 4.8, cut: 6.6, lift: 10.2, orbit: 13.1, apply: 16.6, swirl: 18.5, layers: 23.0, outro: 27.2,
  end: 29.3,
};

/**
 * v3: one continuous shot from a laptop to the car. The car turns on screen; pulling back shows it is the app on a
 * laptop beside the shop's plotter; the kit is extracted and sent; the plotter cuts every piece in one run; the
 * pieces lift off, grow and fly round the car; one full turn around it; they settle under a sweep of light; then a
 * close look at swirl marks in the sun healing away. The paint is glossy factory paint until the film goes on, then
 * deeper and glossier still.
 */
export function createStage({ canvas, sampleUi }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // resolution (set in resize): the screen's own up to 1.75x, within a budget of pixels (a 4K monitor at 150% would
  // otherwise draw 8 million a frame), and lowered a step at a time on a device that can't keep up (govern)
  const DPR_MAX = 1.75, PIXELS_MAX = 4.2e6;
  let dpr = 1, dprCap = DPR_MAX, dprFloor = 1;
  // Khronos PBR Neutral keeps the Giallo a saturated gold (ACES pushed it to a pale, flat yellow)
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  // layers: 0 everything the page camera sees (and the floor mirrors), 1 the laptop app's own viewport, 2 seen by the
  // page camera but left out of the floor's mirror pass (the plotter: 108k triangles whose reflection hardly shows)
  const MAIN_ONLY = 2;
  // a soft radial backdrop: brighter behind the subject, falling off to the room's edge
  scene.background = (() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 320;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(256, 150, 10, 256, 160, 330);
    grd.addColorStop(0, STUDIO.centre);
    grd.addColorStop(1, STUDIO.edge);
    g.fillStyle = grd;
    g.fillRect(0, 0, c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  scene.environment = makeStudioEnv(renderer, STUDIO.env);
  scene.fog = new THREE.Fog(BG, 14, 34);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 120);
  camera.layers.enable(MAIN_ONLY);

  const envReady = hdrLoader.loadAsync(asset('textures/studio.hdr')).then((hdr) => {
    const old = scene.environment;
    scene.environment = makeStudioEnv(renderer, { hdr, ...STUDIO.env });
    old.dispose();
    hdr.dispose();
  }).catch((err) => console.warn('studio HDRI unavailable, keeping the procedural studio', err));

  // ---- floor (also seen by the app's viewport camera: layer 1)
  const FLOOR_X = -1.4;
  // (no MSAA: the floor blurs what it reflects anyway)
  const mirror = new Reflector(new THREE.PlaneGeometry(44, 44), { color: STUDIO.mirror, textureWidth: 1024, textureHeight: 1024, multisample: 0, shader: SOFT_REFLECTOR });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.x = FLOOR_X;
  mirror.getReflectionCamera(camera).layers.set(0);       // the page camera's mirror pass skips MAIN_ONLY
  const overFloor = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  const fade = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshBasicMaterial({ color: BG, transparent: true, depthWrite: false, alphaMap: radialTexture(STUDIO.fade, 'rgb(255,255,255)', 512), ...overFloor }),
  );
  fade.rotation.x = -Math.PI / 2;
  fade.position.set(FLOOR_X, 0.01, 0);
  const outer = new THREE.Mesh(new THREE.RingGeometry(14.9, 44, 64), new THREE.MeshBasicMaterial({ color: BG, ...overFloor }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(FLOOR_X, 0.01, 0);
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
  const soft = radialTexture('rgb(40,40,40)', 'rgb(255,255,255)', 256);
  const rigShadow = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.6), shadowMat(soft, 0.75));
  rigShadow.rotation.x = -Math.PI / 2;
  rigShadow.position.set(-3.05, 0.006, -0.6);
  const deskShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), shadowMat(soft, 0.7));
  deskShadow.rotation.x = -Math.PI / 2;
  deskShadow.position.set(DESK.x, 0.006, DESK.z);
  // dark studio: a pool of light on the floor round the car, so it stands in light, not in a void
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 12),
    new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(255,244,226,1)', 'rgba(255,244,226,0)', 256), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: STUDIO.pool, ...overFloor,
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.012;
  pool.visible = STUDIO.pool > 0;
  scene.add(mirror, fade, outer, carShadow, rigShadow, deskShadow, pool);
  [mirror, fade, outer, carShadow, pool].forEach((o) => o.layers.enable(1));

  // ---- lights: pools over the plotter, a sun for the swirl test. Always present (zero when off) and on both
  // layers, so the light setup never changes between the two renders and nothing recompiles.
  const pools = [
    { at: [-4.1, 3.1, -0.6], to: [-4.2, 1.0, -0.6], i: 3.2 },
    { at: [-2.8, 3.0, -0.6], to: [-2.8, 1.0, -0.6], i: 3.6 },
    { at: [-3.95, 2.6, -2.78], to: [-3.95, 0.9, -2.78], i: 2.2 },
  ].map(({ at, to, i }) => {
    const l = new THREE.SpotLight(0xfff4e6, 0, 0, 0.75, 1, 2);
    l.position.fromArray(at);
    l.target.position.fromArray(to);
    l.userData.full = i;
    l.layers.enable(1);
    scene.add(l, l.target);
    return l;
  });
  const sun = new THREE.PointLight(0xfff1dc, 0, 0, 2);
  sun.layers.enable(1);
  scene.add(sun);
  // the sun's reflection: a small hot core with a soft bloom round it (the user found a bigger, brighter one glaring)
  const glareTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,250,240,1)');
    grd.addColorStop(0.07, 'rgba(255,246,228,0.9)');
    grd.addColorStop(0.2, 'rgba(255,236,200,0.2)');
    grd.addColorStop(1, 'rgba(255,230,190,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glareTex, color: 0xffffff, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, opacity: 0,
  }));
  glare.scale.setScalar(0.09);
  glare.renderOrder = 40;
  scene.add(glare);

  const uniforms = createUniforms();
  uniforms.uForm.value = 1;                           // the paint lit like a studio photo: bright tops, deep gold flanks
  const kit = createKit();
  const laptop = createLaptop();
  const sample = createSample(sampleUi);
  laptop.group.position.copy(DESK);
  laptop.group.rotation.y = Math.PI;               // the screen faces -z, away from the car
  scene.add(laptop.group, laptop.grid, laptop.highlights, laptop.mark);
  const plotterRig = { carriage: null, carriageBase: new THREE.Vector3(), roll: null, rollBase: new THREE.Quaternion(), rollAxis: new THREE.Vector3(0, 0, 1) };
  let cable = null, car = null, tl = null, builtFor = '';

  // story state the timeline writes into
  // shift: how far (fraction of the width) the picture slides right to leave the left column to the copy
  // (negative: slides left, for the five-layer sample on the right)
  const cam = { tx: 0, ty: 0, tz: 0, az: 0, el: 0, dist: 1, lens: 35, hook: 1, shift: 0 };
  const look = { gloss: 0, sweep: 0, swirl: 0, heat: 0, sun: 0, machine: 1 };
  const overrides = {};
  let plotterGroup = null;                            // dev: pin a look value (e.g. gloss) for comparisons

  const ready = Promise.all([
    loadCar(uniforms),
    gltfLoader.loadAsync(asset('models/plotter.glb')),
    kit.ready,
    envReady,
    laptop.markReady,
  ]).then(async ([c, plotter]) => {
    car = c;
    c.paint.material.color.set(0xf2bf00);           // under Neutral tone mapping: the golden Giallo of the shop's reference shot
    scene.add(c.root);
    c.root.traverse((o) => o.layers.enable(1));
    c.root.updateMatrixWorld(true);
    uniforms.uCarInv.value.copy(c.root.matrixWorld).invert();

    scene.add(plotter.scene);
    plotterGroup = plotter.scene;
    plotter.scene.traverse((o) => {
      o.layers.set(MAIN_ONLY);
      if (!o.isMesh || !o.material) return;
      o.material.envMapIntensity = 0.9;
      if (o.material.name.startsWith('Table_CutMat')) o.material = cuttingMat();
    });
    plotterRig.carriage = plotter.scene.getObjectByName('Plotter_Carriage');
    plotterRig.roll = plotter.scene.getObjectByName('Plotter_Roll');
    plotterRig.carriageBase.copy(plotterRig.carriage.position);
    plotterRig.rollBase.copy(plotterRig.roll.quaternion);

    scene.add(kit.rig, kit.pieces);
    laptop.addHighlights(kit.panels);
    laptop.setKit(kit.layout);

    // the plotter's data cable: unplugged from its dangling run, routed across the floor and up into the laptop
    let socket = new THREE.Vector3(-4.34, 1.0, -1.46);
    plotter.scene.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.name.startsWith('CNC_CableBlue')) return;
      const pos = o.geometry.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y > socket.y || i === 0) socket = v.clone();
      }
      o.visible = false;
    });
    laptop.group.updateMatrixWorld(true);
    const port = new THREE.Vector3(0.158, 0.943, -0.01).applyMatrix4(laptop.group.matrixWorld);
    const portOut = new THREE.Vector3(0.24, 0.94, -0.01).applyMatrix4(laptop.group.matrixWorld);
    const leg = new THREE.Vector3(0.38, 0, -0.25).applyMatrix4(laptop.group.matrixWorld);   // desk leg nearest the plotter
    const s = socket, v3 = (x, y, z) => new THREE.Vector3(x, y, z);
    cable = createCable([
      s.clone(),
      v3(s.x - 0.05, s.y - 0.07, s.z - 0.01),
      v3(s.x - 0.11, 0.55, s.z - 0.05),
      v3(s.x - 0.13, 0.016, s.z - 0.24),
      v3(leg.x - 0.03, 0.012, leg.z + 0.32),
      v3(leg.x - 0.035, 0.03, leg.z + 0.04),
      v3(leg.x - 0.035, 0.5, leg.z + 0.02),
      v3(leg.x - 0.035, 0.89, leg.z + 0.02),
      v3(leg.x - 0.03, 0.952, leg.z - 0.02),
      v3(portOut.x - 0.06, 0.941, portOut.z - 0.06),
      portOut,
      port,
    ]);
    scene.add(cable.group);

    placeSun();
    await warmUp();
    buildTimeline();
    await preroll();
  });

  // the sun's reflection sits on the bonnet, where the swirl marks ring it
  const swirlAt = new THREE.Vector3(), swirlN = new THREE.Vector3(0, 1, 0), swirlEye = new THREE.Vector3();
  function placeSun() {
    const ray = new THREE.Raycaster(new THREE.Vector3(0.22, 3, -1.62), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(car.paint, false)[0];
    if (hit) {
      swirlAt.copy(hit.point);
      swirlN.copy(hit.face.normal).transformDirection(car.paint.matrixWorld).normalize();
    } else swirlAt.set(0.22, 1.08, -1.62);
    swirlEye.copy(swirlAt).add(new THREE.Vector3(0.62, 0.36, -1.18));
    const v = swirlAt.clone().sub(swirlEye).normalize();
    const r = v.clone().sub(swirlN.clone().multiplyScalar(2 * v.dot(swirlN)));   // mirror direction
    sun.position.copy(swirlAt).addScaledVector(r, 4.5);
    glare.position.copy(swirlAt).addScaledVector(swirlN, 0.02);
    uniforms.uSwirlC.value.copy(swirlAt);
    uniforms.uSwirlN.value.copy(swirlN);
    uniforms.uSwirlR.value = 0.19;
  }

  // Nothing may compile or upload mid-scroll (each new shader froze the page for 0.1-1.3 s the first time its scene
  // came up). Before the loader lifts: every material compiled for each target the page draws into (the screen, tone
  // mapped; the laptop's screen texture and the floor mirror, linear; the five-layer square's own scene), with
  // everything visible and every layer on; then a real frame at each stage of the film puts meshes and textures on
  // the GPU too.
  async function warmUp() {
    const hidden = [];
    scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    const mask = camera.layers.mask;
    camera.layers.enableAll();
    camera.updateMatrixWorld();
    const compile = (s, c) => (renderer.compileAsync ? renderer.compileAsync(s, c) : Promise.resolve(renderer.compile(s, c)));
    await compile(scene, camera);
    renderer.setRenderTarget(laptop.target);
    await compile(scene, camera);
    renderer.setRenderTarget(null);
    sample.scene.environment = scene.environment;
    await compile(sample.scene, sample.camera);
    camera.layers.mask = mask;
    hidden.forEach((o) => { o.visible = false; });
  }
  async function preroll() {
    const tick = () => new Promise((r) => setTimeout(r, 0));     // lets the loader keep moving between frames
    for (const t of [0.05, 1.3, 2.95, 4.9, 5.9, 7.0, 7.3, 10.3, 11.6, 13.5, 17.3, 20.5, 23.9, 24.6, 28.8]) {
      setTime(t);
      render(t);
      await tick();
    }
    setTime(0);
    render(0);
    gov.sum = gov.n = 0;              // (its slow first frames don't count against the device)
  }

  // ---- sizing
  let W = 1, H = 1;
  const frameKind = () => (W / H < TALL ? 'tall' : W / H > WIDE && H < SHORT ? 'short' : 'wide');
  const mqCopyTop = matchMedia(COPY_TOP);
  const copyTop = () => mqCopyTop.matches;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    W = w;
    H = h;
    // (a big window may go a little under 1x when it is slow, but keeps about 2 million pixels)
    dprFloor = Math.min(1, Math.max(0.75, Math.sqrt(2.1e6 / (W * H))));
    dpr = Math.min(window.devicePixelRatio, Math.max(dprFloor, Math.min(dprCap, Math.max(1, Math.sqrt(PIXELS_MAX / (W * H))))));
    if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    renderer.getDrawingBufferSize(uniforms.uRes.value);
    mirror.getRenderTarget().setSize(Math.round(W * dpr * 0.5), Math.round(H * dpr * 0.5));
    laptop.setViewSize(uniforms.uRes.value.x, uniforms.uRes.value.y);
    // turned between upright and landscape: the shots that depend on the frame's shape are rebuilt, then played
    // forward to where the page was, so every tween starts from the state the one before it left
    if (tl && frameKind() !== builtFor) {
      const at = tl.time();
      tl.kill();
      buildTimeline();
      for (let x = 0.1; x < at; x += 0.1) tl.time(x);
      tl.time(at);
    }
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);

  // ---- pointer parallax
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

  // ---- camera: the timeline drives a target + orbit (az, el, dist) + lens; the opening shot is the screen itself
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
  const sc = new THREE.Vector3(), sn = new THREE.Vector3();
  /** distance at which the laptop screen fills the whole frame (on a phone, a tall slice of it: the app opens its lens) */
  const hookDist = (fovDeg) => {
    const { w, h } = laptop.screenFrame(sc, sn);
    const tanV = Math.tan((fovDeg * Math.PI) / 360), tanH = tanV * (W / H);
    return Math.min(w / 2 / tanH, h / 2 / tanV) * 0.985;
  };

  const eye = new THREE.Vector3(), target = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  let time = 0;

  // ---- the five-layer scene: the car big in the middle, the square of film beside it. Where the frame is too narrow
  // for both the car slides left (or, with the copy on top, up) just enough while the square is up.
  const probe = new THREE.PerspectiveCamera();
  const gutterProbe = document.createElement('div');
  gutterProbe.style.cssText = 'position:absolute;left:0;top:0;width:var(--gutter);height:0;visibility:hidden;pointer-events:none';
  canvas.parentElement.appendChild(gutterProbe);
  let layersPose = null;
  const lay = { key: '', shift: 0, lift: 0, dolly: 1, box: null };
  /** the car's extent on the page (px) as the layers shot frames it, before any slide */
  const carExtent = (pose) => {
    probe.fov = fitFov(pose.lens);
    probe.aspect = W / H;
    probe.updateProjectionMatrix();
    const tgt = new THREE.Vector3(pose.tx, pose.ty, pose.tz);
    probe.position.set(Math.sin(pose.az) * Math.cos(pose.el), Math.sin(pose.el), Math.cos(pose.az) * Math.cos(pose.el)).multiplyScalar(pose.dist).add(tgt);
    probe.lookAt(tgt);
    probe.updateMatrixWorld();
    const v = new THREE.Vector3(), e = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
    for (let i = 0; i < 8; i++) {
      v.set(CAR_BOX[i & 1 ? 3 : 0], CAR_BOX[i & 2 ? 4 : 1], CAR_BOX[i & 4 ? 5 : 2]).project(probe);
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      e.l = Math.min(e.l, x);
      e.r = Math.max(e.r, x);
      e.t = Math.min(e.t, y);
      e.b = Math.max(e.b, y);
    }
    return e;
  };
  const layersLayout = () => {
    const tall = copyTop();
    const key = `${W}x${H}x${tall}`;
    if (!layersPose || lay.key === key) return lay;
    lay.key = key;
    const tagW = sample.setTagSide(tall ? 'left' : 'right');
    const gutter = gutterProbe.offsetWidth || 24;
    const car = carExtent(layersPose);
    lay.dolly = 1;
    if (!tall) {
      // tags at the right edge, the square between them and the car. The car slides left only as far as it must, up
      // to a tenth of the frame; past that it steps back a little instead, so it stays near the middle.
      const right = W - gutter - tagW - 8;
      const room = Math.max(190, W * 0.17);
      const carRight = right - room - 28;
      const half = (car.r - car.l) / 2, mid = (car.l + car.r) / 2;
      let slide = Math.max(0, car.r - carRight);
      if (slide > W * 0.1) {
        slide = W * 0.1;
        lay.dolly = half / Math.max(40, carRight - (mid - slide));
      }
      lay.shift = -slide / W;
      lay.lift = 0;
      const carEdge = lay.dolly > 1 ? carRight : car.r - slide;
      lay.box = { left: carEdge + 28, right, top: Math.max(84, H * 0.2), bottom: Math.min(H - 96, H * 0.8) };
    } else {
      // the car rises into the upper part, the square (tags to its left) takes the space under it
      const raise = Math.max(0, Math.min(car.b - H * 0.42, car.t - 76));
      lay.shift = 0;
      lay.lift = raise / H;
      lay.box = { left: gutter + tagW + 8, right: W - gutter, top: car.b - raise + 22, bottom: H - 100 };
    }
    return lay;
  };

  // the real car only joins the main view when the film flies to it; until then it lives on the laptop's screen
  let carInView = null;
  const showCar = (on) => {
    if (on === carInView) return;
    carInView = on;
    car.root.traverse((o) => { if (on) o.layers.enable(0); else o.layers.disable(0); });
    if (on) carShadow.layers.enable(0);
    else carShadow.layers.disable(0);
  };

  function apply() {
    if (!car) return;
    showCar(tl.time() >= T.lift - 0.2);
    // camera (while the square of film is up, the car may step back a little to make room for it: layersLayout)
    const L = layersLayout(), lw = smooth(clamp01(sample.state.appear));
    camera.fov = fitFov(cam.lens);
    let dist = cam.dist * (1 + (L.dolly - 1) * lw);
    if (cam.hook > 0.0001) dist = THREE.MathUtils.lerp(cam.dist, hookDist(camera.fov), smooth(clamp01(cam.hook)));
    target.set(cam.tx, cam.ty, cam.tz);
    eye.set(Math.sin(cam.az) * Math.cos(cam.el), Math.sin(cam.el), Math.cos(cam.az) * Math.cos(cam.el)).multiplyScalar(dist).add(target);
    camera.position.copy(eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    const k = 1 - clamp01(cam.hook);
    right.setFromMatrixColumn(camera.matrix, 0);
    up.setFromMatrixColumn(camera.matrix, 1);
    camera.position.addScaledVector(right, pointer.sx * dist * 0.03 * k).addScaledVector(up, -pointer.sy * dist * 0.018 * k);
    camera.lookAt(target);
    // copy in a left column: the subject sits right of centre while it is up (further on frames squarer than 16:9,
    // which show more of the scene round it); copy on top: the subject stays centred. While the square of film is up
    // the car makes room for it where the frame needs that.
    const shift =(copyTop() ? 0 : cam.shift * (1 + 1.2 * (1 - Math.min(1, W / H / (16 / 9))))) + L.shift * lw;
    const lift = L.lift * lw * H;
    if (Math.abs(shift) > 0.0005 || lift > 0.5) camera.setViewOffset(W, H, -shift * W, lift, W, H);
    else if (camera.view) camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    scene.fog.near = dist + 4;
    scene.fog.far = dist + 22;

    // car finish + swirl test
    uniforms.uGloss.value = overrides.gloss ?? look.gloss;
    uniforms.uSweep.value = look.sweep;
    uniforms.uStudio.value = 1 - look.sun;              // in the sun, its reflection is the only highlight
    uniforms.uSwirl.value = look.swirl;
    uniforms.uSwirlHeat.value = look.heat;
    sun.intensity = 34 * look.sun;
    glare.material.opacity = 0.72 * look.sun;
    glare.visible = look.sun > 0.01;
    // the plotter (and its table, film web and light) leaves once the camera has turned to the car;
    // the desk and laptop fade with the laptop
    const machine = look.machine > 0.5;
    plotterGroup.visible = machine;
    rigShadow.visible = machine;
    kit.state.show = machine ? 1 : 0;
    pools[0].intensity = machine ? pools[0].userData.full : 0;
    pools[1].intensity = machine ? pools[1].userData.full : 0;
    pools[2].intensity = pools[2].userData.full * laptop.state.alpha;
    deskShadow.material.uniforms.uStrength.value = 0.7 * laptop.state.alpha;
    deskShadow.visible = laptop.state.alpha > 0.002;
  }

  // A device that can't keep up (frames slower than ~29 fps over 60 frames) drops resolution a step at a time (two
  // when far behind), never back up within a visit. (34 ms, not 30: a phone in low-power mode caps every page at 30 fps.)
  const gov = { last: 0, sum: 0, n: 0 };
  const govern = () => {
    const now = performance.now(), dt = now - gov.last;
    gov.last = now;
    if (dt <= 0 || dt > 150) {                          // paused, hidden or a one-off hitch: start the count again
      gov.sum = gov.n = 0;
      return;
    }
    gov.sum += dt;
    if (++gov.n < 60) return;
    const avg = gov.sum / gov.n;
    gov.sum = gov.n = 0;
    if (avg > 34 && dpr > dprFloor + 0.01) {
      dprCap = Math.max(dprFloor, dpr - (avg > 50 ? 0.5 : 0.25));
      W = H = 0;
      resize();
    }
  };

  const render = (t) => {
    if (!car || !tl) return;
    govern();
    time = t;
    pointer.sx += (pointer.x - pointer.sx) * 0.06;
    pointer.sy += (pointer.y - pointer.sy) * 0.06;
    uniforms.uTime.value = t;
    apply();
    scene.environmentRotation.y = pointer.sx * 0.45 * (1 - clamp01(cam.hook));
    const dist = camera.position.distanceTo(target);
    const px = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / H;
    kit.update(t, plotterRig, Math.max(0.0022, px * 1.1));
    laptop.update();
    cable.state.alpha = laptop.state.alpha;
    cable.update(t);
    // the laptop's screen shows its own render of the car, only while the screen is in shot
    laptop.screenFrame(sc, sn);
    const ndc = sc.clone().project(camera);
    if (laptop.state.on > 0.01 && ndc.z < 1 && Math.abs(ndc.x) < 1.3 && Math.abs(ndc.y) < 1.3) {
      const buf = uniforms.uRes.value;
      laptop.renderView(renderer, scene, t, camera, buf.x, buf.y, smooth(clamp01(cam.hook)), W / H, !copyTop());
    }
    renderer.render(scene, camera);
    // the square of film for the five layers, drawn over the frame
    sample.update(t, W, H, layersLayout().box);
    sample.render(renderer, scene.environment);
  };

  // ---- the story
  const shotFrom = (e, t, lens, ref) => {
    const d = e.clone().sub(t);
    const dist = d.length();
    const el = Math.asin(d.y / dist);
    let az = Math.atan2(d.x, d.z);
    if (ref !== undefined) az += Math.round((ref - az) / TAU) * TAU;
    return { tx: t.x, ty: t.y, tz: t.z, az, el, dist, lens };
  };

  function buildTimeline() {
    laptop.screenFrame(sc, sn);
    const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
    // opening: square on to the screen, then a dolly back (the hook distance takes over while cam.hook > 0)
    const screenAz = Math.atan2(sn.x, sn.z), screenEl = Math.asin(sn.y);
    Object.assign(cam, { tx: sc.x, ty: sc.y, tz: sc.z, az: screenAz, el: screenEl, dist: 0.66, lens: 35, hook: 1, shift: 0 });
    let az = cam.az;
    const shot = (e, t, lens) => { const s = shotFrom(e, t, lens, az); az = s.az; return s; };
    // from the front-left of the desk: laptop, cable run and the plotter's socket end in one frame
    const sendShot = shot(v3(-5.55, 1.55, -4.05), v3(-4.15, 0.62, -2.05), 30);
    const cut1 = shot(v3(-2.45, 2.95, 1.15), v3(-3.45, 1.0, -0.55), 28);
    const cut2 = shot(v3(-1.95, 3.35, 0.55), v3(-2.95, 1.0, -0.6), 28);
    const pop = shot(v3(-0.55, 3.0, 2.9), v3(-2.55, 1.2, -0.55), 30);
    // the camera rises off the end of the table and looks at the car: table and plotter are behind it, out of shot,
    // and go; the pieces fly past the camera into the frame. Stepping further back would bring the table into a
    // phone's tall frame, so there the lens opens instead.
    builtFor = frameKind();
    const flyShot = shot(v3(-1.4, 2.0, 1.5), v3(0.6, 0.9, -0.4), builtFor === 'tall' ? 20 : 30);
    const orbit0 = shot(CAR_T.clone().add(v3(-1.4, 0.62, 1.5).setLength(9.6)), CAR_T, 32);
    const turned = orbit0.az + TAU;
    az = turned;
    const applyShot = shot(CAR_T.clone().add(v3(-6.3, 1.15, -7.9)), CAR_T, 34);
    const swirlShot = shot(swirlEye, swirlAt, 40);
    // the car three-quarter on in the middle, as in the gloss shot and about as big (closer on a phone held upright);
    // the square of film takes the space beside it (layersLayout). (Seen head-on, its flank caught the studio photo's
    // brightest lamp edge-on and went white.)
    const layersShot = shot(CAR_T.clone().add(v3(-6.3, 1.15, -7.9).setLength(builtFor === 'tall' ? 7.5 : 9)), CAR_T, 34);
    layersPose = layersShot;
    lay.key = '';
    const outro = shot(v3(-6.4, 1.15, -8.3), v3(0, 0.78, 0.2), 34);

    const K = kit.state, L = laptop.state, C = cable.state, SP = sample.state;
    Object.assign(SP, { appear: 0, explode: 0, cycle: 0 });
    Object.assign(K, { show: 1, cut: 0, push: 0, lift: 0, fly: 0, merge: 0, alpha: 1, edge: 0 });
    Object.assign(L, { alpha: 1, on: 1, ui: 0, sel: 0, nest: 0, send: 0, cursor: 0, cursorOn: 0, click: 0 });
    Object.assign(C, { flow: 0, pulse: 0 });
    Object.assign(look, { gloss: 0, sweep: 0, swirl: 0, heat: 0, sun: 0, machine: 1 });

    tl = gsap.timeline({ paused: true, defaults: { ease: 'power1.inOut' } });
    tl
      // 01 the screen pulls back into a laptop; the app's chrome slides in
      .to(cam, { hook: 0, duration: 1.7, ease: 'power2.inOut' }, T.reveal)
      .to(cam, { el: 0.1, duration: 1.7, ease: 'power2.inOut' }, T.reveal)
      .to(cam, { shift: 0.11, duration: 1.2 }, T.reveal + 0.7)
      .to(L, { ui: 1, duration: 1.0 }, T.reveal + 0.5)
      .to(cam, { dist: 0.58, az: screenAz + 0.14, duration: 2.6 }, T.design)
      // the panels are picked out, flattened and nested
      .to(L, { cursorOn: 1, duration: 0.2 }, T.design)
      .to(L, { cursor: 1, duration: 0.55 }, T.design)
      .fromTo(L, { click: 0 }, { click: 1, duration: 0.3, ease: 'none' }, T.design + 0.6)
      .to(L, { click: 0, duration: 0.01 }, T.design + 0.92)
      .to(L, { sel: 1, duration: 0.9 }, T.design + 0.65)
      .to(L, { nest: 1, duration: 1.0 }, T.design + 1.65)
      // 02 sent to the plotter
      .to(L, { cursor: 2, duration: 0.45 }, T.send - 0.2)
      .fromTo(L, { click: 0 }, { click: 1, duration: 0.3, ease: 'none' }, T.send + 0.3)
      .to(L, { click: 0, duration: 0.01 }, T.send + 0.62)
      .to(L, { send: 1, duration: 1.1, ease: 'none' }, T.send + 0.4)
      .to(cam, { ...sendShot, duration: 1.1 }, T.send + 0.45)
      // the kit runs down the cable into the plotter
      .to(C, { pulse: 1, duration: 0.2 }, T.send + 0.5)
      .to(C, { flow: 1, duration: 1.0, ease: 'none' }, T.send + 0.5)
      .to(C, { pulse: 0, duration: 0.4 }, T.send + 1.6)
      .to(L, { cursorOn: 0, duration: 0.3 }, T.send + 1.2)
      // its job done, the laptop (and its desk) fades away as the camera turns to the plotter
      .to(L, { alpha: 0, duration: 0.55 }, T.send + 1.7)
      // 03 the plotter cuts the whole kit in one run
      .to(cam, { ...cut1, duration: 0.9 }, T.cut)
      .to(K, { cut: 1, duration: 2.7, ease: 'none' }, T.cut + 0.5)
      .to(cam, { ...cut2, duration: 1.6 }, T.cut + 1.6)
      .to(K, { push: 1, duration: 0.45 }, T.cut + 3.2)
      // 04 the pieces lift off, grow and fly to the car
      .to(K, { lift: 1, duration: 0.45 }, T.lift)
      .to(K, { edge: 1, duration: 0.4 }, T.lift)
      .to(cam, { ...pop, duration: 0.8 }, T.lift + 0.05)
      .to(K, { fly: 1, duration: 2.1 }, T.lift + 0.55)
      .to(cam, { ...flyShot, duration: 1.0 }, T.lift + 0.75)
      .set(look, { machine: 0 }, T.lift + 1.8)
      .to(cam, { ...orbit0, duration: T.orbit - T.lift - 1.85 }, T.lift + 1.85)
      // 05 one full turn round the car with the film in the air
      .to(cam, { az: turned, duration: 3.5, ease: 'sine.inOut' }, T.orbit)
      .to(cam, { el: orbit0.el + 0.12, duration: 1.75, ease: 'sine.inOut', yoyo: true, repeat: 1 }, T.orbit)
      // 06 the film settles: under a sweep of light the paint goes deeper and glossier
      .to(cam, { ...applyShot, duration: 1.2 }, T.apply)
      .to(K, { merge: 1, duration: 1.4 }, T.apply + 0.05)
      .fromTo(look, { sweep: 0 }, { sweep: 1, duration: 1.3, ease: 'none' }, T.apply + 0.45)
      .to(look, { gloss: 1, duration: 1.2 }, T.apply + 0.55)
      .to(K, { edge: 0, alpha: 0, duration: 0.6 }, T.apply + 1.3)
      // 07 swirl marks in the sun, then the top coat heals them
      .to(cam, { ...swirlShot, duration: 1.15 }, T.swirl)
      .to(look, { sun: 1, duration: 0.6 }, T.swirl + 0.6)
      .to(look, { swirl: 1, duration: 0.8 }, T.swirl + 1.2)
      .to(cam, { dist: swirlShot.dist * 0.82, duration: 3.2, ease: 'none' }, T.swirl + 1.2)
      .to(look, { heat: 1, duration: 0.45 }, T.swirl + 2.4)
      .to(look, { swirl: 0, duration: 1.3 }, T.swirl + 2.75)
      .to(look, { heat: 0, duration: 0.5 }, T.swirl + 4.0)
      // 08 five layers: the car in the middle, a square of film separates beside it
      .to(look, { sun: 0, duration: 0.6 }, T.layers)
      .to(cam, { ...layersShot, shift: 0, duration: 1.2 }, T.layers)
      .to(SP, { appear: 1, duration: 0.7 }, T.layers + 0.6)
      .to(SP, { explode: 1, duration: 1.0 }, T.layers + 1.1)
      .fromTo(SP, { cycle: 0 }, { cycle: 5, duration: 2.2, ease: 'none' }, T.layers + 1.8)
      .to(SP, { explode: 0, duration: 0.5 }, T.layers + 3.7)
      .to(SP, { appear: 0, duration: 0.5 }, T.layers + 3.75)
      // 09 the car, gleaming (a phone on its side keeps the end card in the left column, the car right of it)
      .to(cam, { ...outro, shift: builtFor === 'short' ? 0.2 : 0, duration: 1.3 }, T.outro)
      .to({}, { duration: 0.1 }, T.end - 0.1);
    tl.time(0);
    apply();
  }

  const setTime = (t) => {
    if (!tl) return;
    tl.time(Math.min(T.end, Math.max(0, t)));
  };

  return {
    ready, render, setTime, resize,
    get duration() { return T.end; },
    debug: { scene, camera, renderer, kit, laptop, sample, cam, look, overrides, get tl() { return tl; }, uniforms },
  };
}
