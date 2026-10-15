/*
 * otpnunu – startpunkt. Kopplar ihop inloggning, data, filter, synk och rendering.
 */
import { createApi, ApiError } from './core/api.js';
import { loadChampions } from './core/ddragon.js';
import { NUNU, QUEUE_FILTERS, filterMatches, summarize, recentForm, byAccount, opponents, masterySummary, careerSummary, damageReport, gankReport, earlyReport, synergyReport, matchupReport, impactReport, eloSeries, overviewKpis, insights, scoutTable, scoutPicks } from './career/stats.js';
import { esc, heroHtml, tilesHtml, formHtml, accountsHtml, opponentsHtml, matchesHtml, careerHtml, damageHtml, gankHtml, earlyHtml, synergyHtml, matchupHtml, impactHtml, eloHtml, kpisHtml, insightsHtml, goldLineHtml, scoutHtml, scoutPickHtml } from './career/view.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const cfg = window.APP_CONFIG || {};
const FILTER_KEY = 'nunu-filters';
const TAB_KEY = 'nunu-tab';
const PICKS_KEY = 'nunu-scout-picks';
const TABS = ['oversikt', 'scout', 'early', 'ganks', 'matchups', 'matcher', 'karriar'];
const PAGE = 20;

const state = {
  profile: null,
  accounts: [],
  matches: [],
  mastery: [],
  history: [],
  deaths: [],
  ranks: [],
  opinions: [],
  tab: 'oversikt',
  scout: { side: 'against', q: '', color: '', sort: 'games', limit: 40 },
  picks: { allies: [null, null, null, null], enemies: [null, null, null, null, null] },
  champs: { name: (id) => `#${id}`, icon: () => null, tags: () => [], all: () => [] },
  filters: { champion: 'nunu', queue: 'rift', account: '' },
  limit: PAGE,
  syncing: false,
  cancelSync: false,
};
try { Object.assign(state.filters, JSON.parse(localStorage.getItem(FILTER_KEY))); } catch (e) { /* ignorera */ }
try { const p = JSON.parse(localStorage.getItem(PICKS_KEY)); if (p && Array.isArray(p.allies) && Array.isArray(p.enemies)) state.picks = p; } catch (e) { /* ignorera */ }
try { const t = localStorage.getItem(TAB_KEY); if (TABS.includes(t)) state.tab = t; } catch (e) { /* ignorera */ }

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
  Object.assign(state, { profile: null, accounts: [], matches: [], mastery: [], history: [], deaths: [], opinions: [] });
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

  // Översikt
  $('[data-kpis]').innerHTML = kpisHtml(overviewKpis(rows));
  $('[data-insights]').innerHTML = insightsHtml(insights(rows), state.champs);
  $('[data-elo]').innerHTML = eloHtml(eloSeries(state.ranks, state.accounts));
  const goldLine = goldLineHtml(earlyReport(rows));
  $('[data-goldline]').innerHTML = goldLine;
  $('[data-goldline-card]').hidden = !goldLine;
  $('[data-recent]').innerHTML = matchesHtml(rows, state.champs, state.accounts, 5).replace(/<button[^>]*data-more[^>]*>[\s\S]*?<\/button>/, '');

  // Flikar
  $$('[data-tabs] [data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== state.tab; });
  $('[data-opponents]').innerHTML = opponentsHtml(opponents(rows), state.champs);
  $('[data-accounts]').innerHTML = accountsHtml(byAccount(accountRows, state.accounts), state.mastery);
  const career = careerHtml(careerSummary(state.history, filterMatches(state.matches, { champion }), { champion }));
  $('[data-career]').innerHTML = career;
  $('[data-career-card]').hidden = !career;
  // Early game-korten: tomma kort döljs
  const card = (name, html) => {
    $(`[data-${name}]`).innerHTML = html;
    $(`[data-${name}-card]`).hidden = !html;
  };
  card('early', earlyHtml(earlyReport(rows)));
  card('impact', impactHtml(impactReport(rows)));
  card('matchup', matchupHtml(matchupReport(rows, { tags: state.champs.tags }), state.champs));
  card('synergy', synergyHtml(synergyReport(rows), state.champs));
  const ganks = gankHtml(gankReport(rows));
  $('[data-ganks]').innerHTML = ganks;
  $('[data-gank-card]').hidden = !ganks;
  const damage = damageHtml(damageReport(rows, state.deaths), state.champs);
  $('[data-damage]').innerHTML = damage;
  $('[data-damage-card]').hidden = !damage;

  renderScout(rows);

  // Filterkontroller
  $$('[data-champion]').forEach((b) => b.classList.toggle('is-active', b.dataset.champion === f.champion));
  $('[data-filter-queue]').innerHTML = Object.entries({ ...QUEUE_FILTERS, all: { label: 'Alla lägen' } })
    .map(([k, q]) => `<button data-queue="${k}" class="${f.queue === k ? 'is-active' : ''}">${q.label}</button>`).join('');
  const sel = $('[data-filter-account]');
  sel.hidden = state.accounts.length < 2;
  sel.innerHTML = `<option value="">Alla konton</option>${state.accounts.map((a) =>
    `<option value="${esc(a.puuid)}" ${a.puuid === f.account ? 'selected' : ''}>${esc(a.game_name)}#${esc(a.tag_line)}</option>`).join('')}`;
}

