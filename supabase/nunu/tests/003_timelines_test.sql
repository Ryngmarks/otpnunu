-- Tester för 003_timelines.sql. Körs av run.sh efter 001_rls_test.sql
-- (som skapar profiler, konton, matcher och hjälpfunktionerna i schemat t).

\set A '''{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}'''
\set B '''{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}'''
\set PA '''pa1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'''
\set PB '''pb1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'''

select t.eq((select count(*) from storage.buckets where id = 'timelines' and not public), 1, 'privat bucket för tidslinjer');

set role service_role;
update nunu.account_match set damage_at10 = 4000, team_share = 31.5, derived_version = 2 where match_id = 'EUW1_1';
insert into nunu.death (puuid, match_id, t_ms, killer_champion_id, helper_champion_ids, total, places, sources) values
  (:PA, 'EUW1_1', 210000, 64, '{}', 1200, '{camp}', '[{"name":"LeeSin","damage":900}]'),
  (:PA, 'EUW1_1', 720000, null, '{64,121}', 1500, '{torn}', '[]'),
  (:PB, 'EUW1_2', 300000, 20, '{}', 800, '{}', '[]');
select t.eq((select count(*) from nunu.death), 3, 'service_role skriver dödsfall');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :A, false);
select t.eq((select count(*) from nunu.death), 2, 'A ser bara sina dödsfall');
select t.eq((select damage_at10 from nunu.account_match where match_id = 'EUW1_1'), 4000, 'A ser skadan i sina matcher');
select t.denied($q$insert into nunu.death (puuid, match_id, t_ms) values ('x', 'EUW1_1', 1)$q$, 'A kan inte skriva dödsfall');
select t.denied($q$delete from nunu.death$q$, 'A kan inte ta bort dödsfall');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :B, false);
select t.eq((select count(*) from nunu.death), 1, 'B ser bara sitt dödsfall');
reset role;

set role anon;
select set_config('request.jwt.claims', '', false);
select t.denied('select * from nunu.death', 'anon kommer inte åt dödsfall');
reset role;

delete from nunu.account_match where puuid = :PA and match_id = 'EUW1_1';
select t.eq((select count(*) from nunu.death where puuid = :PA), 0, 'dödsfallen följer med när matchen tas bort');

\echo 'TIDSLINJETESTER GODKÄNDA'
