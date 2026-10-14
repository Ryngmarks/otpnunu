-- ============================================================
-- Nunu – byte av Riot-nyckel.
--
-- Riot krypterar PUUID olika för varje nyckel (projekt). Med en ny nyckel får samma
-- konto ett nytt PUUID. Synken byter då PUUID på kontot; det här gör att matcher,
-- mastery och dödsfall följer med, och sparar det gamla PUUID (det finns kvar i äldre rådata).
--
-- Kör i Supabase: SQL Editor → New query → klistra in → Run.
-- Kräver 001 och 003. Går att köra flera gånger.
-- ============================================================

alter table nunu.riot_account
  add column if not exists previous_puuids text[] not null default '{}';

-- Främmande nycklar mot konton och matcher följer med när PUUID byts (on update cascade)
do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where contype = 'f'
      and connamespace = 'nunu'::regnamespace
      and confrelid in ('nunu.riot_account'::regclass, 'nunu.account_match'::regclass)
      and confupdtype <> 'c'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s on update cascade', r.tbl, r.conname, r.def);
  end loop;
end $$;
