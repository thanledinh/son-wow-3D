import '../style.css';
import './v2.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { loadingManager, isTouch, reducedMotion } from '../studio.js';
import { LAYERS } from '../hood.js';
import { createFilm } from './film.js';
import { outputFrames } from './tracks.js';

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

// ---------- the film ----------
const CHAPTERS = [
  { id: 'machine', label: 'Máy cắt', from: 1 },
  { id: 'cut', label: 'Cắt phim', from: 72 },
  { id: 'fly', label: 'Lên capo', from: 313 },
  { id: 'layers', label: '5 lớp phim', from: 420 },
  { id: 'apply', label: 'Bóc màng lót', from: 529 },
  { id: 'burst', label: 'Toàn xe', from: 613 },
  { id: 'scratch', label: 'Thử cào', from: 807 },
  { id: 'heal', label: 'Tự phục hồi', from: 1001 },
  { id: 'end', label: 'Storedetailing', from: 1121 },
];
const OUT = outputFrames();             // film frames in the order the edit plays them (its speed ramp)
const N = OUT.length;
const section = document.querySelector('.film');
const sticky = section.querySelector('.film__sticky');
const film = createFilm({ canvas: document.querySelector('#filmCanvas') });

// scroll budget: one output frame per ~2.6 % of the screen height, then a short hold on the end card
let perFrame = 1, top = 0;
const layout = () => {
  perFrame = Math.min(30, Math.max(16, innerHeight * 0.026));
  section.style.height = `${Math.round((N - 1) * perFrame + innerHeight * 1.6)}px`;
  top = section.getBoundingClientRect().top + window.scrollY;
};
layout();
window.addEventListener('resize', layout);
ScrollTrigger.addEventListener('refreshInit', layout);

const outAt = (o) => {
  const i = Math.min(N - 2, Math.max(0, Math.floor(o)));
  const k = Math.min(1, Math.max(0, o - i));
  return OUT[i] + (OUT[i + 1] - OUT[i]) * k;
};
const yForFrame = (f) => {
  let o = OUT.findIndex((x) => x >= f);
  if (o < 0) o = N - 1;
  return top + o * perFrame;
};
const endY = () => top + (N - 1) * perFrame;

// ---- HUD: chapters, progress, time, autoplay
const hudChapters = document.querySelector('#hudChapters');
const hudFill = document.querySelector('#hudFill');
const hudTime = document.querySelector('#hudTime');
const playBtn = document.querySelector('#playBtn');
const chapterBtns = CHAPTERS.map((c) => {
  const li = document.createElement('li');
  const o = OUT.findIndex((x) => x >= c.from);
  li.style.setProperty('--at', `${(o / (N - 1)) * 100}%`);
  li.innerHTML = `<button type="button"><span>${c.label}</span></button>`;
  li.firstChild.addEventListener('click', () => { stopPlay(); lenis.scrollTo(yForFrame(c.from) + 2, { duration: 1.6 }); });
  hudChapters.appendChild(li);
  return li.firstChild;
});
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const TOTAL = fmt((N - 1) / 24);

let playing = false;
const stopPlay = () => {
  if (!playing) return;
  playing = false;
  lenis.stop();
  lenis.start();
  playBtn.classList.remove('is-playing');
  playBtn.setAttribute('aria-pressed', 'false');
  playBtn.querySelector('span').textContent = 'Xem tự động';
};
const startPlay = () => {
  let from = lenis.scroll;
  if (from >= endY() - 2) {
    lenis.scrollTo(top, { immediate: true, force: true });
    from = top;
  }
  const remaining = Math.max(0, (endY() - Math.max(from, top)) / perFrame);
  playing = true;
  playBtn.classList.add('is-playing');
  playBtn.setAttribute('aria-pressed', 'true');
  playBtn.querySelector('span').textContent = 'Tạm dừng';
  lenis.scrollTo(endY(), { duration: remaining / 24 + 0.2, easing: (t) => t, force: true, onComplete: () => { playing = true; stopPlay(); } });
};
playBtn.addEventListener('click', () => (playing ? stopPlay() : startPlay()));
['wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, stopPlay, { passive: true }));
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && e.target === document.body) {
    e.preventDefault();
    playing ? stopPlay() : startPlay();
  } else if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) stopPlay();
});

// ---- captions and the end card: shown inside their frame windows
const timed = [...sticky.querySelectorAll('[data-in]')].map((el) => ({ el, a: +el.dataset.in, b: +el.dataset.out, on: false }));
const intro = document.querySelector('#intro');
const scrollHint = document.querySelector('#scrollHint');

// ---- the five layer names beside the spread layers
const tagsEl = document.querySelector('#layerTags');
let tags = [];
const buildTags = () => {
  tags = film.data.labels.map((l, i) => {
    const el = document.createElement('div');
    el.className = 'layer-tag';
    el.innerHTML = `<i></i><span class="layer-tag__n mono">0${i + 1}</span><span class="layer-tag__vi">${LAYERS[i].vi}</span><span class="layer-tag__en mono">${LAYERS[i].en}</span>`;
    tagsEl.appendChild(el);
    return { el, pos: l.pos };
  });
};
const LABELS_AT = [446, 503];

