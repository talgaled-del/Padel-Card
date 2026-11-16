-- v19: certified star ratings (דירוג כוכב).
-- Tables are not directly readable or writable via the Data API.
-- Public read and rater/admin writes go through SECURITY DEFINER RPCs.

create table if not exists public.certified_raters (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certified_raters_name_len
    check (char_length(trim(full_name)) >= 2 and char_length(full_name) <= 80),
  constraint certified_raters_email_format
    check (
      email is null
      or (email = lower(email) and position('@' in email) > 1 and char_length(email) <= 254)
    )
);

comment on table public.certified_raters is
  'Allowlist of certified padel raters (mostly coaches). Email is optional until the rater is linked; unique and stored lowercase.';

create unique index if not exists certified_raters_email_key
  on public.certified_raters (email)
  where email is not null;

create table if not exists public.certified_ratings (
  id uuid primary key default gen_random_uuid(),
  card_id text not null,
  rater_id uuid not null references public.certified_raters(id) on delete cascade,
  level text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certified_ratings_card_id_len
    check (char_length(card_id) >= 1 and char_length(card_id) <= 120),
  constraint certified_ratings_level_ok
    check (level in ('D2', 'D1', 'C2', 'C1', 'B2', 'B1', 'A2', 'A1')),
  constraint certified_ratings_note_len
    check (note is null or char_length(note) <= 200),
  constraint certified_ratings_one_per_rater unique (card_id, rater_id)
);

comment on table public.certified_ratings is
  'One certified level per rater per player card (share-link card id). Updates overwrite the same row.';

create index if not exists certified_ratings_card_id_idx
  on public.certified_ratings (card_id);

create index if not exists certified_ratings_updated_idx
  on public.certified_ratings (updated_at desc);

alter table public.certified_raters enable row level security;
alter table public.certified_ratings enable row level security;

revoke all on table public.certified_raters from public, anon, authenticated;
revoke all on table public.certified_ratings from public, anon, authenticated;

insert into public.certified_raters (full_name, email, active)
select s.full_name, null, true
from (
  values
    ('עמית נאור'),
    ('דניאל בן הרוש'),
    ('אהרון כהן'),
    ('נועם כהן'),
    ('עמית שחר'),
    ('סער סימון')
) as s(full_name)
where not exists (
  select 1 from public.certified_raters r where r.full_name = s.full_name
);

create or replace function private.norm_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(trim(coalesce(p_email, ''))), '');
$$;

create or replace function private.require_certified_rater()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  em text;
  rid uuid;
begin
  if uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  em := private.norm_email(private.user_email(uid));
  if em is null then
    raise exception 'not a certified rater' using errcode = '42501';
  end if;
  select r.id into rid
  from public.certified_raters r
  where r.active
    and r.email is not null
    and r.email = em
  limit 1;
  if rid is null then
    raise exception 'not a certified rater' using errcode = '42501';
  end if;
  return rid;
end;
$$;

create or replace function private.owner_user_id_of_card(p_card_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.user_id
  from public.cards c
  where private.card_id_of(c.card) = p_card_id
  limit 1;
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
  rater public.certified_raters;
  em text;
begin
  if uid is null then
    return jsonb_build_object(
      'signed_in', false,
      'is_admin', false,
      'disabled', false,
      'is_certified_rater', false,
      'certified_rater', null
    );
  end if;
  perform private.sync_admin_user_ids();
  select u.banned_until into banned from auth.users u where u.id = uid;
  em := private.norm_email(private.user_email(uid));
  if em is not null then
    select r.* into rater
    from public.certified_raters r
    where r.active and r.email is not null and r.email = em
    limit 1;
  end if;
  return jsonb_build_object(
    'signed_in', true,
    'is_admin', private.is_admin(uid),
    'disabled', banned is not null and banned > now(),
    'is_certified_rater', rater.id is not null,
    'certified_rater', case
      when rater.id is null then null
      else jsonb_build_object('id', rater.id, 'full_name', rater.full_name)
    end
  );
end;
$$;

create or replace function public.get_certified_ratings(p_card_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_card_id is null or length(trim(p_card_id)) = 0 then
    return '[]'::jsonb;
  end if;
  if exists (
    select 1 from public.disabled_cards d
    where d.card_id = p_card_id
  ) then
    return '[]'::jsonb;
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'rater_id', r.rater_id,
        'rater_name', cr.full_name,
        'level', r.level,
        'note', r.note,
        'created_at', r.created_at,
        'updated_at', r.updated_at
      )
      order by r.updated_at desc
    ),
    '[]'::jsonb
  )
  into result
  from public.certified_ratings r
  join public.certified_raters cr on cr.id = r.rater_id
  where r.card_id = p_card_id;
  return result;
end;
$$;

