-- Tester för 008_scout.sql. Körs av run.sh efter 007_rank_test.sql.

\set A '''{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}'''
\set B '''{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}'''
\set PRA '''11111111-0000-0000-0000-000000000001'''
\set PRB '''22222222-0000-0000-0000-000000000002'''

create or replace function t.rejected(stmt text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL %: tilläts', label;
exception when check_violation then
  raise notice 'PASS %', label;
end $$;
grant execute on function t.rejected(text, text) to public;

set role authenticated;
select set_config('request.jwt.claims', :A, false);
insert into nunu.champion_opinion (profile_id, champion_id, side, opinion, note) values
  (:PRA, 121, 'against', -1, 'Kha''Zix invaderar – spela säkert'),
  (:PRA, 412, 'with', 1, '');
select t.eq((select count(*) from nunu.champion_opinion), 2, 'A sparar egna bedömningar');
insert into nunu.champion_opinion (profile_id, champion_id, side, opinion) values (:PRA, 121, 'against', 1)
  on conflict (profile_id, champion_id, side) do update set opinion = excluded.opinion, updated_at = now();
select t.eq((select opinion::int from nunu.champion_opinion where champion_id = 121), 1, 'A ändrar sin bedömning');
select t.denied($q$insert into nunu.champion_opinion (profile_id, champion_id, side, opinion) values ('22222222-0000-0000-0000-000000000002', 1, 'with', 1)$q$, 'A kan inte skriva åt B');
select t.rejected($q$insert into nunu.champion_opinion (profile_id, champion_id, side, opinion) values ('11111111-0000-0000-0000-000000000001', 1, 'mot', 1)$q$, 'ogiltig sida nekas');
select t.rejected($q$insert into nunu.champion_opinion (profile_id, champion_id, side, opinion) values ('11111111-0000-0000-0000-000000000001', 1, 'with', 2)$q$, 'ogiltig bedömning nekas');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :B, false);
select t.eq((select count(*) from nunu.champion_opinion), 0, 'B ser inte A:s bedömningar');
delete from nunu.champion_opinion;
reset role;

set role service_role;
select t.eq((select count(*) from nunu.champion_opinion), 2, 'B kan inte ta bort A:s bedömningar');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :A, false);
delete from nunu.champion_opinion where champion_id = 412;
select t.eq((select count(*) from nunu.champion_opinion), 1, 'A tar bort sin bedömning');
reset role;

\echo 'SCOUTTESTER GODKÄNDA'
