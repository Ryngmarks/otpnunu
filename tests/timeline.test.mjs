// Tester för den lokala tidslinjehämtningen. Kör: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { damageSummary, damageCurve, damageAt, deaths, formatReport } from '../tools/timeline/damage.mjs';
import { parseArgs, dayRange, run } from '../tools/timeline/fetch.mjs';

const ME = 'me-puuid';
const p = (participantId, puuid, championName, teamId, teamPosition, dmg, extra = {}) => ({
  participantId, puuid, championName, teamId, teamPosition, win: teamId === 100,
  kills: 0, deaths: 0, assists: 0,
  totalDamageDealtToChampions: dmg, physicalDamageDealtToChampions: dmg / 2, magicDamageDealtToChampions: dmg / 2,
  trueDamageDealtToChampions: 0, totalDamageTaken: 20000, damageSelfMitigated: 15000, damageDealtToObjectives: 30000,
  ...extra,
});
const match = {
  metadata: { matchId: 'EUW1_1' },
  info: {
    gameDuration: 1800, gameStartTimestamp: Date.UTC(2026, 9, 14, 18), queueId: 420,
    participants: [
      p(1, ME, 'Nunu', 100, 'JUNGLE', 15000, { kills: 5, deaths: 2, assists: 9 }),
      p(2, 'm2', 'Ahri', 100, 'MIDDLE', 25000),
      p(3, 'm3', 'Ashe', 100, 'BOTTOM', 20000),
      p(6, 'e1', 'LeeSin', 200, 'JUNGLE', 12000),
      p(7, 'e2', 'Zed', 200, 'MIDDLE', 22000),
    ],
  },
};
const frame = (minute, dealt, taken, events = []) => ({
  timestamp: minute * 60000 + 30,
  participantFrames: { 1: { damageStats: { totalDamageDoneToChampions: dealt, totalDamageTaken: taken } } },
  events,
});
const timeline = {
  info: {
    participants: [{ participantId: 1, puuid: ME }, { participantId: 6, puuid: 'e1' }],
    frames: [
      frame(0, 0, 0),
      frame(1, 100, 50),
      frame(2, 900, 400, [{
        type: 'CHAMPION_KILL', timestamp: 125000, killerId: 6, victimId: 1, assistingParticipantIds: [7],
        victimDamageReceived: [
          { participantId: 6, name: 'LeeSin', type: 'OTHER', physicalDamage: 300, magicDamage: 0, trueDamage: 20 },
          { participantId: 6, name: 'LeeSin', type: 'OTHER', physicalDamage: 100, magicDamage: 0, trueDamage: 0 },
          { participantId: 7, name: 'Zed', type: 'OTHER', physicalDamage: 250, magicDamage: 0, trueDamage: 0 },
          { participantId: 0, name: 'SRU_Blue', type: 'MINION', physicalDamage: 30, magicDamage: 0, trueDamage: 0 },
        ],
      }]),
      frame(10, 4000, 3000),
      frame(14, 6500, 5000),
    ],
  },
};

test('damageSummary: skada, andel av laget och motståndaren på samma position', () => {
  const s = damageSummary(match, ME);
  assert.equal(s.champion, 'Nunu');
  assert.equal(s.opponent, 'LeeSin');
  assert.equal(s.perMin, 500);
  assert.equal(s.teamShare, 25); // 15000 av 60000
  assert.equal(s.opponentToChampions, 12000);
  assert.equal(s.kda, '5/2/9');
});

test('damageCurve: skada per minut och total vid en viss minut', () => {
  const c = damageCurve(timeline, ME);
  assert.deepEqual(c.map((x) => [x.minute, x.dealt, x.taken]), [[1, 100, 50], [2, 800, 350], [10, 3100, 2600], [14, 2500, 2000]]);
  assert.equal(damageAt(c, 10), 4000);
  assert.equal(damageAt(c, 12), 4000);
  assert.equal(damageAt(c, 14), 6500);
});

test('deaths: vem dödade och varifrån skadan kom', () => {
  const [d] = deaths(timeline, match, ME);
  assert.equal(d.time, '2:05');
  assert.equal(d.killer, 'LeeSin');
  assert.deepEqual(d.helpers, ['Zed']);
  assert.equal(d.total, 700);
  assert.deepEqual(d.sources.map((s) => [s.name, s.damage]), [['LeeSin', 420], ['Zed', 250], ['SRU_Blue', 30]]);
  const text = formatReport(damageSummary(match, ME), damageCurve(timeline, ME), [d]);
  assert.match(text, /VINST/);
  assert.match(text, /2:05 {2}LeeSin \+ Zed/);
});

test('parseArgs och dayRange', () => {
  assert.deepEqual(parseArgs(['--date', '2026-10-14'], { RIOT_ID: 'X#Y' }).id, 'X#Y');
  assert.throws(() => parseArgs(['--datum', 'x']), /Okänt val/);
  assert.throws(() => parseArgs(['--date', '14/10']), /ÅÅÅÅ-MM-DD/);
  const r = dayRange('2026-10-14');
  assert.equal(r.endTime - r.startTime, 86400);
  assert.equal(r.label, '2026-10-14');
});

