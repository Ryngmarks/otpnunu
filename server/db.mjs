/*
 * Databasåtkomst (PostgreSQL via paketet pg). Allt SQL i servern finns här.
 * Samma gränssnitt som låtsasdatabasen i tests/helpers/memory-db.mjs.
 */
import pg from 'pg';

// Siffror och datum som vanliga JS-värden: bigint/numeric → number, date → 'ÅÅÅÅ-MM-DD'
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1082, (v) => v);

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Ogiltigt kolumnnamn ${s}`);
  return s;
};

export function createDb({ connectionString, pool = new pg.Pool({ connectionString, max: 4 }) }) {
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

  /**
   * Skriver många rader på en gång: raderna skickas som JSON och packas upp av Postgres.
   * Kolumnerna tas från första raden. ignore = rader som redan finns lämnas orörda.
   */
  async function upsert(table, rows, keys, { ignore = false } = {}) {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]).map(ident);
    const list = cols.join(', ');
    const update = cols.filter((c) => !keys.includes(c));
    const conflict = ignore || !update.length
      ? 'do nothing'
      : `do update set ${update.map((c) => `${c} = excluded.${c}`).join(', ')}`;
    await q(
      `insert into nunu.${table} (${list})
       select ${list} from jsonb_populate_recordset(null::nunu.${table}, $1::jsonb)
       on conflict (${keys.join(', ')}) ${conflict}`,
      [JSON.stringify(rows)],
    );
  }

  return {
    pool,
    query: q,
    close: () => pool.end(),

    /* ---- Synken ---- */
    getAccount: async (puuid) => (await q('select * from nunu.riot_account where puuid = $1', [puuid]))[0] || null,
    upsertAccount: (row) => upsert('riot_account', [row], ['puuid']),
    async updateAccount(puuid, fields) {
      const cols = Object.keys(fields).map(ident);
      if (!cols.length) return;
      await q(`update nunu.riot_account set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where puuid = $1`,
        [puuid, ...cols.map((c) => fields[c])]);
    },
    knownMatchIds: async (puuid) =>
      new Set((await q('select match_id from nunu.account_match where puuid = $1', [puuid])).map((r) => r.match_id)),
    getRawMatches: (ids) => (ids.length ? q('select match_id, payload from nunu.raw_match where match_id = any($1)', [ids]) : []),
    getRawTimelines: (ids) => (ids.length ? q('select match_id, payload from nunu.raw_timeline where match_id = any($1)', [ids]) : []),
    async insertRawMatches(rows) {
      // En i taget: varje match är ~80 KB JSON
      for (const r of rows) {
        await q(`insert into nunu.raw_match (match_id, region, game_start, payload) values ($1, $2, $3, $4)
                 on conflict (match_id) do nothing`, [r.match_id, r.region, r.game_start, r.payload]);
      }
    },
    async insertRawTimelines(rows) {
      for (const r of rows) {
        await q('insert into nunu.raw_timeline (match_id, payload) values ($1, $2) on conflict (match_id) do nothing', [r.match_id, r.payload]);
      }
    },
    upsertAccountMatches: (rows) => upsert('account_match', rows, ['puuid', 'match_id']),
    /** Dödsfallen för de här matcherna ersätts helt (de räknas om tillsammans med matchen). */
    async replaceDeaths(matchIds, puuid, rows) {
      if (!matchIds.length) return;
      await q('delete from nunu.death where puuid = $1 and match_id = any($2)', [puuid, matchIds]);
      await upsert('death', rows, ['puuid', 'match_id', 't_ms'], { ignore: true });
    },
    upsertMastery: (rows) => upsert('mastery', rows, ['puuid', 'champion_id']),

    /* ---- Webbsidan ---- */
    listAccounts: () => q('select * from nunu.riot_account order by linked_at'),
    deleteAccount: (puuid) => q('delete from nunu.riot_account where puuid = $1', [puuid]),
    listMatches: () => q('select * from nunu.account_match order by game_start desc'),
    listMastery: () => q('select puuid, champion_id, level, points, last_play_time from nunu.mastery'),
    listHistory: () => q('select season, champion_id, games, wins, kills, deaths, assists, ended from nunu.season_history'),
    listDeaths: () => q('select puuid, match_id, t_ms, killer_champion_id, helper_champion_ids, total, places from nunu.death'),
  };
}
