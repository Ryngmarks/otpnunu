-- ============================================================
-- Champion Library – din strategi per champion och relation.
--
-- Kör i Supabase: SQL Editor → New query → klistra in → Run.
-- Kräver 008. Går att köra flera gånger.
--
-- Samma tabell som Live Scout (nunu.champion_opinion), så bedömning, kommentar och strategi
-- delas av Live Scout, Champion Library och Playbook. Lagkamrat och motståndare är egna rader
-- (side 'with'/'against'), så samma champion kan ha olika bedömning beroende på relationen.
--   note:     kort kommentar (syns på kortet)
--   strategy: längre strategi (syns i detaljvyn)
-- ============================================================

alter table nunu.champion_opinion
  add column if not exists strategy text not null default '';

alter table nunu.champion_opinion drop constraint if exists champion_opinion_strategy_length;
alter table nunu.champion_opinion
  add constraint champion_opinion_strategy_length check (char_length(strategy) <= 2000);
