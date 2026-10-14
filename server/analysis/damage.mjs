/*
 * Tidslinjeanalys av en match: rena funktioner, match + tidslinje (Riot match-v5) in, siffror ut.
 * Används av synken (server/riot/derive.mjs).
 * Ingen nätverkstrafik och ingen disk här, så allt kan testas med små exempel.
 */

const mmss = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const participantId = (timeline, puuid) => {
  const p = timeline.info.participants.find((x) => x.puuid === puuid);
  if (!p) throw new Error('Spelaren finns inte i tidslinjen');
  return p.participantId;
};

/** Skada per minut ur tidslinjen: { minute, dealt, taken } (gjord resp. tagen under just den minuten). */
export function damageCurve(timeline, puuid) {
  const id = String(participantId(timeline, puuid));
  const out = [];
  let prev = { dealt: 0, taken: 0 };
  for (const f of timeline.info.frames) {
    const d = f.participantFrames && f.participantFrames[id] && f.participantFrames[id].damageStats;
    if (!d) continue;
    const now = { dealt: d.totalDamageDoneToChampions || 0, taken: d.totalDamageTaken || 0 };
    out.push({ minute: Math.round(f.timestamp / 60000), dealt: now.dealt - prev.dealt, taken: now.taken - prev.taken, total: now.dealt });
    prev = now;
  }
  return out.filter((x) => x.minute > 0);
}

/** Total skada mot champions vid en viss minut (t.ex. 10 och 14 – Nunus starka tid). */
export const damageAt = (curve, minute) => {
  const hit = curve.filter((x) => x.minute <= minute).pop();
  return hit ? hit.total : 0;
};

/** Var ett dödsfall skedde, utifrån skadan som inte kom från champions. */
export function placeOf(name = '', type = '') {
  if (type === 'TOWER' || /turret/i.test(name)) return 'torn';
  if (/dragon|baron|horde|riftherald|atakhan/i.test(name)) return 'objective';
  if (/blue|red|gromp|krug|murkwolf|razorbeak|crab/i.test(name)) return 'camp';
  if (/minion/i.test(name)) return 'våg';
  return null;
}

/** Dina dödsfall: vem som dödade dig, varifrån skadan kom och var det hände (places). */
export function deaths(timeline, match, puuid) {
  const id = participantId(timeline, puuid);
  const names = Object.fromEntries(match.info.participants.map((p) => [p.participantId, p.championName]));
  const champ = Object.fromEntries(match.info.participants.map((p) => [p.participantId, p.championId]));
  const out = [];
  for (const f of timeline.info.frames) {
    for (const e of f.events || []) {
      if (e.type !== 'CHAMPION_KILL' || e.victimId !== id) continue;
      const bySource = new Map();
      const places = new Set();
      for (const d of e.victimDamageReceived || []) {
        if (!d.participantId) { const pl = placeOf(d.name, d.type); if (pl) places.add(pl); }
        const name = d.participantId ? names[d.participantId] || d.name : d.name || 'Övrigt'; // 0 = torn/minion/monster
        const dmg = (d.physicalDamage || 0) + (d.magicDamage || 0) + (d.trueDamage || 0);
        bySource.set(name, (bySource.get(name) || 0) + dmg);
      }
      const sources = [...bySource.entries()].map(([name, damage]) => ({ name, damage })).sort((a, b) => b.damage - a.damage);
      out.push({
        time: mmss(e.timestamp),
        ms: e.timestamp,
        places: [...places],
        killer: e.killerId ? names[e.killerId] || 'Torn/minion' : 'Torn/minion',
        helpers: (e.assistingParticipantIds || []).map((x) => names[x]),
        killerChampionId: champ[e.killerId] ?? null,  // null = torn, minion eller monster
        helperChampionIds: (e.assistingParticipantIds || []).map((x) => champ[x]).filter((x) => x != null),
        total: sources.reduce((s, x) => s + x.damage, 0),
        sources,
      });
    }
  }
  return out;
}

/** Allt synken sparar från en tidslinje: skada vid 10/14/20 min och dödsfallen. null om spelaren saknas. */
export function deriveTimeline(timeline, match, puuid) {
  if (!timeline?.info?.participants?.some((p) => p.puuid === puuid)) return null;
  const curve = damageCurve(timeline, puuid);
  return {
    at10: damageAt(curve, 10),
    at14: damageAt(curve, 14),
    at20: damageAt(curve, 20),
    deaths: deaths(timeline, match, puuid),
  };
}
