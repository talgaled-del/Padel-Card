-- v16 admin console: allowlist, privileged RPCs, public disabled-card ids, audit log.

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists public.admins (
  email text primary key,
  user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint admins_email_format check (email = lower(email) and position('@' in email) > 1)
);

comment on table public.admins is 'Server-side admin allowlist. Privileged RPCs check this table; it is not readable via the Data API.';

create table if not exists public.disabled_cards (
  card_id text primary key,
  created_at timestamptz not null default now()
);

comment on table public.disabled_cards is 'Share-link card ids that should be hidden. Contains no PII. Readable by anyone; writable only by admin RPCs.';

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users (id) on delete set null,
  admin_email text,
  action text not null,
  target_user_id uuid,
  target_email text,
  created_at timestamptz not null default now(),
  meta jsonb
);

comment on table public.admin_actions is 'Audit log for admin disable, enable, and delete actions.';

create index if not exists admin_actions_created_at_idx on public.admin_actions (created_at desc);

alter table public.admins enable row level security;
alter table public.disabled_cards enable row level security;
alter table public.admin_actions enable row level security;

drop policy if exists disabled_cards_select on public.disabled_cards;
create policy disabled_cards_select
  on public.disabled_cards
  for select
  to anon, authenticated
  using (true);

grant select on table public.disabled_cards to anon, authenticated;
revoke insert, update, delete on table public.disabled_cards from anon, authenticated;
revoke all on table public.admins from anon, authenticated;
revoke all on table public.admin_actions from anon, authenticated;

insert into public.admins (email)
values ('talgaled@gmail.com')
on conflict (email) do nothing;

update public.admins a
set user_id = u.id
from auth.users u
where a.user_id is null
  and u.email is not null
  and lower(u.email) = a.email;

create or replace function private.sync_admin_user_ids()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.admins a
  set user_id = u.id
  from auth.users u
  where a.user_id is null
    and u.email is not null
    and lower(u.email) = a.email;
$$;

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

