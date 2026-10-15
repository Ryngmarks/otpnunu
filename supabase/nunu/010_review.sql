-- ============================================================
-- Nunu – positioner för alla, items/runor, objectives och matchgenomgång.
--
-- Kör i Supabase: SQL Editor → New query → klistra in → Run.
-- Kräver 006. Går att köra flera gånger.
--
-- Synken fyller kolumnerna när matcherna räknas om (derived_version 5) – ur sparad rådata
-- och sparade tidslinjer, utan nya anrop till Riot. Innan den här filen körts räknar synken
-- som tidigare (version 4).
-- ============================================================

alter table nunu.account_match
  add column if not exists ally_positions  text[],  -- samma ordning som allies (TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY)
  add column if not exists enemy_positions text[],  -- samma ordning som enemies
  -- { items: [id], trinket, keystone, primary, secondary, spells: [id] }
  add column if not exists loadout         jsonb,
  -- { mine: { dragon, baron, horde, riftHerald, tower, inhibitor, firstDragon, … }, theirs: { … } }
  add column if not exists objectives_team jsonb,
  -- { minutes: [[guld, xp, cs, motståndarens guld, xp, cs]], path: [[x, y]], events: [...], monsters: [...] }
  -- Hämtas bara när en match öppnas (stor).
  add column if not exists review          jsonb;
