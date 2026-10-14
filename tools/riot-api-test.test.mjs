// Tester för riot-api-test.mjs mot en låtsas-Riot. Kör: node --test "tools/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRiotId, summarizeMatch, measure, maskPuuid, createRiotClient,
  runApiTest, formatReport, NUNU_CHAMPION_ID,
} from './riot-api-test.mjs';

const PUUID = 'p'.repeat(78);
const KEY = 'RGAPI-test';

function fakeMatch(i, championId) {
  return {
    metadata: { matchId: `EUW1_${1000 - i}`, dataVersion: '2', participants: [PUUID] },
    info: {
      gameStartTimestamp: Date.UTC(2026, 9, 1) - i * 86400000,
      gameDuration: 1800,
      queueId: 420,
      gameVersion: '16.20.1',
      participants: [
        { puuid: 'other', championId: 1, championName: 'Annie', win: false },
        { puuid: PUUID, championId, championName: championId === 20 ? 'Nunu' : 'Lee Sin', teamPosition: 'JUNGLE',
          win: i % 2 === 0, kills: 3, deaths: 2, assists: 9, totalMinionsKilled: 20, neutralMinionsKilled: 140 },
      ],
    },
  };
}

/** Låtsas-Riot: svarar på samma vägar som riktiga API:t och loggar anropen. */
function fakeRiot({ historySize = 250, rateLimitOnce = false, nunuMastery = true } = {}) {
  const calls = [];
  let limited = !rateLimitOnce;
  const json = (status, body, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-app-rate-limit': '20:1,100:120', ...headers } });

  async function fetchImpl(url, opts) {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (opts.headers['X-Riot-Token'] !== KEY) return json(401, { status: { message: 'Unauthorized' } });
    if (!limited) { limited = true; return json(429, {}, { 'retry-after': '1' }); }
    const p = u.pathname;
    if (p === '/riot/account/v1/accounts/by-riot-id/Rymm3n/EUW') return json(200, { puuid: PUUID, gameName: 'Rymm3n', tagLine: 'EUW' });
    if (p.startsWith('/riot/account/')) return json(404, {});
    if (p.endsWith('/ids')) {
      const start = Number(u.searchParams.get('start'));
      const n = Math.max(0, Math.min(100, historySize - start));
      return json(200, Array.from({ length: n }, (_, k) => `EUW1_${1000 - start - k}`));
    }
    if (p.endsWith('/timeline')) return json(200, { metadata: {}, info: { frames: new Array(31).fill({ events: [] }) } });
    const m = p.match(/\/matches\/EUW1_(\d+)$/);
    if (m) { const i = 1000 - Number(m[1]); return json(200, fakeMatch(i, i % 3 === 0 ? NUNU_CHAMPION_ID : 64)); }
    if (p.endsWith(`/by-champion/${NUNU_CHAMPION_ID}`)) {
      return nunuMastery ? json(200, { championId: 20, championLevel: 12, championPoints: 154321, lastPlayTime: Date.UTC(2026, 9, 1) }) : json(404, {});
    }
    if (p.includes('/champion-masteries/by-puuid/')) return json(200, [{ championId: 64 }, { championId: 20 }, { championId: 1 }]);
    if (p.includes('/scores/by-puuid/')) return json(200, 412);
    return json(404, {});
  }
  return { fetchImpl, calls };
}

const noSleep = async () => {};

test('parseRiotId delar namn och tagg', () => {
  assert.deepEqual(parseRiotId('Rymm3n#EUW'), { gameName: 'Rymm3n', tagLine: 'EUW' });
  assert.deepEqual(parseRiotId('Namn med # i#EUW'), { gameName: 'Namn med # i', tagLine: 'EUW' });
  assert.throws(() => parseRiotId('Rymm3n'));
  assert.throws(() => parseRiotId('Rymm3n#'));
});

test('summarizeMatch läser ut kontots rad', () => {
  const s = summarizeMatch(fakeMatch(0, 20), PUUID);
  assert.equal(s.championId, 20);
  assert.equal(s.cs, 160);
  assert.equal(s.win, true);
  assert.equal(summarizeMatch(fakeMatch(0, 20), 'saknas'), null);
});

test('measure ger rå och komprimerad storlek', () => {
  const m = measure(JSON.stringify({ a: 'x'.repeat(5000) }));
  assert.ok(m.raw > 5000);
  assert.ok(m.gzip < m.raw / 10);
});

test('maskPuuid visar aldrig hela PUUID', () => {
  assert.ok(!maskPuuid(PUUID).includes(PUUID));
});

test('klienten väntar och försöker igen efter 429', async () => {
  const riot = fakeRiot({ rateLimitOnce: true });
  const slept = [];
  const client = createRiotClient({ apiKey: KEY, fetchImpl: riot.fetchImpl, sleep: async (ms) => slept.push(ms), spacingMs: 0 });
  const res = await client.get('https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Rymm3n/EUW');
  assert.equal(res.json.puuid, PUUID);
  assert.equal(client.stats.retries, 1);
  assert.ok(slept.includes(1000));
});

test('fel nyckel ger begripligt fel', async () => {
  const riot = fakeRiot();
  await assert.rejects(
    runApiTest({ apiKey: 'fel', fetchImpl: riot.fetchImpl, sleep: noSleep }),
    (err) => err.status === 401 && /Nyckel/.test(err.message),
  );
});

test('okänt Riot ID ger 404 med tips', async () => {
  const riot = fakeRiot();
  await assert.rejects(
    runApiTest({ apiKey: KEY, riotId: 'Finns#Inte', fetchImpl: riot.fetchImpl, sleep: noSleep }),
    (err) => err.status === 404 && /Riot ID/.test(err.message),
  );
});

test('hela testet: 20 matcher, en tidslinje, mastery och rapport', async () => {
  const riot = fakeRiot({ historySize: 250 });
  const r = await runApiTest({ apiKey: KEY, fetchImpl: riot.fetchImpl, sleep: noSleep });

  assert.equal(r.matches.length, 20);
  assert.equal(r.historyIds, 250);
  assert.equal(r.historyCapped, false);
  assert.ok(r.matches.every((m) => m.summary && m.summary.matchId));
  assert.equal(r.timeline.frames, 31);
  assert.equal(r.mastery.nunu.level, 12);
  assert.equal(r.mastery.nunuRank, 2);
  assert.equal(r.mastery.totalScore, 412);

  // Exakt de anrop vi förväntar oss: konto + 3 sidor id:n + 20 matcher + 1 tidslinje + 3 mastery
  assert.equal(r.requests, 1 + 3 + 20 + 1 + 3);
  assert.equal(riot.calls.filter((c) => /\/matches\/EUW1_\d+$/.test(c)).length, 20);

  const md = formatReport(r);
  assert.match(md, /Rymm3n#EUW/);
  assert.match(md, /Nunu & Willump: 7 av 20 matcher/);
  assert.match(md, /nivå 12/);
  assert.ok(!md.includes(PUUID), 'rapporten får inte innehålla hela PUUID');
  assert.ok(!md.includes(KEY), 'rapporten får inte innehålla nyckeln');
});

test('historiken räknas max 1000 bakåt och Nunu utan mastery hanteras', async () => {
  const riot = fakeRiot({ historySize: 5000, nunuMastery: false });
  const r = await runApiTest({ apiKey: KEY, fetchImpl: riot.fetchImpl, sleep: noSleep });
  assert.equal(r.historyIds, 1000);
  assert.equal(r.historyCapped, true);
  assert.equal(r.mastery.nunu, null);
  assert.match(formatReport(r), /minst 1000/);
  assert.match(formatReport(r), /ingen mastery hittades/);
});
