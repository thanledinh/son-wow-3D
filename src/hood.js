import * as THREE from 'three';
import gsap from 'gsap';
import { gltfLoader, asset, HEX_GLSL } from './studio.js';

// Content from the shop's PPF structure sheet (top → bottom).
export const LAYERS = [
  {
    vi: 'Lớp phủ tự phục hồi',
    en: 'Self-healing top coat',
    desc: 'Lớp ngoài cùng có tính đàn hồi, giúp các vết xước nhỏ và vết xoáy tự liền lại khi gặp nhiệt. Bề mặt kỵ nước hạn chế bụi bẩn và vết nước bám.',
    props: ['Tự phục hồi vết xước nhỏ', 'Kỵ nước, dễ vệ sinh', 'Hạn chế bám bẩn'],
  },
  {
    vi: 'Lớp tăng độ bóng',
    en: 'Gloss enhancer · Nano coat',
    desc: 'Lớp phủ nano tăng độ bóng và chiều sâu màu sơn, đồng thời hạn chế tác động của tia UV để phim giữ độ trong theo thời gian.',
    props: ['Tăng độ bóng, sâu màu', 'Hạn chế tia UV', 'Chống ố vàng'],
  },
  {
    vi: 'Màng nền TPU',
    en: 'Thermoplastic polyurethane',
    desc: 'Lõi chịu lực của phim với độ dẻo dai và đàn hồi cao, hấp thụ va đập từ đá văng, cành cây và va quẹt nhẹ trước khi chạm tới lớp sơn.',
    props: ['Chống đá văng', 'Dẻo dai, đàn hồi', 'Ổn định nhiệt'],
  },
  {
    vi: 'Lớp keo kết dính',
    en: 'Adhesive layer',
    desc: 'Lớp keo trong suốt bám chắc trên bề mặt sơn mà không làm đục màu. Khi tháo gỡ đúng kỹ thuật, phim không để lại keo và không ảnh hưởng sơn zin.',
    props: ['Trong suốt', 'Bám chắc, ổn định', 'Tháo gỡ sạch'],
  },
  {
    vi: 'Màng lót bảo vệ',
    en: 'Release liner',
    desc: 'Màng lót bảo vệ lớp keo trong quá trình vận chuyển và cắt phim, được tách ra ngay trước khi thi công lên xe.',
    props: ['Bảo vệ lớp keo', 'Tách ra khi thi công'],
  },
];

const LOOK = [
  { color: 0xeaf6fb, opacity: 0.3, roughness: 0.05, iridescence: 0.9 },
  { color: 0x8fe3ec, opacity: 0.48, roughness: 0.05, iridescence: 1 },
  { color: 0x0e8994, opacity: 0.9, roughness: 0.22, hex: 1 },
  { color: 0x5a0d24, opacity: 0.88, roughness: 0.3, sheen: 1 },
  { color: 0x70849a, opacity: 0.92, roughness: 0.6 },
];
const ACCENT = new THREE.Color(0xf4b223);

