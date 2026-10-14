-- ============================================================
-- Tar bort den gamla fotbollsappen och taktiktavlan ur Supabase.
--
-- Rör INTE schemat nunu eller kontot johan@ryngmarks.com.
--
-- Gör så här i SQL Editor:
--   0. Säkerhetskopiera datan om du vill spara den (se docs/nunu-plan.md).
--   1. Kör DEL 1 – tabeller och funktioner tas bort.
--   2. Kör DEL 2 – listar kontona som skulle raderas. Läs listan.
--   3. Kör DEL 3 – raderar dem. Den är bortkommenterad: ta bort "-- "
--      framför raderna först, så att den inte körs av misstag.
-- Allt i DEL 1 och DEL 3 är permanent.
-- ============================================================

-- ---------- DEL 1: fotbollens och taktiktavlans tabeller och funktioner ----------
drop table if exists public.results           cascade;
drop table if exists public.training_sessions cascade;
drop table if exists public.players           cascade;
drop table if exists public.tactics           cascade;
drop table if exists public.tactics_access    cascade;
drop function if exists public.has_tactics_access();
drop function if exists public.tactics_touch();

-- ---------- DEL 2: vilka konton skulle raderas? ----------
select email, created_at, last_sign_in_at
from auth.users
where lower(email) <> 'johan@ryngmarks.com'
order by created_at;

-- ---------- DEL 3: radera dem (bara om listan i DEL 2 stämmer) ----------
-- Raderar ingenting om johan@ryngmarks.com inte finns – skydd mot att låsa ute sig själv.
-- delete from auth.users
-- where lower(email) <> 'johan@ryngmarks.com'
--   and exists (select 1 from auth.users where lower(email) = 'johan@ryngmarks.com');
