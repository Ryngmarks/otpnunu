/*
 * Champion-namn och ikoner från Riots öppna Data Dragon (ingen nyckel behövs).
 * Cachas i webbläsaren per spelversion. Fungerar utan nätverk – då visas id:t.
 */
const CACHE_KEY = 'nunu-ddragon-v2';

export async function loadChampions({ base = 'https://ddragon.leagueoflegends.com', storage = window.localStorage, fetchImpl = (...a) => fetch(...a) } = {}) {
  let cached = null;
  try { cached = JSON.parse(storage.getItem(CACHE_KEY)); } catch (e) { /* ignorera */ }
  const fresh = cached && Date.now() - cached.fetchedAt < 24 * 3600 * 1000;
  let data = cached;

  if (!fresh) {
    try {
      const [version] = await (await fetchImpl(`${base}/api/versions.json`)).json();
      const champs = (await (await fetchImpl(`${base}/cdn/${version}/data/en_US/champion.json`)).json()).data;
      const byId = {};
      for (const c of Object.values(champs)) byId[c.key] = { name: c.name, image: c.image.full, tags: c.tags || [] };
      data = { version, byId, fetchedAt: Date.now() };
      try { storage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* ignorera */ }
    } catch (e) {
      // Utan nätverk: använd gammal cache om den finns
    }
  }

  return {
    name: (id) => (data && data.byId[id] && data.byId[id].name) || (id === 20 ? 'Nunu & Willump' : `#${id}`),
    icon: (id) => (data && data.byId[id] ? `${base}/cdn/${data.version}/img/champion/${data.byId[id].image}` : null),
    /** Riots grova klassning: Tank, Fighter, Mage, Assassin, Marksman, Support. */
    tags: (id) => (data && data.byId[id] && data.byId[id].tags) || [],
  };
}
