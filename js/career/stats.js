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
