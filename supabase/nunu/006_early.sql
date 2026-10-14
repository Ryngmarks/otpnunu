-- ============================================================
-- Nunu – early game, synergier och lagkompositioner (modul 2–5 i docs/nunu-early-game.md).
--
-- Kör i Supabase: SQL Editor → New query → klistra in → Run.
-- Kräver 001, 003 och 005. Går att köra flera gånger.
--
-- Synken fyller kolumnerna när matcherna räknas om (derived_version 4) – ur sparad
-- rådata och sparade tidslinjer, utan nya anrop till Riot.
-- ============================================================

alter table nunu.account_match
  -- { me: { "5": { gold, xp, level, cs, k, d, a }, "10": …, "15": … },
  --   opp: { "5": { gold, xp, level, cs }, … } | null, firstBlood: 'kill'|'assist'|'died'|null }
  add column if not exists early          jsonb,
  add column if not exists allies         int[],          -- lagkamraternas champions
  add column if not exists enemies        int[],          -- motståndarnas champions
  add column if not exists enemy_ap_share numeric(4, 1);  -- % magisk skada i motståndarlaget
