// Tester för otpnunu-statistiken. Kör: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMatches, summarize, recentForm, byAccount, opponents, masterySummary, queueLabel, QUEUE_FILTERS } from '../js/career/stats.js';
import { esc, matchesHtml, accountsHtml } from '../js/career/view.js';

const row = (o) => ({
  puuid: 'A', match_id: Math.random().toString(36), champion_id: 20, queue_id: 420, win: true, remake: false,
  kills: 5, deaths: 2, assists: 10, cs: 180, gold: 12000, vision: 30, duration_s: 1800,
  game_start: '2026-10-01T18:00:00Z', opponent_champion_id: 64, ...o,
});

test('filter: remakes räknas aldrig, Nunu och Rift är standard', () => {
  const rows = [row({}), row({ remake: true }), row({ champion_id: 64 }), row({ queue_id: 1750 }), row({ puuid: 'B' })];
  assert.equal(filterMatches(rows).length, 2);
  assert.equal(filterMatches(rows, { champion: null }).length, 3);
  assert.equal(filterMatches(rows, { champion: null, queues: null }).length, 4);
  assert.equal(filterMatches(rows, { puuid: 'B' }).length, 1);
  assert.equal(filterMatches(rows, { queues: QUEUE_FILTERS.flex.queues }).length, 0);
});

test('summarize: vinstprocent, KDA, CS/min och snitt', () => {
  const s = summarize([
    row({ win: true, kills: 6, deaths: 2, assists: 10, cs: 180, duration_s: 1800 }),
    row({ win: false, kills: 2, deaths: 6, assists: 4, cs: 120, duration_s: 1200 }),
  ]);
  assert.equal(s.games, 2);
  assert.equal(s.winrate, 50);
  assert.equal(s.kda, 2.75);       // (8 + 14) / 8
  assert.equal(s.csPerMin, 6);     // 300 cs / 50 min
  assert.equal(s.avgMinutes, 25);
  assert.equal(s.kills, 4);
});

test('summarize: inga matcher ger tomma värden, deaths 0 ger ingen division med noll', () => {
  const empty = summarize([]);
  assert.equal(empty.games, 0);
  assert.equal(empty.winrate, null);
  assert.equal(summarize([row({ deaths: 0, kills: 3, assists: 4 })]).kda, 7);
});

test('recentForm: nyast först', () => {
  const rows = [
    row({ game_start: '2026-10-01T10:00:00Z', win: false }),
    row({ game_start: '2026-10-03T10:00:00Z', win: true }),
    row({ game_start: '2026-10-02T10:00:00Z', win: true }),
  ];
  assert.deepEqual(recentForm(rows, 2), ['W', 'W']);
  assert.deepEqual(recentForm(rows), ['W', 'W', 'L']);
});

test('byAccount: statistik per konto', () => {
  const r = byAccount([row({}), row({ puuid: 'B', win: false })], [{ puuid: 'A' }, { puuid: 'B' }, { puuid: 'C' }]);
  assert.deepEqual(r.map((x) => [x.account.puuid, x.games, x.winrate]), [['A', 1, 100], ['B', 1, 0], ['C', 0, null]]);
});

test('opponents: minst 2 möten, flest först', () => {
  const rows = [
    row({ opponent_champion_id: 64, win: true }), row({ opponent_champion_id: 64, win: false }), row({ opponent_champion_id: 64, win: false }),
    row({ opponent_champion_id: 104 }), row({ opponent_champion_id: 104 }),
    row({ opponent_champion_id: 121 }),
    row({ opponent_champion_id: null }),
  ];
  const o = opponents(rows);
  assert.deepEqual(o.map((x) => [x.championId, x.games, x.winrate]), [[64, 3, 33], [104, 2, 100]]);
});

test('masterySummary: summerar Nunu över alla konton', () => {
  const m = masterySummary([
    { puuid: 'A', champion_id: 20, level: 178, points: 1930343, last_play_time: '2026-10-13T00:00:00Z' },
    { puuid: 'B', champion_id: 20, level: 32, points: '210000', last_play_time: '2026-09-01T00:00:00Z' },
    { puuid: 'A', champion_id: 64, level: 7, points: 45000 },
  ]);
  assert.equal(m.points, 2140343);
  assert.equal(m.level, 178);
  assert.equal(m.lastPlayed, '2026-10-13T00:00:00Z');
  assert.equal(m.perAccount.length, 2);
});

test('queueLabel', () => {
  assert.equal(queueLabel(420), 'Solo/Duo');
  assert.equal(queueLabel(1750), 'Arena');
  assert.equal(queueLabel(9999), 'Kö 9999');
});

