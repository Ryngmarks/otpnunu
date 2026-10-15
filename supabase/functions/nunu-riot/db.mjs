/*
 * Databasåtkomst för Edge Function via Supabase REST-API (PostgREST), schemat "nunu",
 * och tidslinjer i Supabase Storage (privat bucket "timelines", gzippad JSON).
 * Körs med service role – används bara på servern.
 * Bara de operationer synken behöver; fetch injiceras för tester.
 */

export const TIMELINE_BUCKET = 'timelines';

/** JSON → gzip-bytes och tillbaka (CompressionStream finns i både Deno och Node). */
export async function gzipJson(value) {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzipJson(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
import { HttpError } from './riot.mjs';

export function createDb({ url, serviceKey, fetchImpl = fetch }) {
  if (!url || !serviceKey) throw new HttpError(500, 'Supabase-adress eller servicenyckel saknas i Edge Function');
  const base = url.replace(/\/+$/, '');
  const api = base + '/rest/v1/';
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

    /** Alla kopplade konton (schemalagd synk). */
    listAllAccounts: () => call('riot_account?select=*&order=linked_at.asc'),

    listAccounts: (profileId) =>
      call(`riot_account?select=*&profile_id=eq.${enc(profileId)}&order=linked_at.asc`),

    upsertAccount: (row) => upsert('riot_account', [row], 'puuid'),

    /** Nytt PUUID för kontot (ny Riot-nyckel). Matcher, mastery och dödsfall följer med (004_rekey.sql). */
    rekeyAccount: (oldPuuid, newPuuid, previous) =>
      call(`riot_account?puuid=eq.${enc(oldPuuid)}`, { method: 'PATCH', body: { puuid: newPuuid, previous_puuids: previous }, prefer: 'return=minimal' }),

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

    /** Finns kolumnerna från 010_review.sql? Frågas en gång per anrop. */
    supportsReview() {
      this._review = this._review || call('account_match?select=review&limit=1').then(() => true, () => false);
      return this._review;
    },

    /** Matcher som räknats ut med en äldre version av reglerna – räknas om av synken. */
    async staleMatchIds(puuid, version) {
      const ids = [];
      for (let from = 0; ; from += 1000) {
        const page = await call(`account_match?select=match_id&puuid=eq.${enc(puuid)}&derived_version=lt.${Number(version)}&order=game_start.desc`, { range: `${from}-${from + 999}` });
        ids.push(...page.map((r) => r.match_id));
        if (page.length < 1000) return ids;
      }
    },

    insertRawMatches: (rows) => upsert('raw_match', rows, 'match_id', true),
    upsertAccountMatches: (rows) => upsert('account_match', rows, 'puuid,match_id'),
    upsertMastery: (rows) => upsert('mastery', rows, 'puuid,champion_id'),

    /** Senaste sparade rank per kö för kontot: { RANKED_SOLO_5x5: {…}, … } */
    async lastRanks(puuid) {
      const rows = await call(`rank_snapshot?select=queue,tier,division,lp,wins,losses&puuid=eq.${enc(puuid)}&order=taken_at.desc&limit=50`);
      const last = {};
      for (const r of rows) if (!last[r.queue]) last[r.queue] = r;
      return last;
    },
    insertRankSnapshots: (rows) => upsert('rank_snapshot', rows, 'puuid,queue,taken_at', true),

    /** Dödsfallen för de här matcherna ersätts helt (de räknas om tillsammans med matchen). */
    async replaceDeaths(matchIds, puuid, rows) {
      if (!matchIds.length) return;
      await call(`death?puuid=eq.${enc(puuid)}&match_id=${inList(matchIds)}`, { method: 'DELETE', prefer: 'return=minimal' });
      await upsert('death', rows, 'puuid,match_id,t_ms', true);
    },

    /** Tidslinjen från Storage, eller null om den inte finns. */
    async getTimeline(matchId) {
      const res = await fetchImpl(`${base}/storage/v1/object/${TIMELINE_BUCKET}/${enc(matchId)}.json.gz`, {
        headers: { apikey: serviceKey, ...auth },
      });
      if (res.status === 400 || res.status === 404) return null; // Storage svarar 400 "Object not found"
      if (!res.ok) throw new HttpError(500, `Storage-fel ${res.status}`);
      return gunzipJson(new Uint8Array(await res.arrayBuffer()));
    },

    /** Sparar tidslinjen gzippad i Storage (~80 KB i stället för ~900 KB). */
    async storeTimeline(matchId, timeline) {
      const res = await fetchImpl(`${base}/storage/v1/object/${TIMELINE_BUCKET}/${enc(matchId)}.json.gz`, {
        method: 'POST',
        headers: { apikey: serviceKey, ...auth, 'Content-Type': 'application/gzip', 'x-upsert': 'true' },
        body: await gzipJson(timeline),
      });
      if (!res.ok) throw new HttpError(500, `Storage-fel ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}
