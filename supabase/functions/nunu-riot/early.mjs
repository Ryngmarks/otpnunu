/*
 * Early game ur tidslinjen: rena funktioner, match + tidslinje in, siffror ut.
 * Se docs/nunu-early-game.md (modul 2 och 5).
 *   - guld, XP, nivå och CS vid 5, 10 och 15 min för dig och motståndaren på din position
 *   - dina kills, deaths och assists fram till samma tidpunkter
 *   - first blood: var du med (kill/assist), dog du, eller hände det utan dig
 */

export const EARLY_MINUTES = [5, 10, 15];
const TOLERANCE_MS = 30000; // en frame per minut – tidpunkten måste ligga nära

/** Frame närmast minuten, eller null om matchen tog slut innan (eller frames saknas). */
function frameAt(frames, minute) {
  const target = minute * 60000;
  let best = null;
  for (const f of frames) {
    if (Math.abs(f.timestamp - target) <= TOLERANCE_MS && (!best || Math.abs(f.timestamp - target) < Math.abs(best.timestamp - target))) best = f;
  }
  return best;
}

/** Guld, XP, nivå och CS för en spelare i en frame. Riot utelämnar fält som är 0. */
function stats(frame, participantId) {
  const p = frame?.participantFrames?.[String(participantId)];
  if (!p) return null;
  return {
    gold: p.totalGold || 0,
    xp: p.xp || 0,
    level: p.level || 0,
    cs: (p.minionsKilled || 0) + (p.jungleMinionsKilled || 0),
  };
}

/**
 * Early game för spelaren. null om spelaren saknas i matchen eller tidslinjen.
 *   { me: { 5: { gold, xp, level, cs, k, d, a }, 10: …, 15: … },
 *     opp: { 5: { gold, xp, level, cs }, … } | null,   // motståndaren på samma position
 *     firstBlood: 'kill' | 'assist' | 'died' | null }  // null = utan dig (eller ingen kill)
 * Minuter som matchen inte nådde saknas.
 */
export function deriveEarly(match, timeline, puuids) {
  const ids = [].concat(puuids);
  const parts = match?.info?.participants || [];
  const me = parts.find((p) => ids.includes(p.puuid));
  const tlMe = timeline?.info?.participants?.find((p) => ids.includes(p.puuid));
  if (!me || !tlMe) return null;
  const myId = tlMe.participantId;
  const opp = me.teamPosition ? parts.find((p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition) : null;

  const frames = timeline.info.frames || [];
  const kills = frames.flatMap((f) => f.events || [])
    .filter((e) => e.type === 'CHAMPION_KILL')
    .sort((a, b) => a.timestamp - b.timestamp);

  const result = { me: {}, opp: opp ? {} : null, firstBlood: null };
  for (const minute of EARLY_MINUTES) {
    const frame = frameAt(frames, minute);
    const mine = stats(frame, myId);
    if (!mine) continue;
    const until = kills.filter((e) => e.timestamp <= minute * 60000);
    result.me[minute] = {
      ...mine,
      k: until.filter((e) => e.killerId === myId).length,
      d: until.filter((e) => e.victimId === myId).length,
      a: until.filter((e) => (e.assistingParticipantIds || []).includes(myId)).length,
    };
    const theirs = opp ? stats(frame, opp.participantId) : null;
    if (theirs) result.opp[minute] = theirs;
  }

  const first = kills[0];
  if (first) {
    if (first.killerId === myId) result.firstBlood = 'kill';
    else if ((first.assistingParticipantIds || []).includes(myId)) result.firstBlood = 'assist';
    else if (first.victimId === myId) result.firstBlood = 'died';
  }
  return result;
}

/**
 * Lagen ur matchen (ingen tidslinje behövs): lagkamraternas och motståndarnas champions,
 * och hur stor del av motståndarlagets skada mot champions som var magisk (%).
 */
export function deriveTeams(match, puuids) {
  const ids = [].concat(puuids);
  const parts = match?.info?.participants || [];
  const me = parts.find((p) => ids.includes(p.puuid));
  if (!me) return null;
  const enemies = parts.filter((p) => p.teamId !== me.teamId);
  const magic = enemies.reduce((s, p) => s + (p.magicDamageDealtToChampions || 0), 0);
  const total = enemies.reduce((s, p) => s + (p.totalDamageDealtToChampions || 0), 0);
  return {
    allies: parts.filter((p) => p.teamId === me.teamId && p !== me).map((p) => p.championId),
    enemies: enemies.map((p) => p.championId),
    enemy_ap_share: total ? Math.round((magic / total) * 1000) / 10 : null,
  };
}
