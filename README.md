# otpnunu

Statistik, mastery, matchhistorik och tidslinjeanalys för Nunu & Willump – från flera Riot-konton.
Körs helt på din egen dator: PostgreSQL för datan och en liten Node-server för webbsidan.
Med lösenord når du sidan även från mobilen på hemnätet.

Plan och beslut: [`docs/nunu-plan.md`](docs/nunu-plan.md).

## Översikt

```
index.html, css/, js/, assets/   webbsidan
  js/core/                       koppling till servern, champion-namn (Data Dragon)
  js/career/                     statistik (rena funktioner) och vyer
server/
  main.mjs                       startar servern (npm start)
  app.mjs                        webbsidan + JSON-API, lösenordsinloggning
  db.mjs                         all SQL (PostgreSQL)
  schema.sql, seasons.sql        tabeller och äldre säsonger (npm run setup)
  riot/                          Riot-klient, uträkning och synk
  analysis/                      tidslinjeanalys: skada per minut, dödsfall
  import-files.mjs               läs in sparade matchfiler (npm run import)
tests/                           tester, låtsas-Riot och dev-server
tools/riot-api-test.mjs          engångstest av Riot API (datavolym, gränser)
```

En enda paketberoende: [`pg`](https://www.npmjs.com/package/pg) för PostgreSQL. Inga ramverk, ingen byggprocess.

## Installation på Windows (en gång)

1. **Node** 20 eller senare (finns redan).
2. **PostgreSQL**: ladda ner installationsprogrammet från
   [postgresql.org/download/windows](https://www.postgresql.org/download/windows/) och kör det med
   standardvalen. Välj ett lösenord för användaren `postgres` och kom ihåg det. Port 5432.
3. I PowerShell, i projektmappen:
   ```powershell
   cd C:\Users\johan\otpnunu
   git pull
   npm install
   Copy-Item .env.example .env
   notepad .env
   ```
4. Fyll i `.env`:
   - `DB_PASSWORD` – PostgreSQL-lösenordet från steg 2
   - `RIOT_API_KEY` – nyckeln från [developer.riotgames.com](https://developer.riotgames.com)
   - `APP_PASSWORD` – ett lösenord för sidan (behövs för att nå den från mobilen)
5. Skapa databasen:
   ```powershell
   npm run setup
   ```

## Köra

```powershell
npm start
```

Öppna `http://localhost:8787`, logga in, koppla `Rymm3n#EUW` och tryck **Synka**. Första synken
hämtar hela historiken med tidslinjer (~770 matcher, ~30 min med en utvecklingsnyckel) – sidan
fortsätter automatiskt när Riot ber den vänta. Låt fönstret vara öppet; stäng servern med Ctrl+C.

- **Från mobilen:** terminalen skriver ut en adress som `http://192.168.1.20:8787`. Mobilen måste vara
  på samma wifi. Svara **Tillåt** för *privata nätverk* när Windows brandvägg frågar första gången.
- **Ny Riot-nyckel:** byt `RIOT_API_KEY` i `.env` – ingen omstart behövs. En *Personal API Key*
  (Register Product på developer.riotgames.com) slutar inte gälla efter 24 timmar.
- **Efter en uppdatering:** `git pull`, `npm install`, `npm run setup`, `npm start`.
- **Matcher som redan finns som filer** (från det gamla `tools/timeline/fetch.mjs`, i `data/matches/`):
  `npm run import` – sedan räknar Synka ut dem utan att hämta dem från Riot igen.
- **Äldre säsonger** (före Riots historik) ändras i `server/seasons.sql`, följt av `npm run setup`.

## Utveckla och testa

```bash
npm run dev     # webbsidan och servern med låtsas-Riot och databas i minnet → http://localhost:8787 (lösenord: nunu)
npm test        # alla tester
TEST_DATABASE_URL=postgres://postgres:lösen@localhost:5432/postgres npm test   # även mot riktig PostgreSQL
```

Testerna körs också i GitHub Actions (`.github/workflows/nunu-ci.yml`) vid varje push till `nunu/dev`.

## Säkerhet i korthet

- `.env` (Riot-nyckel, lösenord) finns bara på din dator och aldrig i git. Servern lämnar bara ut
  webbsidans filer – aldrig `.env`, serverkoden eller `data/`.
- Utan `APP_PASSWORD` lyssnar servern bara på den egna datorn. Med lösenord nås den på hemnätet;
  inloggningen är en cookie som bara fungerar för samma sida.
- Riot-nyckeln används bara av servern och skickas aldrig till webbläsaren.

---

otpnunu isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or
anyone officially involved in producing or managing Riot Games properties. Riot Games, and all
associated properties are trademarks or registered trademarks of Riot Games, Inc.