create or replace function private.card_id_of(p_card jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(coalesce(p_card #>> '{profile,id}', p_card ->> 'id'), '');
$$;

create or replace function private.revoke_sessions(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.sessions where user_id = p_uid;
  delete from auth.refresh_tokens where user_id = p_uid::text;
end;
$$;

create or replace function private.log_admin_action(
  p_action text,
  p_target uuid,
  p_target_email text,
  p_meta jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  admin_email text;
begin
  select u.email into admin_email from auth.users u where u.id = uid;
  insert into public.admin_actions (admin_id, admin_email, action, target_user_id, target_email, meta)
  values (uid, admin_email, p_action, p_target, p_target_email, p_meta);
end;
$$;

create or replace function private.user_email(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email from auth.users u where u.id = p_uid;
$$;

create or replace function private.is_listed_admin(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin(p_uid);
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

create or replace function public.is_card_unavailable(p_card_id text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.disabled_cards d
    where d.card_id = p_card_id
      and p_card_id is not null
      and length(p_card_id) > 0
  );
$$;

create or replace function public.admin_list_users(
  p_search text default '',
  p_sort text default 'created_at_desc'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := lower(trim(coalesce(p_search, '')));
  sort_key text := coalesce(nullif(p_sort, ''), 'created_at_desc');
  result jsonb;
begin
  perform private.require_admin();

  with rows as (
    select
      u.id,
      u.email,
      coalesce(nullif(u.raw_app_meta_data->>'provider', ''), 'email') as provider,
      u.created_at,
      u.last_sign_in_at,
      (u.banned_until is not null and u.banned_until > now()) as disabled,
      (c.user_id is not null) as has_card,
      c.card #>> '{profile,name}' as name,
      private.card_id_of(c.card) as card_id,
      c.card->>'levelId' as level,
      c.card #>> '{profile,region}' as region
    from auth.users u
    left join public.cards c on c.user_id = u.id
    where u.deleted_at is null
      and (
        q = ''
        or lower(coalesce(u.email, '')) like '%' || q || '%'
        or lower(coalesce(c.card #>> '{profile,name}', '')) like '%' || q || '%'
        or lower(coalesce(c.card->>'levelId', '')) like '%' || q || '%'
        or lower(coalesce(c.card #>> '{profile,region}', '')) like '%' || q || '%'
      )
  ),
  sorted as (
    select
      r.*,
      row_number() over (
        order by
          case when sort_key = 'created_at_asc' then extract(epoch from r.created_at) end asc nulls last,
          case when sort_key = 'created_at_desc' then extract(epoch from r.created_at) end desc nulls last,
          case when sort_key = 'last_sign_in_desc' then extract(epoch from r.last_sign_in_at) end desc nulls last,
          case when sort_key = 'name_asc' then lower(coalesce(r.name, '')) end asc nulls last,
          case when sort_key = 'email_asc' then lower(coalesce(r.email, '')) end asc nulls last,
          case when sort_key = 'level_asc' then coalesce(r.level, '') end asc nulls last,
          r.created_at desc
      ) as ord
    from rows r
  )
  select jsonb_build_object(
    'total', (select count(*)::int from sorted),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'email', s.email,
        'provider', s.provider,
        'name', s.name,
        'created_at', s.created_at,
        'last_sign_in_at', s.last_sign_in_at,
        'has_card', s.has_card,
        'card_id', s.card_id,
        'level', s.level,
        'region', s.region,
        'status', case when s.disabled then 'disabled' else 'active' end
      ) order by s.ord)
      from sorted s
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_admin();

  select jsonb_build_object(
    'total_users', (select count(*)::int from auth.users u where u.deleted_at is null),
    'total_cards', (select count(*)::int from public.cards),
    'new_this_week', (
      select count(*)::int from auth.users u
      where u.deleted_at is null and u.created_at >= now() - interval '7 days'
    ),
    'active_last_7d', (
      select count(*)::int from auth.users u
      where u.deleted_at is null and u.last_sign_in_at >= now() - interval '7 days'
    ),
    'disabled_users', (
      select count(*)::int from auth.users u
      where u.deleted_at is null and u.banned_until is not null and u.banned_until > now()
    ),
    'by_level', coalesce((
      select jsonb_agg(jsonb_build_object('level', level, 'count', n) order by level)
      from (
        select c.card->>'levelId' as level, count(*)::int as n
        from public.cards c
        where nullif(c.card->>'levelId', '') is not null
        group by 1
      ) l
    ), '[]'::jsonb),
    'by_region', coalesce((
      select jsonb_agg(jsonb_build_object('region', region, 'count', n) order by n desc, region)
      from (
        select c.card #>> '{profile,region}' as region, count(*)::int as n
        from public.cards c
        where nullif(c.card #>> '{profile,region}', '') is not null
        group by 1
      ) r
    ), '[]'::jsonb),
    'ai_videos', (
      select count(*)::int
      from public.cards c,
      lateral jsonb_array_elements(coalesce(c.card->'videos', '[]'::jsonb)) v
      where v->'ai' is not null and v->'ai' <> 'null'::jsonb
    )
  ) into result;

  return result;
end;
$$;

create or replace function public.admin_get_card(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  perform private.require_admin();
  if p_user_id is null then
    return null;
  end if;
  select c.card into payload from public.cards c where c.user_id = p_user_id;
  return payload;
end;
$$;

create or replace function public.admin_set_disabled(p_user_id uuid, p_disabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  v_card_id text;
begin
  perform private.require_admin();
  if p_user_id is null then
    raise exception 'missing user' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot change your own status' using errcode = '42501';
  end if;
  if private.is_admin(p_user_id) then
    raise exception 'cannot change an admin account' using errcode = '42501';
  end if;

  select u.email into target_email from auth.users u where u.id = p_user_id and u.deleted_at is null;
  if target_email is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  select private.card_id_of(c.card) into v_card_id from public.cards c where c.user_id = p_user_id;

  if p_disabled then
    update auth.users
      set banned_until = timestamptz '9999-12-31 23:59:59+00',
          updated_at = now()
      where id = p_user_id;
    perform private.revoke_sessions(p_user_id);
    if v_card_id is not null then
      insert into public.disabled_cards (card_id) values (v_card_id) on conflict (card_id) do nothing;
    end if;
    perform private.log_admin_action('disable', p_user_id, target_email, jsonb_build_object('card_id', v_card_id));
  else
    update auth.users set banned_until = null, updated_at = now() where id = p_user_id;
    if v_card_id is not null then
      delete from public.disabled_cards d where d.card_id = v_card_id;
    end if;
    perform private.log_admin_action('enable', p_user_id, target_email, jsonb_build_object('card_id', v_card_id));
  end if;

  return jsonb_build_object('ok', true, 'status', case when p_disabled then 'disabled' else 'active' end);
end;
$$;

create or replace function public.admin_delete_user(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  v_card_id text;
begin
  perform private.require_admin();
  if p_user_id is null then
    raise exception 'missing user' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot delete your own account' using errcode = '42501';
  end if;
  if private.is_admin(p_user_id) then
    raise exception 'cannot delete an admin account' using errcode = '42501';
  end if;

  select u.email into target_email from auth.users u where u.id = p_user_id and u.deleted_at is null;
  if target_email is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if lower(trim(coalesce(p_email, ''))) <> lower(target_email) then
    raise exception 'email confirmation does not match' using errcode = '22023';
  end if;

  select private.card_id_of(c.card) into v_card_id from public.cards c where c.user_id = p_user_id;
  if v_card_id is not null then
    insert into public.disabled_cards (card_id) values (v_card_id) on conflict (card_id) do nothing;
  end if;

  perform private.log_admin_action('delete', p_user_id, target_email, jsonb_build_object('card_id', v_card_id));
  perform private.revoke_sessions(p_user_id);
  delete from auth.users where id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_list_actions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'admin_id', a.admin_id,
    'admin_email', a.admin_email,
    'action', a.action,
    'target_user_id', a.target_user_id,
    'target_email', a.target_email,
    'created_at', a.created_at,
    'meta', a.meta
  ) order by a.created_at desc), '[]'::jsonb)
  into result
  from (
    select * from public.admin_actions
    order by created_at desc
    limit 100
  ) a;
  return result;
end;
$$;

-- Privileges: nothing for anon except the public, PII-free helpers.
revoke all on function private.sync_admin_user_ids() from public, anon, authenticated;
revoke all on function private.is_admin(uuid) from public, anon, authenticated;
revoke all on function private.require_admin() from public, anon, authenticated;
revoke all on function private.card_id_of(jsonb) from public, anon, authenticated;
revoke all on function private.revoke_sessions(uuid) from public, anon, authenticated;
revoke all on function private.log_admin_action(text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.user_email(uuid) from public, anon, authenticated;
revoke all on function private.is_listed_admin(uuid) from public, anon, authenticated;

revoke all on function public.account_flags() from public, anon;
grant execute on function public.account_flags() to authenticated;

revoke all on function public.is_card_unavailable(text) from public;
grant execute on function public.is_card_unavailable(text) to anon, authenticated;

revoke all on function public.admin_list_users(text, text) from public, anon;
grant execute on function public.admin_list_users(text, text) to authenticated;

revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

revoke all on function public.admin_get_card(uuid) from public, anon;
grant execute on function public.admin_get_card(uuid) to authenticated;

revoke all on function public.admin_set_disabled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_disabled(uuid, boolean) to authenticated;

revoke all on function public.admin_delete_user(uuid, text) from public, anon;
grant execute on function public.admin_delete_user(uuid, text) to authenticated;

revoke all on function public.admin_list_actions() from public, anon;
grant execute on function public.admin_list_actions() to authenticated;
