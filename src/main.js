import './style.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { loadingManager, isTouch, reducedMotion } from './studio.js';
import { initStory } from './story.js';

gsap.registerPlugin(ScrollTrigger);
document.body.classList.add('is-loading');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

// ---------- smooth scroll ----------
const lenis = new Lenis({ lerp: reducedMotion ? 1 : 0.085, smoothWheel: !reducedMotion });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();

document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    if (a.dataset.chapter) {
      e.preventDefault();
      story.scrollToChapter(a.dataset.chapter, lenis);
      return;
    }
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    lenis.scrollTo(el, { duration: 1.6 });
  });
});

// ---------- cursor ----------
const cursor = (() => {
  const root = document.querySelector('.cursor');
  if (isTouch || !root) return { setLabel() {} };
  document.body.classList.add('has-cursor');
  const dot = root.querySelector('.cursor__dot');
  const ring = root.querySelector('.cursor__ring');
  const text = root.querySelector('.cursor__label');
  const p = { x: innerWidth / 2, y: innerHeight / 2 }, r = { ...p };
  addEventListener('pointermove', (e) => { p.x = e.clientX; p.y = e.clientY; });
  gsap.ticker.add(() => {
    r.x += (p.x - r.x) * 0.18;
    r.y += (p.y - r.y) * 0.18;
    dot.style.transform = `translate(${p.x}px, ${p.y}px)`;
    ring.style.transform = `translate(${r.x}px, ${r.y}px)`;
  });
  let sceneLabel = null, sceneGhost = false, domLabel = null;
  const sync = () => {
    const l = domLabel ?? sceneLabel;
    const ghost = !domLabel && !!sceneLabel && sceneGhost;
    root.classList.toggle('is-label', !!l && !ghost);
    root.classList.toggle('is-ghost', ghost);
    if (l) text.textContent = l;
  };
  document.querySelectorAll('a, button, [data-tilt]').forEach((el) => {
    el.addEventListener('pointerenter', () => root.classList.add('is-hover'));
    el.addEventListener('pointerleave', () => root.classList.remove('is-hover'));
  });
  document.querySelectorAll('[data-cursor]').forEach((el) => {
    el.addEventListener('pointerenter', () => { domLabel = el.dataset.cursor; sync(); });
    el.addEventListener('pointerleave', () => { domLabel = null; sync(); });
  });
  return { setLabel(l, { ghost = false } = {}) { sceneLabel = l; sceneGhost = ghost; sync(); } };
})();

// ---------- magnetic buttons ----------
if (!isTouch) {
  document.querySelectorAll('[data-magnetic]').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    el.addEventListener('pointermove', (e) => {
      const b = el.getBoundingClientRect();
      xTo((e.clientX - b.left - b.width / 2) * 0.3);
      yTo((e.clientY - b.top - b.height / 2) * 0.4);
    });
    el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
  });
}

// ---------- tilt cards with glare ----------
if (!isTouch) {
  document.querySelectorAll('[data-tilt]').forEach((card) => {
    const rx = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3.out' });
    const ry = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3.out' });
    card.addEventListener('pointermove', (e) => {
      const b = card.getBoundingClientRect();
      const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
      ry((x - 0.5) * 12);
      rx((0.5 - y) * 10);
      card.style.setProperty('--gx', `${x * 100}%`);
      card.style.setProperty('--gy', `${y * 100}%`);
    });
    card.addEventListener('pointerleave', () => { rx(0); ry(0); });
  });
}

