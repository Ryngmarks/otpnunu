# otpnunu – early game och ganks: vad kan säkert räknas fram?

Underlag: Riots match-v5 (match + tidslinje) som redan sparas för varje match på Summoner's Rift
(matchen i `nunu.raw_match`, tidslinjen gzippad i Storage). Inget behöver hämtas från Riot på nytt –
nya uträkningar görs ur sparad rådata och hämtar bara det som saknas.

## Vad datan innehåller

| Källa | Fält | Upplösning |
|---|---|---|
| Matchen | champion, lag, position (`teamPosition`), vinst, K/D/A, guld, skada per typ, `challenges` | hela matchen |
| Tidslinjen, *frames* | per spelare och minut: `totalGold`, `xp`, `level`, `minionsKilled`, `jungleMinionsKilled`, `position {x,y}`, skadestatistik | **en gång per minut** |
| Tidslinjen, *events* | `CHAMPION_KILL` med tid (ms), **position {x,y}**, mördare, offer, assisterande; även objectives, torn, wards, köp | exakt tid |

## 1. Gank-analys – säker med en tydlig definition

**Säkert:** varje kill där du är med (kill eller assist), med exakt tid, kartposition, offer och vilka som deltog.
Varje gång du dör, med tid och position.

**Inte säkert / går inte:** ganks *utan* kill eller död (tidslinjen har position bara en gång per minut, så en
gank som bara tvingar flash syns inte). Därför räknas bara ganks med ett tydligt utfall.

**Definition (konservativ):**
1. Bara matcher där du spelar **jungle** (`teamPosition = JUNGLE`), och bara **före 15:00** (laning phase).
2. Händelsens **position** avgör platsen: top, mid, bot (lane), river, jungle eller bas (se zoner nedan).
3. **Gank** = du får en kill eller assist i en **lane**-zon. Kills i jungle/river räknas som *jungle-strider*, inte ganks.
4. **En kill i en lane utan dig är ingen gank** – den räknas inte alls i din gank-statistik.
5. Kills i samma lane inom 15 s slås ihop till **en** gank (en dive som ger 2 kills = 1 gank, 2 takedowns).
6. Utfall per gank: **lyckad** (takedown, du överlever), **byte** (takedown men du dör i samma gank),
   och separat **död i lane utan takedown** (kan vara en misslyckad gank – men också något annat, så den visas för sig).
7. Om motståndarens jungler är med i striden markeras gank:en som **2v2 / kontring**.

**Zoner** (Summoner's Rift, koordinater 0–14 800; blått lag nere till vänster):
- top: vänsterkanten `x < 1900` (från `y > 3800`) och överkanten `y > 12900` (till `x < 11000`)
- bot: nederkanten `y < 1900` (från `x > 3800`) och högerkanten `x > 12900` (till `y < 11000`)
- mid: diagonalen, `|x − y| < 1300` (raptors hamnar utanför), utanför baserna
- river: `|x + y − 14800| < 1500` (utanför lanes) · bas: hörnen (`x, y < 3800` eller `x, y > 11000`) · resten: jungle

Banden är medvetet smala: en strid i lane-buskarna längst ut kan hamna i *jungle* (ganks underskattas hellre
än att en jungle-strid kallas gank). Gränserna är testade mot tornens koordinater.

## 2. Early game vid 5, 10 och 15 min – säker

Ur minut-frames: **guld, XP, nivå, CS** (lane- + jungle-CS) för dig och motståndarens jungler (samma position).
Ur events: **kills, deaths och assists** fram till 5/10/15 min. Differens mot motståndaren (guld, XP, CS).
Matcher kortare än 15 min får inget 15-minutersvärde. *Frames tas exakt på minuten (±några sekunder).*

## 3. Synergier – säker

Ur matchen: dina **lagkamraters champions** och **motståndarlagets champions** med vinst/förlust.
Visas bara med minst 5 matcher per champion, så att slumpen inte styr (med få matcher är skillnader osäkra).

## 4. Matchups och lagkompositioner – delvis säker

- **Mot motståndarens jungler:** säkert (finns redan som "Vanligaste motståndarna"; byggs ut med early game-diff).
- **Lagkomposition, skadeprofil:** säker – andelen magisk/fysisk skada i motståndarlaget ur matchen
  (t.ex. *mest AP*, *mest AD*, *blandat*).
- **Lagkomposition, champion-typer** (tank, assassin, mage …): Data Dragons klassning per champion – grov och
  ändras inte med builds, så den visas som *ungefärlig*.

## 5. Tidig prestation → vinst – säker som samband, inte orsak

Vinstprocent grupperad på t.ex. guld-diff vid 10 min (efter/jämnt/före), första gank lyckad eller inte,
dödsfall före 10 min, first blood. Det visar *samband* – en tidig ledning kan också bero på draften.

## Moduler (en i taget)

1. **Ganks** – detta steg. Ny kolumn `ganks` (jsonb) i `account_match`, räknas fram av synken (derived_version 3).
2. **Early game 5/10/15** – kolumn `early` (jsonb): dina värden och diff mot motståndarens jungler.
3. **Synergier** – lag- och motståndarchampions per match.
4. **Matchups och kompositioner** – jungler-matchups med early-diff, skadeprofil.
5. **Tidigt → vinst** – vinstprocent per grupp, ovanpå 1–4.