test('vyn escapar namn från Riot', () => {
  const champs = { name: (id) => `#${id}`, icon: () => null };
  const evil = '<img src=x onerror=alert(1)>';
  const html = accountsHtml([{ account: { puuid: 'A', game_name: evil, tag_line: 'EUW', platform: 'euw1' }, games: 0, winrate: null }], []);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes(esc(evil)));
  const list = matchesHtml([row({})], champs, [{ puuid: 'A', game_name: evil }, { puuid: 'B', game_name: 'x' }], 10);
  assert.ok(!list.includes('<img src=x'));
});

test('careerSummary: äldre säsonger plus synkade matcher', async () => {
  const { careerSummary } = await import('../js/career/stats.js');
  const { careerHtml } = await import('../js/career/view.js');
  const history = [
    { season: 'S2022', champion_id: 20, games: 10, wins: 6, kills: '8.0', deaths: '4.0', assists: '12.0' },
    { season: 'S2021', champion_id: 20, games: 4, wins: 1, kills: 5, deaths: 5, assists: 5 },
    { season: 'S2021', champion_id: 35, games: 2, wins: 2, kills: 10, deaths: 2, assists: 4 },
  ];
  const synced = [
    { game_start: '2025-03-01T10:00:00Z', win: true, kills: 10, deaths: 2, assists: 8 },
    { game_start: '2024-11-02T10:00:00Z', win: false, kills: 2, deaths: 6, assists: 4 },
  ];
  const c = careerSummary(history, synced, { champion: 20 });
  assert.deepEqual(c.seasons.map((s) => [s.season, s.games, s.wins, s.losses]), [['S2021', 4, 1, 3], ['S2022', 10, 6, 4]]);
  assert.equal(c.recent.games, 2);
  assert.equal(c.recent.since, '2024-11-02T10:00:00Z');
  assert.deepEqual([c.total.games, c.total.wins, c.total.losses, c.total.winrate], [16, 8, 8, 50]);
  // KDA viktas efter antal matcher: (K 20+80+12 + A 20+120+12) / D (20+40+8)
  assert.equal(c.total.kda, 3.88);

  const all = careerSummary(history, [], { champion: null });
  assert.equal(all.seasons[0].games, 6);
  assert.equal(all.total.games, 16);

  assert.match(careerHtml(c), /Totalt/);
  assert.equal(careerHtml(careerSummary([], synced)), '', 'ingen tabell utan äldre säsonger');
});

test('careerSummary: synkade matcher före säsongens slut räknas inte två gånger', async () => {
  const { careerSummary } = await import('../js/career/stats.js');
  const history = [{ season: 'S2025', champion_id: 20, games: 10, wins: 5, kills: 5, deaths: 5, assists: 5, ended: '2026-01-08' }];
  const synced = [
    { game_start: '2025-10-01T10:00:00Z', win: true, kills: 1, deaths: 1, assists: 1 },
    { game_start: '2026-02-01T10:00:00Z', win: true, kills: 1, deaths: 1, assists: 1 },
  ];
  const c = careerSummary(history, synced);
  assert.equal(c.recent.games, 1);
  assert.equal(c.recent.since, '2026-02-01T10:00:00Z');
  assert.equal(c.total.games, 11);
});


test('damageReport: vinster mot förluster och dödsfallen', async () => {
  const { damageReport } = await import('../js/career/stats.js');
  const { damageHtml } = await import('../js/career/view.js');
  const m = (id, win, extra = {}) => ({ puuid: 'p', match_id: id, win, damage: 18000, duration_s: 1800, damage_at10: 4000, damage_at14: 6000, team_share: 30, ...extra });
  const rows = [m('A', true), m('B', false, { damage_at10: 2000, team_share: 20 }), m('C', true, { damage_at10: null })];
  const deaths = [
    { puuid: 'p', match_id: 'B', t_ms: 200000, killer_champion_id: 64, helper_champion_ids: [], places: ['camp'] },
    { puuid: 'p', match_id: 'B', t_ms: 1000000, killer_champion_id: null, helper_champion_ids: [64, 7], places: ['torn'] },
    { puuid: 'p', match_id: 'X', t_ms: 1000, killer_champion_id: 1, helper_champion_ids: [], places: [] }, // annan match
  ];
  const r = damageReport(rows, deaths);
  assert.equal(r.games, 2, 'match C saknar tidslinje');
  assert.deepEqual([r.win.at10, r.loss.at10, r.win.perMin, r.loss.share], [4000, 2000, 600, 20]);
  assert.deepEqual([r.win.deaths, r.loss.deaths], [0, 2]);
  assert.equal(r.deaths.total, 2);
  assert.equal(r.deaths.before15, 0.5);
  assert.equal(r.deaths.solo, 1);
  assert.deepEqual(r.deaths.places, { camp: 1, objective: 0, torn: 1, 'våg': 0 });
  assert.deepEqual(r.deaths.killers[0], { championId: 64, involved: 2, killed: 1 });
  assert.equal(r.deaths.byWindow[0].count, 1);
  assert.equal(damageReport([m('C', true, { damage_at10: null })], deaths), null);
  const html = damageHtml(r, { name: (id) => `<${id}>`, icon: () => null });
  assert.match(html, /Torn\/minion/);
  assert.match(html, /&lt;64&gt;/, 'namn escapas');
});

