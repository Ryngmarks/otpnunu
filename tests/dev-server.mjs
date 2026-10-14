#!/usr/bin/env node
/*
 * Utvecklingsserver: den riktiga servern (server/app.mjs) med låtsas-Riot och databas i minnet.
 * Ingen PostgreSQL eller Riot-nyckel behövs.   npm run dev  →  http://localhost:8787  (lösenord: nunu)
 * Koppla Rymm3n#EUW eller Smurf#EUW och tryck Synka.
 */
import http from 'node:http';
import { createApp } from '../server/app.mjs';
import { createRiot } from '../server/riot/riot.mjs';
import { ROOT, isMain } from '../server/env.mjs';
import { fakeRiot, P1, P2 } from './helpers/fake-riot.mjs';
import { memoryDb } from './helpers/memory-db.mjs';

export function createDevServer({ port = 8787, password = 'nunu', history = { [P1]: 120, [P2]: 0 } } = {}) {
  const riot = fakeRiot({ history });
  const db = memoryDb({
    history: [
      { season: 'S2022', champion_id: 20, games: 833, wins: 451, kills: 9, deaths: 5.3, assists: 12.3, ended: null },
      { season: 'S2025', champion_id: 20, games: 235, wins: 122, kills: 7.3, deaths: 5.5, assists: 12.6, ended: '2026-01-08' },
    ],
  });
  const app = createApp({
    db,
    password,
    root: ROOT,
    makeRiot: () => createRiot({ apiKey: 'RGAPI-ok', fetchImpl: riot.fetchImpl, spacingMs: 0 }),
  });
  const server = http.createServer(app);
  return {
    db,
    riot,
    listen: () => new Promise((r) => server.listen(port, '127.0.0.1', () => r(`http://localhost:${server.address().port}`))),
    close: () => new Promise((r) => server.close(r)),
  };
}

if (isMain(import.meta.url)) {
  createDevServer({ port: Number(process.env.PORT) || 8787 }).listen()
    .then((url) => console.log(`Dev-server: ${url}  (lösenord: nunu)`));
}
