/*
 * Samlad rapport över många matcher: rena funktioner, [{ match, timeline }] in, siffror ut.
 */
import { damageSummary, damageCurve, damageAt, deaths } from './damage.mjs';

const RIFT = [400, 420, 430, 440, 490, 700];
const WINDOWS = [[0, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, Infinity]];
const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Din PUUID: via Riot ID om det finns i matcherna, annars den som är med i flest matcher. */
export function findPuuid(games, riotId = '') {
  const [name, tag] = riotId.toLowerCase().split('#');
  const count = new Map();
  for (const { match } of games) {
    for (const p of match.info.participants) {
      if (name && String(p.riotIdGameName).toLowerCase() === name && String(p.riotIdTagline).toLowerCase() === tag) return p.puuid;
      count.set(p.puuid, (count.get(p.puuid) || 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/** Matcher som räknas: Summoner's Rift, inga remakes, valfritt bara en champion. */
export function relevant(games, puuid, champion = 'Nunu') {
  return games.filter(({ match }) => {
    const me = match.info.participants.find((p) => p.puuid === puuid);
    return me
      && RIFT.includes(match.info.queueId)
      && match.info.gameDuration >= 300
      && !me.gameEndedInEarlySurrender
      && (!champion || me.championName === champion);
  });
}

export function summarize(games, puuid) {
  const rows = games.map(({ match, timeline }) => {
    const s = damageSummary(match, puuid);
    const c = damageCurve(timeline, puuid);
    return { s, at10: damageAt(c, 10), at14: damageAt(c, 14), d: deaths(timeline, match, puuid) };
  });

  const mean = (list, f, d = 0) => (list.length ? round(avg(list.map(f)), d) : null);
  const dmg = (list) => ({
    games: list.length,
    perMin: mean(list, (r) => r.s.perMin),
    at10: mean(list, (r) => r.at10),
    at14: mean(list, (r) => r.at14),
    share: mean(list, (r) => r.s.teamShare),
    deaths: mean(list, (r) => r.d.length, 1),
  });

  const allDeaths = rows.flatMap((r) => r.d);
  const byWindow = WINDOWS.map(([a, b]) => ({
    label: b === Infinity ? `${a}+` : `${a}-${b}`,
    count: allDeaths.filter((d) => d.ms >= a * 60000 && d.ms < b * 60000).length,
  }));
  const places = { camp: 0, objective: 0, torn: 0, 'våg': 0 };
  for (const d of allDeaths) for (const p of d.places) places[p]++;

  const killers = new Map();
  for (const d of allDeaths) {
    for (const name of new Set([d.killer, ...d.helpers])) {
      const k = killers.get(name) || { name, killed: 0, involved: 0 };
      k.involved++;
      if (name === d.killer) k.killed++;
      killers.set(name, k);
    }
  }

  const opponents = new Map();
  for (const { s } of rows) {
    if (!s.opponent) continue;
    const o = opponents.get(s.opponent) || { name: s.opponent, games: 0, wins: 0 };
    o.games++;
    if (s.win) o.wins++;
    opponents.set(s.opponent, o);
  }

  const wins = rows.filter((r) => r.s.win);
  return {
    games: rows.length,
    wins: wins.length,
    losses: rows.length - wins.length,
    first: rows.length ? rows.map((r) => r.s.start).sort()[0].slice(0, 10) : null,
    last: rows.length ? rows.map((r) => r.s.start).sort().pop().slice(0, 10) : null,
    damage: { win: dmg(wins), loss: dmg(rows.filter((r) => !r.s.win)) },
    deaths: {
      total: allDeaths.length,
      perGame: rows.length ? round(allDeaths.length / rows.length, 1) : 0,
      before15: rows.length ? round(allDeaths.filter((d) => d.ms < 15 * 60000).length / rows.length, 1) : 0,
      solo: allDeaths.filter((d) => d.helpers.length === 0 && d.killer !== 'Torn/minion').length,
      byWindow,
      places,
      killers: [...killers.values()].sort((a, b) => b.involved - a.involved || b.killed - a.killed).slice(0, 8),
    },
    opponents: [...opponents.values()].sort((a, b) => b.games - a.games).slice(0, 8),
  };
}

/** Lagringen på disk: storlekar i byte per fil. */
export function storage(sizes) {
  const sum = (k) => sizes.reduce((s, x) => s + (x[k] || 0), 0);
  const kb = (b) => round(b / 1024);
  return {
    matches: sizes.length,
    totalMb: round((sum('match') + sum('timeline')) / 1024 / 1024, 1),
    matchKb: sizes.length ? kb(sum('match') / sizes.length) : 0,
    timelineKb: sizes.length ? kb(sum('timeline') / sizes.length) : 0,
  };
}

export function formatSummary(r, store, label) {
  const n = (x) => (x == null ? '–' : Number(x).toLocaleString('sv-SE'));
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '–');
  const d = r.deaths;
  const lines = [
    `${label} · ${r.games} matcher (${r.first ?? '–'} – ${r.last ?? '–'}) · ${r.wins}V ${r.losses}F (${pct(r.wins, r.games)})`,
    `Lagring: ${store.matches} matcher, ${String(store.totalMb).replace('.', ',')} MB (match ${n(store.matchKb)} KB + tidslinje ${n(store.timelineKb)} KB i snitt)`,
    '',
    'SKADA                 vinster   förluster',
  ];
  const cell = (x, suffix) => (x == null ? '–' : `${n(x)}${suffix}`);
  const row = (title, k, suffix = '') => lines.push(`  ${title.padEnd(20)}${cell(r.damage.win[k], suffix).padStart(8)}${cell(r.damage.loss[k], suffix).padStart(12)}`);
  row('per minut', 'perMin');
  row('vid 10 min', 'at10');
  row('vid 14 min', 'at14');
  row('andel av laget', 'share', ' %');
  row('dödsfall per match', 'deaths');
  lines.push('', `DÖDSFALL  ${d.total} totalt · ${String(d.perGame).replace('.', ',')} per match · ${String(d.before15).replace('.', ',')} före 15 min`);
  lines.push(`  När:   ${d.byWindow.map((w) => `${w.label} min ${w.count}`).join(' · ')}`);
  lines.push(`  Var:   vid camp ${d.places.camp} · vid objective ${d.places.objective} · under torn ${d.places.torn} · vid våg ${d.places['våg']} · ensam mot en (1v1) ${d.solo}`);
  lines.push('  Vem (inblandad / dödade):');
  for (const k of d.killers) lines.push(`    ${k.name.padEnd(14)} ${String(k.involved).padStart(3)} / ${k.killed}`);
  if (r.opponents.length) {
    lines.push('', 'MOTSTÅNDARE (samma position)');
    for (const o of r.opponents) lines.push(`    ${o.name.padEnd(14)} ${o.wins}V ${o.games - o.wins}F`);
  }
  return lines.join('\n');
}
