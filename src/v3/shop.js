import gsap from 'gsap';
import { SIZES, BRANDS } from './catalog.js';

const money = (n) => Math.round(n).toLocaleString('vi-VN');
const priceHtml = (n) => `${money(n)}<i>đ</i>`;
const micron = (mil) => Math.round(mil * 25.4);
const calm = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * The service after the film: the film picker (a car size and a brand → every film's full-body price), the table of
 * all films, and each block easing in as it scrolls into view. The copy is in index.html, the price list in
 * catalog.js. Call before the page wires its cursor, so the picker's buttons get its hover too.
 */
export function initShop() {
  document.documentElement.classList.add('sd-js');
  const picker = document.querySelector('#sdPicker');
  const table = document.querySelector('#sdTable');
  if (table) buildTable(table);
  if (picker) buildPicker(picker, table);
  reveal();
}

// ---------------------------------------------------------------- the picker
const card = (b, f) => `
  <article class="sd-film${f.badge ? ' is-star' : ''}" style="--mil:${f.mil}">
    <div class="sd-film__top">
      <span class="sd-film__brand">${b.name}</span>
      ${f.badge ? `<span class="sd-film__badge">${f.badge}</span>` : ''}
    </div>
    <h4 class="sd-film__code">${f.code}</h4>
    <div class="sd-swatch" aria-hidden="true">
      <i class="sd-swatch__film"><span>PPF ${f.mil} mil</span></i>
      <i class="sd-swatch__paint"><span>Sơn xe</span></i>
    </div>
    <dl class="sd-film__specs">
      <div><dt>Độ dày</dt><dd>${f.mil} mil <small>${micron(f.mil)} µm</small></dd></div>
      <div><dt>Bảo hành</dt><dd>${f.years} năm</dd></div>
    </dl>
    <p class="sd-film__note">${f.note}</p>
    <div class="sd-film__price">
      <span>Full xe · <b data-size-name></b></span>
      <strong data-price data-m="${f.price.m}" data-l="${f.price.l}" data-xl="${f.price.xl}"></strong>
    </div>
  </article>`;

const panel = (b) => `
  <section class="sd-panel" role="tabpanel" id="sdPanel-${b.id}" aria-labelledby="sdTab-${b.id}" hidden>
    <aside class="sd-brand">
      <p class="sd-brand__tier">${b.tier}</p>
      <h3 class="sd-brand__name">${b.name}</h3>
      <p class="sd-brand__about">${b.about}</p>
      <dl class="sd-brand__facts">
        <div><dt>Bảo hành</dt><dd>${b.warranty}</dd></div>
        <div><dt>Số mã</dt><dd>${b.films.length}</dd></div>
        <div><dt>Giá từ</dt><dd data-from="${b.id}"></dd></div>
      </dl>
      <p class="sd-brand__fit"><b>Phù hợp:</b> ${b.fit}</p>
      <a class="sd-link" href="${b.link}" target="_blank" rel="noopener">Tìm hiểu ${b.full} <span aria-hidden="true">↗</span></a>
    </aside>
    <div class="sd-grid">${b.films.map((f) => card(b, f)).join('')}</div>
  </section>`;

function buildPicker(root, table) {
  root.innerHTML = `
    <div class="sd-picker__bar">
      <div class="sd-seg" role="radiogroup" aria-label="Cỡ xe">
        <i class="sd-seg__thumb" aria-hidden="true"></i>
        ${SIZES.map((s) => `<button type="button" role="radio" aria-checked="false" tabindex="-1" data-size="${s.id}"><b>${s.name}</b><span>${s.sub}</span></button>`).join('')}
      </div>
      <p class="sd-seg__cars"><span>Ví dụ</span> <b data-cars></b></p>
    </div>
    <div class="sd-tabs" role="tablist" aria-label="Thương hiệu phim">
      ${BRANDS.map((b) => `<button type="button" role="tab" id="sdTab-${b.id}" aria-controls="sdPanel-${b.id}" aria-selected="false" tabindex="-1" data-brand="${b.id}">${b.name}<sup>${b.films.length}</sup></button>`).join('')}
    </div>
    ${BRANDS.map(panel).join('')}`;

  const seg = root.querySelector('.sd-seg');
  const thumb = seg.querySelector('.sd-seg__thumb');
  const sizeBtns = [...seg.querySelectorAll('[data-size]')];
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const cars = root.querySelector('[data-cars]');
  let size = '';

  // prices count over to the new size (each figure remembers what it shows)
  const shown = new Map(), tweens = new Map();
  const showPrice = (el, to, animate) => {
    const from = shown.get(el) ?? to;
    shown.set(el, to);
    tweens.get(el)?.kill();
    if (!animate || from === to || calm.matches) {
      el.innerHTML = priceHtml(to);
      return;
    }
    const o = { v: from };
    tweens.set(el, gsap.to(o, {
      v: to, duration: 0.7, ease: 'power3.out',
      onUpdate: () => { el.innerHTML = priceHtml(Math.round(o.v / 1e5) * 1e5); },
    }));
  };

  const placeThumb = () => {
    const b = sizeBtns.find((x) => x.dataset.size === size);
    if (!b) return;
    thumb.style.width = `${b.offsetWidth}px`;
    thumb.style.transform = `translateX(${b.offsetLeft}px)`;
  };

  const setSize = (id, animate = true) => {
    size = id;
    const s = SIZES.find((x) => x.id === id);
    sizeBtns.forEach((b) => {
      const on = b.dataset.size === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    placeThumb();
    cars.textContent = s.cars;
    root.querySelectorAll('[data-size-name]').forEach((el) => { el.textContent = s.short; });
    root.querySelectorAll('[data-price]').forEach((el) => showPrice(el, +el.dataset[id], animate));
    BRANDS.forEach((b) => showPrice(root.querySelector(`[data-from="${b.id}"]`), Math.min(...b.films.map((f) => f.price[id])), animate));
    if (table) table.dataset.size = id;
  };

  const setBrand = (id, focus = false) => {
    tabs.forEach((t) => {
      const on = t.dataset.brand === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    root.querySelectorAll('.sd-panel').forEach((p) => {
      const on = p.id === `sdPanel-${id}`;
      if (on && p.hidden) {
        p.hidden = false;
        p.classList.remove('is-entering');
        void p.offsetWidth;                  // restart the entrance
        p.classList.add('is-entering');
      } else if (!on) p.hidden = true;
    });
  };

  // arrow keys move along a row of choices (radio group and tab list alike)
  const arrows = (list, pick) => (e) => {
    const i = list.indexOf(e.target);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let j = null;
    if (step) j = (i + step + list.length) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    if (j === null) return;
    e.preventDefault();
    pick(list[j]);
    list[j].focus();
  };
  sizeBtns.forEach((b) => b.addEventListener('click', () => setSize(b.dataset.size)));
  seg.addEventListener('keydown', arrows(sizeBtns, (b) => setSize(b.dataset.size)));
  tabs.forEach((t) => t.addEventListener('click', () => setBrand(t.dataset.brand)));
  root.querySelector('.sd-tabs').addEventListener('keydown', arrows(tabs, (t) => setBrand(t.dataset.brand)));
  new ResizeObserver(placeThumb).observe(seg);

  setBrand(BRANDS[0].id);
  setSize('l', false);
}

// ---------------------------------------------------------------- every film at once
function buildTable(root) {
  const cols = 3 + SIZES.length;
  root.innerHTML = `
    <table class="sd-table">
      <caption class="sd-sr">Giá dán PPF full xe theo mã phim và cỡ xe, đơn vị VNĐ</caption>
      <thead><tr>
        <th scope="col">Mã phim</th><th scope="col">Độ dày</th><th scope="col">Bảo hành</th>
        ${SIZES.map((s) => `<th scope="col" data-col="${s.id}">${s.short}</th>`).join('')}
      </tr></thead>
      ${BRANDS.map((b) => `<tbody>
        <tr class="sd-table__group"><th scope="rowgroup" colspan="${cols}">${b.full}</th></tr>
        ${b.films.map((f) => `<tr>
          <th scope="row">${b.name} ${f.code}</th><td>${f.mil} mil</td><td>${f.years} năm</td>
          ${SIZES.map((s) => `<td data-col="${s.id}">${priceHtml(f.price[s.id])}</td>`).join('')}
        </tr>`).join('')}
      </tbody>`).join('')}
    </table>`;
}

// ---------------------------------------------------------------- blocks ease in once, as they come into view
function reveal() {
  document.querySelectorAll('[data-stagger]').forEach((group) => {
    [...group.children].forEach((c, i) => {
      c.setAttribute('data-reveal', '');
      c.style.setProperty('--d', `${Math.min(i, 8) * 0.07}s`);
    });
  });
  const els = document.querySelectorAll('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('is-in');
    io.unobserve(e.target);
  }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach((el) => io.observe(el));
}
