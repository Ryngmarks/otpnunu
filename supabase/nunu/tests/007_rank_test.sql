-- Tester för 007_rank.sql. Körs av run.sh efter 004_rekey_test.sql (kontot PA heter då NY).

\set A '''{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}'''
\set B '''{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}'''
\set NY '''ny1-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'''
\set PB '''pb1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'''
\set NY2 '''ny2-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'''

set role service_role;
insert into nunu.rank_snapshot (puuid, queue, tier, division, lp, wins, losses, taken_at) values
  (:NY, 'RANKED_SOLO_5x5', 'EMERALD', 'II', 45, 120, 101, now() - interval '1 day'),
  (:NY, 'RANKED_SOLO_5x5', 'EMERALD', 'I', 10, 122, 101, now()),
  (:PB, 'RANKED_FLEX_SR', 'GOLD', 'III', 20, 5, 5, now());
select t.eq((select count(*) from nunu.rank_snapshot), 3, 'service_role skriver rank');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :A, false);
select t.eq((select count(*) from nunu.rank_snapshot), 2, 'A ser bara sin rank');
select t.denied($q$insert into nunu.rank_snapshot (puuid, queue, tier) values ('x', 'RANKED_SOLO_5x5', 'IRON')$q$, 'A kan inte skriva rank');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :B, false);
select t.eq((select count(*) from nunu.rank_snapshot), 1, 'B ser bara sin rank');
reset role;

set role service_role;
update nunu.riot_account set puuid = :NY2 where puuid = :NY;
select t.eq((select count(*) from nunu.rank_snapshot where puuid = :NY2), 2, 'rank följer med vid nytt PUUID');
reset role;

\echo 'RANKTESTER GODKÄNDA'
