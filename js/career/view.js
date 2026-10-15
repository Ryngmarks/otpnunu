/*
 * otpnunu – rendering. Funktioner som tar data och returnerar HTML.
 * Allt som kommer utifrån (namn, Riot ID) escapas.
 */
import { queueLabel, eloTicks, SCOUT } from './stats.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (n == null ? '–' : Number(n).toLocaleString('sv-SE'));
const dash = (v, suffix = '') => (v == null ? '–' : `${String(v).replace('.', ',')}${suffix}`);

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return 'aldrig';
  const sec = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat('sv', { numeric: 'auto' });
  const units = [['year', 31557600], ['month', 2629800], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (Math.abs(sec) >= size) return rtf.format(Math.round(sec / size), unit);
  }
  return 'nyss';
}

const shortDate = (iso) => new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });

function champIcon(champs, id, cls = '') {
  const src = champs.icon(id);
  const name = esc(champs.name(id));
  return src
    ? `<img class="champ ${cls}" src="${esc(src)}" alt="${name}" title="${name}" loading="lazy" width="40" height="40">`
    : `<span class="champ champ--empty ${cls}" title="${name}">${name.slice(0, 2)}</span>`;
}

export function heroHtml(mastery, accounts) {
  const multi = mastery.perAccount.length > 1;
  return `
    <div class="hero__mastery">
      <div class="level" title="Mastery-nivå"><span>${mastery.level || '–'}</span><small>Nivå</small></div>
      <div>
        <p class="eyebrow">Mastery · Nunu &amp; Willump${multi ? ' · alla konton' : ''}</p>
        <p class="hero__points">${num(mastery.points)} <small>poäng</small></p>
        <p class="muted">${mastery.lastPlayed ? `Senast spelad ${esc(shortDate(mastery.lastPlayed))}` : accounts.length ? 'Synka för att hämta mastery' : 'Koppla ett konto för att komma igång'}</p>
      </div>
    </div>`;
}

export function tilesHtml(s) {
  const tile = (value, label, extra = '') => `<div class="tile ${extra}"><b>${value}</b><span>${label}</span></div>`;
  return [
    tile(num(s.games), 'Matcher'),
    tile(dash(s.winrate, '%'), `Vinst · ${num(s.wins)}V ${num(s.losses)}F`, s.winrate == null ? '' : s.winrate >= 50 ? 'tile--good' : 'tile--bad'),
    tile(dash(s.kda), `KDA · ${dash(s.kills)}/${dash(s.deaths)}/${dash(s.assists)}`),
    tile(dash(s.csPerMin), 'CS/min'),
    tile(dash(s.goldPerMin), 'Guld/min'),
    tile(s.avgMinutes == null ? '–' : s.avgMinutes, 'Minuter per match'),
  ].join('');
}

export function formHtml(form) {
  if (!form.length) return '';
  return `<span class="eyebrow">Senaste ${form.length}</span>${form.map((r) => `<i class="dot dot--${r}" title="${r === 'W' ? 'Vinst' : 'Förlust'}"></i>`).join('')}`;
}

