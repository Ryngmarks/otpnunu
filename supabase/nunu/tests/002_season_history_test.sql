-- Tester för 002_season_history.sql. Körs av run.sh efter 001_rls_test.sql
-- (som skapar profilerna och hjälpfunktionerna i schemat t).

\set A '''{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}'''
\set B '''{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}'''

select t.eq((select count(*) from nunu.season_history), 31, 'Johans säsonger är inlagda (en gång, trots två körningar)');
select t.eq((select sum(games) from nunu.season_history where champion_id = 20), 1827, 'Nunu: 1827 matcher före Riots historik');
select t.eq((select sum(wins) from nunu.season_history where champion_id = 20), 981, 'Nunu: 981 vinster före Riots historik');

set role authenticated;
select set_config('request.jwt.claims', :A, false);
select t.eq((select count(*) from nunu.season_history), 31, 'A ser sin historik');
select t.denied($q$insert into nunu.season_history (profile_id, season, champion_id, games, wins) values ('11111111-0000-0000-0000-000000000001', 'S2020', 20, 1, 1)$q$, 'A kan inte skriva historik');
select t.denied($q$update nunu.season_history set wins = games$q$, 'A kan inte ändra historik');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :B, false);
select t.eq((select count(*) from nunu.season_history), 0, 'B ser inte Johans historik');
reset role;

set role anon;
select set_config('request.jwt.claims', '', false);
select t.denied('select * from nunu.season_history', 'anon kommer inte åt historiken');
reset role;

\echo 'SÄSONGSTESTER GODKÄNDA'
