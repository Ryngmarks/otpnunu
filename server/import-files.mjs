#!/usr/bin/env node
/*
 * Läser in matcher som redan finns som filer (<matchId>.match.json / .timeline.json,
 * t.ex. från det gamla tools/timeline/fetch.mjs) i databasen. Bara rådatan – nästa synk
 * räknar ut statistiken utan att hämta dem från Riot igen.
 *   npm run import              (mappen data/matches)
 *   npm run import -- annan/mapp
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, loadConfig, isMain } from './env.mjs';
import { createDb } from './db.mjs';
import { rawMatchRow } from './riot/derive.mjs';

export async function importFiles({ db, dir, region = 'europe', log = console.log }) {
  const files = await readdir(dir).catch(() => { throw new Error(`Hittar inte mappen ${dir}`); });
  let matches = 0;
  let timelines = 0;
  for (const f of files.filter((x) => x.endsWith('.match.json')).sort()) {
    const id = f.replace('.match.json', '');
    const match = JSON.parse(await readFile(join(dir, f), 'utf8'));
    if (match?.metadata?.matchId !== id) { log(`Hoppar över ${f} (inte en match från Riot)`); continue; }
    await db.insertRawMatches([rawMatchRow(match, region)]);
    matches++;
    if (files.includes(`${id}.timeline.json`)) {
      await db.insertRawTimelines([{ match_id: id, payload: JSON.parse(await readFile(join(dir, `${id}.timeline.json`), 'utf8')) }]);
      timelines++;
    }
  }
  log(`Läste in ${matches} matcher och ${timelines} tidslinjer. Tryck Synka på sidan för att räkna ut statistiken.`);
  return { matches, timelines };
}

if (isMain(import.meta.url)) {
  const db = createDb({ connectionString: loadConfig().databaseUrl });
  importFiles({ db, dir: process.argv[2] || join(ROOT, 'data', 'matches') })
    .catch((e) => { console.error(`Fel: ${e.message}`); process.exitCode = 1; })
    .finally(() => db.close());
}
