/*
 * Matchanalys: Riots rådata in → rader för databasen ut.
 * Rena funktioner utan anrop eller sidoeffekter, så att all statistik
 * kan räknas om från rådatan om reglerna ändras.
 *
 * Höj DERIVED_VERSION när reglerna ändras.
 *   1: grundstatistik
 *   2: skada (typ, tagen, andel av laget, motståndarens) och tidslinjen (skada vid 10/14/20 min, dödsfall)
 *   3: ganks före 15:00 (gank.mjs)
 *   4: early game 5/10/15 min och first blood (early.mjs), lagen och motståndarnas AP-andel
 */
import { deriveTimeline } from './damage.mjs';
import { findGanks } from './gank.mjs';
import { deriveEarly, deriveTeams } from './early.mjs';

export const DERIVED_VERSION = 4;
export const NUNU_CHAMPION_ID = 20;

/** Köer på Summoner's Rift – bara för dem hämtas tidslinjen. */
export const RIFT_QUEUES = [400, 420, 430, 440, 490, 700];

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/** Matchlängd i sekunder. Äldre matcher (före patch 11.20) angav millisekunder. */
export function durationSeconds(info) {
  const d = Number(info.gameDuration) || 0;
  return info.gameEndTimestamp ? d : Math.round(d / 1000);
}

/**
 * En rad för nunu.account_match: matchen ur ett kontos perspektiv.
 * Med tidslinje kommer även skada vid 10/14/20 min med.
 * aliases: kontots tidigare PUUID (från en annan Riot-nyckel) – äldre rådata kan innehålla dem.
 * Returnerar null om kontot inte var med i matchen.
 */
export function deriveAccountMatch(match, puuid, timeline = null, aliases = []) {
  const info = (match && match.info) || {};
  const participants = info.participants || [];
  const ids = [puuid, ...aliases];
  const p = participants.find((x) => ids.includes(x.puuid));
  if (!p) return null;

  const position = p.teamPosition || null; // tomt i lägen utan roller (t.ex. Arena)
  const opponent = position
    ? participants.find((x) => x.teamId !== p.teamId && x.teamPosition === position)
    : null;
  // Riot utelämnar fält som är 0
  const teamDamage = participants.filter((x) => x.teamId === p.teamId).reduce((s, x) => s + (x.totalDamageDealtToChampions || 0), 0);
  const tl = timeline ? deriveTimeline(timeline, match, ids) : null;

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
    physical: p.physicalDamageDealtToChampions || 0,
    magic: p.magicDamageDealtToChampions || 0,
    true_damage: p.trueDamageDealtToChampions || 0,
    taken: p.totalDamageTaken || 0,
    mitigated: p.damageSelfMitigated || 0,
    objectives: p.damageDealtToObjectives || 0,
    team_share: teamDamage ? Math.round(((p.totalDamageDealtToChampions || 0) / teamDamage) * 1000) / 10 : null,
    opponent_damage: opponent ? opponent.totalDamageDealtToChampions || 0 : null,
    damage_at10: tl ? tl.at10 : null,
    damage_at14: tl ? tl.at14 : null,
    damage_at20: tl ? tl.at20 : null,
    ganks: tl ? findGanks(match, timeline, ids) : null,  // null = ingen tidslinje eller inte jungle
    early: tl ? deriveEarly(match, timeline, ids) : null,
    ...deriveTeams(match, ids),                           // allies, enemies, enemy_ap_share
    derived_version: DERIVED_VERSION,
  };
}

/** Rader för nunu.death ur tidslinjen. Tom lista utan tidslinje. */
export function deriveDeaths(match, puuid, timeline, aliases = []) {
  const tl = timeline ? deriveTimeline(timeline, match, [puuid, ...aliases]) : null;
  if (!tl) return [];
  const seen = new Set();
  return tl.deaths
    .filter((d) => !seen.has(d.ms) && seen.add(d.ms)) // samma millisekund två gånger – behåll en
    .map((d) => ({
      puuid,
      match_id: match.metadata.matchId,
      t_ms: d.ms,
      killer_champion_id: d.killerChampionId,
      helper_champion_ids: d.helperChampionIds,
      total: d.total,
      places: d.places,
      sources: d.sources,
    }));
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
