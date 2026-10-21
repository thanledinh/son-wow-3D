import * as THREE from 'three';
import { LAYERS } from '../hood.js';
import { isTouch, HEX_GLSL } from '../studio.js';

const SIZE = 1;
// the shop's five PPF layers, top → bottom: thin sheets (thickness in scene units) and their look;
// hex = honeycomb glow (the TPU core carries it, the gloss layer a faint echo)
const LOOK = [
  { t: 0.008, color: 0xf6fbff, opacity: 0.22, rough: 0.02, iridescence: 1, edge: 0xffffff },   // self-healing top coat
  { t: 0.008, color: 0xb4ecf3, opacity: 0.3, rough: 0.03, hex: 0.35, edge: 0xd9fbff },         // gloss enhancer
  { t: 0.02, color: 0x1aa3ad, opacity: 0.62, rough: 0.12, hex: 1, edge: 0x9ff6ff },            // TPU
  { t: 0.01, color: 0x8a2246, opacity: 0.55, rough: 0.2, edge: 0xffb3c8 },                     // adhesive
  { t: 0.012, color: 0x8ea0b5, opacity: 0.85, rough: 0.45, edge: 0xe6eef7 },                   // release liner
];
const GAP = 0.26;           // extra spacing per layer when fully separated
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * A small square of PPF beside the car that separates into its five layers (drawn on top of the main frame).
 * Scroll drives state.appear (0→1), state.explode (0→1) and state.cycle (0→5: which layer is lit when the visitor
 * isn't pointing at one). Drag turns it; hovering or tapping a layer picks it and shows its sheet.
 * ui: { events (element under the pointer: the film's sticky frame), root (overlay), tags (container), detail (panel) }.
 * opts.dim: the studio's backdrop colour, laid over the car on tall screens where the square sits in front of it.
 */
export function createSample(ui, opts = {}) {
  const state = { appear: 0, explode: 0, cycle: 0 };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 40);
  camera.position.set(0, 0, 8.0);
  camera.lookAt(0, 0, 0);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2, 4, 3);
  scene.add(key);
  // tall screens: the car stands right behind the square, so it dims while the square is up
  const dimScene = new THREE.Scene();
  const dimCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  dimCam.position.z = 0.5;
  const dimMat = new THREE.MeshBasicMaterial({ color: opts.dim ?? 0x060708, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
  dimScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dimMat));

  const pivot = new THREE.Group();          // turned by dragging
  const stack = new THREE.Group();
  pivot.add(stack);
  scene.add(pivot);
  const base = { x: 0.5, y: -0.62 };       // resting tilt: seen from above, three-quarter
  const rot = { x: base.x, y: base.y, vx: 0, vy: 0 };

  const total = LOOK.reduce((a, l) => a + l.t, 0);
  const time = { value: 0 };
  const layers = LOOK.map((look, i) => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: look.color, roughness: look.rough, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
      iridescence: look.iridescence || 0, iridescenceIOR: 1.45, iridescenceThicknessRange: [220, 640],
      transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.7,
    });
    const u = {
      uTime: time, uPhase: { value: i * 1.37 }, uWave: { value: 0 }, uAlpha: { value: look.opacity },
      uHex: { value: look.hex || 0 }, uGlow: { value: 0 }, uEdge: { value: new THREE.Color(look.edge) },
    };
    // a thin sheet that ripples gently (vertex shader), with a lit cut edge, a passing glint and, on the TPU,
    // a softly pulsing honeycomb
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      const wave = /* glsl */ `
        uniform float uTime; uniform float uPhase; uniform float uWave;
        float rippleY(vec3 p) {
          return (sin(p.x * 3.4 + uTime * 1.25 + uPhase) * 0.026 + sin(p.z * 2.7 - uTime * 1.05 + uPhase * 1.7) * 0.022
            + sin((p.x + p.z) * 5.5 + uTime * 1.9 + uPhase * 0.6) * 0.006) * uWave;
        }`;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${wave}\nvarying vec3 vLocal;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          {
            float e = 0.01;
            float dx = (rippleY(position + vec3(e, 0.0, 0.0)) - rippleY(position - vec3(e, 0.0, 0.0))) / (2.0 * e);
            float dz = (rippleY(position + vec3(0.0, 0.0, e)) - rippleY(position - vec3(0.0, 0.0, e))) / (2.0 * e);
            if (abs(objectNormal.y) > 0.5) objectNormal = normalize(vec3(-dx, 1.0, -dz)) * sign(objectNormal.y);
          }`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;\ntransformed.y += rippleY(position);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uPhase; uniform float uAlpha; uniform float uHex; uniform float uGlow; uniform vec3 uEdge;
          varying vec3 vLocal;
          ${HEX_GLSL}`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          vec3 V = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(abs(dot(normal, V)), 0.0, 1.0), 2.5);
          // the cut edge of the sheet catches the light
          float border = 0.5 - max(abs(vLocal.x), abs(vLocal.z));
          float edge = 1.0 - smoothstep(0.0, 0.014, border);
          // a glint that sweeps across now and then
          float sweep = exp(-pow((vLocal.x - vLocal.z) * 0.7 - (mod(uTime * 0.45 + uPhase * 0.08, 2.6) - 1.3), 2.0) * 60.0);
          // honeycomb: glowing cell walls, breathing slowly across the sheet
          float hx = hexEdge(vLocal.xz * 16.0);
          float breathe = 0.55 + 0.45 * sin(uTime * 1.4 - length(vLocal.xz) * 7.0 + uPhase);
          gl_FragColor.rgb += vec3(0.45, 0.95, 1.0) * hx * uHex * breathe * 0.9;
          gl_FragColor.rgb += uEdge * edge * (0.55 + 1.2 * uGlow);
          gl_FragColor.rgb += vec3(1.0, 0.98, 0.94) * sweep * 0.55 + vec3(1.0, 0.98, 0.94) * fres * 0.25;
          gl_FragColor.rgb += vec3(0.957, 0.698, 0.137) * uGlow * 0.12;
          gl_FragColor.a = clamp(uAlpha * (0.75 + 0.35 * fres) + edge * 0.6 + hx * uHex * 0.3 + sweep * 0.25 + uGlow * 0.1, 0.0, 1.0) * opacity;`);
    };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(SIZE, look.t, SIZE, 56, 1, 56), mat);
    mesh.renderOrder = 10 + (LOOK.length - i);
    mesh.userData.index = i;
    stack.add(mesh);
    return { mesh, mat, u, look, lift: 0, glow: 0, rest: 0 };
  });
  // packed stack, top coat on top, centred on the origin
  let y = total / 2;
  layers.forEach((l) => {
    y -= l.look.t / 2;
    l.rest = y;
    y -= l.look.t / 2;
  });

  // ---- the sheet for the picked layer + a name tag beside each layer (one line on wide screens, two on tall ones)
  const tags = LAYERS.map((L, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'stag';
    const words = L.vi.split(' ');
    el.innerHTML = `<i></i><span class="mono">0${i + 1}</span><b><span>${words.slice(0, 2).join(' ')}</span> <span>${words.slice(2).join(' ')}</span></b>`;
    el.addEventListener('pointerenter', () => { hover = i; });
    el.addEventListener('pointerleave', () => { if (hover === i) hover = null; });
    el.addEventListener('click', () => { picked = picked === i ? null : i; });
    ui.tags.appendChild(el);
    return el;
  });
  const f = (k) => ui.detail.querySelector(`[data-f="${k}"]`);
  let shown = -1;
  const showDetail = (i) => {
    if (i === shown) return;
    shown = i;
    const L = LAYERS[i];
    f('num').textContent = `0${i + 1}`;
    f('name').textContent = L.vi;
    f('en').textContent = L.en;
    f('desc').textContent = L.desc;
    f('props').innerHTML = L.props.map((t) => `<li>${t}</li>`).join('');
    tags.forEach((t, k) => t.classList.toggle('is-active', k === i));
    ui.detail.classList.remove('is-swap');
    void ui.detail.offsetWidth;
    ui.detail.classList.add('is-swap');
  };
  showDetail(0);                            // the sheet is filled before it first shows

  // ---- pointer: drag to turn, hover / tap a layer to pick it
  let W = 1, H = 1, hover = null, picked = null, drag = null;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitAt = (e) => {
    const r = ui.events.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(layers.map((l) => l.mesh), false)[0];
    return h ? h.object.userData.index : null;
  };
  const active = () => state.appear > 0.6;
  ui.events.addEventListener('pointerdown', (e) => {
    if (!active() || hitAt(e) === null) return;
    drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
  });
  window.addEventListener('pointermove', (e) => {
    if (!active()) return;
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      rot.vy = dx * 0.01;
      rot.vx = isTouch ? 0 : dy * 0.006;
      rot.y += rot.vy;
      rot.x = Math.min(1.2, Math.max(-0.2, rot.x + rot.vx));
      return;
    }
    if (!isTouch) {
      const h = hitAt(e);
      hover = h;
      document.body.classList.toggle('sample-hover', h !== null);
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved < 6) {
      const h = hitAt(e);
      if (h !== null) picked = picked === h ? null : h;
    }
    drag = null;
  });

  // ---- the tags share one width (the widest name), so their numbers line up and each line runs to its layer
  const sizeTags = () => {
    ui.tags.style.setProperty('--tag-w', 'auto');
    const w = Math.ceil(Math.max(...tags.map((t) => t.offsetWidth)));
    ui.tags.style.setProperty('--tag-w', `${w}px`);
    return w;
  };

  // ---- the separated square fitted into a box on the page, right of the column its tags need:
  // 'stack' (copy on top): the band between the title and the sheet below it;
  // 'mid' (squarer wide frames): the space left of the title and sheet's column, the car dimmed behind it
  const tmp = new THREE.Vector3();
  const fit = { key: '', zoom: 1, x: 0, y: 0 };
  const turn = new THREE.Matrix4();
  const fitBox = (layout, tagW) => {
    const head = ui.root.querySelector('.sample__head').getBoundingClientRect();
    const sheet = ui.detail.getBoundingClientRect();
    let left, top, right, bottom;
    if (layout === 'stack') {
      top = head.bottom + 22;
      bottom = sheet.top - 22;
      left = head.left + tagW + 6;
      right = W - head.left;
    } else {
      const gutter = W - head.right;
      top = Math.max(84, H * 0.2);                        // the middle three fifths: on a tall 5:4 screen it stays a sample
      bottom = Math.min(H - 96, H * 0.8);
      left = gutter + tagW + 6;
      right = head.left - 36;
    }
    camera.zoom = 1;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // the stack at rest, fully separated (bob and ripple included), at zoom 1
    const half = total / 2 + 2 * GAP + 0.1;
    turn.makeRotationFromEuler(new THREE.Euler(base.x, base.y, 0));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      tmp.set(i & 1 ? SIZE / 2 : -SIZE / 2, i & 2 ? half : -half, i & 4 ? SIZE / 2 : -SIZE / 2).applyMatrix4(turn).project(camera);
      x0 = Math.min(x0, tmp.x);
      x1 = Math.max(x1, tmp.x);
      y0 = Math.min(y0, tmp.y);
      y1 = Math.max(y1, tmp.y);
    }
    const w = ((x1 - x0) / 2) * W, h = ((y1 - y0) / 2) * H;
    const cx = (((x0 + x1) / 2 + 1) / 2) * W;          // its centre, px from the left
    const cy = ((1 - (y0 + y1) / 2) / 2) * H;          // and from the top
    fit.zoom = Math.max(0.4, Math.min((bottom - top) / h, (right - left) / w));
    // zooming moves the centre away from the frame's middle; slide the window so it lands mid-band
    fit.x = W / 2 + (cx - W / 2) * fit.zoom - (left + right) / 2;
    fit.y = H / 2 + (cy - H / 2) * fit.zoom - (top + bottom) / 2;
  };

  // ---- per frame
  // layout: 'side' (car, square and sheet side by side), 'mid' (square left of the sheet, car dimmed behind),
  // 'stack' (title, square, sheet top to bottom, car dimmed behind)
  const update = (time_, w, h, layout) => {
    W = w;
    H = h;
    const on = state.appear > 0.001;
    const fitted = layout !== 'side';
    ui.root.classList.toggle('is-on', state.appear > 0.35);
    dimMat.opacity = fitted ? 0.76 * smooth(clamp01(state.appear)) : 0;
    if (!on) {
      picked = null;
      hover = null;
      fit.key = '';
      document.body.classList.remove('sample-hover');
      return;
    }
    // the square sits right of the car on wide screens, in its fitted box otherwise
    camera.aspect = W / H;
    const k = `${W}x${H}x${layout}`;
    if (fit.key !== k) {
      fit.key = k;
      const tagW = sizeTags();
      if (fitted) fitBox(layout, tagW);
    }
    if (fitted) {
      camera.zoom = fit.zoom;
      camera.setViewOffset(W, H, fit.x, fit.y, W, H);
    } else {
      camera.zoom = 0.92;
      camera.setViewOffset(W, H, -W * 0.068, 0, W, H);
    }
    camera.updateProjectionMatrix();

    // spin back to rest when let go
    if (!drag) {
      rot.vy *= 0.92;
      rot.y += rot.vy;
      rot.x += (base.x - rot.x) * 0.04;
      rot.y += (base.y + Math.sin(time_ * 0.35) * 0.12 - rot.y) * 0.02;
    }
    const a = smooth(clamp01(state.appear));
    pivot.rotation.set(rot.x, rot.y, 0);
    pivot.scale.setScalar(0.85 + 0.15 * a);
    pivot.position.y = (1 - a) * -0.25;

    const want = hover ?? picked ?? Math.min(4, Math.floor(state.cycle));
    if (state.explode > 0.55) showDetail(want);
    const e = smooth(clamp01(state.explode));
    time.value = time_;
    layers.forEach((l, i) => {
      const isA = i === want && state.explode > 0.55;
      l.lift += ((isA ? 0.08 : 0) - l.lift) * 0.12;
      l.glow += ((isA ? 1 : 0) - l.glow) * 0.12;
      // separated sheets float: each bobs on its own beat and ripples a little
      const bob = Math.sin(time_ * 0.9 + i * 1.1) * 0.022 * e;
      l.mesh.position.y = l.rest + e * GAP * (2 - i) + l.lift + bob;
      l.mat.opacity = a;
      l.u.uWave.value = 0.25 + 0.75 * e;
      l.u.uGlow.value = l.glow;
    });

    // tags sit left of each layer, their line running to its left corner
    scene.updateMatrixWorld(true);
    const show = state.explode > 0.55;
    layers.forEach((l, i) => {
      tmp.set(-SIZE / 2, 0, SIZE / 2).applyMatrix4(l.mesh.matrixWorld);
      tmp.project(camera);
      const x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H;
      tags[i].style.transform = `translate(calc(${x.toFixed(1)}px - 100% - 3px), calc(${y.toFixed(1)}px - 50%))`;
      tags[i].style.opacity = show ? 1 : 0;
    });
  };

  /** draw over the main frame (same renderer) */
  const render = (renderer, environment) => {
    if (state.appear <= 0.001) return;
    scene.environment = environment;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    if (dimMat.opacity > 0.002) renderer.render(dimScene, dimCam);
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.autoClear = auto;
  };

  return { state, update, render };
}
