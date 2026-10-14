# otpnunu

Statistik, mastery och matchhistorik för Nunu & Willump – från flera Riot-konton.
På sikt även matchanalys, en personlig Playbook och livefunktioner.

Plan, arkitektur, datamodell och säkerhet: [`docs/nunu-plan.md`](docs/nunu-plan.md).

## Översikt

```
index.html, css/, js/, assets/   webbsidan (GitHub Pages)
  js/core/                       inloggning (Supabase Auth), data, champion-namn (Data Dragon)
  js/career/                     statistik (rena funktioner) och vyer
  js/config.js                   Supabase-adress och publik nyckel
supabase/nunu/001_init.sql       databasschemat "nunu" – körs för hand i SQL Editor
supabase/nunu/002_season_history.sql  äldre säsonger (före Riots historik), förda in för hand
supabase/nunu/003_timelines.sql  skada, dödsfall och bucketen för tidslinjer (Storage)
supabase/nunu/004_rekey.sql      byte av Riot-nyckel (nytt PUUID)
supabase/nunu/005_ganks.sql      ganks före 15:00 (docs/nunu-early-game.md)
supabase/nunu/006_early.sql      early game 5/10/15 min, lag och motståndarnas skadeprofil
supabase/nunu/007_rank.sql       rank-historik (elo) per konto och kö
supabase/functions/nunu-riot/    Edge Function: kopplar Riot-konton och synkar matcher
supabase/cleanup/                engångsskript (borttagning av gamla fotbollsappen)
tests/                           tester + dev-server.mjs
tools/riot-api-test.mjs          API-test mot Riot
```

Inga ramverk, ingen byggprocess, inga beroenden.

## Köra lokalt

```bash
node tests/dev-server.mjs          # → http://localhost:8787/
```

Dev-servern kör den riktiga webbsidan och den riktiga Edge Function-koden mot en låtsasdatabas
(med samma radskydd som i Supabase) och en låtsas-Riot. Logga in med `johan@nik.se` / `nunu123`
och koppla `Rymm3n#EUW` och `Smurf#EUW`.

## Tidslinjer, skada och dödsfall

Synka hämtar även tidslinjen för varje match på Summoner's Rift. Den sparas gzippad (~80 KB) i
Supabase Storage (privat bucket `timelines`) – ~50 MB för hela historiken. Ur den räknas skada vid
10/14/20 minuter och varje dödsfall (när, var, av vem) fram och sparas i databasen; appen visar det
i kortet **Skada och dödsfall**. Matcher som synkades innan dess räknas om automatiskt vid nästa synk.

## Automatisk synk varje timme

`.github/workflows/nunu-sync.yml` anropar Edge Function `nunu-riot` varje timme (17 minuter över)
och synkar alla kopplade konton: nya matcher, tidslinjer och mastery. Den använder hemligheten
`NUNU_CRON_SECRET` (minst 32 tecken), som ligger i GitHub och läggs in i funktionen vid
driftsättning. Utan hemligheten är den schemalagda synken avstängd. Kan också startas för hand under
*Actions → Nunu – synk varje timme → Run workflow*.

## Tester

```bash
node --test "tests/*.test.mjs" "supabase/nunu/tests/*.test.mjs" "tools/*.test.mjs"
bash supabase/nunu/tests/run.sh    # databastester (rättigheter och radskydd), kräver Postgres
```

Körs också automatiskt i GitHub Actions (`.github/workflows/nunu-ci.yml`).

## Säkerhet i korthet

- Riot-nyckeln finns bara som hemlighet (GitHub Actions / Edge Function) – aldrig i koden.
- Webbsidan har bara Supabase publika nyckel. Databasen släpper bara fram användarens egen data.
- Bara medlemmar (`nunu.member`) kan använda Nunu. Egen registrering är avstängd.

---

otpnunu isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or
anyone officially involved in producing or managing Riot Games properties. Riot Games, and all
associated properties are trademarks or registered trademarks of Riot Games, Inc.
