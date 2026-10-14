// Tester för Edge Function nunu-riot. Kör: node --test "supabase/nunu/tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRiot, RateLimitError, HttpError, parseRiotId, regionFor } from '../../functions/nunu-riot/riot.mjs';
import { deriveAccountMatch, deriveMastery, durationSeconds, DERIVED_VERSION } from '../../functions/nunu-riot/derive.mjs';
import { linkAccount, syncAccount } from '../../functions/nunu-riot/sync.mjs';
import { createHandler, createGetUser } from '../../functions/nunu-riot/handler.mjs';
import { createDb } from '../../functions/nunu-riot/db.mjs';

const P1 = 'a'.repeat(78);   // Rymm3n
const P2 = 'b'.repeat(78);   // Rymm3n:s andra konto
const PX = 'x'.repeat(78);   // någon annan
const noSleep = async () => {};

/* ---------------- Låtsas-Riot ---------------- */

function participant(puuid, teamId, pos, championId, extra = {}) {
  return { puuid, teamId, teamPosition: pos, championId, win: teamId === 100, kills: 5, deaths: 2, assists: 8,
    totalMinionsKilled: 30, neutralMinionsKilled: 150, goldEarned: 12000, totalDamageDealtToChampions: 20000, visionScore: 30, ...extra };
}

/** Match nr n (nyare = högre n). Både P1 och PX var med i alla; P2 i jämna nummer. */
function matchJson(n) {
  const id = `EUW1_${n}`;
  const parts = [
    participant(P1, 100, 'JUNGLE', 20, n === 7 ? { gameEndedInEarlySurrender: true } : {}),
    participant(PX, 200, 'JUNGLE', 64),
  ];
  if (n % 2 === 0) parts.push(participant(P2, 200, 'MIDDLE', 103));
  return { metadata: { matchId: id }, info: { gameStartTimestamp: 1.7e12 + n * 1e6, gameEndTimestamp: 1, gameDuration: 1800, queueId: 420, participants: parts } };
}

function fakeRiot({ history = { [P1]: 250, [P2]: 0, [PX]: 250 }, rateLimitAfter = Infinity } = {}) {
  const calls = { total: 0, matches: 0, idPages: 0 };
  const res = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
  const accounts = { 'Rymm3n#EUW': P1, 'Smurf#EUW': P2, 'Annan#EUW': PX };

  async function fetchImpl(url, opts) {
    calls.total++;
    if (opts.headers['X-Riot-Token'] !== 'RGAPI-ok') return res(403, {});
    if (calls.total > rateLimitAfter) return res(429, {}, { 'retry-after': '120' });
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname);
    let m;
    if ((m = p.match(/by-riot-id\/(.+)\/(.+)$/))) {
      const puuid = accounts[`${m[1]}#${m[2]}`];
      return puuid ? res(200, { puuid, gameName: m[1], tagLine: m[2] }) : res(404, {});
    }
    if ((m = p.match(/accounts\/by-puuid\/(.+)$/))) {
      const name = Object.keys(accounts).find((k) => accounts[k] === m[1]);
      return res(200, { puuid: m[1], gameName: name.split('#')[0], tagLine: 'EUW' });
    }
    if ((m = p.match(/matches\/by-puuid\/(.+)\/ids$/))) {
      calls.idPages++;
      const puuid = m[1];
      const total = history[puuid] || 0;
      const start = Number(u.searchParams.get('start'));
      const count = Number(u.searchParams.get('count'));
      // P2 spelade jämna matcher, de andra alla 1..total
      const all = puuid === P2 ? [] : Array.from({ length: total }, (_, i) => `EUW1_${total - i}`);
      return res(200, all.slice(start, start + count));
    }
    if ((m = p.match(/\/matches\/(EUW1_\d+)$/))) {
      calls.matches++;
      return res(200, matchJson(Number(m[1].split('_')[1])));
    }
    if (p.includes('champion-masteries/by-puuid/')) {
      return res(200, [{ championId: 20, championLevel: 178, championPoints: 1930343, lastPlayTime: 1.76e12 }, { championId: 64, championLevel: 5, championPoints: 20000 }]);
    }
    return res(404, {});
  }
  return { fetchImpl, calls };
}

