/*
 * Databas i minnet med samma gränssnitt som supabase/functions/nunu-riot/db.mjs
 * (inklusive tidslinjerna i Storage) – för tester och dev-servern.
 * Kontrollerar de främmande nycklarna så att synkens skrivordning testas.
 */
export function memoryDb({ members = ['user-1', 'user-2'] } = {}) {
  const t = {
    profile: [], riot_account: [], raw_match: new Map(), account_match: new Map(),
    death: [], mastery: new Map(), storage: new Map(),
  };
  const check = (ok, msg) => { if (!ok) throw new Error(`Främmande nyckel: ${msg}`); };
  let n = 0;
  return {
    t,
    isMember: async (userId) => members.includes(userId),
    ensureProfile: async (userId) => {
      let p = t.profile.find((x) => x.user_id === userId);
      if (!p) t.profile.push((p = { id: `profile-${++n}`, user_id: userId, display_name: '' }));
      return p;
    },
    getAccount: async (puuid) => t.riot_account.find((a) => a.puuid === puuid) || null,
    listAccounts: async (profileId) => t.riot_account.filter((a) => a.profile_id === profileId),
    upsertAccount: async (row) => {
      const a = t.riot_account.find((x) => x.puuid === row.puuid);
      if (a) Object.assign(a, row);
      else t.riot_account.push({ linked_at: new Date().toISOString(), last_synced_at: null, backfill_done: false, ...row });
    },
    updateAccount: async (puuid, fields) => { Object.assign(t.riot_account.find((a) => a.puuid === puuid) || {}, fields); },
    knownMatchIds: async (puuid) => new Set([...t.account_match.values()].filter((r) => r.puuid === puuid).map((r) => r.match_id)),
    staleMatchIds: async (puuid, version) => [...t.account_match.values()]
      .filter((r) => r.puuid === puuid && r.derived_version < version)
      .sort((a, b) => String(b.game_start).localeCompare(String(a.game_start)))
      .map((r) => r.match_id),
    getRawMatches: async (ids) => ids.filter((id) => t.raw_match.has(id)).map((id) => ({ match_id: id, payload: t.raw_match.get(id).payload })),
    insertRawMatches: async (rows) => rows.forEach((r) => { if (!t.raw_match.has(r.match_id)) t.raw_match.set(r.match_id, r); }),
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
    getTimeline: async (matchId) => (t.storage.has(matchId) ? structuredClone(t.storage.get(matchId)) : null),
    storeTimeline: async (matchId, timeline) => { t.storage.set(matchId, structuredClone(timeline)); },
  };
}
