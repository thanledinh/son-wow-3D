import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Giant word standing on the studio floor behind the car (hero + outro). It lives in the 3D scene,
// so the car occludes it, the mirror floor reflects it and it drifts with the camera parallax.
// ---------------------------------------------------------------------------------------------
const WORD = 'PPF';
const WORD_H = 3.3; // metres, about twice the height of the Urus
const WORD_BACK = 3.8; // behind the hero target, away from the hero camera
const FONT = '"Be Vietnam Pro", system-ui, sans-serif';

function drawWord(canvas) {
  const g = canvas.getContext('2d');
  const px = 760;
  const font = `800 ${px}px ${FONT}`;
  g.font = font;
  const m = g.measureText(WORD);
  const pad = 40;
  const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
  canvas.width = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight + pad * 2);
  canvas.height = Math.ceil(asc + desc + pad * 2);
  g.font = font; // resizing the canvas resets the context
  const grd = g.createLinearGradient(0, pad, 0, canvas.height - pad);
  grd.addColorStop(0, '#e6e2da');
  grd.addColorStop(0.55, '#a3a6ab');
  grd.addColorStop(1, '#3a3c40');
  g.fillStyle = grd;
  g.fillText(WORD, pad + m.actualBoundingBoxLeft, pad + asc);
  return canvas.width / canvas.height;
}

