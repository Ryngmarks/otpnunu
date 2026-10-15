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

  // När första ganken sker (minuter), för stapeldiagrammet
  const BINS = [[0, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 8], [8, 10], [10, 15]];
  const firstBins = BINS.map(([a, b]) => ({
    label: `${a}–${b}`,
    count: times.filter((t) => t >= a * 60000 && t < b * 60000).length,
    hasMedian: false,
  }));
  const median = times.length ? times[Math.floor((times.length - 1) / 2)] : null;
  if (median != null) {
    const i = BINS.findIndex(([a, b]) => median >= a * 60000 && median < b * 60000);
    if (i >= 0) firstBins[i].hasMedian = true;
  }

  return {
    games: games.length,
    ganks: ganks.length,
    perGame: round(ganks.length / games.length),
    firstBins,
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

/* ---------------- Early game, synergier, matchups (docs/nunu-early-game.md, modul 2–5) ---------------- */

export const EARLY_MINUTES = [5, 10, 15];
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const winrateOf = (list) => ({ games: list.length, wins: list.filter((r) => r.win).length, winrate: pct(list.filter((r) => r.win).length, list.length) });
const diffAt = (r, minute, key) => {
  const me = r.early?.me?.[minute];
  const opp = r.early?.opp?.[minute];
  return me && opp ? me[key] - opp[key] : null;
};

/** Modul 2: snitt vid 5/10/15 min, och diff mot motståndaren på din position (vinster och förluster för sig). */
export function earlyReport(rows) {
  const games = rows.filter((r) => r.early && r.early.me);
  if (!games.length) return null;
  const minutes = EARLY_MINUTES.map((minute) => {
    const at = games.filter((r) => r.early.me[minute]);
    const avg = (key) => (at.length ? round(mean(at.map((r) => r.early.me[minute][key])), key === 'k' || key === 'd' || key === 'a' || key === 'level' ? 1 : 0) : null);
    const diff = (key, list = at) => {
      const xs = list.map((r) => diffAt(r, minute, key)).filter((x) => x != null);
      return xs.length ? round(mean(xs), 0) : null;
    };
    return {
      minute,
      games: at.length,
      gold: avg('gold'), xp: avg('xp'), cs: avg('cs'), level: avg('level'), k: avg('k'), d: avg('d'), a: avg('a'),
      goldDiff: diff('gold'), xpDiff: diff('xp'), csDiff: diff('cs'),
      goldDiffWin: diff('gold', at.filter((r) => r.win)),
      goldDiffLoss: diff('gold', at.filter((r) => !r.win)),
    };
  });
  return { games: games.length, minutes };
}

/**
 * Vinst och förlust per champion i lagkamraternas (key = 'allies') eller motståndarnas ('enemies')
 * lag. Alla champions räknas, även med en enda match.
 */
export function championTally(rows, key) {
  const map = new Map();
  for (const r of rows) {
    if (!Array.isArray(r[key])) continue;
    for (const id of r[key]) {
      const t = map.get(id) || { championId: id, games: 0, wins: 0 };
      t.games++;
      if (r.win) t.wins++;
      map.set(id, t);
    }
  }
  return [...map.values()].map((t) => ({ ...t, losses: t.games - t.wins, winrate: pct(t.wins, t.games) }));
}

/**
 * Modul 3: lagkamrater och motståndare (champions) med vinst och förlust. mostAllies/mostEnemies
 * är de man spelat flest matcher med/mot. minGames gäller bäst/sämst-listorna (insikterna).
 */
export function synergyReport(rows, { minGames = 1, limit = 5, mostLimit = 8 } = {}) {
  const games = rows.filter((r) => Array.isArray(r.allies) && Array.isArray(r.enemies));
  if (!games.length) return null;
  const allies = championTally(games, 'allies').filter((t) => t.games >= minGames);
  const enemies = championTally(games, 'enemies').filter((t) => t.games >= minGames);
  const best = (list) => [...list].sort((a, b) => b.winrate - a.winrate || b.games - a.games).slice(0, limit);
  const worst = (list) => [...list].sort((a, b) => a.winrate - b.winrate || b.games - a.games).slice(0, limit);
  const most = (list) => [...list].sort((a, b) => b.games - a.games || b.winrate - a.winrate).slice(0, mostLimit);
  return {
    games: games.length,
    baseline: winrateOf(games).winrate,
    minGames,
    mostAllies: most(allies),
    mostEnemies: most(enemies),
    bestAllies: best(allies),
    worstAllies: worst(allies),
    easiestEnemies: best(enemies),
    hardestEnemies: worst(enemies),
  };
}

/* ---------------- Live Scout ---------------- */

/**
 * Gränser för Live Scout. Alla matcher räknas alltid; underlaget avgör bara hur säkert det är.
 *   minGames: färre matcher = osäkert underlag (grått, statistiken kan inte stödja eller motsäga)
 *   solidGames: så många matcher = stabilt underlag
 *   margin: procentenheter från din vinst totalt som räknas som en tydlig skillnad
 */
export const SCOUT = { minGames: 5, solidGames: 15, margin: 5 };
export const SCOUT_SIDES = { with: 'allies', against: 'enemies' };

/** Underlaget för en champion: 'osäkert' (1–4), 'begränsat' (5–14) eller 'stabilt' (15+). */
export function scoutSupport(games) {
  if (games >= SCOUT.solidGames) return 'stabilt';
  if (games >= SCOUT.minGames) return 'begränsat';
  return 'osäkert';
}

/** Vad statistiken säger jämfört med din vinst totalt: 'pos', 'neg', 'jämnt' eller null (för lite underlag). */
export function scoutSignal(entry, baseline) {
  if (!entry || entry.games < SCOUT.minGames || baseline == null) return null;
  const d = entry.winrate - baseline;
  if (d >= SCOUT.margin) return 'pos';
  if (d <= -SCOUT.margin) return 'neg';
  return 'jämnt';
}

/**
 * Färg för en champion: din bedömning (1 = positiv, -1 = negativ, null = ingen) mot statistiken.
 *   green  – positiv bedömning som statistiken stödjer
 *   red    – negativ bedömning som statistiken stödjer
 *   orange – bedömningen och statistiken säger emot varandra
 *   gray   – bedömning eller tydligt statistiskt underlag saknas
 */
export function scoutColor(opinion, signal) {
  if (!opinion || !signal || signal === 'jämnt') return 'gray';
  const pos = opinion > 0;
  if (pos && signal === 'pos') return 'green';
  if (!pos && signal === 'neg') return 'red';
  return 'orange';
}

/**
 * Alla champions du spelat med (side 'with') eller mot ('against'), med vinster, förluster,
 * underlag, din bedömning och färg. opinions: [{ champion_id, side, opinion, note }].
 */
export function scoutTable(rows, opinions = [], side = 'against') {
  const games = rows.filter((r) => Array.isArray(r.allies) && Array.isArray(r.enemies));
  const baseline = games.length ? winrateOf(games).winrate : null;
  const own = new Map(opinions.filter((o) => o.side === side).map((o) => [o.champion_id, o]));
  const byId = new Map(championTally(games, SCOUT_SIDES[side]).map((t) => [t.championId, t]));
  // Champions du har en bedömning om men aldrig mött visas också (grått, 0 matcher)
  for (const id of own.keys()) if (!byId.has(id)) byId.set(id, { championId: id, games: 0, wins: 0, losses: 0, winrate: null });
  const list = [...byId.values()].map((t) => {
    const o = own.get(t.championId);
    const opinion = o ? o.opinion : null;
    const signal = scoutSignal(t, baseline);
    return {
      ...t,
      diff: t.winrate == null || baseline == null ? null : t.winrate - baseline,
      support: scoutSupport(t.games),
      opinion,
      note: o ? o.note || '' : '',
      signal,
      color: scoutColor(opinion, signal),
    };
  }).sort((a, b) => b.games - a.games || (b.winrate ?? -1) - (a.winrate ?? -1));
  return { side, games: games.length, baseline, list };
}

/** Uppslag för champ select: en rad per vald champion (även okända, med 0 matcher). */
export function scoutPicks(table, ids) {
  const byId = new Map(table.list.map((e) => [e.championId, e]));
  return ids.filter((id) => id != null).map((id) => byId.get(id) || {
    championId: id, games: 0, wins: 0, losses: 0, winrate: null, diff: null,
    support: 'osäkert', opinion: null, note: '', signal: null, color: 'gray',
  });
}

/* ---------------- Champion Library (samma motor som Live Scout) ---------------- */

/** Kögrupper som aldrig blandas: Ranked-statistiken är bara Solo/Duo och Flex. */
export const QUEUE_GROUPS = {
  solo: QUEUE_FILTERS.solo.queues,
  flex: QUEUE_FILTERS.flex.queues,
  normal: QUEUE_FILTERS.normal.queues,
};
const RANKED = QUEUE_FILTERS.ranked.queues;
const tallyOf = (list) => {
  const w = winrateOf(list);
  return { games: w.games, wins: w.wins, losses: w.games - w.wins, winrate: w.winrate };
};

/**
 * Bara motståndarens jungler: matcher där du spelade jungle, med motståndarlaget ersatt av
 * jungler-motståndaren (opponent_champion_id). Samma motor räknar sedan som vanligt.
 * Lagkamraternas positioner sparas inte, så filtret gäller bara motståndare.
 */
export function junglerRows(rows) {
  return rows
    .filter((r) => r.team_position === 'JUNGLE' && r.opponent_champion_id != null)
    .map((r) => ({ ...r, enemies: [r.opponent_champion_id] }));
}

/** Matcherna där championen var lagkamrat (side 'with') eller motståndare ('against'), nyast först. */
export function championGames(rows, championId, side) {
  const key = SCOUT_SIDES[side];
  return rows
    .filter((r) => Array.isArray(r[key]) && r[key].includes(championId))
    .sort((a, b) => String(b.game_start).localeCompare(String(a.game_start)));
}

/**
 * Biblioteket: ett kort per champion med Solo/Duo och Flex för sig. Färg och underlag kommer från
 * scoutTable på Ranked-matcherna (Solo/Duo + Flex), så korten och Live Scout använder samma modell.
 * Champions du bara mött i Normal eller bara har en bedömning om finns också med (Ranked: 0 matcher).
 */
export function libraryTable(rows, opinions = [], side = 'against') {
  const key = SCOUT_SIDES[side];
  const ranked = scoutTable(rows.filter((r) => RANKED.includes(r.queue_id)), opinions, side);
  const per = Object.fromEntries(Object.entries(QUEUE_GROUPS).map(([g, queues]) =>
    [g, new Map(championTally(rows.filter((r) => queues.includes(r.queue_id)), key).map((t) => [t.championId, t]))]));
  const byId = new Map(ranked.list.map((e) => [e.championId, e]));
  const own = new Map(opinions.filter((o) => o.side === side).map((o) => [o.champion_id, o]));
  for (const id of per.normal.keys()) {
    if (!byId.has(id)) byId.set(id, scoutPicks(ranked, [id])[0]);
  }
  const empty = { games: 0, wins: 0, losses: 0, winrate: null };
  const list = [...byId.values()].map((e) => ({
    ...e,
    strategy: (own.get(e.championId) || {}).strategy || '',
    ranked: { games: e.games, wins: e.wins, losses: e.losses, winrate: e.winrate },
    solo: per.solo.get(e.championId) || empty,
    flex: per.flex.get(e.championId) || empty,
    normal: per.normal.get(e.championId) || empty,
  })).sort((a, b) => b.ranked.games - a.ranked.games || b.normal.games - a.normal.games);
  return { side, games: ranked.games, baseline: ranked.baseline, list };
}

/**
 * Detaljvyn för en champion: allt räknas på matcherna med/mot den. Saknas data blir värdet null
 * (visas som –) och varje värde har sitt eget antal matcher (n).
 */
export function championProfile(rows, championId, side, opinions = []) {
  const games = championGames(rows, championId, side);
  const entry = libraryTable(rows, opinions, side).list.find((e) => e.championId === championId)
    || { ...scoutPicks({ list: [] }, [championId])[0], strategy: '', ranked: tallyOf([]), solo: tallyOf([]), flex: tallyOf([]), normal: tallyOf([]) };
  const s = summarize(games);
  const withDamage = games.filter((r) => r.damage != null && r.duration_s);
  const avg = (list, f) => (list.length ? round(mean(list.map(f)), 0) : null);
  const early = (minute, k) => {
    const xs = games.map((r) => diffAt(r, minute, k)).filter((x) => x != null);
    return { value: xs.length ? round(mean(xs), 0) : null, n: xs.length };
  };
  const d10 = games.filter((r) => r.early?.me?.[10]);
  const fb = games.filter((r) => r.early && r.early.firstBlood !== undefined);
  return {
    ...entry,
    championId,
    side,
    total: tallyOf(games),
    byQueue: Object.fromEntries(Object.entries(QUEUE_GROUPS).map(([g, queues]) => [g, tallyOf(games.filter((r) => queues.includes(r.queue_id)))])),
    kda: { value: s.kda, k: s.kills, d: s.deaths, a: s.assists, n: s.games },
    damage: {
      avg: avg(withDamage, (r) => Number(r.damage)),
      perMin: avg(withDamage, (r) => Number(r.damage) / (r.duration_s / 60)),
      n: withDamage.length,
    },
    early: {
      goldDiff10: early(10, 'gold'),
      xpDiff10: early(10, 'xp'),
      csDiff10: early(10, 'cs'),
      deaths10: { value: d10.length ? round(mean(d10.map((r) => r.early.me[10].d)), 1) : null, n: d10.length },
      firstBlood: { value: fb.length ? pct(fb.filter((r) => r.early.firstBlood === 'kill' || r.early.firstBlood === 'assist').length, fb.length) : null, n: fb.length },
    },
    games,
  };
}

/** Grovt: motståndarlaget räknas som "tung" i en typ om minst två champions har den som första tagg. */
export const COMP_TYPES = { Tank: 'Tanks', Assassin: 'Assassins', Mage: 'Mages', Fighter: 'Fighters', Marksman: 'Marksmen' };

/** Modul 4: mot motståndarens jungler (med early-diff) och mot olika lagkompositioner. */
export function matchupReport(rows, { tags = () => [], minGames = 3, limit = 8 } = {}) {
  if (!rows.length) return null;
  const junglers = new Map();
  for (const r of rows) {
    if (r.opponent_champion_id == null) continue;
    const j = junglers.get(r.opponent_champion_id) || { championId: r.opponent_champion_id, list: [] };
    j.list.push(r);
    junglers.set(r.opponent_champion_id, j);
  }
  const vsJungler = [...junglers.values()]
    .filter((j) => j.list.length >= minGames)
    .map((j) => {
      const g10 = j.list.map((r) => diffAt(r, 10, 'gold')).filter((x) => x != null);
      const x10 = j.list.map((r) => diffAt(r, 10, 'xp')).filter((x) => x != null);
      return { championId: j.championId, ...winrateOf(j.list), goldDiff10: g10.length ? round(mean(g10), 0) : null, xpDiff10: x10.length ? round(mean(x10), 0) : null };
    })
    .sort((a, b) => b.games - a.games)
    .slice(0, limit);

  const profiles = [
    ['Mest AD (under 35 % magisk skada)', (s) => s < 35],
    ['Blandad skada', (s) => s >= 35 && s <= 55],
    ['Mest AP (över 55 % magisk skada)', (s) => s > 55],
  ].map(([label, test]) => ({ label, ...winrateOf(rows.filter((r) => r.enemy_ap_share != null && test(Number(r.enemy_ap_share)))) }));

  const withEnemies = rows.filter((r) => Array.isArray(r.enemies) && r.enemies.length);
  const hasTags = withEnemies.some((r) => r.enemies.some((id) => tags(id).length));
  const comps = hasTags
    ? Object.entries(COMP_TYPES).map(([tag, label]) => ({
      label: `2+ ${label}`,
      ...winrateOf(withEnemies.filter((r) => r.enemies.filter((id) => tags(id)[0] === tag).length >= 2)),
    })).filter((c) => c.games >= minGames)
    : [];

  return { vsJungler, profiles, comps };
}

/** Modul 5: hur tidig prestation hänger ihop med vinst (samband, inte orsak). */
export function impactReport(rows) {
  const games = rows.filter((r) => r.early && r.early.me);
  if (!games.length) return null;
  const group = (label, list) => ({ label, ...winrateOf(list) });
  const g10 = (r) => diffAt(r, 10, 'gold');
  const withDiff = games.filter((r) => g10(r) != null);
  const deaths10 = (r) => (r.early.me[10] ? r.early.me[10].d : null);
  const withD = games.filter((r) => deaths10(r) != null);
  const fb = games.filter((r) => r.early.firstBlood !== undefined);
  return {
    goldDiff10: [
      group('Mer än 1 000 efter', withDiff.filter((r) => g10(r) < -1000)),
      group('300–1 000 efter', withDiff.filter((r) => g10(r) >= -1000 && g10(r) < -300)),
      group('Jämnt (±300)', withDiff.filter((r) => g10(r) >= -300 && g10(r) <= 300)),
      group('300–1 000 före', withDiff.filter((r) => g10(r) > 300 && g10(r) <= 1000)),
      group('Mer än 1 000 före', withDiff.filter((r) => g10(r) > 1000)),
    ],
    deaths10: [
      group('0 dödsfall', withD.filter((r) => deaths10(r) === 0)),
      group('1 dödsfall', withD.filter((r) => deaths10(r) === 1)),
      group('2+ dödsfall', withD.filter((r) => deaths10(r) >= 2)),
    ],
    firstBlood: [
      group('Du tog first blood', fb.filter((r) => r.early.firstBlood === 'kill')),
      group('Assist på first blood', fb.filter((r) => r.early.firstBlood === 'assist')),
      group('Du dog först', fb.filter((r) => r.early.firstBlood === 'died')),
      group('Utan dig', fb.filter((r) => r.early.firstBlood == null)),
    ],
  };
}

/* ---------------- Elo (rank-historik, nunu.rank_snapshot) ---------------- */

export const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVISIONS = { IV: 0, III: 1, II: 2, I: 3 };
export const RANK_QUEUES = { RANKED_SOLO_5x5: 'Solo/Duo', RANKED_FLEX_SR: 'Flex' };
const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();

/** Rank som ett tal: 100 per division (Iron IV 0 LP = 0), Master och uppåt fortsätter med LP från 2 800. */
export function rankScore(r) {
  const tier = TIERS.indexOf(r.tier);
  if (tier < 0) return null;
  if (tier >= 7) return 2800 + (r.lp || 0);
  return tier * 400 + (DIVISIONS[r.division] ?? 0) * 100 + Math.min(100, r.lp || 0);
}

/** "Emerald II · 45 LP" */
export const rankLabel = (r) => `${cap(r.tier)}${r.division && TIERS.indexOf(r.tier) < 7 ? ` ${r.division}` : ''} · ${r.lp} LP`;

/** En serie per konto och kö, äldst först, med senaste rank och vinst/förlust. */
export function eloSeries(snapshots, accounts) {
  const byKey = new Map();
  for (const s of [...snapshots].sort((a, b) => String(a.taken_at).localeCompare(String(b.taken_at)))) {
    const score = rankScore(s);
    if (score == null || !RANK_QUEUES[s.queue]) continue;
    const key = `${s.puuid}|${s.queue}`;
    if (!byKey.has(key)) byKey.set(key, { puuid: s.puuid, queue: s.queue, points: [] });
    byKey.get(key).points.push({ t: new Date(s.taken_at).getTime(), score, label: rankLabel(s), snap: s });
  }
  return [...byKey.values()]
    .map((sr) => {
      const accountIndex = Math.max(0, accounts.findIndex((a) => a.puuid === sr.puuid));
      const a = accounts[accountIndex];
      const now = sr.points[sr.points.length - 1].snap;
      const first = sr.points[0];
      return {
        ...sr,
        accountIndex,
        account: a ? `${a.game_name}#${a.tag_line}` : '?',
        queueLabel: RANK_QUEUES[sr.queue],
        current: rankLabel(now),
        wins: now.wins,
        losses: now.losses,
        winrate: pct(now.wins, now.wins + now.losses),
        change: sr.points[sr.points.length - 1].score - first.score,
      };
    })
    .sort((a, b) => a.accountIndex - b.accountIndex || (a.queue === 'RANKED_SOLO_5x5' ? 0 : 1) - (b.queue === 'RANKED_SOLO_5x5' ? 0 : 1));
}

/** Y-axelns linjer: tier-gränser, eller divisioner om spannet är litet. */
export function eloTicks(min, max) {
  const ticks = [];
  const step = max - min > 700 ? 400 : 100;
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    if (v > 2800) continue;
    const tier = Math.min(7, Math.floor(v / 400));
    const div = Object.keys(DIVISIONS).find((k) => DIVISIONS[k] === Math.floor((v % 400) / 100));
    ticks.push({ value: v, label: tier >= 7 ? 'Master' : step === 400 ? cap(TIERS[tier]) : `${cap(TIERS[tier]).slice(0, 4)} ${div}` });
  }
  return ticks;
}

