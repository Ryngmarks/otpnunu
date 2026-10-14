/*
 * Nunu Career – rendering. Funktioner som tar data och returnerar HTML.
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
