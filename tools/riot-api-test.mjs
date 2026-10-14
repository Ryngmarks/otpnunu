#!/usr/bin/env node
/*
 * Nunu – begränsat Riot API-test (steg 1 i docs/nunu-plan.md).
 *
 * Hämtar för ett Riot-konto:
 *   - kontot (Riot ID → PUUID)
 *   - de senaste 20 matcherna i sin helhet
 *   - en tidslinje (bara för att mäta storleken – sparas inte)
 *   - champion mastery för Nunu & Willump
 * och skriver en rapport om datavolym, historik och hastighetsgränser.
 *
 * Inget sparas i Supabase. Rådata skrivs bara till disk om --save <mapp> anges.
 *
 * Körning:
 *   RIOT_API_KEY=RGAPI-… node tools/riot-api-test.mjs
 *   RIOT_API_KEY=RGAPI-… node tools/riot-api-test.mjs --save ./riot-raw
 *
 * Miljövariabler:
 *   RIOT_API_KEY   (krävs)   Riot-nyckeln. Skrivs aldrig ut.
 *   RIOT_ID        Rymm3n#EUW
 *   RIOT_PLATFORM  euw1      (server för mastery)
 *   RIOT_REGION    europe    (region för konto och matcher)
 *   MATCH_COUNT    20
 */
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NUNU_CHAMPION_ID = 20;
const MAX_HISTORY_IDS = 1000; // hur långt bak vi räknar matcher (bara id:n, 10 anrop)

/* ---------------- Små rena hjälpfunktioner ---------------- */

export function parseRiotId(riotId) {
  const i = String(riotId || '').lastIndexOf('#');
  if (i < 1 || i === riotId.length - 1) throw new Error(`Ogiltigt Riot ID "${riotId}" – förväntat format Namn#Tagg`);
  return { gameName: riotId.slice(0, i).trim(), tagLine: riotId.slice(i + 1).trim() };
}

export function hosts({ platform = 'euw1', region = 'europe' } = {}) {
  return {
    regional: `https://${region}.api.riotgames.com`,
    platform: `https://${platform}.api.riotgames.com`,
  };
}

/** Bytes för rå JSON och gzip-komprimerad. */
export function measure(text) {
  const raw = Buffer.byteLength(text, 'utf8');
  return { raw, gzip: gzipSync(text).length };
}

export const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
export const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export const maskPuuid = (puuid) => (puuid ? `${puuid.slice(0, 6)}…${puuid.slice(-4)} (${puuid.length} tecken)` : '–');

/** Sammanfattar en match ur kontots perspektiv. Returnerar null om PUUID saknas i matchen. */
export function summarizeMatch(match, puuid) {
  const info = match.info || {};
  const p = (info.participants || []).find((x) => x.puuid === puuid);
  if (!p) return null;
  return {
    matchId: match.metadata && match.metadata.matchId,
    gameStart: info.gameStartTimestamp || info.gameCreation,
    durationS: info.gameDuration,
    queueId: info.queueId,
    gameVersion: info.gameVersion,
    dataVersion: match.metadata && match.metadata.dataVersion,
    championId: p.championId,
    championName: p.championName,
    teamPosition: p.teamPosition,
    win: p.win,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0),
  };
}

/* ---------------- Riot-anrop ---------------- */

