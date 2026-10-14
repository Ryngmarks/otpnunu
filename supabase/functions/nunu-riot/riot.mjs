/*
 * Riot API-klient. Enda stället som pratar med Riot.
 * fetch och sleep injiceras så att klienten kan testas utan nätverk.
 */

const PLATFORM_REGION = {
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', sg2: 'sea', tw2: 'sea', vn2: 'sea', ph2: 'sea', th2: 'sea',
};

export function regionFor(platform) {
  const region = PLATFORM_REGION[platform];
  if (!region) throw new HttpError(400, `Okänd server "${platform}"`);
  return region;
}

export function parseRiotId(riotId) {
  const s = String(riotId || '').trim();
  const i = s.lastIndexOf('#');
  if (i < 1 || i === s.length - 1) throw new HttpError(400, 'Riot ID ska skrivas som Namn#Tagg');
  return { gameName: s.slice(0, i).trim(), tagLine: s.slice(i + 1).trim() };
}

/** Fel som ska nå användaren med en viss HTTP-status. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Riot säger "vänta" längre än vi kan vänta inuti ett anrop. */
export class RateLimitError extends Error {
  constructor(retryAfterS) {
    super(`Riot begränsar anropen – försök igen om ${retryAfterS} s`);
    this.retryAfter = retryAfterS;
  }
}

export function createRiot({
  apiKey,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxWaitS = 5,     // längre väntan än så lämnas tillbaka till webbsidan
  spacingMs = 60,   // under 20 anrop/sekund
}) {
  if (!apiKey) throw new HttpError(500, 'RIOT_API_KEY saknas i Edge Function');
  let last = 0;
  let count = 0;

  async function get(url, { allow404 = false } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = last + spacingMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      count++;
      const res = await fetchImpl(url, { headers: { 'X-Riot-Token': apiKey } });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 10;
        if (retryAfter > maxWaitS) throw new RateLimitError(retryAfter);
        await sleep(retryAfter * 1000);
        continue;
      }
      if (res.status === 404 && allow404) return null;
      if (res.status === 401 || res.status === 403) {
        throw new HttpError(502, 'Riot-nyckeln är ogiltig eller har gått ut');
      }
      if (!res.ok) throw new HttpError(502, `Riot svarade ${res.status}`);
      return res.json();
    }
    throw new RateLimitError(maxWaitS);
  }

  const regional = (region) => `https://${region}.api.riotgames.com`;
  const platformUrl = (platform) => `https://${platform}.api.riotgames.com`;
  const enc = encodeURIComponent;

  return {
    get requestCount() { return count; },

    accountByRiotId: (region, gameName, tagLine) =>
      get(`${regional(region)}/riot/account/v1/accounts/by-riot-id/${enc(gameName)}/${enc(tagLine)}`, { allow404: true }),

    accountByPuuid: (region, puuid) =>
      get(`${regional(region)}/riot/account/v1/accounts/by-puuid/${enc(puuid)}`, { allow404: true }),

    /** startTime/endTime (valfria) i sekunder sedan 1970. */
    matchIds: (region, puuid, start, count = 100, { startTime, endTime } = {}) =>
      get(`${regional(region)}/lol/match/v5/matches/by-puuid/${enc(puuid)}/ids?start=${start}&count=${count}`
        + `${startTime ? `&startTime=${startTime}` : ''}${endTime ? `&endTime=${endTime}` : ''}`),

    match: (region, matchId) =>
      get(`${regional(region)}/lol/match/v5/matches/${enc(matchId)}`, { allow404: true }),

    timeline: (region, matchId) =>
      get(`${regional(region)}/lol/match/v5/matches/${enc(matchId)}/timeline`, { allow404: true }),

    masteries: (platform, puuid) =>
      get(`${platformUrl(platform)}/lol/champion-mastery/v4/champion-masteries/by-puuid/${enc(puuid)}`),
  };
}
