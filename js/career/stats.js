/*
 * otpnunu – statistik. Rena funktioner: rader från nunu.account_match in, siffror ut.
 * Ingen DOM här, så allt kan testas i Node.
 */

export const NUNU = 20;

/** Köer på Summoner's Rift (räknas i Career). Övriga lägen (ARAM, Arena …) visas bara under "Alla". */
export const QUEUES = {
  420: 'Solo/Duo',
  440: 'Flex',
  400: 'Normal Draft',
  430: 'Normal Blind',
  490: 'Quickplay',
  700: 'Clash',
  450: 'ARAM',
  1700: 'Arena',
  1750: 'Arena',
  1710: 'Arena',
};

export const QUEUE_FILTERS = {
  ranked: { label: 'Rankat', queues: [420, 440] },
  solo: { label: 'Solo/Duo', queues: [420] },
  flex: { label: 'Flex', queues: [440] },
  normal: { label: 'Normal', queues: [400, 430, 490, 700] },
  rift: { label: 'Alla på Rift', queues: [400, 420, 430, 440, 490, 700] },
};

export const queueLabel = (id) => QUEUES[id] || `Kö ${id}`;

/**
 * Filtrerar matcher. Remakes räknas aldrig.
 *   champion: champion-id eller null för alla
 *   queues:   lista med kö-id:n eller null för alla
 *   puuid:    ett konto eller null för alla
 */
export function filterMatches(rows, { champion = NUNU, queues = QUEUE_FILTERS.rift.queues, puuid = null } = {}) {
  return rows.filter((r) =>
    !r.remake
    && (champion == null || r.champion_id === champion)
    && (!queues || queues.includes(r.queue_id))
    && (!puuid || r.puuid === puuid));
}

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Grundstatistik för en mängd matcher. */
export function summarize(rows) {
  const games = rows.length;
  const sum = (f) => rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
  const wins = rows.filter((r) => r.win).length;
  const kills = sum('kills');
  const deaths = sum('deaths');
  const assists = sum('assists');
  const minutes = sum('duration_s') / 60;
  return {
    games,
    wins,
    losses: games - wins,
    winrate: games ? round((wins / games) * 100, 0) : null,
    kda: games ? round((kills + assists) / Math.max(1, deaths), 2) : null,
    kills: games ? round(kills / games) : null,
    deaths: games ? round(deaths / games) : null,
    assists: games ? round(assists / games) : null,
    csPerMin: minutes ? round(sum('cs') / minutes) : null,
    avgMinutes: games ? round(minutes / games, 0) : null,
    goldPerMin: minutes ? round(sum('gold') / minutes, 0) : null,
    visionPerMin: minutes ? round(sum('vision') / minutes, 2) : null,
  };
}

/** Senaste N resultat, nyast först: ['W', 'L', …] */
export function recentForm(rows, n = 10) {
  return [...rows]
    .sort((a, b) => String(b.game_start).localeCompare(String(a.game_start)))
    .slice(0, n)
    .map((r) => (r.win ? 'W' : 'L'));
}

/** Statistik per konto, i kontolistans ordning. */
export function byAccount(rows, accounts) {
  return accounts.map((a) => ({ account: a, ...summarize(rows.filter((r) => r.puuid === a.puuid)) }));
}

/** Motståndare på samma position, flest möten först. */
export function opponents(rows, { minGames = 2, limit = 8 } = {}) {
  const map = new Map();
  for (const r of rows) {
    if (r.opponent_champion_id == null) continue;
    const o = map.get(r.opponent_champion_id) || { championId: r.opponent_champion_id, games: 0, wins: 0 };
    o.games++;
    if (r.win) o.wins++;
    map.set(r.opponent_champion_id, o);
  }
  return [...map.values()]
    .filter((o) => o.games >= minGames)
    .map((o) => ({ ...o, winrate: round((o.wins / o.games) * 100, 0) }))
    .sort((a, b) => b.games - a.games || a.winrate - b.winrate)
    .slice(0, limit);
}

/** Mastery för en champion över alla konton. */
export function masterySummary(mastery, championId = NUNU) {
  const rows = mastery.filter((m) => m.champion_id === championId);
  return {
    points: rows.reduce((s, m) => s + Number(m.points || 0), 0),
    level: rows.reduce((mx, m) => Math.max(mx, m.level || 0), 0),
    lastPlayed: rows.reduce((mx, m) => (m.last_play_time && m.last_play_time > mx ? m.last_play_time : mx), ''),
    perAccount: rows,
  };
}