/* ---------------- Översikt: nyckeltal och insikter ---------------- */

/** Fyra nyckeltal överst: vinst, KDA, lyckade ganks och guld mot jungler vid 10 min. */
export function overviewKpis(rows) {
  const s = summarize(rows);
  const recent = summarize(rows.slice(0, 30));
  const g = gankReport(rows);
  const e = earlyReport(rows);
  const m10 = e && e.minutes.find((m) => m.minute === 10);
  return {
    winrate: s.winrate, wins: s.wins, losses: s.losses, recentWinrate: recent.games >= 10 ? recent.winrate : null,
    kda: s.kda, k: s.kills, d: s.deaths, a: s.assists,
    gankSuccess: g ? g.success : null, gankPerGame: g ? g.perGame : null,
    goldDiff10: m10 ? m10.goldDiff : null,
  };
}

/**
 * Två–tre korta insikter i klartext ur rapporterna: den grupp som vinner mest och minst
 * (minst minGames matcher), och svårast/bäst champion. Samband, inte orsak.
 */
export function insights(rows, { minGames = 10 } = {}) {
  const out = [];
  const base = summarize(rows).winrate;
  if (base == null) return out;
  const groups = [];
  const imp = impactReport(rows);
  if (imp) {
    imp.goldDiff10.forEach((g) => groups.push({ ...g, text: `Guld vid 10 min: ${g.label.toLowerCase()}` }));
    imp.deaths10.forEach((g) => groups.push({ ...g, text: `${g.label} före 10 min` }));
    imp.firstBlood.forEach((g) => groups.push({ ...g, text: g.label }));
  }
  const gk = gankReport(rows);
  if (gk) {
    groups.push({ ...gk.first.lyckad, text: 'Lyckad första gank' });
    groups.push({ ...gk.first.ingen, text: 'Ingen gank före 15:00' });
  }
  const ok = groups.filter((g) => g.games >= minGames && g.winrate != null);
  const best = [...ok].sort((a, b) => b.winrate - a.winrate)[0];
  const worst = [...ok].sort((a, b) => a.winrate - b.winrate)[0];
  if (best && best.winrate > base) out.push({ tone: 'up', text: `${best.text} → ${best.winrate} % vinst (${best.games} matcher, mot ${base} % totalt).` });
  if (worst && worst !== best && worst.winrate < base) out.push({ tone: 'down', text: `${worst.text} → ${worst.winrate} % vinst (${worst.games} matcher).` });
  const syn = synergyReport(rows, { minGames: 5 });
  if (syn) {
    const hard = syn.hardestEnemies[0];
    const friend = syn.bestAllies[0];
    const parts = [];
    if (hard && hard.winrate < base) parts.push({ id: hard.championId, text: `Svårast mot {${hard.championId}} (${hard.winrate} %)` });
    if (friend && friend.winrate > base) parts.push({ id: friend.championId, text: `bäst med {${friend.championId}} (${friend.winrate} %)` });
    if (parts.length) out.push({ tone: 'info', text: `${parts.map((p) => p.text).join(', ')}.` });
  }
  return out;
}
