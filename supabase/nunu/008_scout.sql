-- ============================================================
-- Nunu Live Scout – din egen bedömning per champion.
--
-- Kör i Supabase: SQL Editor → New query → klistra in → Run.
-- Kräver 001. Går att köra flera gånger.
--
-- Statistiken (vinst/förlust med och mot varje champion) räknas fram i appen ur matcherna som
-- redan finns. Här sparas bara det som inte går att räkna fram: vad du själv tycker.
--   side:    'with' (lagkamrat) eller 'against' (motståndare)
--   opinion: 1 = positiv, -1 = negativ, null = ingen bedömning (bara anteckning)
-- ============================================================

create table if not exists nunu.champion_opinion (
  profile_id  uuid not null references nunu.profile (id) on delete cascade,
  champion_id int  not null check (champion_id > 0),
  side        text not null check (side in ('with', 'against')),
  opinion     smallint check (opinion in (-1, 1)),
  note        text not null default '' check (char_length(note) <= 500),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, champion_id, side)
);

revoke all on nunu.champion_opinion from public, anon, authenticated;
grant select, insert, update, delete on nunu.champion_opinion to authenticated;
grant all on nunu.champion_opinion to service_role;
alter table nunu.champion_opinion enable row level security;
drop policy if exists "egen bedömning" on nunu.champion_opinion;
create policy "egen bedömning" on nunu.champion_opinion
  for all to authenticated
  using (profile_id in (select id from nunu.profile where user_id = auth.uid()))
  with check (profile_id in (select id from nunu.profile where user_id = auth.uid()));
