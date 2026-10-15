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
      <li class="match match--${r.win ? 'win' : 'loss'}" data-match-open="${esc(r.puuid)}|${esc(r.match_id)}" tabindex="0" role="button" aria-label="Öppna matchgenomgång: ${r.win ? 'vinst' : 'förlust'} ${esc(shortDate(r.game_start))}">
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
const ROLE_LABEL = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' };
const relationOf = (side, role) => (ROLE_LABEL[role] ? `${RELATION[side]} · ${ROLE_LABEL[role]}` : RELATION[side]);

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

function libCard(e, champs, side, role) {
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
        <span class="lib-card__sub">${relationOf(side, role)} · Ranked ${num(e.ranked.games)} · Normal ${num(e.normal.games)}${e.support === 'osäkert' ? ' · <span class="badge badge--unsure">osäkert</span>' : ''}</span>
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
export function libraryHtml(table, champs, { q = '', color = '', sort = 'games', limit = 24, role = 'all' } = {}) {
  if (!table.list.length) return `<p class="empty">${ROLE_LABEL[role] ? `Inga matcher med ${ROLE_LABEL[role].toLowerCase()} som ${RELATION[table.side].toLowerCase()} än.` : 'Inga matcher med lagdata än – synka för att fylla på.'}</p>`;
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
    <p class="card__hint">${table.games} rankade matcher · ${table.list.length} ${ROLE_LABEL[role] ? `champions som ${ROLE_LABEL[role].toLowerCase()}` : 'champions'} · din Ranked-vinst ${table.baseline ?? '–'} % · färgen jämför din bedömning med Ranked (Solo/Duo + Flex)</p>
    <div class="chips scout__colors">${chip('', 'Alla')}${chip('green', 'Grön')}${chip('red', 'Röd')}${chip('orange', 'Orange')}${chip('gray', 'Grå')}</div>
    ${list.length ? `<ul class="lib-grid">${list.slice(0, limit).map((e) => libCard(e, champs, table.side, role)).join('')}</ul>` : '<p class="empty">Ingen champion matchar.</p>'}
    ${list.length > limit ? `<button type="button" class="btn btn--ghost btn--block" data-lib-more>Visa fler (${list.length - limit} till)</button>` : ''}`;
}

/** Detaljvyn: statistik (ritas om vid ändringar). Anteckningarna ligger i championEditorHtml. */
export function championDetailHtml(p, champs, accounts, { limit = 10, role = 'all' } = {}) {
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
        <p class="eyebrow">Champion Library · ${relationOf(p.side, role)}</p>
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

      <h3 class="sub">Matcher ${p.side === 'with' ? 'med' : 'mot'} ${esc(name)}${ROLE_LABEL[role] ? ` som ${ROLE_LABEL[role].toLowerCase()}` : ''}</h3>
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

/* ---------------- Matchgenomgång ---------------- */

const ROLE_ICON = {
  TOP: '<path d="M3.5 10.5V3.5h7"/>',
  JUNGLE: '<circle cx="7" cy="7" r="2.6" class="role__fill"/>',
  MIDDLE: '<path d="M3.5 10.5l7-7"/>',
  BOTTOM: '<path d="M3.5 10.5h7v-7"/>',
  UTILITY: '<path d="M7 3.8v6.4M3.8 7h6.4"/>',
};
export const roleIcon = (pos) => (ROLE_ICON[pos]
  ? `<svg class="role" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="2" class="role__map"/>${ROLE_ICON[pos]}</svg>`
  : '');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const MONSTER = {
  DRAGON: { label: 'Drake', mark: 'D' }, BARON_NASHOR: { label: 'Baron', mark: 'B' }, RIFTHERALD: { label: 'Herald', mark: 'H' },
  HORDE: { label: 'Voidgrub', mark: 'V' }, ATAKHAN: { label: 'Atakhan', mark: 'A' }, ELDER_DRAGON: { label: 'Elder', mark: 'E' },
};
const monsterLabel = (m) => {
  const base = MONSTER[m.type] ? MONSTER[m.type].label : 'Monster';
  if (m.type !== 'DRAGON' || !m.sub) return base;
  const sub = m.sub.replace('_DRAGON', '').toLowerCase();
  return `${sub.charAt(0).toUpperCase()}${sub.slice(1)}-drake`;
};

function rvPlayer(p, champs, side) {
  const name = champs.name(p.championId);
  const tag = p.me ? '<span class="rv-pl__tag is-me">Du</span>' : p.opponent ? '<span class="rv-pl__tag" title="Din motståndare på samma position">VS</span>' : '';
  return `<div class="rv-pl rv-pl--${side} ${p.me ? 'is-me' : ''} ${p.opponent ? 'is-opp' : ''}"${art(champs.tile && champs.tile(p.championId), champs.icon(p.championId))}>
    <span class="rv-pl__name">${esc(name)}</span>${tag}</div>`;
}

/** Lagen mot varandra, position för position. */
function rvTeams(m, champs) {
  const rows = POSITIONS_UI.map((pos) => ({
    pos,
    a: m.allies.find((x) => x.position === pos),
    e: m.enemies.find((x) => x.position === pos),
  }));
  const placed = rows.some((r) => r.a || r.e);
  if (!placed) {
    // Utan positioner (äldre data): bara lagen i ordning
    const n = Math.max(m.allies.length, m.enemies.length);
    for (let i = 0; i < n; i++) rows[i] = { pos: null, a: m.allies[i], e: m.enemies[i] };
  }
  return `<div class="rv-teams">
    <div class="rv-teams__head"><span>Ditt lag</span><span></span><span>Motståndare</span></div>
    ${rows.filter((r) => r.a || r.e).map((r) => `
      <div class="rv-teams__row">
        ${r.a ? rvPlayer(r.a, champs, 'ally') : '<div class="rv-pl rv-pl--empty"></div>'}
        <span class="rv-teams__pos" title="${r.pos ? esc(POSITION_NAMES[r.pos]) : ''}">${roleIcon(r.pos)}</span>
        ${r.e ? rvPlayer(r.e, champs, 'enemy') : '<div class="rv-pl rv-pl--empty"></div>'}
      </div>`).join('')}
  </div>`;
}
const POSITIONS_UI = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const POSITION_NAMES = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' };

const METRICS = { gold: { label: 'Guld', unit: 'guld' }, xp: { label: 'XP', unit: 'XP' }, cs: { label: 'CS', unit: 'CS' } };

/** Skillnad mot motståndaren minut för minut: blått ovanför noll (före), orange under (efter). */
export function rvChartHtml(m, metric = 'gold') {
  const pts = m.diffs[metric];
  if (!pts || pts.length < 2) return '<p class="empty">Ingen motståndare på din position i tidslinjen.</p>';
  const W = 640, H = 220, L = 44, R = 12, T = 16, B = 46;
  const last = pts[pts.length - 1].minute;
  const maxAbs = Math.max(metric === 'cs' ? 10 : 300, ...pts.map((p) => Math.abs(p.v)));
  const step = metric === 'cs' ? 10 : maxAbs > 3000 ? 2000 : maxAbs > 1500 ? 1000 : 500;
  const lim = Math.ceil(maxAbs / step) * step;
  const x = (min) => L + (min / Math.max(1, last)) * (W - L - R);
  const y = (v) => T + (1 - (v + lim) / (2 * lim)) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.minute).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(last).toFixed(1)},${y(0).toFixed(1)}L${x(pts[0].minute).toFixed(1)},${y(0).toFixed(1)}Z`;
  const y0 = y(0).toFixed(1);
  const ticks = [];
  for (let t = 0; t <= last; t += 5) ticks.push(t);
  const vAt = (sec) => {
    const mm = sec / 60;
    const a = pts.filter((p) => p.minute <= mm).pop() || pts[0];
    const b = pts.find((p) => p.minute >= mm) || a;
    return a === b ? a.v : a.v + ((b.v - a.v) * (mm - a.minute)) / (b.minute - a.minute);
  };
  const evMarks = m.events.filter((e) => e.k !== 'assist' && e.t / 60 <= last).map((e) => {
    const cx = x(e.t / 60).toFixed(1);
    const cy = y(vAt(e.t)).toFixed(1);
    return e.k === 'kill'
      ? `<circle class="rv-ev rv-ev--kill" cx="${cx}" cy="${cy}" r="5"><title>${mmss(e.t)} kill</title></circle>`
      : `<g class="rv-ev rv-ev--death" transform="translate(${cx},${cy})"><path d="M-4,-4L4,4M4,-4L-4,4"/><title>${mmss(e.t)} dödsfall</title></g>`;
  }).join('');
  const track = H - 22;
  const monMarks = m.monsters.filter((e) => e.t / 60 <= last).map((e) => `
    <g class="rv-mon ${e.mine ? 'is-mine' : 'is-theirs'}" transform="translate(${x(e.t / 60).toFixed(1)},${track})">
      <rect x="-8" y="-8" width="16" height="16" rx="4" transform="rotate(45)"/><text y="4" text-anchor="middle">${(MONSTER[e.type] || { mark: '?' }).mark}</text>
      <title>${mmss(e.t)} ${esc(monsterLabel(e))} – ${e.mine ? 'ditt lag' : 'motståndarna'}${e.me ? ' (du var med)' : ''}</title>
    </g>`).join('');
  const end = pts[pts.length - 1];
  return `
    <svg class="rv-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${METRICS[metric].label} mot motståndaren: ${esc(signed(end.v))} vid ${end.minute} min${m.at10[metric] != null ? `, ${esc(signed(m.at10[metric]))} vid 10 min` : ''}" data-rv-chart data-last="${last}" data-l="${L}" data-r="${R}" data-w="${W}">
      <defs>
        <clipPath id="rv-above"><rect x="0" y="0" width="${W}" height="${y0}"/></clipPath>
        <clipPath id="rv-below"><rect x="0" y="${y0}" width="${W}" height="${H}"/></clipPath>
        <linearGradient id="rv-g-up" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5ec8f5" stop-opacity=".55"/><stop offset="1" stop-color="#5ec8f5" stop-opacity=".05"/></linearGradient>
        <linearGradient id="rv-g-down" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f2884b" stop-opacity=".05"/><stop offset="1" stop-color="#f2884b" stop-opacity=".55"/></linearGradient>
      </defs>
      ${[lim, lim / 2, -lim / 2, -lim].map((v) => `<line class="rv-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="rv-tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(signed(v))}</text>`).join('')}
      <line class="rv-zero" x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}"/>
      <text class="rv-tick" x="${L - 6}" y="${Number(y0) + 4}" text-anchor="end">0</text>
      ${ticks.map((t) => `<text class="rv-tick" x="${x(t)}" y="${H - 34}" text-anchor="middle">${t}′</text>`).join('')}
      <g class="rv-draw">
        <path class="rv-area" d="${area}" fill="url(#rv-g-up)" clip-path="url(#rv-above)"/>
        <path class="rv-area" d="${area}" fill="url(#rv-g-down)" clip-path="url(#rv-below)"/>
        <path class="rv-line rv-line--up" d="${line}" clip-path="url(#rv-above)"/>
        <path class="rv-line rv-line--down" d="${line}" clip-path="url(#rv-below)"/>
        ${evMarks}
      </g>
      <line class="rv-track" x1="${L}" x2="${W - R}" y1="${track}" y2="${track}"/>
      ${monMarks}
      <line class="rv-cross" data-rv-cross y1="${T}" y2="${H - B}" hidden/>
    </svg>
    <div class="rv-readout" data-rv-readout aria-live="polite">
      <b>${esc(signed(end.v))}</b> ${METRICS[metric].unit} vid ${end.minute} min${m.at10[metric] != null ? ` · <b>${esc(signed(m.at10[metric]))}</b> vid 10 min` : ''}
    </div>
    <script type="application/json" data-rv-points>${JSON.stringify(pts)}</script>
    <p class="legend"><span><i class="sw is-win"></i>Före motståndaren</span><span><i class="sw is-loss"></i>Efter</span><span><i class="rv-key rv-key--kill"></i>Kill</span><span><i class="rv-key rv-key--death">×</i>Dödsfall</span><span><i class="rv-key rv-key--mon is-mine"></i>Objective ditt lag</span><span><i class="rv-key rv-key--mon is-theirs"></i>Motståndarna</span></p>`;
}

