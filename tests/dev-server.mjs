#!/usr/bin/env node
/*
 * Lokal utvecklingsserver för Nunu – kör hela appen utan Supabase och utan Riot-nyckel.
 *
 *   node tests/dev-server.mjs          → http://localhost:8787/
 *   Logga in: johan@nik.se / nunu123  (medlem)   ·   anna@nik.se / nunu123 (ej medlem)
 *   Koppla t.ex. Rymm3n#EUW och Smurf#EUW.
 *
 * Serverar repots filer och låtsas vara:
 *   - Supabase Auth (/auth/v1/…)
 *   - Supabase REST för schemat nunu (/rest/v1/…) med samma radskydd som 001_init.sql
 *   - Edge Function nunu-riot (/functions/v1/nunu-riot) – den RIKTIGA koden, mot låtsasdatabas
 *   - Riot API (låtsas-historik) och Data Dragon (champion-namn)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../supabase/functions/nunu-riot/handler.mjs';
import { createRiot } from '../supabase/functions/nunu-riot/riot.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- Låtsas-Riot ---------------- */

const CHAMPS = { 20: 'Nunu', 64: 'LeeSin', 104: 'Graves', 121: 'Khazix', 254: 'Vi', 234: 'Viego', 76: 'Nidalee', 59: 'JarvanIV', 113: 'Sejuani', 79: 'Gragas', 523: 'Aphelios', 103: 'Ahri', 22: 'Ashe', 412: 'Thresh', 86: 'Garen' };
const JUNGLERS = [64, 104, 121, 254, 234, 76, 59, 113];
const TAGS = { 20: 'Tank', 64: 'Fighter', 104: 'Marksman', 121: 'Assassin', 254: 'Fighter', 234: 'Assassin', 76: 'Assassin', 59: 'Tank', 113: 'Tank', 79: 'Fighter', 523: 'Marksman', 103: 'Mage', 22: 'Marksman', 412: 'Support', 86: 'Fighter' };
const LANERS = [79, 523, 103, 22, 412, 86];

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

/** Bygger en historik för ett konto: mest Nunu i djungeln, lite annat, några remakes och Arena. */
function buildHistory(puuid, size, seed) {
  const rand = rng(seed);
  const games = [];
  for (let i = 0; i < size; i++) {
    const n = 7000000000 + seed * 10000 + (size - i);
    const queue = rand() < 0.08 ? 1750 : rand() < 0.6 ? 420 : rand() < 0.7 ? 440 : 400;
    const nunu = queue !== 1750 && rand() < 0.85;
    const remake = queue !== 1750 && rand() < 0.03;
    const win = rand() < (nunu ? 0.54 : 0.48);
    const dur = remake ? 200 + Math.floor(rand() * 60) : 1300 + Math.floor(rand() * 900);
    const myPos = queue === 1750 ? '' : nunu ? 'JUNGLE' : ['MIDDLE', 'UTILITY', 'TOP'][Math.floor(rand() * 3)];
    const champ = nunu ? 20 : queue === 1750 ? [79, 523, 234][Math.floor(rand() * 3)] : [103, 412, 86][Math.floor(rand() * 3)];
    const opp = JUNGLERS[Math.floor(rand() * JUNGLERS.length)];
    const me = {
      participantId: 1, puuid, teamId: 100, teamPosition: myPos, championId: champ, championName: CHAMPS[champ], win,
      gameEndedInEarlySurrender: remake,
      kills: remake ? 0 : Math.floor(rand() * 12), deaths: remake ? 0 : Math.floor(rand() * 9), assists: remake ? 0 : Math.floor(rand() * 16),
      totalMinionsKilled: remake ? 0 : 10 + Math.floor(rand() * 30), neutralMinionsKilled: remake ? 0 : nunu ? 110 + Math.floor(rand() * 90) : 0,
      goldEarned: 8000 + Math.floor(rand() * 7000), totalDamageDealtToChampions: 9000 + Math.floor(rand() * 20000), visionScore: 15 + Math.floor(rand() * 35),
    };
    const enemy = { participantId: 6, puuid: `enemy-${n}`, teamId: 200, championName: CHAMPS[myPos === 'JUNGLE' ? opp : 22], teamPosition: myPos === 'JUNGLE' ? 'JUNGLE' : myPos, championId: myPos === 'JUNGLE' ? opp : 22, win: !win };
    const start = Date.UTC(2026, 9, 14) - i * 1000 * 3600 * (5 + Math.floor(rand() * 30));
    games.push({
      metadata: { matchId: `EUW1_${n}`, dataVersion: '2' },
      info: { gameStartTimestamp: start, gameEndTimestamp: start + dur * 1000, gameDuration: dur, queueId: queue, gameVersion: '16.20.1', participants: [me, enemy, ...others(rand, win, me, enemy)] },
    });
  }
  return games;
}

