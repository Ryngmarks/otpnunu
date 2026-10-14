// Tester för tools/cron-sync.mjs. Kör: node --test "tools/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronSync } from './cron-sync.mjs';

const reply = (status, body) => new Response(JSON.stringify(body), { status });

test('cronSync: fortsätter tills allt är klart och väntar när Riot säger till', async () => {
  const answers = [
    { results: [{ imported: 20, remaining: 25 }], done: false, retryAfter: null },
    { results: [{ imported: 5, remaining: 20 }], done: false, retryAfter: 300 },
    { results: [{ imported: 20, remaining: 0 }], done: true, retryAfter: null },
  ];
  const sent = [];
  const slept = [];
  const r = await cronSync({
    secret: 's'.repeat(40),
    fetchImpl: async (url, opts) => { sent.push(opts); return reply(200, answers.shift()); },
    sleep: async (ms) => slept.push(ms),
    log: () => {},
  });
  assert.deepEqual(r, { imported: 45, done: true });
  assert.equal(sent.length, 3);
  assert.equal(sent[0].headers['x-nunu-cron'], 's'.repeat(40));
  assert.deepEqual(JSON.parse(sent[0].body), { action: 'sync-all' });
  assert.deepEqual(slept, [130000], 'väntan begränsas till 130 s');
});

test('cronSync: slutar efter maxRounds och rapporterar fel från funktionen', async () => {
  const always = async () => reply(200, { results: [{ imported: 1, remaining: 99 }], done: false, retryAfter: null });
  assert.deepEqual(await cronSync({ secret: 'x', fetchImpl: always, maxRounds: 2, log: () => {} }), { imported: 2, done: false });
  await assert.rejects(cronSync({ secret: 'x', fetchImpl: async () => reply(401, { error: 'Fel hemlighet' }), log: () => {} }), /401: Fel hemlighet/);
  await assert.rejects(cronSync({ secret: '', log: () => {} }), /saknas/);
});
