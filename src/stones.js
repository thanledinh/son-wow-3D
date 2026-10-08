import * as THREE from 'three';
import gsap from 'gsap';
import { gltfLoader, asset, radialTexture } from './studio.js';
import { CHIP_SLOTS } from './car.js';

// Where the scripted stones land (car space x, y on the nose) and when, as a fraction of the impact chapter.
// The first one is the hero impact the camera flies to; it sits on the side the camera sees.
const SCRIPTED = [
  { x: -0.42, y: 0.6, hit: 0.46 },
  { x: 0.5, y: 0.44, hit: 0.62 },
  { x: 0.08, y: 0.7, hit: 0.78 },
];
const USER_SLOT = CHIP_SLOTS - 1;
const FLY = 0.24; // share of the chapter a stone spends in the air
const BOUNCE = 0.16;
const BURST_N = 32;
const TRAIL_N = 14;

const spark = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64);
const glow = radialTexture('rgba(255,214,150,1)', 'rgba(255,160,60,0)', 128);

function makeBurst() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_N * 3), 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    map: spark, size: 0.014, color: 0xffe6c4, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0,
  }));
  pts.frustumCulled = false;
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  const dirs = Array.from({ length: BURST_N }, () => new THREE.Vector3());
  return { pts, flash, dirs, origin: new THREE.Vector3() };
}

function seedBurst(b, point, normal) {
  b.origin.copy(point);
  b.dirs.forEach((d) => {
    d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.9);
    d.add(normal).normalize().multiplyScalar(0.25 + Math.random() * 0.75);
  });
}

function drawBurst(b, k) {
  // k: 0 → 1 over the burst's life
  const on = k > 0 && k < 1;
  b.pts.material.opacity = on ? (1 - k) * 0.95 : 0;
  b.flash.material.opacity = on ? Math.pow(1 - k, 2) * 0.9 : 0;
  if (!on) return;
  const a = b.pts.geometry.attributes.position.array;
  b.dirs.forEach((d, i) => {
    a[i * 3] = b.origin.x + d.x * k * 0.55;
    a[i * 3 + 1] = b.origin.y + d.y * k * 0.55 - 0.35 * k * k;
    a[i * 3 + 2] = b.origin.z + d.z * k * 0.55;
  });
  b.pts.geometry.attributes.position.needsUpdate = true;
  b.flash.position.copy(b.origin);
  b.flash.scale.setScalar(0.04 + k * 0.22);
}

