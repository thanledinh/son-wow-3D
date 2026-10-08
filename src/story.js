import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import gsap from 'gsap';
import { makeStudioEnv, radialTexture, whenVisible, isTouch } from './studio.js';
import { loadCar, createUniforms, CAR_LEN } from './car.js';
import { createHood } from './hood.js';
import { createStones } from './stones.js';

const PI = Math.PI;
const BG = 0x060708;

// Chapter windows on the scroll timeline (timeline seconds) and where each one is fully shown.
const CHAPTERS = [
  { id: 'hero', from: 0, to: 0.4, at: 0 },
  { id: 'wrap', from: 0.4, to: 1.9, at: 1.15 },
  { id: 'impact', from: 1.9, to: 3.75, at: 3.3 },
  { id: 'heal', from: 3.75, to: 6.05, at: 5.3 },
  { id: 'layers', from: 6.05, to: 10.4, at: 8.0 },
  { id: 'compare', from: 10.4, to: 12.8, at: 11.9 },
  { id: 'outro', from: 12.8, to: Infinity, at: 13.6 },
];
const IMPACT = [2.45, 3.75]; // stones fly inside this window
const LAYER_DWELL = [7.85, 10.0];

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

  // ---- floor: real mirror, faded into the dark with a radial mask
  const mirror = new Reflector(new THREE.PlaneGeometry(40, 40), { color: 0x5a5a5a, textureWidth: 1024, textureHeight: 1024 });
  mirror.rotation.x = -PI / 2;
  scene.add(mirror);
  const fade = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({ color: BG, transparent: true, depthWrite: false, alphaMap: radialTexture('rgb(140,140,140)', 'rgb(255,255,255)', 512) }),
  );
  fade.rotation.x = -PI / 2;
  fade.position.y = 0.003;
  scene.add(fade);
  const outer = new THREE.Mesh(new THREE.RingGeometry(12.9, 40, 64), new THREE.MeshBasicMaterial({ color: BG }));
  outer.rotation.x = -PI / 2;
  outer.position.y = 0.003;
  scene.add(outer);

  // ---- car rig: carGroup (float) → spin (faces +Z) → car root
  const carGroup = new THREE.Group();
  const spin = new THREE.Group();
  spin.rotation.y = PI;
  carGroup.add(spin);
  scene.add(carGroup);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.9, 5.6),
    new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.92)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }),
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
  const stones = createStones({ uniforms });

  // ---- story state (intro + scroll timeline write here)
  const state = { az: 0.62, el: 0.08, dist: 8.6, tx: 0, ty: 0.55, tz: 0.2, shiftY: 0.02, pfit: 1, pY: 0.02, wrap: 0, impact: 0 };
  const introOff = { az: -0.5, el: 0.06, dist: 6 }; // decays to zero so it never fights the scroll timeline
  const heat = { t: 28 };
  const cmp = { compare: 0, split: 0 };
  let userSplit = null;
  let mode = 'hero';
  let tl = null;
  let car = null;

  const ready = Promise.all([loadCar(uniforms), hood.ready, stones.ready]).then(async ([c]) => {
    car = c;
    spin.add(c.root);
    c.root.add(stones.group);
    hood.attach(c.root);
    scene.updateMatrixWorld(true);
    stones.aim(c.root, c.paint, [c.body].filter(Boolean));
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
    const a = carToScreen(new THREE.Vector3(sx, 0.6, CAR_LEN.front));
    const b = carToScreen(new THREE.Vector3(sx, 0.6, CAR_LEN.rear));
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

  // ---- sizing
  let W = 1, H = 1;
  const resize = () => {
    W = sticky.clientWidth;
    H = sticky.clientHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(uniforms.uRes.value);
    mirror.getRenderTarget().setSize(Math.round(W * dpr * 0.6), Math.round(H * dpr * 0.6));
  };
  resize();
  window.addEventListener('resize', resize);

  // ---- per frame
  let frame = 0;
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
    const el = state.el + introOff.el + my * 0.04 * close;
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
    camera.setViewOffset(W, H, 0, (portrait ? state.pY : state.shiftY) * H, W, H);

    // shader inputs
    uniforms.uWrap.value = state.wrap;
    const torchOn = pointer.inside && mode === 'hero' ? 1 : 0;
    uniforms.uHover.value += (torchOn - uniforms.uHover.value) * 0.08;
    uniforms.uMouse.value.set(pointer.sx, 1 - pointer.sy);
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
    syncReveals();

    if (mode === 'compare' && car) {
      const p = carToScreen(new THREE.Vector3(nearSideX(), 0.62, uniforms.uSplit.value));
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
    const anat = new THREE.Vector3(0, 0.55, 0).lerp(hoodW, 0.8);
    const S = hood.state;
    // status line follows the scripted heal in whichever direction the visitor scrolls
    const statusAt = (forward, backward) => () => setStatus(tl.scrollTrigger.direction === 1 ? forward : backward);

    tl = gsap.timeline({
      defaults: { ease: 'power1.inOut' },
      scrollTrigger: { trigger: section, start: 'top top', end: 'bottom bottom', scrub: 1 },
    });
    tl
      // 01 → 02: hero to side profile while the film laminates front → rear
      .to(ch.hero, { autoAlpha: 0, y: -40, duration: 0.3, ease: 'power2.in' }, 0)
      .to([hint, sticky.querySelector('.story__scroll')], { autoAlpha: 0, duration: 0.2 }, 0)
      .to(state, { az: PI / 2, el: 0.06, dist: 9.2, tx: 0, ty: 0.5, tz: 0, shiftY: 0.12, pfit: 1.7, pY: 0.16, duration: 1 }, 0)
      .to(state, { wrap: 1, duration: 1.1, ease: 'none' }, 0.3)
      .fromTo(ch.wrap, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 0.45)
      .to(ch.wrap, { autoAlpha: 0, duration: 0.25 }, 1.65)
      // 03: low on the nose, the lab fires gravel at the paint
      .to(state, { az: 0.95, el: 0.12, dist: 4.2, tx: noseW.x, ty: noseW.y, tz: noseW.z, shiftY: 0.02, pfit: 0.8, pY: 0.02, duration: 0.8 }, 1.75)
      .fromTo(ch.impact, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 2.25)
      .fromTo(state, { impact: 0 }, { impact: 1, duration: IMPACT[1] - IMPACT[0], ease: 'none' }, IMPACT[0])
      .to(ch.impact, { autoAlpha: 0, duration: 0.2 }, 3.6)
      // 04: fly into the impact mark — it glows warm and fades as the top coat heals
      .to(state, { az: zoomAz, el: zoomEl, dist: 0.62, tx: hitW.x, ty: hitW.y, tz: hitW.z, shiftY: 0, pfit: 0.35, pY: 0.0, duration: 0.85 }, 3.55)
      .fromTo(ch.heal, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 4.25)
      .call(statusAt('healing', 'idle'), null, 4.5)
      .to(stones.scripted, { heat: 1, duration: 0.3 }, 4.5)
      .to(heat, { t: 62, duration: 0.3 }, 4.5)
      .to(stones.scripted, { fade: 0, duration: 0.9, ease: 'power2.inOut' }, 4.65)
      .to(stones.scripted, { heat: 0, duration: 0.4 }, 5.35)
      .to(heat, { t: 28, duration: 0.5 }, 5.35)
      .call(statusAt('done', 'healing'), null, 5.5)
      .to(ch.heal, { autoAlpha: 0, duration: 0.2 }, 5.85)
      // 05: back out, the film rises out of the bonnet and separates into its five layers
      .to(state, { az: 0.9, el: 0.24, dist: 7.6, tx: anat.x, ty: anat.y + 0.42, tz: anat.z, shiftY: 0.02, pfit: 0.3, pY: 0.06, duration: 1 }, 5.9)
      .to(S, { appear: 1, duration: 0.35 }, 6.75)
      .to(S, { explode: 1, duration: 0.7, ease: 'power2.inOut' }, 6.85)
      .fromTo(ch.layers, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 7.35)
      .to(ch.layers, { autoAlpha: 0, duration: 0.2 }, LAYER_DWELL[1])
      .to(S, { explode: 0, duration: 0.5 }, LAYER_DWELL[1])
      .to(S, { appear: 0, duration: 0.25 }, LAYER_DWELL[1] + 0.35)
      // 06: full side — years without film vs with film
      .to(state, { az: PI / 2, el: 0.06, dist: 8.9, tx: 0, ty: 0.5, tz: 0, shiftY: 0.06, pfit: 2, pY: 0.0, duration: 0.9 }, 10.3)
      .to(cmp, { compare: 1, duration: 0.3 }, 11.0)
      .fromTo(cmp, { split: 0 }, { split: 0.5, duration: 0.6, ease: 'expo.out' }, 11.1)
      .fromTo(ch.compare, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 11.1)
      .to(ch.compare, { autoAlpha: 0, duration: 0.2 }, 12.55)
      .to(cmp, { compare: 0, duration: 0.3 }, 12.55)
      // 07: call to action
      .to(state, { az: 0.42, el: 0.1, dist: 10.4, tx: 0, ty: 0.55, tz: 0.3, shiftY: 0.02, pfit: 1, pY: 0.02, duration: 0.9 }, 12.7)
      .fromTo(ch.outro, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 13.25)
      .to({}, { duration: 0.6 }, 13.6);
    if (import.meta.env.DEV) window.__story = { tl, state, stones, camera, car, scene, renderer, mirror };
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
      .to('.hero__sub', { opacity: 1, duration: 1 }, 0.9)
      .to('.hero__cta', { opacity: 1, duration: 1 }, 1.05)
      .to(['.story__hint', '.story__scroll', '.rail'], { opacity: 1, duration: 1 }, 1.4);

  const story = { ready, intro, scrollToChapter, lenis: null };
  return story;
}
