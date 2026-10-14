-- Tester för 001_init.sql: vem ser och får ändra vad.
-- Körs av run.sh mot en tom testdatabas. Avbryter vid första FAIL.

-- Hjälpfunktioner
create schema t;
grant usage on schema t to public;
create function t.eq(actual bigint, expected bigint, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: fick %, väntade %', label, actual, expected;
  end if;
  raise notice 'PASS %', label;
end $$;
create function t.denied(stmt text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL %: tilläts', label;
exception when insufficient_privilege then
  raise notice 'PASS %', label;
end $$;
grant execute on all functions in schema t to public;

\set A '''{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}'''
\set B '''{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}'''
\set PA '''pa1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'''
\set PA2 '''pa2-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'''
\set PB '''pb1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'''

-- Testdata (som Edge Function skulle skriva den, med service_role)
set role service_role;
insert into nunu.profile (id, user_id, display_name) values
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Johan'),
  ('22222222-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'Anna');
insert into nunu.riot_account (puuid, profile_id, game_name, tag_line) values
  (:PA,  '11111111-0000-0000-0000-000000000001', 'Rymm3n', 'EUW'),
  (:PA2, '11111111-0000-0000-0000-000000000001', 'Smurf', 'EUW'),
  (:PB,  '22222222-0000-0000-0000-000000000002', 'Anna', 'EUW');
insert into nunu.raw_match (match_id, region, payload) values
  ('EUW1_1', 'europe', '{"metadata":{}}'), ('EUW1_2', 'europe', '{"metadata":{}}'), ('EUW1_3', 'europe', '{"metadata":{}}');
-- EUW1_2 spelade både Johan och Anna – rådatan finns en gång
insert into nunu.account_match (puuid, match_id, game_start, queue_id, duration_s, champion_id, win, derived_version) values
  (:PA,  'EUW1_1', now(), 420, 1800, 20, true, 1),
  (:PA,  'EUW1_2', now(), 420, 1800, 20, false, 1),
  (:PA2, 'EUW1_3', now(), 440, 1700, 20, true, 1),
  (:PB,  'EUW1_2', now(), 420, 1800, 64, true, 1);
insert into nunu.mastery (puuid, champion_id, level, points, payload) values
  (:PA, 20, 178, 1930343, '{}'), (:PB, 64, 10, 100000, '{}');
select t.eq((select count(*) from nunu.raw_match), 3, 'service_role skriver och läser rådata');
reset role;

-- ---------- Användare A (medlem, två konton) ----------
set role authenticated;
select set_config('request.jwt.claims', :A, false);
select t.eq((select count(*) from nunu.profile), 1, 'A ser bara sin profil');
select t.eq((select count(*) from nunu.riot_account), 2, 'A ser sina två konton');
select t.eq((select count(*) from nunu.account_match), 3, 'A ser matcher från båda sina konton');
select t.eq((select count(*) from nunu.mastery), 1, 'A ser bara sin mastery');
select t.eq((select count(*) from nunu.member), 1, 'A ser att hen är medlem');
select t.denied('select * from nunu.raw_match', 'A kan inte läsa rådata');
select t.denied($q$insert into nunu.raw_match (match_id, region, payload) values ('X', 'europe', '{}')$q$, 'A kan inte skriva rådata');
select t.denied($q$insert into nunu.riot_account (puuid, profile_id, game_name, tag_line) values (repeat('z', 50), '11111111-0000-0000-0000-000000000001', 'x', 'y')$q$, 'A kan inte koppla konton direkt');
select t.denied($q$update nunu.account_match set win = true$q$, 'A kan inte ändra matcher');
select t.denied($q$insert into nunu.account_match (puuid, match_id, game_start, queue_id, duration_s, champion_id, win, derived_version) values ('x', 'EUW1_1', now(), 420, 1, 1, true, 1)$q$, 'A kan inte skapa matcher');
select t.denied($q$insert into nunu.member (user_id) values ('bbbbbbbb-0000-0000-0000-000000000002')$q$, 'A kan inte göra andra till medlemmar');
select t.denied($q$insert into nunu.profile (user_id) values ('bbbbbbbb-0000-0000-0000-000000000002')$q$, 'A kan inte skapa profil åt någon annan');
update nunu.profile set display_name = 'Rymm3n';
select t.eq((select count(*) from nunu.profile where display_name = 'Rymm3n'), 1, 'A kan byta namn på sin profil');
with d as (delete from nunu.riot_account where game_name = 'Anna' returning 1)
select t.eq((select count(*) from d), 0, 'A kan inte ta bort Annas konto');
reset role;

-- ---------- Användare B (inte medlem) ----------
set role authenticated;
select set_config('request.jwt.claims', :B, false);
select t.eq((select count(*) from nunu.riot_account), 1, 'B ser bara sitt konto');
select t.eq((select count(*) from nunu.account_match), 1, 'B ser bara sin match (även om den är delad med A)');
select t.eq((select count(*) from nunu.member), 0, 'B är inte medlem');
reset role;

-- ---------- Ej inloggad ----------
set role anon;
select set_config('request.jwt.claims', '', false);
select t.denied('select * from nunu.profile', 'anon kommer inte åt nunu');
select t.denied('select * from nunu.account_match', 'anon kommer inte åt matcher');
reset role;

-- ---------- Koppla bort ett konto ----------
set role authenticated;
select set_config('request.jwt.claims', :A, false);
delete from nunu.riot_account where game_name = 'Smurf';
select t.eq((select count(*) from nunu.account_match), 2, 'bortkopplat konto tar med sig sina matcher');
reset role;
select t.eq((select count(*) from nunu.raw_match), 3, 'rådatan finns kvar efter bortkoppling');

-- ---------- Fotbollen orörd ----------
select t.eq((select count(*) from information_schema.tables where table_schema = 'public'
             and table_name in ('players', 'training_sessions', 'results', 'tactics', 'tactics_access')), 5,
            'fotbollens tabeller finns kvar i public');
select t.eq((select count(*) from public.players), 2, 'fotbollens data orörd');

\echo 'ALLA SQL-TESTER GODKÄNDA'
