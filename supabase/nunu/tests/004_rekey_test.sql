-- Tester för 004_rekey.sql. Körs av run.sh efter 003_timelines_test.sql.

\set A '''{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}'''
\set PA '''pa1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'''
\set NY '''ny1-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'''

set role service_role;
insert into nunu.death (puuid, match_id, t_ms) values (:PA, 'EUW1_2', 5000);
update nunu.riot_account set puuid = :NY, previous_puuids = array[:PA] where puuid = :PA;
select t.eq((select count(*) from nunu.riot_account where puuid = :NY and previous_puuids = array[:PA]), 1, 'kontot har nytt PUUID och minns det gamla');
select t.eq((select count(*) from nunu.account_match where puuid = :NY), 1, 'matcherna följde med');
select t.eq((select count(*) from nunu.account_match where puuid = :PA), 0, 'inga matcher kvar på gamla PUUID');
select t.eq((select count(*) from nunu.mastery where puuid = :NY), 1, 'mastery följde med');
select t.eq((select count(*) from nunu.death where puuid = :NY), 1, 'dödsfallen följde med');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :A, false);
select t.eq((select count(*) from nunu.account_match), 1, 'A ser fortfarande sina matcher');
reset role;

\echo 'NYCKELBYTESTESTER GODKÄNDA'
