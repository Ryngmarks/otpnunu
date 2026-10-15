/*
 * Pågående match (spectator-v5): ren funktion, Riots svar in → det appen behöver ut.
 * Riot visar matchen först när den laddats in (inte under champ select) och ger inga positioner –
 * motståndarens jungler känns igen på Smite.
 */
import { RateLimitError, regionFor } from './riot.mjs';

export const SMITE = 11;

/** Kort sammanfattning ur kontots perspektiv. null om kontot inte är med. Inga PUUID för andra spelare. */
export function summarizeLive(game, account) {
  const parts = Array.isArray(game?.participants) ? game.participants : [];
  // Riot ID som reserv: PUUID kan saknas eller skilja sig (t.ex. annan Riot-nyckel)
  const riotId = account.game_name ? `${account.game_name}#${account.tag_line || ''}`.toLowerCase() : null;
  const me = parts.find((p) => p.puuid && p.puuid === account.puuid)
    || parts.find((p) => riotId && String(p.riotId || '').toLowerCase() === riotId)
    || parts.find((p) => account.game_name && String(p.riotId || '').split('#')[0].toLowerCase() === account.game_name.toLowerCase());
  if (!me) return null;
  const player = (p) => {
    const spells = [p.spell1Id, p.spell2Id].map(Number).filter(Boolean);
    return {
      championId: Number(p.championId) || null,
      spells,
      smite: spells.includes(SMITE),
      keystone: Number(p.perks?.perkIds?.[0]) || null,
      name: p.riotId ? String(p.riotId).split('#')[0] : null,
      bot: !!p.bot,
    };
  };
  const allies = parts.filter((p) => p.teamId === me.teamId && p !== me).map(player);
  const enemies = parts.filter((p) => p.teamId !== me.teamId).map(player);
  const bans = Array.isArray(game.bannedChampions) ? game.bannedChampions : [];
  const jungler = (list) => (list.find((p) => p.smite) || {}).championId || null;
  return {
    gameId: game.gameId,
    queueId: Number(game.gameQueueConfigId) || 0,
    mode: game.gameMode || null,
    startedAt: Number(game.gameStartTime) || null, // 0 medan matchen laddar
    gameLength: Number(game.gameLength) || 0,
    account: { puuid: account.puuid, name: account.game_name },
    me: player(me),
    allies,
    enemies,
    enemyJungler: jungler(enemies),
    allyJungler: me.spell1Id === SMITE || me.spell2Id === SMITE ? null : jungler(allies),
    bans: {
      mine: bans.filter((b) => b.teamId === me.teamId && b.championId > 0).map((b) => b.championId),
      theirs: bans.filter((b) => b.teamId !== me.teamId && b.championId > 0).map((b) => b.championId),
    },
  };
}

/**
 * Letar efter en pågående match på kontona i tur och ordning. Första träffen vinner.
 * deep: om Riot säger "ingen match" – slå upp aktuellt PUUID (Riot ID) och vilken server kontot
 * spelar på, och försök igen. Rättad server sparas via fixPlatform.
 * checks: vad Riot svarade per konto – visas i appen så att det går att felsöka.
 */
export async function findLiveGame({ riot, accounts, deep = false, fixPlatform = async () => {}, log = () => {} }) {
  const checks = [];
  for (const account of accounts) {
    const check = { name: account.game_name, platform: account.platform, result: 'ingen match' };
    checks.push(check);
    try {
      let game = await riot.activeGame(account.platform, account.puuid);
      if (!game) check.riot = `404 ${riot.lastNotFound || ''}`.trim();
      let used = account;
      if (!game && deep && riot.accountRegion) {
        const region = regionFor(account.platform);
        const fresh = account.game_name ? await riot.accountByRiotId(region, account.game_name, account.tag_line) : null;
        const puuid = fresh && fresh.puuid ? fresh.puuid : account.puuid;
        const platform = (await riot.accountRegion(region, puuid)) || account.platform;
        const notes = [`server ${platform}${platform !== account.platform ? ` (sparad ${account.platform})` : ''}`];
        notes.push(puuid !== account.puuid ? 'nytt PUUID från Riot' : 'PUUID stämmer');
        check.detail = notes.join(' · ');
        if (platform !== account.platform) await fixPlatform(account, platform);
        if (puuid !== account.puuid || platform !== account.platform) {
          used = { ...account, puuid, platform };
          game = await riot.activeGame(platform, puuid);
          if (!game) check.riot = `404 ${riot.lastNotFound || ''}`.trim();
        }
      }
      if (!game) continue;
      const live = summarizeLive(game, used);
      if (live) {
        check.result = 'match';
        return { live, checks };
      }
      // Riot hittade en match men vi kände inte igen kontot bland spelarna
      check.result = 'match utan kontot';
      log({ live: 'unmatched', account: account.game_name, participants: (game.participants || []).length });
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      check.result = `fel ${err.riotStatus || err.status || ''}`.trim();
      check.message = err.message;
    }
  }
  return { live: null, checks };
}
