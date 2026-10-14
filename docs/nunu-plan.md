# Nunu – plan

Statistik- och träningsapp för Nunu & Willump: historik från flera Riot-konton,
matchanalys, en personlig Playbook och på sikt livefunktioner.

Status: **steg 1 (API-test) förberett.** Ingen databas, inga Supabase-inställningar och
ingen fotbollskod har ändrats.

---

## 1. Beslut

| Fråga | Beslut |
|---|---|
| Repo | Samma repo som fotbollsappen. Nunu i egna mappar, utvecklas på branchen `nunu/dev`. |
| Supabase | Samma projekt och samma inloggning (Supabase Auth). |
| Databas | Ett eget schema: `nunu`. Fler scheman bara vid tydligt behov. |
| Riot-identitet | **PUUID** är primärnyckel för Riot-konton. Riot ID (namn#tagg) sparas som visningsnamn. |
| Rådata | Riots ursprungliga matchsvar sparas oförändrade. Importkö och tidslinjelagring väntar tills vi vet datavolymen. |
| Ordning | Nunu Career → Playbook → matchplanering → Live. |
| Kodstil | Enkel, modulär, testbar. Inga ramverk, ingen byggprocess – samma stil som fotbollsappen. |

## 2. Arkitektur

```
Webbläsare (GitHub Pages)                  Supabase (samma projekt som fotbollen)
/             fotbollsappen (orörd)        schema public  fotboll + taktik (orört)
/nunu/        Nunu-appen                   schema nunu    Nunu-tabeller (RLS)
                 │                                          ▲
                 │ inloggad användare                       │ service role
                 └──────────► Edge Function nunu-riot ──────┘
                                   │  enda delen som har Riot-nyckeln
                                   ▼
                              Riot API (europe / euw1)
```

### Moduler

Varje modul har en tydlig uppgift och pratar med de andra bara via databasen.

| Modul | Ansvar | Var |
|---|---|---|
| **Riot-import** | Enda delen som anropar Riot. Kopplar konton (Riot ID → PUUID), hämtar matcher och mastery, sparar rådata oförändrad. | `supabase/functions/nunu-riot/riot.js`, `import.js` |
| **Matchanalys** | Rena funktioner: rådata in → statistik ut. Inga anrop, inga sidoeffekter, kan köras om på all rådata. | `supabase/functions/nunu-riot/derive.js` |
| **Career** (fas 1) | Vyer: profil, konton, historik, mastery, grundstatistik. | `nunu/js/career/` |
| **Playbook** (fas 2) | Egna anteckningar per matchup, kopplade till matcher. | `nunu/js/playbook/` + egna tabeller |
| **Matchplanering** (fas 3) | Plan inför match utifrån Playbook och statistik. | `nunu/js/planning/` |
| **Live** (fas 4) | Insamling under match. Kräver ett litet program på spel-datorn (Riots Live Client Data API finns bara lokalt). | Separat, egen funktion |

Gemensamt: `nunu/js/core/` (inloggning mot samma Supabase Auth, API-klient, routing).

### Mappar

```
nunu/                        webbappen → …github.io/Notvikens-t-vlings-app/nunu/
  index.html
  css/
  js/core/  js/career/  …
  tools/                     testverktyg (API-testet)
supabase/nunu/               SQL-migreringar, numrerade: 001_init.sql, 002_…
supabase/functions/nunu-riot/
docs/nunu-plan.md            den här filen
.github/workflows/           nunu-riot-api-test.yml (bara på nunu/dev)
```

Fotbollens filer (`index.html`, `css/`, `js/`, `supabase/schema.sql`) ändras inte av Nunu-arbetet.

## 3. Datamodell (fas 1)

Allt i schemat `nunu`. Fem tabeller.

```
auth.users ──1:1── nunu.profile
                     id            uuid  pk
                     user_id       uuid  unik → auth.users
                     display_name  text
                     created_at
                      │
                      └──1:n── nunu.riot_account
                                 puuid           text  pk       ← stabil identifierare
                                 profile_id      uuid  → profile
                                 game_name, tag_line             (Riot ID, kan ändras av spelaren)
                                 platform        text  (euw1)
                                 region          text  (europe)
                                 linked_at, last_synced_at
                                  │
                                  ├──1:n── nunu.account_match     pk (puuid, match_id)
                                  │          match_id → raw_match
                                  │          champion_id, queue_id, game_start, duration_s,
                                  │          team_position, win, kills, deaths, assists, cs,
                                  │          gold, damage, vision, derived_version
                                  │
                                  └──1:n── nunu.mastery            pk (puuid, champion_id)
                                             level, points, last_play_time,
                                             payload jsonb (Riots svar), fetched_at

nunu.raw_match                              ← ursprunglig Riot-data, oförändrad
  match_id    text  pk  (t.ex. EUW1_7123456789)
  region      text
  payload     jsonb     (hela svaret från match-v5)
  fetched_at
```

- **Flera konton, en profil:** en användare har en profil, profilen har valfritt antal Riot-konton.
  Ett PUUID kan bara höra till en profil (primärnyckel).
- **Rådata sparas en gång per match**, även om flera av dina konton (eller flera användare) var med.
  `account_match` pekar på den.
- **Statistiken kan alltid räknas om** från `raw_match` med nya regler – `derived_version` visar
  vilken version av analysen som skapat raden.
- **Väntar tills vi vet volymen:** tidslinjer, mastery-historik över tid och en importkö.
  API-testet mäter storlekarna.

### PUUID – en sak att känna till

Riots krypterade id:n är kopplade till den registrerade Riot-applikationen. Byter vi till en
nyckel under en *annan* applikation kan PUUID bli ett annat. Därför sparas även Riot ID, så att
kontona kan slås upp igen. Inom samma applikation är PUUID stabilt även när spelaren byter namn.
Detta kontrolleras när vi går från utvecklingsnyckel till personlig nyckel.

## 4. Säkerhet

### Nycklar
- **Riot-nyckeln** finns bara som hemlighet: i GitHub Actions (för API-testet) och senare i
  Edge Function. Aldrig i koden eller i webbläsaren – repot är publikt.
- **Supabase service role** används bara inuti Edge Function. Webbläsaren har bara den publika nyckeln.
- **Den läckta `sb_secret_…`-nyckeln** (commit `af79baa`, publik historik) måste vara spärrad
  i Supabase. Historiken skrivs inte om – spärren är det som skyddar. Se *Manuella steg*.

### Rättigheter i `nunu`
| Tabell | Webbläsaren (inloggad) | Edge Function |
|---|---|---|
| `profile` | läsa/skapa/ändra **sin egen** | allt |
| `riot_account` | läsa **sina egna** | koppla konton |
| `account_match`, `mastery` | läsa **sina egna** | skriva |
| `raw_match` | **ingen åtkomst** (inga `grant`) | läsa/skriva |

- Radskydd (RLS) på alla tabeller: `profile.user_id = auth.uid()`.
- `anon` får inga rättigheter alls i `nunu`.
- Edge Function kontrollerar inloggningen och att kontot tillhör användaren innan något hämtas.

### Fotbollsdatan
I dag släpper fotbollstabellerna in **alla inloggade**. Det är okej så länge bara fotbollens
användare har konton. **Innan någon annan än fotbollens användare får ett konto** (t.ex. en
kompis till Nunu) ska fotbollen få en medlemslista:

1. Ny tabell `public.football_members (user_id)` – fyll med alla nuvarande konton **först**.
2. Byt fotbollstabellernas regler från "alla inloggade" till "medlem".
3. Fotbollsappen visar "Ingen behörighet" för inloggade som inte är medlemmar.

Ingen data ändras – bara behörigheten. Testas i lokal Postgres och webbläsare innan det körs.
Görs som eget steg med eget godkännande. Taktiktavlan har redan en egen behörighetslista.

### Övrigt
- Egen registrering i Supabase Auth förblir avstängd. Konton skapas av dig.
- GitHub Actions-loggar är publika i ett publikt repo. API-testets rapport innehåller bara
  ditt Riot ID, ett maskerat PUUID och dina egna matchresultat – inga andra spelares namn.

## 5. Utvecklingsordning

### Steg 1 – API-test *(förberett)*
Mål: veta vad Riot faktiskt ger och hur mycket data det blir, innan vi bygger databasen.

`nunu/tools/riot-api-test.mjs` hämtar för **Rymm3n#EUW**:
- kontot → PUUID
- antal tillgängliga match-id:n (max 1 000, bara id:n)
- **de senaste 20 matcherna** i sin helhet
- **en tidslinje** – bara för att mäta storleken
- **champion mastery** för Nunu & Willump (id 20) och totalt

26–35 anrop beroende på hur lång historiken är – under Riots gräns för utvecklingsnycklar (100 per 2 minuter).
Inget sparas i Supabase. Rapporten visar bl.a. storlek per match (rå och komprimerad),
uppskattning per 1 000 matcher, historikens djup, Nunu-matcher och mastery.

Körs i GitHub Actions (`.github/workflows/nunu-riot-api-test.yml`) eller lokalt:
```bash
RIOT_API_KEY=RGAPI-… node nunu/tools/riot-api-test.mjs              # bara rapport
RIOT_API_KEY=RGAPI-… node nunu/tools/riot-api-test.mjs --save ./raw # sparar rå JSON lokalt
node --test "nunu/tools/*.test.mjs"                                  # enhetstester, ingen nyckel behövs
```

**Beslut efter testet:** hur rådatan lagras (jsonb i databasen räcker troligen för matcher),
om/hur tidslinjer sparas, hur långt bak importen ska gå och om en importkö behövs.

### Steg 2 – Nunu Career (fas 1)
1. `supabase/nunu/001_init.sql`: schemat och de fem tabellerna med rättigheter. Testas i lokal Postgres
   (egen användare ser sitt, annan användare ser inget, `raw_match` stängd).
2. Edge Function `nunu-riot`: koppla konto, synka de senaste matcherna, hämta mastery.
   Testas mot en låtsas-Riot.
3. `derive.js`: rådata → `account_match`. Testas mot de riktiga matcherna från steg 1.
4. `/nunu/`: inloggning, profil med konton, knappen Synka, översikt (matcher, vinstprocent, KDA,
   CS/min, mastery per konto och totalt), matchlista.

Klart när: du kan koppla två konton, synka, och se samlad statistik – och en annan användare ser ingenting.

### Senare faser
- **Fas 2 – Playbook:** anteckningar per matchup/motståndarjungler, taggar, koppling till matcher.
- **Fas 3 – Matchplanering:** plan inför match utifrån Playbook och statistik. Tidslinjeanalys
  (first clear, objectives, guldskillnad) om datavolymen tillåter.
- **Fas 4 – Live:** "spelar just nu" via Riots spectator-API, därefter ett lokalt hjälpprogram.
  Bara funktioner som följer Riots regler (ingen otillåten fördel under match).

## 6. Manuella steg

### Före API-testet
- [ ] **Riot-nyckel:** logga in på <https://developer.riotgames.com> med ditt Riot-konto och kopiera
      *Development API Key* (gäller 24 timmar).
- [ ] **GitHub secret:** repot → *Settings → Secrets and variables → Actions → New repository secret*.
      Namn `RIOT_API_KEY`, värde = nyckeln.
- [ ] **Kör testet:** *Actions → Nunu – Riot API-test →* senaste körningen *→ Re-run all jobs*.
      Resultatet står under *Summary*.

### Före fas 1
- [ ] Spärra den läckta `sb_secret_…`-nyckeln: Supabase → *Project Settings → API Keys → Secret keys*.
- [ ] Slå på *Secret scanning* och *Push protection*: GitHub → *Settings → Code security*.
- [ ] Kontrollera Supabase: inga okända tabeller, vilka användare som finns, att egen registrering är avstängd.
- [ ] Lägg till `nunu` under Supabase → *Settings → Data API → Exposed schemas*.
- [ ] Ansök om en **Personal API Key** hos Riot (registrera produkten). Krävs för synk som inte
      dör efter 24 timmar. Godkännandet kan ta tid – ansök tidigt.

### Innan någon annan än fotbollens användare får konto
- [ ] Medlemslista för fotbollsdatan (avsnitt 4).
