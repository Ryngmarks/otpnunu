/*
 * Riot-import: koppla konton och synka matcher, tidslinjer och mastery.
 * Får in riot (riot.mjs) och db (db.mjs) – testas med låtsasversioner.
 */
import { HttpError, RateLimitError, parseRiotId, regionFor } from './riot.mjs';
import { DERIVED_VERSION, RIFT_QUEUES, deriveAccountMatch, deriveDeaths, deriveMastery, rawMatchRow } from './derive.mjs';

export const BATCH_SIZE = 20;     // matcher per anrop: match + tidslinje = 2 Riot-anrop, och Edge Functions har begränsad CPU-tid
const MAX_HISTORY = 2000;         // så långt bak vi letar efter match-id:n

/** Koppla ett Riot-konto (Riot ID) till användarens profil. */
export async function linkAccount({ riot, db, userId, riotId, platform = 'euw1' }) {
  const { gameName, tagLine } = parseRiotId(riotId);
  const region = regionFor(platform);
  const acc = await riot.accountByRiotId(region, gameName, tagLine);
  if (!acc) throw new HttpError(404, `Hittade inget konto ${gameName}#${tagLine}`);

  const profile = await db.ensureProfile(userId);
  const existing = await db.getAccount(acc.puuid);
  if (existing && existing.profile_id !== profile.id) {
    throw new HttpError(409, 'Kontot är redan kopplat till en annan profil');
  }
  const row = {
    puuid: acc.puuid,
    profile_id: profile.id,
    game_name: acc.gameName,
    tag_line: acc.tagLine,
    platform,
    region,
  };
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
 * Synkar ett konto: mastery + upp till BATCH_SIZE matcher.
 *   - nya matcher hämtas från Riot (rådata som redan finns återanvänds)
 *   - matcher uträknade med en äldre version räknas om (t.ex. för att få skada och dödsfall)
 * På Summoner's Rift hämtas även tidslinjen; den sparas gzippad i Storage och används för
 * skada vid 10/14/20 min och dödsfallen.
 * Returnerar { puuid, imported, remaining, retryAfter, done }.
 * done = false betyder att webbsidan ska anropa igen (efter retryAfter sekunder om den är satt).
 */
export async function syncAccount({ riot, db, account, batchSize = BATCH_SIZE, now = () => new Date() }) {
  const result = { puuid: account.puuid, imported: 0, remaining: 0, retryAfter: null, done: false };
  let todo = [];
  try {
    // Namnet kan ha bytts sedan kontot kopplades
    const acc = await riot.accountByPuuid(account.region, account.puuid);
    if (acc && (acc.gameName !== account.game_name || acc.tagLine !== account.tag_line)) {
      await db.updateAccount(account.puuid, { game_name: acc.gameName, tag_line: acc.tagLine });
    }

    const masteries = await riot.masteries(account.platform, account.puuid);
    await db.upsertMastery(masteries.map((m) => deriveMastery(m, account.puuid)));

    const known = await db.knownMatchIds(account.puuid);
    const missing = await findMissingIds({ riot, account, known });
    const stale = await db.staleMatchIds(account.puuid, DERIVED_VERSION);
    todo = [...missing, ...stale.filter((id) => !missing.includes(id))];
    const batch = todo.slice(0, batchSize);

    // Rådata som redan finns (äldre synk eller annat konto i samma match) hämtas inte igen
    const stored = new Map((await db.getRawMatches(batch)).map((r) => [r.match_id, r.payload]));
    const newRaw = [];
    const derived = [];
    const deaths = [];
    try {
      for (const id of batch) {
        let match = stored.get(id);
        if (!match) {
          match = await riot.match(account.region, id);
          if (!match) { result.imported++; continue; } // borttagen hos Riot – hoppa över
          newRaw.push(rawMatchRow(match, account.region));
        }
        let timeline = null;
        if (RIFT_QUEUES.includes(Number(match.info.queueId))) {
          // Finns tidslinjen redan i Storage? (bara möjligt om matchen fanns sedan tidigare)
          if (stored.has(id)) timeline = await db.getTimeline(id);
          if (!timeline) {
            timeline = await riot.timeline(account.region, id);
            if (timeline) await db.storeTimeline(id, timeline);
          }
        }
        const row = deriveAccountMatch(match, account.puuid, timeline);
        if (row) {
          derived.push(row);
          deaths.push(...deriveDeaths(match, account.puuid, timeline));
        }
        result.imported++;
      }
    } finally {
      // Spara det vi hann med, även om Riot bad oss vänta. Ordningen följer de främmande nycklarna.
      await db.insertRawMatches(newRaw);
      await db.upsertAccountMatches(derived);
      await db.replaceDeaths(derived.map((r) => r.match_id), account.puuid, deaths);
    }
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    result.retryAfter = err.retryAfter;
  }

  result.remaining = Math.max(0, todo.length - result.imported);
  result.done = result.retryAfter === null && result.remaining === 0;
  await db.updateAccount(account.puuid, {
    last_synced_at: now().toISOString(),
    ...(result.done ? { backfill_done: true } : {}),
  });
  return result;
}