function makeMaterial(look) {
  const m = new THREE.MeshPhysicalMaterial({
    color: look.color,
    roughness: look.roughness,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    iridescence: look.iridescence || 0,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [220, 620],
    sheen: look.sheen || 0,
    sheenColor: new THREE.Color(0xff6a8e),
    emissive: ACCENT.clone(),
    emissiveIntensity: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.userData.uniforms = { uAlpha: { value: 0 }, uOpacity: { value: look.opacity }, uHex: { value: look.hex || 0 }, uGlow: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uAlpha; uniform float uOpacity; uniform float uHex; uniform float uGlow;\nvarying float vEdge;\nvarying vec3 vLocal;\n${HEX_GLSL}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        float hx = hexEdge(vLocal.xz * 11.0);
        gl_FragColor.rgb += vec3(0.5, 0.95, 1.0) * hx * uHex * (0.55 + uGlow);
        gl_FragColor.rgb += vec3(1.0, 0.7, 0.28) * uGlow * 0.18;
        gl_FragColor.a = uOpacity * uAlpha * smoothstep(0.0, 0.85, vEdge);`,
      );
  };
  return m;
}

/**
 * Five PPF layers lifted out of the car's own bonnet: each one is the bonnet surface (cut in Blender)
 * pushed out along its normals, so the film keeps the car's curves while it separates.
 */
export function createHood({ overlay, isTouch }) {
  const state = { appear: 0, explode: 0 };
  const layers = [];
  let base = null; // { pos, nrm, count }
  const anchorIdx = { a: 0, b: 0 };

  const ready = gltfLoader.loadAsync(asset('models/ppf-hood.glb')).then((gltf) => {
    let src = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
    src.updateMatrixWorld(true);
    const g = src.geometry.clone().applyMatrix4(src.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    const col = g.attributes.color;
    const n = g.attributes.position.count;
    const edge = new Float32Array(n);
    for (let i = 0; i < n; i++) edge[i] = col ? col.getX(i) : 1;
    g.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    g.deleteAttribute('color');
    base = { pos: g.attributes.position.array.slice(), nrm: g.attributes.normal.array.slice(), count: n };

    // label anchors: the outermost upward-facing points on each side, halfway along the bonnet,
    // so the five offsets fan out vertically instead of sliding sideways off a fender
    const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
    const midZ = (box.min.z + box.max.z) / 2;
    let best = { a: -Infinity, b: Infinity };
    for (let i = 0; i < n; i++) {
      const x = base.pos[i * 3], z = base.pos[i * 3 + 2];
      if (Math.abs(z - midZ) > 0.22 || base.nrm[i * 3 + 1] < 0.85) continue;
      if (x > best.a) { best.a = x; anchorIdx.a = i; }
      if (x < best.b) { best.b = x; anchorIdx.b = i; }
    }

    LOOK.forEach((look, i) => {
      const geo = g.clone();
      const mesh = new THREE.Mesh(geo, makeMaterial(look));
      mesh.renderOrder = 10 + (LOOK.length - i);
      mesh.frustumCulled = false;
      mesh.visible = false;
      layers.push({ mesh, offset: -1 });
    });
  });

  /** Mount under the car root (the patch was cut in the car's own coordinates). */
  const attach = (carRoot) => layers.forEach((l) => carRoot.add(l.mesh));

  // ---- labels + leader lines (desktop) and number buttons (mobile)
  const labelsEl = overlay.querySelector('#layersLabels');
  const linesEl = overlay.querySelector('#layersLines');
  const listEl = overlay.querySelector('#layersList');
  const detail = overlay.querySelector('#layersDetail');
  const column = overlay.querySelector('.ch__r');
  let colLeft = null;
  window.addEventListener('resize', () => { colLeft = null; });
  const SVGNS = 'http://www.w3.org/2000/svg';
  let manual = null, tapped = null, tappedAt = 0, scrollIdx = 0, active = -1;

  const labels = LAYERS.map((L, i) => {
    const el = document.createElement('div');
    el.className = 'layer-label';
    el.innerHTML = `<span class="layer-label__n">0${i + 1}</span><span class="layer-label__vi">${L.vi}</span><span class="layer-label__en">${L.en}</span>`;
    el.addEventListener('pointerenter', () => { manual = i; });
    el.addEventListener('pointerleave', () => { manual = null; });
    labelsEl.appendChild(el);
    const path = document.createElementNS(SVGNS, 'path');
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('r', '4');
    linesEl.append(path, dot);
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" aria-label="${L.vi}">0${i + 1}</button>`;
    li.firstChild.addEventListener('click', () => { tapped = i; tappedAt = scrollIdx; });
    listEl.appendChild(li);
    return { el, path, dot, btn: li.firstChild };
  });

  const swapDetail = (i) => {
    const L = LAYERS[i];
    const f = (k) => detail.querySelector(`[data-f="${k}"]`);
    gsap.timeline()
      .to(detail.children, { opacity: 0, y: 8, duration: 0.18, stagger: 0.02, ease: 'power2.in' })
      .add(() => {
        f('num').textContent = `0${i + 1}`;
        f('name').textContent = L.vi;
        f('en').textContent = L.en;
        f('desc').textContent = L.desc;
        f('props').innerHTML = L.props.map((t) => `<li>${t}</li>`).join('');
      })
      .to(detail.children, { opacity: 1, y: 0, duration: 0.45, stagger: 0.04, ease: 'expo.out' });
  };

  const setScrollIndex = (i) => { scrollIdx = i; };
  const clearManual = () => { manual = null; };

  // offsets (metres along the bonnet normals): liner stays closest, the top coat travels furthest
  const offsetFor = (i, e, lift) => e * (0.07 + (LOOK.length - 1 - i) * 0.13) + lift;

  const tmp = new THREE.Vector3();
  const pointOf = (idx, off, out) => out.set(
    base.pos[idx * 3] + base.nrm[idx * 3] * off,
    base.pos[idx * 3 + 1] + base.nrm[idx * 3 + 1] * off,
    base.pos[idx * 3 + 2] + base.nrm[idx * 3 + 2] * off,
  );

  const update = (t, camera, carRoot, W, H) => {
    if (!base) return;
    const vis = state.appear > 0.001;
    const e = state.explode;

    if (tapped !== null && scrollIdx !== tappedAt) tapped = null;
    const want = manual ?? tapped ?? scrollIdx;
    if (want !== active) {
      active = want;
      swapDetail(active);
      labels.forEach((l, i) => {
        const on = i === active;
        l.el.classList.toggle('is-active', on);
        l.path.classList.toggle('is-active', on);
        l.dot.classList.toggle('is-active', on);
        l.btn.classList.toggle('is-active', on);
      });
    }

    layers.forEach((l, i) => {
      l.mesh.visible = vis;
      if (!vis) return;
      const isA = i === active && e > 0.6;
      l.lift = (l.lift || 0) + ((isA ? 0.05 : 0) - (l.lift || 0)) * 0.12;
      const off = offsetFor(i, e, l.lift) + Math.sin(t * 1.3 + i * 0.8) * 0.006 * e;
      if (Math.abs(off - l.offset) > 1e-4) {
        const p = l.mesh.geometry.attributes.position;
        for (let k = 0; k < base.count * 3; k++) p.array[k] = base.pos[k] + base.nrm[k] * off;
        p.needsUpdate = true;
        l.offset = off;
      }
      const u = l.mesh.material.userData.uniforms;
      u.uAlpha.value = state.appear;
      u.uGlow.value += ((isA ? 1 : 0) - u.uGlow.value) * 0.1;
      l.mesh.material.emissiveIntensity = u.uGlow.value * (i === 2 ? 0.1 : 0.22);
    });

    // labels follow the layer edge facing the right column
    if (W >= 900 && vis) {
      const show = e > 0.65 ? 1 : 0;
      // measured once per resize: reading layout every frame right after writing label transforms forces reflow
      if (colLeft === null) colLeft = column.getBoundingClientRect().left;
      const colX = colLeft;
      const pick = (() => {
        pointOf(anchorIdx.a, 0, tmp); carRoot.localToWorld(tmp).project(camera);
        const xa = tmp.x;
        pointOf(anchorIdx.b, 0, tmp); carRoot.localToWorld(tmp).project(camera);
        return xa > tmp.x ? anchorIdx.a : anchorIdx.b;
      })();
      const pts = layers.map((l) => {
        pointOf(pick, l.offset, tmp);
        carRoot.localToWorld(tmp).project(camera);
        return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H };
      });
      let prevY = -Infinity;
      pts.forEach(({ x, y }, i) => {
        const ly = Math.max(y, prevY + 54);
        prevY = ly;
        const l = labels[i];
        l.el.style.transform = `translate(${colX}px, ${ly - 20}px)`;
        l.el.style.opacity = show;
        l.path.setAttribute('d', `M${x},${y} L${colX - 36},${ly} L${colX - 6},${ly}`);
        l.path.style.opacity = show;
        l.dot.setAttribute('cx', x);
        l.dot.setAttribute('cy', y);
        l.dot.style.opacity = show;
      });
    }
  };

  if (isTouch) overlay.querySelector('.layers__hint')?.remove();

  const center = () => {
    if (!base) return new THREE.Vector3(0, 0.7, -1.55);
    const b = new THREE.Box3().setFromArray(base.pos);
    return b.getCenter(new THREE.Vector3());
  };

  return { state, ready, attach, update, setScrollIndex, clearManual, center };
}