test('gankReport: ganks per lane, första ganken och vinst', async () => {
  const { gankReport } = await import('../js/career/stats.js');
  const { gankHtml } = await import('../js/career/view.js');
  const g = (t, lane, takedowns, died = false) => ({ t, lane, takedowns, kills: takedowns, died, vsJungler: false, victims: [] });
  const rows = [
    { win: true, ganks: [g(200000, 'bot', 1), g(400000, 'top', 2)] },
    { win: false, ganks: [g(150000, 'top', 0, true), g(300000, 'bot', 1, true)] },
    { win: true, ganks: [] },
    { win: false, ganks: null },           // ingen tidslinje / inte jungle – räknas inte
  ];
  const r = gankReport(rows);
  assert.equal(r.games, 3);
  assert.equal(r.ganks, 3, 'död i lane utan takedown är ingen gank');
  assert.equal(r.laneDeaths, 1);
  assert.equal(r.success, 67);
  assert.equal(r.trades, 1);
  assert.equal(r.first.median, 200000);
  assert.deepEqual([r.first.lyckad.games, r.first.lyckad.winrate], [1, 100]);
  assert.deepEqual([r.first.byte.games, r.first.byte.winrate], [1, 0]);
  assert.deepEqual([r.first.ingen.games, r.first.ingen.winrate], [1, 100]);
  const bot = r.lanes.find((l) => l.lane === 'bot');
  assert.deepEqual([bot.ganks, bot.success, bot.firstShare, bot.firstWin.games], [2, 50, 100, 2]);
  assert.deepEqual(r.byCount.map((c) => c.games), [1, 1, 1, 0]);
  assert.equal(gankReport([{ win: true, ganks: null }]), null);
  const html = gankHtml(r);
  assert.match(html, /Ganks per match/);
  assert.match(html, /dog du i en lane utan takedown/);
});

test('modul 2–5: early game, synergier, matchups och tidigt → vinst', async () => {
  const s = await import('../js/career/stats.js');
  const v = await import('../js/career/view.js');
  const early = (gold, oppGold, d10, fb) => ({
    me: { 5: { gold: gold / 2, xp: 1000, level: 4, cs: 30, k: 0, d: 0, a: 0 }, 10: { gold, xp: 4000, level: 7, cs: 60, k: 1, d: d10, a: 1 } },
    opp: { 5: { gold: oppGold / 2, xp: 900, level: 4, cs: 28 }, 10: { gold: oppGold, xp: 3800, level: 7, cs: 55 } },
    firstBlood: fb,
  });
  const rows = [
    { win: true, early: early(4500, 3000, 0, 'kill'), allies: [22, 103], enemies: [64, 51], enemy_ap_share: 20, opponent_champion_id: 64 },
    { win: true, early: early(4000, 3900, 1, 'assist'), allies: [22, 86], enemies: [64, 7], enemy_ap_share: 60, opponent_champion_id: 64 },
    { win: false, early: early(3000, 4200, 2, 'died'), allies: [86, 103], enemies: [121, 7], enemy_ap_share: 45, opponent_champion_id: 121 },
    { win: false, early: null, allies: [22], enemies: [64], enemy_ap_share: null, opponent_champion_id: 64 },
  ];

  const e = s.earlyReport(rows);
  assert.equal(e.games, 3);
  const m10 = e.minutes.find((m) => m.minute === 10);
  assert.deepEqual([m10.gold, m10.goldDiff, m10.xpDiff, m10.csDiff], [3833, 133, 200, 5]);
  assert.deepEqual([m10.goldDiffWin, m10.goldDiffLoss], [800, -1200]);
  assert.equal(e.minutes.find((m) => m.minute === 15).games, 0);

  const syn = s.synergyReport(rows, { minGames: 2 });
  assert.equal(syn.baseline, 50);
  assert.deepEqual(syn.bestAllies[0], { championId: 22, games: 3, wins: 2, losses: 1, winrate: 67 });
  assert.equal(syn.mostAllies[0].championId, 22, 'flest matcher först');
  assert.ok(syn.mostEnemies.every((c, i, l) => !i || l[i - 1].games >= c.games));
  assert.deepEqual(syn.hardestEnemies.map((c) => c.championId), [7, 64]);

  const tags = (id) => ({ 64: ['Fighter'], 51: ['Marksman'], 7: ['Assassin', 'Mage'], 121: ['Assassin'] }[id] || []);
  const mu = s.matchupReport(rows, { tags, minGames: 1 });
  assert.deepEqual([mu.vsJungler[0].championId, mu.vsJungler[0].games, mu.vsJungler[0].winrate, mu.vsJungler[0].goldDiff10], [64, 3, 67, 800]);
  assert.deepEqual(mu.profiles.map((p) => p.games), [1, 1, 1]);
  assert.deepEqual(mu.comps.find((c) => c.label === '2+ Assassins'), { label: '2+ Assassins', games: 1, wins: 0, winrate: 0 });

  const imp = s.impactReport(rows);
  assert.deepEqual(imp.goldDiff10.map((g) => g.games), [1, 0, 1, 0, 1]);
  assert.deepEqual(imp.deaths10.map((g) => g.games), [1, 1, 1]);
  assert.deepEqual(imp.firstBlood.map((g) => g.games), [1, 1, 1, 0]);

  const champs = { name: (id) => `<${id}>`, icon: () => null, tags };
  for (const html of [v.earlyHtml(e), v.synergyHtml(syn, champs), v.matchupHtml(mu, champs), v.impactHtml(imp)]) {
    assert.ok(html.length > 50);
    assert.doesNotMatch(html, /undefined|NaN|<64>/, 'inga trasiga värden, namn escapas');
  }
  assert.match(v.synergyHtml(syn, champs), /2 V – 1 F[\s\S]*67% vinst[\s\S]*33% förlust/);
  assert.equal(s.earlyReport([{ win: true, early: null }]), null);
  assert.equal(v.earlyHtml(null), '');
});