/** Summoner's Rift med din väg de första 15 min, dina kills/dödsfall och elite monsters. */
function rvMapHtml(m, champs) {
  const X = (x) => ((x / 14820) * 100).toFixed(2);
  const Y = (y) => (100 - (y / 14881) * 100).toFixed(2);
  const img = champs.map && champs.map();
  const path = m.path.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const dots = m.path.map(([x, y], i) => ((i + 1) % 3 === 0 ? `<g class="rv-step" transform="translate(${X(x)},${Y(y)})"><circle r="2.3"/><text y="0.9" text-anchor="middle">${i + 1}</text></g>` : '')).join('');
  const ev = m.events.map((e) => {
    const t = `<title>${mmss(e.t)} ${e.k === 'kill' ? 'kill' : e.k === 'death' ? 'dödsfall' : 'assist'}</title>`;
    if (e.k === 'death') return `<g class="rv-ev rv-ev--death" transform="translate(${X(e.x)},${Y(e.y)})"><path d="M-1.6,-1.6L1.6,1.6M1.6,-1.6L-1.6,1.6"/>${t}</g>`;
    return `<circle class="rv-ev rv-ev--${e.k}" cx="${X(e.x)}" cy="${Y(e.y)}" r="${e.k === 'kill' ? 1.8 : 1.3}">${t}</circle>`;
  }).join('');
  const mon = m.monsters.filter((e) => e.x != null).map((e) => `
    <g class="rv-mon ${e.mine ? 'is-mine' : 'is-theirs'}" transform="translate(${X(e.x)},${Y(e.y)})"><rect x="-2.2" y="-2.2" width="4.4" height="4.4" rx="1" transform="rotate(45)"/><title>${mmss(e.t)} ${esc(monsterLabel(e))}</title></g>`).join('');
  return `
    <div class="rv-map">
      <svg viewBox="0 0 100 100" role="img" aria-label="Kartan: din väg de första ${m.path.length} minuterna, ${m.counts.kills} kills och ${m.counts.deaths} dödsfall">
        <rect class="rv-map__bg" width="100" height="100" rx="3"/>
        ${img ? `<image href="${esc(img)}" width="100" height="100" preserveAspectRatio="none" class="rv-map__img"/>` : ''}
        <g class="rv-map__lanes"><path d="M6,94 L6,6 L94,6"/><path d="M6,94 L94,94 L94,6"/><path d="M6,94 L94,6"/><path d="M14,14 C40,40 60,60 86,86" class="rv-map__river"/></g>
        ${path ? `<polyline class="rv-path" points="${path}" pathLength="1"/>` : ''}
        ${dots}${mon}${ev}
      </svg>
    </div>
    <p class="legend"><span><i class="rv-key rv-key--path"></i>Din väg (minut 1–15)</span><span><i class="rv-key rv-key--kill"></i>Kill</span><span><i class="rv-key rv-key--assist"></i>Assist</span><span><i class="rv-key rv-key--death">×</i>Dödsfall</span></p>`;
}