/** Fyra lagkamrater och fyra motståndare med slumpade champions (för synergier och lagkompositioner). */
function others(rand, win, me, enemy) {
  const pos = ['TOP', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const used = new Set([me.championId, enemy.championId]);
  const pick = () => { let c; do { c = LANERS[Math.floor(rand() * LANERS.length)]; } while (used.has(c) && used.size < 8); used.add(c); return c; };
  return [100, 200].flatMap((teamId, t) => pos.map((p, i) => {
    const championId = pick();
    const dmg = 12000 + Math.floor(rand() * 15000);
    const magic = TAGS[championId] === 'Mage' ? 0.85 : TAGS[championId] === 'Assassin' ? 0.4 : 0.1;
    return { participantId: (t ? 7 : 2) + i, puuid: `p-${teamId}-${i}-${championId}`, teamId, teamPosition: p, championId, championName: CHAMPS[championId], win: teamId === 100 ? win : !win, totalDamageDealtToChampions: dmg, magicDamageDealtToChampions: Math.round(dmg * magic) };
  }));
}

/** Tidslinje till en låtsasmatch: jämn skada per minut och dödsfallen utspridda över matchen. */
function buildTimeline(match) {
  const me = match.info.participants[0];
  const minutes = Math.floor(match.info.gameDuration / 60);
  const perMin = Math.round((me.totalDamageDealtToChampions || 0) / Math.max(1, minutes));
  const seed0 = Number(match.metadata.matchId.slice(-3));
  const frames = Array.from({ length: minutes + 1 }, (_, m) => ({
    timestamp: m * 60000,
    participantFrames: {
      1: { damageStats: { totalDamageDoneToChampions: m * perMin, totalDamageTaken: m * 700 }, totalGold: 500 + m * (380 + (seed0 % 7) * 15), xp: m * 410, level: Math.min(18, 1 + Math.floor(m / 1.6)), minionsKilled: m * 1, jungleMinionsKilled: m * 5 },
      6: { totalGold: 500 + m * (360 + (seed0 % 5) * 20), xp: m * 400, level: Math.min(18, 1 + Math.floor(m / 1.6)), minionsKilled: m, jungleMinionsKilled: m * 5 - (seed0 % 3) },
    },
    events: [],
  }));
  const places = [{ name: 'SRU_Blue', type: 'MONSTER' }, { name: 'SRU_Dragon_Fire', type: 'MONSTER' }, { name: 'Turret_T2_C_05_A', type: 'TOWER' }, { name: 'SRU_ChaosMinionMelee', type: 'MINION' }, null];
  // Kartpositioner: bot, top, mid, jungle (blå buff), river (drake)
  const spots = [{ x: 8000, y: 1000 }, { x: 1000, y: 9000 }, { x: 7000, y: 7200 }, { x: 3800, y: 7900 }, { x: 9866, y: 4414 }];
  const seed = Number(match.metadata.matchId.slice(-3));
  for (let i = 0; i < (me.kills || 0); i++) {
    const ms = Math.round(((i + 1) / ((me.kills || 0) + 2)) * match.info.gameDuration * 1000);
    frames[Math.min(minutes, Math.floor(ms / 60000))].events.push({
      type: 'CHAMPION_KILL', timestamp: ms, killerId: 1, victimId: 6, assistingParticipantIds: [], position: spots[(seed + i) % spots.length],
    });
  }
  for (let i = 0; i < (me.deaths || 0); i++) {
    const ms = Math.round(((i + 1) / ((me.deaths || 0) + 1)) * match.info.gameDuration * 1000);
    const place = places[(i + Number(match.metadata.matchId.slice(-2))) % places.length];
    frames[Math.min(minutes, Math.floor(ms / 60000))].events.push({
      type: 'CHAMPION_KILL', timestamp: ms, killerId: 6, victimId: 1, assistingParticipantIds: i % 3 === 0 ? [] : [6], position: spots[(seed + i + 2) % spots.length],
      victimDamageReceived: [
        { participantId: 6, name: 'x', type: 'OTHER', physicalDamage: 800 + i * 50, magicDamage: 200 },
        ...(place ? [{ participantId: 0, ...place, physicalDamage: 250 }] : []),
      ],
    });
  }
  return { metadata: { matchId: match.metadata.matchId }, info: { participants: match.info.participants.map((p) => ({ participantId: p.participantId, puuid: p.puuid })), frames } };
}

export function createFakeRiot({ rateLimit = { count: 100, windowMs: 6000 } } = {}) {
  const accounts = {
    'Rymm3n#EUW': { puuid: 'p'.repeat(70) + 'rymm3n01', history: 230, seed: 1, nunuPoints: 1930343, level: 178 },
    'Smurf#EUW': { puuid: 's'.repeat(70) + 'smurf001', history: 45, seed: 2, nunuPoints: 210000, level: 32 },
  };
  const histories = new Map();
  const matches = new Map();
  for (const [riotId, a] of Object.entries(accounts)) {
    const h = buildHistory(a.puuid, a.history, a.seed);
    histories.set(a.puuid, h.map((m) => m.metadata.matchId));
    h.forEach((m) => matches.set(m.metadata.matchId, m));
    a.riotId = riotId;
  }
  let window = [];
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  async function fetchImpl(url) {
    const now = Date.now();
    window = window.filter((t) => now - t < rateLimit.windowMs);
    if (window.length >= rateLimit.count) {
      return json(429, {}, { 'retry-after': String(Math.ceil((rateLimit.windowMs - (now - window[0])) / 1000)) });
    }
    window.push(now);
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname);
    let m;
    if ((m = p.match(/by-riot-id\/(.+)\/(.+)$/))) {
      const a = accounts[`${m[1]}#${m[2]}`];
      return a ? json(200, { puuid: a.puuid, gameName: m[1], tagLine: m[2] }) : json(404, {});
    }
    if ((m = p.match(/accounts\/by-puuid\/(.+)$/))) {
      const a = Object.values(accounts).find((x) => x.puuid === m[1]);
      const [gameName, tagLine] = a.riotId.split('#');
      return json(200, { puuid: a.puuid, gameName, tagLine });
    }
    if ((m = p.match(/matches\/by-puuid\/(.+)\/ids$/))) {
      const ids = histories.get(m[1]) || [];
      const start = Number(u.searchParams.get('start'));
      return json(200, ids.slice(start, start + Number(u.searchParams.get('count'))));
    }
    if ((m = p.match(/\/matches\/(EUW1_\d+)\/timeline$/))) return matches.has(m[1]) ? json(200, buildTimeline(matches.get(m[1]))) : json(404, {});
    if ((m = p.match(/\/matches\/(EUW1_\d+)$/))) return matches.has(m[1]) ? json(200, matches.get(m[1])) : json(404, {});
    if (p.includes('champion-masteries/by-puuid/')) {
      const a = Object.values(accounts).find((x) => p.includes(x.puuid));
      return json(200, [
        { championId: 20, championLevel: a.level, championPoints: a.nunuPoints, lastPlayTime: Date.UTC(2026, 9, 13) },
        { championId: 64, championLevel: 7, championPoints: 45000, lastPlayTime: Date.UTC(2026, 6, 1) },
      ]);
    }
    return json(404, {});
  }
  return { fetchImpl, accounts };
}