test('elo: rank som tal, serier per konto och kö, y-axel', async () => {
  const s = await import('../js/career/stats.js');
  const v = await import('../js/career/view.js');
  assert.equal(s.rankScore({ tier: 'IRON', division: 'IV', lp: 0 }), 0);
  assert.equal(s.rankScore({ tier: 'EMERALD', division: 'II', lp: 45 }), 2245);
  assert.equal(s.rankScore({ tier: 'MASTER', division: null, lp: 120 }), 2920);
  assert.equal(s.rankScore({ tier: 'OKÄND' }), null);
  assert.equal(s.rankLabel({ tier: 'EMERALD', division: 'II', lp: 45 }), 'Emerald II · 45 LP');
  assert.equal(s.rankLabel({ tier: 'MASTER', division: null, lp: 120 }), 'Master · 120 LP');

  const accounts = [{ puuid: 'a', game_name: 'Rymm3n', tag_line: 'EUW' }, { puuid: 'b', game_name: 'Smurf', tag_line: 'EUW' }];
  const snaps = [
    { puuid: 'a', queue: 'RANKED_SOLO_5x5', tier: 'EMERALD', division: 'II', lp: 45, wins: 10, losses: 8, taken_at: '2026-10-02T10:00:00Z' },
    { puuid: 'a', queue: 'RANKED_SOLO_5x5', tier: 'EMERALD', division: 'III', lp: 90, wins: 9, losses: 8, taken_at: '2026-10-01T10:00:00Z' },
    { puuid: 'a', queue: 'RANKED_FLEX_SR', tier: 'GOLD', division: 'I', lp: 10, wins: 3, losses: 1, taken_at: '2026-10-01T10:00:00Z' },
    { puuid: 'b', queue: 'RANKED_SOLO_5x5', tier: 'PLATINUM', division: 'IV', lp: 0, wins: 1, losses: 1, taken_at: '2026-10-01T10:00:00Z' },
  ];
  const series = s.eloSeries(snaps, accounts);
  assert.deepEqual(series.map((x) => [x.account, x.queueLabel]), [['Rymm3n#EUW', 'Solo/Duo'], ['Rymm3n#EUW', 'Flex'], ['Smurf#EUW', 'Solo/Duo']]);
  assert.deepEqual([series[0].current, series[0].change, series[0].winrate, series[0].points.length], ['Emerald II · 45 LP', 55, 56, 2]);
  assert.deepEqual(s.eloTicks(2150, 2300).map((t) => t.label), ['Emer II', 'Emer I'], '2 200 = Emerald II 0 LP');
  assert.deepEqual(s.eloTicks(1500, 2500).map((t) => t.label), ['Platinum', 'Emerald', 'Diamond']);

  const html = v.eloHtml(series);
  assert.equal((html.match(/<polyline/g) || []).length, 3);
  assert.match(html, /stroke-dasharray/, 'Flex streckad');
  assert.match(html, /\+55 LP/);
  assert.match(v.eloHtml([]), /Rank sparas/);
});

