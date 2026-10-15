/*
 * otpnunu – motion graph i Översikt. Skin-bilderna tonar över i varandra och linjen ritas upp
 * för ett nyckeltal i taget (vinst %, kills, KDA, guld vid 10 min). Data från trendSeries.
 * Rör sig inte om användaren valt minskad rörelse; går alltid att pausa.
 */
import { esc } from './view.js';

const SKINS = ['assets/skins/nunu-bee.jpg', 'assets/skins/nunu-bot.jpg', 'assets/skins/nunu-vinter.jpg', 'assets/skins/nunu-skog.jpg'];
const CHAPTERS = [
  { key: 'winrate', title: 'Vinst', unit: ' %', digits: 0, ref: 50, refLabel: '50 %' },
  { key: 'kills', title: 'Kills per match', unit: '', digits: 1 },
  { key: 'kda', title: 'KDA', unit: '', digits: 2 },
  { key: 'goldDiff10', title: 'Guld vid 10 min', unit: '', digits: 0, ref: 0, refLabel: 'lika', signed: true, sub: 'mot motståndarens jungler' },
];
const STEP_MS = 7000;
const W = 600;
const H = 200;
const PAD = { top: 14, bottom: 14 };

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (v, c) => {
  if (v == null) return '–';
  const body = Math.abs(v).toLocaleString('sv-SE', { minimumFractionDigits: c.digits, maximumFractionDigits: c.digits });
  return `${c.signed ? (v > 0 ? '+' : v < 0 ? '−' : '±') : v < 0 ? '−' : ''}${body}${c.unit}`;
};
const games = (n) => `${n} ${n === 1 ? 'match' : 'matcher'}`;
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Skala och linje för ett kapitel. x = matchens ordning, y = värdet. */
function geometry(points, c) {
  const vs = points.map((p) => p.v).concat(c.ref == null ? [] : [c.ref]);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const i0 = points[0].i;
  const span = Math.max(1, points[points.length - 1].i - i0);
  const x = (p) => ((p.i - i0) / span) * W;
  const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const line = points.map((p, k) => `${k ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(points[points.length - 1]).toFixed(1)},${H}L0,${H}Z`;
  return { x, y, line, area, refY: c.ref == null ? null : y(c.ref) };
}

/**
 * Sätter upp eller uppdaterar kortet. Samma data (key) startar inte om animationen,
 * så vanliga omritningar (sök, flikbyte) stör inte.
 */
export function mountMotion(root, trend, key) {
  if (!root) return;
  const chapters = CHAPTERS.filter((c) => trend.series[c.key] && trend.series[c.key].length >= 2);
  const card = root.closest('[data-motion-card]');
  if (card) card.hidden = !chapters.length;
  if (!chapters.length) { stop(root); root.innerHTML = ''; root.dataset.key = ''; return; }
  if (root.dataset.key === key) return;
  stop(root);
  root.dataset.key = key;

  root.innerHTML = `
    <div class="motion__stage">
      ${SKINS.map((src, k) => `<div class="motion__skin" data-skin="${k}" style="background-image:url('${src}')"></div>`).join('')}
      <div class="motion__shade"></div>
      <div class="motion__text">
        <p class="eyebrow motion__eyebrow" data-m-eyebrow></p>
        <p class="motion__value" data-m-value aria-live="polite"></p>
        <p class="motion__sub" data-m-sub></p>
      </div>
      <div class="motion__chart" data-m-chart>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="motion-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#8fd3ff" stop-opacity=".38"></stop><stop offset="1" stop-color="#8fd3ff" stop-opacity="0"></stop>
          </linearGradient></defs>
          <line class="motion__ref" data-m-ref x1="0" x2="${W}"></line>
          <path class="motion__area" data-m-area fill="url(#motion-fill)"></path>
          <path class="motion__line" data-m-line pathLength="1"></path>
          <line class="motion__cross" data-m-cross y1="0" y2="${H}" hidden></line>
        </svg>
        <span class="motion__dot" data-m-dot></span>
        <span class="motion__reflabel" data-m-reflabel></span>
        <div class="motion__tip" data-m-tip hidden></div>
      </div>
      <div class="motion__nav">
        <button type="button" class="motion__play" data-m-play aria-label="Pausa"></button>
        ${chapters.map((c, k) => `<button type="button" class="motion__step" data-m-step="${k}" aria-label="${esc(c.title)}"><i></i><span>${esc(c.title)}</span></button>`).join('')}
      </div>
    </div>
    <table class="sr-only"><caption>Rullande snitt över ${trend.window} matcher</caption>
      <thead><tr><th scope="col">Nyckeltal</th><th scope="col">Totalt</th><th scope="col">Senaste</th><th scope="col">Matcher</th></tr></thead>
      <tbody>${chapters.map((c) => {
        const s = trend.series[c.key];
        return `<tr><th scope="row">${esc(c.title)}</th><td>${fmt(trend.totals[c.key], c)}</td><td>${fmt(s[s.length - 1].v, c)}</td><td>${trend.n[c.key]}</td></tr>`;
      }).join('')}</tbody></table>`;

  const $ = (s) => root.querySelector(s);
  const st = { k: 0, playing: !reduced(), timer: null, raf: null, geo: null, points: null, chapter: null };
  root._motion = st;

  function countUp(el, to, c) {
    cancelAnimationFrame(st.raf);
    if (to == null || reduced()) { el.textContent = fmt(to, c); return; }
    const t0 = performance.now();
    const from = c.ref ?? 0;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 1100);
      const e = 1 - (1 - p) ** 3;
      el.textContent = fmt(from + (to - from) * e, c);
      if (p < 1) st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
  }

  function show(k) {
    st.k = k;
    const c = chapters[k];
    const points = trend.series[c.key];
    const geo = geometry(points, c);
    Object.assign(st, { geo, points, chapter: c });
    root.querySelectorAll('[data-skin]').forEach((el) => el.classList.toggle('is-on', Number(el.dataset.skin) === k % SKINS.length));
    root.querySelectorAll('[data-m-step]').forEach((el) => {
      el.classList.toggle('is-on', Number(el.dataset.mStep) === k);
      el.setAttribute('aria-current', Number(el.dataset.mStep) === k ? 'true' : 'false');
    });
    $('[data-m-eyebrow]').textContent = `${c.title}${c.sub ? ` · ${c.sub}` : ''}`;
    countUp($('[data-m-value]'), trend.totals[c.key], c);
    const last = points[points.length - 1];
    $('[data-m-sub]').textContent = `Totalt · ${games(trend.n[c.key])} · senaste ${trend.window}: ${fmt(last.v, c)}`;
    const line = $('[data-m-line]');
    line.setAttribute('d', geo.line);
    $('[data-m-area]').setAttribute('d', geo.area);
    const ref = $('[data-m-ref]');
    const refLabel = $('[data-m-reflabel]');
    ref.toggleAttribute('hidden', geo.refY == null);
    refLabel.hidden = geo.refY == null;
    if (geo.refY != null) {
      ref.setAttribute('y1', geo.refY); ref.setAttribute('y2', geo.refY);
      refLabel.textContent = c.refLabel;
      refLabel.style.top = `${(geo.refY / H) * 100}%`;
    }
    const dot = $('[data-m-dot]');
    dot.style.left = `${(geo.x(last) / W) * 100}%`;
    dot.style.top = `${(geo.y(last.v) / H) * 100}%`;
    // Starta om uppritningen
    const chart = $('[data-m-chart]');
    chart.classList.remove('is-drawing');
    void chart.offsetWidth;
    if (!reduced()) chart.classList.add('is-drawing');
  }

  function schedule() {
    clearTimeout(st.timer);
    const btn = $('[data-m-play]');
    btn.classList.toggle('is-paused', !st.playing);
    btn.setAttribute('aria-label', st.playing ? 'Pausa' : 'Spela');
    root.classList.toggle('is-paused', !st.playing);
    if (st.playing && chapters.length > 1) st.timer = setTimeout(() => { show((st.k + 1) % chapters.length); schedule(); }, STEP_MS);
  }

  root.querySelector('.motion__nav').addEventListener('click', (e) => {
    const step = e.target.closest('[data-m-step]');
    if (step) { show(Number(step.dataset.mStep)); schedule(); return; }
    if (e.target.closest('[data-m-play]')) { st.playing = !st.playing; schedule(); }
  });

  // Hover/touch: värdet för närmaste match
  const chartEl = $('[data-m-chart]');
  chartEl.addEventListener('pointermove', (e) => {
    if (!st.geo) return;
    const box = chartEl.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * W;
    let best = st.points[0];
    for (const p of st.points) if (Math.abs(st.geo.x(p) - fx) < Math.abs(st.geo.x(best) - fx)) best = p;
    const cx = st.geo.x(best);
    const cross = $('[data-m-cross]');
    cross.hidden = false; cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
    const tip = $('[data-m-tip]');
    tip.hidden = false;
    tip.innerHTML = `<b>${fmt(best.v, st.chapter)}</b><span>${esc(date(best.t))} · snitt av ${games(best.n)}</span>`;
    tip.style.left = `${(cx / W) * 100}%`;
    tip.classList.toggle('is-left', cx > W * 0.6);
  });
  chartEl.addEventListener('pointerleave', () => { $('[data-m-tip]').hidden = true; $('[data-m-cross]').hidden = true; });

  show(0);
  schedule();
}

function stop(root) {
  const st = root._motion;
  if (!st) return;
  clearTimeout(st.timer);
  cancelAnimationFrame(st.raf);
  root._motion = null;
}