test('run: sparar Riots svar oförändrade och hämtar inte samma match två gånger', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nunu-tl-'));
  const calls = [];
  const riot = {
    accountByRiotId: async () => ({ puuid: ME }),
    matchIds: async (region, puuid, start, count, range) => { calls.push(['ids', range.startTime]); return ['EUW1_1']; },
    match: async () => { calls.push(['match']); return match; },
    timeline: async () => { calls.push(['timeline']); return timeline; },
  };
  try {
    const out = join(dir, 'matches');
    const logs = [];
    await run({ argv: ['--date', '2026-10-14', '--out', out], env: {}, riot, log: (s) => logs.push(s) });
    await run({ argv: ['--date', '2026-10-14', '--out', out], env: {}, riot, log: () => {} });
    assert.deepEqual((await readdir(out)).sort(), ['EUW1_1.match.json', 'EUW1_1.timeline.json']);
    assert.deepEqual(JSON.parse(await readFile(join(out, 'EUW1_1.timeline.json'), 'utf8')), timeline);
    assert.equal(calls.filter((c) => c[0] === 'match').length, 1, 'andra körningen läser från disk');
    assert.match(await readFile(join(dir, 'skada-2026-10-14.txt'), 'utf8'), /Skada mot champions: 15/);
    assert.match(logs.join('\n'), /1 matcher/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('summary: samlad rapport över flera matcher', async () => {
  const { findPuuid, relevant, summarize, storage, formatSummary } = await import('../tools/timeline/summary.mjs');
  const named = structuredClone(match);
  named.info.participants[0].riotIdGameName = 'Rymm3n';
  named.info.participants[0].riotIdTagline = 'EUW';
  const lost = structuredClone(named);
  lost.metadata.matchId = 'EUW1_2';
  lost.info.participants.forEach((x) => { x.win = !x.win; });
  const aram = structuredClone(named);
  aram.info.queueId = 450;
  const games = [{ match: named, timeline }, { match: lost, timeline }, { match: aram, timeline }];

  assert.equal(findPuuid(games, 'rymm3n#euw'), ME);
  assert.equal(relevant(games, ME).length, 2, 'ARAM räknas inte');
  assert.equal(relevant(games, ME, 'Ahri').length, 0);

  const r = summarize(relevant(games, ME), ME);
  assert.deepEqual([r.games, r.wins, r.losses], [2, 1, 1]);
  assert.equal(r.damage.win.perMin, 500);
  assert.equal(r.damage.win.at10, 4000);
  assert.equal(r.deaths.total, 2);
  assert.equal(r.deaths.before15, 1);
  assert.equal(r.deaths.places.camp, 2, 'blue buff gjorde skada = dödsfall vid camp');
  assert.equal(r.deaths.solo, 0);
  assert.deepEqual(r.deaths.killers.map((k) => [k.name, k.involved, k.killed]), [['LeeSin', 2, 2], ['Zed', 2, 0]]);
  assert.deepEqual(r.opponents, [{ name: 'LeeSin', games: 2, wins: 1 }]);
  assert.equal(r.deaths.byWindow[0].count, 2);

  const st = storage([{ match: 80 * 1024, timeline: 900 * 1024 }, { match: 90 * 1024, timeline: 1000 * 1024 }]);
  assert.deepEqual(st, { matches: 2, totalMb: 2, matchKb: 85, timelineKb: 950 });
  assert.match(formatSummary(r, st, 'Rymm3n#EUW · Nunu'), /1V 1F \(50 %\)/);
});

test('report: läser sparade filer utan Riot-nyckel', async () => {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { run: report } = await import('../tools/timeline/report.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'nunu-rep-'));
  try {
    const m = join(dir, 'matches');
    await mkdir(m);
    await writeFile(join(m, 'EUW1_1.match.json'), JSON.stringify(match));
    await writeFile(join(m, 'EUW1_1.timeline.json'), JSON.stringify(timeline));
    await writeFile(join(m, 'EUW1_9.match.json'), JSON.stringify(match)); // tidslinje saknas – hoppas över
    const text = await report({ argv: ['--dir', m, '--id', 'Finns#Inte'], log: () => {} });
    assert.match(text, /Lagring: 1 matcher/);
    assert.match(await readFile(join(dir, 'sammanfattning.txt'), 'utf8'), /DÖDSFALL/);
    await assert.rejects(report({ argv: ['--dir', join(dir, 'tom')], log: () => {} }), /Inga sparade matcher/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dayRange: flera dagar bakåt', () => {
  const r = dayRange('2026-10-14', new Date(), 7);
  assert.equal(r.endTime - r.startTime, 7 * 86400);
  assert.equal(r.label, '2026-10-08_2026-10-14');
  assert.throws(() => parseArgs(['--days', '0']), /1–400/);
});
