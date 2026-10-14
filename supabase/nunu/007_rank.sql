-- ============================================================
-- Nunu – rank-historik (elo) per konto och kö.
--
-- Kör i Supabase: SQL Editor → New query → klistra in → Run.
-- Kräver 001 och 004. Går att köra flera gånger.
--
-- Riot har ingen rank-historik i sitt API. Synken (även den automatiska varje timme)
-- sparar en rad här när ranken ändrats – grafen börjar alltså från första synken.
-- ============================================================

create table if not exists nunu.rank_snapshot (
  puuid    text not null references nunu.riot_account (puuid) on delete cascade on update cascade,
  queue    text not null check (queue in ('RANKED_SOLO_5x5', 'RANKED_FLEX_SR')),
  tier     text not null,          -- IRON … CHALLENGER
  division text,                   -- I–IV, null för Master och uppåt
  lp       int  not null default 0,
  wins     int  not null default 0,
  losses   int  not null default 0,
  taken_at timestamptz not null default now(),
  primary key (puuid, queue, taken_at)
);
create index if not exists rank_snapshot_recent_idx on nunu.rank_snapshot (puuid, queue, taken_at desc);

revoke all on nunu.rank_snapshot from public, anon, authenticated;
grant select on nunu.rank_snapshot to authenticated;
grant all on nunu.rank_snapshot to service_role;
alter table nunu.rank_snapshot enable row level security;
drop policy if exists "egen rank" on nunu.rank_snapshot;
create policy "egen rank" on nunu.rank_snapshot
  for select to authenticated
  using (puuid in (select puuid from nunu.riot_account));  -- riot_account filtreras redan till egna