/** Objectives: ditt lag mot motståndarna, som speglade staplar. */
function rvObjectivesHtml(o) {
  if (!o) return '';
  const rows = [['dragon', 'Drakar'], ['horde', 'Voidgrubs'], ['riftHerald', 'Herald'], ['baron', 'Baron'], ['tower', 'Torn'], ['inhibitor', 'Inhibitors']]
    .map(([k, label]) => ({ label, a: o.mine[k] || 0, b: o.theirs[k] || 0 }))
    .filter((r) => r.a || r.b);
  if (!rows.length) return '';
  return `<ul class="rv-obj">${rows.map((r) => {
    const max = Math.max(r.a, r.b, 1);
    return `<li><b class="rv-obj__n">${r.a}</b><span class="rv-obj__bar is-mine"><i style="width:${(r.a / max) * 100}%"></i></span>
      <span class="rv-obj__label">${r.label}</span>
      <span class="rv-obj__bar is-theirs"><i style="width:${(r.b / max) * 100}%"></i></span><b class="rv-obj__n">${r.b}</b></li>`;
  }).join('')}</ul>
  <p class="legend"><span><i class="sw is-win"></i>Ditt lag${o.mine.firstDragon ? ' · första draken' : ''}</span><span><i class="sw is-loss"></i>Motståndarna${o.theirs.firstDragon ? ' · första draken' : ''}</span></p>`;
}