/* ---------------- Databas i minnet (samma gränssnitt som db.mjs) ---------------- */

function memoryDb({ members = ['user-1', 'user-2'] } = {}) {
  const t = { profile: [], riot_account: [], raw_match: new Map(), account_match: new Map(), mastery: new Map() };
  let n = 0;
  return {
    t,
    isMember: async (userId) => members.includes(userId),
    ensureProfile: async (userId) => {
      let p = t.profile.find((x) => x.user_id === userId);
      if (!p) t.profile.push((p = { id: `profile-${++n}`, user_id: userId }));
      return p;
    },
    getAccount: async (puuid) => t.riot_account.find((a) => a.puuid === puuid) || null,
    listAccounts: async (profileId) => t.riot_account.filter((a) => a.profile_id === profileId),
    upsertAccount: async (row) => {
      const a = t.riot_account.find((x) => x.puuid === row.puuid);
      if (a) Object.assign(a, row); else t.riot_account.push({ backfill_done: false, last_synced_at: null, ...row });
    },
    updateAccount: async (puuid, fields) => Object.assign(t.riot_account.find((a) => a.puuid === puuid), fields),
    knownMatchIds: async (puuid) => new Set([...t.account_match.values()].filter((r) => r.puuid === puuid).map((r) => r.match_id)),
    getRawMatches: async (ids) => ids.filter((id) => t.raw_match.has(id)).map((id) => ({ match_id: id, payload: t.raw_match.get(id).payload })),
    insertRawMatches: async (rows) => rows.forEach((r) => { if (!t.raw_match.has(r.match_id)) t.raw_match.set(r.match_id, r); }),
    upsertAccountMatches: async (rows) => rows.forEach((r) => {
      assert.ok(t.raw_match.has(r.match_id), 'rådata måste finnas innan account_match (främmande nyckel)');
      t.account_match.set(`${r.puuid}|${r.match_id}`, r);
    }),
    upsertMastery: async (rows) => rows.forEach((r) => t.mastery.set(`${r.puuid}|${r.champion_id}`, r)),
  };
}

const riotWith = (fake, opts = {}) => createRiot({ apiKey: 'RGAPI-ok', fetchImpl: fake.fetchImpl, sleep: noSleep, spacingMs: 0, ...opts });

/* ---------------- Analys ---------------- */

test('derive: en vanlig match ur kontots perspektiv', () => {
  const r = deriveAccountMatch(matchJson(10), P1);
  assert.equal(r.match_id, 'EUW1_10');
  assert.equal(r.champion_id, 20);
  assert.equal(r.team_position, 'JUNGLE');
  assert.equal(r.opponent_champion_id, 64);
  assert.equal(r.cs, 180);
  assert.equal(r.win, true);
  assert.equal(r.remake, false);
  assert.equal(r.duration_s, 1800);
  assert.equal(r.derived_version, DERIVED_VERSION);
});

test('derive: remake markeras', () => {
  assert.equal(deriveAccountMatch(matchJson(7), P1).remake, true);
});

test('derive: läge utan roller (Arena) ger ingen motståndare', () => {
  const m = matchJson(9);
  m.info.participants.forEach((p) => { p.teamPosition = ''; });
  const r = deriveAccountMatch(m, P1);
  assert.equal(r.team_position, null);
  assert.equal(r.opponent_champion_id, null);
});

test('derive: gamla matcher anger längd i millisekunder', () => {
  assert.equal(durationSeconds({ gameDuration: 1800000 }), 1800);
  assert.equal(durationSeconds({ gameDuration: 1800, gameEndTimestamp: 1 }), 1800);
});

