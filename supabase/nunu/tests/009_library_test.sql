-- Tester för 009_library.sql. Körs av run.sh efter 008_scout_test.sql.

\set A '''{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}'''
\set B '''{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}'''
\set PRA '''11111111-0000-0000-0000-000000000001'''

set role authenticated;
select set_config('request.jwt.claims', :A, false);
insert into nunu.champion_opinion (profile_id, champion_id, side, opinion, note, strategy) values
  (:PRA, 412, 'with', 1, 'Bra engage', 'Gå bot efter första clear'),
  (:PRA, 412, 'against', -1, 'Hook', 'Ward sidobuskarna');
select t.eq((select count(*) from nunu.champion_opinion where champion_id = 412), 2, 'samma champion: egen rad som lagkamrat och motståndare');
select t.eq((select count(*) from nunu.champion_opinion where champion_id = 412 and strategy <> ''), 2, 'A sparar strategi');
select t.rejected($q$update nunu.champion_opinion set strategy = repeat('x', 2001) where champion_id = 412$q$, 'för lång strategi nekas');
select t.eq((select count(*) from nunu.champion_opinion where champion_id = 121 and strategy = ''), 1, 'äldre rader får tom strategi');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :B, false);
update nunu.champion_opinion set strategy = 'hack';
reset role;
set role service_role;
select t.eq((select count(*) from nunu.champion_opinion where strategy = 'hack'), 0, 'B kan inte ändra A:s strategi');
reset role;

\echo 'BIBLIOTEKSTESTER GODKÄNDA'
