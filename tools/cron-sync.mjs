#!/usr/bin/env node
/*
 * Schemalagd synk: anropar Edge Function nunu-riot med { action: 'sync-all' } tills alla
 * kopplade konton är klara (eller tiden tar slut). Körs varje timme av
 * .github/workflows/nunu-sync.yml.
 *
 * Miljövariabler:
 *   NUNU_CRON_SECRET  (krävs)  samma hemlighet som funktionen har
 *   NUNU_FUNCTION_URL           standard: projektets nunu-riot
 */
import { pathToFileURL } from 'node:url';

export const DEFAULT_URL = 'https://plpdcathcozyjraonouo.supabase.co/functions/v1/nunu-riot';

export async function cronSync({
  url = DEFAULT_URL,
  secret,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxRounds = 30,
  maxWaitS = 130,
  log = console.log,
}) {
  if (!secret) throw new Error('NUNU_CRON_SECRET saknas');
  let imported = 0;
  for (let round = 1; round <= maxRounds; round++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nunu-cron': secret },
      body: JSON.stringify({ action: 'sync-all' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Funktionen svarade ${res.status}: ${data.error || 'okänt fel'}`);

    const got = data.results.reduce((s, r) => s + r.imported, 0);
    const left = data.results.reduce((s, r) => s + r.remaining, 0);
    imported += got;
    log(`Varv ${round}: ${got} matcher, ${left} kvar${data.retryAfter ? ` – Riot vill vänta ${data.retryAfter} s` : ''}`);
    if (data.done) {
      log(`Klart: ${imported} matcher synkade.`);
      return { imported, done: true };
    }
    if (data.retryAfter) await sleep(Math.min(data.retryAfter, maxWaitS) * 1000);
  }
  log(`Tiden räckte inte – ${imported} matcher synkade, resten tas nästa timme.`);
  return { imported, done: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cronSync({ url: process.env.NUNU_FUNCTION_URL || DEFAULT_URL, secret: process.env.NUNU_CRON_SECRET })
    .catch((e) => { console.error(`Fel: ${e.message}`); process.exit(1); });
}
