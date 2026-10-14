/*
 * Webbsidans koppling till den lokala servern (server/app.mjs).
 * Inloggningen sköts av en cookie som servern sätter – sidan sparar inga lösenord.
 */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApi({ base = '', fetchImpl = (...a) => fetch(...a) } = {}) {
  async function call(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError(0, 'Får ingen kontakt med servern – är den igång (npm start)?');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* inte JSON */ }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Fel ${res.status}`);
    return data;
  }

  return {
    session: () => call('/api/session'),
    signIn: (password) => call('/api/login', { method: 'POST', body: { password } }),
    signOut: () => call('/api/logout', { method: 'POST', body: {} }),
    /** Allt sidan visar: { accounts, matches, mastery, history, deaths } */
    data: () => call('/api/data'),
    link: (riotId, platform) => call('/api/link', { method: 'POST', body: { riotId, platform } }),
    sync: (puuid) => call('/api/sync', { method: 'POST', body: puuid ? { puuid } : {} }),
    unlinkAccount: (puuid) => call(`/api/accounts/${encodeURIComponent(puuid)}`, { method: 'DELETE' }),
  };
}
