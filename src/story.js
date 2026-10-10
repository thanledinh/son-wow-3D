import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import gsap from 'gsap';
import { makeStudioEnv, radialTexture, whenVisible, isTouch, hdrLoader, asset, SOFT_REFLECTOR } from './studio.js';
import { loadCar, createUniforms, CAR_LEN } from './car.js';
import { createHood } from './hood.js';
import { createStones } from './stones.js';
import { createHeroWord, createCallouts } from './hero.js';
import { createCutter } from './cutter.js';
import { createBurst } from './burst.js';

const PI = Math.PI;
const BG = 0x060708;

// Two scenes from the PPF film (blender/ppf-panels.blend) sit inside the story: the shop's plotter cutting the hood
// piece, which then flies onto the bonnet (CUT, right after the hero), and every panel's film bursting off the car
// (BURST, after the layers). Later chapters keep their original timings, shifted by these blocks.
const CUT = 3.6;
const BURST = 2.4;
const A = (t) => t + CUT;          // wrap … layers
const B = (t) => t + CUT + BURST;  // compare, outro

// Chapter windows on the scroll timeline (timeline seconds) and where each one is fully shown.
const CHAPTERS = [
  { id: 'hero', from: 0, to: 0.4, at: 0 },
  { id: 'cut', from: 0.4, to: CUT, at: 1.9 },
  { id: 'wrap', from: CUT, to: A(1.9), at: A(1.15) },
  { id: 'impact', from: A(1.9), to: A(3.75), at: A(3.3) },
  { id: 'heal', from: A(3.75), to: A(6.05), at: A(5.3) },
  { id: 'layers', from: A(6.05), to: A(10.4), at: A(8.0) },
  { id: 'burst', from: A(10.4), to: B(10.4), at: A(11.5) },
  { id: 'compare', from: B(10.4), to: B(12.8), at: B(11.9) },
  { id: 'outro', from: B(12.8), to: Infinity, at: B(13.6) },
];
const IMPACT = [A(2.45), A(3.75)]; // stones fly inside this window
const LAYER_DWELL = [A(7.85), A(10.0)];

/**
 * One car in a dark studio carries the whole story: film torch → wrap → lab stone-chip test →
 * close-up self-heal → PPF layers rising out of the bonnet → before / after → booking.
 * The car stays centred; the copy sits in two side columns.
 */
