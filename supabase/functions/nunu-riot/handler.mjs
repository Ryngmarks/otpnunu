/*
 * HTTP-lagret för Edge Function nunu-riot.
 *
 *   POST { action: 'link', riotId: 'Namn#Tagg', platform?: 'euw1' }
 *   POST { action: 'sync', puuid?: '…' }          (utan puuid: alla egna konton)
 *   POST { action: 'sync-all' } + header x-nunu-cron (schemalagd synk, alla konton)
 *
 * Kräver inloggad användare (Supabase-token i Authorization) som finns i nunu.member.
 * Allt Deno-/Supabase-specifikt ligger i index.ts – här bara webbstandard (Request/Response).
 */
import { HttpError } from './riot.mjs';
import { linkAccount, syncAccount } from './sync.mjs';

const ALLOWED_ORIGINS = ['https://ryngmarks.github.io'];
const isLocal = (o) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o || '');

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) || isLocal(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/** Jämför två strängar på konstant tid (så att hemligheten inte kan gissas via svarstiden). */
export function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** Synkar konton i tur och ordning. Ber Riot oss vänta tas resten nästa gång. */
async function syncAccounts({ riot, db, accounts }) {
  const results = [];
  for (const account of accounts) {
    const r = await syncAccount({ riot, db, account });
    results.push(r);
    if (r.retryAfter) break;
  }
  const retryAfter = results.reduce((m, r) => Math.max(m, r.retryAfter || 0), 0) || null;
  const done = results.length === accounts.length && results.every((r) => r.done);
  return { results, done, retryAfter };
}

/**
 * getUser(token) → { id, email } | null
 * makeDeps()     → { riot, db }
 * cronSecret     → hemlighet för schemalagd synk (NUNU_CRON_SECRET); tom = avstängd
 */
export function createHandler({ getUser, makeDeps, cronSecret = '', log = console.error }) {
  return async function handle(req) {
    const headers = { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json' };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply(405, { error: 'Bara POST' });

    try {
      // Schemalagd synk (GitHub Actions): ingen användare, i stället en delad hemlighet
      const cron = req.headers.get('x-nunu-cron');
      if (cron !== null) {
        if (cronSecret.length < 32 || !safeEqual(cron, cronSecret)) throw new HttpError(401, 'Fel eller avstängd synk-hemlighet');
        let body;
        try { body = await req.json(); } catch { throw new HttpError(400, 'Ogiltig JSON'); }
        if (body.action !== 'sync-all') throw new HttpError(400, 'Okänd action');
        const { riot, db } = makeDeps();
        return reply(200, await syncAccounts({ riot, db, accounts: await db.listAllAccounts() }));
      }

      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const user = token ? await getUser(token) : null;
      if (!user) throw new HttpError(401, 'Inte inloggad');

      const { riot, db } = makeDeps();
      if (!(await db.isMember(user.id))) throw new HttpError(403, 'Du har inte tillgång till Nunu');

      let body;
      try { body = await req.json(); } catch { throw new HttpError(400, 'Ogiltig JSON'); }

      if (body.action === 'link') {
        const account = await linkAccount({ riot, db, userId: user.id, riotId: body.riotId, platform: body.platform || 'euw1' });
        return reply(200, { account });
      }

      if (body.action === 'sync') {
        const profile = await db.ensureProfile(user.id);
        let accounts = await db.listAccounts(profile.id);
        if (body.puuid) {
          accounts = accounts.filter((a) => a.puuid === body.puuid);
          if (!accounts.length) throw new HttpError(404, 'Kontot finns inte i din profil');
        }
        return reply(200, await syncAccounts({ riot, db, accounts }));
      }

      throw new HttpError(400, 'Okänd action');
    } catch (err) {
      if (err instanceof HttpError) return reply(err.status, { error: err.message });
      log(err);
      return reply(500, { error: 'Något gick fel i Nunu-funktionen' });
    }
  };
}

/** Slår upp användaren bakom en Supabase-token via Supabase Auth. */
export function createGetUser({ url, apiKey, fetchImpl = fetch }) {
  return async (token) => {
    const res = await fetchImpl(url.replace(/\/+$/, '') + '/auth/v1/user', {
      headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u && u.id ? { id: u.id, email: u.email } : null;
  };
}
