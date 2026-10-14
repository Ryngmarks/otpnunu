/*
 * Låtsas-Riot för tester och dev-servern: konton, match-id:n, matcher, tidslinjer och mastery.
 *   P1 = Rymm3n (alla matcher 1..n), P2 = Smurf (inga egna), PX = någon annan (samma matcher som P1).
 */
export const P1 = 'a'.repeat(78);
export const P2 = 'b'.repeat(78);
export const PX = 'x'.repeat(78);

const CHAMPS = [64, 121, 254, 234, 76]; // motståndare i jungle, roterar

function participant(id, puuid, teamId, pos, championId, extra = {}) {
  return {
    participantId: id, puuid, teamId, teamPosition: pos, championId, championName: `C${championId}`,
    win: teamId === 100, kills: 5, deaths: 2, assists: 8,
    totalMinionsKilled: 30, neutralMinionsKilled: 150, goldEarned: 12000, visionScore: 30,
    totalDamageDealtToChampions: 20000, physicalDamageDealtToChampions: 2000, magicDamageDealtToChampions: 17000,
    trueDamageDealtToChampions: 1000, totalDamageTaken: 30000, damageSelfMitigated: 20000, damageDealtToObjectives: 25000,
    ...extra,
  };
}

/** Match nr n (nyare = högre n). Match 7 är en remake, var 5:e är ARAM (ingen tidslinje), jämna förlorar. */
export function matchJson(n) {
  const opp = CHAMPS[n % CHAMPS.length];
  const win = n % 2 === 1;
  const parts = [
    participant(1, P1, 100, 'JUNGLE', 20, { win, ...(n === 7 ? { gameEndedInEarlySurrender: true } : {}) }),
    participant(2, 'm'.repeat(78), 100, 'MIDDLE', 103, { win, totalDamageDealtToChampions: 30000 }),
    participant(6, PX, 200, 'JUNGLE', opp, { win: !win, totalDamageDealtToChampions: 15000 }),
  ];
  return {
    metadata: { matchId: `EUW1_${n}` },
    info: {
      gameStartTimestamp: Date.UTC(2026, 0, 10) + n * 3600e3, gameEndTimestamp: 1, gameDuration: 1800,
      queueId: n % 5 === 0 ? 450 : 420, participants: parts,
    },
  };
}

/** Tidslinje: P1 gör 400 skada/min och dör vid 3:30 (vid blue, av motståndaren) och 12:00 (under torn). */
export function timelineJson(n) {
  const frame = (minute, events = []) => ({
    timestamp: minute * 60000,
    participantFrames: { 1: { damageStats: { totalDamageDoneToChampions: minute * 400, totalDamageTaken: minute * 600 } } },
    events,
  });
  const frames = Array.from({ length: 31 }, (_, m) => frame(m));
  frames[3].events.push({
    type: 'CHAMPION_KILL', timestamp: 210000, killerId: 6, victimId: 1, assistingParticipantIds: [],
    victimDamageReceived: [
      { participantId: 6, name: 'X', type: 'OTHER', physicalDamage: 900, magicDamage: 0, trueDamage: 0 },
      { participantId: 0, name: 'SRU_Blue', type: 'MINION', physicalDamage: 300 },
    ],
  });
  frames[12].events.push({
    type: 'CHAMPION_KILL', timestamp: 720000, killerId: 0, victimId: 1, assistingParticipantIds: [6],
    victimDamageReceived: [{ participantId: 0, name: 'Turret_T2_C_05_A', type: 'TOWER', physicalDamage: 1500 }],
  });
  return {
    metadata: { matchId: `EUW1_${n}` },
    info: { participants: [{ participantId: 1, puuid: P1 }, { participantId: 2, puuid: 'm'.repeat(78) }, { participantId: 6, puuid: PX }], frames },
  };
}

export function fakeRiot({ history = { [P1]: 250, [P2]: 0, [PX]: 250 }, rateLimitAfter = Infinity } = {}) {
  const calls = { total: 0, matches: 0, timelines: 0, idPages: 0 };
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
      if (!name) return res(400, { status: { message: 'Bad Request - Exception decrypting', status_code: 400 } }); // PUUID från en annan nyckel
      return res(200, { puuid: m[1], gameName: name.split('#')[0], tagLine: 'EUW' });
    }
    if ((m = p.match(/matches\/by-puuid\/(.+)\/ids$/))) {
      calls.idPages++;
      const total = history[m[1]] || 0;
      const start = Number(u.searchParams.get('start'));
      const count = Number(u.searchParams.get('count'));
      const all = m[1] === P2 ? [] : Array.from({ length: total }, (_, i) => `EUW1_${total - i}`);
      return res(200, all.slice(start, start + count));
    }
    if ((m = p.match(/\/matches\/(EUW1_\d+)\/timeline$/))) {
      calls.timelines++;
      return res(200, timelineJson(Number(m[1].split('_')[1])));
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
