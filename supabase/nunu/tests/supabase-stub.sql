-- Minimal efterbildning av Supabase för lokala tester (körs ALDRIG i Supabase).
-- Roller som i Supabase, och auth.uid()/auth.jwt() som läser JWT-claims.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;

-- Supabase Storage: bara tabellen som 003_timelines.sql skriver i
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false);
