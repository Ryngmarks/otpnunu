#!/usr/bin/env node
/*
 * Hämtar en dags matcher med tidslinje från Riot, sparar dem på den här datorn
 * och skriver ut en skadeanalys per match. Inget skickas till Supabase.
 *
 * Körning (Node 18 eller senare):
 *   macOS/Linux:  RIOT_API_KEY=RGAPI-… node tools/timeline/fetch.mjs
 *   PowerShell:   $env:RIOT_API_KEY="RGAPI-…"; node tools/timeline/fetch.mjs
 *
 * Val:
 *   --date 2026-10-14     vilken dag (standard: i dag)
 *   --id Namn#Tagg        Riot ID (standard: RIOT_ID eller Rymm3n#EUW)
 *   --platform euw1       server (standard: euw1)
 *   --out data/matches    var filerna sparas (mappen data/ finns inte i git)
 *
 * Filer per match: <matchId>.match.json och <matchId>.timeline.json – Riots svar oförändrade.
 * Redan sparade matcher hämtas inte igen.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRiot, parseRiotId, regionFor } from '../../supabase/functions/nunu-riot/riot.mjs';
import { damageSummary, damageCurve, deaths, formatReport } from './damage.mjs';

export function parseArgs(argv, env = {}) {
  const opt = { date: null, id: env.RIOT_ID || 'Rymm3n#EUW', platform: 'euw1', out: join('data', 'matches') };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opt)) throw new Error(`Okänt val ${argv[i]}`);
    opt[key] = argv[i + 1];
  }
  if (opt.date && !/^\d{4}-\d{2}-\d{2}$/.test(opt.date)) throw new Error('--date ska skrivas ÅÅÅÅ-MM-DD');
  return opt;
}

/** Dygnets start och slut i lokal tid, i sekunder (som Riot vill ha dem). */
export function dayRange(date, now = new Date()) {
  const [y, m, d] = date ? date.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 1);
  const pad = (x) => String(x).padStart(2, '0');
  return { label: `${y}-${pad(m)}-${pad(d)}`, startTime: start.getTime() / 1000, endTime: end.getTime() / 1000 };
}

const exists = (f) => access(f).then(() => true, () => false);

async function cached(file, fetchFn) {
  if (await exists(file)) return JSON.parse(await readFile(file, 'utf8'));
  const data = await fetchFn();
  if (data) await writeFile(file, JSON.stringify(data));
  return data;
}

export async function run({ argv, env, riot, log = console.log }) {
  const opt = parseArgs(argv, env);
  const range = dayRange(opt.date);
  const region = regionFor(opt.platform);
  const { gameName, tagLine } = parseRiotId(opt.id);

  const account = await riot.accountByRiotId(region, gameName, tagLine);
  if (!account) throw new Error(`Hittade inget konto ${opt.id}`);
  const ids = await riot.matchIds(region, account.puuid, 0, 100, range);
  log(`${opt.id} · ${range.label} · ${ids.length} matcher`);
  if (!ids.length) return [];

  await mkdir(opt.out, { recursive: true });
  const reports = [];
  for (const id of [...ids].reverse()) { // äldst först
    const match = await cached(join(opt.out, `${id}.match.json`), () => riot.match(region, id));
    const timeline = await cached(join(opt.out, `${id}.timeline.json`), () => riot.timeline(region, id));
    if (!match || !timeline) { log(`\n${id}: saknas hos Riot`); continue; }
    const text = formatReport(damageSummary(match, account.puuid), damageCurve(timeline, account.puuid), deaths(timeline, match, account.puuid));
    log(`\n${text}`);
    reports.push(text);
  }
  const file = join(opt.out, '..', `skada-${range.label}.txt`);
  await writeFile(file, `${opt.id} · ${range.label}\n\n${reports.join('\n\n')}\n`);
  log(`\nSparat: ${opt.out}/ (rådata) och ${file} (rapporten)`);
  return reports;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    console.error('Sätt RIOT_API_KEY först (se början av tools/timeline/fetch.mjs).');
    process.exit(1);
  }
  run({ argv: process.argv.slice(2), env: process.env, riot: createRiot({ apiKey, maxWaitS: 130, spacingMs: 100 }) })
    .catch((e) => { console.error(`Fel: ${e.message}`); process.exit(1); });
}