/** Live Scout: samma filtrerade matcher som resten av sidan (alla köer på Rift som standard). */
function renderScout(rows) {
  const sc = state.scout;
  const table = scoutTable(rows, state.opinions, sc.side);
  $('[data-scout]').innerHTML = scoutHtml(table, state.champs, sc);
  $$('[data-scout-side] button').forEach((b) => b.classList.toggle('is-active', b.dataset.scoutSide === sc.side));
  $('[data-scout-sort]').value = sc.sort;
  const tables = { allies: scoutTable(rows, state.opinions, 'with'), enemies: scoutTable(rows, state.opinions, 'against') };
  for (const team of ['allies', 'enemies']) {
    const t = tables[team];
    const picks = scoutPicks(t, state.picks[team].map((id) => id ?? -1));
    state.picks[team].forEach((id, i) => {
      const key = `${team}:${i}`;
      const input = $(`[data-pick="${key}"]`);
      if (document.activeElement !== input) input.value = id == null ? '' : state.champs.name(id);
      $(`[data-pick-out="${key}"]`).innerHTML = id == null ? '' : scoutPickHtml(picks[i], state.champs, team === 'allies' ? 'with' : 'against', t.baseline);
    });
  }
}

/** Champion från fritext: exakt namn först, annars första som börjar likadant. */
function findChampion(text) {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  const all = state.champs.all ? state.champs.all() : [];
  const hit = all.find((c) => c.name.toLowerCase() === q) || all.find((c) => c.name.toLowerCase().startsWith(q))
    || all.find((c) => c.name.toLowerCase().replace(/[^a-z]/g, '').startsWith(q.replace(/[^a-z]/g, '')));
  return hit ? hit.id : null;
}

function savePicks() {
  try { localStorage.setItem(PICKS_KEY, JSON.stringify(state.picks)); } catch (e) { /* ignorera */ }
}

/** Sparar din bedömning direkt i vyn och sedan i databasen; ångras om det misslyckas. */
async function setOpinion(championId, side, patch) {
  const before = state.opinions;
  const cur = before.find((o) => o.champion_id === championId && o.side === side) || { champion_id: championId, side, opinion: null, note: '' };
  const next = { ...cur, ...patch };
  const empty = next.opinion == null && !next.note;
  state.opinions = before.filter((o) => o !== cur).concat(empty ? [] : [next]);
  render();
  try {
    if (empty) await api.deleteOpinion(championId, side);
    else await api.saveOpinion({ profile_id: state.profile.id, champion_id: championId, side, opinion: next.opinion, note: next.note });
  } catch (err) {
    state.opinions = before;
    render();
    fail(err.status === 404 || /champion_opinion/.test(err.message) ? new ApiError(0, 'Kör 008_scout.sql i Supabase för att kunna spara bedömningar') : err);
  }
}

async function reload() {
  const [accounts, matches, mastery, history, deaths, ranks, opinions] = await Promise.all([
    api.accounts(), api.matches(), api.mastery(),
    api.seasonHistory().catch(() => []),  // 002_season_history.sql är valfri
    api.deaths().catch(() => []),         // 003_timelines.sql är valfri
    api.ranks().catch(() => []),          // 007_rank.sql är valfri
    api.opinions().catch(() => []),       // 008_scout.sql är valfri
  ]);
  Object.assign(state, { accounts, matches, mastery, history, deaths, ranks, opinions });
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
    const t = e.target.closest('[data-action],[data-champion],[data-queue],[data-unlink],[data-more],[data-tab],[data-opinion],[data-scout-side],[data-scout-color],[data-scout-more]');
    if (!t) return;
    if (t.dataset.opinion) {
      const id = Number(t.dataset.champ);
      const value = Number(t.dataset.opinion);
      const cur = state.opinions.find((o) => o.champion_id === id && o.side === t.dataset.side);
      return setOpinion(id, t.dataset.side, { opinion: cur && cur.opinion === value ? null : value });
    }
    if (t.dataset.scoutSide) { Object.assign(state.scout, { side: t.dataset.scoutSide, limit: 40 }); return render(); }
    if (t.dataset.scoutColor !== undefined) { Object.assign(state.scout, { color: t.dataset.scoutColor, limit: 40 }); return render(); }
    if (t.hasAttribute('data-scout-more')) { state.scout.limit += 40; return render(); }
    if (t.dataset.tab) {
      state.tab = t.dataset.tab;
      try { localStorage.setItem(TAB_KEY, state.tab); } catch (err) { /* ignorera */ }
      render();
      $('[data-tabs]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
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
      case 'clear-picks':
        state.picks = { allies: [null, null, null, null], enemies: [null, null, null, null, null] };
        savePicks();
        render();
        break;
      case 'logout': await api.signOut(); showLogin(); break;
    }
  });

  $('[data-filter-account]').addEventListener('change', (e) => { state.filters.account = e.target.value; saveFilters(); });

  // Live Scout
  $('[data-scout-search]').addEventListener('input', (e) => { Object.assign(state.scout, { q: e.target.value, limit: 40 }); render(); });
  $('[data-scout-sort]').addEventListener('change', (e) => { state.scout.sort = e.target.value; render(); });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-note]')) {
      const id = Number(el.dataset.champ);
      const cur = state.opinions.find((o) => o.champion_id === id && o.side === el.dataset.side);
      if ((cur ? cur.note || '' : '') !== el.value.trim()) setOpinion(id, el.dataset.side, { note: el.value.trim() });
    }
    if (el.matches('[data-pick]')) {
      const [team, i] = el.dataset.pick.split(':');
      const id = findChampion(el.value);
      if (el.value.trim() && id == null) toast(`Hittar ingen champion som heter ”${el.value.trim()}”`);
      state.picks[team][Number(i)] = id;
      savePicks();
      render();
    }
  });

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
    loadChampions({ base: cfg.DDRAGON_URL || undefined }).then((c) => {
      state.champs = c;
      $('[data-scout-champs]').innerHTML = c.all().map((x) => `<option value="${esc(x.name)}"></option>`).join('');
      render();
    });
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
