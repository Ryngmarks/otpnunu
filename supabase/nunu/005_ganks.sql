-- ============================================================
-- Nunu – ganks före 15:00 (modul 1 i docs/nunu-early-game.md).
--
-- Kör i Supabase: SQL Editor → New query → klistra in → Run.
-- Kräver 001 och 003. Går att köra flera gånger.
--
-- Synken fyller kolumnen när matcherna räknas om (derived_version 3) – ur de
-- sparade tidslinjerna, utan nya anrop till Riot.
-- ============================================================

-- [{ t, lane, takedowns, kills, died, vsJungler, victims }] äldst först.
-- null = ingen tidslinje eller inte jungle i matchen.
alter table nunu.account_match
  add column if not exists ganks jsonb;
