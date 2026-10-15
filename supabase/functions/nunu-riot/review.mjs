/*
 * Matchgenomgång och laguppställning: rena funktioner, match (+ tidslinje) in, kompakt data ut.
 * Allt räknas ur rådata som redan sparas – inga extra anrop till Riot.
 *
 *   deriveLineup:     positioner för lagkamrater och motståndare (samma ordning som allies/enemies)
 *   deriveLoadout:    items, runor och summoner spells
 *   deriveObjectives: lagens objectives (drakar, baron, voidgrubs …) ur matchen
 *   deriveReview:     minut för minut mot motståndaren på din position, din väg de första 15 min,
 *                     dina kills/dödsfall/assists med plats, och alla elite monsters med tid
 */

const n = (v) => Number(v) || 0;

function find(match, puuids) {
  const ids = [].concat(puuids);
  const parts = match?.info?.participants || [];
  const me = parts.find((p) => ids.includes(p.puuid));
  return { ids, parts, me };
}

/** Positionerna i samma ordning som deriveTeams (allies/enemies). null utan roller. */
export function deriveLineup(match, puuids) {
  const { parts, me } = find(match, puuids);
  if (!me) return null;
  return {
    ally_positions: parts.filter((p) => p.teamId === me.teamId && p !== me).map((p) => p.teamPosition || null),
    enemy_positions: parts.filter((p) => p.teamId !== me.teamId).map((p) => p.teamPosition || null),
  };
}

/** Items (slot 0–6, utan tomma), keystone, runträd och summoner spells. */
export function deriveLoadout(match, puuids) {
  const { me } = find(match, puuids);
  if (!me) return null;
  const styles = me.perks?.styles || [];
  return {
    items: [0, 1, 2, 3, 4, 5].map((i) => n(me[`item${i}`])).filter(Boolean),
    trinket: n(me.item6) || null,
    keystone: n(styles[0]?.selections?.[0]?.perk) || null,
    primary: n(styles[0]?.style) || null,
    secondary: n(styles[1]?.style) || null,
    spells: [n(me.summoner1Id), n(me.summoner2Id)].filter(Boolean),
  };
}

const OBJECTIVES = ['dragon', 'baron', 'horde', 'riftHerald', 'tower', 'inhibitor', 'atakhan'];

/** Lagens objectives: { mine: { dragon, baron, … , firstDragon }, theirs: { … } }. */
export function deriveObjectives(match, puuids) {
  const { me } = find(match, puuids);
  const teams = match?.info?.teams || [];
  if (!me || !teams.length) return null;
  const side = (team) => {
    const o = team?.objectives || {};
    const out = {};
    for (const k of OBJECTIVES) if (o[k]) out[k] = n(o[k].kills);
    out.firstDragon = !!o.dragon?.first;
    out.firstBaron = !!o.baron?.first;
    out.firstTower = !!o.tower?.first;
    return out;
  };
  return {
    mine: side(teams.find((t) => t.teamId === me.teamId)),
    theirs: side(teams.find((t) => t.teamId !== me.teamId)),
  };
}

/**
 * Matchgenomgång ur tidslinjen. null utan tidslinje.
 *   minutes: [[guld, xp, cs, motståndarens guld, xp, cs] | motståndaren null] per minut
 *   path:    [[x, y]] din position minut 1–15
 *   events:  [{ t, k: 'kill'|'death'|'assist', x, y, vs }] (vs = offrets/mördarens champion)
 *   monsters:[{ t, type, sub, mine, me, x, y }]
 */
export function deriveReview(match, timeline, puuids) {
  const { ids, parts, me } = find(match, puuids);
  const tlMe = timeline?.info?.participants?.find((p) => ids.includes(p.puuid));
  if (!me || !tlMe) return null;
  const myId = tlMe.participantId;
  const opp = me.teamPosition ? parts.find((p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition) : null;
  const champOf = Object.fromEntries(parts.map((p) => [p.participantId, p.championId]));
  const frames = timeline.info.frames || [];

  const line = (pf) => (pf ? [n(pf.totalGold), n(pf.xp), n(pf.minionsKilled) + n(pf.jungleMinionsKilled)] : null);
  const minutes = frames.map((f) => {
    const mine = line(f.participantFrames?.[String(myId)]);
    const theirs = opp ? line(f.participantFrames?.[String(opp.participantId)]) : null;
    return mine ? [...mine, ...(theirs || [null, null, null])] : null;
  });

  const path = frames.slice(1, 16)
    .map((f) => f.participantFrames?.[String(myId)]?.position)
    .filter((p) => p && typeof p.x === 'number')
    .map((p) => [Math.round(p.x), Math.round(p.y)]);

  const all = frames.flatMap((f) => f.events || []).sort((a, b) => a.timestamp - b.timestamp);
  const events = [];
  for (const e of all) {
    if (e.type !== 'CHAMPION_KILL' || !e.position) continue;
    const at = { t: Math.round(e.timestamp / 1000), x: Math.round(e.position.x), y: Math.round(e.position.y) };
    if (e.killerId === myId) events.push({ ...at, k: 'kill', vs: champOf[e.victimId] || null });
    else if (e.victimId === myId) events.push({ ...at, k: 'death', vs: champOf[e.killerId] || null });
    else if ((e.assistingParticipantIds || []).includes(myId)) events.push({ ...at, k: 'assist', vs: champOf[e.victimId] || null });
  }

  const monsters = all
    .filter((e) => e.type === 'ELITE_MONSTER_KILL')
    .map((e) => ({
      t: Math.round(e.timestamp / 1000),
      type: e.monsterType || null,
      sub: e.monsterSubType || null,
      mine: e.killerTeamId ? e.killerTeamId === me.teamId : (parts.find((p) => p.participantId === e.killerId)?.teamId === me.teamId),
      me: e.killerId === myId || (e.assistingParticipantIds || []).includes(myId),
      x: e.position ? Math.round(e.position.x) : null,
      y: e.position ? Math.round(e.position.y) : null,
    }));

  return { minutes, path, events, monsters, oppChampion: opp ? opp.championId : null };
}
