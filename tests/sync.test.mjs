// Tester för Riot-klienten, uträkningen och synken. Kör: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRiot, RateLimitError, HttpError, parseRiotId, regionFor } from '../server/riot/riot.mjs';
import { deriveAccountMatch, deriveDeaths, deriveMastery, durationSeconds, DERIVED_VERSION } from '../server/riot/derive.mjs';
import { linkAccount, syncAccount } from '../server/riot/sync.mjs';
import { fakeRiot, matchJson, timelineJson, P1, P2, PX } from './helpers/fake-riot.mjs';
import { memoryDb } from './helpers/memory-db.mjs';

const noSleep = async () => {};
const riotWith = (fake, opts = {}) => createRiot({ apiKey: 'RGAPI-ok', fetchImpl: fake.fetchImpl, sleep: noSleep, spacingMs: 0, ...opts });

/* ---------------- Uträkning ---------------- */

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

test('link: koppla konton, okänt konto och redan kopplat', async () => {
  const db = memoryDb();
  const riot = riotWith(fakeRiot());
  const a = await linkAccount({ riot, db, riotId: 'Rymm3n#EUW' });
  await linkAccount({ riot, db, riotId: 'Smurf#EUW' });
  assert.equal(a.puuid, P1);
  assert.equal(a.region, 'europe');
  assert.equal(db.t.riot_account.length, 2);
  await assert.rejects(linkAccount({ riot, db, riotId: 'Finns#Inte' }), (e) => e.status === 404);
  assert.equal((await linkAccount({ riot, db, riotId: 'Rymm3n#EUW' })).already_linked, true);
});

/* ---------------- Synk ---------------- */

const acc = (db, puuid = P1) => db.t.riot_account.find((a) => a.puuid === puuid);

test('sync: hela historiken i omgångar om 40, tidslinjer bara på Summoner\'s Rift, sedan bara nytt', async () => {
  const db = memoryDb();
  const fake = fakeRiot({ history: { [P1]: 100 } });
  const riot = riotWith(fake);
  await linkAccount({ riot, db, riotId: 'Rymm3n#EUW' });

  const first = await syncAccount({ riot, db, account: acc(db) });
  assert.deepEqual([first.imported, first.remaining, first.done], [40, 60, false]);
  let r = first;
  while (!r.done) r = await syncAccount({ riot, db, account: acc(db) });
  assert.equal(db.t.account_match.size, 100);
  assert.equal(db.t.raw_match.size, 100);
  assert.equal(db.t.raw_timeline.size, 80, 'var 5:e match är ARAM – ingen tidslinje');
  assert.equal(fake.calls.timelines, 80);
  assert.equal(db.t.death.length, 160, 'två dödsfall per match med tidslinje');
  assert.equal(acc(db).backfill_done, true);
  const aram = db.t.account_match.get(`${P1}|EUW1_10`);
  assert.equal(aram.damage_at10, null);
  assert.equal(db.t.account_match.get(`${P1}|EUW1_11`).damage_at10, 4000);

  const newer = fakeRiot({ history: { [P1]: 101 } });
  const inc = await syncAccount({ riot: riotWith(newer), db, account: acc(db) });
  assert.deepEqual([inc.imported, inc.remaining, inc.done], [1, 0, true]);
  assert.equal(newer.calls.idPages, 1, 'slutar läsa när kända matcher nås');
  assert.deepEqual([newer.calls.matches, newer.calls.timelines], [1, 1]);
});

test('sync: rådata som redan finns (annat konto eller importerade filer) hämtas inte igen', async () => {
  const db = memoryDb();
  const fake = fakeRiot({ history: { [P1]: 10, [PX]: 10 } });
  const riot = riotWith(fake);
  await linkAccount({ riot, db, riotId: 'Rymm3n#EUW' });
  // Importerade filer: rådata finns, men inget är uträknat
  await db.insertRawMatches([4, 3].map((n) => ({ match_id: `EUW1_${n}`, region: 'europe', game_start: null, payload: matchJson(n) })));
  await db.insertRawTimelines([4, 3].map((n) => ({ match_id: `EUW1_${n}`, payload: timelineJson(n) })));
  await syncAccount({ riot, db, account: acc(db) });
  assert.deepEqual([fake.calls.matches, fake.calls.timelines], [8, 6], 'två av tio fanns redan (och 5 och 10 är ARAM)');
  assert.equal(db.t.account_match.size, 10);

  await linkAccount({ riot, db, riotId: 'Annan#EUW' });
  fake.calls.matches = 0;
  fake.calls.timelines = 0;
  const r = await syncAccount({ riot, db, account: acc(db, PX) });
  assert.equal(r.imported, 10);
  assert.deepEqual([fake.calls.matches, fake.calls.timelines], [0, 0], 'samma matcher – inga nya Riot-anrop');
  assert.equal(db.t.account_match.size, 20);
});

test('sync: Riot ber oss vänta – det som hämtats sparas och synken fortsätter sen', async () => {
  const db = memoryDb();
  await linkAccount({ riot: riotWith(fakeRiot({ history: { [P1]: 30 } })), db, riotId: 'Rymm3n#EUW' });
  // konto, mastery, 1 sida id:n, sedan nyast först: 30, 29+tl, 28+tl, 27+tl, 26+tl, 25 (ARAM) = 13 anrop, sedan 429
  const limited = riotWith(fakeRiot({ history: { [P1]: 30 }, rateLimitAfter: 13 }));
  const r = await syncAccount({ riot: limited, db, account: acc(db) });
  assert.equal(r.retryAfter, 120);
  assert.equal(r.done, false);
  assert.equal(r.imported, 6);
  assert.equal(db.t.account_match.size, r.imported, 'det hämtade sparades');
  assert.equal(acc(db).backfill_done, false);

  const rest = await syncAccount({ riot: riotWith(fakeRiot({ history: { [P1]: 30 } })), db, account: acc(db) });
  assert.equal(rest.done, true);
  assert.equal(db.t.account_match.size, 30);
});

test('import: filer läses in som rådata och används av synken', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { importFiles } = await import('../server/import-files.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'otp-import-'));
  try {
    await writeFile(join(dir, 'EUW1_3.match.json'), JSON.stringify(matchJson(3)));
    await writeFile(join(dir, 'EUW1_3.timeline.json'), JSON.stringify(timelineJson(3)));
    await writeFile(join(dir, 'EUW1_2.match.json'), JSON.stringify(matchJson(2)));
    await writeFile(join(dir, 'EUW1_9.match.json'), JSON.stringify({ hej: 1 }));
    const db = memoryDb();
    const r = await importFiles({ db, dir, log: () => {} });
    assert.deepEqual(r, { matches: 2, timelines: 1 });
    assert.equal(db.t.raw_match.size, 2);

    const fake = fakeRiot({ history: { [P1]: 3 } });
    const riot = riotWith(fake);
    await linkAccount({ riot, db, riotId: 'Rymm3n#EUW' });
    await syncAccount({ riot, db, account: db.t.riot_account[0] });
    assert.deepEqual([fake.calls.matches, fake.calls.timelines], [1, 2], 'bara match 1 och tidslinjer 1–2 hämtades');
    assert.equal(db.t.account_match.size, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