export function createHeroWord(scene) {
  const canvas = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // writes depth (empty texels are discarded), so the floor's fade layers behind the letters
  // can't paint over them and z-fight with the mirror down at the base
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: {
      map: { value: tex },
      uOpacity: { value: 0 },
      uSweep: { value: -1 },
      uGlowX: { value: 0.5 },
      uGlow: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float uOpacity, uSweep, uGlowX, uGlow;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a * uOpacity < 0.02) discard;
        // a slanted band of warm light crosses the letters now and then; the cursor lifts them a little
        float band = exp(-pow((vUv.x + (1.0 - vUv.y) * 0.35 - uSweep) * 7.0, 2.0));
        float near = exp(-pow((vUv.x - uGlowX) * 2.6, 2.0)) * uGlow;
        vec3 col = t.rgb * (0.3 + 0.2 * near) + vec3(1.0, 0.8, 0.42) * band * 0.5 * t.a;
        gl_FragColor = vec4(col, t.a * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  scene.add(mesh);

  let aspect = 2;
  // the canvas needs the real webfont, not the fallback
  const ready = document.fonts.load(`800 100px ${FONT}`).catch(() => {}).then(() => {
    aspect = drawWord(canvas);
    tex.needsUpdate = true;
  });

  const base = new THREE.Vector3();
  /** Stand the word behind the car, square to the hero camera (azimuth az around target). */
  const place = (az, target) => {
    base.set(target.x - Math.sin(az) * WORD_BACK, 0, target.z - Math.cos(az) * WORD_BACK);
    mesh.rotation.set(0, az, 0);
  };

  // intro fades it up once, the scroll timeline fades it out and back in for the outro
  const state = { intro: 0, scroll: 1 };
  const tmp = new THREE.Vector3();

  const update = (time, camera, pointer) => {
    const o = state.intro * state.scroll;
    mesh.visible = o > 0.002;
    if (!mesh.visible) return;
    const u = mat.uniforms;
    u.uOpacity.value = o;
    u.uSweep.value = ((time * 0.11) % 1.7) - 0.35;
    u.uGlowX.value += (pointer.sx - u.uGlowX.value) * 0.08;
    u.uGlow.value += ((pointer.inside ? 1 : 0) - u.uGlow.value) * 0.05;
    // on narrow screens shrink it so the whole word still fits across
    const d = camera.position.distanceTo(tmp.copy(base).setY(WORD_H / 2));
    const visW = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const s = Math.min(1, (visW * 0.92) / (WORD_H * aspect));
    mesh.scale.set(WORD_H * aspect * s, WORD_H * s, 1);
    mesh.position.copy(base).setY((WORD_H * s) / 2);
  };

  return { state, ready, place, update };
}

// ---------------------------------------------------------------------------------------------
// Spec callouts pinned to real points on the car, with leader lines (hero chapter).
// Desktop: all three show; hovering a label reveals the film at its point on the car.
// Touch: numbered dots, one label at a time, cycling on its own (and revealing the film there).
// ---------------------------------------------------------------------------------------------
export const CALLOUTS = [
  // from / dir: a ray in car space that lands on the panel; dx, dy: which way the label sits
  { n: '01', title: 'Màng TPU ZAPPA', text: 'Dẻo dai, hấp thụ va đập từ đá văng', from: [-0.3, 2.4, -1.75], dir: [0, -1, 0], dx: 0.7, dy: -1.9 },
  { n: '02', title: 'Tự phục hồi', text: 'Vết xước nhỏ tự liền lại khi gặp nhiệt', from: [-0.62, 0.78, -4], dir: [0, 0, 1], dx: 0.5, dy: 2.1 },
  { n: '03', title: 'Bảo hành đến 10 năm', text: 'Giữ độ bóng sâu, chống ố vàng', from: [-3, 0.84, 0.35], dir: [1, 0, 0], dx: 1, dy: 0.5 },
];
const SVGNS = 'http://www.w3.org/2000/svg';
const CYCLE = 3.6; // seconds per label on touch screens

export function createCallouts({ el, isTouch }) {
  const svg = el.querySelector('.callouts__lines');
  const items = CALLOUTS.map((c, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'callout-dot';
    dot.setAttribute('aria-label', c.title);
    dot.innerHTML = `<span class="mono">${c.n}</span>`;
    const label = document.createElement('div');
    label.className = 'callout';
    label.style.setProperty('--i', i);
    label.innerHTML = `<span class="callout__n mono">${c.n}</span><b>${c.title}</b><span class="callout__t">${c.text}</span>`;
    const path = document.createElementNS(SVGNS, 'path');
    svg.appendChild(path);
    el.append(dot, label);
    const it = { c, dot, label, path, p: null, n: null, w: 0, h: 0, sx: 0, sy: 0, vis: false };
    label.addEventListener('pointerenter', () => { hovered = i; });
    label.addEventListener('pointerleave', () => { if (hovered === i) hovered = null; });
    dot.addEventListener('pointerenter', () => { hovered = i; });
    dot.addEventListener('pointerleave', () => { if (hovered === i) hovered = null; });
    dot.addEventListener('click', () => { picked = i; pickedAt = clock; });
    return it;
  });

  let on = false, hovered = null, picked = null, pickedAt = -99, clock = 0, active = -1;
  let measured = false;
  window.addEventListener('resize', () => { measured = false; });

  /** Land each callout on the car's real surface (car space), once the car is loaded. */
  const snap = (carRoot, meshes) => {
    carRoot.updateWorldMatrix(true, true);
    const inv = carRoot.matrixWorld.clone().invert();
    const ray = new THREE.Raycaster();
    items.forEach((it) => {
      const o = carRoot.localToWorld(new THREE.Vector3(...it.c.from));
      const d = new THREE.Vector3(...it.c.dir).transformDirection(carRoot.matrixWorld);
      ray.set(o, d);
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) {
        it.p = hit.point.clone().applyMatrix4(inv);
        it.n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(inv);
      } else {
        it.p = new THREE.Vector3(...it.c.from).addScaledVector(new THREE.Vector3(...it.c.dir), 1.5);
        it.n = new THREE.Vector3(...it.c.dir).negate();
      }
    });
  };

  const show = () => { on = true; el.classList.add('is-on'); };

  const pw = new THREE.Vector3(), nw = new THREE.Vector3(), view = new THREE.Vector3();

  /** Returns the screen point (px) whose film should be revealed, or null. */
  const update = (dt, camera, carRoot, W, H, pointer) => {
    if (!on || !items[0].p) return null;
    clock += dt;
    if (!measured) {
      items.forEach((it) => { it.w = it.label.offsetWidth; it.h = it.label.offsetHeight; });
      measured = true;
    }
    const small = W < 900;
    const L = THREE.MathUtils.clamp(W * 0.055, 44, 110);

    items.forEach((it) => {
      pw.copy(it.p);
      carRoot.localToWorld(pw);
      nw.copy(it.n).transformDirection(carRoot.matrixWorld);
      it.vis = view.copy(camera.position).sub(pw).normalize().dot(nw) > 0.08;
      pw.project(camera);
      it.sx = (pw.x * 0.5 + 0.5) * W;
      it.sy = (-pw.y * 0.5 + 0.5) * H;
    });

    // which one is lit
    let want;
    if (isTouch || small) {
      const auto = Math.floor(clock / CYCLE) % items.length;
      want = clock - pickedAt < CYCLE * 2 ? picked : auto;
    } else {
      want = hovered;
      if (want === null && pointer.inside) {
        const px = pointer.x * W, py = pointer.y * H;
        items.forEach((it, i) => { if (it.vis && Math.hypot(it.sx - px, it.sy - py) < 70) want = i; });
      }
    }
    if (want !== active) {
      active = want;
      items.forEach((it, i) => {
        const a = i === active;
        it.label.classList.toggle('is-active', a);
        it.dot.classList.toggle('is-active', a);
        it.path.classList.toggle('is-active', a);
      });
    }

    items.forEach((it, i) => {
      const { dx, dy } = it.c;
      const showLabel = it.vis && (!small || i === active);
      let lx, ly, d;
      if (small) {
        // phones: the lit label sits centred near the bottom, its line climbs to the car
        lx = (W - it.w) / 2;
        ly = H - 44 - it.h;
        d = `M${it.sx},${it.sy} L${it.sx},${ly - 16} L${W / 2},${ly - 16} L${W / 2},${ly}`;
      } else {
        const ex = it.sx + dx * L * 0.55, ey = it.sy + dy * L * 0.75;
        lx = dx >= 0 ? ex + L * 0.5 : ex - L * 0.5 - it.w;
        lx = THREE.MathUtils.clamp(lx, 12, W - 96 - it.w); // clear of the chapter rail
        ly = THREE.MathUtils.clamp(ey - it.h / 2, 70, H - it.h - 12);
        const tx = dx >= 0 ? lx : lx + it.w; // the label edge the line meets
        d = `M${it.sx},${it.sy} L${ex},${ly + it.h / 2} L${tx},${ly + it.h / 2}`;
      }
      it.dot.style.transform = `translate(${it.sx}px, ${it.sy}px)`;
      it.dot.style.visibility = it.vis ? 'visible' : 'hidden';
      it.label.style.transform = `translate(${lx}px, ${ly}px)`;
      it.label.classList.toggle('is-shown', showLabel);
      it.path.setAttribute('d', d);
      it.path.classList.toggle('is-shown', showLabel);
    });

    // reveal the film under the lit callout: on hover of the label (desktop) or always on touch
    const reveal = active !== null && active >= 0 && items[active].vis && (isTouch || small || hovered === active);
    return reveal ? { x: items[active].sx, y: items[active].sy } : null;
  };

  return { snap, show, update };
}