export function initStory({ section, sticky, canvas, cursor }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio, 1.75);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.environment = makeStudioEnv(renderer);
  scene.fog = new THREE.Fog(BG, 12, 30);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.03, 100);
  const target = new THREE.Vector3();

  // the photographed studio replaces the hand-built one as soon as its HDRI arrives
  const envReady = hdrLoader.loadAsync(asset('textures/studio.hdr')).then((hdr) => {
    const old = scene.environment;
    scene.environment = makeStudioEnv(renderer, { hdr, strips: 0.7 });
    old.dispose();
    hdr.dispose();
  }).catch((err) => console.warn('studio HDRI unavailable, keeping the procedural studio', err));

  // ---- floor: glossy epoxy, not a perfect mirror — the reflection is softened, then faded into the dark
  const mirror = new Reflector(new THREE.PlaneGeometry(40, 40), { color: 0x5a5a5a, textureWidth: 1024, textureHeight: 1024, shader: SOFT_REFLECTOR });
  mirror.rotation.x = -PI / 2;
  scene.add(mirror);
  const fade = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({
      color: BG, transparent: true, depthWrite: false, alphaMap: radialTexture('rgb(140,140,140)', 'rgb(255,255,255)', 512),
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, // never z-fight the mirror far away
    }),
  );
  fade.rotation.x = -PI / 2;
  fade.position.y = 0.01;
  scene.add(fade);
  const outer = new THREE.Mesh(
    new THREE.RingGeometry(12.9, 40, 64),
    new THREE.MeshBasicMaterial({ color: BG, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  outer.rotation.x = -PI / 2;
  outer.position.y = 0.01;
  scene.add(outer);

  // ---- car rig: carGroup (float) → spin (faces +Z) → car root
  const carGroup = new THREE.Group();
  const spin = new THREE.Group();
  spin.rotation.y = PI;
  carGroup.add(spin);
  scene.add(carGroup);
  // contact shadow: ambient occlusion of the Urus on the floor, baked in Blender (blender/urus.blend)
  const aoTex = new THREE.TextureLoader().load(asset('textures/car-shadow.jpg'));
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 6.6),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { map: { value: aoTex }, uStrength: { value: 0.96 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float uStrength;
        varying vec2 vUv;
        void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, pow(1.0 - texture2D(map, vUv).r, 1.1) * uStrength); }`,
    }),
  );
  shadow.rotation.x = -PI / 2;
  shadow.position.y = 0.006;
  spin.add(shadow);

  // ---- chapter overlays
  const ch = Object.fromEntries([...sticky.querySelectorAll('[data-ch]')].map((el) => [el.dataset.ch, el]));
  const hint = sticky.querySelector('.story__hint');
  const rail = [...sticky.querySelectorAll('.rail button')];
  const knob = sticky.querySelector('#compareKnob');
  const wrapLabel = sticky.querySelector('[data-wrap-pct]');
  const healStatus = sticky.querySelector('#healStatus');
  const healTemp = sticky.querySelector('#healTemp');
  if (isTouch && hint) hint.lastChild.textContent = 'Chạm vào thân xe để xem lớp phim';

  const uniforms = createUniforms();
  const hood = createHood({ overlay: ch.layers, isTouch });
  const cutter = createCutter();
  const burst = createBurst();
  const stones = createStones({ uniforms });
  const word = createHeroWord(scene);
  const callouts = createCallouts({ el: ch.hero.querySelector('#heroCallouts'), isTouch });

  // ---- story state (intro + scroll timeline write here)
  // pfit / pY / pEl only apply on portrait screens: pull back so the whole car fits the narrow width,
  // and look down a little more so a low 3/4 view doesn't read as a flat strip on a phone.
  const state = { az: 0.62, el: 0.08, dist: 9.3, tx: 0, ty: 0.78, tz: 0.2, shiftX: -0.07, shiftY: 0.02, pfit: 2, pY: -0.06, pEl: 0.07, wrap: 0, impact: 0 };
  const introOff = { az: -0.5, el: 0.06, dist: 6 }; // decays to zero so it never fights the scroll timeline
  const heat = { t: 28 };
  const cmp = { compare: 0, split: 0 };
  let userSplit = null;
  let mode = 'hero';
  let tl = null;
  let car = null;
  word.place(state.az, new THREE.Vector3(state.tx, state.ty, state.tz));

  const ready = Promise.all([loadCar(uniforms), hood.ready, stones.ready, word.ready, envReady, cutter.ready, burst.ready]).then(async ([c]) => {
    car = c;
    spin.add(c.root);
    c.root.add(stones.group);
    hood.attach(c.root);
    cutter.attach(c.root);
    burst.attach(c.root);
    scene.updateMatrixWorld(true);
    stones.aim(c.root, c.paint, [c.body].filter(Boolean));
    callouts.snap(c.root, [c.paint, c.body].filter(Boolean));
    await warmUp();
    buildTimeline();
  });

  // Compile every shader up front (PPF layers, stones, sparks start hidden), so the first time they
  // appear mid-scroll there is no compile hitch — the old GPU takes a noticeable moment per program.
  async function warmUp() {
    const hidden = [];
    scene.traverse((o) => {
      if (!o.visible && (o.isMesh || o.isPoints || o.isSprite || o.isLine)) { hidden.push(o); o.visible = true; }
    });
    camera.updateMatrixWorld();
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    hidden.forEach((o) => { o.visible = false; });
  }

  // ---- chapter copy reveals: headline line by line, then the supporting blocks
  const chapterEls = Object.entries(ch).filter(([id]) => id !== 'hero');
  const parts = (el) => ({ lines: el.querySelectorAll('.ln > span'), blocks: el.querySelectorAll('.rv') });
  const conceal = (el) => {
    const { lines, blocks } = parts(el);
    gsap.killTweensOf([...lines, ...blocks]);
    gsap.set(lines, { yPercent: 110 });
    gsap.set(blocks, { opacity: 0, y: 18 });
  };
  const reveal = (el) => {
    const { lines, blocks } = parts(el);
    gsap.killTweensOf([...lines, ...blocks]);
    gsap.to(lines, { yPercent: 0, duration: 1.1, stagger: 0.09, ease: 'expo.out' });
    gsap.to(blocks, { opacity: 1, y: 0, duration: 0.9, stagger: 0.08, delay: 0.18, ease: 'expo.out' });
  };
  chapterEls.forEach(([, el]) => conceal(el));
  const shown = {};
  const syncReveals = () => {
    for (const [id, el] of chapterEls) {
      const vis = el.style.visibility !== 'hidden' && parseFloat(el.style.opacity || '0') > 0.04;
      if (vis === !!shown[id]) continue;
      shown[id] = vis;
      vis ? reveal(el) : conceal(el);
    }
  };

  // ---- heal panel (status + surface temperature)
  const STATUS = {
    idle: isTouch ? 'Chạm vào thân xe để bắn thử một viên đá' : 'Nhấp vào thân xe để bắn thử một viên đá',
    impact: 'Va chạm: lớp TPU hấp thụ lực',
    healing: 'Bề mặt đang phục hồi',
    done: 'Bề mặt đã phục hồi hoàn toàn',
  };
  const setStatus = (k) => {
    healStatus.querySelector('span').textContent = STATUS[k];
    healStatus.classList.toggle('is-healing', k === 'healing' || k === 'impact');
    healStatus.classList.toggle('is-done', k === 'done');
  };
  setStatus('idle');

  // ---- pointer
  const pointer = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5, inside: false, down: false };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmp = new THREE.Vector3();
  const setNdc = () => ndc.set(pointer.x * 2 - 1, -(pointer.y * 2 - 1));

  const paintHit = () => {
    if (!car) return null;
    setNdc();
    raycaster.setFromCamera(ndc, camera);
    const h = raycaster.intersectObjects([car.paint, car.body].filter(Boolean), false)[0];
    if (!h || h.object !== car.paint || !h.face) return null;
    const inv = uniforms.uCarInv.value;
    return { point: h.point.clone().applyMatrix4(inv), normal: h.face.normal.clone().transformDirection(car.paint.matrixWorld).transformDirection(inv) };
  };

  const carToScreen = (p) => {
    tmp.copy(p);
    car.root.localToWorld(tmp).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H };
  };
  const nearSideX = () => Math.sign(tmp.copy(camera.position).applyMatrix4(uniforms.uCarInv.value).x || 1) * 1.0;
  const splitFromPointer = () => {
    if (!car) return;
    const sx = nearSideX();
    const a = carToScreen(new THREE.Vector3(sx, 0.8, CAR_LEN.front));
    const b = carToScreen(new THREE.Vector3(sx, 0.8, CAR_LEN.rear));
    userSplit = THREE.MathUtils.clamp((pointer.x * W - a.x) / (b.x - a.x), 0, 1);
  };

  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - r.left) / r.width;
    pointer.y = (e.clientY - r.top) / r.height;
    pointer.inside = true;
    if (pointer.down && mode === 'compare') splitFromPointer();
  };
  sticky.addEventListener('pointermove', onMove);
  sticky.addEventListener('pointerleave', () => { pointer.inside = false; hood.clearManual(); });
  canvas.addEventListener('pointerdown', (e) => {
    onMove(e);
    pointer.down = true;
    if (mode === 'compare') splitFromPointer();
    if (mode === 'heal') {
      const hit = paintHit();
      if (hit) {
        gsap.killTweensOf(heat);
        stones.throwAt(hit.point, hit.normal, {
          impact: () => setStatus('impact'),
          healing: () => { setStatus('healing'); gsap.to(heat, { t: 62, duration: 0.8, ease: 'power2.out' }); },
          done: () => {
            setStatus('done');
            gsap.to(heat, { t: 28, duration: 1.4 });
            gsap.delayedCall(2.4, () => setStatus('idle'));
          },
        });
      }
    }
  });
  const release = () => {
    pointer.down = false;
    if (isTouch) pointer.inside = false;
  };
  window.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // ---- sizing: follow the canvas's own box. iOS Safari (toolbar, in-app browsers) can change it
  // without a window 'resize', and a buffer with a stale aspect gets stretched flat on screen.
  let W = 1, H = 1;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    W = w;
    H = h;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(uniforms.uRes.value);
    mirror.getRenderTarget().setSize(Math.round(W * dpr * 0.5), Math.round(H * dpr * 0.5));
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 300));

  // ?debug → live size readout, for checking on a real phone
  if (new URLSearchParams(location.search).has('debug')) {
    const box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;margin:0;padding:8px 10px;font:11px/1.4 monospace;color:#9f9;background:rgba(0,0,0,.8);border-radius:6px;pointer-events:none';
    document.body.appendChild(box);
    const gl = renderer.getContext();
    setInterval(() => {
      const vv = window.visualViewport;
      box.textContent = [
        `css    ${canvas.clientWidth}×${canvas.clientHeight}  (${(canvas.clientWidth / canvas.clientHeight).toFixed(3)})`,
        `buffer ${canvas.width}×${canvas.height}  (${(canvas.width / canvas.height).toFixed(3)})`,
        `gl     ${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`,
        `camera ${camera.aspect.toFixed(3)}  dpr ${devicePixelRatio}→${dpr}`,
        `window ${innerWidth}×${innerHeight}  vv ${vv ? `${Math.round(vv.width)}×${Math.round(vv.height)}` : '-'}`,
      ].join('\n');
    }, 500);
  }

  // ---- per frame
  let frame = 0;
  let lastTime = 0;
  const torch = { x: 0.5, y: 0.5 };
  let cursorKey = '';
  let lastPct = -1;
  let lastTemp = -1;
  const setCursor = (label, ghost = false) => {
    const key = `${label}|${ghost}`;
    if (key === cursorKey) return;
    cursorKey = key;
    cursor.setLabel(label, { ghost });
  };
  const enterMode = (m) => {
    if (m === mode) return;
    mode = m;
    rail.forEach((b) => b.classList.toggle('is-active', b.dataset.go === m));
    rail[0]?.parentElement.classList.toggle('is-compact', m === 'layers');
    if (m !== 'compare') userSplit = null;
    if (m !== 'layers') hood.clearManual();
  };

  const render = (time) => {
    frame++;
    if (frame % 30 === 0) resize(); // safety net in case a size change slipped past the observers
    uniforms.uTime.value = time;

    if (tl) {
      const t = tl.time();
      enterMode(CHAPTERS.find((c) => t >= c.from && t < c.to).id);
      if (mode === 'layers') {
        const k = (t - LAYER_DWELL[0]) / (LAYER_DWELL[1] - LAYER_DWELL[0]);
        hood.setScrollIndex(THREE.MathUtils.clamp(Math.floor(k * 5), 0, 4));
      }
      stones.setProgress(state.impact);
    }

    pointer.sx += (pointer.x - pointer.sx) * 0.1;
    pointer.sy += (pointer.y - pointer.sy) * 0.1;
    const mx = pointer.sx - 0.5;
    const my = pointer.sy - 0.5;
    // studio reflections slide across the paint with the mouse
    scene.environmentRotation.y += (mx * 1.2 - scene.environmentRotation.y) * 0.05;
    carGroup.position.y = Math.sin(time * 1.2) * 0.006;

    // camera on a sphere around the target; the car stays centred
    const portrait = camera.aspect < 1;
    const fit = portrait
      ? 1 + (Math.min(2.4, Math.max(1.3, 0.78 / camera.aspect)) - 1) * state.pfit
      : camera.aspect < 1.5 ? 1 + (1.5 - camera.aspect) * 0.6 : 1;
    const close = state.dist < 2 ? 0.25 : 1; // calmer parallax in macro shots
    const camDist = (state.dist + introOff.dist) * fit;
    const el = state.el + (portrait ? state.pEl : 0) + introOff.el + my * 0.04 * close;
    const az = state.az + introOff.az + mx * 0.12 * close;
    target.set(state.tx, state.ty, state.tz);
    camera.position.set(
      target.x + Math.sin(az) * Math.cos(el) * camDist,
      Math.max(0.1, target.y + Math.sin(el) * camDist),
      target.z + Math.cos(az) * Math.cos(el) * camDist,
    );
    camera.lookAt(target);
    scene.fog.near = camDist + 2;
    scene.fog.far = camDist + 16;
    // shiftX pushes the car right of the hero headline; squarer screens need a bigger push
    const sx = portrait ? 0 : state.shiftX * W * (camera.aspect < 1.6 ? 1.35 : 1);
    camera.setViewOffset(W, H, sx, (portrait ? state.pY : state.shiftY) * H, W, H);

    // shader inputs
    uniforms.uWrap.value = state.wrap;
    camera.updateMatrixWorld();
    const dt = Math.min(0.1, time - (lastTime || time));
    lastTime = time;
    // a lit hero callout points the film torch at its spot on the car
    const lit = car && mode === 'hero' ? callouts.update(dt, camera, car.root, W, H, pointer) : null;
    word.update(time, camera, pointer);
    const torchOn = (pointer.inside || lit) && mode === 'hero' ? 1 : 0;
    uniforms.uHover.value += (torchOn - uniforms.uHover.value) * 0.08;
    const aimX = lit ? lit.x / W : pointer.sx, aimY = lit ? lit.y / H : pointer.sy;
    torch.x += (aimX - torch.x) * (lit ? 0.14 : 1);
    torch.y += (aimY - torch.y) * (lit ? 0.14 : 1);
    uniforms.uMouse.value.set(torch.x, 1 - torch.y);
    uniforms.uCompare.value = cmp.compare;
    uniforms.uSplit.value = THREE.MathUtils.lerp(CAR_LEN.front - 0.2, CAR_LEN.rear, userSplit ?? cmp.split);
    if (car) {
      car.root.updateWorldMatrix(true, false);
      uniforms.uCarInv.value.copy(car.root.matrixWorld).invert();
    }
    stones.update();

    // hover feedback (desktop), throttled
    if (car && !isTouch && frame % 4 === 0) {
      if (!pointer.inside) setCursor(null);
      else if (mode === 'hero') {
        setNdc();
        raycaster.setFromCamera(ndc, camera);
        setCursor(raycaster.intersectObject(car.paint, false).length ? 'Lớp phim PPF' : null, true);
      } else if (mode === 'heal') setCursor(paintHit() ? 'Nhấp để bắn đá' : null, true);
      else if (mode === 'compare') setCursor('Kéo để so sánh', true);
      else setCursor(null);
    }

    if (car) hood.update(time, camera, car.root, W, H);
    cutter.update(W, H);
    burst.update();
    syncReveals();

    if (mode === 'compare' && car) {
      const p = carToScreen(new THREE.Vector3(nearSideX(), 0.85, uniforms.uSplit.value));
      knob.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
    const pct = Math.round(state.wrap * 100);
    if (wrapLabel && pct !== lastPct) { wrapLabel.textContent = pct; lastPct = pct; }
    const tc = Math.round(heat.t);
    if (tc !== lastTemp) {
      healTemp.textContent = `${tc}°C`;
      healTemp.classList.toggle('is-hot', tc > 40);
      lastTemp = tc;
    }

    renderer.render(scene, camera);
  };

  let visible = true;
  whenVisible(sticky, (v) => { visible = v; });
  gsap.ticker.add((time) => { if (visible) render(time); });

  // ---- scroll choreography
  function buildTimeline() {
    const root = car.root;
    const w = (v) => root.localToWorld(v.clone());
    const hit = stones.targets[0];
    const hitW = w(hit.point);
    const nW = hit.normal.clone().transformDirection(root.matrixWorld);
    const zoomAz = Math.atan2(nW.x, nW.z) * 0.75 + 1.05 * 0.25;
    const zoomEl = THREE.MathUtils.clamp(Math.asin(nW.y), 0.08, 0.55);
    // frame the whole nose where the stones land
    const noseW = stones.targets.reduce((a, t) => a.add(w(t.point)), new THREE.Vector3()).divideScalar(stones.targets.length);
    noseW.y += 0.05;
    const hoodW = w(hood.center());
    const anat = new THREE.Vector3(0, 0.8, 0).lerp(hoodW, 0.8);
    const S = hood.state;
    // status line follows the scripted heal in whichever direction the visitor scrolls
    const statusAt = (forward, backward) => () => setStatus(tl.scrollTrigger.direction === 1 ? forward : backward);

    tl = gsap.timeline({
      defaults: { ease: 'power1.inOut' },
      scrollTrigger: { trigger: section, start: 'top top', end: 'bottom bottom', scrub: 1 },
    });
    // the plotter stands off the car's left side (car space -X); these are its camera targets
    const cutWide = w(new THREE.Vector3(-3.3, 1.0, -0.6));
    const cutClose = w(new THREE.Vector3(-3.85, 1.0, -0.55));
    const flyMid = w(new THREE.Vector3(-1.3, 1.25, -1.2));
    const K = cutter.state;
    const Bs = burst.state;

    tl
      // 01 → 02: the hero fades and the camera crosses to the shop's ZAPPA plotter
      .to(ch.hero, { autoAlpha: 0, y: -40, duration: 0.3, ease: 'power2.in' }, 0)
      .to([hint, sticky.querySelector('.story__scroll')], { autoAlpha: 0, duration: 0.2 }, 0)
      .fromTo(word.state, { scroll: 1 }, { scroll: 0, duration: 0.35, ease: 'power1.in' }, 0)
      .fromTo(K, { show: 0 }, { show: 1, duration: 0.01 }, 0.02)
      .to(state, { az: -1.22, el: 0.75, dist: 4.0, tx: cutWide.x, ty: cutWide.y, tz: cutWide.z, shiftX: 0, shiftY: 0.02, pfit: 1.0, pY: 0.02, pEl: 0, duration: 0.9 }, 0)
      .fromTo(ch.cut, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 0.6)
      // the knife runs the hood outline; the film jogs under it, the roll turns
      .to(state, { az: -1.3, el: 0.62, dist: 3.3, tx: cutClose.x, ty: cutClose.y, tz: cutClose.z, duration: 0.7 }, 0.95)
      .to(K, { cut: 1, duration: 1.5, ease: 'none' }, 0.9)
      .to(state, { az: -1.22, el: 0.75, dist: 4.0, tx: cutWide.x, ty: cutWide.y, tz: cutWide.z, duration: 0.6 }, 1.85)
      .to(K, { push: 1, duration: 0.3 }, 2.4)
      .to(ch.cut, { autoAlpha: 0, duration: 0.2 }, 2.55)
      // the finished piece lifts off the table and flies onto the bonnet
      .to(state, { az: 0.42, el: 0.42, dist: 6.6, tx: flyMid.x, ty: flyMid.y, tz: flyMid.z, duration: 0.6 }, 2.55)
      .to(K, { lift: 1, duration: 0.25 }, 2.7)
      .to(K, { fly: 1, duration: 0.6 }, 2.95)
      .to(state, { az: 0.85, el: 0.38, dist: 5.2, tx: hoodW.x, ty: hoodW.y + 0.2, tz: hoodW.z, duration: 0.55 }, 3.1)
      .to(K, { show: 0, duration: 0.01 }, CUT + 0.02) // the plotter leaves before the camera swings round
      .to(K, { piece: 0, duration: 0.35 }, CUT + 0.05)
      // 03: side profile while the film laminates front → rear
      .to(state, { az: PI / 2, el: 0.06, dist: 9.9, tx: 0, ty: 0.72, tz: 0, shiftX: 0, shiftY: 0.12, pfit: 1.7, pY: 0.16, pEl: 0, duration: 1 }, CUT)
      .to(state, { wrap: 1, duration: 1.1, ease: 'none' }, A(0.3))
      .fromTo(ch.wrap, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, A(0.45))
      .to(ch.wrap, { autoAlpha: 0, duration: 0.25 }, A(1.65))
      // 04: low on the nose, the lab fires gravel at the paint
      .to(state, { az: 0.95, el: 0.12, dist: 4.2, tx: noseW.x, ty: noseW.y, tz: noseW.z, shiftY: 0.02, pfit: 0.8, pY: 0.02, duration: 0.8 }, A(1.75))
      .fromTo(ch.impact, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, A(2.25))
      .fromTo(state, { impact: 0 }, { impact: 1, duration: IMPACT[1] - IMPACT[0], ease: 'none' }, IMPACT[0])
      .to(ch.impact, { autoAlpha: 0, duration: 0.2 }, A(3.6))
      // 05: fly into the impact mark — it glows warm and fades as the top coat heals
      .to(state, { az: zoomAz, el: zoomEl, dist: 0.62, tx: hitW.x, ty: hitW.y, tz: hitW.z, shiftY: 0, pfit: 0.35, pY: 0.0, duration: 0.85 }, A(3.55))
      .fromTo(ch.heal, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, A(4.25))
      .call(statusAt('healing', 'idle'), null, A(4.5))
      .to(stones.scripted, { heat: 1, duration: 0.3 }, A(4.5))
      .to(heat, { t: 62, duration: 0.3 }, A(4.5))
      .to(stones.scripted, { fade: 0, duration: 0.9, ease: 'power2.inOut' }, A(4.65))
      .to(stones.scripted, { heat: 0, duration: 0.4 }, A(5.35))
      .to(heat, { t: 28, duration: 0.5 }, A(5.35))
      .call(statusAt('done', 'healing'), null, A(5.5))
      .to(ch.heal, { autoAlpha: 0, duration: 0.2 }, A(5.85))
      // 06: back out, the film rises out of the bonnet and separates into its five layers
      .to(state, { az: 0.9, el: 0.24, dist: 7.6, tx: anat.x, ty: anat.y + 0.42, tz: anat.z, shiftY: 0.02, pfit: 0.3, pY: 0.06, duration: 1 }, A(5.9))
      .to(S, { appear: 1, duration: 0.35 }, A(6.75))
      .to(S, { explode: 1, duration: 0.7, ease: 'power2.inOut' }, A(6.85))
      .fromTo(ch.layers, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, A(7.35))
      .to(ch.layers, { autoAlpha: 0, duration: 0.2 }, LAYER_DWELL[1])
      .to(S, { explode: 0, duration: 0.5 }, LAYER_DWELL[1])
      .to(S, { appear: 0, duration: 0.25 }, LAYER_DWELL[1] + 0.35)
      // 07: every panel's film lifts off the car — PPF covers all of it — then settles back
      .to(state, { az: 0.45, el: 0.16, dist: 10.6, tx: 0, ty: 0.75, tz: 0, shiftY: 0.04, pfit: 1.7, pY: 0.06, duration: 0.7 }, A(10.35))
      .to(Bs, { appear: 1, duration: 0.25 }, A(10.75))
      .to(Bs, { explode: 1, duration: 0.7, ease: 'power2.out' }, A(10.9))
      .fromTo(ch.burst, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, A(10.95))
      .to(state, { az: 1.55, el: 0.22, dist: 10.2, duration: 1.0 }, A(11.1))
      .to(Bs, { explode: 0, duration: 0.55, ease: 'power2.in' }, A(11.95))
      .to(ch.burst, { autoAlpha: 0, duration: 0.2 }, A(12.45))
      .to(Bs, { appear: 0, duration: 0.25 }, A(12.5))
      // 08: full side — years without film vs with film
      .to(state, { az: PI / 2, el: 0.06, dist: 9.6, tx: 0, ty: 0.72, tz: 0, shiftY: 0.06, pfit: 2, pY: 0.0, duration: 0.9 }, B(10.3))
      .to(cmp, { compare: 1, duration: 0.3 }, B(11.0))
      .fromTo(cmp, { split: 0 }, { split: 0.5, duration: 0.6, ease: 'expo.out' }, B(11.1))
      .fromTo(ch.compare, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, B(11.1))
      .to(ch.compare, { autoAlpha: 0, duration: 0.2 }, B(12.55))
      .to(cmp, { compare: 0, duration: 0.3 }, B(12.55))
      // 09: call to action
      .to(state, { az: 0.42, el: 0.1, dist: 11.2, tx: 0, ty: 0.78, tz: 0.3, shiftY: 0.02, pfit: 1.15, pY: 0.02, pEl: 0.06, duration: 0.9 }, B(12.7))
      .fromTo(ch.outro, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.3 }, B(13.25))
      .to(word.state, { scroll: 0.85, duration: 0.6 }, B(12.95))
      .to({}, { duration: 0.6 }, B(13.6));
    if (import.meta.env.DEV) window.__story = { tl, state, stones, camera, car, scene, renderer, mirror, cutter, burst };
  }

  const scrollToChapter = (id, lenis) => {
    const c = CHAPTERS.find((x) => x.id === id);
    if (!c || !tl) return;
    const st = tl.scrollTrigger;
    const y = st.start + ((st.end - st.start) * c.at) / tl.duration();
    lenis ? lenis.scrollTo(y, { duration: 1.8 }) : window.scrollTo(0, y);
  };
  rail.forEach((b) => b.addEventListener('click', () => story.scrollToChapter(b.dataset.go, story.lenis)));

  // ---- intro: the car fades up out of the dark
  const intro = () =>
    gsap.timeline()
      .to(renderer, { toneMappingExposure: 1.05, duration: 2.4, ease: 'power2.out' }, 0)
      .to(introOff, { dist: 0, az: 0, el: 0, duration: 2.8, ease: 'expo.out' }, 0)
      .to('.ch--hero .eyebrow', { opacity: 1, duration: 0.8 }, 0.25)
      .to('.hero__title .line > span', { y: 0, duration: 1.3, stagger: 0.1, ease: 'expo.out' }, 0.35)
      .to(word.state, { intro: 1, duration: 2.2, ease: 'power2.out' }, 0.5)
      .to(['.story__hint', '.story__scroll', '.rail'], { opacity: 1, duration: 1 }, 1.4)
      .add(() => callouts.show(), 1.6);

  // ---- demo mode (?demo): a hands-free run through the story for screen recordings
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const yAt = (t) => {
    const st = tl.scrollTrigger;
    return st.start + ((st.end - st.start) * t) / tl.duration();
  };
  const glide = (lenis, y, duration) => new Promise((resolve) => {
    lenis.scrollTo(y, { duration, easing: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2), onComplete: resolve });
  });
  const point = (type, nx, ny, target = sticky) => {
    const r = canvas.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent(type, {
      clientX: r.left + nx * r.width, clientY: r.top + ny * r.height,
      bubbles: true, pointerType: 'mouse', pointerId: 1, isPrimary: true,
    }));
  };
  const sweep = async (path, ms, type = 'pointermove') => {
    const steps = Math.round(ms / 16);
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const seg = Math.min(path.length - 2, Math.floor(k * (path.length - 1)));
      const f = k * (path.length - 1) - seg;
      const [x0, y0] = path[seg], [x1, y1] = path[seg + 1];
      point(type, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
      await wait(16);
    }
  };
  const demo = async (lenis) => {
    await wait(900);
    // 01 the film torch glides over the car
    await sweep([[0.36, 0.55], [0.45, 0.45], [0.55, 0.5], [0.62, 0.42], [0.5, 0.52]], 4200);
    point('pointerleave', 0.5, 0.5);
    // 02 the plotter cuts the hood piece, which flies onto the bonnet
    await glide(lenis, yAt(1.9), 5);
    await glide(lenis, yAt(2.6), 3);
    await glide(lenis, yAt(CUT), 3.5);
    // 03 wrap
    await glide(lenis, yAt(A(1.15)), 4.5);
    await wait(1600);
    // 04 stone test, slowly so every hit reads
    await glide(lenis, yAt(A(2.3)), 2.2);
    await glide(lenis, yAt(A(3.55)), 6.5);
    await wait(600);
    // 05 macro self-heal, then the visitor fires one more stone
    await glide(lenis, yAt(A(5.3)), 5.5);
    await wait(1200);
    point('pointermove', 0.47, 0.46);
    point('pointerdown', 0.47, 0.46, canvas);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await wait(4600);
    // 06 the five layers rise out of the bonnet, one by one
    await glide(lenis, yAt(A(7.85)), 4);
    await glide(lenis, yAt(A(9.95)), 9);
    // 07 every panel's film bursts off the car and settles back
    await glide(lenis, yAt(A(11.4)), 4);
    await glide(lenis, yAt(A(12.6)), 3.5);
    // 08 before / after: drag the split back and forth
    await glide(lenis, yAt(B(11.9)), 4.5);
    await wait(900);
    point('pointerdown', 0.5, 0.5, canvas);
    await sweep([[0.5, 0.5], [0.34, 0.5], [0.66, 0.5], [0.5, 0.5]], 4200);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    point('pointerleave', 0.5, 0.5);
    // 09 booking, then the rest of the page
    await glide(lenis, yAt(B(13.6)), 3.5);
    await wait(2000);
    await glide(lenis, document.documentElement.scrollHeight - window.innerHeight, 14);
  };

  const story = { ready, intro, scrollToChapter, demo, lenis: null };
  return story;
}
