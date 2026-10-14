# otpnunu – plan

Statistik- och träningsapp för Nunu & Willump: historik från flera Riot-konton,
matchanalys, en personlig Playbook och på sikt livefunktioner.

**Status**
- Steg 1 – API-test: **klart** (se avsnitt 5).
- Fas 1 – Career: **databas, Edge Function och webbsidan klara och testade lokalt.**
  Inget är kört i Supabase än.
- Den gamla fotbollsappen (Notviken) är borttagen ur repot. Dess tabeller i Supabase tas bort med
  `supabase/cleanup/remove-football.sql` (avsnitt 8).

---

## 1. Beslut

| Fråga | Beslut |
|---|---|
| Repo | Nunu är det enda i repot (webbsidan i roten). Utvecklas på `nunu/dev`, publiceras från deploy-branchen. |
| Supabase | Befintligt projekt och inloggning (Supabase Auth). Volymen för matcher ryms med god marginal (avsnitt 5). Tidslinjer kan senare lagras i egen Postgres på egen server. |
| Databas | Ett eget schema: `nunu`. Rådatan skyddas med rättigheter, inte med ett extra schema. |
| Riot-identitet | **PUUID** är primärnyckel för Riot-konton. Riot ID (namn#tagg) sparas och hålls uppdaterat. |
| Rådata | Riots matchsvar sparas oförändrade som `jsonb`. Tidslinjer sparas inte i fas 1. |
| Import | Ingen importkö. Varje synk hämtar upp till 80 saknade matcher; webbsidan fortsätter tills allt är hämtat. |
| Behörighet | Bara användare i `nunu.member` kan använda Nunu (och därmed Riot-nyckeln). Från början bara johan@ryngmarks.com. |
| Ordning | Career → Playbook → matchplanering → Live. |
| Kodstil | Enkel, modulär, testbar. Inga ramverk, ingen byggprocess, inga beroenden. |

## 2. Arkitektur

```
Webbläsare (GitHub Pages)                    Supabase
/        otpnunu ─────── läser egen data ──► schema nunu    Nunu-tabeller (RLS)
            │                                                 ▲
            │ "koppla konto" / "synka"                        │ service role
            └──────────► Edge Function nunu-riot ─────────────┘
                              │  enda delen som har Riot-nyckeln
                              ▼
                         Riot API (europe / euw1)
```

### Moduler

Modulerna pratar med varandra bara via databasen.

| Modul | Ansvar | Filer |
|---|---|---|
| **Riot-import** | Enda delen som anropar Riot. Kopplar konton, hämtar matcher och mastery, sparar rådata oförändrad, respekterar Riots gränser. | `supabase/functions/nunu-riot/riot.mjs`, `sync.mjs` |
| **Matchanalys** | Rena funktioner: rådata in → rader ut. Kan köras om på all rådata. | `supabase/functions/nunu-riot/derive.mjs` |
| **Databas (server)** | De få databasoperationer synken behöver. | `supabase/functions/nunu-riot/db.mjs` |
| **HTTP** | Inloggning, medlemskap, CORS, fördelning av anrop. | `supabase/functions/nunu-riot/handler.mjs`, `index.ts` |
| **Career** (fas 1) | Webbsidan: inloggning, konton, synk, mastery, grundstatistik, matcher, motståndare. | `js/core/` (inloggning, data, Data Dragon), `js/career/` (statistik, vyer), `js/app.js` |
| **Playbook** (fas 2) | Egna anteckningar per matchup. | – |
| **Matchplanering** (fas 3) | Plan inför match. | – |
| **Live** (fas 4) | Insamling under match via ett litet program på spel-datorn. | – |

`index.ts` är det enda som är Supabase/Deno-specifikt. Allt annat är vanlig JavaScript som
testas i Node.

### Mappar

```
index.html, css/, assets/         webbsidan (GitHub Pages), tema och splash-bild
js/core/                           inloggning, data, champion-namn
js/career/                         statistik (rena funktioner) och vyer
js/config.js                       Supabase-adress och publik nyckel
tests/                             tester + dev-server.mjs (hela appen lokalt utan Supabase/Riot)
tools/riot-api-test.mjs            API-testet från steg 1
supabase/cleanup/                  engångsskript: ta bort gamla fotbollsappen ur Supabase
supabase/nunu/001_init.sql         schemat nunu – körs för hand i SQL Editor
supabase/nunu/tests/               databastester (SQL) och tester för Edge Function (Node)
supabase/functions/nunu-riot/      Edge Function
docs/nunu-plan.md                  den här filen
.github/workflows/nunu-ci.yml      tester + valfri driftsättning av nunu-riot
.github/workflows/nunu-riot-api-test.yml
```

## 3. Datamodell

Allt i schemat `nunu`, sex tabeller (`supabase/nunu/001_init.sql`).

```
auth.users ──1:1── nunu.member          vem får använda Nunu
           ──1:1── nunu.profile         id, user_id, display_name
                     │
                     └──1:n── nunu.riot_account
                                puuid (pk), game_name, tag_line, platform, region,
                                linked_at, last_synced_at, backfill_done
                                 │
                                 ├──1:n── nunu.account_match   pk (puuid, match_id)
                                 │          champion_id, queue_id, game_start, duration_s,
                                 │          team_position, win, remake, kills, deaths, assists,
                                 │          cs, gold, damage, vision, opponent_champion_id,
                                 │          derived_version
                                 │                 │
                                 │                 └──► nunu.raw_match   match_id (pk), region,
                                 │                                       game_start, payload jsonb
                                 └──1:n── nunu.mastery          pk (puuid, champion_id)
                                            level, points, last_play_time, payload jsonb
```

- **Flera konton, en profil.** Ett PUUID kan bara höra till en profil.
- **Rådata en gång per match**, även om flera konton (eller användare) var med.
- **`account_match` kan alltid räknas om** från `raw_match`; `derived_version` visar vilka regler som gällde.
- **Remakes** (`remake = true`) och **lägen utan roller** (t.ex. Arena, kö 1750) sparas men räknas
  inte i statistiken som standard.
- **`backfill_done`** blir sant när hela historiken är hämtad. Därefter läser synken bara tills den
  når en redan känd match.
- **Väntar:** tidslinjer, mastery-historik över tid.

### PUUID

Inom samma Riot-applikation är PUUID stabilt, även när spelaren byter namn (bekräftat i API-testet:
samma PUUID i alla 20 matcher). Riots krypterade id:n är kopplade till den registrerade
applikationen, så vid byte till en nyckel under en annan applikation kan PUUID ändras.
Därför sparas Riot ID också, så att kontona kan slås upp igen.

## 4. Säkerhet

### Nycklar
- **Riot-nyckeln** finns bara som hemlighet: i GitHub Actions och i Edge Function. Aldrig i koden
  eller i webbläsaren – repot är publikt.
- **Supabase service role** används bara inuti Edge Function. Webbläsaren har bara den publika nyckeln.
- **Den läckta `sb_secret_…`-nyckeln** (commit `af79baa`) måste vara spärrad i Supabase. Historiken
  skrivs inte om – spärren är det som skyddar.

### Rättigheter i `nunu` (testat – `supabase/nunu/tests/001_rls_test.sql`)
| Tabell | Webbläsaren (inloggad) | Edge Function |
|---|---|---|
| `member` | se sin egen rad | läsa |
| `profile` | läsa/skapa/ändra **sin egen** | allt |
| `riot_account` | läsa och koppla bort **sina egna** | koppla konton, uppdatera |
| `account_match`, `mastery` | läsa **sina egna** | skriva |
| `raw_match` | **ingen åtkomst** | läsa/skriva |

- Radskydd (RLS) på alla tabeller. `anon` har ingen åtkomst alls till schemat.
- Edge Function kontrollerar inloggningen (Supabase Auth) och medlemskapet innan något görs,
  och synkar bara konton som tillhör användaren.
- CORS släpper bara in GitHub Pages (och localhost för utveckling).

### Övrigt
- Egen registrering i Supabase Auth förblir avstängd. Konton skapas av dig.
- GitHub Actions-loggar är publika. API-testets rapport visar bara ditt Riot ID, ett maskerat
  PUUID och dina egna matchresultat.

## 5. Steg 1 – API-test (klart 2026-10-14)

`tools/riot-api-test.mjs` mot **Rymm3n#EUW** med utvecklingsnyckel:

| Mätning | Resultat |
|---|---|
| PUUID | Samma i alla 20 matcher |
| Tillgänglig historik | 771 match-id:n |
| Nunu & Willump | 17 av de 20 senaste; mastery nivå 178, 1 930 343 poäng (plats 1 av 166) |
| Köer | 420 (solo), 440 (flex), 400 (normal draft), 1750 (Arena-läge, inga roller) |
| Match, snitt | 84 KB rå JSON, 11 KB komprimerad |
| Hela historiken | ~65 MB rå (Postgres komprimerar stora jsonb-fält) |
| En tidslinje | 919 KB rå, 79 KB komprimerad → ~700 MB för hela historiken |
| Anrop | 33 på 10 s, inga 429; gräns 20/s och 100/2 min |

**Slutsatser**
1. Rådata för matcher lagras som `jsonb` i databasen – ryms med god marginal i gratisnivåns 500 MB.
2. Tidslinjer ryms inte i databasen. Om/när de behövs: bara Nunu-matcher, komprimerade, i Storage.
3. Hela historiken tar ~16 min att hämta (Riots gräns) → synk i omgångar om 80, ingen kö.
4. Remakes (t.ex. 0/0/0 med 0–4 CS) och Arena filtreras bort ur statistiken men sparas som rådata.

## 6. Fas 1 – Career

### Klart (testat lokalt)
1. **`supabase/nunu/001_init.sql`** – schemat, sex tabeller, rättigheter och radskydd.
   24 databastester i Postgres 16: egen data syns, andras inte, rådatan är stängd, `anon` utestängd,
   går att köra flera gånger.
2. **Edge Function `nunu-riot`**
   - `POST { action: "link", riotId: "Rymm3n#EUW", platform: "euw1" }` – kopplar ett konto.
   - `POST { action: "sync" }` – synkar mastery och upp till 80 saknade matcher per konto.
     Svarar `{ results, done, retryAfter }`; webbsidan anropar igen tills `done` är sant
     (och väntar `retryAfter` sekunder om Riot bett om det).
   - 20 enhetstester mot en låtsas-Riot och en minnesdatabas, typkontroll i Deno.

3. **Webbsidan** – inloggning (Supabase Auth), "Ingen åtkomst"
   för icke-medlemmar, koppla/koppla bort konton, Synka med förlopp och automatisk väntan när Riot
   begränsar takten, mastery (summerad över konton), matcher, vinst %, KDA, CS/min, guld/min,
   senaste 10, matchlista med motståndare, vanligaste motståndarjunglers. Filter: Nunu/alla champions,
   kö (rankat, solo, flex, normal, Rift, alla) och konto. Remakes räknas aldrig.
   Champion-namn och ikoner från Riots öppna Data Dragon. 9 enhetstester + 26 kontroller i webbläsare.

### Kvar i fas 1
4. Kör allt mot Supabase och verifiera med riktig data.
5. Publicera: för över `nunu/dev` till deploy-branchen (ditt beslut).

**Klart när:** du kan koppla två konton, synka hela historiken och se samlad statistik –
och en annan användare ser ingenting.

### Senare faser
- **Fas 2 – Playbook:** anteckningar per matchup/motståndarjungler, taggar, koppling till matcher.
- **Fas 3 – Matchplanering:** plan inför match. Tidslinjeanalys om/när tidslinjer sparas.
- **Fas 4 – Live:** "spelar just nu" via Riots spectator-API, därefter ett lokalt hjälpprogram –
  bara funktioner som följer Riots regler.

## 7. Driftsättning

| Del | Hur |
|---|---|
| Databas | **För hand:** kör `supabase/nunu/001_init.sql` i SQL Editor. SQL körs aldrig automatiskt. |
| Edge Function | **Automatiskt** via `nunu-ci.yml` när secret `SUPABASE_ACCESS_TOKEN` finns – annars bara tester. Riot-nyckeln förs över från GitHub-secret `RIOT_API_KEY`. |
| Webbsida | GitHub Pages från deploy-branchen. `js/config.js` innehåller Supabase-adress och publik nyckel. |

`SUPABASE_ACCESS_TOKEN` ger tillgång till alla dina Supabase-projekt (även matappens). Alternativet
är att driftsätta för hand med Supabase CLI från en dator.

### Lokal utveckling
```bash
node tests/dev-server.mjs             # → http://localhost:8787/  (johan@nik.se / nunu123)
node --test "tests/*.test.mjs" "supabase/nunu/tests/*.test.mjs" "tools/*.test.mjs"
bash supabase/nunu/tests/run.sh       # databastester, kräver Postgres
```
Dev-servern kör den riktiga webbsidan och den riktiga Edge Function-koden mot en låtsasdatabas
(med samma radskydd) och en låtsas-Riot med 230 + 45 matcher.

## 8. Manuella steg

### Före driftsättning av fas 1
- [ ] Spärra den läckta `sb_secret_…`-nyckeln: Supabase → *Project Settings → API Keys → Secret keys*.
- [ ] Slå på *Secret scanning* och *Push protection*: GitHub → *Settings → Code security*.
- [ ] Kör `supabase/nunu/001_init.sql` i Supabase SQL Editor.
- [ ] Lägg till `nunu` under Supabase → *Settings → Data API → Exposed schemas*.
- [ ] Kör `supabase/nunu/002_season_history.sql` (äldre säsonger, se nedan).
- [ ] Skapa en Supabase access token (*Account → Access Tokens*) och lägg in den som GitHub-secret
      `SUPABASE_ACCESS_TOKEN` – eller välj manuell driftsättning.
- [ ] Ansök om en **Personal API Key** hos Riot (*Register Product*). Utvecklingsnyckeln gäller bara
      24 timmar och måste annars förnyas i GitHub-secret `RIOT_API_KEY` före varje användning.

### Ta bort gamla fotbollsappen ur Supabase
- [ ] (Valfritt) Säkerhetskopiera datan: kör i SQL Editor och spara resultatet:
      `select json_build_object('players', (select json_agg(t) from public.players t), 'training_sessions', (select json_agg(t) from public.training_sessions t), 'results', (select json_agg(t) from public.results t), 'tactics', (select json_agg(t) from public.tactics t));`
- [ ] Kör `supabase/cleanup/remove-football.sql` del för del (testad i Postgres: tar bara bort
      fotbollens tabeller och andras konton; schemat nunu och johan@ryngmarks.com rörs inte).
- [x] Repot heter nu `otpnunu`.
      Sidans adress: `https://ryngmarks.github.io/otpnunu/`.

## Äldre säsonger (före Riots historik)

Riot lämnar bara ut matcher ungefär två år bakåt. Äldre säsonger förs in för hand som
sammanfattningar i `nunu.season_history`: per säsong och champion antal matcher, vinster och
snitt-K/D/A (avskrivet från OP.GG, fliken "All"). Siffrorna ligger i
`supabase/nunu/002_season_history.sql`; ändra där och kör filen igen för att rätta eller lägga till.

- Appen visar dem i kortet **Hela karriären**: en rad per säsong, en rad för synkade matcher
  (Summoner's Rift, alla konton) och totalen. Följer champion-filtret (Nunu / alla).
- Appen kan bara läsa tabellen. Bara SQL Editor (eller service role) kan skriva.
- Saknas i dagsläget: S2024 S2 och S2024 S3, samt de nedersta champions i S2021 och S2022
  (Nunu-raderna är kompletta).
- Säsongerna ska inte överlappa de synkade matcherna – annars räknas matcher två gånger.
