// Tester för early game (supabase/functions/nunu-riot/early.mjs). Kör: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveEarly, deriveTeams } from '../supabase/functions/nunu-riot/early.mjs';

const ME = 'me';
const match = {
  info: {
    participants: [
      { participantId: 1, puuid: ME, teamId: 100, teamPosition: 'JUNGLE', championId: 20, totalDamageDealtToChampions: 20000 },
      { participantId: 2, puuid: 'a', teamId: 100, teamPosition: 'BOTTOM', championId: 22 },
      { participantId: 6, puuid: 'e', teamId: 200, teamPosition: 'JUNGLE', championId: 64, magicDamageDealtToChampions: 3000, totalDamageDealtToChampions: 10000 },
      { participantId: 7, puuid: 'f', teamId: 200, teamPosition: 'MIDDLE', championId: 103, magicDamageDealtToChampions: 9000, totalDamageDealtToChampions: 10000 },
    ],
  },
};
const pf = (gold, xp, level, mcs, jcs) => ({ totalGold: gold, xp, level, minionsKilled: mcs, jungleMinionsKilled: jcs });
const frame = (minute, me, opp, events = []) => ({ timestamp: minute * 60000 + 120, participantFrames: { 1: me, 6: opp }, events });
const timeline = {
  info: {
    participants: [{ participantId: 1, puuid: ME }, { participantId: 6, puuid: 'e' }],
    frames: [
      frame(0, pf(500, 0, 1, 0, 0), pf(500, 0, 1, 0, 0)),
      frame(3, pf(1200, 900, 3, 0, 16), pf(1100, 800, 3, 0, 14), [
        { type: 'CHAMPION_KILL', timestamp: 170000, killerId: 2, victimId: 7, assistingParticipantIds: [1] }, // first blood, du assisterar
      ]),
      frame(5, pf(2000, 1800, 4, 2, 26), pf(1700, 1500, 4, 0, 24)),
      frame(8, pf(3000, 3000, 6, 4, 40), pf(3000, 3000, 6, 4, 40), [
        { type: 'CHAMPION_KILL', timestamp: 470000, killerId: 1, victimId: 6, assistingParticipantIds: [] },
        { type: 'CHAMPION_KILL', timestamp: 520000, killerId: 6, victimId: 1, assistingParticipantIds: [7] },
      ]),
      frame(10, pf(4200, 4500, 7, 6, 58), pf(3500, 4000, 7, 4, 52)),
    ], // matchen tar slut före 15 min
  },
};

test('deriveEarly: guld, XP, CS och K/D/A vid 5 och 10 min, mot motståndaren på samma position', () => {
  const e = deriveEarly(match, timeline, ME);
  assert.deepEqual(e.me[5], { gold: 2000, xp: 1800, level: 4, cs: 28, k: 0, d: 0, a: 1 });
  assert.deepEqual(e.me[10], { gold: 4200, xp: 4500, level: 7, cs: 64, k: 1, d: 1, a: 1 });
  assert.deepEqual(e.opp[10], { gold: 3500, xp: 4000, level: 7, cs: 56 });
  assert.equal(e.me[15], undefined, 'matchen nådde inte 15 min');
  assert.equal(e.firstBlood, 'assist');
});

test('deriveEarly: first blood, gamla PUUID och saknad spelare', () => {
  const t = structuredClone(timeline);
  t.info.frames[1].events[0] = { type: 'CHAMPION_KILL', timestamp: 170000, killerId: 7, victimId: 1, assistingParticipantIds: [] };
  assert.equal(deriveEarly(match, t, ME).firstBlood, 'died');
  t.info.frames[1].events[0] = { type: 'CHAMPION_KILL', timestamp: 170000, killerId: 7, victimId: 2, assistingParticipantIds: [] };
  assert.equal(deriveEarly(match, t, ME).firstBlood, null, 'first blood utan dig');
  assert.ok(deriveEarly(match, timeline, ['ny', ME]), 'hittas via gamla PUUID');
  assert.equal(deriveEarly(match, timeline, 'någon'), null);
});

test('deriveEarly: frames som saknar fält (Riot utelämnar 0) och ingen motståndare', () => {
  const m = structuredClone(match);
  m.info.participants[0].teamPosition = '';
  const t = { info: { participants: [{ participantId: 1, puuid: ME }], frames: [{ timestamp: 300000, participantFrames: { 1: {} }, events: [] }] } };
  const e = deriveEarly(m, t, ME);
  assert.deepEqual(e.me[5], { gold: 0, xp: 0, level: 0, cs: 0, k: 0, d: 0, a: 0 });
  assert.equal(e.opp, null);
});

test('deriveTeams: lagkamrater, motståndare och motståndarnas AP-andel', () => {
  assert.deepEqual(deriveTeams(match, ME), { allies: [22], enemies: [64, 103], enemy_ap_share: 60 });
  assert.equal(deriveTeams(match, 'någon'), null);
});