// ---- per tick
let frame = 1, chapter = -1, lastSec = -1, visible = true, booted = false;
let debugHold = null;                    // dev only: pin the film to a frame (window.__v2.hold(f))
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '100px' }).observe(sticky);
const tick = (time) => {
  if (!booted || !visible) return;
  const o = Math.min(N - 1, Math.max(0, (lenis.scroll - top) / perFrame));
  const target = debugHold ?? outAt(o);
  // touch scrolling is not smoothed by Lenis: ease the frame so the film never jumps
  frame += (target - frame) * (isTouch ? 0.22 : 0.5);
  if (Math.abs(target - frame) < 0.01) frame = target;
  film.setFrame(frame);
  film.render(time);

  const p = o / (N - 1);
  hudFill.style.transform = `scaleX(${p})`;
  const sec = Math.floor(o / 24);
  if (sec !== lastSec) { hudTime.textContent = `${fmt(o / 24)} / ${TOTAL}`; lastSec = sec; }
  let c = 0;
  while (c < CHAPTERS.length - 1 && frame >= CHAPTERS[c + 1].from - 0.5) c++;
  if (c !== chapter) {
    chapter = c;
    chapterBtns.forEach((b, i) => {
      b.classList.toggle('is-active', i === c);
      b.classList.toggle('is-done', i < c);
    });
  }
  for (const t of timed) {
    const on = frame >= t.a - 0.5 && frame < t.b + 0.5;
    if (on !== t.on) { t.on = on; t.el.classList.toggle('is-on', on); }
  }
  intro.classList.toggle('is-off', frame > 6);
  scrollHint.classList.toggle('is-off', lenis.scroll > top + 40);

  const tagsOn = frame >= LABELS_AT[0] - 0.5 && frame < LABELS_AT[1] + 0.5 && film.size.W >= 700;
  tagsEl.classList.toggle('is-on', tagsOn);
  if (tagsOn) {
    for (const t of tags) {
      const s = film.project(t.pos);
      t.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    }
  }
};
gsap.ticker.add(tick);

// header links that name a chapter jump inside the film
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const key = a.dataset.chapter;
    if (key) {
      e.preventDefault();
      stopPlay();
      const c = CHAPTERS.find((x) => x.id === key);
      lenis.scrollTo(yForFrame(c.from) + 2, { duration: 1.8 });
      return;
    }
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    stopPlay();
    lenis.scrollTo(el, { duration: 1.6 });
  });
});

// ---------- cursor ----------
(() => {
  const root = document.querySelector('.cursor');
  if (isTouch || !root) return;
  document.body.classList.add('has-cursor');
  const dot = root.querySelector('.cursor__dot');
  const ring = root.querySelector('.cursor__ring');
  const p = { x: innerWidth / 2, y: innerHeight / 2 }, r = { ...p };
  addEventListener('pointermove', (e) => { p.x = e.clientX; p.y = e.clientY; });
  gsap.ticker.add(() => {
    r.x += (p.x - r.x) * 0.18;
    r.y += (p.y - r.y) * 0.18;
    dot.style.transform = `translate(${p.x}px, ${p.y}px)`;
    ring.style.transform = `translate(${r.x}px, ${r.y}px)`;
  });
  document.querySelectorAll('a, button, [data-tilt]').forEach((el) => {
    el.addEventListener('pointerenter', () => root.classList.add('is-hover'));
    el.addEventListener('pointerleave', () => root.classList.remove('is-hover'));
  });
})();

// ---------- magnetic buttons + tilt cards ----------
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

// ---------- horizontal process ----------
{
  const proc = document.querySelector('.process');
  const track = document.querySelector('#processTrack');
  const dist = () => Math.max(0, track.scrollWidth - innerWidth);
  const setH = () => { proc.style.height = `${innerHeight + dist()}px`; };
  setH();
  ScrollTrigger.addEventListener('refreshInit', setH);
  gsap.to(track, {
    x: () => -dist(), ease: 'none',
    scrollTrigger: { trigger: proc, start: 'top top', end: 'bottom bottom', scrub: 0.6, invalidateOnRefresh: true },
  });
  gsap.from('.step', {
    opacity: 0, y: 60, stagger: 0.08, duration: 1, ease: 'expo.out',
    scrollTrigger: { trigger: proc, start: 'top 70%' },
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
    nav.classList.toggle('is-hidden', scroll > last && scroll > 300 && !playing);
    last = scroll;
  });
}

document.querySelectorAll('[data-todo]').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));

// ---------- loader ----------
{
  const bar = document.querySelector('#loaderBar');
  const pct = document.querySelector('#loaderPct');
  const shown = { v: 0 };
  let target = 0;
  loadingManager.onProgress = (_url, loaded, total) => { target = total ? loaded / total : 0; };
  const step = () => {
    shown.v += (target - shown.v) * 0.12;
    bar.style.transform = `scaleX(${shown.v})`;
    pct.textContent = Math.round(shown.v * 100);
  };
  gsap.ticker.add(step);
  Promise.all([film.ready, document.fonts.ready])
    .then(() => { buildTags(); booted = true; })
    .catch((err) => console.error('Asset load failed', err))
    .finally(() => {
      target = 1;
      gsap.timeline({ delay: 0.3 })
        .to(shown, { v: 1, duration: 0.4 })
        .to('#loader', { yPercent: -100, duration: 1.1, ease: 'expo.inOut' })
        .add(() => {
          gsap.ticker.remove(step);
          document.querySelector('#loader').remove();
          document.body.classList.remove('is-loading');
          lenis.start();
          layout();
          ScrollTrigger.refresh();
        })
        .from('.intro .eyebrow', { opacity: 0, y: 12, duration: 0.8 }, '-=0.5')
        .from('.intro__title .line > span', { yPercent: 110, duration: 1.3, stagger: 0.1, ease: 'expo.out' }, '-=0.6')
        .from(['.intro__sub', '.hud', '.film__scroll'], { opacity: 0, duration: 1 }, '-=0.8')
        .add(() => { if (new URLSearchParams(location.search).has('play')) startPlay(); });
    });
}

if (import.meta.env.DEV) {
  window.__v2 = { film, lenis, gsap, OUT, yForFrame, get frame() { return frame; }, hold: (f) => { debugHold = f; } };
}
