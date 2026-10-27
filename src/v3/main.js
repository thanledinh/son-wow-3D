import '../style.css';
import '../film.css';
import './v3.css';
import './shop.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { loadingManager, isTouch, reducedMotion } from '../studio.js';
import { createStage, T } from './stage.js';
import { initShop } from './shop.js';

gsap.registerPlugin(ScrollTrigger);
document.body.classList.add('is-loading');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const lenis = new Lenis({ lerp: reducedMotion ? 1 : 0.085, smoothWheel: !reducedMotion });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();

// ---------- the story, scrubbed by scroll ----------
const CHAPTERS = [
  { id: 'hook', label: 'Mở đầu', at: 0 },
  { id: 'app', label: 'Phần mềm', at: T.reveal + 0.6 },
  { id: 'send', label: 'Gửi máy cắt', at: T.send + 0.4 },
  { id: 'cut', label: 'Cắt phim', at: T.cut + 0.5 },
  { id: 'fly', label: 'Lên xe', at: T.lift },
  { id: 'orbit', label: '360°', at: T.orbit },
  { id: 'gloss', label: 'Bóng sâu', at: T.apply + 0.4 },
  { id: 'heal', label: 'Tự phục hồi', at: T.swirl + 1.2 },
  { id: 'layers', label: '5 lớp phim', at: T.layers + 1.4 },
  { id: 'end', label: 'Storedetailing', at: T.outro + 0.6 },
];
const PLAY_SPEED = 1 / 1.45;              // timeline seconds per real second when playing on its own
const section = document.querySelector('.film');
const sticky = section.querySelector('.film__sticky');
const stage = createStage({
  canvas: document.querySelector('#stageCanvas'),
  sampleUi: {
    events: sticky,
    root: document.querySelector('#sample'),
    tags: document.querySelector('#sampleTags'),
  },
});
const D = T.end;
// the service below the film (built now, so the cursor and the links below pick up its buttons)
initShop();

let perUnit = 1, top = 0;
const layout = () => {
  perUnit = innerHeight * 0.92;
  // past the film's end the end card holds still, then the service slides up over it: the first section overlaps the
  // film's last screen (shop.css .sd-hero), so the frame stays pinned until it is covered
  section.style.height = `${Math.round(D * perUnit + innerHeight * 2)}px`;
  top = section.getBoundingClientRect().top + window.scrollY;
};
layout();
window.addEventListener('resize', layout);
ScrollTrigger.addEventListener('refreshInit', layout);
const yAt = (t) => top + t * perUnit;
const endY = () => top + D * perUnit;

// ---- HUD
const hudChapters = document.querySelector('#hudChapters');
const hudFill = document.querySelector('#hudFill');
const hudTime = document.querySelector('#hudTime');
const playBtn = document.querySelector('#playBtn');
const chapterBtns = CHAPTERS.map((c) => {
  const li = document.createElement('li');
  li.style.setProperty('--at', `${(c.at / D) * 100}%`);
  li.innerHTML = `<button type="button"><span>${c.label}</span></button>`;
  li.firstChild.addEventListener('click', () => { stopPlay(); lenis.scrollTo(yAt(c.at) + 2, { duration: 1.6 }); });
  hudChapters.appendChild(li);
  return li.firstChild;
});
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const TOTAL = fmt(D / PLAY_SPEED);

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
  const remaining = Math.max(0, (endY() - Math.max(from, top)) / perUnit);
  playing = true;
  playBtn.classList.add('is-playing');
  playBtn.setAttribute('aria-pressed', 'true');
  playBtn.querySelector('span').textContent = 'Tạm dừng';
  lenis.scrollTo(endY(), { duration: remaining / PLAY_SPEED + 0.2, easing: (x) => x, force: true, onComplete: () => { playing = true; stopPlay(); } });
};
playBtn.addEventListener('click', () => (playing ? stopPlay() : startPlay()));
['wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, stopPlay, { passive: true }));
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && e.target === document.body) {
    e.preventDefault();
    playing ? stopPlay() : startPlay();
  } else if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) stopPlay();
});

const timed = [...sticky.querySelectorAll('[data-in]')].map((el) => ({
  el, a: +el.dataset.in, b: +el.dataset.out, on: false, bare: el.dataset.shade === 'none',
}));
const intro = document.querySelector('#intro');
const sideShade = document.querySelector('#sideShade');
const scrollHint = document.querySelector('#scrollHint');

// ---- per tick
let now = 0, chapter = -1, lastSec = -1, visible = true, booted = false;
let debugHold = null;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '100px' }).observe(sticky);
gsap.ticker.add((time) => {
  if (!booted || !visible) return;
  const target = debugHold ?? Math.min(D, Math.max(0, (lenis.scroll - top) / perUnit));
  now += (target - now) * (isTouch ? 0.2 : 0.45);
  if (Math.abs(target - now) < 0.0005 || debugHold !== null) now = target;
  stage.setTime(now);
  stage.render(time);

  hudFill.style.transform = `scaleX(${now / D})`;
  const sec = Math.floor(now / PLAY_SPEED);
  if (sec !== lastSec) { hudTime.textContent = `${fmt(now / PLAY_SPEED)} / ${TOTAL}`; lastSec = sec; }
  let c = 0;
  while (c < CHAPTERS.length - 1 && now >= CHAPTERS[c + 1].at - 0.01) c++;
  if (c !== chapter) {
    chapter = c;
    chapterBtns.forEach((b, i) => {
      b.classList.toggle('is-active', i === c);
      b.classList.toggle('is-done', i < c);
    });
  }
  let copyOn = now <= T.reveal * 0.6;
  for (const t of timed) {
    const on = now >= t.a && now < t.b;
    if (on !== t.on) { t.on = on; t.el.classList.toggle('is-on', on); }
    if (on && t.el.classList.contains('vcap') && !t.bare) copyOn = true;
  }
  intro.classList.toggle('is-off', now > T.reveal * 0.6);
  sideShade.classList.toggle('is-on', copyOn);
  scrollHint.classList.toggle('is-off', lenis.scroll > top + 40);
});

document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const key = a.dataset.chapter;
    if (key) {
      e.preventDefault();
      stopPlay();
      const c = CHAPTERS.find((x) => x.id === key);
      lenis.scrollTo(yAt(c.at) + 2, { duration: 1.8 });
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
  Promise.all([document.fonts.ready, stage.ready])
    .then(() => { booted = true; })
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
        // (clearProps: an inline opacity left behind would keep the scroll hint from ever hiding)
        .from(['.hud', '.film__scroll'], { opacity: 0, duration: 1, clearProps: 'opacity' }, '-=0.8')
        .add(() => { if (new URLSearchParams(location.search).has('play')) startPlay(); });
    });
}

if (import.meta.env.DEV) {
  window.__v3 = { stage, lenis, gsap, T, yAt, get now() { return now; }, hold: (t) => { debugHold = t; } };
}
