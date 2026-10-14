-- ============================================================
-- Nunu – äldre säsonger som Riot inte längre lämnar ut.
--
-- Riot sparar bara matcher ungefär två år bakåt. Äldre säsonger förs in
-- för hand som sammanfattningar: per säsong och champion, antal matcher,
-- vinster och snitt-K/D/A (t.ex. avskrivna från OP.GG).
--
-- Kör i Supabase: SQL Editor → New query → klistra in → Run.
-- Kräver 001_init.sql och att du har loggat in i appen en gång (profilen finns).
-- Går att köra flera gånger: siffrorna nedan skriver över de gamla.
-- ============================================================

create table if not exists nunu.season_history (
  profile_id  uuid not null references nunu.profile (id) on delete cascade,
  season      text not null check (char_length(season) between 1 and 20),
  champion_id int  not null,
  games       int  not null check (games > 0),
  wins        int  not null check (wins between 0 and games),
  kills       numeric(5, 1) not null default 0,  -- snitt per match
  deaths      numeric(5, 1) not null default 0,
  assists     numeric(5, 1) not null default 0,
  source      text not null default 'manuell',
  primary key (profile_id, season, champion_id)
);

revoke all on nunu.season_history from public, anon, authenticated;
grant select on nunu.season_history to authenticated;
grant all on nunu.season_history to service_role;

alter table nunu.season_history enable row level security;
drop policy if exists "egen historik" on nunu.season_history;
create policy "egen historik" on nunu.season_history
  for select to authenticated
  using (profile_id in (select id from nunu.profile where user_id = auth.uid()));

-- ------------------------------------------------------------
-- Johans säsonger (OP.GG, fliken "All").
-- season, champion_id, matcher, vinster, kills, deaths, assists
-- ------------------------------------------------------------
insert into nunu.season_history (profile_id, season, champion_id, games, wins, kills, deaths, assists, source)
select p.id, v.season, v.champion_id, v.games, v.wins, v.kills, v.deaths, v.assists, 'op.gg'
from nunu.profile p
join auth.users u on u.id = p.user_id and lower(u.email) = 'johan@ryngmarks.com'
cross join (values
  -- S2021 (Zac och fler längre ner i listan saknas)
  ('S2021',     20, 300, 170,  7.3, 4.6, 11.6),  -- Nunu & Willump
  ('S2021',     19,  21,   8,  8.6, 5.5,  8.4),  -- Warwick
  ('S2021',     56,  14,   7,  5.4, 4.7,  8.4),  -- Nocturne
  ('S2021',    141,  14,   4,  5.5, 5.6,  5.4),  -- Kayn
  ('S2021',    120,  12,   6,  5.7, 5.8,  9.6),  -- Hecarim
  ('S2021',     78,  11,   3,  6.6, 6.5,  9.9),  -- Poppy
  ('S2021',    163,   3,   2,  3.7, 8.0, 13.7),  -- Taliyah
  ('S2021',    245,   3,   1,  6.7, 6.0,  6.3),  -- Ekko
  -- S2022 (Diana och fler längre ner i listan saknas)
  ('S2022',     20, 833, 451,  9.0, 5.3, 12.3),
  ('S2022',     35,  47,  19,  9.0, 5.9,  7.4),  -- Shaco
  ('S2022',     48,  18,   9,  6.8, 5.7, 10.8),  -- Trundle
  ('S2022',     19,   8,   4,  7.1, 7.4,  6.8),
  ('S2022',     56,   5,   3,  5.8, 6.6, 10.4),
  ('S2022',    876,   3,   1,  5.3, 6.3, 10.3),  -- Lillia
  ('S2022',     78,   3,   0,  5.0, 7.0,  4.3),
  ('S2022',    120,   2,   1,  2.0, 4.5, 10.5),
  -- S2023 S1
  ('S2023 S1',  20, 278, 136,  7.3, 5.4, 10.9),
  ('S2023 S1',  48,  10,   4,  6.4, 6.6,  8.4),
  ('S2023 S1',  56,   5,   3,  4.8, 4.2,  6.4),
  ('S2023 S1',  59,   1,   0,  5.0, 7.0,  9.0),  -- Jarvan IV
  -- S2023 S2
  ('S2023 S2',  20, 205, 106,  8.1, 5.0, 12.3),
  ('S2023 S2',  19,  16,   6,  8.7, 6.4, 10.0),
  ('S2023 S2', 154,   3,   2,  6.3, 4.3, 14.0),  -- Zac
  ('S2023 S2', 120,   3,   1,  3.3, 5.7,  9.0),
  ('S2023 S2',  35,   3,   0,  7.3, 8.3,  7.3),
  ('S2023 S2',  48,   1,   0,  4.0, 7.0, 13.0),
  -- S2024 S1
  ('S2024 S1',  20, 211, 118, 10.3, 5.3, 12.8),
  ('S2024 S1',  35,   3,   2,  8.7, 3.7,  8.7),
  ('S2024 S1',  56,   1,   0,  8.0, 9.0,  6.0),
  ('S2024 S1',  59,   1,   0,  4.0, 7.0,  8.0),
  ('S2024 S1',  48,   1,   0,  5.0,13.0, 16.0)
) as v (season, champion_id, games, wins, kills, deaths, assists)
on conflict (profile_id, season, champion_id) do update
  set games = excluded.games, wins = excluded.wins, kills = excluded.kills,
      deaths = excluded.deaths, assists = excluded.assists, source = excluded.source;
