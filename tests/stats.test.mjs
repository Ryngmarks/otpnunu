// Tester för otpnunu-statistiken. Kör: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMatches, summarize, recentForm, byAccount, opponents, masterySummary, queueLabel, QUEUE_FILTERS } from '../js/career/stats.js';
import { esc, matchesHtml, accountsHtml } from '../js/career/view.js';

const row = (o) => ({
  puuid: 'A', match_id: Math.random().toString(36), champion_id: 20, queue_id: 420, win: true, remake: false,
  kills: 5, deaths: 2, assists: 10, cs: 180, gold: 12000, vision: 30, duration_s: 1800,
  game_start: '2026-10-01T18:00:00Z', opponent_champion_id: 64, ...o,
});

test('filter: remakes räknas aldrig, Nunu och Rift är standard', () => {
  const rows = [row({}), row({ remake: true }), row({ champion_id: 64 }), row({ queue_id: 1750 }), row({ puuid: 'B' })];
  assert.equal(filterMatches(rows).length, 2);
  assert.equal(filterMatches(rows, { champion: null }).length, 3);
  assert.equal(filterMatches(rows, { champion: null, queues: null }).length, 4);
  assert.equal(filterMatches(rows, { puuid: 'B' }).length, 1);
  assert.equal(filterMatches(rows, { queues: QUEUE_FILTERS.flex.queues }).length, 0);
});

test('summarize: vinstprocent, KDA, CS/min och snitt', () => {
  const s = summarize([
    row({ win: true, kills: 6, deaths: 2, assists: 10, cs: 180, duration_s: 1800 }),
    row({ win: false, kills: 2, deaths: 6, assists: 4, cs: 120, duration_s: 1200 }),
  ]);
  assert.equal(s.games, 2);
  assert.equal(s.winrate, 50);
  assert.equal(s.kda, 2.75);       // (8 + 14) / 8
  assert.equal(s.csPerMin, 6);     // 300 cs / 50 min
  assert.equal(s.avgMinutes, 25);
  assert.equal(s.kills, 4);
});

test('summarize: inga matcher ger tomma värden, deaths 0 ger ingen division med noll', () => {
  const empty = summarize([]);
  assert.equal(empty.games, 0);
  assert.equal(empty.winrate, null);
  assert.equal(summarize([row({ deaths: 0, kills: 3, assists: 4 })]).kda, 7);
});

test('recentForm: nyast först', () => {
  const rows = [
    row({ game_start: '2026-10-01T10:00:00Z', win: false }),
    row({ game_start: '2026-10-03T10:00:00Z', win: true }),
    row({ game_start: '2026-10-02T10:00:00Z', win: true }),
  ];
  assert.deepEqual(recentForm(rows, 2), ['W', 'W']);
  assert.deepEqual(recentForm(rows), ['W', 'W', 'L']);
});

test('byAccount: statistik per konto', () => {
  const r = byAccount([row({}), row({ puuid: 'B', win: false })], [{ puuid: 'A' }, { puuid: 'B' }, { puuid: 'C' }]);
  assert.deepEqual(r.map((x) => [x.account.puuid, x.games, x.winrate]), [['A', 1, 100], ['B', 1, 0], ['C', 0, null]]);
});

test('opponents: minst 2 möten, flest först', () => {
  const rows = [
    row({ opponent_champion_id: 64, win: true }), row({ opponent_champion_id: 64, win: false }), row({ opponent_champion_id: 64, win: false }),
    row({ opponent_champion_id: 104 }), row({ opponent_champion_id: 104 }),
    row({ opponent_champion_id: 121 }),
    row({ opponent_champion_id: null }),
  ];
  const o = opponents(rows);
  assert.deepEqual(o.map((x) => [x.championId, x.games, x.winrate]), [[64, 3, 33], [104, 2, 100]]);
});

test('masterySummary: summerar Nunu över alla konton', () => {
  const m = masterySummary([
    { puuid: 'A', champion_id: 20, level: 178, points: 1930343, last_play_time: '2026-10-13T00:00:00Z' },
    { puuid: 'B', champion_id: 20, level: 32, points: '210000', last_play_time: '2026-09-01T00:00:00Z' },
    { puuid: 'A', champion_id: 64, level: 7, points: 45000 },
  ]);
  assert.equal(m.points, 2140343);
  assert.equal(m.level, 178);
  assert.equal(m.lastPlayed, '2026-10-13T00:00:00Z');
  assert.equal(m.perAccount.length, 2);
});

test('queueLabel', () => {
  assert.equal(queueLabel(420), 'Solo/Duo');
  assert.equal(queueLabel(1750), 'Arena');
  assert.equal(queueLabel(9999), 'Kö 9999');
});

test('vyn escapar namn från Riot', () => {
  const champs = { name: (id) => `#${id}`, icon: () => null };
  const evil = '<img src=x onerror=alert(1)>';
  const html = accountsHtml([{ account: { puuid: 'A', game_name: evil, tag_line: 'EUW', platform: 'euw1' }, games: 0, winrate: null }], []);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes(esc(evil)));
  const list = matchesHtml([row({})], champs, [{ puuid: 'A', game_name: evil }, { puuid: 'B', game_name: 'x' }], 10);
  assert.ok(!list.includes('<img src=x'));
});

test('careerSummary: äldre säsonger plus synkade matcher', async () => {
  const { careerSummary } = await import('../js/career/stats.js');
  const { careerHtml } = await import('../js/career/view.js');
  const history = [
    { season: 'S2022', champion_id: 20, games: 10, wins: 6, kills: '8.0', deaths: '4.0', assists: '12.0' },
    { season: 'S2021', champion_id: 20, games: 4, wins: 1, kills: 5, deaths: 5, assists: 5 },
    { season: 'S2021', champion_id: 35, games: 2, wins: 2, kills: 10, deaths: 2, assists: 4 },
  ];
  const synced = [
    { game_start: '2025-03-01T10:00:00Z', win: true, kills: 10, deaths: 2, assists: 8 },
    { game_start: '2024-11-02T10:00:00Z', win: false, kills: 2, deaths: 6, assists: 4 },
  ];
  const c = careerSummary(history, synced, { champion: 20 });
  assert.deepEqual(c.seasons.map((s) => [s.season, s.games, s.wins, s.losses]), [['S2021', 4, 1, 3], ['S2022', 10, 6, 4]]);
  assert.equal(c.recent.games, 2);
  assert.equal(c.recent.since, '2024-11-02T10:00:00Z');
  assert.deepEqual([c.total.games, c.total.wins, c.total.losses, c.total.winrate], [16, 8, 8, 50]);
  // KDA viktas efter antal matcher: (K 20+80+12 + A 20+120+12) / D (20+40+8)
  assert.equal(c.total.kda, 3.88);

  const all = careerSummary(history, [], { champion: null });
  assert.equal(all.seasons[0].games, 6);
  assert.equal(all.total.games, 16);

  assert.match(careerHtml(c), /Totalt/);
  assert.equal(careerHtml(careerSummary([], synced)), '', 'ingen tabell utan äldre säsonger');
});