export function accountsHtml(rows, mastery) {
  if (!rows.length) {
    return '<p class="empty">Inga konton kopplade än. Lägg till ditt Riot ID nedan – sedan hämtas hela historiken.</p>';
  }
  return `<ul class="accounts">${rows.map(({ account: a, games, winrate }) => {
    const m = mastery.find((x) => x.puuid === a.puuid && x.champion_id === 20);
    return `
      <li class="account">
        <div class="account__main">
          <strong>${esc(a.game_name)}<span>#${esc(a.tag_line)}</span></strong>
          <small>${esc(a.platform.toUpperCase())} · synkad ${esc(timeAgo(a.last_synced_at))}${a.backfill_done ? '' : a.last_synced_at ? ' · historik hämtas' : ''}</small>
        </div>
        <div class="account__stats">
          <span><b>${num(games)}</b> matcher</span>
          <span><b>${winrate == null ? '–' : winrate + '%'}</b> vinst</span>
          <span><b>${m ? num(m.points) : '–'}</b> mastery</span>
        </div>
        <button class="icon-btn" data-unlink="${esc(a.puuid)}" data-name="${esc(a.game_name)}#${esc(a.tag_line)}" aria-label="Koppla bort ${esc(a.game_name)}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </li>`;
  }).join('')}</ul>`;
}

export function opponentsHtml(list, champs) {
  if (!list.length) return '<p class="empty">För få matcher för att visa motståndare.</p>';
  return `<ul class="opponents">${list.map((o) => `
    <li>
      ${champIcon(champs, o.championId)}
      <span class="opponents__name">${esc(champs.name(o.championId))}</span>
      <span class="opponents__games">${o.games} st</span>
      <span class="wr ${o.winrate >= 50 ? 'wr--good' : 'wr--bad'}">${o.winrate}%</span>
    </li>`).join('')}</ul>`;
}

export function matchesHtml(rows, champs, accounts, limit) {
  if (!rows.length) return '<p class="empty">Inga matcher med de här filtren.</p>';
  const multi = accounts.length > 1;
  const nameOf = (puuid) => {
    const a = accounts.find((x) => x.puuid === puuid);
    return a ? a.game_name : '';
  };
  return `<ul class="matches">${rows.slice(0, limit).map((r) => {
    const min = r.duration_s / 60;
    return `
      <li class="match match--${r.win ? 'win' : 'loss'}">
        ${champIcon(champs, r.champion_id, 'champ--lg')}
        <div class="match__main">
          <strong>${r.win ? 'Vinst' : 'Förlust'} <span class="muted">· ${esc(queueLabel(r.queue_id))}</span></strong>
          <small>${esc(shortDate(r.game_start))} · ${Math.round(min)} min${multi ? ` · ${esc(nameOf(r.puuid))}` : ''}</small>
        </div>
        <div class="match__kda"><b>${r.kills}/${r.deaths}/${r.assists}</b><small>${r.cs} CS · ${(r.cs / Math.max(1, min)).toFixed(1).replace('.', ',')}/min</small></div>
        ${r.opponent_champion_id ? `<div class="match__vs"><small>mot</small>${champIcon(champs, r.opponent_champion_id)}</div>` : '<div class="match__vs"></div>'}
      </li>`;
  }).join('')}</ul>
  ${rows.length > limit ? `<button class="btn btn--ghost btn--block" data-more>Visa fler (${rows.length - limit} till)</button>` : ''}`;
}

/** Hela karriären: en rad per äldre säsong, synkade matcher och totalen. Tomt om inga äldre säsonger finns. */
export function careerHtml(c) {
  if (!c.seasons.length) return '';
  const wr = (s) => (s.winrate == null ? '–' : `<span class="wr ${s.winrate >= 50 ? 'wr--good' : 'wr--bad'}">${s.winrate}%</span>`);
  const row = (label, s, cls = '') => `
    <tr class="${cls}">
      <th scope="row">${label}</th>
      <td>${num(s.games)}</td>
      <td>${num(s.wins)}–${num(s.losses)}</td>
      <td>${wr(s)}</td>
      <td>${dash(s.kda)}</td>
    </tr>`;
  const since = c.recent.since ? `Sedan ${esc(new Date(c.recent.since).toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' }))}` : 'Synkat från Riot';
  const cols = [...c.seasons.map((s) => ({ ...s, label: s.season })), ...(c.recent.games ? [{ ...c.recent, label: since.replace('Sedan ', '') }] : [])];
  // Höjd: 30 % vinst = tom stapel, 70 % = full; 50 % ligger på mittlinjen
  const height = (wr) => Math.max(2, Math.min(100, ((wr - 30) / 40) * 100));
  return `
    <div class="seasonbars" role="img" aria-label="Vinst per säsong: ${esc(cols.map((s) => `${s.label} ${s.winrate} %`).join(', '))}">
      <i class="seasonbars__mid" aria-hidden="true"><span>50 %</span></i>
      ${cols.map((s) => `
        <div class="seasonbars__col" title="${esc(`${s.label}: ${s.winrate} % på ${s.games} matcher`)}">
          <span class="seasonbars__wr">${s.winrate}%</span>
          <i class="${s.winrate >= 50 ? 'is-good' : 'is-bad'}" style="height:${height(s.winrate)}%"></i>
        </div>`).join('')}
    </div>
    <div class="seasonbars__labels">${cols.map((s) => `<span>${esc(s.label)}<small>${num(s.games)}</small></span>`).join('')}</div>
    <table class="career">
      <thead><tr><th scope="col">Säsong</th><th scope="col">Matcher</th><th scope="col">V–F</th><th scope="col">Vinst</th><th scope="col">KDA</th></tr></thead>
      <tbody>
        ${c.seasons.map((s) => row(esc(s.season), s)).join('')}
        ${c.recent.games ? row(since, c.recent) : ''}
      </tbody>
      <tfoot>${row('Totalt', c.total, 'career__total')}</tfoot>
    </table>`;
}

/** Skada och dödsfall (damageReport). Tomt om inga matcher har tidslinje. */
export function damageHtml(rep, champs) {
  if (!rep) return '';
  const fmt = (v, k) => (k === 'deaths' ? dash(v) : num(v));
  const row = (label, k, suffix = '') => `
    <tr><th scope="row">${label}</th>
      <td>${rep.win[k] == null ? '–' : `${fmt(rep.win[k], k)}${suffix}`}</td>
      <td>${rep.loss[k] == null ? '–' : `${fmt(rep.loss[k], k)}${suffix}`}</td></tr>`;
  const d = rep.deaths;
  const max = Math.max(1, ...d.byWindow.map((w) => w.count));
  const placeLabels = { camp: 'vid camp', objective: 'vid objective', torn: 'under torn', 'våg': 'vid våg' };
  return `
    <table class="career damage">
      <thead><tr><th scope="col">${rep.games} matcher</th><th scope="col">Vinster (${rep.win.games})</th><th scope="col">Förluster (${rep.loss.games})</th></tr></thead>
      <tbody>
        ${row('Skada per minut', 'perMin')}
        ${row('Skada vid 10 min', 'at10')}
        ${row('Skada vid 14 min', 'at14')}
        ${row('Andel av lagets skada', 'share', ' %')}
        ${row('Dödsfall per match', 'deaths')}
      </tbody>
    </table>

    <h3 class="sub">Dödsfall · ${dash(d.perGame)} per match · ${dash(d.before15)} före 15 min</h3>
    <div class="bars" role="img" aria-label="Dödsfall per tidsintervall">
      ${d.byWindow.map((w) => `
        <div class="bars__col" title="${w.count} dödsfall ${w.label} min">
          <span class="bars__n">${w.count}</span>
          <i style="height:${Math.round((w.count / max) * 100)}%"></i>
          <small>${w.label}</small>
        </div>`).join('')}
    </div>
    <h3 class="sub">Var du dör</h3>
    <ul class="placebars">${[...Object.entries(d.places).map(([k, n]) => [placeLabels[k], n]), ['ensam 1 mot 1', d.solo]].map(([label, n]) => {
      const share = d.total ? Math.round((n / d.total) * 100) : 0;
      return `<li><span>${label}</span><span class="placebars__track"><i style="width:${share}%"></i></span><b>${share}%</b></li>`;
    }).join('')}</ul>
    <p class="legend"><span>Andel av alla ${d.total} dödsfall · en död kan ha flera platser (t.ex. camp och torn)</span></p>

    ${d.killers.length ? `
    <h3 class="sub">Med när du dör</h3>
    <ul class="opponents">${d.killers.map((k) => `
      <li>
        ${k.championId == null ? '<span class="champ champ--empty" title="Torn eller minion">T</span>' : champIcon(champs, k.championId)}
        <span class="opponents__name">${k.championId == null ? 'Torn/minion' : esc(champs.name(k.championId))}</span>
        <span class="opponents__games">${k.involved} ggr</span>
        <span class="wr wr--bad" title="dödade dig">${k.killed}</span>
      </li>`).join('')}</ul>` : ''}`;
}

/* ---------------- Ganks ---------------- */

const LANE_NAMES = { top: 'Top', mid: 'Mid', bot: 'Bot' };
const clock = (ms) => (ms == null ? '–' : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`);
const wrCell = (w) => (w.games ? `<span class="wr ${w.winrate >= 50 ? 'wr--good' : 'wr--bad'}">${w.winrate}%</span> <small class="muted">(${w.games})</small>` : '–');

/** Gank-kortet (gankReport). Tomt om inga matcher har ganks uträknade. */
export function gankHtml(rep) {
  if (!rep) return '';
  const tile = (value, label, extra = '') => `<div class="tile ${extra}"><b>${value}</b><span>${label}</span></div>`;
  return `
    <div class="tiles tiles--inner">
      ${tile(dash(rep.perGame), `Ganks per match · ${rep.ganks} st`)}
      ${tile(rep.success == null ? '–' : `${rep.success}%`, `Lyckade · ${rep.trades} byten`, rep.success == null ? '' : rep.success >= 60 ? 'tile--good' : 'tile--bad')}
      ${tile(clock(rep.first.median), 'Första ganken (median)')}
      ${tile(num(rep.takedowns), `Takedowns i ganks · ${rep.vsJungler} mot jungler`)}
    </div>

    <h3 class="sub">Per lane</h3>
    <ul class="lanebars">${rep.lanes.map((l) => {
      const ok = l.ganks ? Math.round(((l.ganks - l.trades) / l.ganks) * 100) : 0;
      const max = Math.max(1, ...rep.lanes.map((x) => x.ganks));
      return `
      <li>
        <span class="lanebars__name">${LANE_NAMES[l.lane]}</span>
        <span class="lanebars__track" style="width:${Math.max(4, (l.ganks / max) * 100)}%" title="${l.ganks} ganks: ${l.ganks - l.trades} lyckade, ${l.trades} byten">
          <i class="is-good" style="width:${ok}%"></i><i class="is-bad" style="width:${100 - ok}%"></i>
        </span>
        <span class="lanebars__value">${l.ganks} <small>· ${l.success == null ? '–' : `${l.success}%`} lyckade</small></span>
        <span class="lanebars__first">Första ganken här ${l.firstShare == null ? '–' : `${l.firstShare}%`} av matcherna · vinst då ${wrCell(l.firstWin)}</span>
      </li>`;
    }).join('')}</ul>
    <p class="legend"><span><i class="sw is-win"></i>Lyckad</span><span><i class="sw is-loss"></i>Byte (du dog)</span><span>Längd = antal ganks</span></p>

    <h3 class="sub">När första ganken sker</h3>
    ${(() => {
      const max = Math.max(1, ...rep.firstBins.map((b) => b.count));
      return `<div class="histo" role="img" aria-label="Första ganken per minut: ${esc(rep.firstBins.map((b) => `${b.label} min ${b.count}`).join(', '))}">${rep.firstBins.map((b) => `
        <div class="histo__col"><span>${b.count}</span><i class="${b.hasMedian ? 'is-median' : ''}" style="height:${(b.count / max) * 100}%"></i><small>${b.label}</small></div>`).join('')}</div>
        <p class="legend"><span>Minuter in i matchen · ljusare stapel = där medianen (${clock(rep.first.median)}) ligger</span></p>`;
    })()}

    <h3 class="sub">Första ganken och vinst</h3>
    ${barRows([
      { label: 'Lyckad (överlevde)', ...rep.first.lyckad },
      { label: 'Byte (dog själv)', ...rep.first.byte },
      { label: 'Ingen gank före 15:00', ...rep.first.ingen },
    ])}

    <h3 class="sub">Antal ganks före 15:00 och vinst</h3>
    ${barRows(rep.byCount.map((c) => ({ ...c, label: `${c.label} ${c.label === '1' ? 'gank' : 'ganks'}` })))}
    <p class="card__hint card__hint--after">Gank = kill eller assist i en lane före 15:00. Kills i lane utan dig och strider i jungle/river räknas inte.
      ${rep.laneDeaths ? `${rep.laneDeaths} gånger dog du i en lane utan takedown – kanske en misslyckad gank, men det går inte att veta säkert.` : ''}</p>`;
}

/* ---------------- Early game, synergier, matchups, tidigt → vinst ---------------- */

const signed = (n) => (n == null ? '–' : `${n > 0 ? '+' : n < 0 ? '−' : '±'}${num(Math.abs(n))}`);
const diffCell = (n) => `<span class="${n == null ? '' : n >= 0 ? 'pos' : 'neg'}">${signed(n)}</span>`;
/** Stapel från en mittlinje (t.ex. 50 % vinst): åt höger = bättre, åt vänster = sämre. Skillnaden förstärks ×2. */
const divBar = (value, center = 50) => {
  const d = value - center;
  const w = Math.min(50, Math.abs(d) * 2);
  return `<span class="wrbars__track"><i class="${d >= 0 ? 'is-good' : 'is-bad'}" style="left:${d >= 0 ? 50 : 50 - w}%;width:${w}%"></i></span>`;
};
const barRows = (groups) => {
  const shown = groups.filter((g) => g.games);
  if (!shown.length) return '<p class="empty">För få matcher.</p>';
  return `<ul class="wrbars">${shown.map((g) => `
    <li>
      <span class="wrbars__label">${esc(g.label)}</span>
      ${divBar(g.winrate)}
      <span class="wrbars__value">${g.winrate}% <small>(${g.games})</small></span>
    </li>`).join('')}</ul>`;
};
/** Vinst och förlust som en delad stapel: blått = vinster, orange = förluster. */
const splitList = (list, champs, empty = 'För få matcher.') => (list.length
  ? `<ul class="champbars champbars--split">${list.map((c) => `
      <li>
        ${champIcon(champs, c.championId)}
        <span class="champbars__main">
          <span class="champbars__head"><span><span class="opponents__name">${esc(champs.name(c.championId))}</span> <small class="muted">· ${c.games} matcher</small>${c.games < SCOUT.minGames ? ' <small class="badge badge--unsure">osäkert</small>' : ''}</span>
            <small class="muted">${c.wins} V – ${c.losses} F</small></span>
          <span class="splitbar" role="img" aria-label="${c.winrate} % vinst, ${100 - c.winrate} % förlust">${c.wins ? `<i class="is-good" style="flex:${c.wins}"></i>` : ''}${c.losses ? `<i class="is-bad" style="flex:${c.losses}"></i>` : ''}</span>
          <span class="splitbar__pct"><span class="wr wr--good">${c.winrate}% vinst</span><span class="wr wr--bad">${100 - c.winrate}% förlust</span></span>
        </span>
      </li>`).join('')}</ul>`
  : `<p class="empty">${empty}</p>`);

/** Modul 2: early game vid 5/10/15 min. */
export function earlyHtml(rep) {
  if (!rep) return '';
  const col = (m, f) => `<td>${f(m)}</td>`;
  const row = (label, f) => `<tr><th scope="row">${label}</th>${rep.minutes.map((m) => col(m, f)).join('')}</tr>`;
  return `
    <table class="career early">
      <thead><tr><th scope="col">Snitt</th>${rep.minutes.map((m) => `<th scope="col">${m.minute} min</th>`).join('')}</tr></thead>
      <tbody>
        ${row('Guld', (m) => num(m.gold))}
        ${row('XP · nivå', (m) => `${num(m.xp)} <small class="muted">· ${dash(m.level)}</small>`)}
        ${row('CS', (m) => num(m.cs))}
        ${row('K / D / A', (m) => (m.k == null ? '–' : `${dash(m.k)} / ${dash(m.d)} / ${dash(m.a)}`))}
      </tbody>
    </table>
    <h3 class="sub">Mot motståndarens jungler</h3>
    <table class="career early">
      <thead><tr><th scope="col">Skillnad</th>${rep.minutes.map((m) => `<th scope="col">${m.minute} min</th>`).join('')}</tr></thead>
      <tbody>
        ${row('Guld', (m) => diffCell(m.goldDiff))}
        ${row('XP', (m) => diffCell(m.xpDiff))}
        ${row('CS', (m) => diffCell(m.csDiff))}
        ${row('Guld i vinster', (m) => diffCell(m.goldDiffWin))}
        ${row('Guld i förluster', (m) => diffCell(m.goldDiffLoss))}
      </tbody>
    </table>`;
}

/** Modul 3: synergier. */
export function synergyHtml(rep, champs) {
  if (!rep) return '';
  return `
    <p class="card__hint">${rep.games} matcher · flest matcher först · <span class="sw is-win"></span> vinst <span class="sw is-loss"></span> förlust · din vinst totalt ${rep.baseline} %</p>
    <div class="split">
      <div><h3 class="sub">Mest med</h3>${splitList(rep.mostAllies, champs)}</div>
      <div><h3 class="sub">Mest mot</h3>${splitList(rep.mostEnemies, champs)}</div>
    </div>`;
}

/** Modul 4: matchups mot jungler och lagkompositioner. */
export function matchupHtml(rep, champs) {
  if (!rep) return '';
  return `
    ${rep.vsJungler.length ? `
    <table class="career matchups">
      <thead><tr><th scope="col">Jungler</th><th scope="col">Matcher</th><th scope="col">Vinst</th><th scope="col">Guld 10′</th><th scope="col" class="hide-sm">XP 10′</th></tr></thead>
      <tbody>${rep.vsJungler.map((j) => `
        <tr><th scope="row"><span class="champ-cell">${champIcon(champs, j.championId)}${esc(champs.name(j.championId))}</span></th>
          <td>${j.games}</td>
          <td><span class="wr ${j.winrate >= 50 ? 'wr--good' : 'wr--bad'}">${j.winrate}%</span></td>
          <td>${diffCell(j.goldDiff10)}</td><td class="hide-sm">${diffCell(j.xpDiff10)}</td></tr>`).join('')}
      </tbody>
    </table>` : '<p class="empty">För få matcher mot samma jungler.</p>'}
    <h3 class="sub">Motståndarlagets skada</h3>
    ${barRows(rep.profiles)}
    ${rep.comps.length ? `<h3 class="sub">Motståndarlagets typer <small class="muted">(ungefärligt, Riots klassning)</small></h3>${barRows(rep.comps)}` : ''}`;
}

/** Modul 5: tidig prestation och vinst. */
export function impactHtml(rep) {
  if (!rep) return '';
  return `
    <h3 class="sub">Guld mot motståndarens jungler vid 10 min</h3>
    ${barRows(rep.goldDiff10)}
    <h3 class="sub">Dina dödsfall före 10 min</h3>
    ${barRows(rep.deaths10)}
    <h3 class="sub">First blood</h3>
    ${barRows(rep.firstBlood)}
    <p class="card__hint card__hint--after">Visar samband, inte orsak – en tidig ledning kan också bero på draften.</p>`;
}

/* ---------------- Elo-graf ---------------- */


/** Färg per konto (validerad för mörk bakgrund och färgblindhet); kön syns som hel/streckad linje. */
export const ACCOUNT_COLORS = ['#5ec8f5', '#e8a33c', '#b98cff', '#5fd39a'];

export function eloHtml(series) {
  if (!series.length) {
    return '<p class="empty">Rank sparas vid varje synk från och med nu – Riot har ingen rank-historik att hämta, så grafen fylls på med tiden.</p>';
  }
  const W = 640, H = 230, L = 64, R = 16, T = 14, B = 30;
  const all = series.flatMap((s) => s.points);
  let tMin = Math.min(...all.map((p) => p.t));
  let tMax = Math.max(...all.map((p) => p.t));
  if (tMax - tMin < 86400000) { tMin -= 43200000; tMax += 43200000; } // minst ett dygn brett
  const sMin = Math.min(...all.map((p) => p.score)) - 60;
  const sMax = Math.max(...all.map((p) => p.score)) + 60;
  const x = (t) => L + ((t - tMin) / (tMax - tMin)) * (W - L - R);
  const y = (v) => T + (1 - (v - sMin) / (sMax - sMin)) * (H - T - B);
  const date = (t) => new Date(t).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  const color = (s) => ACCOUNT_COLORS[s.accountIndex % ACCOUNT_COLORS.length];
  const dash = (s) => (s.queue === 'RANKED_FLEX_SR' ? ' stroke-dasharray="6 5"' : '');
  const latest = series.map((s) => s.points[s.points.length - 1]);
  const summary = series.map((s, i) => `${s.account} ${s.queueLabel}: ${latest[i].label}`).join(', ');

  return `
    <svg class="elo" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rank över tid. ${esc(summary)}">
      ${eloTicks(sMin, sMax).map((tk) => `
        <line class="elo__grid" x1="${L}" x2="${W - R}" y1="${y(tk.value)}" y2="${y(tk.value)}"></line>
        <text class="elo__tick" x="${L - 8}" y="${y(tk.value) + 4}" text-anchor="end">${esc(tk.label)}</text>`).join('')}
      <text class="elo__tick" x="${L}" y="${H - 8}">${esc(date(tMin))}</text>
      <text class="elo__tick" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(date(tMax))}</text>
      ${series.map((s) => `
        <polyline class="elo__line" points="${s.points.map((p) => `${x(p.t).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ')}" stroke="${color(s)}"${dash(s)}></polyline>
        ${s.points.map((p) => `<circle class="elo__dot" cx="${x(p.t).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="${s.points.length > 40 ? 2.5 : 4}" fill="${color(s)}"><title>${esc(`${s.account} · ${s.queueLabel} · ${date(p.t)}: ${p.label}`)}</title></circle>`).join('')}`).join('')}
    </svg>
    <ul class="elo__legend">${series.map((s) => `
      <li>
        <svg width="26" height="10" aria-hidden="true"><line x1="1" x2="25" y1="5" y2="5" stroke="${color(s)}" stroke-width="3"${dash(s)}></line></svg>
        <span class="elo__who">${esc(s.account)} <small>${esc(s.queueLabel)}</small></span>
        <b>${esc(s.current)}</b>
        <span class="muted">${s.wins}V ${s.losses}F · ${s.winrate ?? '–'}%</span>
        ${s.points.length > 1 ? `<span class="${s.change >= 0 ? 'pos' : 'neg'}">${s.change >= 0 ? '+' : '−'}${Math.abs(s.change)} LP</span>` : '<span class="muted">ny</span>'}
      </li>`).join('')}</ul>`;
}

/* ---------------- Översikt ---------------- */

export function kpisHtml(k) {
  const tile = (label, value, sub, tone = '') => `
    <div class="kpi ${tone}"><span class="kpi__label">${label}</span><b class="kpi__value">${value}</b><span class="kpi__sub">${sub}</span></div>`;
  const toneOf = (v, good) => (v == null ? '' : good ? 'kpi--good' : 'kpi--bad');
  return [
    tile('Vinst', k.winrate == null ? '–' : `${k.winrate} %`, `${num(k.wins)}–${num(k.losses)}${k.recentWinrate != null ? ` · ${k.recentWinrate} % senaste 30` : ''}`, toneOf(k.winrate, k.winrate >= 50)),
    tile('KDA', dash(k.kda), k.kda == null ? '–' : `${dash(k.k)} / ${dash(k.d)} / ${dash(k.a)}`),
    tile('Lyckade ganks', k.gankSuccess == null ? '–' : `${k.gankSuccess} %`, k.gankPerGame == null ? 'när du spelar jungle' : `${dash(k.gankPerGame)} per match före 15:00`, toneOf(k.gankSuccess, k.gankSuccess >= 60)),
    tile('Guld vid 10 min', signed(k.goldDiff10), 'mot motståndarens jungler', toneOf(k.goldDiff10, k.goldDiff10 >= 0)),
  ].join('');
}

/** Insikter; {id} i texten byts mot champion-namnet. */
export function insightsHtml(list, champs) {
  const marks = { up: '↑', down: '↓', info: '→' };
  return list.map((i) => `
    <p class="insight insight--${i.tone}"><span class="insight__mark" aria-hidden="true">${marks[i.tone]}</span>
      <span>${esc(i.text).replace(/\{(\d+)\}/g, (_, id) => esc(champs.name(Number(id))))}</span></p>`).join('');
}

/** Guld mot motståndarens jungler 0–15 min: en linje för vinster, en för förluster. */
export function goldLineHtml(rep) {
  if (!rep) return '';
  const pts = (key) => [{ minute: 0, v: 0 }, ...rep.minutes.filter((m) => m[key] != null).map((m) => ({ minute: m.minute, v: m[key] }))];
  const win = pts('goldDiffWin');
  const loss = pts('goldDiffLoss');
  if (win.length < 2 && loss.length < 2) return '';
  const W = 560, H = 220, L = 52, R = 92, T = 12, B = 28;
  const maxAbs = Math.max(500, ...[...win, ...loss].map((p) => Math.abs(p.v)));
  const lim = Math.ceil(maxAbs / 500) * 500;
  const x = (m) => L + (m / 15) * (W - L - R);
  const y = (v) => T + (1 - (v + lim) / (2 * lim)) * (H - T - B);
  const line = (list, cls) => `<polyline class="gl__line ${cls}" points="${list.map((p) => `${x(p.minute)},${y(p.v).toFixed(1)}`).join(' ')}"></polyline>
    ${list.slice(1).map((p) => `<circle class="gl__dot ${cls}" cx="${x(p.minute)}" cy="${y(p.v).toFixed(1)}" r="4.5"><title>${p.minute} min: ${signed(p.v)} guld</title></circle>`).join('')}`;
  // Etiketterna vid linjernas slut flyttas isär om linjerna slutar nära varandra
  const yEnd = (list) => y(list[list.length - 1].v);
  let yw = yEnd(win);
  let yl = yEnd(loss);
  if (Math.abs(yw - yl) < 34) {
    const mid = (yw + yl) / 2;
    const up = yw <= yl ? 'w' : 'l';
    yw = up === 'w' ? mid - 17 : mid + 17;
    yl = up === 'w' ? mid + 17 : mid - 17;
  }
  const end = (list, label, ly) => {
    const p = list[list.length - 1];
    return list.length > 1 ? `<text class="gl__end" x="${x(p.minute) + 10}" y="${ly - 2}">${label}</text><text class="gl__endv" x="${x(p.minute) + 10}" y="${ly + 13}">${esc(signed(p.v))}</text>` : '';
  };
  return `
    <svg class="gl" viewBox="0 0 ${W} ${H}" role="img" aria-label="Guld mot motståndarens jungler: ${esc(signed(win[win.length - 1].v))} i vinster och ${esc(signed(loss[loss.length - 1].v))} i förluster vid ${win[win.length - 1].minute} min">
      <line class="gl__axis" x1="${L}" x2="${W - R}" y1="${y(lim)}" y2="${y(lim)}"></line>
      <line class="gl__axis" x1="${L}" x2="${W - R}" y1="${y(-lim)}" y2="${y(-lim)}"></line>
      <line class="gl__zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"></line>
      <text class="gl__tick" x="${L - 8}" y="${y(lim) + 4}" text-anchor="end">${esc(signed(lim))}</text>
      <text class="gl__tick" x="${L - 8}" y="${y(0) + 4}" text-anchor="end">0</text>
      <text class="gl__tick" x="${L - 8}" y="${y(-lim) + 4}" text-anchor="end">${esc(signed(-lim))}</text>
      ${[0, 5, 10, 15].map((m) => `<text class="gl__tick" x="${x(m)}" y="${H - 6}" text-anchor="middle">${m} min</text>`).join('')}
      ${line(win, 'is-win')}${line(loss, 'is-loss')}
      ${end(win, 'Vinster', yw)}${end(loss, 'Förluster', yl)}
    </svg>
    <p class="legend"><span><i class="sw is-win"></i>Vinster</span><span><i class="sw is-loss"></i>Förluster</span><span>Streckad linje = lika mycket guld</span></p>`;
}

/* ---------------- Live Scout ---------------- */

const SUPPORT_LABEL = { stabilt: 'Stabilt underlag', begränsat: 'Begränsat underlag', osäkert: 'Osäkert underlag' };

/** Färgens betydelse i klartext – färgen står aldrig ensam. */
export function scoutLabel(e) {
  if (e.color === 'green') return 'Grön · bra, statistiken håller med';
  if (e.color === 'red') return 'Röd · svår, statistiken håller med';
  if (e.color === 'orange') return 'Orange · statistiken säger emot';
  if (!e.opinion) return 'Grå · ingen bedömning';
  return e.signal === 'jämnt' ? 'Grå · statistiken är neutral' : 'Grå · för lite statistik';
}

const scoutStats = (e, baseline) => (e.games
  ? `<span class="scout__nums"><b>${e.winrate} %</b> <span class="muted">${e.wins} V – ${e.losses} F · ${e.games} ${e.games === 1 ? 'match' : 'matcher'}</span>${e.diff == null || baseline == null ? '' : ` <span class="${e.diff >= 0 ? 'pos' : 'neg'}">${e.diff >= 0 ? '+' : '−'}${Math.abs(e.diff)}</span>`}</span>
    <span class="splitbar" role="img" aria-label="${e.winrate} % vinst">${e.wins ? `<i class="is-good" style="flex:${e.wins}"></i>` : ''}${e.losses ? `<i class="is-bad" style="flex:${e.losses}"></i>` : ''}</span>`
  : '<span class="scout__nums muted">Inga matcher än</span>');

const opinionBtns = (e, side) => `
  <span class="scout__vote" role="group" aria-label="Din bedömning">
    <button type="button" class="vote vote--up" data-opinion="1" data-champ="${e.championId}" data-side="${side}" aria-pressed="${e.opinion === 1}" title="Bra ${side === 'with' ? 'att ha med mig' : 'att möta'}">👍</button>
    <button type="button" class="vote vote--down" data-opinion="-1" data-champ="${e.championId}" data-side="${side}" aria-pressed="${e.opinion === -1}" title="Svår ${side === 'with' ? 'att ha med mig' : 'att möta'}">👎</button>
  </span>`;

function scoutRow(e, champs, side, baseline) {
  return `
    <li class="scout__row scout--${e.color}">
      ${champIcon(champs, e.championId)}
      <div class="scout__main">
        <div class="scout__head">
          <button type="button" class="opponents__name scout__open" data-lib-open="${e.championId}" data-side="${side}" title="Öppna i Champion Library">${esc(champs.name(e.championId))}</button>
          <span class="scout__tag"><i class="scout__dot" aria-hidden="true"></i>${esc(scoutLabel(e))}</span>
          ${e.support === 'stabilt' ? '' : `<small class="badge ${e.support === 'osäkert' ? 'badge--unsure' : ''}">${SUPPORT_LABEL[e.support]}</small>`}
        </div>
        ${scoutStats(e, baseline)}
        <input class="scout__note" type="text" maxlength="500" placeholder="Egen anteckning…" value="${esc(e.note)}"
          data-note data-champ="${e.championId}" data-side="${side}" aria-label="Anteckning om ${esc(champs.name(e.championId))}">
      </div>
      ${opinionBtns(e, side)}
    </li>`;
}

const SCOUT_SORTS = {
  games: (a, b) => b.games - a.games || (b.winrate ?? -1) - (a.winrate ?? -1),
  best: (a, b) => (b.winrate ?? -1) - (a.winrate ?? -1) || b.games - a.games,
  worst: (a, b) => (a.winrate ?? 101) - (b.winrate ?? 101) || b.games - a.games,
};

/** Hela listan för Med/Mot, med sök, färgfilter och sortering. */
export function scoutHtml(table, champs, { q = '', color = '', sort = 'games', limit = 40 } = {}) {
  if (!table.games && !table.list.length) return '<p class="empty">Inga matcher med lagdata än – synka för att fylla på.</p>';
  const needle = q.trim().toLowerCase();
  const counts = { green: 0, red: 0, orange: 0, gray: 0 };
  table.list.forEach((e) => { counts[e.color] += 1; });
  let list = table.list.filter((e) => !needle || champs.name(e.championId).toLowerCase().includes(needle));
  if (color) list = list.filter((e) => e.color === color);
  list = sort === 'name'
    ? [...list].sort((a, b) => champs.name(a.championId).localeCompare(champs.name(b.championId)))
    : [...list].sort(SCOUT_SORTS[sort] || SCOUT_SORTS.games);
  const chip = (k, label) => `<button type="button" data-scout-color="${k}" class="${color === k ? 'is-active' : ''}">${k ? `<i class="scout__dot scout--${k}" aria-hidden="true"></i>` : ''}${label}${k ? ` <small>${counts[k]}</small>` : ''}</button>`;
  return `
    <p class="card__hint">${table.games} matcher · ${table.list.length} champions · din vinst totalt ${table.baseline ?? '–'} % · +/− = skillnad mot den</p>
    <div class="chips scout__colors">${chip('', 'Alla')}${chip('green', 'Grön')}${chip('red', 'Röd')}${chip('orange', 'Orange')}${chip('gray', 'Grå')}</div>
    ${list.length ? `<ul class="scout__list">${list.slice(0, limit).map((e) => scoutRow(e, champs, table.side, table.baseline)).join('')}</ul>` : '<p class="empty">Ingen champion matchar.</p>'}
    ${list.length > limit ? `<button type="button" class="btn btn--ghost btn--block" data-scout-more>Visa fler (${list.length - limit} till)</button>` : ''}`;
}

/** Kompakt rad under en vald champion i champ select. */
export function scoutPickHtml(e, champs, side, baseline) {
  if (!e) return '';
  return `
    <div class="scout__pick scout--${e.color}">
      <div class="scout__head">
        <span class="scout__tag"><i class="scout__dot" aria-hidden="true"></i>${esc(scoutLabel(e))}</span>
        ${e.support === 'stabilt' ? '' : `<small class="badge ${e.support === 'osäkert' ? 'badge--unsure' : ''}">${SUPPORT_LABEL[e.support]}</small>`}
        ${opinionBtns(e, side)}
      </div>
      ${scoutStats(e, baseline)}
      ${e.note ? `<p class="scout__memo">“${esc(e.note)}”</p>` : ''}
    </div>`;
}

/* ---------------- Champion Library ---------------- */

const RELATION = { against: 'Motståndare', with: 'Lagkamrat' };

/** Kort etikett på kortet; hela förklaringen finns i scoutLabel. */
export function scoutShort(e) {
  if (e.color === 'green') return 'Grön · stöds';
  if (e.color === 'red') return 'Röd · stöds';
  if (e.color === 'orange') return 'Orange · säger emot';
  if (!e.opinion) return 'Grå · ingen bedömning';
  return e.signal === 'jämnt' ? 'Grå · neutral' : 'Grå · för lite data';
}

const pctOf = (t) => (t.winrate == null ? '–' : `${t.winrate}<small>%</small>`);
const gamesOf = (n) => `${num(n)} ${n === 1 ? 'match' : 'matcher'}`;
const bar = (t) => `<span class="splitbar" aria-hidden="true">${t.games ? `${t.wins ? `<i class="is-good" style="flex:${t.wins}"></i>` : ''}${t.losses ? `<i class="is-bad" style="flex:${t.losses}"></i>` : ''}` : '<i class="is-none" style="flex:1"></i>'}</span>`;
/** Bakgrund med champion-bild och ikonen som reserv om bilden inte går att hämta. */
const art = (...urls) => {
  const list = urls.filter(Boolean).map((u) => `url(&quot;${esc(u)}&quot;)`);
  return list.length ? ` style="background-image:${list.join(',')}"` : '';
};

function libCard(e, champs, side) {
  const name = champs.name(e.championId);
  const stat = (label, t) => `
    <span class="lib-stat">
      <span class="lib-stat__label">${label}</span>
      <b class="lib-stat__value">${pctOf(t)}</b>
      <span class="lib-stat__n">${gamesOf(t.games)}</span>
      ${bar(t)}
    </span>`;
  const mark = e.opinion === 1 ? '<span class="lib-card__mark" title="Din bedömning: bra">👍</span>'
    : e.opinion === -1 ? '<span class="lib-card__mark" title="Din bedömning: svår">👎</span>' : '';
  return `
    <li>
      <button type="button" class="lib-card scout--${e.color}" data-lib-open="${e.championId}" data-side="${side}"
        aria-label="${esc(name)}: ${esc(scoutLabel(e))}. Öppna detaljer">
        <span class="lib-card__art"${art(champs.tile && champs.tile(e.championId), champs.icon(e.championId))}></span>
        <span class="lib-card__top">
          <span class="lib-card__tag"><i class="scout__dot" aria-hidden="true"></i>${esc(scoutShort(e))}</span>
          ${mark}
        </span>
        <span class="lib-card__name">${esc(name)}</span>
        <span class="lib-card__sub">${RELATION[side]} · Ranked ${num(e.ranked.games)} · Normal ${num(e.normal.games)}${e.support === 'osäkert' ? ' · <span class="badge badge--unsure">osäkert</span>' : ''}</span>
        <span class="lib-card__stats">${stat('Solo/Duo', e.solo)}${stat('Flex', e.flex)}</span>
        <span class="lib-card__note ${e.note ? '' : 'is-empty'}">${e.note ? `“${esc(e.note)}”` : 'Ingen kommentar än'}</span>
      </button>
    </li>`;
}

const LIB_SORTS = {
  games: (a, b) => b.ranked.games - a.ranked.games || b.normal.games - a.normal.games,
  best: (a, b) => (b.ranked.winrate ?? -1) - (a.ranked.winrate ?? -1) || b.ranked.games - a.ranked.games,
  worst: (a, b) => (a.ranked.winrate ?? 101) - (b.ranked.winrate ?? 101) || b.ranked.games - a.ranked.games,
};

/** Biblioteket: kort per champion med Solo/Duo och Flex, färg enligt Live Scout-modellen. */
export function libraryHtml(table, champs, { q = '', color = '', sort = 'games', limit = 24 } = {}) {
  if (!table.list.length) return '<p class="empty">Inga matcher med lagdata än – synka för att fylla på.</p>';
  const needle = q.trim().toLowerCase();
  const counts = { green: 0, red: 0, orange: 0, gray: 0 };
  table.list.forEach((e) => { counts[e.color] += 1; });
  let list = table.list.filter((e) => !needle || champs.name(e.championId).toLowerCase().includes(needle));
  if (color) list = list.filter((e) => e.color === color);
  list = sort === 'name'
    ? [...list].sort((a, b) => champs.name(a.championId).localeCompare(champs.name(b.championId)))
    : [...list].sort(LIB_SORTS[sort] || LIB_SORTS.games);
  const chip = (k, label) => `<button type="button" data-lib-color="${k}" class="${color === k ? 'is-active' : ''}">${k ? `<i class="scout__dot scout--${k}" aria-hidden="true"></i>` : ''}${label}${k ? ` <small>${counts[k]}</small>` : ''}</button>`;
  return `
    <p class="card__hint">${table.games} rankade matcher · ${table.list.length} champions · din Ranked-vinst ${table.baseline ?? '–'} % · färgen jämför din bedömning med Ranked (Solo/Duo + Flex)</p>
    <div class="chips scout__colors">${chip('', 'Alla')}${chip('green', 'Grön')}${chip('red', 'Röd')}${chip('orange', 'Orange')}${chip('gray', 'Grå')}</div>
    ${list.length ? `<ul class="lib-grid">${list.slice(0, limit).map((e) => libCard(e, champs, table.side)).join('')}</ul>` : '<p class="empty">Ingen champion matchar.</p>'}
    ${list.length > limit ? `<button type="button" class="btn btn--ghost btn--block" data-lib-more>Visa fler (${list.length - limit} till)</button>` : ''}`;
}

/** Detaljvyn: statistik (ritas om vid ändringar). Anteckningarna ligger i championEditorHtml. */
export function championDetailHtml(p, champs, accounts, { limit = 10 } = {}) {
  const name = champs.name(p.championId);
  const tile = (label, value, sub, tone = '') => `<div class="lib-tile ${tone}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
  const nOf = (n) => (n ? gamesOf(n) : 'ingen data');
  const toneOf = (v) => (v == null ? '' : v >= 0 ? 'is-pos' : 'is-neg');
  const queueRow = (label, t) => `
    <li><span class="lib-q__label">${label}</span>${bar(t)}
      <span class="lib-q__value"><b>${t.winrate == null ? '–' : `${t.winrate} %`}</b> <small>${t.games ? `${t.wins} V – ${t.losses} F · ` : ''}${gamesOf(t.games)}</small></span></li>`;
  const e = p.early;
  const history = matchesHtml(p.games, champs, accounts, limit).replace(/data-more/g, 'data-lib-more-games');
  return `
    <header class="lib-hero scout--${p.color}"${art(champs.splash && champs.splash(p.championId), champs.tile && champs.tile(p.championId), champs.icon(p.championId))}>
      <button type="button" class="lib-hero__close" data-lib-close aria-label="Stäng">✕</button>
      <div class="lib-hero__body">
        <p class="eyebrow">Champion Library · ${RELATION[p.side]}</p>
        <h2 class="lib-hero__name" id="lib-title">${esc(name)}</h2>
        <span class="scout__tag"><i class="scout__dot" aria-hidden="true"></i>${esc(scoutLabel(p))}</span>
      </div>
    </header>
    <div class="lib-detail">
      <div class="lib-detail__bar">
        <div class="seg" role="group" aria-label="Relation">
          <button type="button" data-lib-side="against" class="${p.side === 'against' ? 'is-active' : ''}">Motståndare</button>
          <button type="button" data-lib-side="with" class="${p.side === 'with' ? 'is-active' : ''}">Lagkamrat</button>
        </div>
        ${opinionBtns(p, p.side)}
      </div>

      <div class="lib-tiles">
        ${tile('Matcher', num(p.total.games), 'alla köer på Rift')}
        ${tile('Vinster', num(p.total.wins), p.total.games ? gamesOf(p.total.games) : 'ingen data')}
        ${tile('Förluster', num(p.total.losses), p.total.games ? gamesOf(p.total.games) : 'ingen data')}
        ${tile('Vinst', p.total.winrate == null ? '–' : `${p.total.winrate} %`, gamesOf(p.total.games))}
      </div>

      <h3 class="sub">Vinst per kö</h3>
      <ul class="lib-q">${queueRow('Solo/Duo', p.byQueue.solo)}${queueRow('Flex', p.byQueue.flex)}${queueRow('Normal', p.byQueue.normal)}</ul>
      <p class="card__hint lib-detail__hint">Normal räknas aldrig in i Ranked.${p.support === 'osäkert' ? ' <span class="badge badge--unsure">Osäkert underlag</span>' : ''}</p>

      <h3 class="sub">Prestation</h3>
      <div class="lib-tiles">
        ${tile('KDA', dash(p.kda.value), p.kda.n ? `${dash(p.kda.k)} / ${dash(p.kda.d)} / ${dash(p.kda.a)} · ${gamesOf(p.kda.n)}` : 'ingen data')}
        ${tile('Damage', num(p.damage.avg), p.damage.n ? `${num(p.damage.perMin)}/min · ${gamesOf(p.damage.n)}` : 'ingen data')}
      </div>

      <h3 class="sub">Early game · 10 min</h3>
      <div class="lib-tiles">
        ${tile('Guld mot jungler', signed(e.goldDiff10.value), nOf(e.goldDiff10.n), toneOf(e.goldDiff10.value))}
        ${tile('XP mot jungler', signed(e.xpDiff10.value), nOf(e.xpDiff10.n), toneOf(e.xpDiff10.value))}
        ${tile('CS mot jungler', signed(e.csDiff10.value), nOf(e.csDiff10.n), toneOf(e.csDiff10.value))}
        ${tile('Dödsfall före 10', dash(e.deaths10.value), nOf(e.deaths10.n))}
        ${tile('Med i first blood', e.firstBlood.value == null ? '–' : `${e.firstBlood.value} %`, nOf(e.firstBlood.n))}
      </div>

      <h3 class="sub">Matcher ${p.side === 'with' ? 'med' : 'mot'} ${esc(name)}</h3>
      ${history}
    </div>`;
}

/** Egen bedömning: kort kommentar (syns på kortet och i Live Scout) och längre strategi. */
export function championEditorHtml(p, champs) {
  const name = esc(champs.name(p.championId));
  return `
    <div class="lib-editor">
      <h3 class="sub">Min strategi</h3>
      <label class="lib-field"><span>Kommentar <small class="muted">– syns på kortet och i Live Scout</small></span>
        <input type="text" maxlength="500" value="${esc(p.note)}" placeholder="Kort kommentar om ${name}…" data-note data-champ="${p.championId}" data-side="${p.side}"></label>
      <label class="lib-field"><span>Strategi och anteckningar</span>
        <textarea rows="5" maxlength="2000" placeholder="Hur spelar du ${p.side === 'with' ? 'med' : 'mot'} ${name}? Leveling, första clear, när du ska ganka…" data-strategy data-champ="${p.championId}" data-side="${p.side}">${esc(p.strategy)}</textarea></label>
      <p class="card__hint lib-editor__hint">Sparas automatiskt när du lämnar fältet · separat för ${RELATION[p.side].toLowerCase()}</p>
    </div>`;
}
