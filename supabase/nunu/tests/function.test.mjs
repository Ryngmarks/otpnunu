// Tester för Edge Function nunu-riot. Kör: node --test "supabase/nunu/tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRiot, RateLimitError, HttpError, parseRiotId, regionFor } from '../../functions/nunu-riot/riot.mjs';
import { deriveAccountMatch, deriveDeaths, deriveMastery, durationSeconds, DERIVED_VERSION } from '../../functions/nunu-riot/derive.mjs';
import { linkAccount, syncAccount } from '../../functions/nunu-riot/sync.mjs';
import { createHandler, createGetUser } from '../../functions/nunu-riot/handler.mjs';
import { createDb, gzipJson, gunzipJson } from '../../functions/nunu-riot/db.mjs';
import { fakeRiot, matchJson, timelineJson, P1, P2, PX } from '../../../tests/helpers/fake-riot.mjs';
import { memoryDb } from '../../../tests/helpers/memory-db.mjs';

const noSleep = async () => {};
const riotWith = (fake, opts = {}) => createRiot({ apiKey: 'RGAPI-ok', fetchImpl: fake.fetchImpl, sleep: noSleep, spacingMs: 0, ...opts });

/* ---------------- Analys ---------------- */

test('derive: en vanlig match ur kontots perspektiv, med skada', () => {
  const r = deriveAccountMatch(matchJson(11), P1);
  assert.equal(r.match_id, 'EUW1_11');
  assert.equal(r.champion_id, 20);
  assert.equal(r.team_position, 'JUNGLE');
  assert.equal(r.opponent_champion_id, 121);
  assert.equal(r.cs, 180);
  assert.equal(r.win, true);
  assert.equal(r.remake, false);
  assert.equal(r.duration_s, 1800);
  assert.deepEqual([r.physical, r.magic, r.true_damage, r.taken, r.mitigated, r.objectives], [2000, 17000, 1000, 30000, 20000, 25000]);
  assert.equal(r.team_share, 40); // 20000 av 50000
  assert.equal(r.opponent_damage, 15000);
  assert.equal(r.damage_at10, null, 'ingen tidslinje');
  assert.equal(r.derived_version, DERIVED_VERSION);
});

test('derive: med tidslinje – skada vid 10/14/20 min och dödsfall', () => {
  const r = deriveAccountMatch(matchJson(11), P1, timelineJson(11));
  assert.deepEqual([r.damage_at10, r.damage_at14, r.damage_at20], [4000, 5600, 8000]);
  assert.deepEqual(r.ganks, [], 'jungler med tidslinje: ganks räknas (inga i exemplet)');
  assert.equal(deriveAccountMatch(matchJson(11), P1).ganks, null, 'utan tidslinje');
  const d = deriveDeaths(matchJson(11), P1, timelineJson(11));
  assert.equal(d.length, 2);
  assert.deepEqual(d[0], {
    puuid: P1, match_id: 'EUW1_11', t_ms: 210000, killer_champion_id: 121, helper_champion_ids: [],
    total: 1200, places: ['camp'], sources: [{ name: 'C121', damage: 900 }, { name: 'SRU_Blue', damage: 300 }],
  });
  assert.equal(d[1].killer_champion_id, null, 'tornet dödade');
  assert.deepEqual(d[1].helper_champion_ids, [121]);
  assert.deepEqual(d[1].places, ['torn']);
  assert.deepEqual(deriveDeaths(matchJson(11), P2, timelineJson(11)), [], 'kontot finns inte i tidslinjen');
});

test('derive: fält som Riot utelämnar (värdet 0)', () => {
  const m = matchJson(11);
  delete m.info.participants[0].trueDamageDealtToChampions;
  delete m.info.participants[1].totalDamageDealtToChampions;
  const r = deriveAccountMatch(m, P1);
  assert.equal(r.true_damage, 0);
  assert.equal(r.team_share, 100);
});

