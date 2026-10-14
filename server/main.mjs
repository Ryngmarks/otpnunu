#!/usr/bin/env node
/*
 * Startar otpnunu på den här datorn.   npm start
 * Med APP_PASSWORD i .env nås sidan även från mobilen på hemnätet, annars bara från datorn.
 */
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { ROOT, loadConfig, isMain } from './env.mjs';
import { createDb } from './db.mjs';
import { createApp } from './app.mjs';
import { createRiot } from './riot/riot.mjs';

/** IPv4-adresser på hemnätet (för att öppna sidan från mobilen). */
export const lanAddresses = (ifaces = networkInterfaces()) => Object.values(ifaces).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

async function main() {
  const config = loadConfig();
  const db = createDb({ connectionString: config.databaseUrl });
  try {
    await db.query('select 1 from nunu.season_history limit 1');
  } catch (e) {
    console.error(`Kommer inte åt databasen: ${e.message}`);
    console.error(/does not exist/.test(e.message)
      ? 'Kör först:  npm run setup'
      : 'Kontrollera att PostgreSQL är igång och att DATABASE_URL i .env stämmer.');
    process.exit(1);
  }

  // Riot-nyckeln läses om från .env vid varje synk – byt nyckel utan att starta om
  const makeRiot = () => createRiot({ apiKey: loadConfig().riotApiKey });
  const app = createApp({ db, makeRiot, password: config.password, root: ROOT });
  const host = config.password ? '0.0.0.0' : '127.0.0.1';

  http.createServer(app).listen(config.port, host, () => {
    console.log(`otpnunu är igång:  http://localhost:${config.port}`);
    if (config.password) {
      for (const ip of lanAddresses()) console.log(`  från mobilen:     http://${ip}:${config.port}`);
    } else {
      console.log('  (bara på den här datorn – sätt APP_PASSWORD i .env för att nå sidan från mobilen)');
    }
    if (!config.riotApiKey) console.log('  OBS: RIOT_API_KEY saknas i .env – synken fungerar inte förrän den finns.');
    console.log('Stäng med Ctrl+C.');
  });
}

if (isMain(import.meta.url)) main();