function rvBuildHtml(l, champs, extras) {
  if (!l) return '';
  const icon = (src, name, cls = '') => (src ? `<img class="rv-ico ${cls}" src="${esc(src)}" alt="${esc(name)}" title="${esc(name)}" loading="lazy" width="40" height="40">` : `<span class="rv-ico rv-ico--empty ${cls}" title="${esc(name)}">${esc(String(name).slice(0, 3))}</span>`);
  const items = l.items.map((id) => icon(champs.item && champs.item(id), `Item ${id}`)).join('');
  const perk = (id) => (id && extras ? extras.perk(id) : null);
  const ks = perk(l.keystone);
  const spells = l.spells.map((id) => { const sp = extras && extras.spell(id); return icon(sp && sp.icon, sp ? sp.name : `Spell ${id}`, 'rv-ico--sm'); }).join('');
  const tree = (id) => { const t = perk(id); return t ? icon(t.icon, t.name, 'rv-ico--sm rv-ico--round') : ''; };
  return `
    <div class="rv-build">
      <div><span class="rv-build__label">Items</span><div class="rv-build__row">${items || '<span class="muted">–</span>'}${l.trinket ? icon(champs.item && champs.item(l.trinket), 'Trinket', 'rv-ico--trinket') : ''}</div></div>
      <div><span class="rv-build__label">Runor</span><div class="rv-build__row">${ks ? icon(ks.icon, ks.name, 'rv-ico--round rv-ico--key') : l.keystone ? icon(null, `Runa ${l.keystone}`) : '–'}${tree(l.primary)}${tree(l.secondary)}
        ${ks ? `<span class="rv-build__name">${esc(ks.name)}</span>` : ''}</div></div>
      <div><span class="rv-build__label">Spells</span><div class="rv-build__row">${spells || '–'}</div></div>
    </div>`;
}

