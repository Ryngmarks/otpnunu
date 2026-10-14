-- ============================================================
-- otpnunu – lokal databas (PostgreSQL 14 eller senare).
-- Körs av `npm run setup`. Går att köra flera gånger.
--
-- Rådata (Riots svar, oförändrade) ligger i raw_match och raw_timeline.
-- Allt annat räknas fram ur rådatan och kan räknas om (derived_version).
-- ============================================================

create schema if not exists nunu;

-- Riot-konton som synkas. PUUID är den stabila nyckeln (namn kan bytas).
create table if not exists nunu.riot_account (
  puuid          text primary key check (char_length(puuid) between 40 and 100),
  game_name      text not null,
  tag_line       text not null,
  platform       text not null default 'euw1' check (platform ~ '^[a-z0-9]{2,6}$'),
  region         text not null default 'europe' check (region in ('europe', 'americas', 'asia', 'sea')),
  linked_at      timestamptz not null default now(),
  last_synced_at timestamptz,
  backfill_done  boolean not null default false  -- hela historiken hämtad
);

-- Riots svar från match-v5, oförändrade. En rad per match även om flera konton var med.
create table if not exists nunu.raw_match (
  match_id   text primary key,
  region     text not null,
  game_start timestamptz,
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Riots tidslinje för matchen, oförändrad (~1 MB JSON; Postgres komprimerar den på disk).
create table if not exists nunu.raw_timeline (
  match_id   text primary key references nunu.raw_match (match_id) on delete cascade,
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Matchen ur ett kontos perspektiv (framräknat)
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
  damage               int not null default 0,   -- mot champions
  vision               int not null default 0,
  opponent_champion_id int,
  derived_version      int not null,
  primary key (puuid, match_id)
);
create index if not exists account_match_recent_idx on nunu.account_match (puuid, game_start desc);

-- Skada (version 2). Kolumnerna läggs till så att en äldre databas uppgraderas.
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
  puuid              text not null,
  match_id           text not null,
  t_ms               int not null,                -- tid i matchen
  killer_champion_id int,                         -- null = torn, minion eller monster
  helper_champion_ids int[] not null default '{}',
  total              int not null default 0,      -- skada du tog i dödsögonblicket
  places             text[] not null default '{}', -- camp, objective, torn, våg
  sources            jsonb not null default '[]', -- [{ name, damage }] störst först
  primary key (puuid, match_id, t_ms),
  foreign key (puuid, match_id) references nunu.account_match (puuid, match_id) on delete cascade
);

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

-- Äldre säsonger som Riot inte längre lämnar ut, förda in för hand (server/seasons.sql).
-- ended: synkade matcher före senaste slutdatum räknas inte i totalen (finns redan i säsongen).
create table if not exists nunu.season_history (
  season      text not null check (char_length(season) between 1 and 20),
  champion_id int  not null,                     -- 0 = övriga champions sammanslagna
  games       int  not null check (games > 0),
  wins        int  not null check (wins between 0 and games),
  kills       numeric(5, 1) not null default 0,  -- snitt per match
  deaths      numeric(5, 1) not null default 0,
  assists     numeric(5, 1) not null default 0,
  ended       date,
  source      text not null default 'manuell',
  primary key (season, champion_id)
);
