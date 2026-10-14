/*
 * Nunu Career – startpunkt. Kopplar ihop inloggning, data, filter, synk och rendering.
 */
import { createApi, ApiError } from './core/api.js';
import { loadChampions } from './core/ddragon.js';
import { NUNU, QUEUE_FILTERS, filterMatches, summarize, recentForm, byAccount, opponents, masterySummary } from './career/stats.js';
import { esc, heroHtml, tilesHtml, formHtml, accountsHtml, opponentsHtml, matchesHtml } from './career/view.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const cfg = window.APP_CONFIG || {};
const FILTER_KEY = 'nunu-filters';
const PAGE = 20;

const state = {
  profile: null,
  accounts: [],
  matches: [],
  mastery: [],
  champs: { name: (id) => `#${id}`, icon: () => null },
  filters: { champion: 'nunu', queue: 'rift', account: '' },
  limit: PAGE,
  syncing: false,
  cancelSync: false,
};
try { Object.assign(state.filters, JSON.parse(localStorage.getItem(FILTER_KEY))); } catch (e) { /* ignorera */ }

let api;

/* ---------------- Hjälpare ---------------- */

let toastTimer;
function toast(msg) {
  const el = $('[data-toast]');
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
}

function fail(err) {
  // Förväntade fel (fel Riot ID, ingen åtkomst …) visas bara för användaren
  if (!(err instanceof ApiError) || err.status >= 500 || !err.status) console.error(err);
  if (err instanceof ApiError && err.status === 401) { showLogin('Du har loggats ut – logga in igen'); return; }
  toast(navigator.onLine === false ? 'Ingen internetanslutning' : err.message || 'Något gick fel');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Vyer ---------------- */

function show(view) {
  document.body.classList.toggle('is-locked', view !== 'app');
  $('[data-login]').hidden = view !== 'login';
  $('[data-denied]').hidden = view !== 'denied';
  $('[data-app]').hidden = view !== 'app';
}

function showLogin(message) {
  Object.assign(state, { profile: null, accounts: [], matches: [], mastery: [] });
  show('login');
  const err = $('[data-login-error]');
  err.textContent = message || '';
  err.hidden = !message;
  $('[data-login-form] [name=password]').value = '';
}

/* ---------------- Rendering ---------------- */

function render() {
  const f = state.filters;
  const champion = f.champion === 'nunu' ? NUNU : null;
  const queues = QUEUE_FILTERS[f.queue] ? QUEUE_FILTERS[f.queue].queues : null;
  const rows = filterMatches(state.matches, { champion, queues, puuid: f.account || null });
  const accountRows = filterMatches(state.matches, { champion, queues });

  const first = state.accounts[0];
  $('[data-profile-name]').textContent = (state.profile && state.profile.display_name)
    || (first ? `${first.game_name}#${first.tag_line}` : 'Välkommen');
  $('[data-user-email]').textContent = api.email;
  $('[data-action="sync"]').disabled = !state.accounts.length || state.syncing;

  const mastery = masterySummary(f.account ? state.mastery.filter((m) => m.puuid === f.account) : state.mastery);
  $('[data-hero]').innerHTML = heroHtml(mastery, state.accounts);
  $('[data-tiles]').innerHTML = tilesHtml(summarize(rows));
  $('[data-form]').innerHTML = formHtml(recentForm(rows));
  $('[data-matches]').innerHTML = matchesHtml(rows, state.champs, state.accounts, state.limit);
  $('[data-opponents]').innerHTML = opponentsHtml(opponents(rows), state.champs);
  $('[data-accounts]').innerHTML = accountsHtml(byAccount(accountRows, state.accounts), state.mastery);

  // Filterkontroller
  $$('[data-champion]').forEach((b) => b.classList.toggle('is-active', b.dataset.champion === f.champion));
  $('[data-filter-queue]').innerHTML = Object.entries({ ...QUEUE_FILTERS, all: { label: 'Alla lägen' } })
    .map(([k, q]) => `<button data-queue="${k}" class="${f.queue === k ? 'is-active' : ''}">${q.label}</button>`).join('');
  const sel = $('[data-filter-account]');
  sel.hidden = state.accounts.length < 2;
  sel.innerHTML = `<option value="">Alla konton</option>${state.accounts.map((a) =>
    `<option value="${esc(a.puuid)}" ${a.puuid === f.account ? 'selected' : ''}>${esc(a.game_name)}#${esc(a.tag_line)}</option>`).join('')}`;
}

async function reload() {
  const [accounts, matches, mastery] = await Promise.all([api.accounts(), api.matches(), api.mastery()]);
  Object.assign(state, { accounts, matches, mastery });
  if (state.filters.account && !accounts.some((a) => a.puuid === state.filters.account)) state.filters.account = '';
  render();
}

/* ---------------- Synk ---------------- */

function syncStatus({ title, detail, progress, waiting = false }) {
  const box = $('[data-sync]');
  box.hidden = false;
  box.classList.toggle('is-waiting', waiting);
  $('[data-sync-title]').textContent = title;
  $('[data-sync-detail]').textContent = detail || '';
  $('[data-sync-bar]').style.width = `${Math.round((progress || 0) * 100)}%`;
}

async function sync() {
  if (state.syncing) return;
  state.syncing = true;
  state.cancelSync = false;
  render();
  let imported = 0;
  try {
    syncStatus({ title: 'Synkar…', detail: 'Hämtar från Riot', progress: 0.02 });
    while (!state.cancelSync) {
      const r = await api.riot({ action: 'sync' });
      imported += r.results.reduce((s, x) => s + x.imported, 0);
      const remaining = r.results.reduce((s, x) => s + x.remaining, 0);
      await reload();
      const progress = imported / Math.max(1, imported + remaining);
      if (r.done) break;
      if (r.retryAfter) {
        // Riots gräns: vänta och fortsätt automatiskt
        for (let s = r.retryAfter; s > 0 && !state.cancelSync; s--) {
          syncStatus({ title: `Hämtat ${imported} matcher`, detail: `${remaining} kvar · Riot begränsar takten – fortsätter om ${s} s`, progress, waiting: true });
          await sleep(1000);
        }
      } else {
        syncStatus({ title: `Hämtat ${imported} matcher`, detail: `${remaining} kvar`, progress });
      }
    }
    toast(state.cancelSync ? `Synk avbruten – ${imported} matcher hämtade` : imported ? `Klart! ${imported} nya matcher` : 'Allt är redan uppdaterat');
  } catch (err) {
    fail(err);
  } finally {
    state.syncing = false;
    $('[data-sync]').hidden = true;
    render();
  }
}

/* ---------------- Händelser ---------------- */

function saveFilters() {
  state.limit = PAGE;
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(state.filters)); } catch (e) { /* ignorera */ }
  render();
}