/** Hela matchgenomgången. extras = runor och spells (kan vara null). */
export function matchReviewHtml(m, champs, extras, accounts, { metric = 'gold' } = {}) {
  const r = m.row;
  const min = Math.round(r.duration_s / 60);
  const acc = accounts.length > 1 ? accounts.find((a) => a.puuid === r.puuid) : null;
  const stat = (label, value) => `<div class="rv-stat"><b>${value}</b><span>${label}</span></div>`;
  const ganks = m.ganks.filter((g) => g.takedowns > 0);
  return `
    <header class="rv-hero ${r.win ? 'is-win' : 'is-loss'}"${art(champs.splash && champs.splash(r.champion_id), champs.tile && champs.tile(r.champion_id), champs.icon(r.champion_id))}>
      <button type="button" class="lib-hero__close" data-rv-close aria-label="Stäng">✕</button>
      <div class="rv-hero__body">
        <p class="eyebrow">${esc(queueLabel(r.queue_id))} · ${esc(shortDate(r.game_start))} · ${min} min${acc ? ` · ${esc(acc.game_name)}` : ''}</p>
        <h2 class="rv-hero__result" id="rv-title">${r.win ? 'Vinst' : 'Förlust'}</h2>
        <p class="rv-hero__kda"><b>${r.kills}</b> / <b class="${r.deaths ? 'neg' : ''}">${r.deaths}</b> / <b>${r.assists}</b> <span>${esc(champs.name(r.champion_id))}</span></p>
      </div>
    </header>
    <div class="lib-detail">
      <div class="rv-stats">
        ${stat('KDA', dash(((r.kills + r.assists) / Math.max(1, r.deaths)).toFixed(2)))}
        ${stat('CS/min', dash((r.cs / Math.max(1, r.duration_s / 60)).toFixed(1)))}
        ${stat('Damage', num(r.damage))}
        ${stat('Vision', num(r.vision))}
        ${stat('Guld vid 10', m.at10.gold == null ? '–' : signed(m.at10.gold))}
        ${stat('Ganks före 15', m.ganks.length || r.ganks ? num(ganks.length) : '–')}
      </div>

      <h3 class="sub">Lagen</h3>
      ${rvTeams(m, champs)}

      ${m.hasReview ? `
        <div class="rv-head">
          <h3 class="sub">Mot motståndaren på din position</h3>
          <div class="seg" role="group" aria-label="Mått">${Object.entries(METRICS).map(([k, v]) => `<button type="button" data-rv-metric="${k}" class="${k === metric ? 'is-active' : ''}">${v.label}</button>`).join('')}</div>
        </div>
        <div class="rv-chartwrap" data-rv-chartwrap>${rvChartHtml(m, metric)}</div>

        <div class="grid2 rv-grid2">
          <div><h3 class="sub">Kartan</h3>${rvMapHtml(m, champs)}</div>
          <div>
            <h3 class="sub">Objectives</h3>${rvObjectivesHtml(m.objectives) || '<p class="empty">–</p>'}
            ${m.monsters.length ? `<ul class="rv-timeline">${m.monsters.map((e) => `<li class="${e.mine ? 'is-mine' : 'is-theirs'}"><span>${mmss(e.t)}</span>${esc(monsterLabel(e))}${e.me ? ' <small>· du var med</small>' : ''}</li>`).join('')}</ul>` : ''}
            ${ganks.length ? `<h3 class="sub">Ganks</h3><ul class="rv-ganks">${ganks.map((g) => `<li><span class="rv-ganks__lane">${esc(g.lane)}</span>${mmss(g.t / 1000)} · ${g.kills ? `${g.kills} kill` : 'assist'}${g.died ? ' · du dog' : ''}</li>`).join('')}</ul>` : ''}
          </div>
        </div>` : `
        ${rvObjectivesHtml(m.objectives) ? `<h3 class="sub">Objectives</h3>${rvObjectivesHtml(m.objectives)}` : ''}
        <p class="card__hint rv-note">Kurvor och karta saknas för den här matchen – ${r.derived_version >= 5 ? 'ingen tidslinje (t.ex. ARAM)' : 'de fylls i när synken räknat om matcherna efter 010_review.sql'}.</p>`}

      ${m.loadout ? `<h3 class="sub">Build</h3>${rvBuildHtml(m.loadout, champs, extras)}` : ''}
    </div>`;
}

