/*
 * otpnunu – rendering. Funktioner som tar data och returnerar HTML.
 * Allt som kommer utifrån (namn, Riot ID) escapas.
 */
import { queueLabel } from './stats.js';

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
  return `
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
    <p class="chips chips--static">
      ${Object.entries(d.places).map(([k, n]) => `<span>${placeLabels[k]} <b>${n}</b></span>`).join('')}
      <span>ensam 1 mot 1 <b>${d.solo}</b></span>
    </p>

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
