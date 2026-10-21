import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { isTouch } from '../studio.js';

// The app on the laptop screen: a canvas UI (16:10) whose 3D viewport shows a live render of the car.
const UI_W = 1440, UI_H = 900;
const SCREEN_W = 0.29, SCREEN_H = (SCREEN_W * UI_H) / UI_W;
const RT_ASPECT = UI_W / UI_H;
const TOP = 34, LEFT = 46, RIGHT = 318, BOTTOM = 104;   // chrome sizes (px) once the UI is in
const GOLD = '#f4b223';
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t) => Math.min(1, Math.max(0, t));

const PANELS = [
  ['Hood', 'Hood'], ['FrontBumper', 'Front bumper'], ['Fender_L', 'Fender L'], ['Fender_R', 'Fender R'],
  ['Door_FL', 'Door FL'], ['Door_FR', 'Door FR'], ['Door_RL', 'Door RL'], ['Door_RR', 'Door RR'],
  ['Quarter_L', 'Quarter L'], ['Quarter_R', 'Quarter R'], ['Roof', 'Roof'], ['Tailgate', 'Tailgate'],
  ['RearBumper', 'Rear bumper'],
];

/**
 * A laptop on a standing desk next to the plotter. Its screen runs "PPF Studio": at first the whole screen is the
 * car turning in the dark studio (the page's opening shot), then the app's chrome slides in around it, the car's
 * panels are picked out, flattened into the nested kit and sent to the cutter.
 * state: on (screen brightness), ui 0→1 (chrome in), sel 0→1 (panels picked), nest 0→1 (kit view),
 * send 0→1 (upload), cursor 0→2 (viewport → "Extract" → "Send"), click 0→1 (press flash)
 */
