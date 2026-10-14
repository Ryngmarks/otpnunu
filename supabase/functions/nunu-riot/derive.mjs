/*
 * Matchanalys: Riots rådata in → rader för databasen ut.
 * Rena funktioner utan anrop eller sidoeffekter, så att all statistik
 * kan räknas om från nunu.raw_match om reglerna ändras.
 *
 * Höj DERIVED_VERSION när reglerna ändras.
 */
export const DERIVED_VERSION = 1;
export const NUNU_CHAMPION_ID = 20;

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/** Matchlängd i sekunder. Äldre matcher (före patch 11.20) angav millisekunder. */
export function durationSeconds(info) {
  const d = Number(info.gameDuration) || 0;
  return info.gameEndTimestamp ? d : Math.round(d / 1000);
}

/**
 * En rad för nunu.account_match: matchen ur ett kontos perspektiv.
 * Returnerar null om kontot inte var med i matchen.
 */
export function deriveAccountMatch(match, puuid) {
  const info = (match && match.info) || {};
  const participants = info.participants || [];
  const p = participants.find((x) => x.puuid === puuid);
  if (!p) return null;

  const position = p.teamPosition || null; // tomt i lägen utan roller (t.ex. Arena)
  const opponent = position
    ? participants.find((x) => x.teamId !== p.teamId && x.teamPosition === position)
    : null;

  return {
    puuid,
    match_id: match.metadata.matchId,
    game_start: iso(info.gameStartTimestamp || info.gameCreation),
    queue_id: Number(info.queueId) || 0,
    duration_s: durationSeconds(info),
    champion_id: p.championId,
    team_position: position,
    win: p.win === true,
    // Remake: matchen avbröts tidigt och ska inte räknas i statistiken
    remake: p.gameEndedInEarlySurrender === true,
    kills: p.kills || 0,
    deaths: p.deaths || 0,
    assists: p.assists || 0,
    cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0),
    gold: p.goldEarned || 0,
    damage: p.totalDamageDealtToChampions || 0,
    vision: p.visionScore || 0,
    opponent_champion_id: opponent ? opponent.championId : null,
    derived_version: DERIVED_VERSION,
  };
}

/** En rad för nunu.raw_match. */
export function rawMatchRow(match, region) {
  const info = match.info || {};
  return {
    match_id: match.metadata.matchId,
    region,
    game_start: iso(info.gameStartTimestamp || info.gameCreation),
    payload: match,
  };
}

/** En rad för nunu.mastery från champion-mastery-v4. */
export function deriveMastery(entry, puuid) {
  return {
    puuid,
    champion_id: entry.championId,
    level: entry.championLevel || 0,
    points: entry.championPoints || 0,
    last_play_time: iso(entry.lastPlayTime),
    payload: entry,
  };
}
