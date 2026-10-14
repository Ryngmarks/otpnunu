// Tester för webbservern (server/app.mjs) med låtsas-Riot och databas i minnet. Kör: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp, sessionToken } from '../server/app.mjs';
import { createRiot, HttpError } from '../server/riot/riot.mjs';
import { ROOT } from '../server/env.mjs';
import { fakeRiot, P1 } from './helpers/fake-riot.mjs';
import { memoryDb } from './helpers/memory-db.mjs';

async function start({ password = 'hemligt', db = memoryDb(), riotKey = 'RGAPI-ok', history = { [P1]: 12 } } = {}) {
  const fake = fakeRiot({ history });
  const errors = [];
  const app = createApp({
    db,
    password,
    root: ROOT,
    wrongPasswordDelayMs: 0,
    log: (e) => errors.push(e),
    makeRiot: () => createRiot({ apiKey: riotKey, fetchImpl: fake.fetchImpl, sleep: async () => {}, spacingMs: 0 }),
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (path, { method = 'GET', body, json = true, raw = false } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined && json ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return raw ? res : { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
  return { call, db, fake, errors, close: () => new Promise((r) => server.close(r)) };
}

test('inloggning: lösenord krävs, fel lösenord nekas, cookie fungerar', async () => {
  const s = await start();
  try {
    assert.deepEqual((await s.call('/api/session')).data, { loggedIn: false, passwordRequired: true });
    assert.equal((await s.call('/api/data')).status, 401);
    assert.equal((await s.call('/api/login', { method: 'POST', body: { password: 'fel' } })).status, 401);
    assert.equal((await s.call('/api/login', { method: 'POST', body: { password: 'hemligt' } })).status, 200);
    assert.equal((await s.call('/api/session')).data.loggedIn, true);
    assert.equal((await s.call('/api/data')).status, 200);
    await s.call('/api/logout', { method: 'POST', body: {} });
    assert.equal((await s.call('/api/data')).status, 401);
  } finally { await s.close(); }
});

test('inloggning: token följer lösenordet', () => {
  assert.equal(sessionToken('a'), sessionToken('a'));
  assert.notEqual(sessionToken('a'), sessionToken('b'));
});

test('utan lösenord behövs ingen inloggning', async () => {
  const s = await start({ password: '' });
  try {
    assert.deepEqual((await s.call('/api/session')).data, { loggedIn: true, passwordRequired: false });
    assert.equal((await s.call('/api/data')).status, 200);
  } finally { await s.close(); }
});

test('koppla konto, synka och läsa data', async () => {
  const s = await start({ password: '' });
  try {
    const link = await s.call('/api/link', { method: 'POST', body: { riotId: 'Rymm3n#EUW' } });
    assert.equal(link.status, 200);
    assert.equal(link.data.account.puuid, P1);
    assert.equal((await s.call('/api/link', { method: 'POST', body: { riotId: 'Finns#Inte' } })).status, 404);
    assert.equal((await s.call('/api/link', { method: 'POST', body: { riotId: 'utan-tagg' } })).status, 400);

    const sync = await s.call('/api/sync', { method: 'POST', body: {} });
    assert.equal(sync.status, 200);
    assert.equal(sync.data.done, true);
    assert.equal(sync.data.results[0].imported, 12);

    const { data } = await s.call('/api/data');
    assert.equal(data.accounts.length, 1);
    assert.equal(data.matches.length, 12);
    assert.equal(data.deaths.length, 20, '10 matcher med tidslinje (5 och 10 är ARAM) × 2');
    assert.equal(data.deaths[0].sources, undefined, 'detaljerna skickas inte till webbsidan');
    assert.equal(data.mastery.length, 2);

    assert.equal((await s.call('/api/sync', { method: 'POST', body: { puuid: 'okänd' } })).status, 404);
    assert.equal((await s.call(`/api/accounts/${P1}`, { method: 'DELETE' })).status, 200);
    assert.equal((await s.call('/api/data')).data.matches.length, 0);
  } finally { await s.close(); }
});

test('synk utan Riot-nyckel ger ett tydligt fel', async () => {
  const s = await start({ password: '', riotKey: '' });
  try {
    const r = await s.call('/api/link', { method: 'POST', body: { riotId: 'Rymm3n#EUW' } });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /RIOT_API_KEY/);
  } finally { await s.close(); }
});

test('bara JSON tas emot (skydd mot formulär från andra sidor) och fel visas utan detaljer', async () => {
  const db = memoryDb();
  db.listAccounts = async () => { throw new Error('hemlig databasdetalj'); };
  const s = await start({ password: '', db });
  try {
    assert.equal((await s.call('/api/link', { method: 'POST', body: 'riotId=x', json: false })).status, 415);
    assert.equal((await s.call('/api/link', { method: 'POST', body: '{inte json' })).status, 400);
    assert.equal((await s.call('/api/okänt')).status, 404);
    const r = await s.call('/api/data');
    assert.equal(r.status, 500);
    assert.doesNotMatch(r.data.error, /hemlig/);
    assert.equal(s.errors.length, 1);
  } finally { await s.close(); }
});

test('statiska filer: webbsidan ja, hemligheter och serverkod nej', async () => {
  const s = await start({ password: '' });
  try {
    const page = await s.call('/');
    assert.equal(page.status, 200);
    assert.match(page.data, /otpnunu/);
    assert.equal((await s.call('/css/nunu.css')).status, 200);
    assert.equal((await s.call('/js/app.js')).status, 200);
    for (const p of ['/.env', '/.env.example', '/server/db.mjs', '/package.json', '/css/../.env', '/%2e%2e/.env', '/js/%2e%2e/server/app.mjs', '/data/x.json']) {
      assert.equal((await s.call(p)).status, 404, p);
    }
  } finally { await s.close(); }
});

test('HttpError används för riot-fel', () => {
  assert.throws(() => createRiot({ apiKey: '' }), (e) => e instanceof HttpError && e.status === 400);
});