/**
 * Hela karriären: äldre säsonger (nunu.season_history, förda in för hand) plus synkade matcher.
 *   history:  rader { season, champion_id, games, wins, kills, deaths, assists, ended } – K/D/A är snitt per match
 *   synced:   redan filtrerade matcher från account_match. Matcher före säsongernas senaste
 *             slutdatum (ended) räknas inte – de finns redan med i säsongen.
 *   champion: champion-id eller null för alla
 * Säsongerna sorteras äldst först. Synkade matcher blir en egen rad sist.
 */
export function careerSummary(history, synced, { champion = NUNU } = {}) {
  const line = (games, wins, k, d, a) => ({
    games,
    wins,
    losses: games - wins,
    winrate: games ? round((wins / games) * 100, 0) : null,
    kda: games ? round((k + a) / Math.max(1, d), 2) : null,
    k, d, a,
  });
  const bySeason = new Map();
  for (const h of history) {
    if (champion != null && h.champion_id !== champion) continue;
    const s = bySeason.get(h.season) || { games: 0, wins: 0, k: 0, d: 0, a: 0 };
    const g = Number(h.games);
    s.games += g;
    s.wins += Number(h.wins);
    s.k += Number(h.kills) * g;
    s.d += Number(h.deaths) * g;
    s.a += Number(h.assists) * g;
    bySeason.set(h.season, s);
  }
  const seasons = [...bySeason.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([season, s]) => ({ season, ...line(s.games, s.wins, s.k, s.d, s.a) }));

  const cutoff = history.reduce((mx, h) => (h.ended && h.ended > mx ? h.ended : mx), '');
  if (cutoff) synced = synced.filter((r) => String(r.game_start) >= cutoff);
  const sum = (f) => synced.reduce((t, r) => t + (Number(r[f]) || 0), 0);
  const recent = {
    since: synced.reduce((mn, r) => (!mn || String(r.game_start) < mn ? String(r.game_start) : mn), ''),
    ...line(synced.length, synced.filter((r) => r.win).length, sum('kills'), sum('deaths'), sum('assists')),
  };

  const all = [...seasons, recent];
  const total = line(
    all.reduce((t, s) => t + s.games, 0),
    all.reduce((t, s) => t + s.wins, 0),
    all.reduce((t, s) => t + s.k, 0),
    all.reduce((t, s) => t + s.d, 0),
    all.reduce((t, s) => t + s.a, 0),
  );
  return { seasons, recent, total };
}

export const DEATH_WINDOWS = [[0, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, Infinity]];

/**
 * Skada och dödsfall ur tidslinjerna, för redan filtrerade matcher.
 *   rows:   matcher (account_match), bara de med tidslinje räknas
 *   deaths: dödsfall (nunu.death) – filtreras till rows
 * Vinster och förluster jämförs sida vid sida. null om ingen match har tidslinje.
 */
