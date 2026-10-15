/*
 * Riot-import: koppla konton och synka matcher, tidslinjer och mastery.
 * Får in riot (riot.mjs) och db (db.mjs) – testas med låtsasversioner.
 */
import { HttpError, RateLimitError, parseRiotId, regionFor } from './riot.mjs';
import { DERIVED_VERSION, LEGACY_VERSION, RIFT_QUEUES, deriveAccountMatch, deriveDeaths, deriveMastery, deriveRanks, rankChanged, rawMatchRow } from './derive.mjs';

export const BATCH_SIZE = 20;     // matcher per anrop: match + tidslinje = 2 Riot-anrop, och Edge Functions har begränsad CPU-tid
const MAX_HISTORY = 2000;         // så långt bak vi letar efter match-id:n

/** Koppla ett Riot-konto (Riot ID) till användarens profil. */
export async function linkAccount({ riot, db, userId, riotId, platform = 'euw1' }) {
  const { gameName, tagLine } = parseRiotId(riotId);
  const region = regionFor(platform);
  const acc = await riot.accountByRiotId(region, gameName, tagLine);
  if (!acc) throw new HttpError(404, `Hittade inget konto ${gameName}#${tagLine}`);

  const profile = await db.ensureProfile(userId);
  let existing = await db.getAccount(acc.puuid);
  if (!existing) {
    // Samma konto kopplat med en annan Riot-nyckel (annat PUUID)? Byt PUUID i stället för att koppla en kopia.
    const same = (await db.listAccounts(profile.id)).find((a) =>
      a.game_name.toLowerCase() === acc.gameName.toLowerCase() && a.tag_line.toLowerCase() === acc.tagLine.toLowerCase());
    if (same) {
      await db.rekeyAccount(same.puuid, acc.puuid, [...(same.previous_puuids || []), same.puuid]);
      existing = { ...same, puuid: acc.puuid };
    }
  }
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
/**
 * Riot krypterar PUUID olika för varje nyckel. Efter byte av nyckel svarar Riot 400 på det
 * sparade PUUID – då slås kontot upp på nytt via Riot ID och får det nya PUUID.
 * Det gamla sparas i previous_puuids, eftersom äldre rådata innehåller det.
 */
async function currentAccount({ riot, db, account }) {
  let acc;
  try {
    acc = await riot.accountByPuuid(account.region, account.puuid);
  } catch (err) {
    if (err.riotStatus !== 400) throw err;
    const fresh = await riot.accountByRiotId(account.region, account.game_name, account.tag_line);
    if (!fresh) {
      throw new HttpError(409, `${account.game_name}#${account.tag_line} hittas inte med den nya Riot-nyckeln – koppla bort kontot och koppla det igen`);
    }
    const previous = [...(account.previous_puuids || []), account.puuid];
    await db.rekeyAccount(account.puuid, fresh.puuid, previous);
    return { ...account, puuid: fresh.puuid, previous_puuids: previous };
  }
  // Namnet kan ha bytts sedan kontot kopplades
  if (acc && (acc.gameName !== account.game_name || acc.tagLine !== account.tag_line)) {
    await db.updateAccount(account.puuid, { game_name: acc.gameName, tag_line: acc.tagLine });
  }
  return account;
}

/**
 * Sparar kontots rank (Solo/Duo och Flex) om den ändrats sedan förra gången.
 * Riot har ingen rank-historik, så grafen byggs av de här ögonblicksbilderna.
 * Saknar nyckeln åtkomst till league-v4 hoppas det över – resten av synken fortsätter.
 */
async function syncRanks({ riot, db, account }) {
  let entries;
  try {
    entries = await riot.leagueEntries(account.platform, account.puuid);
  } catch (err) {
    if (err.riotStatus === 403 || err.riotStatus === 404) return;
    throw err;
  }
  const rows = deriveRanks(entries, account.puuid);
  try {
    const last = await db.lastRanks(account.puuid);
    await db.insertRankSnapshots(rows.filter((r) => rankChanged(last[r.queue], r)));
  } catch (err) {
    // Tabellen saknas tills 007_rank.sql är körd – då hoppas rank över, resten av synken fortsätter
    if (/rank_snapshot|PGRST205|42P01/.test(String(err.message))) return;
    throw err;
  }
}

export async function syncAccount({ riot, db, account: given, batchSize = BATCH_SIZE, now = () => new Date() }) {
  const result = { puuid: given.puuid, imported: 0, remaining: 0, retryAfter: null, done: false };
  let account = given;
  let todo = [];
  try {
    account = await currentAccount({ riot, db, account });
    result.puuid = account.puuid;
    const aliases = account.previous_puuids || [];

    const masteries = await riot.masteries(account.platform, account.puuid);
    await db.upsertMastery(masteries.map((m) => deriveMastery(m, account.puuid)));
    await syncRanks({ riot, db, account });

    const known = await db.knownMatchIds(account.puuid);
    const missing = await findMissingIds({ riot, account, known });
    // Version 5 kräver 010_review.sql; utan den räknas inget om (och inget skrivs till saknade kolumner)
    const v5 = db.supportsReview ? await db.supportsReview() : true;
    const stale = await db.staleMatchIds(account.puuid, v5 ? DERIVED_VERSION : LEGACY_VERSION);
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
        const row = deriveAccountMatch(match, account.puuid, timeline, aliases, { v5 });
        if (row) {
          derived.push(row);
          deaths.push(...deriveDeaths(match, account.puuid, timeline, aliases));
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