/* ---------------- Låtsas-Supabase: lagring med samma regler som 001_init.sql ---------------- */

export function createStore() {
  const users = {
    'johan@nik.se': { id: 'aaaaaaaa-0000-0000-0000-000000000001', password: 'nunu123' },
    'anna@nik.se': { id: 'bbbbbbbb-0000-0000-0000-000000000002', password: 'nunu123' },
  };
  const t = { member: [{ user_id: users['johan@nik.se'].id }], profile: [], riot_account: [], raw_match: new Map(), account_match: [], mastery: [], death: [], storage: new Map() };
  // Äldre säsonger (002_season_history.sql) – här kopplade direkt till användaren
  t.season_history = [
    ['S2022', 20, 833, 451, 9.0, 5.3, 12.3], ['S2022', 35, 47, 19, 9.0, 5.9, 7.4],
    ['S2023 S1', 20, 278, 136, 7.3, 5.4, 10.9], ['S2023 S1', 48, 10, 4, 6.4, 6.6, 8.4],
  ].map(([season, champion_id, games, wins, kills, deaths, assists]) =>
    ({ user_id: users['johan@nik.se'].id, season, champion_id, games, wins, kills, deaths, assists }));
  const tokens = new Map();

  // Samma gränssnitt som supabase/functions/nunu-riot/db.mjs (service role – ser allt)
  const db = {
    isMember: async (userId) => t.member.some((m) => m.user_id === userId),
    ensureProfile: async (userId) => {
      let p = t.profile.find((x) => x.user_id === userId);
      if (!p) t.profile.push((p = { id: randomUUID(), user_id: userId, display_name: '' }));
      return p;
    },
    getAccount: async (puuid) => t.riot_account.find((a) => a.puuid === puuid) || null,
    listAccounts: async (profileId) => t.riot_account.filter((a) => a.profile_id === profileId),
    upsertAccount: async (row) => {
      const a = t.riot_account.find((x) => x.puuid === row.puuid);
      if (a) Object.assign(a, row);
      else t.riot_account.push({ linked_at: new Date().toISOString(), last_synced_at: null, backfill_done: false, ...row });
    },
    updateAccount: async (puuid, f) => Object.assign(t.riot_account.find((a) => a.puuid === puuid) || {}, f),
    knownMatchIds: async (puuid) => new Set(t.account_match.filter((r) => r.puuid === puuid).map((r) => r.match_id)),
    staleMatchIds: async (puuid, version) => t.account_match.filter((r) => r.puuid === puuid && r.derived_version < version).map((r) => r.match_id),
    getTimeline: async (id) => t.storage.get(id) || null,
    storeTimeline: async (id, tl) => { t.storage.set(id, tl); },
    replaceDeaths: async (ids, puuid, rows) => {
      t.death = t.death.filter((d) => !(d.puuid === puuid && ids.includes(d.match_id))).concat(rows);
    },
    getRawMatches: async (ids) => ids.filter((id) => t.raw_match.has(id)).map((id) => ({ match_id: id, payload: t.raw_match.get(id).payload })),
    insertRawMatches: async (rows) => rows.forEach((r) => { if (!t.raw_match.has(r.match_id)) t.raw_match.set(r.match_id, r); }),
    upsertAccountMatches: async (rows) => rows.forEach((r) => {
      const i = t.account_match.findIndex((x) => x.puuid === r.puuid && x.match_id === r.match_id);
      if (i >= 0) t.account_match[i] = r; else t.account_match.push(r);
    }),
    upsertMastery: async (rows) => rows.forEach((r) => {
      const i = t.mastery.findIndex((x) => x.puuid === r.puuid && x.champion_id === r.champion_id);
      if (i >= 0) t.mastery[i] = r; else t.mastery.push(r);
    }),
  };

  // Radskydd som i 001_init.sql
  const ownProfiles = (uid) => t.profile.filter((p) => p.user_id === uid).map((p) => p.id);
  const ownPuuids = (uid) => t.riot_account.filter((a) => ownProfiles(uid).includes(a.profile_id)).map((a) => a.puuid);
  const visible = {
    member: (uid) => t.member.filter((m) => m.user_id === uid),
    profile: (uid) => t.profile.filter((p) => p.user_id === uid),
    riot_account: (uid) => t.riot_account.filter((a) => ownProfiles(uid).includes(a.profile_id)),
    account_match: (uid) => t.account_match.filter((r) => ownPuuids(uid).includes(r.puuid)),
    mastery: (uid) => t.mastery.filter((r) => ownPuuids(uid).includes(r.puuid)),
    death: (uid) => t.death.filter((r) => ownPuuids(uid).includes(r.puuid)),
    season_history: (uid) => t.season_history.filter((r) => r.user_id === uid),
  };

  return { users, t, tokens, db, visible };
}