test('översikt: nyckeltal, insikter och guldgraf', async () => {
  const s = await import('../js/career/stats.js');
  const v = await import('../js/career/view.js');
  const early = (g10, o10, d10) => ({ me: { 10: { gold: g10, xp: 4000, level: 7, cs: 60, k: 1, d: d10, a: 1 } }, opp: { 10: { gold: o10, xp: 3800, level: 7, cs: 55 } }, firstBlood: null });
  const rows = [];
  for (let i = 0; i < 30; i++) { // 20 vinster, 10 förluster – minst 10 matcher per grupp för en insikt
    const win = i % 3 !== 0;
    rows.push({
      win, kills: 6, deaths: 3, assists: 9, damage: 18000, duration_s: 1800,
      early: early(win ? 4500 : 3000, 3600, win ? 0 : 2),
      ganks: [{ t: 200000, lane: 'bot', takedowns: 1, kills: 1, died: !win, vsJungler: false, victims: [] }],
      allies: [22], enemies: [win ? 64 : 104], enemy_ap_share: 30,
    });
  }
  const k = s.overviewKpis(rows);
  assert.deepEqual([k.winrate, k.wins, k.losses, k.gankSuccess, k.goldDiff10], [67, 20, 10, 67, 400]);
  const ins = s.insights(rows);
  assert.equal(ins[0].tone, 'up');
  assert.match(ins[0].text, /100 % vinst/);
  assert.equal(ins[1].tone, 'down');
  assert.match(ins[1].text, /0 % vinst/);
  assert.match(ins[2].text, /\{104\}/, 'champion-id byts mot namn i vyn');
  const html = v.insightsHtml(ins, { name: (id) => `<${id}>` });
  assert.match(html, /&lt;104&gt;/);
  assert.match(v.kpisHtml(k), /67 %/);
  const gl = v.goldLineHtml(s.earlyReport(rows));
  assert.equal((gl.match(/<polyline/g) || []).length, 2);
  assert.doesNotMatch(gl, /NaN|undefined/);
  assert.deepEqual(s.insights([]), []);
});

