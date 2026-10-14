/*
 * Inställningar från filen .env i projektmappen (finns inte i git) och miljövariabler.
 * Miljövariabler vinner, så att en nyckel kan sättas tillfälligt i terminalen.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** KEY=värde per rad. # är kommentar. Citattecken runt värdet tas bort. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export function loadConfig({ file = join(ROOT, '.env'), env = process.env } = {}) {
  let fromFile = {};
  try { fromFile = parseEnv(readFileSync(file, 'utf8')); } catch { /* ingen .env */ }
  const get = (k, d = '') => env[k] || fromFile[k] || d;
  // DB_PASSWORD läggs in i adressen (kodas, så att tecken som @ och : fungerar)
  const url = new URL(get('DATABASE_URL', 'postgres://postgres@localhost:5432/otpnunu'));
  if (get('DB_PASSWORD')) url.password = encodeURIComponent(get('DB_PASSWORD'));
  return {
    databaseUrl: url.toString(),
    riotApiKey: get('RIOT_API_KEY'),
    password: get('APP_PASSWORD'),
    port: Number(get('PORT', '8787')),
  };
}

/** Sant när filen körs direkt (node server/x.mjs), inte när den importeras. Fungerar även på Windows. */
export const isMain = (metaUrl) => !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;