/* ---------------- Playbook ---------------- */

/** Snabbval: de junglers du mött mest, som porträtt med vinst %. */
export function playbookQuickHtml(pb, champs, picks = []) {
  const card = (e, extra = '') => `
    <button type="button" class="pb-pick scout--${e.color} ${pb.championId === e.championId ? 'is-active' : ''}" data-pb-pick="${e.championId}"${art(champs.tile && champs.tile(e.championId), champs.icon(e.championId))}>
      <span class="pb-pick__name">${esc(champs.name(e.championId))}</span>
      <span class="pb-pick__wr">${e.games ? `${e.winrate} % · ${e.games}` : e.normal && e.normal.games ? `Normal · ${e.normal.games}` : 'ny'}</span>${extra}
    </button>`;
  const fromSelect = picks.filter((id) => id != null);
  return `
    ${fromSelect.length ? `<p class="pb-label">Från champ select i Scout</p><div class="pb-quick pb-quick--select">${fromSelect.map((id) => card(pb.quick.find((e) => e.championId === id) || { championId: id, color: 'gray', games: 0 })).join('')}</div>` : ''}
    <p class="pb-label">Junglers du mött mest</p>
    ${pb.quick.length ? `<div class="pb-quick">${pb.quick.map((e) => card(e)).join('')}</div>` : '<p class="empty">Inga motståndarjunglers än – synka för att fylla på.</p>'}`;
}

/** Vinst som en ring som fylls. */
const ring = (wr, label) => {
  const C = 2 * Math.PI * 42;
  const v = wr == null ? 0 : wr / 100;
  return `<svg class="pb-ring" viewBox="0 0 100 100" role="img" aria-label="${esc(label)}">
    <circle cx="50" cy="50" r="42" class="pb-ring__bg"/>
    <circle cx="50" cy="50" r="42" class="pb-ring__win" stroke-dasharray="${(v * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/>
    <text x="50" y="54" text-anchor="middle" class="pb-ring__v">${wr == null ? '–' : `${wr}%`}</text>
  </svg>`;
};

