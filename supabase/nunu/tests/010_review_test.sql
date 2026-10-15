-- Tester för 010_review.sql. Körs av run.sh efter 009_library_test.sql.
\set A '''{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}'''

set role service_role;
update nunu.account_match set ally_positions = '{UTILITY}', enemy_positions = '{JUNGLE}',
  loadout = '{"items":[3020]}', objectives_team = '{"mine":{"dragon":3}}', review = '{"minutes":[]}'
  ;
select t.eq((select count(*) from nunu.account_match where review is null), 0, 'synken kan skriva de nya kolumnerna');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :A, false);
select t.eq((select count(*) from nunu.account_match where ally_positions <> '{UTILITY}'), 0, 'A läser sina positioner');
select t.denied($q$update nunu.account_match set review = '{}'$q$, 'A kan inte ändra matchgenomgången');
reset role;

\echo 'GENOMGÅNGSTESTER GODKÄNDA'
