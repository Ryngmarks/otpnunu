/*
 * Webbservern: webbsidan (statiska filer) och ett litet JSON-API.
 * Ingen ramverk – bara node:http. db och Riot-klienten injiceras så att allt kan testas.
 *
 *   POST   /api/login      { password }        → sätter inloggningscookie
 *   POST   /api/logout
 *   GET    /api/session                         → { loggedIn, passwordRequired }
 *   GET    /api/data                            → { accounts, matches, mastery, history, deaths }
 *   POST   /api/link       { riotId, platform } → { account }
 *   POST   /api/sync       { puuid? }           → { results, done, retryAfter }
 *   DELETE /api/accounts/:puuid
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { HttpError } from './riot/riot.mjs';
import { linkAccount, syncAccount } from './riot/sync.mjs';

const COOKIE = 'otpnunu';
const STATIC_DIRS = ['css', 'js', 'assets'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

/** Inloggningstoken: härleds ur lösenordet, så att den överlever omstarter och dör när lösenordet byts. */
export const sessionToken = (password) => createHmac('sha256', password).update('otpnunu-session-v1').digest('hex');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';')
  .map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

export function createApp({
  db,
  makeRiot,                     // () => Riot-klient; kastar HttpError om nyckeln saknas
  password = '',                // tomt = ingen inloggning (servern lyssnar då bara på den egna datorn)
  root,                         // mapp med index.html, css/, js/, assets/
  log = (e) => console.error(e),
  wrongPasswordDelayMs = 600,
}) {
  const token = password ? sessionToken(password) : null;
  let syncing = false;

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const readJson = (req) => new Promise((resolve, reject) => {
    if (!/^application\/json/.test(req.headers['content-type'] || '')) {
      reject(new HttpError(415, 'Förväntade JSON')); // stoppar även formulär från andra sidor (CSRF)
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10_000) { reject(new HttpError(413, 'För stort anrop')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new HttpError(400, 'Ogiltig JSON')); }
    });
  });

  const loggedIn = (req) => !token || safeEqual(cookies(req)[COOKIE] || '', token);

  async function api(req, res, path) {
    const method = req.method;

    if (path === '/api/session' && method === 'GET') {
      return send(res, 200, { loggedIn: loggedIn(req), passwordRequired: !!token });
    }
    if (path === '/api/login' && method === 'POST') {
      const { password: given = '' } = await readJson(req);
      if (token && !safeEqual(given, password)) {
        await new Promise((r) => setTimeout(r, wrongPasswordDelayMs)); // bromsar gissningar
        throw new HttpError(401, 'Fel lösenord');
      }
      return send(res, 200, { ok: true }, token ? {
        'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 90}`,
      } : {});
    }
    if (path === '/api/logout' && method === 'POST') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }

    if (!loggedIn(req)) throw new HttpError(401, 'Logga in först');

    if (path === '/api/data' && method === 'GET') {
      const [accounts, matches, mastery, history, deaths] = await Promise.all([
        db.listAccounts(), db.listMatches(), db.listMastery(), db.listHistory(), db.listDeaths(),
      ]);
      return send(res, 200, { accounts, matches, mastery, history, deaths });
    }

    if (path === '/api/link' && method === 'POST') {
      const { riotId, platform = 'euw1' } = await readJson(req);
      const account = await linkAccount({ riot: makeRiot(), db, riotId, platform });
      return send(res, 200, { account });
    }

    if (path === '/api/sync' && method === 'POST') {
      const { puuid } = await readJson(req);
      if (syncing) throw new HttpError(409, 'En synk pågår redan');
      syncing = true;
      try {
        const riot = makeRiot();
        let accounts = await db.listAccounts();
        if (puuid) accounts = accounts.filter((a) => a.puuid === puuid);
        if (puuid && !accounts.length) throw new HttpError(404, 'Okänt konto');
        const results = [];
        for (const account of accounts) {
          const r = await syncAccount({ riot, db, account });
          results.push(r);
          if (r.retryAfter) break; // Riot vill att vi väntar – resten tas nästa varv
        }
        const retryAfter = results.reduce((mx, r) => Math.max(mx, r.retryAfter || 0), 0) || null;
        return send(res, 200, { results, retryAfter, done: results.length === accounts.length && results.every((r) => r.done) });
      } finally {
        syncing = false;
      }
    }

    const m = path.match(/^\/api\/accounts\/([^/]+)$/);
    if (m && method === 'DELETE') {
      await db.deleteAccount(decodeURIComponent(m[1]));
      return send(res, 200, { ok: true });
    }

    throw new HttpError(404, 'Okänt anrop');
  }

  async function staticFile(req, res, path) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Metoden stöds inte');
    const rel = path === '/' ? 'index.html' : normalize(decodeURIComponent(path)).replace(/^[/\\]+/, '');
    // Bara index.html och mapparna för webbsidan – aldrig .env, server/ eller data/
    if (rel !== 'index.html' && !STATIC_DIRS.some((d) => rel.startsWith(d + sep) || rel.startsWith(d + '/'))) {
      throw new HttpError(404, 'Hittades inte');
    }
    let data;
    try { data = await readFile(join(root, rel)); } catch { throw new HttpError(404, 'Hittades inte'); }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(rel)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': rel === 'index.html' ? 'no-cache' : 'max-age=300',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return async function handle(req, res) {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (path.startsWith('/api/')) await api(req, res, path);
      else await staticFile(req, res, path);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      log(err);
      return send(res, 500, { error: 'Något gick fel i servern – se terminalfönstret' });
    }
  };
}
