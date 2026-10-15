/*
 * Pågående match (spectator-v5): ren funktion, Riots svar in → det appen behöver ut.
 * Riot visar matchen först när den laddats in (inte under champ select) och ger inga positioner –
 * motståndarens jungler känns igen på Smite.
 */
export const SMITE = 11;

/** Kort sammanfattning ur kontots perspektiv. null om kontot inte är med. Inga PUUID för andra spelare. */
export function summarizeLive(game, account) {
  const parts = Array.isArray(game?.participants) ? game.participants : [];
  const me = parts.find((p) => p.puuid === account.puuid);
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

/** Letar efter en pågående match på kontona i tur och ordning. Första träffen vinner. */
export async function findLiveGame({ riot, accounts }) {
  for (const account of accounts) {
    const game = await riot.activeGame(account.platform, account.puuid);
    const live = game ? summarizeLive(game, account) : null;
    if (live) return live;
  }
  return null;
}
