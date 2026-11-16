-- v17 legal acceptances: terms version + media consent, own-row RLS.
-- One row per auth user. No service-role access is required from the client.

create table if not exists public.legal_acceptances (
  user_id uuid primary key references auth.users (id) on delete cascade,
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  media_consent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint legal_acceptances_version_len check (char_length(terms_version) between 1 and 40)
);

comment on table public.legal_acceptances is
  'Per-user acceptance of the current terms/privacy version, and optional media-rights consent. Readable and writable only by the owning user.';

alter table public.legal_acceptances enable row level security;

drop policy if exists legal_acceptances_select_own on public.legal_acceptances;
create policy legal_acceptances_select_own
  on public.legal_acceptances
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists legal_acceptances_insert_own on public.legal_acceptances;
create policy legal_acceptances_insert_own
  on public.legal_acceptances
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists legal_acceptances_update_own on public.legal_acceptances;
create policy legal_acceptances_update_own
  on public.legal_acceptances
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.legal_acceptances from public, anon;
grant select, insert, update on table public.legal_acceptances to authenticated;

create or replace function private.touch_legal_acceptances()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.user_id := old.user_id;
  return new;
end;
$$;

drop trigger if exists legal_acceptances_touch on public.legal_acceptances;
create trigger legal_acceptances_touch
  before update on public.legal_acceptances
  for each row
  execute function private.touch_legal_acceptances();

revoke all on function private.touch_legal_acceptances() from public, anon, authenticated;