test('derive: remake, läge utan roller, gamla matcher, kontot saknas', () => {
  assert.equal(deriveAccountMatch(matchJson(7), P1).remake, true);
  const m = matchJson(9);
  m.info.participants.forEach((p) => { p.teamPosition = ''; });
  assert.equal(deriveAccountMatch(m, P1).opponent_champion_id, null);
  assert.equal(durationSeconds({ gameDuration: 1800000 }), 1800);
  assert.equal(durationSeconds({ gameDuration: 1800, gameEndTimestamp: 1 }), 1800);
  assert.equal(deriveAccountMatch(matchJson(9), P2), null);
});

test('derive: mastery', () => {
  const r = deriveMastery({ championId: 20, championLevel: 178, championPoints: 1930343, lastPlayTime: 0 }, P1);
  assert.deepEqual([r.champion_id, r.level, r.points, r.last_play_time], [20, 178, 1930343, null]);
});

/* ---------------- Riot-klienten ---------------- */

test('riot: Riot ID och server tolkas', () => {
  assert.deepEqual(parseRiotId(' Rymm3n#EUW '), { gameName: 'Rymm3n', tagLine: 'EUW' });
  assert.throws(() => parseRiotId('Rymm3n'), HttpError);
  assert.equal(regionFor('euw1'), 'europe');
  assert.equal(regionFor('na1'), 'americas');
  assert.throws(() => regionFor('xx9'), HttpError);
});

test('riot: kort väntan görs, lång väntan lämnas tillbaka', async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1
    ? new Response('{}', { status: 429, headers: { 'retry-after': '1' } })
    : new Response('[]', { status: 200 }));
  const slept = [];
  const riot = createRiot({ apiKey: 'k', fetchImpl, sleep: async (ms) => slept.push(ms), spacingMs: 0 });
  assert.deepEqual(await riot.matchIds('europe', P1, 0), []);
  assert.deepEqual(slept, [1000]);
  const slow = createRiot({ apiKey: 'k', fetchImpl: async () => new Response('{}', { status: 429, headers: { 'retry-after': '120' } }), sleep: noSleep, spacingMs: 0 });
  await assert.rejects(slow.matchIds('europe', P1, 0), (e) => e instanceof RateLimitError && e.retryAfter === 120);
});

test('riot: utgången nyckel ger tydligt fel', async () => {
  const riot = createRiot({ apiKey: 'gammal', fetchImpl: fakeRiot().fetchImpl, sleep: noSleep, spacingMs: 0 });
  await assert.rejects(riot.masteries('euw1', P1), (e) => e.status === 502 && /gått ut/.test(e.message));
});

/* ---------------- Koppla konton ---------------- */