export class RiotError extends Error {
  constructor(status, url, body) {
    const hint = {
      400: 'Felaktig förfrågan.',
      401: 'Nyckel saknas eller är ogiltig.',
      403: 'Nyckeln nekas – den har troligen gått ut (utvecklarnycklar gäller 24 h). Skapa en ny på developer.riotgames.com.',
      404: 'Hittades inte – kontrollera Riot ID / region.',
      429: 'För många anrop (rate limit).',
    }[status] || 'Oväntat svar från Riot.';
    super(`Riot ${status}: ${hint} (${new URL(url).pathname})`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Skapar en klient som räknar anrop, respekterar Retry-After och sparar
 * Riots rate limit-headers (för rapporten).
 */
export function createRiotClient({ apiKey, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), spacingMs = 60 }) {
  const stats = { requests: 0, retries: 0, limits: {} };
  let last = 0;

  async function get(url, { allow404 = false } = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = last + spacingMs - Date.now(); // håller oss under 20 anrop/sekund
      if (wait > 0) await sleep(wait);
      last = Date.now();
      stats.requests++;
      const res = await fetchImpl(url, { headers: { 'X-Riot-Token': apiKey } });
      for (const h of ['x-app-rate-limit', 'x-app-rate-limit-count', 'x-method-rate-limit', 'x-method-rate-limit-count']) {
        const v = res.headers.get(h);
        if (v) stats.limits[h] = v;
      }
      const text = await res.text();
      if (res.status === 429) {
        stats.retries++;
        await sleep((Number(res.headers.get('retry-after')) || 2) * 1000);
        continue;
      }
      if (res.status === 404 && allow404) return null;
      if (!res.ok) throw new RiotError(res.status, url, text.slice(0, 300));
      return { text, json: JSON.parse(text) };
    }
    throw new RiotError(429, url, '');
  }

  return { get, stats };
}

/* ---------------- Själva testet ---------------- */

export async function runApiTest({
  apiKey,
  riotId = 'Rymm3n#EUW',
  platform = 'euw1',
  region = 'europe',
  count = 20,
  baseUrls = hosts({ platform, region }),
  fetchImpl,
  sleep,
  saveDir = null,
  log = () => {},
}) {
  if (!apiKey) throw new Error('RIOT_API_KEY saknas');
  const started = Date.now();
  const client = createRiotClient({ apiKey, fetchImpl, sleep });
  const { gameName, tagLine } = parseRiotId(riotId);
  const save = async (name, text) => {
    if (!saveDir) return;
    await mkdir(saveDir, { recursive: true });
    await writeFile(join(saveDir, name), text);
  };

  // 1. Konto
  log(`Slår upp ${gameName}#${tagLine}…`);
  const account = await client.get(
    `${baseUrls.regional}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  const puuid = account.json.puuid;
  await save('account.json', account.text);

  // 2. Hur många matcher finns? (bara id:n, max 1000)
  log('Räknar tillgänglig matchhistorik…');
  const ids = [];
  for (let start = 0; start < MAX_HISTORY_IDS; start += 100) {
    const page = await client.get(`${baseUrls.regional}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=100`);
    ids.push(...page.json);
    if (page.json.length < 100) break;
  }

  // 3. De senaste matcherna i sin helhet
  const recent = ids.slice(0, count);
  const matches = [];
  for (const [i, id] of recent.entries()) {
    log(`Hämtar match ${i + 1}/${recent.length}…`);
    const m = await client.get(`${baseUrls.regional}/lol/match/v5/matches/${id}`);
    await save(`match-${id}.json`, m.text);
    matches.push({ size: measure(m.text), summary: summarizeMatch(m.json, puuid), topLevelKeys: Object.keys(m.json) });
  }

  // 4. En tidslinje – bara för att mäta storleken (helst en Nunu-match)
  let timeline = null;
  const timelineFor = (matches.find((m) => m.summary && m.summary.championId === NUNU_CHAMPION_ID) || matches[0] || {}).summary;
  if (timelineFor) {
    log('Mäter en tidslinje…');
    const t = await client.get(`${baseUrls.regional}/lol/match/v5/matches/${timelineFor.matchId}/timeline`);
    await save(`timeline-${timelineFor.matchId}.json`, t.text);
    timeline = { matchId: timelineFor.matchId, size: measure(t.text), frames: (t.json.info && t.json.info.frames || []).length };
  }

  // 5. Mastery
  log('Hämtar mastery…');
  const nunu = await client.get(
    `${baseUrls.platform}/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/by-champion/${NUNU_CHAMPION_ID}`,
    { allow404: true }
  );
  const all = await client.get(`${baseUrls.platform}/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}`);
  const score = await client.get(`${baseUrls.platform}/lol/champion-mastery/v4/scores/by-puuid/${puuid}`);
  await save('mastery-nunu.json', nunu ? nunu.text : 'null');
  await save('mastery-all.json', all.text);
  const rank = all.json.findIndex((m) => m.championId === NUNU_CHAMPION_ID);

  return {
    riotId: `${account.json.gameName}#${account.json.tagLine}`,
    puuid,
    platform,
    region,
    historyIds: ids.length,
    historyCapped: ids.length >= MAX_HISTORY_IDS,
    matches,
    timeline,
    mastery: {
      nunu: nunu && {
        level: nunu.json.championLevel,
        points: nunu.json.championPoints,
        lastPlayTime: nunu.json.lastPlayTime,
      },
      nunuRank: rank >= 0 ? rank + 1 : null,
      champions: all.json.length,
      totalScore: score.json,
      rawSize: measure(all.text),
    },
    requests: client.stats.requests,
    retries: client.stats.retries,
    limits: client.stats.limits,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

/* ---------------- Rapport ---------------- */

const date = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '–');

export function formatReport(r) {
  const found = r.matches.filter((m) => m.summary);
  const nunuGames = found.filter((m) => m.summary.championId === NUNU_CHAMPION_ID);
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const avgRaw = r.matches.length ? sum(r.matches, (m) => m.size.raw) / r.matches.length : 0;
  const avgGz = r.matches.length ? sum(r.matches, (m) => m.size.gzip) / r.matches.length : 0;
  const starts = found.map((m) => m.summary.gameStart).filter(Boolean).sort();
  const queues = {};
  for (const m of found) queues[m.summary.queueId] = (queues[m.summary.queueId] || 0) + 1;

  const lines = [
    `## Riot API-test – ${r.riotId}`,
    '',
    `- PUUID: \`${maskPuuid(r.puuid)}\` – samma PUUID hittades i ${found.length} av ${r.matches.length} matcher`,
    `- Server/region: ${r.platform} / ${r.region}`,
    `- Tillgänglig historik: ${r.historyCapped ? `minst ${r.historyIds}` : r.historyIds} match-id:n`,
    `- Hämtade matcher: ${r.matches.length} (${date(starts[0])} – ${date(starts[starts.length - 1])})`,
    `- Nunu & Willump: ${nunuGames.length} av ${found.length} matcher, ${nunuGames.filter((m) => m.summary.win).length} vinster`,
    `- Köer (queueId: antal): ${Object.entries(queues).map(([q, n]) => `${q}: ${n}`).join(', ') || '–'}`,
    '',
    '### Datavolym',
    '',
    '| | Rå JSON | Gzip |',
    '|---|---|---|',
    `| Snitt per match | ${kb(avgRaw)} | ${kb(avgGz)} |`,
    `| Uppskattat per 1 000 matcher | ${mb(avgRaw * 1000)} | ${mb(avgGz * 1000)} |`,
  ];
  if (r.timeline) {
    lines.push(
      `| En tidslinje (${r.timeline.frames} minuter) | ${kb(r.timeline.size.raw)} | ${kb(r.timeline.size.gzip)} |`,
      `| Uppskattat 1 000 tidslinjer | ${mb(r.timeline.size.raw * 1000)} | ${mb(r.timeline.size.gzip * 1000)} |`,
    );
  }
  lines.push(
    `| Mastery, alla champions | ${kb(r.mastery.rawSize.raw)} | ${kb(r.mastery.rawSize.gzip)} |`,
    '',
    '### Champion mastery',
    '',
    r.mastery.nunu
      ? `- Nunu & Willump: nivå ${r.mastery.nunu.level}, ${r.mastery.nunu.points.toLocaleString('sv-SE')} poäng, senast spelad ${date(r.mastery.nunu.lastPlayTime)}, plats ${r.mastery.nunuRank} av ${r.mastery.champions}`
      : '- Nunu & Willump: ingen mastery hittades',
    `- Total mastery score: ${r.mastery.totalScore}`,
    '',
    '### Senaste matcherna',
    '',
    '| Datum | Champion | Roll | Resultat | KDA | CS | Kö |',
    '|---|---|---|---|---|---|---|',
    ...found.map(({ summary: s }) =>
      `| ${date(s.gameStart)} | ${s.championName} | ${s.teamPosition || '–'} | ${s.win ? 'Vinst' : 'Förlust'} | ${s.kills}/${s.deaths}/${s.assists} | ${s.cs} | ${s.queueId} |`),
    '',
    '### Anrop',
    '',
    `- ${r.requests} anrop på ${r.seconds} s, ${r.retries} omförsök efter 429`,
    ...Object.entries(r.limits).map(([k, v]) => `- \`${k}\`: ${v}`),
    `- Datastruktur per match: ${[...new Set(r.matches.flatMap((m) => m.topLevelKeys))].join(', ')}`,
    `- Spelversion (senaste): ${(found[0] && found[0].summary.gameVersion) || '–'}, dataVersion ${(found[0] && found[0].summary.dataVersion) || '–'}`,
  );
  return lines.join('\n');
}

/* ---------------- Körning från kommandoraden ---------------- */

async function main() {
  const args = process.argv.slice(2);
  const saveIdx = args.indexOf('--save');
  const env = process.env;
  if (!env.RIOT_API_KEY) {
    const msg = 'RIOT_API_KEY saknas – API-testet hoppas över. Lägg in nyckeln som secret (se docs/nunu-plan.md) och kör igen.';
    console.log(msg);
    if (env.GITHUB_STEP_SUMMARY) await writeFile(env.GITHUB_STEP_SUMMARY, `> ${msg}\n`, { flag: 'a' });
    return;
  }
  const report = await runApiTest({
    apiKey: env.RIOT_API_KEY.trim(),
    riotId: env.RIOT_ID || 'Rymm3n#EUW',
    platform: env.RIOT_PLATFORM || 'euw1',
    region: env.RIOT_REGION || 'europe',
    count: Number(env.MATCH_COUNT) || 20,
    saveDir: saveIdx >= 0 ? args[saveIdx + 1] : null,
    log: (m) => console.error(m),
  });
  const md = formatReport(report);
  console.log(md);
  if (env.GITHUB_STEP_SUMMARY) await writeFile(env.GITHUB_STEP_SUMMARY, md + '\n', { flag: 'a' });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error(`\nAPI-testet misslyckades: ${err.message}`);
    process.exit(1);
  });
}
