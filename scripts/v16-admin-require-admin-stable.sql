-- require_admin must stay read-only (STABLE) because admin_list_users / admin_stats /
-- admin_get_card / admin_list_actions are STABLE and cannot perform UPDATEs.
-- user_id backfill happens in account_flags on sign-in; is_admin also matches by email.

create or replace function private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if not private.is_admin(uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return uid;
end;
$$;
