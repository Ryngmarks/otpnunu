/*
 * Databasåtkomst för Edge Function via Supabase REST-API (PostgREST),
 * schemat "nunu". Körs med service role – används bara på servern.
 * Bara de operationer synken behöver; fetch injiceras för tester.
 */
import { HttpError } from './riot.mjs';

export function createDb({ url, serviceKey, fetchImpl = fetch }) {
  if (!url || !serviceKey) throw new HttpError(500, 'Supabase-adress eller servicenyckel saknas i Edge Function');
  const api = url.replace(/\/+$/, '') + '/rest/v1/';
  const auth = serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${serviceKey}` } : {};

  async function call(path, { method = 'GET', body, prefer, range } = {}) {
    const res = await fetchImpl(api + path, {
      method,
      headers: {
        apikey: serviceKey,
        ...auth,
        'Accept-Profile': 'nunu',
        'Content-Profile': 'nunu',
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
        ...(range ? { Range: range } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text(); // return=minimal ger 201 utan innehåll
    if (!res.ok) throw new HttpError(500, `Databasfel ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  const enc = encodeURIComponent;
  const inList = (values) => `in.(${values.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',')})`;
  const upsert = (table, rows, onConflict, ignore = false) =>
    rows.length
      ? call(`${table}?on_conflict=${onConflict}`, {
          method: 'POST',
          body: rows,
          prefer: `resolution=${ignore ? 'ignore' : 'merge'}-duplicates,return=minimal`,
        })
      : Promise.resolve();

  return {
    async isMember(userId) {
      const rows = await call(`member?select=user_id&user_id=eq.${enc(userId)}`);
      return rows.length > 0;
    },

    /** Hämtar användarens profil, skapar den om den saknas. */
    async ensureProfile(userId) {
      const [row] = await call('profile?on_conflict=user_id&select=id,user_id', {
        method: 'POST',
        body: [{ user_id: userId }],
        prefer: 'resolution=merge-duplicates,return=representation',
      });
      return row;
    },

    async getAccount(puuid) {
      const [row] = await call(`riot_account?select=*&puuid=eq.${enc(puuid)}`);
      return row || null;
    },

    listAccounts: (profileId) =>
      call(`riot_account?select=*&profile_id=eq.${enc(profileId)}&order=linked_at.asc`),

    upsertAccount: (row) => upsert('riot_account', [row], 'puuid'),

    updateAccount: (puuid, fields) =>
      call(`riot_account?puuid=eq.${enc(puuid)}`, { method: 'PATCH', body: fields, prefer: 'return=minimal' }),

    /** Alla match-id:n som redan är framräknade för kontot. */
    async knownMatchIds(puuid) {
      const ids = new Set();
      for (let from = 0; ; from += 1000) {
        const page = await call(`account_match?select=match_id&puuid=eq.${enc(puuid)}`, { range: `${from}-${from + 999}` });
        page.forEach((r) => ids.add(r.match_id));
        if (page.length < 1000) return ids;
      }
    },

    /** Rådata som redan finns (t.ex. från ett annat konto i samma match). */
    async getRawMatches(matchIds) {
      if (!matchIds.length) return [];
      return call(`raw_match?select=match_id,payload&match_id=${inList(matchIds)}`);
    },

    insertRawMatches: (rows) => upsert('raw_match', rows, 'match_id', true),
    upsertAccountMatches: (rows) => upsert('account_match', rows, 'puuid,match_id'),
    upsertMastery: (rows) => upsert('mastery', rows, 'puuid,champion_id'),
  };
}