create or replace function public.upsert_certified_rating(
  p_card_id text,
  p_level text,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rid uuid;
  uid uuid := auth.uid();
  cid text := nullif(trim(coalesce(p_card_id, '')), '');
  lvl text := upper(trim(coalesce(p_level, '')));
  nt text := nullif(trim(coalesce(p_note, '')), '');
  owner uuid;
  rec public.certified_ratings;
  rname text;
begin
  rid := private.require_certified_rater();
  if cid is null or char_length(cid) > 120 then
    raise exception 'invalid card' using errcode = '22023';
  end if;
  if lvl not in ('D2', 'D1', 'C2', 'C1', 'B2', 'B1', 'A2', 'A1') then
    raise exception 'invalid level' using errcode = '22023';
  end if;
  if nt is not null and char_length(nt) > 200 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  if exists (select 1 from public.disabled_cards d where d.card_id = cid) then
    raise exception 'card unavailable' using errcode = '42501';
  end if;
  owner := private.owner_user_id_of_card(cid);
  if owner is not null and owner = uid then
    raise exception 'cannot rate own card' using errcode = '42501';
  end if;
  insert into public.certified_ratings (card_id, rater_id, level, note)
  values (cid, rid, lvl, nt)
  on conflict (card_id, rater_id) do update
    set level = excluded.level,
        note = excluded.note,
        updated_at = now()
  returning * into rec;
  select cr.full_name into rname from public.certified_raters cr where cr.id = rid;
  return jsonb_build_object(
    'id', rec.id,
    'rater_id', rec.rater_id,
    'rater_name', rname,
    'level', rec.level,
    'note', rec.note,
    'created_at', rec.created_at,
    'updated_at', rec.updated_at
  );
end;
$$;

create or replace function public.delete_my_certified_rating(p_card_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rid uuid;
  cid text := nullif(trim(coalesce(p_card_id, '')), '');
  deleted int;
begin
  rid := private.require_certified_rater();
  if cid is null then
    raise exception 'invalid card' using errcode = '22023';
  end if;
  delete from public.certified_ratings r
  where r.card_id = cid and r.rater_id = rid;
  get diagnostics deleted = row_count;
  if deleted = 0 then
    raise exception 'rating not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_list_certified_raters()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.active desc, x.full_name, x.created_at)
    from (
      select
        r.id,
        r.full_name,
        r.email,
        r.active,
        r.created_at,
        r.updated_at,
        (
          select count(*)::int
          from public.certified_ratings x
          where x.rater_id = r.id
        ) as ratings_count
      from public.certified_raters r
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_add_certified_rater(
  p_full_name text,
  p_email text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  nm text := trim(coalesce(p_full_name, ''));
  em text := private.norm_email(p_email);
  rec public.certified_raters;
begin
  perform private.require_admin();
  if char_length(nm) < 2 or char_length(nm) > 80 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_email is not null and trim(p_email) <> '' and em is null then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if em is not null and position('@' in em) < 2 then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  begin
    insert into public.certified_raters (full_name, email, active)
    values (nm, em, true)
    returning * into rec;
  exception
    when unique_violation then
      raise exception 'email already in use' using errcode = '23505';
  end;
  perform private.log_admin_action(
    'cert_rater_add',
    null,
    em,
    jsonb_build_object('rater_id', rec.id, 'full_name', rec.full_name)
  );
  return jsonb_build_object(
    'id', rec.id,
    'full_name', rec.full_name,
    'email', rec.email,
    'active', rec.active,
    'created_at', rec.created_at,
    'ratings_count', 0
  );
end;
$$;

create or replace function public.admin_update_certified_rater(
  p_id uuid,
  p_full_name text default null,
  p_active boolean default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rec public.certified_raters;
  nm text;
begin
  perform private.require_admin();
  select * into rec from public.certified_raters r where r.id = p_id;
  if rec.id is null then
    raise exception 'rater not found' using errcode = 'P0002';
  end if;
  if p_full_name is not null then
    nm := trim(p_full_name);
    if char_length(nm) < 2 or char_length(nm) > 80 then
      raise exception 'invalid name' using errcode = '22023';
    end if;
    rec.full_name := nm;
  end if;
  if p_active is not null then
    rec.active := p_active;
  end if;
  update public.certified_raters r
  set full_name = rec.full_name,
      active = rec.active,
      updated_at = now()
  where r.id = p_id
  returning * into rec;
  perform private.log_admin_action(
    case when p_active is not null and p_full_name is null
         then case when rec.active then 'cert_rater_enable' else 'cert_rater_deactivate' end
         else 'cert_rater_update' end,
    null,
    rec.email,
    jsonb_build_object('rater_id', rec.id, 'full_name', rec.full_name, 'active', rec.active)
  );
  return jsonb_build_object(
    'id', rec.id,
    'full_name', rec.full_name,
    'email', rec.email,
    'active', rec.active,
    'updated_at', rec.updated_at
  );
end;
$$;

create or replace function public.admin_set_certified_rater_email(
  p_id uuid,
  p_email text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rec public.certified_raters;
  em text := private.norm_email(p_email);
begin
  perform private.require_admin();
  select * into rec from public.certified_raters r where r.id = p_id;
  if rec.id is null then
    raise exception 'rater not found' using errcode = 'P0002';
  end if;
  if p_email is not null and trim(p_email) <> '' and (em is null or position('@' in em) < 2) then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  begin
    update public.certified_raters r
    set email = em,
        updated_at = now()
    where r.id = p_id
    returning * into rec;
  exception
    when unique_violation then
      raise exception 'email already in use' using errcode = '23505';
  end;
  perform private.log_admin_action(
    'cert_rater_email',
    null,
    rec.email,
    jsonb_build_object('rater_id', rec.id, 'full_name', rec.full_name)
  );
  return jsonb_build_object(
    'id', rec.id,
    'full_name', rec.full_name,
    'email', rec.email,
    'active', rec.active
  );
end;
$$;

create or replace function public.admin_deactivate_certified_rater(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return public.admin_update_certified_rater(p_id, null, false);
end;
$$;

create or replace function public.admin_delete_certified_rater(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rec public.certified_raters;
  cnt int;
begin
  perform private.require_admin();
  select * into rec from public.certified_raters r where r.id = p_id;
  if rec.id is null then
    raise exception 'rater not found' using errcode = 'P0002';
  end if;
  select count(*)::int into cnt from public.certified_ratings x where x.rater_id = p_id;
  delete from public.certified_raters r where r.id = p_id;
  perform private.log_admin_action(
    'cert_rater_delete',
    null,
    rec.email,
    jsonb_build_object('rater_id', p_id, 'full_name', rec.full_name, 'ratings_deleted', cnt)
  );
  return jsonb_build_object('ok', true, 'ratings_deleted', cnt);
end;
$$;

create or replace function public.admin_list_certified_ratings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb)
    from (
      select
        r.id,
        r.card_id,
        r.level,
        r.note,
        r.created_at,
        r.updated_at,
        cr.id as rater_id,
        cr.full_name as rater_name,
        cr.email as rater_email,
        private.owner_user_id_of_card(r.card_id) as player_user_id,
        (
          select c.card #>> '{profile,name}'
          from public.cards c
          where private.card_id_of(c.card) = r.card_id
          limit 1
        ) as player_name
      from public.certified_ratings r
      join public.certified_raters cr on cr.id = r.rater_id
      order by r.updated_at desc
      limit 80
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_delete_certified_rating(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rec public.certified_ratings;
  rname text;
  remail text;
begin
  perform private.require_admin();
  select * into rec from public.certified_ratings r where r.id = p_id;
  if rec.id is null then
    raise exception 'rating not found' using errcode = 'P0002';
  end if;
  select cr.full_name, cr.email into rname, remail
  from public.certified_raters cr where cr.id = rec.rater_id;
  delete from public.certified_ratings r where r.id = p_id;
  perform private.log_admin_action(
    'cert_rating_delete',
    private.owner_user_id_of_card(rec.card_id),
    remail,
    jsonb_build_object(
      'rating_id', rec.id,
      'card_id', rec.card_id,
      'level', rec.level,
      'rater_id', rec.rater_id,
      'rater_name', rname
    )
  );
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function private.norm_email(text) from public, anon, authenticated;
revoke all on function private.require_certified_rater() from public, anon, authenticated;
revoke all on function private.owner_user_id_of_card(text) from public, anon, authenticated;
revoke all on function public.get_certified_ratings(text) from public;
grant execute on function public.get_certified_ratings(text) to anon, authenticated;

revoke all on function public.upsert_certified_rating(text, text, text) from public, anon;
grant execute on function public.upsert_certified_rating(text, text, text) to authenticated;

revoke all on function public.delete_my_certified_rating(text) from public, anon;
grant execute on function public.delete_my_certified_rating(text) to authenticated;

revoke all on function public.admin_list_certified_raters() from public, anon;
grant execute on function public.admin_list_certified_raters() to authenticated;

revoke all on function public.admin_add_certified_rater(text, text) from public, anon;
grant execute on function public.admin_add_certified_rater(text, text) to authenticated;

revoke all on function public.admin_update_certified_rater(uuid, text, boolean) from public, anon;
grant execute on function public.admin_update_certified_rater(uuid, text, boolean) to authenticated;

revoke all on function public.admin_set_certified_rater_email(uuid, text) from public, anon;
grant execute on function public.admin_set_certified_rater_email(uuid, text) to authenticated;

revoke all on function public.admin_deactivate_certified_rater(uuid) from public, anon;
grant execute on function public.admin_deactivate_certified_rater(uuid) to authenticated;

revoke all on function public.admin_delete_certified_rater(uuid) from public, anon;
grant execute on function public.admin_delete_certified_rater(uuid) to authenticated;

revoke all on function public.admin_list_certified_ratings() from public, anon;
grant execute on function public.admin_list_certified_ratings() to authenticated;

revoke all on function public.admin_delete_certified_rating(uuid) from public, anon;
grant execute on function public.admin_delete_certified_rating(uuid) to authenticated;

-- account_flags grants stay as they were (authenticated only).
revoke all on function public.account_flags() from public, anon;
grant execute on function public.account_flags() to authenticated;
