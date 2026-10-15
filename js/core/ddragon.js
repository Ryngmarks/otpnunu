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
    /** Kvadratisk bild (tiles) till korten och bred splash till detaljvyn. Null utan data. */
    tile: (id) => (data && data.byId[id] ? `${base}/cdn/img/champion/tiles/${data.byId[id].image.replace(/\.png$/, '')}_0.jpg` : null),
    splash: (id) => (data && data.byId[id] ? `${base}/cdn/img/champion/centered/${data.byId[id].image.replace(/\.png$/, '')}_0.jpg` : null),
    /** Item-ikon och Summoner's Rift-kartan (samma spelversion). */
    item: (id) => (data && id ? `${base}/cdn/${data.version}/img/item/${id}.png` : null),
    map: () => (data ? `${base}/cdn/${data.version}/img/map/map11.png` : null),
    version: data ? data.version : null,
    /** Alla champions, sorterade på namn – för sökning i Scout. */
    all: () => (data ? Object.entries(data.byId).map(([id, c]) => ({ id: Number(id), name: c.name })).sort((a, b) => a.name.localeCompare(b.name)) : []),
  };
}

/**
 * Runor och summoner spells (namn och ikoner) – hämtas först när en match öppnas.
 * Returnerar uppslag som ger null om något saknas (då visas bara text eller inget).
 */
const EXTRA_KEY = 'nunu-ddragon-extra-v1';
export async function loadExtras(version, { base = 'https://ddragon.leagueoflegends.com', storage = window.localStorage, fetchImpl = (...a) => fetch(...a) } = {}) {
  let data = null;
  try { data = JSON.parse(storage.getItem(EXTRA_KEY)); } catch (e) { /* ignorera */ }
  if (version && (!data || data.version !== version)) {
    try {
      const [runes, spells] = await Promise.all([
        fetchImpl(`${base}/cdn/${version}/data/en_US/runesReforged.json`).then((r) => r.json()),
        fetchImpl(`${base}/cdn/${version}/data/en_US/summoner.json`).then((r) => r.json()),
      ]);
      const perks = {};
      for (const tree of runes) {
        perks[tree.id] = { name: tree.name, icon: tree.icon };
        for (const slot of tree.slots || []) for (const r of slot.runes || []) perks[r.id] = { name: r.name, icon: r.icon };
      }
      const summoners = {};
      for (const sp of Object.values(spells.data || {})) summoners[sp.key] = { name: sp.name, image: sp.image.full };
      data = { version, perks, summoners };
      try { storage.setItem(EXTRA_KEY, JSON.stringify(data)); } catch (e) { /* ignorera */ }
    } catch (e) {
      // Utan nätverk: bara text
    }
  }
  return {
    perk: (id) => (data && data.perks[id]) ? { name: data.perks[id].name, icon: `${base}/cdn/img/${data.perks[id].icon}` } : null,
    spell: (id) => (data && data.summoners[id]) ? { name: data.summoners[id].name, icon: `${base}/cdn/${data.version}/img/spell/${data.summoners[id].image}` } : null,
  };
}
