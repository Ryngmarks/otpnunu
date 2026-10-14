/*
 * Riot-import: koppla konton och synka matcher och mastery.
 * Får in riot (riot.mjs) och db (db.mjs) – testas med låtsasversioner.
 */
import { HttpError, RateLimitError, parseRiotId, regionFor } from './riot.mjs';
import { deriveAccountMatch, deriveMastery, rawMatchRow } from './derive.mjs';

export const BATCH_SIZE = 80;     // matcher per synk – håller oss under 100 anrop / 2 min
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
 * Synkar ett konto: mastery + upp till BATCH_SIZE saknade matcher.
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

    // Rådata som redan finns (annat konto i samma match) hämtas inte igen
    const stored = new Map((await db.getRawMatches(batch)).map((r) => [r.match_id, r.payload]));
    const derived = [];
    const newRaw = [];
    try {
      for (const id of batch) {
        let match = stored.get(id);
        if (!match) {
          match = await riot.match(account.region, id);
          if (!match) { result.imported++; continue; } // borttagen hos Riot – hoppa över
          newRaw.push(rawMatchRow(match, account.region));
        }
        const row = deriveAccountMatch(match, account.puuid);
        if (row) derived.push(row);
        result.imported++;
      }
    } finally {
      // Spara det vi hann hämta, även om Riot bad oss vänta
      await db.insertRawMatches(newRaw);
      await db.upsertAccountMatches(derived);
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