test('Live Scout: alla champions räknas, även med 1 match, och färgen följer bedömning mot statistik', async () => {
  const s = await import('../js/career/stats.js');
  const v = await import('../js/career/view.js');
  const g = (win, allies, enemies) => ({ win, allies, enemies });
  // Baslinje 45 % (5 V, 6 F). Mot 64: 1 V 5 F (17 %). Mot 7: 4 V 1 F (80 %). Mot 99: 1 match.
  const rows = [
    g(false, [22], [64]), g(false, [22], [64]), g(false, [22], [64]), g(false, [22], [64]), g(false, [22], [64]),
    g(true, [22], [64, 7]), g(true, [22], [7]), g(true, [22], [7]), g(true, [22], [7]), g(false, [22], [7]),
    { win: true, allies: null, enemies: null }, // matcher utan lagdata räknas inte med i baslinjen
  ];
  rows.push(g(true, [22], [99]));
  assert.deepEqual(s.championTally(rows, 'enemies').find((t) => t.championId === 99), { championId: 99, games: 1, wins: 1, losses: 0, winrate: 100 });

  const opinions = [
    { champion_id: 64, side: 'against', opinion: -1, note: 'Kitar ut mig' },
    { champion_id: 7, side: 'against', opinion: -1, note: '' },
    { champion_id: 99, side: 'against', opinion: 1, note: '' },
    { champion_id: 1, side: 'against', opinion: 1, note: 'Aldrig mött' },
    { champion_id: 64, side: 'with', opinion: 1, note: '' },
  ];
  const t = s.scoutTable(rows, opinions, 'against');
  assert.equal(t.games, 11);
  assert.equal(t.baseline, 45);
  const by = Object.fromEntries(t.list.map((e) => [e.championId, e]));
  assert.equal(by[64].color, 'red');          // negativ + statistiken håller med
  assert.equal(by[64].support, 'begränsat');
  assert.equal(by[64].note, 'Kitar ut mig');
  assert.equal(by[7].color, 'orange');        // negativ men 80 % vinst
  assert.equal(by[99].color, 'gray');         // 1 match: för lite underlag
  assert.equal(by[99].support, 'osäkert');
  assert.equal(by[1].games, 0);               // bedömning utan matcher visas ändå
  assert.equal(t.list[0].championId, 64);     // flest matcher först

  assert.equal(s.scoutColor(1, 'pos'), 'green');
  assert.equal(s.scoutColor(null, 'pos'), 'gray');
  assert.equal(s.scoutColor(1, 'jämnt'), 'gray');
  assert.equal(s.scoutSignal({ games: 4, winrate: 100 }, 50), null);
  assert.equal(s.scoutSupport(15), 'stabilt');

  const picks = s.scoutPicks(t, [64, 555]);
  assert.equal(picks[0].championId, 64);
  assert.equal(picks[1].games, 0);
  assert.equal(picks[1].color, 'gray');

  const champs = { name: (id) => `C${id}`, icon: () => null };
  const html = v.scoutHtml(t, champs);
  assert.match(html, /Röd · svår, statistiken håller med/);
  assert.match(html, /Orange · statistiken säger emot/);
  assert.match(html, /Osäkert underlag/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(v.scoutHtml(t, champs, { color: 'orange' }), /C7/);
  assert.doesNotMatch(v.scoutHtml(t, champs, { color: 'orange' }), /C64/);
  assert.match(v.scoutPickHtml(picks[0], champs, 'against', t.baseline), /Kitar ut mig/);
  assert.equal(s.scoutTable(rows, opinions, 'with').list.find((e) => e.championId === 64).color, 'gray');
});

test('Champion Library: Solo/Duo och Flex för sig, Normal aldrig i Ranked, saknad data blir null', async () => {
  const s = await import('../js/career/stats.js');
  const v = await import('../js/career/view.js');
  let n = 0;
  const g = (queue_id, win, extra = {}) => ({
    match_id: `M${++n}`, game_start: `2026-01-${String(n).padStart(2, '0')}`, puuid: n % 3 ? 'p1' : 'p2',
    queue_id, win, champion_id: 20, allies: [412], enemies: [64], kills: 4, deaths: 2, assists: 6, cs: 150, duration_s: 1800, damage: 18000, ...extra,
  });
  const early = (gold, oppGold, d) => ({ me: { 10: { gold, xp: 4000, cs: 50, d } }, opp: { 10: { gold: oppGold, xp: 4200, cs: 55 } }, firstBlood: 'kill' });
  const rows = [
    g(420, true, { early: early(4000, 3500, 0) }), g(420, true), g(420, false),
    g(440, false, { early: early(3000, 3600, 2) }),
    g(400, true, { enemies: [64, 7] }), g(400, true, { enemies: [7] }),
  ];
  const opinions = [
    { champion_id: 64, side: 'against', opinion: -1, note: 'Ward raptors', strategy: 'Tidig scuttle' },
    { champion_id: 64, side: 'with', opinion: 1, note: 'Bra ihop', strategy: '' },
  ];
  const t = s.libraryTable(rows, opinions, 'against');
  const lee = t.list.find((e) => e.championId === 64);
  assert.deepEqual(lee.solo, { championId: 64, games: 3, wins: 2, losses: 1, winrate: 67 });
  assert.deepEqual(lee.flex, { championId: 64, games: 1, wins: 0, losses: 1, winrate: 0 });
  assert.equal(lee.normal.games, 1);
  assert.equal(lee.ranked.games, 4);            // Normal räknas inte in
  assert.equal(lee.strategy, 'Tidig scuttle');
  const onlyNormal = t.list.find((e) => e.championId === 7);
  assert.equal(onlyNormal.ranked.games, 0);     // bara mött i Normal: med, men inga rankade siffror
  assert.equal(onlyNormal.solo.winrate, null);
  assert.equal(onlyNormal.normal.games, 2);
  // Samma champion, annan relation: egen bedömning
  const asAlly = s.libraryTable(rows, opinions, 'with').list.find((e) => e.championId === 64);
  assert.equal(asAlly.opinion, 1);              // bedömning utan matcher visas ändå, med 0 matcher
  assert.equal(asAlly.ranked.games, 0);
  assert.equal(asAlly.note, 'Bra ihop');
  assert.equal(s.libraryTable(rows, opinions, 'with').list.find((e) => e.championId === 412).opinion, null);
  assert.equal(s.libraryTable(rows, opinions, 'against').list.find((e) => e.championId === 64).opinion, -1);

  const p = s.championProfile(rows, 64, 'against', opinions);
  assert.deepEqual(p.total, { games: 5, wins: 3, losses: 2, winrate: 60 });
  assert.equal(p.byQueue.solo.games, 3);
  assert.equal(p.byQueue.flex.games, 1);
  assert.equal(p.byQueue.normal.games, 1);
  assert.equal(p.kda.value, 5);
  assert.equal(p.damage.avg, 18000);
  assert.equal(p.damage.perMin, 600);
  assert.deepEqual(p.early.goldDiff10, { value: -50, n: 2 });
  assert.deepEqual(p.early.deaths10, { value: 1, n: 2 });
  assert.equal(p.games[0].match_id, 'M5');      // nyast först
  assert.equal(p.note, 'Ward raptors');

  const none = s.championProfile(rows, 999, 'against', []);
  assert.equal(none.total.games, 0);
  assert.equal(none.kda.value, null);
  assert.equal(none.early.goldDiff10.value, null);
  assert.equal(none.color, 'gray');

  const champs = { name: (id) => `C${id}`, icon: () => null, tile: (id) => `https://x/${id}.jpg`, splash: () => null };
  const html = v.libraryHtml(t, champs);
  assert.match(html, /Solo\/Duo/);
  assert.match(html, /Flex/);
  assert.match(html, /1 match</);               // även en enda match visas med antal
  assert.match(html, /“Ward raptors”/);
  assert.match(html, /x\/64\.jpg/);
  assert.doesNotMatch(html, /undefined|NaN|null/);
  const d = v.championDetailHtml(p, champs, [], {});
  assert.match(d, /Normal räknas aldrig in i Ranked/);
  assert.match(d, /−50/);
  assert.doesNotMatch(d, /undefined|NaN|null/);
  const dn = v.championDetailHtml(none, champs, [], {});
  assert.match(dn, /ingen data/);
  assert.doesNotMatch(dn, /undefined|NaN|null/);
  assert.match(v.championEditorHtml(p, champs), /Tidig scuttle/);
});

test('Champion Library: jungler-filtret räknar bara motståndarens jungler', async () => {
  const s = await import('../js/career/stats.js');
  const r = (win, pos, opp, enemies) => ({ queue_id: 420, win, team_position: pos, opponent_champion_id: opp, allies: [1], enemies });
  const rows = [
    r(true, 'JUNGLE', 64, [64, 7, 99]),
    r(false, 'JUNGLE', 64, [64, 7]),
    r(true, 'JUNGLE', 121, [121, 64]),   // Lee Sin på annan position räknas inte som jungler här
    r(true, 'MIDDLE', 7, [7, 64]),       // du spelade inte jungle
    r(true, 'JUNGLE', null, [5]),        // ingen motståndarjungler
  ];
  const j = s.junglerRows(rows);
  assert.equal(j.length, 3);
  const t = s.libraryTable(j, [], 'against');
  assert.deepEqual(t.list.map((e) => e.championId).sort((a, b) => a - b), [64, 121]);
  assert.deepEqual(t.list.find((e) => e.championId === 64).solo, { championId: 64, games: 2, wins: 1, losses: 1, winrate: 50 });
  assert.equal(s.championProfile(j, 64, 'against').total.games, 2);
  // Utan filtret: alla möten
  assert.equal(s.libraryTable(rows, [], 'against').list.find((e) => e.championId === 64).solo.games, 4);
});

test('trendSeries: rullande snitt äldst först, med antal matcher bakom varje punkt', async () => {
  const s = await import('../js/career/stats.js');
  const early = (gold, opp) => ({ me: { 10: { gold } }, opp: { 10: { gold: opp } } });
  const rows = Array.from({ length: 8 }, (_, i) => ({
    game_start: `2026-02-0${i + 1}`, win: i >= 4, kills: i, deaths: 1, assists: 1,
    early: i % 2 ? early(4000, 3800) : null,
  })).reverse(); // som från databasen: nyast först
  const t = s.trendSeries(rows, { window: 4 });
  assert.equal(t.games, 8);
  assert.deepEqual(t.series.winrate.map((p) => p.v), [0, 25, 50, 75, 100]);
  assert.equal(t.series.winrate[0].n, 4);
  assert.equal(t.series.kills[4].v, 5.5);
  assert.deepEqual(t.series.goldDiff10.map((p) => [p.v, p.n]), [[200, 2], [200, 2], [200, 2], [200, 2], [200, 2]]);
  assert.deepEqual(t.totals, { winrate: 50, kills: 3.5, kda: 4.5, goldDiff10: 200 });
  assert.equal(t.n.goldDiff10, 4);
  // För få matcher: inga punkter, totalen finns ändå
  const few = s.trendSeries(rows.slice(0, 3), { window: 4 });
  assert.equal(few.series.winrate.length, 0);
  assert.equal(few.totals.winrate, 100);
  assert.equal(s.trendSeries([]).totals.kda, null);
});

test('positionRows: lagkamrater och motståndare per position, med reserv för motståndarens jungler', async () => {
  const s = await import('../js/career/stats.js');
  const rows = [
    { queue_id: 420, win: true, team_position: 'JUNGLE', opponent_champion_id: 64, allies: [412, 103, 51, 86], ally_positions: ['UTILITY', 'MIDDLE', 'BOTTOM', 'TOP'], enemies: [64, 7, 22], enemy_positions: ['JUNGLE', 'MIDDLE', 'BOTTOM'] },
    { queue_id: 420, win: false, team_position: 'JUNGLE', opponent_champion_id: 121, allies: [412], ally_positions: ['UTILITY'], enemies: [121, 64], enemy_positions: ['JUNGLE', 'TOP'] },
    { queue_id: 420, win: true, team_position: 'JUNGLE', opponent_champion_id: 64, allies: [99], enemies: [64, 5] }, // äldre rad utan positioner
  ];
  const sup = s.positionRows(rows, 'with', 'UTILITY');
  assert.equal(sup.length, 2);
  assert.deepEqual(s.libraryTable(sup, [], 'with').list.map((e) => [e.championId, e.solo.games, e.solo.wins]), [[412, 2, 1]]);
  const jg = s.positionRows(rows, 'against', 'JUNGLE');
  assert.deepEqual(jg.map((r) => r.enemies), [[64], [121], [64]]);
  assert.equal(s.positionRows(rows, 'against', 'TOP').length, 1);
  assert.equal(s.positionRows(rows, 'with', 'TOP').length, 1, 'utan positioner: inga lagkamrater');
  assert.equal(s.hasPositions(rows), true);
  assert.equal(s.hasPositions([rows[2]]), false);
});

test('matchReview: lagen per position, kurvor mot motståndaren och händelser', async () => {
  const s = await import('../js/career/stats.js');
  const row = {
    champion_id: 20, team_position: 'JUNGLE', opponent_champion_id: 64, duration_s: 1500, queue_id: 420, game_start: '2026-10-01T18:00:00Z',
    win: true, kills: 5, deaths: 2, assists: 9, cs: 180, damage: 20000, vision: 30, ganks: [],
    allies: [412, 103, 51, 86], ally_positions: ['UTILITY', 'MIDDLE', 'BOTTOM', 'TOP'],
    enemies: [7, 64, 22, 1, 2], enemy_positions: ['MIDDLE', 'JUNGLE', 'BOTTOM', 'TOP', 'UTILITY'],
    objectives_team: { mine: { dragon: 2 }, theirs: { dragon: 1 } }, loadout: { items: [3020], spells: [11, 4] },
  };
  const review = {
    minutes: [[500, 0, 0, 500, 0, 0], [900, 300, 4, 800, 280, 5], null, [2000, 1200, 20, 1700, 1300, 22]],
    path: [[1000, 2000]],
    events: [{ t: 200, k: 'kill', x: 1, y: 1, vs: 64 }, { t: 700, k: 'death', x: 1, y: 1, vs: 64 }],
    monsters: [{ t: 330, type: 'DRAGON', sub: 'FIRE_DRAGON', mine: true, me: true }],
  };
  const m = s.matchReview(row, review);
  assert.deepEqual(m.allies.map((a) => a.position), ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);
  assert.equal(m.allies[1].me, true);
  assert.equal(m.enemies.find((e) => e.opponent).championId, 64);
  assert.deepEqual(m.diffs.gold.map((p) => [p.minute, p.v]), [[0, 0], [1, 100], [3, 300]]);
  assert.deepEqual(m.diffs.cs.map((p) => p.v), [0, -1, -2]);
  assert.deepEqual([m.counts.kills, m.counts.deaths, m.counts.early], [1, 1, 1]);
  assert.equal(m.hasReview, true);
  const none = s.matchReview({ ...row, ally_positions: null, enemy_positions: null }, null);
  assert.equal(none.hasReview, false);
  assert.equal(none.at10.gold, null);
  assert.equal(none.allies.length, 5);

  const v = await import('../js/career/view.js');
  const champs = { name: (id) => `C${id}`, icon: () => null, tile: () => null, splash: () => null, item: (id) => `i/${id}.png`, map: () => null };
  const html = v.matchReviewHtml(m, champs, null, [], {});
  assert.match(html, /rv-line--up/);
  assert.match(html, /Fire-drake/);
  assert.doesNotMatch(html, /undefined|NaN|null/);
  assert.match(v.matchReviewHtml(none, champs, null, [], {}), /Kurvor och karta saknas/);
});