test('link: koppla två konton till samma profil', async () => {
  const db = memoryDb();
  const riot = riotWith(fakeRiot());
  const a = await linkAccount({ riot, db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  const b = await linkAccount({ riot, db, userId: 'user-1', riotId: 'Smurf#EUW' });
  assert.equal(a.puuid, P1);
  assert.equal(a.region, 'europe');
  assert.equal(a.profile_id, b.profile_id);
  assert.equal(db.t.profile.length, 1);
  assert.equal(db.t.riot_account.length, 2);
});

test('link: okänt konto, redan kopplat och konto som tillhör någon annan', async () => {
  const db = memoryDb();
  const riot = riotWith(fakeRiot());
  await assert.rejects(linkAccount({ riot, db, userId: 'user-1', riotId: 'Finns#Inte' }), (e) => e.status === 404);
  await linkAccount({ riot, db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  const again = await linkAccount({ riot, db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  assert.equal(again.already_linked, true);
  await assert.rejects(linkAccount({ riot, db, userId: 'user-2', riotId: 'Rymm3n#EUW' }), (e) => e.status === 409);
});

/* ---------------- Synk ---------------- */

const acc = (db, puuid = P1) => db.t.riot_account.find((a) => a.puuid === puuid);

test("sync: hela historiken i omgångar om 20, tidslinjer bara på Summoner's Rift, sedan bara nytt", async () => {
  const db = memoryDb();
  const fake = fakeRiot({ history: { [P1]: 50 } });
  const riot = riotWith(fake);
  await linkAccount({ riot, db, userId: 'user-1', riotId: 'Rymm3n#EUW' });

  const first = await syncAccount({ riot, db, account: acc(db) });
  assert.deepEqual([first.imported, first.remaining, first.done], [20, 30, false]);
  let r = first;
  let rounds = 1;
  while (!r.done) { r = await syncAccount({ riot, db, account: acc(db) }); rounds++; }
  assert.equal(rounds, 3);
  assert.equal(db.t.account_match.size, 50);
  assert.equal(db.t.raw_match.size, 50);
  assert.equal(db.t.storage.size, 40, 'var 5:e match är ARAM – ingen tidslinje');
  assert.equal(fake.calls.timelines, 40);
  assert.equal(db.t.death.length, 80, 'två dödsfall per match med tidslinje');
  assert.equal(acc(db).backfill_done, true);
  assert.equal(db.t.account_match.get(`${P1}|EUW1_10`).damage_at10, null, 'ARAM');
  assert.equal(db.t.account_match.get(`${P1}|EUW1_11`).damage_at10, 4000);
  assert.equal([...db.t.account_match.values()].filter((x) => x.remake).length, 1, 'remaken (match 7) är markerad');

  const newer = fakeRiot({ history: { [P1]: 51 } });
  const inc = await syncAccount({ riot: riotWith(newer), db, account: acc(db) });
  assert.deepEqual([inc.imported, inc.remaining, inc.done], [1, 0, true]);
  assert.equal(newer.calls.idPages, 1, 'slutar läsa när kända matcher nås');
  assert.deepEqual([newer.calls.matches, newer.calls.timelines], [1, 1]);
});

test('sync: matcher från en äldre synk räknas om – bara tidslinjen hämtas', async () => {
  const db = memoryDb();
  const riot = riotWith(fakeRiot({ history: { [P1]: 10 } }));
  await linkAccount({ riot, db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  // Som efter en synk med version 1: rådata och uträknade rader, inga tidslinjer
  for (let n = 1; n <= 10; n++) {
    await db.insertRawMatches([{ match_id: `EUW1_${n}`, region: 'europe', game_start: null, payload: matchJson(n) }]);
    await db.upsertAccountMatches([{ ...deriveAccountMatch(matchJson(n), P1), derived_version: 1, damage_at10: undefined }]);
  }
  acc(db).backfill_done = true;

  const fake = fakeRiot({ history: { [P1]: 10 } });
  const r = await syncAccount({ riot: riotWith(fake), db, account: acc(db) });
  assert.deepEqual([r.imported, r.remaining, r.done], [10, 0, true]);
  assert.equal(fake.calls.matches, 0, 'rådatan fanns redan');
  assert.equal(fake.calls.timelines, 8, 'tidslinjer för de 8 Rift-matcherna');
  assert.ok([...db.t.account_match.values()].every((x) => x.derived_version === DERIVED_VERSION));
  assert.equal(db.t.death.length, 16);

  const again = fakeRiot({ history: { [P1]: 10 } });
  const r2 = await syncAccount({ riot: riotWith(again), db, account: acc(db) });
  assert.deepEqual([r2.imported, again.calls.timelines], [0, 0], 'inget kvar att räkna om');
});

test('sync: annat konto i samma matcher – rådata och tidslinjer återanvänds', async () => {
  const db = memoryDb();
  const fake = fakeRiot({ history: { [P1]: 10, [PX]: 10 } });
  const riot = riotWith(fake);
  await linkAccount({ riot, db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  await linkAccount({ riot, db, userId: 'user-2', riotId: 'Annan#EUW' });
  await syncAccount({ riot, db, account: acc(db) });
  fake.calls.matches = 0;
  fake.calls.timelines = 0;
  const r = await syncAccount({ riot, db, account: acc(db, PX) });
  assert.equal(r.imported, 10);
  assert.deepEqual([fake.calls.matches, fake.calls.timelines], [0, 0], 'samma matcher – inga nya Riot-anrop');
  assert.equal(db.t.raw_match.size, 10);
  assert.equal(db.t.account_match.size, 20);
});

test('sync: Riot ber oss vänta – det som hämtats sparas och synken fortsätter sen', async () => {
  const db = memoryDb();
  await linkAccount({ riot: riotWith(fakeRiot({ history: { [P1]: 30 } })), db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  // konto, mastery, 1 sida id:n, sedan nyast först: 30 (ARAM), 29+tl, 28+tl, 27+tl, 26+tl, 25 (ARAM) = 13 anrop, sedan 429
  const limited = riotWith(fakeRiot({ history: { [P1]: 30 }, rateLimitAfter: 13 }));
  const r = await syncAccount({ riot: limited, db, account: acc(db) });
  assert.equal(r.retryAfter, 120);
  assert.equal(r.done, false);
  assert.equal(r.imported, 6);
  assert.equal(r.remaining, 24);
  assert.equal(db.t.account_match.size, 6, 'det hämtade sparades');
  assert.equal(acc(db).backfill_done, false);

  let rest;
  do { rest = await syncAccount({ riot: riotWith(fakeRiot({ history: { [P1]: 30 } })), db, account: acc(db) }); } while (!rest.done);
  assert.equal(db.t.account_match.size, 30);
});

/* ---------------- HTTP ---------------- */

function handlerWith({ db = memoryDb(), fake = fakeRiot({ history: { [P1]: 5, [P2]: 0 } }), users = { 'tok-1': 'user-1', 'tok-3': 'user-3' }, cronSecret = '' } = {}) {
  const errors = [];
  const handle = createHandler({
    cronSecret,
    getUser: async (token) => (users[token] ? { id: users[token] } : null),
    makeDeps: () => ({ riot: riotWith(fake), db }),
    log: (e) => errors.push(e),
  });
  const call = (body, { token = 'tok-1', origin = 'https://ryngmarks.github.io', method = 'POST', cron } = {}) =>
    handle(new Request('https://x.supabase.co/functions/v1/nunu-riot', {
      method,
      headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cron !== undefined ? { 'x-nunu-cron': cron } : {}), 'content-type': 'application/json' },
      body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    }));
  return { call, db, errors };
}

test('http: CORS för GitHub Pages och lokal utveckling', async () => {
  const { call } = handlerWith();
  const pre = await call(null, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://ryngmarks.github.io');
  const local = await call(null, { method: 'OPTIONS', origin: 'http://localhost:8000' });
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:8000');
  const other = await call(null, { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(other.headers.get('access-control-allow-origin'), 'https://ryngmarks.github.io');
});

test('http: kräver inloggning och medlemskap', async () => {
  const { call } = handlerWith();
  assert.equal((await call({ action: 'sync' }, { token: null })).status, 401);
  assert.equal((await call({ action: 'sync' }, { token: 'fel' })).status, 401);
  const notMember = await call({ action: 'sync' }, { token: 'tok-3' });
  assert.equal(notMember.status, 403);
  assert.match((await notMember.json()).error, /tillgång/);
});

test('http: koppla konto och synka via funktionen', async () => {
  const { call, db } = handlerWith();
  const link = await call({ action: 'link', riotId: 'Rymm3n#EUW' });
  assert.equal(link.status, 200);
  assert.equal((await link.json()).account.puuid, P1);
  await call({ action: 'link', riotId: 'Smurf#EUW' });

  const sync = await call({ action: 'sync' });
  const body = await sync.json();
  assert.equal(sync.status, 200);
  assert.equal(body.done, true);
  assert.equal(body.results.length, 2);
  assert.equal(db.t.account_match.size, 5);

  const one = await (await call({ action: 'sync', puuid: P1 })).json();
  assert.equal(one.results.length, 1);
  assert.equal((await call({ action: 'sync', puuid: PX })).status, 404, 'kan inte synka någon annans konto');
});

test('http: felaktiga anrop och oväntade fel', async () => {
  const { call } = handlerWith();
  assert.equal((await call('inte json')).status, 400);
  assert.equal((await call({ action: 'radera-allt' })).status, 400);
  assert.equal((await call({ action: 'link', riotId: 'utan-tagg' })).status, 400);
  assert.equal((await call(null, { method: 'GET' })).status, 405);

  const db = memoryDb();
  db.listAccounts = async () => { throw new Error('databasen svarar inte'); };
  const broken = handlerWith({ db });
  const res = await broken.call({ action: 'sync' });
  assert.equal(res.status, 500);
  assert.doesNotMatch((await res.json()).error, /databasen svarar inte/, 'interna detaljer visas inte');
  assert.equal(broken.errors.length, 1);
});

/* ---------------- Databasadaptern ---------------- */

test('db: rätt schema, nycklar och upsert-inställningar', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, opts });
    if (url.includes('profile?')) return new Response(JSON.stringify([{ id: 'p1', user_id: 'u1' }]), { status: 201 });
    if (url.includes('raw_match?select')) return new Response('[]', { status: 200 });
    return new Response(null, { status: 201 });
  };
  const db = createDb({ url: 'https://x.supabase.co/', serviceKey: 'sb_secret_abc', fetchImpl });
  assert.equal((await db.ensureProfile('u1')).id, 'p1');
  await db.insertRawMatches([{ match_id: 'EUW1_1' }]);
  await db.upsertAccountMatches([{ puuid: P1, match_id: 'EUW1_1' }]);
  await db.getRawMatches(['EUW1_1', 'EUW1_"2']);
  await db.insertRawMatches([]); // tomt – inget anrop

  assert.equal(seen.length, 4);
  for (const { opts } of seen) {
    assert.equal(opts.headers['Accept-Profile'], 'nunu');
    assert.equal(opts.headers['Content-Profile'], 'nunu');
    assert.equal(opts.headers.apikey, 'sb_secret_abc');
    assert.equal(opts.headers.Authorization, undefined, 'sb_secret skickas inte som Bearer');
  }
  assert.match(seen[0].url, /\/rest\/v1\/profile\?on_conflict=user_id/);
  assert.match(seen[1].url, /raw_match\?on_conflict=match_id/);
  assert.match(seen[1].opts.headers.Prefer, /ignore-duplicates/, 'rådata skrivs aldrig över');
  assert.match(seen[2].url, /account_match\?on_conflict=puuid,match_id/);
  assert.match(seen[2].opts.headers.Prefer, /merge-duplicates/, 'framräknat får räknas om');
  assert.match(decodeURIComponent(seen[3].url), /match_id=in\.\("EUW1_1","EUW1_2"\)/, 'citattecken rensas');

  const legacy = createDb({ url: 'https://x.supabase.co', serviceKey: 'eyJhbGc.x.y', fetchImpl });
  await legacy.isMember('u1').catch(() => {});
  assert.equal(seen.at(-1).opts.headers.Authorization, 'Bearer eyJhbGc.x.y');
  assert.throws(() => createDb({ url: '', serviceKey: '' }), HttpError);
});

test('getUser: slår upp användaren hos Supabase Auth', async () => {
  const getUser = createGetUser({
    url: 'https://x.supabase.co',
    apiKey: 'k',
    fetchImpl: async (url, opts) => (opts.headers.Authorization === 'Bearer bra'
      ? new Response(JSON.stringify({ id: 'u1', email: 'j@x.se' }))
      : new Response('{}', { status: 401 })),
  });
  assert.deepEqual(await getUser('bra'), { id: 'u1', email: 'j@x.se' });
  assert.equal(await getUser('dålig'), null);
});

test('db: tidslinjer gzippas till Storage, dödsfall ersätts, gamla matcher hittas', async () => {
  const tl = timelineJson(11);
  const packed = await gzipJson(tl);
  assert.ok(packed.length < JSON.stringify(tl).length / 3, 'gzip krymper tidslinjen');
  assert.deepEqual(await gunzipJson(packed), tl);

  const seen = [];
  const store = new Map();
  const fetchImpl = async (url, opts = {}) => {
    seen.push({ url, opts });
    const u = new URL(url);
    if (u.pathname.startsWith('/storage/v1/object/timelines/')) {
      const key = decodeURIComponent(u.pathname.split('/').pop());
      if (opts.method === 'POST') { store.set(key, opts.body); return new Response('{}', { status: 200 }); }
      return store.has(key) ? new Response(store.get(key), { status: 200 }) : new Response('{"error":"not_found"}', { status: 400 });
    }
    if (u.pathname.endsWith('/account_match')) return new Response(JSON.stringify([{ match_id: 'EUW1_3' }]), { status: 200 });
    return new Response(null, { status: 201 });
  };
  const db = createDb({ url: 'https://x.supabase.co', serviceKey: 'eyJhbGc.x.y', fetchImpl });

  assert.equal(await db.getTimeline('EUW1_11'), null, 'saknas = null');
  await db.storeTimeline('EUW1_11', tl);
  const upload = seen.find((s) => s.opts.method === 'POST');
  assert.match(upload.url, /\/storage\/v1\/object\/timelines\/EUW1_11\.json\.gz$/);
  assert.equal(upload.opts.headers['Content-Type'], 'application/gzip');
  assert.equal(upload.opts.headers['x-upsert'], 'true');
  assert.equal(upload.opts.headers.Authorization, 'Bearer eyJhbGc.x.y');
  assert.deepEqual(await db.getTimeline('EUW1_11'), tl);

  seen.length = 0;
  await db.replaceDeaths(['EUW1_1'], P1, [{ puuid: P1, match_id: 'EUW1_1', t_ms: 1 }]);
  assert.equal(seen[0].opts.method, 'DELETE');
  assert.match(decodeURIComponent(seen[0].url), /death\?puuid=eq\.a+&match_id=in\.\("EUW1_1"\)/);
  assert.match(seen[1].url, /death\?on_conflict=puuid,match_id,t_ms/);
  await db.replaceDeaths([], P1, []);
  assert.equal(seen.length, 2, 'inga matcher – inga anrop');

  assert.deepEqual(await db.staleMatchIds(P1, 2), ['EUW1_3']);
  assert.match(seen.at(-1).url, /derived_version=lt\.2/);
});

test('ny Riot-nyckel: kontot får nytt PUUID, äldre matcher räknas om med det gamla', async () => {
  const OLD = 'o'.repeat(78);
  const old = (n, fn) => JSON.parse(JSON.stringify(fn(n)).replaceAll(P1, OLD)); // som hämtat med gamla nyckeln
  const db = memoryDb();
  const profile = await db.ensureProfile('user-1');
  await db.upsertAccount({ puuid: OLD, profile_id: profile.id, game_name: 'Rymm3n', tag_line: 'EUW', platform: 'euw1', region: 'europe' });
  for (let n = 1; n <= 10; n++) {
    await db.insertRawMatches([{ match_id: `EUW1_${n}`, region: 'europe', game_start: null, payload: old(n, matchJson) }]);
    await db.upsertAccountMatches([{ ...deriveAccountMatch(old(n, matchJson), OLD), derived_version: 1 }]);
  }
  await db.upsertMastery([{ puuid: OLD, champion_id: 20, level: 1, points: 1 }]);
  acc(db, OLD).backfill_done = true;

  // Nya nyckeln: OLD ger 400, Rymm3n#EUW har nu PUUID P1, och en ny match (11) har spelats
  const fake = fakeRiot({ history: { [P1]: 11 } });
  let r;
  do { r = await syncAccount({ riot: riotWith(fake), db, account: db.t.riot_account[0] }); } while (!r.done);
  const a = db.t.riot_account[0];
  assert.equal(a.puuid, P1);
  assert.deepEqual(a.previous_puuids, [OLD]);
  assert.equal(r.puuid, P1);
  assert.equal(db.t.account_match.size, 11);
  assert.ok([...db.t.account_match.values()].every((x) => x.puuid === P1 && x.derived_version === DERIVED_VERSION));
  assert.equal(db.t.account_match.get(`${P1}|EUW1_3`).damage_at10, 4000, 'gammal rådata + tidslinje hittar spelaren via gamla PUUID');
  assert.equal(fake.calls.matches, 1, 'bara den nya matchen hämtades');
  assert.equal(db.t.death.filter((d) => d.match_id === 'EUW1_3').length, 2);

  // Att koppla kontot igen ger ingen kopia
  const again = await linkAccount({ riot: riotWith(fake), db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  assert.equal(again.already_linked, true);
  assert.equal(db.t.riot_account.length, 1);
});

test('ny Riot-nyckel: koppla om ett konto med gammalt PUUID byter PUUID i stället för att göra en kopia', async () => {
  const OLD = 'o'.repeat(78);
  const db = memoryDb();
  const profile = await db.ensureProfile('user-1');
  await db.upsertAccount({ puuid: OLD, profile_id: profile.id, game_name: 'rymm3n', tag_line: 'euw', platform: 'euw1', region: 'europe' });
  const r = await linkAccount({ riot: riotWith(fakeRiot()), db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  assert.equal(r.already_linked, true);
  assert.equal(db.t.riot_account.length, 1);
  assert.deepEqual([db.t.riot_account[0].puuid, db.t.riot_account[0].previous_puuids], [P1, [OLD]]);
});

test('http: schemalagd synk med hemlighet synkar alla konton', async () => {
  const SECRET = 'c'.repeat(40);
  const db = memoryDb();
  const fake = fakeRiot({ history: { [P1]: 5, [PX]: 5 } });
  const riot = riotWith(fake);
  await linkAccount({ riot, db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  await linkAccount({ riot, db, userId: 'user-2', riotId: 'Annan#EUW' });
  const { call } = handlerWith({ db, fake, cronSecret: SECRET });

  const ok = await call({ action: 'sync-all' }, { token: null, cron: SECRET });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.done, true);
  assert.equal(body.results.length, 2, 'båda användarnas konton');
  assert.equal(db.t.account_match.size, 10);

  assert.equal((await call({ action: 'sync-all' }, { token: null, cron: 'fel' })).status, 401);
  assert.equal((await call({ action: 'sync-all' }, { token: null, cron: '' })).status, 401);
  assert.equal((await call({ action: 'link', riotId: 'X#Y' }, { token: null, cron: SECRET })).status, 400, 'bara sync-all');
  assert.equal((await call({ action: 'sync-all' })).status, 400, 'utan hemlighet: vanlig användare, okänd action');
  const off = handlerWith({ db, fake, cronSecret: '' });
  assert.equal((await off.call({ action: 'sync-all' }, { token: null, cron: '' })).status, 401, 'avstängd utan hemlighet');
  const short = handlerWith({ db, fake, cronSecret: 'kort' });
  assert.equal((await short.call({ action: 'sync-all' }, { token: null, cron: 'kort' })).status, 401, 'för kort hemlighet godtas inte');
});

test('safeEqual', async () => {
  const { safeEqual } = await import('../../functions/nunu-riot/handler.mjs');
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
});
