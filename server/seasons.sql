-- ============================================================
-- Äldre säsonger för Rymm3n#EUW (OP.GG). Körs av `npm run setup`.
-- S2021–S2024 S1: fliken "All", S2024 S2–S2025: "Ranked".
-- champion_id 0 = övriga champions sammanslagna.
-- Ändra här och kör `npm run setup` igen – raderna skrivs över.
-- season, champion_id, matcher, vinster, kills, deaths, assists (snitt), slutdatum
-- ============================================================
insert into nunu.season_history (season, champion_id, games, wins, kills, deaths, assists, ended, source)
select v.season, v.champion_id, v.games, v.wins, v.kills, v.deaths, v.assists, v.ended::date, 'op.gg'
from (values
  -- S2021 (Zac och fler längre ner i listan saknas)
  ('S2021',     20, 300, 170,  7.3, 4.6, 11.6, null),  -- Nunu & Willump
  ('S2021',     19,  21,   8,  8.6, 5.5,  8.4, null),  -- Warwick
  ('S2021',     56,  14,   7,  5.4, 4.7,  8.4, null),  -- Nocturne
  ('S2021',    141,  14,   4,  5.5, 5.6,  5.4, null),  -- Kayn
  ('S2021',    120,  12,   6,  5.7, 5.8,  9.6, null),  -- Hecarim
  ('S2021',     78,  11,   3,  6.6, 6.5,  9.9, null),  -- Poppy
  ('S2021',    163,   3,   2,  3.7, 8.0, 13.7, null),  -- Taliyah
  ('S2021',    245,   3,   1,  6.7, 6.0,  6.3, null),  -- Ekko
  -- S2022 (Diana och fler längre ner i listan saknas)
  ('S2022',     20, 833, 451,  9.0, 5.3, 12.3, null),
  ('S2022',     35,  47,  19,  9.0, 5.9,  7.4, null),  -- Shaco
  ('S2022',     48,  18,   9,  6.8, 5.7, 10.8, null),  -- Trundle
  ('S2022',     19,   8,   4,  7.1, 7.4,  6.8, null),
  ('S2022',     56,   5,   3,  5.8, 6.6, 10.4, null),
  ('S2022',    876,   3,   1,  5.3, 6.3, 10.3, null),  -- Lillia
  ('S2022',     78,   3,   0,  5.0, 7.0,  4.3, null),
  ('S2022',    120,   2,   1,  2.0, 4.5, 10.5, null),
  -- S2023 S1
  ('S2023 S1',  20, 278, 136,  7.3, 5.4, 10.9, null),
  ('S2023 S1',  48,  10,   4,  6.4, 6.6,  8.4, null),
  ('S2023 S1',  56,   5,   3,  4.8, 4.2,  6.4, null),
  ('S2023 S1',  59,   1,   0,  5.0, 7.0,  9.0, null),  -- Jarvan IV
  -- S2023 S2
  ('S2023 S2',  20, 205, 106,  8.1, 5.0, 12.3, null),
  ('S2023 S2',  19,  16,   6,  8.7, 6.4, 10.0, null),
  ('S2023 S2', 154,   3,   2,  6.3, 4.3, 14.0, null),  -- Zac
  ('S2023 S2', 120,   3,   1,  3.3, 5.7,  9.0, null),
  ('S2023 S2',  35,   3,   0,  7.3, 8.3,  7.3, null),
  ('S2023 S2',  48,   1,   0,  4.0, 7.0, 13.0, null),
  -- S2024 S1
  ('S2024 S1',  20, 211, 118, 10.3, 5.3, 12.8, null),
  ('S2024 S1',  35,   3,   2,  8.7, 3.7,  8.7, null),
  ('S2024 S1',  56,   1,   0,  8.0, 9.0,  6.0, null),
  ('S2024 S1',  59,   1,   0,  4.0, 7.0,  8.0, null),
  ('S2024 S1',  48,   1,   0,  5.0,13.0, 16.0, null),
  -- S2024 S2 (Ranked, bara Nunu)
  ('S2024 S2',  20,  99,  54,  9.8, 5.1, 11.2, null),
  -- S2024 S3 (Ranked)
  ('S2024 S3',  20, 131,  75,  9.8, 5.7, 14.4, null),
  ('S2024 S3',   0,  20,   6,  9.0, 5.7,  8.4, null),  -- övriga, uträknat ur "All champions"
  -- S2025 (Ranked). Slutade ungefär 2026-01-08 – synkade matcher före dess finns redan här.
  ('S2025',     20, 235, 122,  7.3, 5.5, 12.6, '2026-01-08'),
  ('S2025',      0,   6,   3,  7.3, 5.5, 12.6, '2026-01-08')
) as v (season, champion_id, games, wins, kills, deaths, assists, ended)
on conflict (season, champion_id) do update
  set games = excluded.games, wins = excluded.wins, kills = excluded.kills, deaths = excluded.deaths,
      assists = excluded.assists, ended = excluded.ended, source = excluded.source;
