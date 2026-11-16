-- Follow-up: explicit deny-all policies so admins / admin_actions have RLS policies
-- (the tables stay unreadable via the Data API; access is only through admin RPCs).
create policy admins_no_direct
  on public.admins
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy admin_actions_no_direct
  on public.admin_actions
  for all
  to anon, authenticated
  using (false)
  with check (false);
