-- ============================================================
-- Nunu – tidslinjer, skada och dödsfall.
--
-- Kör i Supabase: SQL Editor → New query → klistra in → Run.
-- Kräver 001_init.sql. Går att köra flera gånger.
--
-- Tidslinjerna sparas gzippade (~80 KB styck) i Supabase Storage, i den privata
-- bucketen "timelines" – bara Edge Function (service role) kommer åt dem.
-- Det som räknas fram ur dem sparas här i databasen och visas i appen.
-- ============================================================

-- Skada per match (räknas fram av synken, derived_version 2)
alter table nunu.account_match
  add column if not exists physical        int,
  add column if not exists magic           int,
  add column if not exists true_damage     int,
  add column if not exists taken           int,
  add column if not exists mitigated       int,
  add column if not exists objectives      int,
  add column if not exists team_share      numeric(4, 1),  -- % av lagets skada mot champions
  add column if not exists opponent_damage int,
  add column if not exists damage_at10     int,            -- från tidslinjen (null = ingen tidslinje)
  add column if not exists damage_at14     int,
  add column if not exists damage_at20     int;

-- Dina dödsfall, ur tidslinjen
create table if not exists nunu.death (
  puuid               text not null,
  match_id            text not null,
  t_ms                int not null,                 -- tid i matchen
  killer_champion_id  int,                          -- null = torn, minion eller monster
  helper_champion_ids int[] not null default '{}',
  total               int not null default 0,       -- skada du tog i dödsögonblicket
  places              text[] not null default '{}', -- camp, objective, torn, våg
  sources             jsonb not null default '[]',  -- [{ name, damage }] störst först
  primary key (puuid, match_id, t_ms),
  foreign key (puuid, match_id) references nunu.account_match (puuid, match_id) on delete cascade
);

revoke all on nunu.death from public, anon, authenticated;
grant select on nunu.death to authenticated;
grant all on nunu.death to service_role;
alter table nunu.death enable row level security;
drop policy if exists "egna dödsfall" on nunu.death;
create policy "egna dödsfall" on nunu.death
  for select to authenticated
  using (puuid in (select puuid from nunu.riot_account));  -- riot_account filtreras redan till egna

-- Privat bucket för tidslinjerna. Inga policies = bara service role kommer åt den.
insert into storage.buckets (id, name, public)
values ('timelines', 'timelines', false)
on conflict (id) do nothing;
