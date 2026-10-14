/*
 * Skadeanalys av en match: rena funktioner, match + tidslinje (Riot match-v5) in, siffror ut.
 * Ingen nätverkstrafik och ingen disk här, så allt kan testas med små exempel.
 */

const mmss = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

/** Spelaren i matchen, och motståndaren på samma position. */
export function findMe(match, puuid) {
  const ps = match.info.participants;
  const me = ps.find((p) => p.puuid === puuid);
  if (!me) throw new Error(`Spelaren finns inte i ${match.metadata.matchId}`);
  const opponent = me.teamPosition
    ? ps.find((p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition) || null
    : null;
  return { me, opponent };
}

/** Skada enligt slutstatistiken i matchen. Riot utelämnar fält som är 0, därav `|| 0`. */
export function damageSummary(match, puuid) {
  const { me, opponent } = findMe(match, puuid);
  const v = (p, k) => p[k] || 0;
  const minutes = match.info.gameDuration / 60;
  const team = match.info.participants.filter((p) => p.teamId === me.teamId);
  const teamDamage = team.reduce((s, p) => s + v(p, 'totalDamageDealtToChampions'), 0);
  const dmg = v(me, 'totalDamageDealtToChampions');
  return {
    matchId: match.metadata.matchId,
    start: new Date(match.info.gameStartTimestamp || match.info.gameCreation).toISOString(),
    queueId: match.info.queueId,
    minutes: round(minutes, 1),
    champion: me.championName,
    opponent: opponent ? opponent.championName : null,
    win: !!me.win,
    kda: `${v(me, 'kills')}/${v(me, 'deaths')}/${v(me, 'assists')}`,
    toChampions: dmg,
    perMin: round(dmg / minutes),
    physical: v(me, 'physicalDamageDealtToChampions'),
    magic: v(me, 'magicDamageDealtToChampions'),
    true: v(me, 'trueDamageDealtToChampions'),
    teamShare: teamDamage ? round((dmg / teamDamage) * 100) : null,
    taken: v(me, 'totalDamageTaken'),
    mitigated: v(me, 'damageSelfMitigated'),
    objectives: v(me, 'damageDealtToObjectives'),
    opponentToChampions: opponent ? v(opponent, 'totalDamageDealtToChampions') : null,
  };
}

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
        total: sources.reduce((s, x) => s + x.damage, 0),
        sources,
      });
    }
  }
  return out;
}

/** Läsbar rapport för en match. */
export function formatReport(summary, curve, deathList) {
  const n = (x) => (x == null ? '–' : Number(x).toLocaleString('sv-SE'));
  const lines = [
    `${summary.win ? 'VINST ' : 'FÖRLUST'}  ${summary.champion}${summary.opponent ? ` mot ${summary.opponent}` : ''} · ${summary.kda} · ${String(summary.minutes).replace('.', ',')} min · ${summary.matchId}`,
    `  Skada mot champions: ${n(summary.toChampions)} (${n(summary.perMin)}/min, ${summary.teamShare ?? '–'} % av laget)` +
      (summary.opponentToChampions != null ? ` · motståndaren ${n(summary.opponentToChampions)}` : ''),
    `  Fysisk ${n(summary.physical)} · magisk ${n(summary.magic)} · sann ${n(summary.true)}`,
    `  Tagen skada ${n(summary.taken)} · mitigerad ${n(summary.mitigated)} · objectives ${n(summary.objectives)}`,
  ];
  if (curve.length) {
    lines.push(`  Skada vid 10 min: ${n(damageAt(curve, 10))} · 14 min: ${n(damageAt(curve, 14))} · 20 min: ${n(damageAt(curve, 20))}`);
    const best = [...curve].sort((a, b) => b.dealt - a.dealt).slice(0, 3).sort((a, b) => a.minute - b.minute);
    lines.push(`  Mest skada: ${best.map((x) => `min ${x.minute} (${n(x.dealt)})`).join(', ')}`);
  }
  if (deathList.length) {
    lines.push(`  Dödsfall (${deathList.length}):`);
    for (const d of deathList) {
      const from = d.sources.slice(0, 3).map((s) => `${s.name} ${n(s.damage)}`).join(', ');
      lines.push(`    ${d.time.padStart(5)}  ${d.killer}${d.helpers.length ? ` + ${d.helpers.join(', ')}` : ''} – ${n(d.total)} skada (${from})`);
    }
  }
  return lines.join('\n');
}
