-- is_admin was STABLE but performed an UPDATE via sync_admin_user_ids(),
-- which PostgreSQL rejects. Keep is_admin read-only; sync in volatile callers.

create or replace function private.is_admin(p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  if p_uid is null then
    return false;
  end if;
  select exists (
    select 1
    from public.admins a
    where a.user_id = p_uid
       or (
         a.email is not null
         and lower(a.email) = lower((
           select u.email from auth.users u where u.id = p_uid
         ))
       )
  ) into ok;
  return coalesce(ok, false);
end;
$$;

create or replace function private.require_admin()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  perform private.sync_admin_user_ids();
  if not private.is_admin(uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return uid;
end;
$$;

create or replace function public.account_flags()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  banned timestamptz;
begin
  if uid is null then
    return jsonb_build_object('signed_in', false, 'is_admin', false, 'disabled', false);
  end if;
  perform private.sync_admin_user_ids();
  select u.banned_until into banned from auth.users u where u.id = uid;
  return jsonb_build_object(
    'signed_in', true,
    'is_admin', private.is_admin(uid),
    'disabled', banned is not null and banned > now()
  );
end;
$$;