// ---------- text reveals ----------
document.querySelectorAll('[data-split]').forEach((el) => {
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.append(part); return; }
          const w = document.createElement('span');
          w.className = 'w';
          const inner = document.createElement('span');
          inner.textContent = part;
          w.append(inner);
          frag.append(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
    });
  };
  walk(el);
  gsap.from(el.querySelectorAll('.w > span'), {
    yPercent: 110, duration: 1.1, stagger: 0.045, ease: 'expo.out',
    scrollTrigger: { trigger: el, start: 'top 85%' },
  });
});
gsap.utils.toArray('[data-reveal]').forEach((el) => {
  gsap.from(el, { y: 40, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%' } });
});
gsap.utils.toArray('[data-count]').forEach((el) => {
  const end = +el.dataset.count;
  const o = { v: 0 };
  gsap.to(o, {
    v: end, duration: 2, ease: 'power3.out',
    onUpdate: () => { el.textContent = Math.round(o.v); },
    scrollTrigger: { trigger: el, start: 'top 85%', once: true },
  });
});

// ---------- marquee driven by scroll velocity ----------
{
  const track = document.querySelector('.marquee__track');
  let x = 0, boost = 0, dir = -1;
  lenis.on('scroll', (l) => {
    boost = Math.min(30, Math.abs(l.velocity) * 0.6);
    if (l.direction) dir = l.direction > 0 ? -1 : 1;
  });
  gsap.ticker.add(() => {
    boost *= 0.92;
    x += dir * (0.6 + boost);
    const half = track.scrollWidth / 2;
    if (x <= -half) x += half;
    if (x > 0) x -= half;
    track.style.transform = `translate3d(${x}px,0,0) skewX(${-dir * boost * 0.25}deg)`;
  });
}

// ---------- horizontal process ----------
{
  const section = document.querySelector('.process');
  const track = document.querySelector('#processTrack');
  const dist = () => Math.max(0, track.scrollWidth - innerWidth);
  const setH = () => { section.style.height = `${innerHeight + dist()}px`; };
  setH();
  ScrollTrigger.addEventListener('refreshInit', setH);
  gsap.to(track, {
    x: () => -dist(), ease: 'none',
    scrollTrigger: { trigger: section, start: 'top top', end: 'bottom bottom', scrub: 0.6, invalidateOnRefresh: true },
  });
  gsap.from('.step', {
    opacity: 0, y: 60, stagger: 0.08, duration: 1, ease: 'expo.out',
    scrollTrigger: { trigger: section, start: 'top 70%' },
  });
}

// ---------- nav + progress ----------
{
  const nav = document.querySelector('#nav');
  const bar = document.querySelector('.scroll-progress i');
  let last = 0;
  lenis.on('scroll', ({ scroll, limit }) => {
    bar.style.transform = `scaleX(${limit ? scroll / limit : 0})`;
    nav.classList.toggle('is-solid', scroll > 40);
    nav.classList.toggle('is-hidden', scroll > last && scroll > 300);
    last = scroll;
  });
}

// ---------- contact placeholders (real links come from the shop) ----------
document.querySelectorAll('[data-todo]').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));

// ---------- the car story ----------
const story = initStory({
  canvas: document.querySelector('#storyCanvas'),
  section: document.querySelector('.story'),
  sticky: document.querySelector('.story__sticky'),
  cursor,
});
story.lenis = lenis;
if (import.meta.env.DEV) { window.__lenis = lenis; window.__gsap = gsap; }

// ---------- self-recording (?rec): capture this tab while the demo plays, then download the video ----------
function pickRecorderType() {
  const types = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

function offerRecording() {
  const btn = document.createElement('button');
  btn.className = 'rec-btn';
  btn.type = 'button';
  btn.innerHTML = '<i></i>Bấm để bắt đầu quay video';
  document.body.appendChild(btn);
  btn.addEventListener('click', async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60, cursor: 'never', displaySurface: 'browser' },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      });
    } catch {
      btn.innerHTML = '<i></i>Chưa cấp quyền quay, bấm lại để thử';
      return;
    }
    btn.remove();
    const type = pickRecorderType();
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 14_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: type || 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `storedetailing-demo.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    lenis.scrollTo(0, { immediate: true });
    await new Promise((r) => setTimeout(r, 600));
    rec.start(1000);
    await story.demo(lenis);
    await new Promise((r) => setTimeout(r, 1200));
    rec.stop();
  });
}

// ---------- loader ----------
{
  const bar = document.querySelector('#loaderBar');
  const pct = document.querySelector('#loaderPct');
  const shown = { v: 0 };
  let target = 0;
  loadingManager.onProgress = (_url, loaded, total) => { target = total ? loaded / total : 0; };
  const tick = () => {
    shown.v += (target - shown.v) * 0.12;
    bar.style.transform = `scaleX(${shown.v})`;
    pct.textContent = Math.round(shown.v * 100);
  };
  gsap.ticker.add(tick);

  Promise.all([story.ready, document.fonts.ready])
    .catch((err) => console.error('Asset load failed', err))
    .finally(() => {
      target = 1;
      gsap.timeline({ delay: 0.35 })
        .to(shown, { v: 1, duration: 0.4 })
        .to('#loader', { yPercent: -100, duration: 1.1, ease: 'expo.inOut' })
        .add(() => {
          gsap.ticker.remove(tick);
          document.querySelector('#loader').remove();
          document.body.classList.remove('is-loading');
          lenis.start();
          ScrollTrigger.refresh();
        })
        .add(story.intro(), '-=0.7')
        // ?demo → hands-free run through the whole story; ?rec → the page records that run itself
        .add(() => {
          const q = new URLSearchParams(location.search);
          if (q.has('rec')) offerRecording();
          else if (q.has('demo')) story.demo(lenis);
        });
    });
}
