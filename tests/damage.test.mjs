// Tester för skadeanalysen (server/analysis/damage.mjs). Kör: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { damageCurve, damageAt, deaths, deriveTimeline, placeOf } from '../server/analysis/damage.mjs';

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
  assert.equal(d.killerChampionId, null, 'exemplet saknar championId');
});

test('placeOf och deriveTimeline', () => {
  assert.equal(placeOf('SRU_Dragon_Fire', 'MONSTER'), 'objective');
  assert.equal(placeOf('SRU_Horde', 'MONSTER'), 'objective');
  assert.equal(placeOf('SRU_Krug', 'MONSTER'), 'camp');
  assert.equal(placeOf('Turret_T1_L_03_A', 'TOWER'), 'torn');
  assert.equal(placeOf('SRU_ChaosMinionMelee', 'MINION'), 'våg');
  assert.equal(placeOf('Okänt', 'OTHER'), null);
  const t = deriveTimeline(timeline, match, ME);
  assert.deepEqual([t.at10, t.at14, t.at20], [4000, 6500, 6500]);
  assert.equal(t.deaths.length, 1);
  assert.equal(deriveTimeline(timeline, match, 'någon-annan'), null);
});
