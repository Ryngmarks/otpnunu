#!/usr/bin/env node
/*
 * Skapar databasen (om den saknas), tabellerna och de äldre säsongerna.
 * Går att köra flera gånger – kör igen efter en uppdatering av koden.
 *   npm run setup
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { ROOT, loadConfig, isMain } from './env.mjs';

export async function setup(connectionString, log = console.log) {
  const url = new URL(connectionString);
  const name = decodeURIComponent(url.pathname.slice(1)) || 'otpnunu';
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Ogiltigt databasnamn "${name}"`);

  // Databasen skapas via standarddatabasen "postgres"
  const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  try {
    const exists = (await admin.query('select 1 from pg_database where datname = $1', [name])).rowCount > 0;
    if (!exists) {
      await admin.query(`create database "${name}"`);
      log(`Skapade databasen ${name}`);
    }
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('set client_min_messages = warning');
    for (const file of ['schema.sql', 'seasons.sql']) {
      await client.query(await readFile(join(ROOT, 'server', file), 'utf8'));
    }
    const [{ n }] = (await client.query('select count(*)::int as n from nunu.season_history')).rows;
    log(`Databasen ${name} är klar (${n} säsongsrader).`);
  } finally {
    await client.end();
  }
}

if (isMain(import.meta.url)) {
  setup(loadConfig().databaseUrl).catch((e) => {
    console.error(`Fel: ${e.message}`);
    if (/password authentication|ECONNREFUSED/.test(e.message)) {
      console.error('Kontrollera att PostgreSQL är igång och att DATABASE_URL i .env har rätt lösenord.');
    }
    process.exit(1);
  });
}