function bind() {
  $('[data-login-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await api.signIn(form.elements.email.value, form.elements.password.value);
      $('[data-login-error]').hidden = true;
      await start();
    } catch (err) {
      const el = $('[data-login-error]');
      el.textContent = err.message;
      el.hidden = false;
    }
    btn.disabled = false;
  });

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action],[data-champion],[data-queue],[data-unlink],[data-more]');
    if (!t) return;
    if (t.dataset.champion) { state.filters.champion = t.dataset.champion; return saveFilters(); }
    if (t.dataset.queue) { state.filters.queue = t.dataset.queue; return saveFilters(); }
    if (t.hasAttribute('data-more')) { state.limit += PAGE; return render(); }
    if (t.dataset.unlink) {
      if (!confirm(`Koppla bort ${t.dataset.name}? Matcherna för kontot tas bort från din statistik.`)) return;
      try { await api.unlinkAccount(t.dataset.unlink); await reload(); toast('Kontot är bortkopplat'); } catch (err) { fail(err); }
      return;
    }
    switch (t.dataset.action) {
      case 'sync': sync(); break;
      case 'cancel-sync': state.cancelSync = true; break;
      case 'logout': await api.signOut(); showLogin(); break;
    }
  });

  $('[data-filter-account]').addEventListener('change', (e) => { state.filters.account = e.target.value; saveFilters(); });

  $('[data-link-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const { account } = await api.riot({ action: 'link', riotId: form.elements.riotId.value, platform: form.elements.platform.value });
      form.elements.riotId.value = '';
      await reload();
      toast(account.already_linked ? 'Kontot var redan kopplat' : `${account.game_name}#${account.tag_line} kopplat – hämtar historiken`);
      if (!account.already_linked) sync();
    } catch (err) {
      fail(err);
    }
    btn.disabled = false;
  });
}

/* ---------------- Start ---------------- */

async function start() {
  try {
    if (!(await api.isMember())) { show('denied'); return; }
    state.profile = await api.profile();
    show('app');
    await reload();
    loadChampions({ base: cfg.DDRAGON_URL || undefined }).then((c) => { state.champs = c; render(); });
  } catch (err) {
    fail(err);
  }
}

try {
  api = createApi({ url: cfg.SUPABASE_URL, key: cfg.SUPABASE_KEY || cfg.SUPABASE_ANON_KEY });
} catch (err) {
  document.body.innerHTML = `<p style="padding:24px">${err.message}</p>`;
  throw err;
}
bind();
if (api.isLoggedIn()) start(); else showLogin();
