#!/usr/bin/env node
/*
 * Samlad rapport över alla matcher som tools/timeline/fetch.mjs har sparat.
 * Läser bara filerna på disk – ingen Riot-nyckel behövs.
 *
 *   node tools/timeline/report.mjs              Nunu, Summoner's Rift
 *   node tools/timeline/report.mjs --champion alla
 *   node tools/timeline/report.mjs --id Namn#Tagg --dir data/matches
 *
 * Rapporten skrivs ut och sparas i data/sammanfattning.txt.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findPuuid, relevant, summarize, storage, formatSummary } from './summary.mjs';

export function parseArgs(argv, env = {}) {
  const opt = { id: env.RIOT_ID || 'Rymm3n#EUW', champion: 'Nunu', dir: join('data', 'matches') };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opt)) throw new Error(`Okänt val ${argv[i]}`);
    opt[key] = argv[i + 1];
  }
  return opt;
}

/** Alla matcher som har både match och tidslinje sparade. */
export async function loadGames(dir) {
  const files = await readdir(dir).catch(() => []);
  const games = [];
  const sizes = [];
  for (const f of files.filter((x) => x.endsWith('.match.json')).sort()) {
    const id = f.replace('.match.json', '');
    const tl = join(dir, `${id}.timeline.json`);
    const [m, t] = await Promise.all([stat(join(dir, f)), stat(tl).catch(() => null)]);
    if (!t) continue;
    games.push({ match: JSON.parse(await readFile(join(dir, f), 'utf8')), timeline: JSON.parse(await readFile(tl, 'utf8')) });
    sizes.push({ match: m.size, timeline: t.size });
  }
  return { games, sizes };
}

export async function run({ argv, env = {}, log = console.log }) {
  const opt = parseArgs(argv, env);
  const { games, sizes } = await loadGames(opt.dir);
  if (!games.length) throw new Error(`Inga sparade matcher i ${opt.dir} – kör tools/timeline/fetch.mjs först`);
  const puuid = findPuuid(games, opt.id);
  const champion = /^(alla|all)$/i.test(opt.champion) ? null : opt.champion;
  const label = `${opt.id} · ${champion || 'alla champions'}`;
  const text = formatSummary(summarize(relevant(games, puuid, champion), puuid), storage(sizes), label);
  log(text);
  const file = join(opt.dir, '..', 'sammanfattning.txt');
  await writeFile(file, `${text}\n`);
  log(`\nSparat: ${file}`);
  return text;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ argv: process.argv.slice(2), env: process.env }).catch((e) => { console.error(`Fel: ${e.message}`); process.exit(1); });
}
