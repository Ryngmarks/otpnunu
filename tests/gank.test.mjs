// Tester för gank-analysen (supabase/functions/nunu-riot/gank.mjs). Kör: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneOf, findGanks, gankResult } from '../supabase/functions/nunu-riot/gank.mjs';

test('zoneOf: torn, läger och objectives hamnar rätt', () => {
  const at = (x, y) => zoneOf({ x, y });
  // Torn (Riots koordinater)
  assert.equal(at(981, 10441), 'top', 'blått yttre topptorn');
  assert.equal(at(1512, 6699), 'top', 'blått inre topptorn');
  assert.equal(at(7943, 13411), 'top', 'rött inre topptorn');
  assert.equal(at(6919, 1483), 'bot', 'blått inre bottorn');
  assert.equal(at(13327, 8226), 'bot', 'rött inre bottorn');
  assert.equal(at(5846, 6396), 'mid', 'blått yttre midtorn');
  assert.equal(at(8955, 8510), 'mid', 'rött yttre midtorn');
  // Jungle-läger och objectives ska inte bli lane
  assert.equal(at(2288, 8448), 'jungle', 'blå gromp');
  assert.equal(at(3800, 7900), 'jungle', 'blå buff');
  assert.equal(at(3780, 6440), 'jungle', 'blå wolves');
  assert.equal(at(7100, 5450), 'jungle', 'blå raptors');
  assert.equal(at(12550, 6400), 'jungle', 'röd gromp');
  assert.equal(at(9866, 4414), 'river', 'drake');
  assert.equal(at(5007, 10471), 'river', 'baron/grubs');
  assert.equal(at(4400, 9600), 'river', 'scuttle');
  assert.equal(at(400, 400), 'bas');
  assert.equal(at(14400, 14400), 'bas');
  assert.equal(zoneOf(null), null);
});

/* Liten match: du (1) är jungler i blått lag. 2 = din botlane, 6 = deras jungler, 7 = deras botlane, 8 = deras top. */
const ME = 'me';
const match = (myPos = 'JUNGLE') => ({
  metadata: { matchId: 'EUW1_1' },
  info: {
    participants: [
      { participantId: 1, puuid: ME, teamId: 100, teamPosition: myPos, championId: 20 },
      { participantId: 2, puuid: 'a2', teamId: 100, teamPosition: 'BOTTOM', championId: 22 },
      { participantId: 6, puuid: 'e6', teamId: 200, teamPosition: 'JUNGLE', championId: 64 },
      { participantId: 7, puuid: 'e7', teamId: 200, teamPosition: 'BOTTOM', championId: 51 },
      { participantId: 8, puuid: 'e8', teamId: 200, teamPosition: 'TOP', championId: 86 },
    ],
  },
});
const kill = (t, killerId, victimId, assists, x, y) => ({ type: 'CHAMPION_KILL', timestamp: t, killerId, victimId, assistingParticipantIds: assists, position: { x, y } });
const timeline = (events) => ({ info: { participants: [{ participantId: 1, puuid: ME }], frames: [{ timestamp: 0, events }] } });
const BOT = [8000, 1000];
const TOP = [1000, 9000];

test('findGanks: en kill i bot med dig är en gank, en kill i bot utan dig är det inte', () => {
  const g = findGanks(match(), timeline([
    kill(200000, 2, 7, [], ...BOT),          // botlane-kill utan dig – ingen gank
    kill(330000, 2, 7, [1], ...BOT),         // du assisterar i bot – gank
    kill(400000, 1, 6, [], 4000, 7900),      // du dödar deras jungler i jungle – ingen gank
  ]), ME);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0], { t: 330000, lane: 'bot', takedowns: 1, kills: 0, died: false, vsJungler: false, victims: [51] });
  assert.equal(gankResult(g[0]), 'lyckad');
});

test('findGanks: kills i samma lane inom 15 s är en gank; byte och död i lane', () => {
  const g = findGanks(match(), timeline([
    kill(300000, 1, 7, [2], ...BOT),
    kill(308000, 7, 1, [6], ...BOT),          // du dör, deras jungler kontrar
    kill(310000, 2, 6, [1], ...BOT),          // 2-för-1
    kill(600000, 8, 1, [], ...TOP),           // dör i top utan takedown
    kill(1000000, 1, 8, [], ...TOP),          // efter 15:00 – räknas inte
  ]), ME);
  assert.equal(g.length, 2);
  assert.deepEqual([g[0].lane, g[0].takedowns, g[0].kills, g[0].died, g[0].vsJungler], ['bot', 2, 1, true, true]);
  assert.deepEqual(g[0].victims, [51, 64]);
  assert.equal(gankResult(g[0]), 'byte');
  assert.deepEqual([g[1].lane, g[1].takedowns, g[1].died], ['top', 0, true]);
  assert.equal(gankResult(g[1]), 'död');
});

test('findGanks: samma lane men mer än 15 s emellan blir två ganks', () => {
  const g = findGanks(match(), timeline([kill(300000, 1, 7, [], ...BOT), kill(330000, 1, 7, [], ...BOT)]), ME);
  assert.equal(g.length, 2);
});

test('findGanks: inte jungler, saknas i tidslinjen eller tidigare PUUID', () => {
  assert.equal(findGanks(match('MIDDLE'), timeline([kill(300000, 1, 7, [], ...BOT)]), ME), null);
  assert.equal(findGanks(match(), timeline([]), 'någon-annan'), null);
  assert.deepEqual(findGanks(match(), timeline([]), ['ny-puuid', ME]), [], 'gamla PUUID hittar dig');
});