/* ---------------- HTTP ---------------- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml' };

export function createDevServer({ port = 8787, riot = createFakeRiot(), store = createStore() } = {}) {
  const base = `http://localhost:${port}`;
  const fnHandler = createHandler({
    getUser: async (token) => store.tokens.get(token) || null,
    makeDeps: () => ({ riot: createRiot({ apiKey: 'RGAPI-dev', fetchImpl: riot.fetchImpl, spacingMs: 0 }), db: store.db }),
  });

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', ...headers });
    res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });

  const issue = (user) => {
    const token = randomUUID();
    store.tokens.set(token, user);
    return { access_token: token, refresh_token: randomUUID(), expires_in: 3600, user: { email: user.email } };
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, base);
    const p = u.pathname;
    if (req.method === 'OPTIONS') return send(res, 204);

    // Konfiguration: peka appen mot den här servern
    if (p === '/js/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(`window.APP_CONFIG = { SUPABASE_URL: '${base}', SUPABASE_KEY: 'sb_publishable_dev', DDRAGON_URL: '${base}/ddragon' };`);
    }

    // Data Dragon
    if (p === '/ddragon/api/versions.json') return send(res, 200, ['16.20.1']);
    if (p.endsWith('/champion.json')) {
      const data = Object.fromEntries(Object.entries(CHAMPS).map(([key, id]) => [id, { key, name: id === 'Nunu' ? 'Nunu & Willump' : id.replace(/([a-z])([A-Z])/g, '$1 $2'), image: { full: `${id}.png` }, tags: [TAGS[key]] }]));
      return send(res, 200, { data });
    }
    if (p.startsWith('/ddragon/cdn/') && p.endsWith('.png')) {
      const name = p.split('/').pop().replace('.png', '');
      const hue = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
      return send(res, 200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="hsl(${hue},45%,35%)"/><text x="20" y="25" font-size="13" font-family="sans-serif" fill="#fff" text-anchor="middle">${name.slice(0, 3)}</text></svg>`, { 'content-type': 'image/svg+xml' });
    }

    // Auth
    if (p === '/auth/v1/token') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (u.searchParams.get('grant_type') === 'password') {
        const user = store.users[String(body.email).toLowerCase()];
        if (!user || user.password !== body.password) return send(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(res, 200, issue({ id: user.id, email: body.email }));
      }
      return send(res, 400, { msg: 'refresh stöds inte i dev-servern' });
    }
    if (p === '/auth/v1/logout') { store.tokens.delete((req.headers.authorization || '').slice(7)); return send(res, 204); }

    // Edge Function – den riktiga handler-koden
    if (p === '/functions/v1/nunu-riot') {
      const body = await readBody(req);
      const r = await fnHandler(new Request(base + p, { method: req.method, headers: req.headers, body: req.method === 'POST' ? body : undefined }));
      return send(res, r.status, await r.text());
    }

    // REST för schemat nunu (bara det appen använder)
    if (p.startsWith('/rest/v1/')) {
      const user = store.tokens.get((req.headers.authorization || '').slice(7));
      if (!user) return send(res, 401, { message: 'JWT expired' });
      if (req.headers['accept-profile'] !== 'nunu') return send(res, 406, { message: 'The schema must be one of the following: public' });
      const table = p.slice('/rest/v1/'.length);
      if (!store.visible[table]) return send(res, 403, { message: 'permission denied' });
      const uid = user.id;
      const eq = (k) => (u.searchParams.get(k) || '').replace(/^eq\./, '');

      if (req.method === 'GET') {
        let rows = store.visible[table](uid);
        const order = u.searchParams.get('order');
        if (order) {
          const [col, dir] = order.split('.');
          rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1));
        }
        const [from, to] = (req.headers.range || '0-999').split('-').map(Number);
        return send(res, 200, rows.slice(from, to + 1));
      }
      if (req.method === 'POST' && table === 'profile') {
        let row = store.t.profile.find((x) => x.user_id === uid);
        if (!row) store.t.profile.push((row = { id: randomUUID(), user_id: uid, display_name: '' }));
        return send(res, 201, [row]);
      }
      if (req.method === 'PATCH' && table === 'profile') {
        const row = store.visible.profile(uid).find((x) => x.id === eq('id'));
        if (row) Object.assign(row, JSON.parse(await readBody(req)));
        return send(res, 204);
      }
      if (req.method === 'DELETE' && table === 'riot_account') {
        const puuid = eq('puuid');
        if (store.visible.riot_account(uid).some((a) => a.puuid === puuid)) {
          store.t.riot_account = store.t.riot_account.filter((a) => a.puuid !== puuid);
          store.t.account_match = store.t.account_match.filter((r) => r.puuid !== puuid);
          store.t.mastery = store.t.mastery.filter((r) => r.puuid !== puuid);
          store.t.death = store.t.death.filter((r) => r.puuid !== puuid);
        }
        return send(res, 204);
      }
      return send(res, 403, { message: 'permission denied' });
    }

    // Statiska filer
    try {
      let file = join(ROOT, decodeURIComponent(p));
      if (!file.startsWith(ROOT)) return send(res, 403, 'nej');
      if (p.endsWith('/')) file = join(file, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      return res.end(data);
    } catch {
      return send(res, 404, 'Hittades inte');
    }
  });

  return {
    store,
    riot,
    listen: () => new Promise((r) => server.listen(port, () => r(base))),
    close: () => new Promise((r) => server.close(r)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dev = createDevServer({ port: Number(process.env.PORT) || 8787 });
  dev.listen().then((base) => {
    console.log(`Nunu dev-server: ${base}/`);
    console.log('Logga in: johan@nik.se / nunu123   (anna@nik.se / nunu123 är inte medlem)');
    console.log('Koppla: Rymm3n#EUW och Smurf#EUW');
  });
}
