/*
 * Nunu – inloggning och dataåtkomst.
 *   - Supabase Auth: konton skapas av administratören (ingen egen registrering).
 *   - Supabase REST (schemat nunu): läser bara användarens egen data (radskydd i databasen).
 *   - Edge Function nunu-riot: koppla konton och synka från Riot.
 */

const SESSION_KEY = 'nunu-auth-session';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApi({ url, key, storage = window.localStorage, fetchImpl = (...a) => fetch(...a) }) {
  if (!url || !key) throw new ApiError(0, 'Supabase är inte konfigurerat (js/config.js)');
  const root = url.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  let session = null;
  try { session = JSON.parse(storage.getItem(SESSION_KEY)); } catch (e) { /* ignorera */ }

  function setSession(s) {
    session = s;
    try { s ? storage.setItem(SESSION_KEY, JSON.stringify(s)) : storage.removeItem(SESSION_KEY); } catch (e) { /* ignorera */ }
  }

  const toSession = (d) => ({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    email: d.user && d.user.email,
  });

  async function auth(path, body, token) {
    const res = await fetchImpl(`${root}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.msg || data.error_description || data.message || 'Inloggningen misslyckades');
    return data;
  }

  let refreshing = null;
  function refresh() {
    if (!session) return Promise.reject(new ApiError(401, 'Inte inloggad'));
    refreshing = refreshing || auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then((d) => setSession(toSession(d)))
      .catch((e) => {
        if (e.status >= 400 && e.status < 500) setSession(null);
        throw new ApiError(401, 'Inloggningen har gått ut');
      })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  async function token() {
    if (!session) throw new ApiError(401, 'Inte inloggad');
    if (session.expires_at - 60 < Date.now() / 1000) await refresh();
    return session.access_token;
  }

  /** Anrop med inloggad användare. Förnyar inloggningen en gång vid 401. */
  async function authed(fullUrl, init, retried = false) {
    const res = await fetchImpl(fullUrl, { ...init, headers: { apikey: key, Authorization: `Bearer ${await token()}`, ...init.headers } });
    if (res.status === 401 && !retried) {
      await refresh();
      return authed(fullUrl, init, true);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      if (res.status === 401) setSession(null);
      const msg = (data && (data.error || data.message || data.msg)) || '';
      // Vanliga fel innan allt är installerat i Supabase
      if (res.status === 406 || /schema/i.test(msg)) throw new ApiError(res.status, 'Nunu-databasen är inte installerad än (schemat nunu saknas eller är inte exponerat)');
      // Vår funktion svarar alltid med { error }. Annat 404 betyder att funktionen inte finns.
      if (res.status === 404 && fullUrl.includes('/functions/') && !(data && data.error)) throw new ApiError(404, 'Nunu-funktionen är inte driftsatt än');
      throw new ApiError(res.status, msg || `Fel ${res.status}`);
    }
    return data;
  }

  const rest = (path, { method = 'GET', body, prefer, range } = {}) =>
    authed(`${root}/rest/v1/${path}`, {
      method,
      headers: {
        'Accept-Profile': 'nunu',
        'Content-Profile': 'nunu',
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
        ...(range ? { Range: range } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function all(path) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const page = await rest(path, { range: `${from}-${from + 999}` });
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }

  return {
    get email() { return (session && session.email) || ''; },
    isLoggedIn: () => !!session,

    async signIn(email, password) {
      try {
        setSession(toSession(await auth('token?grant_type=password', { email: email.trim(), password })));
      } catch (e) {
        throw e.status === 400 ? new ApiError(400, 'Fel e-post eller lösenord') : e;
      }
    },

    async signOut() {
      const t = session && session.access_token;
      setSession(null);
      if (t) await auth('logout', {}, t).catch(() => {});
    },

    /* ---- Egen data (schemat nunu) ---- */
    isMember: async () => (await rest('member?select=user_id')).length > 0,

    async profile() {
      const [p] = await rest('profile?select=id,display_name');
      return p || (await rest('profile?select=id,display_name', { method: 'POST', body: {}, prefer: 'return=representation' }))[0];
    },
    renameProfile: (id, displayName) =>
      rest(`profile?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { display_name: displayName }, prefer: 'return=minimal' }),

    accounts: () => rest('riot_account?select=*&order=linked_at.asc'),
    unlinkAccount: (puuid) => rest(`riot_account?puuid=eq.${encodeURIComponent(puuid)}`, { method: 'DELETE' }),
    matches: () => all('account_match?select=*&order=game_start.desc'),
    mastery: () => rest('mastery?select=puuid,champion_id,level,points,last_play_time'),
    seasonHistory: () => rest('season_history?select=season,champion_id,games,wins,kills,deaths,assists'),

    /* ---- Edge Function ---- */
    riot: (body) => authed(`${root}/functions/v1/nunu-riot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };
}
