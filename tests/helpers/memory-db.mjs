/*
 * Databas i minnet med samma gränssnitt som server/db.mjs – för tester och dev-servern.
 * Kontrollerar de främmande nycklarna så att synkens skrivordning testas.
 */
export function memoryDb({ history = [] } = {}) {
  const t = {
    riot_account: [], raw_match: new Map(), raw_timeline: new Map(),
    account_match: new Map(), death: [], mastery: new Map(), season_history: history,
  };
  const check = (ok, msg) => { if (!ok) throw new Error(`Främmande nyckel: ${msg}`); };
  return {
    t,
    getAccount: async (puuid) => t.riot_account.find((a) => a.puuid === puuid) || null,
    upsertAccount: async (row) => {
      const a = t.riot_account.find((x) => x.puuid === row.puuid);
      if (a) Object.assign(a, row);
      else t.riot_account.push({ linked_at: new Date().toISOString(), last_synced_at: null, backfill_done: false, ...row });
    },
    updateAccount: async (puuid, fields) => { Object.assign(t.riot_account.find((a) => a.puuid === puuid) || {}, fields); },
    knownMatchIds: async (puuid) => new Set([...t.account_match.values()].filter((r) => r.puuid === puuid).map((r) => r.match_id)),
    getRawMatches: async (ids) => ids.filter((id) => t.raw_match.has(id)).map((id) => ({ match_id: id, payload: t.raw_match.get(id).payload })),
    getRawTimelines: async (ids) => ids.filter((id) => t.raw_timeline.has(id)).map((id) => ({ match_id: id, payload: t.raw_timeline.get(id).payload })),
    insertRawMatches: async (rows) => rows.forEach((r) => { if (!t.raw_match.has(r.match_id)) t.raw_match.set(r.match_id, r); }),
    insertRawTimelines: async (rows) => rows.forEach((r) => {
      check(t.raw_match.has(r.match_id), 'tidslinje utan match');
      if (!t.raw_timeline.has(r.match_id)) t.raw_timeline.set(r.match_id, r);
    }),
    upsertAccountMatches: async (rows) => rows.forEach((r) => {
      check(t.raw_match.has(r.match_id), 'account_match utan rådata');
      check(t.riot_account.some((a) => a.puuid === r.puuid), 'account_match utan konto');
      t.account_match.set(`${r.puuid}|${r.match_id}`, r);
    }),
    replaceDeaths: async (matchIds, puuid, rows) => {
      t.death = t.death.filter((d) => !(d.puuid === puuid && matchIds.includes(d.match_id)));
      rows.forEach((r) => check(t.account_match.has(`${r.puuid}|${r.match_id}`), 'dödsfall utan match'));
      t.death.push(...rows);
    },
    upsertMastery: async (rows) => rows.forEach((r) => t.mastery.set(`${r.puuid}|${r.champion_id}`, r)),

    listAccounts: async () => [...t.riot_account],
    deleteAccount: async (puuid) => {
      t.riot_account = t.riot_account.filter((a) => a.puuid !== puuid);
      for (const [k, r] of t.account_match) if (r.puuid === puuid) t.account_match.delete(k);
      for (const [k, r] of t.mastery) if (r.puuid === puuid) t.mastery.delete(k);
      t.death = t.death.filter((d) => d.puuid !== puuid);
    },
    listMatches: async () => [...t.account_match.values()].sort((a, b) => String(b.game_start).localeCompare(String(a.game_start))),
    listMastery: async () => [...t.mastery.values()].map(({ payload, ...r }) => r),
    listHistory: async () => [...t.season_history],
    listDeaths: async () => t.death.map(({ sources, ...r }) => r),
  };
}
