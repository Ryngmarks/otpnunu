/*
 * Riot-import: koppla konton och synka matcher, tidslinjer och mastery.
 * Får in riot (riot.mjs) och db (server/db.mjs) – testas med låtsasversioner.
 */
import { HttpError, RateLimitError, parseRiotId, regionFor } from './riot.mjs';
import { RIFT_QUEUES, deriveAccountMatch, deriveDeaths, deriveMastery, rawMatchRow } from './derive.mjs';

export const BATCH_SIZE = 40;     // matcher per omgång: match + tidslinje = 2 anrop, under 100 anrop / 2 min
const MAX_HISTORY = 2000;         // så långt bak vi letar efter match-id:n

/** Koppla ett Riot-konto (Riot ID). */
export async function linkAccount({ riot, db, riotId, platform = 'euw1' }) {
  const { gameName, tagLine } = parseRiotId(riotId);
  const region = regionFor(platform);
  const acc = await riot.accountByRiotId(region, gameName, tagLine);
  if (!acc) throw new HttpError(404, `Hittade inget konto ${gameName}#${tagLine}`);
  const existing = await db.getAccount(acc.puuid);
  const row = { puuid: acc.puuid, game_name: acc.gameName, tag_line: acc.tagLine, platform, region };
  await db.upsertAccount(row);
  return { ...row, already_linked: !!existing };
}

/**
 * Hämtar match-id:n, nyast först. När hela historiken redan är hämtad
 * (backfill_done) räcker det att läsa tills vi når en känd match.
 */
async function findMissingIds({ riot, account, known }) {
  const missing = [];
  for (let start = 0; start < MAX_HISTORY; start += 100) {
    const page = await riot.matchIds(account.region, account.puuid, start, 100);
    const fresh = page.filter((id) => !known.has(id));
    missing.push(...fresh);
    if (page.length < 100) break;
    if (account.backfill_done && fresh.length < page.length) break;
  }
  return missing;
}

/**
 * Synkar ett konto: mastery + upp till BATCH_SIZE saknade matcher (med tidslinje på Summoner's Rift).
 * Rådata som redan finns (annat konto, eller importerade filer) hämtas inte igen.
 * Returnerar { puuid, imported, remaining, retryAfter, done }.
 * done = false betyder att webbsidan ska anropa igen (efter retryAfter sekunder om den är satt).
 */
export async function syncAccount({ riot, db, account, batchSize = BATCH_SIZE, now = () => new Date() }) {
  const result = { puuid: account.puuid, imported: 0, remaining: 0, retryAfter: null, done: false };
  let missing = [];
  try {
    // Namnet kan ha bytts sedan kontot kopplades
    const acc = await riot.accountByPuuid(account.region, account.puuid);
    if (acc && (acc.gameName !== account.game_name || acc.tagLine !== account.tag_line)) {
      await db.updateAccount(account.puuid, { game_name: acc.gameName, tag_line: acc.tagLine });
    }

    const masteries = await riot.masteries(account.platform, account.puuid);
    await db.upsertMastery(masteries.map((m) => deriveMastery(m, account.puuid)));

    const known = await db.knownMatchIds(account.puuid);
    missing = await findMissingIds({ riot, account, known });
    const batch = missing.slice(0, batchSize);

    const storedMatches = new Map((await db.getRawMatches(batch)).map((r) => [r.match_id, r.payload]));
    const storedTimelines = new Map((await db.getRawTimelines(batch)).map((r) => [r.match_id, r.payload]));
    const newMatches = [];
    const newTimelines = [];
    const derived = [];
    const deaths = [];
    try {
      for (const id of batch) {
        let match = storedMatches.get(id);
        if (!match) {
          match = await riot.match(account.region, id);
          if (!match) { result.imported++; continue; } // borttagen hos Riot – hoppa över
          newMatches.push(rawMatchRow(match, account.region));
        }
        let timeline = storedTimelines.get(id) || null;
        if (!timeline && RIFT_QUEUES.includes(Number(match.info.queueId))) {
          timeline = await riot.timeline(account.region, id);
          if (timeline) newTimelines.push({ match_id: id, payload: timeline });
        }
        const row = deriveAccountMatch(match, account.puuid, timeline);
        if (row) {
          derived.push(row);
          deaths.push(...deriveDeaths(match, account.puuid, timeline));
        }
        result.imported++;
      }
    } finally {
      // Spara det vi hann hämta, även om Riot bad oss vänta. Ordningen följer de främmande nycklarna.
      await db.insertRawMatches(newMatches);
      await db.insertRawTimelines(newTimelines);
      await db.upsertAccountMatches(derived);
      await db.replaceDeaths(derived.map((r) => r.match_id), account.puuid, deaths);
    }
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    result.retryAfter = err.retryAfter;
  }

  result.remaining = Math.max(0, missing.length - result.imported);
  result.done = result.retryAfter === null && result.remaining === 0;
  await db.updateAccount(account.puuid, {
    last_synced_at: now().toISOString(),
    ...(result.done ? { backfill_done: true } : {}),
  });
  return result;
}
