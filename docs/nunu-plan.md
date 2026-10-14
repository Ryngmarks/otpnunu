# otpnunu – plan

Statistik- och träningsapp för Nunu & Willump: historik från flera Riot-konton,
matchanalys med tidslinjer, en personlig Playbook och på sikt livefunktioner.

**Status**
- Steg 1 – API-test: **klart** (avsnitt 4).
- Fas 1 – Career: **klar och ombyggd för att köras lokalt** (avsnitt 5). Matcher, tidslinjer,
  skada och dödsfall sparas i en egen PostgreSQL på Windows-datorn.
- Supabase och GitHub Pages används inte längre (avsnitt 7).

---

## 1. Beslut

| Fråga | Beslut |
|---|---|
| Var | **Allt lokalt** på Windows-datorn: PostgreSQL + en liten Node-server som hämtar från Riot och visar webbsidan. Samma kod kan senare flyttas till den egna servern. |
| Åtkomst | Lösenord (`APP_PASSWORD`) → nås från mobilen på hemnätet. Utan lösenord bara från datorn. Inte nåbar från internet. |
| Riot-identitet | **PUUID** är primärnyckel för Riot-konton. Riot ID (namn#tagg) sparas och hålls uppdaterat. |
| Rådata | Riots svar (match och tidslinje) sparas oförändrade som `jsonb`. All statistik räknas fram ur rådatan och kan räknas om (`derived_version`). |
| Tidslinjer | Hämtas och sparas för alla matcher på Summoner's Rift (inte ARAM/Arena). |
| Import | Ingen kö. Varje synk hämtar upp till 40 saknade matcher (match + tidslinje = 2 anrop); sidan fortsätter tills allt är hämtat och väntar när Riot säger till. |
| Äldre säsonger | Riot lämnar bara ut ungefär ett år bakåt. Äldre säsonger förs in för hand från OP.GG (`server/seasons.sql`). |
| Ordning | Career → Playbook → matchplanering → Live. |
| Kodstil | Enkel, modulär, testbar. Inga ramverk, ingen byggprocess. Ett beroende: `pg`. |

## 2. Arkitektur

```
Webbläsare (datorn eller mobilen på wifi)
   │  http://<datorn>:8787   (lösenord → cookie)
   ▼
Node-server (server/main.mjs, app.mjs)
   ├── webbsidan: index.html, css/, js/, assets/
   ├── /api/data, /api/link, /api/sync, /api/accounts/:puuid
   ├── server/riot/ ──► Riot API (nyckeln i .env, bara på servern)
   └── server/db.mjs ─► PostgreSQL (schemat nunu)
```

| Modul | Innehåll | Kod |
|---|---|---|
| **Riot-import** | Riot-klient (gränser, 429), koppla konto, synk av matcher, tidslinjer och mastery | `server/riot/` |
| **Analys** | Uträkning per match: grundstatistik, skada, skada vid 10/14/20 min, dödsfall (vem, när, var) | `server/riot/derive.mjs`, `server/analysis/` |
| **Career** (fas 1) | Webbsidan: konton, synk, mastery, statistik, matcher, motståndare, skada och dödsfall, hela karriären | `js/` |
| **Playbook** (fas 2) | Egna anteckningar per matchup | – |
| **Matchplanering** (fas 3) | Plan inför match, bygger på tidslinjerna | – |
| **Live** (fas 4) | "Spelar just nu", därefter hjälpprogram på spel-datorn | – |

## 3. Datamodell (`server/schema.sql`)

| Tabell | Innehåll |
|---|---|
| `riot_account` | Kopplade konton (PUUID, Riot ID, server, synkstatus) |
| `raw_match` | Riots match-v5-svar, oförändrat. En rad per match även om flera konton var med |
| `raw_timeline` | Riots tidslinje, oförändrad (~1 MB JSON, komprimeras av PostgreSQL på disk) |
| `account_match` | Matchen ur ett kontos perspektiv: resultat, KDA, CS, guld, skada (typ, tagen, andel av laget, motståndarens), skada vid 10/14/20 min |
| `death` | Varje dödsfall: tid, vem som dödade och hjälpte, skada, plats (camp, objective, torn, våg) |
| `mastery` | Champion mastery per konto |
| `season_history` | Äldre säsonger från OP.GG; `ended` hindrar att synkade matcher räknas två gånger |

## 4. Steg 1 – API-test (klart 2026-10-14)

`tools/riot-api-test.mjs` mot **Rymm3n#EUW** med utvecklingsnyckel:

| Mätning | Resultat |
|---|---|
| PUUID | Samma i alla 20 matcher |
| Tillgänglig historik | 771 match-id:n (tillbaka till ungefär september 2025) |
| Nunu & Willump | mastery nivå 178, 1 930 343 poäng |
| Köer | 420 (solo), 440 (flex), 400 (normal draft), 1750 (Arena-läge, inga roller) |
| Match, snitt | 84 KB rå JSON, 11 KB komprimerad |
| En tidslinje | 919 KB rå, 79 KB komprimerad |
| Anrop | gräns 20/s och 100/2 min (utvecklings- och personlig nyckel) |

## 5. Fas 1 – Career

**Klart (testat):** koppla flera konton, synka hela historiken med tidslinjer, mastery, statistik med
filter (champion, kö, konto), senaste formen, matcher, motståndare, **skada och dödsfall** (vinster
mot förluster, skada vid 10/14 min, när/var/av vem du dör), **hela karriären** med äldre säsonger.
Tester: enhetstester, servern med låtsas-Riot, synken mot riktig PostgreSQL (CI) och webbläsartester.

**Kvar:** första riktiga körningen på Windows-datorn (README) och kontroll av siffrorna.

### Senare faser
- **Fas 2 – Playbook:** anteckningar per matchup/motståndarjungler, taggar, koppling till matcher.
- **Fas 3 – Matchplanering:** plan inför match, byggd på tidslinjerna (tidiga dödsfall, objectives).
- **Fas 4 – Live:** "spelar just nu" via Riots spectator-API, därefter ett lokalt hjälpprogram –
  bara funktioner som följer Riots regler.

## 6. Säkerhet

- `.env` (Riot-nyckel, databaslösenord, sidans lösenord) finns bara på datorn, aldrig i git.
- Servern lämnar bara ut webbsidans filer. Anrop till API:t kräver inloggningscookie
  (`HttpOnly`, `SameSite=Strict`) och JSON (stoppar formulär från andra sidor).
- Utan `APP_PASSWORD` lyssnar servern bara på `127.0.0.1`.
- Riot-nyckeln skickas aldrig till webbläsaren. En *Personal API Key* passar projektet
  (egen statistik, liten privat krets) och slutar inte gälla efter 24 timmar.

## 7. Kvar att städa (manuellt, valfritt)

- **GitHub Pages:** sidan på ryngmarks.github.io/otpnunu fungerar inte längre (ingen server bakom).
  Stäng av under *Settings → Pages*.
- **Supabase-projektet** används inte längre och kan raderas (*Project Settings → General → Delete
  project*). Matcherna hämtas på nytt från Riot och de äldre säsongerna finns i `server/seasons.sql`.
- **GitHub-hemligheterna** `SUPABASE_ACCESS_TOKEN` och `RIOT_API_KEY` behövs inte längre för appen
  (`RIOT_API_KEY` används bara av det manuella API-testet) och kan tas bort.