export function createLaptop() {
  const state = { alpha: 1, on: 1, ui: 0, sel: 0, nest: 0, send: 0, cursor: 0, cursorOn: 0, click: 0 };
  const group = new THREE.Group();
  const fading = [];        // every material of the desk and the laptop, so they can fade away once the kit is sent
  const fade = (m) => { m.transparent = true; fading.push(m); return m; };

  // ---------------------------------------------------------------- desk + laptop
  const black = fade(new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.45, metalness: 0.2 }));
  const steel = fade(new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.35, metalness: 0.85 }));
  const top = new THREE.Mesh(new RoundedBoxGeometry(0.84, 0.034, 0.58, 3, 0.008), black);
  top.position.y = 0.918;
  group.add(top);
  for (const [x, z] of [[-0.38, -0.25], [0.38, -0.25], [-0.38, 0.25], [0.38, 0.25]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.9, 0.03), steel);
    leg.position.set(x, 0.45, z);
    group.add(leg);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.03, 0.03), steel);
  bar.position.set(0, 0.16, 0.25);
  group.add(bar, bar.clone().translateZ(-0.5));

  const laptop = new THREE.Group();
  laptop.position.set(0, 0.935, -0.06);
  group.add(laptop);
  const alu = fade(new THREE.MeshPhysicalMaterial({ color: 0x34363a, metalness: 0.85, roughness: 0.34, clearcoat: 0.3 }));
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.312, 0.0155, 0.221, 3, 0.0045), alu);
  base.position.set(0, 0.00775, 0.1105);
  laptop.add(base);
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.104), fade(new THREE.MeshStandardMaterial({ map: keyboardTexture(), roughness: 0.6 })));
  keys.rotation.x = -Math.PI / 2;
  keys.position.set(0, 0.01556, 0.07);
  laptop.add(keys);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.118, 0.074), fade(new THREE.MeshPhysicalMaterial({ color: 0x2c2e32, roughness: 0.25, metalness: 0.4, clearcoat: 1 })));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.01557, 0.168);
  laptop.add(pad);
  const lid = new THREE.Group();
  lid.position.set(0, 0.0155, 0.002);
  lid.rotation.x = -0.27;
  laptop.add(lid);
  const shell = new THREE.Mesh(new RoundedBoxGeometry(0.312, 0.221, 0.0055, 3, 0.0045), alu);
  shell.position.set(0, 0.1105, -0.0029);
  lid.add(shell);
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(0.306, 0.214), fade(new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.08, clearcoat: 1 })));
  bezel.position.set(0, 0.1105, 0.00005);
  lid.add(bezel);

  // ---------------------------------------------------------------- the screen: UI canvas over a live render
  const canvas = document.createElement('canvas');
  canvas.width = UI_W;
  canvas.height = UI_H;
  const g = canvas.getContext('2d');
  const uiTex = new THREE.CanvasTexture(canvas);
  // the UI is redrawn every frame while it animates. Chrome copies a canvas into an sRGB or a flipped texture the slow
  // way (25-30 ms of GPU time per copy), so it goes up as plain bytes the right way up and the shader decodes and flips it
  uiTex.colorSpace = THREE.NoColorSpace;
  uiTex.flipY = false;
  uiTex.anisotropy = 8;
  // the app viewport is rendered only where the screen is in shot, at about the size it is seen at: the opening
  // shot fills the whole frame (on a phone, a tall slice of the 16:10 screen), later the laptop is small in frame.
  // The target is sized from the page canvas (setViewSize); each frame uses its lower-left corner.
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: isTouch ? 2 : 4 });
  const RT_MAX = isTouch ? 1.2e6 : 2.2e6;     // pixels
  const screenU = {
    uUI: { value: uiTex },
    uView: { value: rt.texture },
    uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uSub: { value: new THREE.Vector4(0, 0, 1, 1) },       // the part of the full view that was rendered (uv box)
    uSubScale: { value: new THREE.Vector2(1, 1) },        // the part of the target it was rendered into
    uTexel: { value: new THREE.Vector2(1, 1) },
    uOn: { value: 1 },
    uAlpha: { value: 1 },
    uExposure: { value: 1 },
  };
  const screenMat = new THREE.ShaderMaterial({
    uniforms: screenU,
    toneMapped: false,
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uUI; uniform sampler2D uView; uniform vec4 uRect; uniform vec4 uSub; uniform vec2 uSubScale; uniform vec2 uTexel;
      uniform float uOn; uniform float uAlpha; uniform float uExposure;
      varying vec2 vUv;
      vec3 neutral(vec3 c) {   // the renderer's Khronos PBR Neutral, so the screen matches the page's own frames
        const float startCompression = 0.8 - 0.04;
        const float desaturation = 0.15;
        c *= uExposure;
        float x = min(c.r, min(c.g, c.b));
        float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
        c -= offset;
        float peak = max(c.r, max(c.g, c.b));
        if (peak < startCompression) return c;
        float d = 1.0 - startCompression;
        float newPeak = 1.0 - d * d / (peak + d - startCompression);
        c *= newPeak / peak;
        float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
        return mix(c, vec3(newPeak), g);
      }
      void main() {
        vec2 r = (vUv - uRect.xy) / (uRect.zw - uRect.xy);
        float inside = step(0.0, r.x) * step(r.x, 1.0) * step(0.0, r.y) * step(r.y, 1.0);
        // cover-fit the 16:10 render into the viewport rectangle
        float ra = ((uRect.z - uRect.x) * ${RT_ASPECT.toFixed(4)}) / max(1e-4, uRect.w - uRect.y);
        vec2 q = r - 0.5;
        if (ra < ${RT_ASPECT.toFixed(4)}) q.x *= ra / ${RT_ASPECT.toFixed(4)}; else q.y *= ${RT_ASPECT.toFixed(4)} / ra;
        vec2 s = clamp((q + 0.5 - uSub.xy) / max(uSub.zw - uSub.xy, vec2(1e-4)), 0.0, 1.0) * uSubScale;
        vec3 view = neutral(texture2D(uView, clamp(s, uTexel * 0.5, uSubScale - uTexel * 0.5)).rgb);
        vec4 ui = sRGBTransferEOTF(texture2D(uUI, vec2(vUv.x, 1.0 - vUv.y)));
        vec3 col = mix(view * inside, ui.rgb, ui.a);
        gl_FragColor = vec4(col * uOn, uAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), screenMat);
  screen.position.set(0, 0.112, 0.0001);
  lid.add(screen);

  // the app's viewport camera turns round the car (layer 1: car, floor, grid, panel highlights)
  const view = new THREE.PerspectiveCamera(26, RT_ASPECT, 0.05, 80);
  view.layers.set(1);
  const grid = new THREE.GridHelper(24, 48, 0x6a6f78, 0x3a3e45);
  grid.material.transparent = true;
  grid.material.depthWrite = false;
  grid.position.y = 0.003;
  grid.layers.set(1);
  const highlights = new THREE.Group();     // gold overlays on the panels, only in the app's viewport

  /** add the panel highlights: one mesh per kit panel, sharing its geometry (3D shape) */
  const addHighlights = (panels) => {
    panels.forEach((p, i) => {
      const m = new THREE.Mesh(p.mesh.geometry, new THREE.MeshBasicMaterial({
        color: 0xf4b223, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        forceSinglePass: true,          // (added light: the order of the faces makes no difference)
      }));
      m.morphTargetInfluences = [0];
      m.position.copy(p.rest);
      m.layers.set(1);
      m.renderOrder = 9;
      m.userData.order = i / panels.length;
      highlights.add(m);
    });
  };

  // ---------------------------------------------------------------- UI drawing
  let kit = null;                  // patterns.json, for the nested-kit view
  let dirty = true, last = '';
  const font = (w, px) => `${w} ${px}px "Be Vietnam Pro", system-ui, sans-serif`;
  const mono = (px) => `500 ${px}px "JetBrains Mono", ui-monospace, monospace`;
  const btn = { extract: [UI_W - RIGHT + 18, 540, RIGHT - 36, 38], send: [UI_W - RIGHT + 18, 590, RIGHT - 36, 38] };

  function rectOf(e) {
    return { x: LEFT * e, y: TOP * e, w: UI_W - (LEFT + RIGHT) * e, h: UI_H - (TOP + BOTTOM) * e };
  }

  function draw() {
    const s = state;
    const e = ease(s.ui);
    const v = rectOf(e);
    g.clearRect(0, 0, UI_W, UI_H);
    if (e > 0.001) {
      // top bar
      g.save();
      g.translate(0, -TOP * (1 - e));
      g.fillStyle = '#1b1c1f';
      g.fillRect(0, 0, UI_W, TOP);
      g.fillStyle = GOLD;
      g.beginPath();
      g.roundRect(12, 8, 18, 18, 4);
      g.fill();
      g.fillStyle = '#141006';
      g.font = font(800, 12);
      g.fillText('S', 17.5, 21.5);
      g.font = font(500, 13);
      g.fillStyle = '#c8cbd0';
      ['File', 'Edit', 'View', 'Pattern', 'Cutter', 'Help'].forEach((t, i) => g.fillText(t, 46 + i * 58, 22));
      const tabs = ['Layout', 'Pattern', 'Nesting', 'Cut'];
      const active = s.send > 0 ? 3 : s.nest > 0.5 ? 2 : s.sel > 0 ? 1 : 0;
      tabs.forEach((t, i) => {
        const x = 470 + i * 92;
        if (i === active) {
          g.fillStyle = '#2f3237';
          g.beginPath();
          g.roundRect(x - 10, 6, 82, 22, 6);
          g.fill();
        }
        g.fillStyle = i === active ? '#ffffff' : '#8d939b';
        g.fillText(t, x, 22);
      });
      g.fillStyle = '#8d939b';
      g.textAlign = 'right';
      g.fillText('Storedetailing PPF Studio  ·  Lamborghini Urus 2018', UI_W - 14, 22);
      g.textAlign = 'left';
      g.restore();

      // left toolbar
      g.save();
      g.translate(-LEFT * (1 - e), 0);
      g.fillStyle = '#202125';
      g.fillRect(0, TOP, LEFT, UI_H - TOP);
      for (let i = 0; i < 8; i++) {
        const y = TOP + 14 + i * 44;
        g.fillStyle = i === (s.sel > 0 ? 5 : 0) ? '#3a3d43' : '#26282c';
        g.beginPath();
        g.roundRect(8, y, 30, 30, 6);
        g.fill();
        toolIcon(i, 23, y + 15);
      }
      g.restore();

      // right panel: outliner + pattern properties + actions
      g.save();
      g.translate(RIGHT * (1 - e), 0);
      const x0 = UI_W - RIGHT;
      g.fillStyle = '#212226';
      g.fillRect(x0, TOP, RIGHT, UI_H - TOP);
      g.fillStyle = '#2a2c31';
      g.fillRect(x0, TOP, RIGHT, 28);
      g.fillStyle = '#c8cbd0';
      g.font = font(600, 12);
      g.fillText('Outliner', x0 + 14, TOP + 19);
      g.font = font(500, 12.5);
      let y = TOP + 50;
      g.fillStyle = '#c8cbd0';
      g.fillText('▾  Lamborghini Urus', x0 + 14, y);
      y += 22;
      g.fillStyle = '#8d939b';
      g.fillText('     Body · Glass · Wheels', x0 + 14, y);
      y += 22;
      g.fillStyle = '#c8cbd0';
      g.fillText(`▾  PPF Kit  (${kit ? kit.pieces.length : 14})`, x0 + 14, y);
      y += 8;
      PANELS.forEach(([, label], i) => {
        y += 21;
        const on = clamp01(s.sel * 1.35 - (i / PANELS.length) * 0.35) > 0.5;
        if (on) {
          g.fillStyle = 'rgba(244, 178, 35, 0.16)';
          g.fillRect(x0 + 6, y - 15, RIGHT - 12, 20);
        }
        g.fillStyle = on ? GOLD : '#5d636b';
        g.fillRect(x0 + 30, y - 9, 8, 8);
        g.fillStyle = on ? '#ffffff' : '#a7adb5';
        g.fillText(label, x0 + 46, y);
      });
      y = 452;
      g.fillStyle = '#2a2c31';
      g.fillRect(x0, y, RIGHT, 28);
      g.fillStyle = '#c8cbd0';
      g.font = font(600, 12);
      g.fillText('Film', x0 + 14, y + 19);
      g.font = mono(11.5);
      g.fillStyle = '#a7adb5';
      g.fillText('PPF gloss · 190 µm · roll 1.52 m', x0 + 14, y + 48);
      g.fillText('Cutter  ZAPPA M-1600', x0 + 14, y + 68);
      g.fillStyle = '#5be38d';
      g.beginPath();
      g.arc(x0 + RIGHT - 24, y + 64, 4, 0, Math.PI * 2);
      g.fill();
      button(btn.extract, 'Extract patterns', s.sel > 0, s.cursor > 0.5 && s.cursor < 1.5 && s.click > 0);
      button(btn.send, 'Send to cutter', s.send > 0, s.cursor > 1.5 && s.click > 0);
      g.restore();

      // bottom: status + upload
      g.save();
      g.translate(0, BOTTOM * (1 - e));
      const by = UI_H - BOTTOM;
      g.fillStyle = '#1d1e22';
      g.fillRect(0, by, UI_W - RIGHT * e, BOTTOM);
      g.fillStyle = '#2a2c31';
      g.fillRect(0, by, UI_W - RIGHT * e, 26);
      g.fillStyle = '#c8cbd0';
      g.font = font(600, 12);
      g.fillText(s.send > 0 ? 'Cutter queue' : 'Timeline', 14, by + 18);
      if (s.send > 0) {
        const w = UI_W - RIGHT * e - 60;
        g.fillStyle = '#2b2e33';
        g.beginPath();
        g.roundRect(30, by + 50, w, 12, 6);
        g.fill();
        g.fillStyle = GOLD;
        g.beginPath();
        g.roundRect(30, by + 50, Math.max(12, w * clamp01(s.send)), 12, 6);
        g.fill();
        g.font = mono(13);
        g.fillStyle = '#ffffff';
        const pct = Math.round(clamp01(s.send) * 100);
        g.fillText(pct < 100 ? `Sending kit to ZAPPA M-1600 …  ${pct}%` : 'Sent  ·  ZAPPA M-1600 is cutting', 30, by + 86);
      } else {
        // a timeline ruler with keyframes
        g.strokeStyle = '#34373c';
        g.fillStyle = '#6b7178';
        g.font = mono(10);
        for (let i = 0; i <= 24; i++) {
          const x = 30 + i * ((UI_W - RIGHT * e - 60) / 24);
          g.beginPath();
          g.moveTo(x, by + 34);
          g.lineTo(x, by + BOTTOM - 10);
          g.stroke();
          if (i % 4 === 0) g.fillText(String(i * 10), x + 3, by + 44);
        }
        g.fillStyle = GOLD;
        [3, 7, 12, 18].forEach((k) => {
          const x = 30 + k * ((UI_W - RIGHT * e - 60) / 24);
          g.save();
          g.translate(x, by + 70);
          g.rotate(Math.PI / 4);
          g.fillRect(-4, -4, 8, 8);
          g.restore();
        });
      }
      g.restore();

      // viewport header + axis gizmo, over the render
      g.globalAlpha = e;
      g.fillStyle = 'rgba(22, 23, 26, 0.72)';
      g.fillRect(v.x, v.y, v.w, 26);
      g.font = font(500, 12);
      g.fillStyle = '#c8cbd0';
      g.fillText(s.nest > 0.5 ? 'Nesting  ·  PPF roll 1.52 m' : 'User Perspective  ·  Rendered', v.x + 12, v.y + 17);
      gizmo(v.x + v.w - 46, v.y + 72);
      g.globalAlpha = 1;
    }

    // nested kit view over the viewport
    if (s.nest > 0.001 && kit) nestView(v, s.nest);
    if (s.cursorOn > 0.01) cursor(s);
  }

  function toolIcon(i, cx, cy) {
    g.strokeStyle = '#c8cbd0';
    g.fillStyle = '#c8cbd0';
    g.lineWidth = 1.6;
    g.beginPath();
    switch (i) {
      case 0: g.moveTo(cx - 5, cy - 7); g.lineTo(cx + 5, cy + 1); g.lineTo(cx, cy + 1); g.lineTo(cx - 2, cy + 7); g.closePath(); g.fill(); return;
      case 1: g.moveTo(cx - 8, cy); g.lineTo(cx + 8, cy); g.moveTo(cx, cy - 8); g.lineTo(cx, cy + 8); break;
      case 2: g.arc(cx, cy, 6, 0.3, Math.PI * 1.7); break;
      case 3: g.rect(cx - 6, cy - 6, 12, 12); break;
      case 4: g.moveTo(cx - 7, cy + 6); g.lineTo(cx + 6, cy - 7); g.lineTo(cx + 7, cy - 4); break;
      case 5: g.moveTo(cx - 7, cy + 5); g.quadraticCurveTo(cx, cy - 9, cx + 7, cy + 5); g.lineTo(cx - 7, cy + 5); break;
      case 6: g.moveTo(cx - 8, cy + 4); g.lineTo(cx + 8, cy - 4); g.moveTo(cx - 5, cy + 6); g.lineTo(cx - 3, cy + 2); break;
      default: g.arc(cx, cy, 3, 0, Math.PI * 2); g.moveTo(cx + 8, cy); g.arc(cx, cy, 8, 0, Math.PI * 2);
    }
    g.stroke();
  }

  function gizmo(cx, cy) {
    const axes = [['X', '#e2525d', 22, 8], ['Y', '#7cc85a', -6, -22], ['Z', '#4f8fe6', -16, 14]];
    axes.forEach(([t, c, dx, dy]) => {
      g.strokeStyle = c;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + dx, cy + dy);
      g.stroke();
      g.fillStyle = c;
      g.beginPath();
      g.arc(cx + dx, cy + dy, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#16171a';
      g.font = font(700, 9);
      g.fillText(t, cx + dx - 3, cy + dy + 3);
    });
  }

  function button([x, y, w, h], label, done, pressed) {
    g.fillStyle = pressed ? GOLD : done ? 'rgba(244, 178, 35, 0.18)' : '#2c2f34';
    g.beginPath();
    g.roundRect(x, y, w, h, 8);
    g.fill();
    g.strokeStyle = done || pressed ? GOLD : '#3b3e44';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = pressed ? '#141006' : done ? '#ffd27a' : '#e2e4e7';
    g.font = font(600, 13);
    g.textAlign = 'center';
    g.fillText(label, x + w / 2, y + h / 2 + 4.5);
    g.textAlign = 'left';
  }

  function nestView(v, k) {
    g.save();
    g.globalAlpha = ease(clamp01(k * 3));
    g.fillStyle = '#0b0d10';
    g.fillRect(v.x, v.y + 26, v.w, v.h - 26);
    // the roll, lengthwise across the viewport
    const pad = 46;
    const sc = Math.min((v.w - pad * 2) / kit.length, (v.h - 26 - pad * 2) / kit.filmWidth);
    const fx = v.x + (v.w - kit.length * sc) / 2, fy = v.y + 26 + (v.h - 26 - kit.filmWidth * sc) / 2;
    g.fillStyle = '#10251d';
    g.fillRect(fx, fy, kit.length * sc, kit.filmWidth * sc);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    for (let gx = 0; gx <= kit.length; gx += 0.1) {
      g.beginPath();
      g.moveTo(fx + gx * sc, fy);
      g.lineTo(fx + gx * sc, fy + kit.filmWidth * sc);
      g.stroke();
    }
    for (let gy = 0; gy <= kit.filmWidth; gy += 0.1) {
      g.beginPath();
      g.moveTo(fx, fy + gy * sc);
      g.lineTo(fx + kit.length * sc, fy + gy * sc);
      g.stroke();
    }
    // pieces drop in one after another
    const n = kit.pieces.length;
    kit.pieces.forEach((pc, i) => {
      const a = clamp01((k - 0.15 - (i / n) * 0.6) / 0.25);
      if (a <= 0) return;
      g.globalAlpha = a;
      g.beginPath();
      for (const loop of pc.loops) {
        loop.forEach(([lx, ly], j) => {
          const px = fx + lx * sc, py = fy + ly * sc;
          if (j) g.lineTo(px, py);
          else g.moveTo(px, py);
        });
        g.closePath();
      }
      g.fillStyle = 'rgba(244, 178, 35, 0.12)';
      g.fill('evenodd');
      g.strokeStyle = GOLD;
      g.lineWidth = 1.5;
      g.stroke();
    });
    g.globalAlpha = ease(clamp01(k * 3));
    g.font = mono(12);
    g.fillStyle = '#c8cbd0';
    g.fillText(`${n} pieces  ·  ${kit.pieces.reduce((a, p) => a + p.area, 0).toFixed(1)} m² film  ·  roll 1.52 m`, fx, fy + kit.filmWidth * sc + 24);
    g.restore();
  }

  // the mouse pointer travels viewport → "Extract patterns" → "Send to cutter"
  function cursor(s) {
    const pts = [[UI_W * 0.42, UI_H * 0.52], [btn.extract[0] + btn.extract[2] * 0.6, btn.extract[1] + 22], [btn.send[0] + btn.send[2] * 0.55, btn.send[1] + 22]];
    const t = Math.min(1.999, Math.max(0, s.cursor));
    const i = Math.floor(t), f = ease(t - i);
    const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
    const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
    g.save();
    g.globalAlpha = s.cursorOn;
    g.translate(x, y);
    if (s.click > 0) {
      g.strokeStyle = `rgba(244, 178, 35, ${1 - s.click})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 6 + 22 * s.click, 0, Math.PI * 2);
      g.stroke();
    }
    g.scale(1.4, 1.4);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#111';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, 17);
    g.lineTo(4.5, 13);
    g.lineTo(7.5, 19.5);
    g.lineTo(10, 18.5);
    g.lineTo(7, 12);
    g.lineTo(12.5, 12);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  // ---------------------------------------------------------------- per frame
  const tmp = new THREE.Vector3();
  const VIEW_FOV = 26;
  const FULL_W = 1600, FULL_H = 1000;           // the app viewport's whole frame, in the units of its view offsets
  const inv = new THREE.Matrix4(), ro = new THREE.Vector3(), rd = new THREE.Vector3(), pc = new THREE.Vector3(), pn = new THREE.Vector3();
  const seen = new THREE.Vector4(), part = new THREE.Vector4(), px = new THREE.Vector2();
  const pa = new THREE.Vector2(), pb = new THREE.Vector2(), pe = new THREE.Vector2(), pf = new THREE.Vector2();
  const FRAME_CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  /** the uv box of the screen that the camera's frame covers (conservative), or null if it misses the screen */
  function seenBox(camera) {
    screen.updateWorldMatrix(true, false);
    inv.copy(screen.matrixWorld).invert();
    pc.setFromMatrixPosition(screen.matrixWorld);
    pn.set(0, 0, 1).transformDirection(screen.matrixWorld);
    ro.setFromMatrixPosition(camera.matrixWorld);
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const [x, y] of FRAME_CORNERS) {
      rd.set(x, y, 0.5).unproject(camera).sub(ro);
      const den = rd.dot(pn);
      const t = Math.abs(den) > 1e-9 ? tmp.copy(pc).sub(ro).dot(pn) / den : -1;
      if (!(t > 0)) return seen.set(0, 0, 1, 1);          // a corner of the frame looks past the screen's plane
      tmp.copy(ro).addScaledVector(rd, t).applyMatrix4(inv);
      const u = tmp.x / SCREEN_W + 0.5, v = tmp.y / SCREEN_H + 0.5;
      u0 = Math.min(u0, u);
      v0 = Math.min(v0, v);
      u1 = Math.max(u1, u);
      v1 = Math.max(v1, v);
    }
    seen.set(clamp01(u0), clamp01(v0), clamp01(u1), clamp01(v1));
    return seen.z - seen.x > 1e-4 && seen.w - seen.y > 1e-4 ? seen : null;
  }

  /** the page pixels across a uv box of the screen (width along u, height along v) */
  function boxPixels(camera, b, bw, bh) {
    const at = (u, v, o) => {
      tmp.set((u - 0.5) * SCREEN_W, (v - 0.5) * SCREEN_H, 0).applyMatrix4(screen.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      if (tmp.z > -1e-4) return false;                   // behind the camera
      tmp.applyMatrix4(camera.projectionMatrix);
      o.set((tmp.x * 0.5 + 0.5) * bw, (tmp.y * 0.5 + 0.5) * bh);
      return true;
    };
    if (!at(b.x, b.y, pa) || !at(b.z, b.y, pb) || !at(b.x, b.w, pe) || !at(b.z, b.w, pf)) return px.set(Infinity, Infinity);
    return px.set(Math.max(pa.distanceTo(pb), pe.distanceTo(pf)), Math.max(pa.distanceTo(pe), pb.distanceTo(pf)));
  }

  /**
   * render the app viewport into the screen texture (after update(), before the main render): only the part of it in
   * the page camera's frame, at the size it is seen at. bw, bh: the page's drawing buffer; hook: 1 in the opening shot
   * (the screen fills the frame) → 0 once pulled back; aspect: the page's width / height; copyLeft: the headline sits
   * in a left column (else above the picture).
   */
  const renderView = (renderer, scene, time, camera, bw, bh, hook, aspect, copyLeft) => {
    if (state.on < 0.01 || state.alpha < 0.01) return;
    if (!seenBox(camera)) return;
    const R = screenU.uRect.value;
    part.set(Math.max(seen.x, R.x), Math.max(seen.y, R.y), Math.min(seen.z, R.z), Math.min(seen.w, R.w));
    if (part.z - part.x < 1e-4 || part.w - part.y < 1e-4) return;
    boxPixels(camera, part, bw, bh);
    const pw = Math.max(16, Math.min(rt.width, Math.ceil(px.x * 1.04)));
    const ph = Math.max(16, Math.min(rt.height, Math.ceil(px.y * 1.04)));
    // into the full view's own uv (the shader's cover fit of the 16:10 render into the viewport rectangle)
    const ra = ((R.z - R.x) * RT_ASPECT) / Math.max(1e-4, R.w - R.y);
    const fx = ra < RT_ASPECT ? ra / RT_ASPECT : 1, fy = ra < RT_ASPECT ? 1 : RT_ASPECT / ra;
    const x0 = clamp01(((part.x - R.x) / (R.z - R.x) - 0.5) * fx + 0.5), x1 = clamp01(((part.z - R.x) / (R.z - R.x) - 0.5) * fx + 0.5);
    const y0 = clamp01(((part.y - R.y) / (R.w - R.y) - 0.5) * fy + 0.5), y1 = clamp01(((part.w - R.y) / (R.w - R.y) - 0.5) * fy + 0.5);
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return;
    screenU.uSub.value.set(x0, y0, x1, y1);
    screenU.uSubScale.value.set(pw / rt.width, ph / rt.height);
    screenU.uTexel.value.set(1 / rt.width, 1 / rt.height);

    const az = 0.9 + time * 0.32;
    const el = 0.16, dist = 8.6;
    view.position.set(Math.sin(az) * Math.cos(el) * dist, 0.75 + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    view.lookAt(0, 0.62, 0);
    view.updateMatrixWorld();
    // the opening shot: on a wide page the car sits right of centre, clear of the headline. A tall page (a phone) sees
    // only a slice of the 16:10 screen, so the lens opens until the turning car fits that slice, and closes again as
    // the camera pulls back to the laptop.
    // With the headline in a left column, a frame squarer than 16:10 (4:3, 5:4) also has to keep the car clear of it:
    // the lens opens a little more and the car slides further right.
    // With the headline on top of a landscape-ish frame (a narrow window), the car sits lower and a little smaller so
    // it clears the headline; on a phone held upright there is room below it already.
    const slice = Math.min(1, aspect / RT_ASPECT);
    const squeeze = copyLeft ? 1 - slice : 0;
    const lower = copyLeft ? 0 : clamp01((aspect - 0.9) / 0.4);
    const room = copyLeft ? 1.12 : 1;                       // beside the headline the turning car keeps clear of it
    const open = 1 + (Math.max(1, 0.98 / slice) * room * (1 + squeeze * 1.4) * (1 + lower * 0.2) - 1) * hook;
    view.fov = (Math.atan(Math.tan((VIEW_FOV * Math.PI) / 360) * open) * 360) / Math.PI;
    const away = 1 - ease(state.ui);
    const offX = copyLeft ? -205 * (1 + squeeze * 1.8) * away : 0;
    const offY = -150 * lower * away;
    view.setViewOffset(FULL_W, FULL_H, offX + x0 * FULL_W, offY + (1 - y1) * FULL_H, (x1 - x0) * FULL_W, (y1 - y0) * FULL_H);
    grid.material.opacity = 0.32 * ease(state.ui);
    grid.visible = grid.material.opacity > 0.01;
    highlights.children.forEach((m) => {
      m.material.opacity = 0.42 * clamp01(state.sel * 1.35 - m.userData.order * 0.35) * (1 - clamp01(state.nest * 2));
      m.visible = m.material.opacity > 0.005;
    });
    const fog = scene.fog;
    const near = fog.near, far = fog.far;
    fog.near = dist + 4;
    fog.far = dist + 22;
    rt.viewport.set(0, 0, pw, ph);
    renderer.setRenderTarget(rt);
    renderer.render(scene, view);
    renderer.setRenderTarget(null);
    fog.near = near;
    fog.far = far;
  };

  const update = () => {
    const key = `${state.ui.toFixed(3)}|${state.sel.toFixed(3)}|${state.nest.toFixed(3)}|${state.send.toFixed(3)}|${state.cursor.toFixed(3)}|${state.cursorOn.toFixed(2)}|${state.click.toFixed(2)}|${kit ? 1 : 0}`;
    if (key !== last || dirty) {
      draw();
      uiTex.needsUpdate = true;
      last = key;
      dirty = false;
    }
    const v = rectOf(ease(state.ui));
    screenU.uRect.value.set(v.x / UI_W, 1 - (v.y + v.h) / UI_H, (v.x + v.w) / UI_W, 1 - v.y / UI_H);
    screenU.uOn.value = state.on;
    // the desk and the laptop fade away once the kit has gone to the plotter
    group.visible = state.alpha > 0.002;
    screenU.uAlpha.value = state.alpha;
    for (const m of fading) m.opacity = state.alpha;
  };

  /** the screen's world centre and facing direction (for the opening shot) */
  const screenFrame = (centre, normal) => {
    screen.updateWorldMatrix(true, false);
    centre.setFromMatrixPosition(screen.matrixWorld);
    normal.set(0, 0, 1).transformDirection(screen.matrixWorld);
    return { w: SCREEN_W, h: SCREEN_H };
  };

  /** size the viewport's target from the page's drawing buffer (the opening shot shows it across the whole frame) */
  const setViewSize = (bw, bh) => {
    const s = Math.min(1, Math.sqrt(RT_MAX / (bw * bh)));
    const w = Math.ceil(bw * s), h = Math.ceil(bh * s);
    if (w > rt.width || h > rt.height || w < rt.width * 0.8 || h < rt.height * 0.8) rt.setSize(w, h);
  };

  return {
    group, state, screen, grid, highlights, view, update, renderView, screenFrame, addHighlights, setViewSize,
    target: rt,
    setKit: (k) => { kit = k; dirty = true; },
    refresh: () => { dirty = true; },
    tmp,
  };
}

function keyboardTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 396;
  const g = c.getContext('2d');
  g.fillStyle = '#26282c';
  g.fillRect(0, 0, c.width, c.height);
  const rows = [14, 14, 13, 12, 11];
  const kw = 66, kh = 62, gap = 7.5;
  rows.forEach((n, r) => {
    let x = 14 + r * 10;
    const y = 18 + r * (kh + gap);
    for (let i = 0; i < n; i++) {
      const w = r === 4 && i === 5 ? kw * 4.6 : kw;
      g.fillStyle = '#0d0e10';
      g.beginPath();
      g.roundRect(x, y, w, kh, 8);
      g.fill();
      x += w + gap;
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