test('derive: kontot inte med i matchen ger null', () => {
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

test('sync: hela historiken hämtas i omgångar om 80, sedan bara nytt', async () => {
  const db = memoryDb();
  const fake = fakeRiot({ history: { [P1]: 250 } });
  const riot = riotWith(fake);
  const account = await linkAccount({ riot, db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  const acc = () => db.t.riot_account.find((a) => a.puuid === P1);

  const first = await syncAccount({ riot, db, account: acc() });
  assert.deepEqual([first.imported, first.remaining, first.done], [80, 170, false]);
  assert.equal(db.t.mastery.size, 2);

  let r = first;
  let rounds = 1;
  while (!r.done) { r = await syncAccount({ riot, db, account: acc() }); rounds++; }
  assert.equal(rounds, 4);
  assert.equal(db.t.account_match.size, 250);
  assert.equal(db.t.raw_match.size, 250);
  assert.equal(acc().backfill_done, true);
  assert.ok(acc().last_synced_at);
  assert.equal([...db.t.account_match.values()].filter((x) => x.remake).length, 1, 'remaken (match 7) är markerad');
  void account;

  // En ny match spelas: bara en sida id:n läses och en match hämtas
  fake.calls.idPages = 0;
  fake.calls.matches = 0;
  const hist = fakeRiot({ history: { [P1]: 251 } });
  const riot2 = riotWith(hist);
  const inc = await syncAccount({ riot: riot2, db, account: acc() });
  assert.deepEqual([inc.imported, inc.remaining, inc.done], [1, 0, true]);
  assert.equal(hist.calls.idPages, 1, 'slutar läsa när kända matcher nås');
  assert.equal(hist.calls.matches, 1);
});

test('sync: rådata för en match som redan finns hämtas inte igen', async () => {
  const db = memoryDb();
  const fake = fakeRiot({ history: { [P1]: 10, [PX]: 10 } });
  const riot = riotWith(fake);
  await linkAccount({ riot, db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  await linkAccount({ riot, db, userId: 'user-2', riotId: 'Annan#EUW' });
  await syncAccount({ riot, db, account: db.t.riot_account[0] });
  fake.calls.matches = 0;
  const r = await syncAccount({ riot, db, account: db.t.riot_account[1] });
  assert.equal(r.imported, 10);
  assert.equal(fake.calls.matches, 0, 'samma matcher – inga nya Riot-anrop');
  assert.equal(db.t.raw_match.size, 10);
  assert.equal(db.t.account_match.size, 20);
});

test('sync: Riot ber oss vänta – det som hämtats sparas och synken fortsätter sen', async () => {
  const db = memoryDb();
  const setup = riotWith(fakeRiot({ history: { [P1]: 50 } }));
  await linkAccount({ riot: setup, db, userId: 'user-1', riotId: 'Rymm3n#EUW' });
  // konto, mastery, 1 sida id:n, 10 matcher – sedan 429 med 120 s väntan
  const limited = riotWith(fakeRiot({ history: { [P1]: 50 }, rateLimitAfter: 13 }));
  const r = await syncAccount({ riot: limited, db, account: db.t.riot_account[0] });
  assert.equal(r.retryAfter, 120);
  assert.equal(r.done, false);
  assert.equal(r.imported, 10);
  assert.equal(r.remaining, 40);
  assert.equal(db.t.account_match.size, 10, 'de 10 hämtade sparades');
  assert.equal(db.t.riot_account[0].backfill_done, false);

  const rest = await syncAccount({ riot: riotWith(fakeRiot({ history: { [P1]: 50 } })), db, account: db.t.riot_account[0] });
  assert.deepEqual([rest.imported, rest.done], [40, true]);
  assert.equal(db.t.account_match.size, 50);
});

/* ---------------- HTTP ---------------- */

function handlerWith({ db = memoryDb(), fake = fakeRiot({ history: { [P1]: 5, [P2]: 0 } }), users = { 'tok-1': 'user-1', 'tok-3': 'user-3' } } = {}) {
  const errors = [];
  const handle = createHandler({
    getUser: async (token) => (users[token] ? { id: users[token] } : null),
    makeDeps: () => ({ riot: riotWith(fake), db }),
    log: (e) => errors.push(e),
  });
  const call = (body, { token = 'tok-1', origin = 'https://ryngmarks.github.io', method = 'POST' } = {}) =>
    handle(new Request('https://x.supabase.co/functions/v1/nunu-riot', {
      method,
      headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
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