export function damageReport(rows, deaths) {
  const tl = rows.filter((r) => r.damage_at10 != null);
  if (!tl.length) return null;
  const key = (r) => `${r.puuid}|${r.match_id}`;
  const keys = new Set(tl.map(key));
  const own = deaths.filter((d) => keys.has(key(d)));
  const deathsIn = new Map();
  for (const d of own) deathsIn.set(key(d), (deathsIn.get(key(d)) || 0) + 1);

  const avg = (list, f) => (list.length ? list.reduce((s, r) => s + (Number(f(r)) || 0), 0) / list.length : null);
  const side = (list) => ({
    games: list.length,
    perMin: list.length ? round(avg(list, (r) => r.damage / Math.max(1, r.duration_s / 60)), 0) : null,
    at10: list.length ? round(avg(list, (r) => r.damage_at10), 0) : null,
    at14: list.length ? round(avg(list, (r) => r.damage_at14), 0) : null,
    share: list.length ? round(avg(list, (r) => r.team_share), 0) : null,
    deaths: list.length ? round(avg(list, (r) => deathsIn.get(key(r)) || 0)) : null,
  });

  const killers = new Map();
  for (const d of own) {
    const ids = new Set([d.killer_champion_id, ...(d.helper_champion_ids || [])]);
    for (const id of ids) {
      const k = killers.get(id) || { championId: id, involved: 0, killed: 0 };
      k.involved++;
      if (id === d.killer_champion_id) k.killed++;
      killers.set(id, k);
    }
  }
  const places = { camp: 0, objective: 0, torn: 0, 'våg': 0 };
  for (const d of own) for (const p of d.places || []) if (p in places) places[p]++;

  return {
    games: tl.length,
    win: side(tl.filter((r) => r.win)),
    loss: side(tl.filter((r) => !r.win)),
    deaths: {
      total: own.length,
      perGame: round(own.length / tl.length),
      before15: round(own.filter((d) => d.t_ms < 15 * 60000).length / tl.length),
      solo: own.filter((d) => d.killer_champion_id != null && !(d.helper_champion_ids || []).length).length,
      byWindow: DEATH_WINDOWS.map(([a, b]) => ({
        label: b === Infinity ? `${a}+` : `${a}–${b}`,
        count: own.filter((d) => d.t_ms >= a * 60000 && d.t_ms < b * 60000).length,
      })),
      places,
      killers: [...killers.values()].sort((a, b) => b.involved - a.involved || b.killed - a.killed).slice(0, 6),
    },
  };
}

/* ---------------- Ganks (docs/nunu-early-game.md, modul 1) ---------------- */

export const GANK_LANES = ['top', 'mid', 'bot'];
const gankOutcome = (g) => (g.takedowns === 0 ? 'död' : g.died ? 'byte' : 'lyckad');
const pct = (a, b) => (b ? round((a / b) * 100, 0) : null);

/**
 * Ganks före 15:00 för redan filtrerade matcher. Bara matcher där ganks är uträknade
 * (du spelade jungle och tidslinjen finns) räknas. null om det inte finns några.
 */
export function gankReport(rows) {
  const games = rows.filter((r) => Array.isArray(r.ganks));
  if (!games.length) return null;
  const all = games.flatMap((r) => r.ganks.map((g) => ({ ...g, win: r.win })));
  const ganks = all.filter((g) => g.takedowns > 0);
  const winrate = (list) => ({ games: list.length, winrate: pct(list.filter((r) => r.win).length, list.length) });

  const firsts = games.map((r) => ({ win: r.win, first: r.ganks.find((g) => g.takedowns > 0) || null }));
  const withFirst = firsts.filter((f) => f.first);
  const times = withFirst.map((f) => f.first.t).sort((a, b) => a - b);

  const lanes = GANK_LANES.map((lane) => {
    const list = ganks.filter((g) => g.lane === lane);
    const firstHere = withFirst.filter((f) => f.first.lane === lane);
    return {
      lane,
      ganks: list.length,
      success: pct(list.filter((g) => !g.died).length, list.length),
      trades: list.filter((g) => g.died).length,
      takedowns: list.reduce((s, g) => s + g.takedowns, 0),
      firstShare: pct(firstHere.length, withFirst.length),
      firstWin: winrate(firstHere),
    };
  });

  const byCount = [[0, 0, '0'], [1, 1, '1'], [2, 2, '2'], [3, Infinity, '3+']].map(([a, b, label]) => {
    const list = games.filter((r) => {
      const n = r.ganks.filter((g) => g.takedowns > 0).length;
      return n >= a && n <= b;
    });
    return { label, ...winrate(list) };
  });

  return {
    games: games.length,
    ganks: ganks.length,
    perGame: round(ganks.length / games.length),
    success: pct(ganks.filter((g) => !g.died).length, ganks.length),
    trades: ganks.filter((g) => g.died).length,
    takedowns: ganks.reduce((s, g) => s + g.takedowns, 0),
    vsJungler: ganks.filter((g) => g.vsJungler).length,
    laneDeaths: all.filter((g) => g.takedowns === 0).length,
    first: {
      median: times.length ? times[Math.floor((times.length - 1) / 2)] : null,
      lyckad: winrate(withFirst.filter((f) => gankOutcome(f.first) === 'lyckad')),
      byte: winrate(withFirst.filter((f) => gankOutcome(f.first) === 'byte')),
      ingen: winrate(firsts.filter((f) => !f.first)),
    },
    lanes,
    byCount,
  };
}