function makeTrail() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
  const c = new Float32Array(TRAIL_N * 3);
  for (let i = 0; i < TRAIL_N; i++) c.set([1, 0.82, 0.55].map((v) => v * (1 - i / TRAIL_N)), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

/** Streak behind a flying stone: samples of its own path, newest first. */
function drawTrail(line, at, f) {
  const a = line.geometry.attributes.position.array;
  for (let i = 0; i < TRAIL_N; i++) {
    const p = at(Math.max(0, f - i * 0.018));
    a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
  }
  line.geometry.attributes.position.needsUpdate = true;
  line.visible = true;
}

const flight = (out, from, to, f, arc) => out.lerpVectors(from, to, f).setY(THREE.MathUtils.lerp(from.y, to.y, f) + Math.sin(Math.PI * f) * arc);

/**
 * Lab stone-chip test on the car's nose. Scripted impacts follow the scroll; in the heal chapter the
 * visitor can click the paint to fire a stone of their own.
 */
export function createStones({ uniforms }) {
  const group = new THREE.Group();
  const stones = [];
  const bursts = Array.from({ length: CHIP_SLOTS }, () => {
    const b = makeBurst();
    group.add(b.pts, b.flash);
    return b;
  });
  const targets = []; // car-space { point, normal } per scripted stone
  const chipW = new Array(CHIP_SLOTS).fill(0);
  const scripted = { fade: 1, heat: 0 };
  const user = { w: 0, heat: 0, fly: -1, burst: -1, mesh: null, from: new THREE.Vector3(), to: new THREE.Vector3() };

  const ready = gltfLoader.loadAsync(asset('models/stones.glb')).then((gltf) => {
    const meshes = [];
    gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    meshes.forEach((m) => {
      m.material.roughness = 0.9;
      m.userData.s = m.scale.x * 2.2; // Blender sized them ~2 cm; read as ~5 cm gravel on screen
      m.userData.trail = makeTrail();
      group.add(m.userData.trail);
      m.position.set(0, 0, 0);
      m.visible = false;
      m.frustumCulled = false;
      group.add(m);
      stones.push(m);
    });
    user.mesh = stones[stones.length - 1];
  });

  /** Aim the scripted stones at real points on the paint (car space). */
  const aim = (carRoot, paint, blockers) => {
    carRoot.updateWorldMatrix(true, true);
    const inv = carRoot.matrixWorld.clone().invert();
    const ray = new THREE.Raycaster();
    const dirW = new THREE.Vector3(0, -0.12, 1).normalize().transformDirection(carRoot.matrixWorld);
    SCRIPTED.forEach((s) => {
      let found = null;
      for (let dy = 0; dy < 0.3 && !found; dy += 0.03) {
        // the ray dips ~0.47 m over the 3.9 m to the nose, so start that much higher
        const o = carRoot.localToWorld(new THREE.Vector3(s.x, s.y + dy + 0.47, -6));
        ray.set(o, dirW);
        const hit = ray.intersectObjects([paint, ...blockers], false)[0];
        if (hit && hit.object === paint && hit.face) {
          const n = hit.face.normal.clone().transformDirection(paint.matrixWorld).transformDirection(inv);
          found = { point: hit.point.clone().applyMatrix4(inv), normal: n };
        }
      }
      targets.push(found || { point: new THREE.Vector3(s.x, s.y + 0.1, -2.05), normal: new THREE.Vector3(0, 0.4, -0.92).normalize() });
    });
    targets.forEach((t, i) => uniforms.uChips.value[i].set(t.point.x, t.point.y, t.point.z, 0));
    return targets;
  };

  /** u: progress through the impact chapter (0..1). */
  const setProgress = (u) => {
    targets.forEach((t, i) => {
      const s = SCRIPTED[i];
      const m = stones[i];
      if (!m) return;
      const f = (u - (s.hit - FLY)) / FLY;
      const g = (u - s.hit) / BOUNCE;
      const start = new THREE.Vector3(t.point.x + (i - 1) * 0.35, 0.04, t.point.z - 7.5);
      m.userData.trail.visible = false;
      if (f > 0 && f < 1) {
        m.visible = true;
        flight(m.position, start, t.point, f, 0.32);
        m.rotation.set(f * 9, f * 7, 0);
        m.scale.setScalar(m.userData.s);
        const p = new THREE.Vector3();
        drawTrail(m.userData.trail, (k) => flight(p, start, t.point, k, 0.32), f);
      } else if (g >= 0 && g < 1) {
        m.visible = true;
        const vin = t.point.clone().sub(start).normalize();
        const vout = vin.reflect(t.normal).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.3, 0));
        m.position.copy(t.point).addScaledVector(t.normal, 0.02).addScaledVector(vout, g * 1.4);
        m.position.y -= 0.8 * g * g;
        m.rotation.set(9 + g * 6, 7 + g * 4, 0);
        m.scale.setScalar(m.userData.s * (1 - g * 0.6));
      } else m.visible = false;
      chipW[i] = u >= s.hit ? 1 : 0;
      if (g >= 0 && g < 1 && bursts[i].seededAt !== s.hit) { seedBurst(bursts[i], t.point, t.normal); bursts[i].seededAt = s.hit; }
      drawBurst(bursts[i], (u - s.hit) / 0.1);
    });
  };

  /** Visitor fires a stone at a car-space point. Calls back on impact, healing and done. */
  const throwAt = (point, normal, on = {}) => {
    gsap.killTweensOf(user);
    user.to.copy(point);
    user.from.copy(point).addScaledVector(normal, 1.6).add(new THREE.Vector3(0.25, -0.35, -0.9));
    user.w = 0;
    user.heat = 0;
    uniforms.uChips.value[USER_SLOT].set(point.x, point.y, point.z, 0);
    seedBurst(bursts[USER_SLOT], point, normal);
    gsap.timeline()
      .fromTo(user, { fly: 0 }, { fly: 1, duration: 0.32, ease: 'none' })
      .add(() => { user.fly = -1; user.w = 1; on.impact?.(); })
      .fromTo(user, { burst: 0 }, { burst: 1, duration: 0.6, ease: 'power1.out' }, '<')
      .add(() => on.healing?.(), '+=0.5')
      .to(user, { heat: 1, duration: 0.4 }, '<')
      .to(user, { w: 0, duration: 1.7, ease: 'power2.inOut' }, '<0.2')
      .to(user, { heat: 0, duration: 1.0 }, '>-0.4')
      .add(() => on.done?.());
  };

  const update = () => {
    if (user.mesh) {
      if (user.fly >= 0 && user.fly < 1) {
        user.mesh.visible = true;
        flight(user.mesh.position, user.from, user.to, user.fly, 0.15);
        user.mesh.rotation.set(user.fly * 10, user.fly * 6, 0);
        user.mesh.scale.setScalar(user.mesh.userData.s * 0.6);
        const p = new THREE.Vector3();
        drawTrail(user.mesh.userData.trail, (k) => flight(p, user.from, user.to, k, 0.15), user.fly);
      } else {
        user.mesh.visible = false;
        user.mesh.userData.trail.visible = false;
      }
    }
    if (user.burst >= 0) drawBurst(bursts[USER_SLOT], user.burst >= 1 ? 1 : user.burst);

    targets.forEach((_, i) => {
      uniforms.uChips.value[i].w = chipW[i] * scripted.fade;
      uniforms.uChipHeat.value[i] = chipW[i] * scripted.heat;
    });
    uniforms.uChips.value[USER_SLOT].w = user.w;
    uniforms.uChipHeat.value[USER_SLOT] = user.heat;
  };

  return { group, ready, aim, setProgress, throwAt, update, scripted, targets };
}