export function playbookHtml(pb, champs, accounts) {
  if (pb.championId == null) {
    return `<div class="pb-empty"><p>Välj motståndarens jungler ovan – då byggs en spelplan av dina egna matcher mot hen.</p>${pb.duos.length ? duosHtml(pb, champs) : ''}</div>`;
  }
  const e = pb.entry;
  const name = champs.name(pb.championId);
  const r = pb.record;
  const diff = r.winrate == null || pb.jungleBaseline == null ? null : r.winrate - pb.jungleBaseline;
  const keys = pb.keys.map((k) => `
    <div class="pb-key pb-key--${k.tone}">
      <span class="pb-key__label">${esc(k.label)}</span>
      <b class="pb-key__v">${k.winrate == null ? '–' : `${k.winrate} %`}</b>
      <span class="pb-key__bar"><i style="width:${k.winrate ?? 0}%"></i>${r.winrate != null ? `<em style="left:${r.winrate}%" title="Din vinst mot ${esc(name)}"></em>` : ''}</span>
      <small>vinst · ${gamesOf(k.games)}${k.games < 5 ? ' · osäkert' : ''}</small>
    </div>`).join('');
  const lanes = pb.lanes.length ? `
    <div class="pb-lanes" role="img" aria-label="Vinst när första ganken går till respektive lane">
      ${pb.lanes.map((l) => `
        <div class="pb-lane">
          <span class="pb-lane__v">${l.firstWin.winrate == null ? '–' : `${l.firstWin.winrate} %`}</span>
          <span class="pb-lane__col"><i style="height:${l.firstWin.winrate ?? 0}%"></i></span>
          <span class="pb-lane__name">${roleIcon({ top: 'TOP', mid: 'MIDDLE', bot: 'BOTTOM' }[l.lane])}${esc(l.lane)}</span>
          <small>${gamesOf(l.firstWin.games)} · ${l.success == null ? '–' : `${l.success} %`} lyckade</small>
        </div>`).join('')}
    </div>` : '<p class="empty">Inga ganks registrerade mot hen än.</p>';
  const early = goldLineHtml(pb.early);
  return `
    <header class="pb-hero scout--${e.color}"${art(champs.splash && champs.splash(pb.championId), champs.tile && champs.tile(pb.championId), champs.icon(pb.championId))}>
      <div class="pb-hero__body">
        <p class="eyebrow">Playbook · motståndarjungler</p>
        <h3 class="pb-hero__name">${esc(name)}</h3>
        <span class="scout__tag"><i class="scout__dot" aria-hidden="true"></i>${esc(scoutLabel(e))}</span>
        ${e.note ? `<p class="pb-hero__note">“${esc(e.note)}”</p>` : ''}
      </div>
      <div class="pb-hero__score">
        ${ring(r.winrate, `${r.winrate ?? '–'} % vinst mot ${name}`)}
        <p><b>${r.wins} V – ${r.losses} F</b><br>${gamesOf(r.games)}${diff == null ? '' : ` · <span class="${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '+' : '−'}${Math.abs(diff)}</span> mot ditt snitt`}</p>
        ${opinionBtns(e, 'against')}
      </div>
    </header>

    ${r.games ? `
      <h3 class="sub">Det här har avgjort dina matcher mot ${esc(name)}</h3>
      <div class="pb-keys">${keys || '<p class="empty">För lite tidslinjedata.</p>'}</div>
      <p class="card__hint pb-hint">Strecket = din vinst mot ${esc(name)} totalt. Samband, inte orsak.</p>

      <div class="grid2 pb-grid">
        <div><h3 class="sub">Var första ganken lönar sig</h3>${lanes}</div>
        <div><h3 class="sub">Guld mot ${esc(name)}</h3>${early || '<p class="empty">Ingen tidslinjedata.</p>'}</div>
      </div>

      <h3 class="sub">Senaste matcherna mot ${esc(name)}</h3>
      ${matchesHtml(pb.recent, champs, accounts, 5)}` : `<p class="empty pb-none">Du har inte mött ${esc(name)} som jungler än – din strategi nedan sparas ändå.</p>`}
    ${pb.duos.length ? duosHtml(pb, champs) : ''}`;
}

function duosHtml(pb, champs) {
  return `
    <h3 class="sub">Dina bästa duos</h3>
    <div class="pb-duos">${pb.duos.map((d) => `
      <div class="pb-duo"${art(champs.tile && champs.tile(d.best.championId), champs.icon(d.best.championId))}>
        <span class="pb-duo__pos">${roleIcon(d.position)}${esc(POSITION_NAMES[d.position])}</span>
        <span class="pb-duo__name">${esc(champs.name(d.best.championId))}</span>
        <span class="pb-duo__wr"><b>${d.best.all.winrate} %</b> · ${gamesOf(d.best.all.games)}</span>
      </div>`).join('')}</div>`;
}

/* ---------------- Live: pågående match ---------------- */

export const gameClock = (sec) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.floor(Math.max(0, sec) % 60)).padStart(2, '0')}`;

/** Kompakt rad när ingen match pågår, så att det syns att Live finns och när det senast kollades. */
export function liveIdleHtml({ busy = false, checkedAt = 0, accounts = 0, error = '', checks = [] } = {}) {
  const time = checkedAt ? new Date(checkedAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : null;
  const text = busy ? 'Letar efter en pågående match…'
    : error ? `Live: ${error}`
      : !accounts ? 'Live: koppla ett konto först'
        : time ? `Ingen pågående match · kollat ${time} på ${accounts} ${accounts === 1 ? 'konto' : 'konton'} · syns när laddningsskärmen startar`
          : 'Live: kollar strax efter pågående match';
  // Vad Riot svarade per konto – visas när något inte är ett vanligt "ingen match"
  // Efter "Kolla nu" (djupkontroll) visas alla konton, annars bara det som avviker
  const odd = checks.filter((c) => c.result !== 'ingen match' || c.detail);
  const detail = !busy && odd.length ? `<small class="live-idle__detail">${odd.map((c) => `${esc(c.name)}: ${esc(c.result)}${c.detail ? ` – ${esc(c.detail)}` : ''}${c.riot && c.detail ? ` · Riot: ${esc(c.riot)}` : ''}${c.message ? ` (${esc(c.message)})` : ''}`).join('<br>')}</small>` : '';
  return `<span class="live-idle__dot ${busy ? 'is-busy' : ''}" aria-hidden="true"></span><span class="live-idle__text">${esc(text)}${detail}</span>
    <button type="button" class="live-idle__btn" data-action="live-check"${busy ? ' disabled' : ''}>Kolla nu</button>`;
}

/** Livekortet: båda lagen som championkort med din historik och bedömning. tables = { with, against } (scoutTable). */
export function liveHtml(live, champs, tables, now = Date.now()) {
  const look = (side, id) => tables[side].list.find((e) => e.championId === id)
    || { championId: id, games: 0, winrate: null, color: 'gray', opinion: null, note: '' };
  const card = (p, side, extra = {}) => {
    const e = side ? look(side, p.championId) : null;
    const name = champs.name(p.championId);
    return `
      <div class="live-pl ${e ? `scout--${e.color}` : 'is-me'} ${extra.jungler ? 'is-jungler' : ''}"${art(champs.tile && champs.tile(p.championId), champs.icon(p.championId))} title="${esc(name)}${e && e.note ? ` – ${esc(e.note)}` : ''}">
        ${extra.jungler ? '<span class="live-pl__jg">JG</span>' : ''}
        ${e && e.opinion ? `<span class="live-pl__op">${e.opinion > 0 ? '👍' : '👎'}</span>` : ''}
        <span class="live-pl__name">${esc(name)}</span>
        <span class="live-pl__wr">${!e ? '<b>Du</b>' : e.games ? `<b>${e.winrate} %</b><br>${gamesOf(e.games)}` : 'Inga<br>matcher'}</span>
      </div>`;
  };
  const secs = live.startedAt ? (now - live.startedAt) / 1000 : live.gameLength;
  const jg = live.enemyJungler;
  const bans = (ids) => ids.map((id) => `<span class="live-ban"${art(champs.icon(id))} title="${esc(champs.name(id))}"></span>`).join('');
  return `
    <div class="live__head">
      <span class="live__badge"><i></i>Live</span>
      <span class="live__meta">${esc(queueLabel(live.queueId))} · <b data-live-clock data-start="${live.startedAt || ''}" data-length="${live.gameLength}">${live.startedAt ? gameClock(secs) : 'laddar'}</b>${live.account && live.account.name ? ` · ${esc(live.account.name)}` : ''}</span>
      <button type="button" class="live__refresh" data-action="live-check" aria-label="Uppdatera">↻</button>
    </div>
    <div class="live__teams">
      <div class="live__team">
        <p class="live__label">Ditt lag</p>
        <div class="live__row">${card(live.me, null)}${live.allies.map((p) => card(p, 'with', { jungler: p.championId === live.allyJungler })).join('')}</div>
      </div>
      <div class="live__team">
        <p class="live__label live__label--enemy">Motståndare</p>
        <div class="live__row">${live.enemies.map((p) => card(p, 'against', { jungler: p.championId === jg })).join('')}</div>
      </div>
    </div>
    ${live.bans.mine.length || live.bans.theirs.length ? `<p class="live__bans"><span>Bans</span>${bans(live.bans.mine)}<span class="live__vs">mot</span>${bans(live.bans.theirs)}</p>` : ''}
    <div class="live__actions">
      ${jg ? `<button type="button" class="btn btn--primary" data-live-playbook="${jg}">Spelplan mot ${esc(champs.name(jg))}</button>` : ''}
      <button type="button" class="btn btn--ghost" data-tab="scout">Visa i Scout</button>
    </div>`;
}
