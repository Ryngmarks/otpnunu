/*
 * Gank-analys: rena funktioner, match + tidslinje in, ganks ut.
 * Definitionen står i docs/nunu-early-game.md (avsnitt 1). Kort:
 *   - bara när du spelar jungle, bara före 15:00
 *   - gank = du får kill/assist i en lane-zon (kills i lane utan dig räknas inte)
 *   - kills i samma lane inom 15 s = en gank
 */

export const GANK_WINDOW_MS = 15 * 60000;  // laning phase
const GROUP_MS = 15000;                    // samma gank om inom 15 s i samma lane

/**
 * Zon på Summoner's Rift för en kartposition (0–14 800, blått lag nere till vänster).
 * Banden för lanes är smala med flit: hellre jungle än att en jungle-strid blir en gank.
 */
export function zoneOf(pos) {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  const { x, y } = pos;
  if ((x < 3800 && y < 3800) || (x > 11000 && y > 11000)) return 'bas';
  if ((x < 1900 && y > 3800) || (y > 12900 && x < 11000)) return 'top';
  if ((y < 1900 && x > 3800) || (x > 12900 && y < 11000)) return 'bot';
  if (Math.abs(x - y) < 1300) return 'mid';  // smalt: raptors ligger strax utanför
  if (Math.abs(x + y - 14800) < 1500) return 'river';
  return 'jungle';
}

export const LANES = ['top', 'mid', 'bot'];

/**
 * Ganks före 15:00. Returnerar null om du inte spelar jungle (eller saknas i tidslinjen),
 * annars en lista, äldst först:
 *   { t, lane, takedowns, kills, died, vsJungler, victims: [championId] }
 * Dödsfall i lane utan takedown kommer med som { …, takedowns: 0, died: true } – kan vara
 * en misslyckad gank, men visas för sig eftersom det inte är säkert.
 */
export function findGanks(match, timeline, puuids) {
  const ids = [].concat(puuids);
  const parts = match?.info?.participants || [];
  const me = parts.find((p) => ids.includes(p.puuid));
  if (!me || me.teamPosition !== 'JUNGLE') return null;
  const tlMe = timeline?.info?.participants?.find((p) => ids.includes(p.puuid));
  if (!tlMe) return null;
  const myId = tlMe.participantId;

  const byId = Object.fromEntries(parts.map((p) => [p.participantId, p]));
  const enemyJungler = parts.find((p) => p.teamId !== me.teamId && p.teamPosition === 'JUNGLE');

  const events = (timeline.info.frames || [])
    .flatMap((f) => f.events || [])
    .filter((e) => e.type === 'CHAMPION_KILL' && e.timestamp < GANK_WINDOW_MS)
    .sort((a, b) => a.timestamp - b.timestamp);

  const ganks = [];
  for (const e of events) {
    const lane = zoneOf(e.position);
    if (!LANES.includes(lane)) continue;
    const assisted = (e.assistingParticipantIds || []).includes(myId);
    const takedown = e.killerId === myId || assisted;
    const died = e.victimId === myId;
    if (!takedown && !died) continue; // kill i lane utan dig – ingen gank
    const involved = [e.killerId, e.victimId, ...(e.assistingParticipantIds || [])];

    const last = ganks[ganks.length - 1];
    const g = last && last.lane === lane && e.timestamp - last.end <= GROUP_MS
      ? last
      : ganks[ganks.push({ t: e.timestamp, end: e.timestamp, lane, takedowns: 0, kills: 0, died: false, vsJungler: false, victims: [] }) - 1];
    g.end = e.timestamp;
    if (takedown) {
      g.takedowns++;
      if (e.killerId === myId) g.kills++;
      const v = byId[e.victimId];
      if (v) g.victims.push(v.championId);
    }
    if (died) g.died = true;
    if (enemyJungler && involved.includes(enemyJungler.participantId)) g.vsJungler = true;
  }
  return ganks.map(({ end, ...g }) => g);
}

/** Utfall för en gank: lyckad, byte (takedown men du dog) eller död (ingen takedown). */
export const gankResult = (g) => (g.takedowns === 0 ? 'död' : g.died ? 'byte' : 'lyckad');
