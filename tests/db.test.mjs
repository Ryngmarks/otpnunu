// Tester mot en riktig PostgreSQL. Körs bara om TEST_DATABASE_URL är satt, t.ex.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
// En egen testdatabas skapas och tas bort efteråt.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setup } from '../server/setup.mjs';
import { createDb } from '../server/db.mjs';
import { createRiot } from '../server/riot/riot.mjs';
import { linkAccount, syncAccount } from '../server/riot/sync.mjs';
import { fakeRiot, P1, PX } from './helpers/fake-riot.mjs';

const base = process.env.TEST_DATABASE_URL;
const skip = base ? false : 'TEST_DATABASE_URL saknas';
const name = `otpnunu_test_${process.pid}`;
const url = base ? Object.assign(new URL(base), { pathname: `/${name}` }).toString() : '';
let db;

after(async () => {
  if (!base) return;
  await db?.close();
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

test('setup: skapar databasen och går att köra igen', { skip }, async () => {
  await setup(url, () => {});
  await setup(url, () => {});
  db = createDb({ connectionString: url });
  const history = await db.listHistory();
  assert.equal(history.length, 36);
  const s2025 = history.find((h) => h.season === 'S2025' && h.champion_id === 20);
  assert.equal(s2025.ended, '2026-01-08', 'datum som text, inte tidszonsberoende');
  assert.equal(typeof s2025.kills, 'number');
});

test('synk mot Postgres: matcher, tidslinjer, dödsfall och mastery', { skip }, async () => {
  const riot = createRiot({ apiKey: 'RGAPI-ok', fetchImpl: fakeRiot({ history: { [P1]: 30, [PX]: 30 } }).fetchImpl, sleep: async () => {}, spacingMs: 0 });
  await linkAccount({ riot, db, riotId: 'Rymm3n#EUW' });
  let r;
  do { r = await syncAccount({ riot, db, account: await db.getAccount(P1) }); } while (!r.done);

  const matches = await db.listMatches();
  assert.equal(matches.length, 30);
  assert.ok(matches[0].game_start > matches[1].game_start, 'nyast först');
  const m11 = matches.find((m) => m.match_id === 'EUW1_11');
  assert.deepEqual([m11.damage_at10, m11.team_share, m11.opponent_damage], [4000, 40, 15000]);
  assert.equal(matches.find((m) => m.match_id === 'EUW1_10').damage_at10, null, 'ARAM utan tidslinje');

  const [{ n: timelines }] = await db.query('select count(*)::int as n from nunu.raw_timeline');
  assert.equal(timelines, 24);
  const deaths = await db.listDeaths();
  assert.equal(deaths.length, 48);
  const first = deaths.find((d) => d.match_id === 'EUW1_11' && d.t_ms === 210000);
  assert.deepEqual([first.killer_champion_id, first.helper_champion_ids, first.places], [121, [], ['camp']]);

  const mastery = await db.listMastery();
  assert.equal(mastery.find((m) => m.champion_id === 20).points, 1930343);
  assert.equal((await db.getAccount(P1)).backfill_done, true);

  // Räkna om samma matcher: dödsfallen ersätts, inga dubbletter
  const again = await db.getRawMatches(['EUW1_11']);
  assert.equal(again.length, 1);
  await db.replaceDeaths(['EUW1_11'], P1, deaths.filter((d) => d.match_id === 'EUW1_11').map((d) => ({ ...d, sources: [] })));
  assert.equal((await db.listDeaths()).length, 48);

  // Ett annat konto i samma matcher: ingen ny rådata
  await linkAccount({ riot, db, riotId: 'Annan#EUW' });
  do { r = await syncAccount({ riot, db, account: await db.getAccount(PX) }); } while (!r.done);
  const [{ n: raw }] = await db.query('select count(*)::int as n from nunu.raw_match');
  assert.equal(raw, 30);
  assert.equal((await db.listMatches()).length, 60);

  // Koppla bort: kontots matcher, dödsfall och mastery försvinner, rådatan finns kvar
  await db.deleteAccount(P1);
  assert.equal((await db.listMatches()).length, 30);
  assert.equal((await db.listDeaths()).length, 0);
  const [{ n: rawAfter }] = await db.query('select count(*)::int as n from nunu.raw_timeline');
  assert.equal(rawAfter, 24);
});
