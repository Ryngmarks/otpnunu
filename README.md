# Nunu Career

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

Nunu Career isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or
anyone officially involved in producing or managing Riot Games properties. Riot Games, and all
associated properties are trademarks or registered trademarks of Riot Games, Inc.
