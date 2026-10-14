-- ============================================================
-- Nunu – fas 1 (Career): schema, tabeller och rättigheter.
--
-- Kör i Supabase: SQL Editor → New query → klistra in → Run.
-- Rör bara schemat "nunu".
-- Går att köra flera gånger.
--
-- Efteråt: Settings → Data API → Exposed schemas → lägg till "nunu".
-- ============================================================

create schema if not exists nunu;

-- Ingen kommer åt schemat utan uttrycklig rättighet
revoke all on schema nunu from public, anon;
grant usage on schema nunu to authenticated, service_role;

-- ------------------------------------------------------------
-- Vem får använda Nunu (och därmed Riot-nyckeln)?
-- Lägg till fler:  insert into nunu.member (user_id)
--                  select id from auth.users where lower(email) = 'namn@exempel.se';
-- ------------------------------------------------------------
create table if not exists nunu.member (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

insert into nunu.member (user_id)
select id from auth.users where lower(email) = 'johan@ryngmarks.com'
on conflict (user_id) do nothing;

-- ------------------------------------------------------------
-- En profil per användare, med valfritt antal Riot-konton
-- ------------------------------------------------------------
create table if not exists nunu.profile (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  created_at   timestamptz not null default now()
);

create table if not exists nunu.riot_account (
  puuid          text primary key check (char_length(puuid) between 40 and 100),
  profile_id     uuid not null references nunu.profile (id) on delete cascade,
  game_name      text not null,
  tag_line       text not null,
  platform       text not null default 'euw1' check (platform ~ '^[a-z0-9]{2,6}$'),
  region         text not null default 'europe' check (region in ('europe', 'americas', 'asia', 'sea')),
  linked_at      timestamptz not null default now(),
  last_synced_at timestamptz,
  backfill_done  boolean not null default false  -- hela historiken hämtad
);
create index if not exists riot_account_profile_idx on nunu.riot_account (profile_id);

-- ------------------------------------------------------------
-- Rådata: Riots svar från match-v5, oförändrat. En rad per match,
-- även om flera konton var med. Appen har INGEN åtkomst hit.
-- ------------------------------------------------------------
create table if not exists nunu.raw_match (
  match_id   text primary key,
  region     text not null,
  game_start timestamptz,
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Framräknat från rådatan (kan räknas om – se derived_version)
-- ------------------------------------------------------------
create table if not exists nunu.account_match (
  puuid                text not null references nunu.riot_account (puuid) on delete cascade,
  match_id             text not null references nunu.raw_match (match_id) on delete cascade,
  game_start           timestamptz not null,
  queue_id             int not null,
  duration_s           int not null,
  champion_id          int not null,
  team_position        text,
  win                  boolean not null,
  remake               boolean not null default false,
  kills                int not null default 0,
  deaths               int not null default 0,
  assists              int not null default 0,
  cs                   int not null default 0,
  gold                 int not null default 0,
  damage               int not null default 0,
  vision               int not null default 0,
  opponent_champion_id int,
  derived_version      int not null,
  primary key (puuid, match_id)
);
create index if not exists account_match_recent_idx on nunu.account_match (puuid, game_start desc);

create table if not exists nunu.mastery (
  puuid          text not null references nunu.riot_account (puuid) on delete cascade,
  champion_id    int not null,
  level          int not null,
  points         bigint not null,
  last_play_time timestamptz,
  payload        jsonb not null,
  fetched_at     timestamptz not null default now(),
  primary key (puuid, champion_id)
);

-- ------------------------------------------------------------
-- Rättigheter
--   anon:          ingenting
--   authenticated: bara sin egen data, via radskydd (RLS)
--   service_role:  allt (används bara av Edge Function nunu-riot)
-- ------------------------------------------------------------
revoke all on all tables in schema nunu from public, anon, authenticated;

grant select, insert, update, delete on nunu.profile       to authenticated;
grant select, delete                 on nunu.riot_account  to authenticated;
grant select                         on nunu.account_match to authenticated;
grant select                         on nunu.mastery       to authenticated;
grant select                         on nunu.member        to authenticated;
-- nunu.raw_match: medvetet inga rättigheter för appen

grant all on all tables in schema nunu to service_role;

alter table nunu.member        enable row level security;
alter table nunu.profile       enable row level security;
alter table nunu.riot_account  enable row level security;
alter table nunu.raw_match     enable row level security;
alter table nunu.account_match enable row level security;
alter table nunu.mastery       enable row level security;

drop policy if exists "egen medlemsrad"  on nunu.member;
drop policy if exists "egen profil"      on nunu.profile;
drop policy if exists "egna konton"      on nunu.riot_account;
drop policy if exists "egna konton bort" on nunu.riot_account;
drop policy if exists "egna matcher"     on nunu.account_match;
drop policy if exists "egen mastery"     on nunu.mastery;

-- Appen kan se om den inloggade är medlem (för att visa rätt vy)
create policy "egen medlemsrad" on nunu.member
  for select to authenticated using (user_id = auth.uid());

create policy "egen profil" on nunu.profile
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "egna konton" on nunu.riot_account
  for select to authenticated
  using (profile_id in (select id from nunu.profile where user_id = auth.uid()));

create policy "egna konton bort" on nunu.riot_account
  for delete to authenticated
  using (profile_id in (select id from nunu.profile where user_id = auth.uid()));

create policy "egna matcher" on nunu.account_match
  for select to authenticated
  using (puuid in (select puuid from nunu.riot_account));  -- riot_account filtreras redan till egna

create policy "egen mastery" on nunu.mastery
  for select to authenticated
  using (puuid in (select puuid from nunu.riot_account));
