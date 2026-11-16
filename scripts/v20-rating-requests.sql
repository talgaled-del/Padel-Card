-- v20: rating requests, and block assigning an admin email to a rater.

create table if not exists public.rating_requests (
  id uuid primary key default gen_random_uuid(),
  card_id text not null,
  requester_id uuid not null references auth.users(id) on delete cascade,
  rater_id uuid not null references public.certified_raters(id) on delete cascade,
  message text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint rating_requests_card_id_len
    check (char_length(card_id) >= 1 and char_length(card_id) <= 120),
  constraint rating_requests_message_len
    check (message is null or char_length(message) <= 200),
  constraint rating_requests_status_ok
    check (status in ('pending', 'done', 'declined', 'cancelled'))
);

comment on table public.rating_requests is
  'Player requests for a certified star rating. Requester and assigned rater read their own rows via RPCs; no direct Data API access.';

create unique index if not exists rating_requests_one_pending
  on public.rating_requests (card_id, rater_id)
  where status = 'pending';

create index if not exists rating_requests_requester_idx
  on public.rating_requests (requester_id, created_at desc);

create index if not exists rating_requests_rater_idx
  on public.rating_requests (rater_id, status, created_at desc);

alter table public.rating_requests enable row level security;
revoke all on table public.rating_requests from public, anon, authenticated;

create or replace function private.email_is_admin(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admins a
    where a.email is not null
      and a.email = private.norm_email(p_email)
  );
$$;

create or replace function private.require_card_owner(p_card_id text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  owner uuid;
begin
  if uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  owner := private.owner_user_id_of_card(p_card_id);
  if owner is null or owner <> uid then
    raise exception 'not your card' using errcode = '42501';
  end if;
  return uid;
end;
$$;

create or replace function private.request_public_row(req public.rating_requests, p_rater_name text, p_player_name text, p_player_photo text, p_player_level text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', req.id,
    'card_id', req.card_id,
    'rater_id', req.rater_id,
    'rater_name', p_rater_name,
    'requester_id', req.requester_id,
    'player_name', p_player_name,
    'player_photo', p_player_photo,
    'player_level', p_player_level,
    'message', req.message,
    'status', req.status,
    'created_at', req.created_at,
    'completed_at', req.completed_at
  );
$$;

-- Block assigning an admin allowlist email to a rater.
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
  if em is not null and private.email_is_admin(em) then
    raise exception 'cannot assign admin email' using errcode = '42501';
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
  if em is not null and private.email_is_admin(em) then
    raise exception 'cannot assign admin email' using errcode = '42501';
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

create or replace function public.admin_preview_rater_email(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  em text := private.norm_email(p_email);
  has_account boolean := false;
  has_card boolean := false;
begin
  perform private.require_admin();
  if em is null then
    return jsonb_build_object('is_admin', false, 'has_account', false, 'has_card', false, 'empty', true);
  end if;
  select exists (select 1 from auth.users u where private.norm_email(u.email) = em)
    into has_account;
  select exists (
    select 1
    from public.cards c
    join auth.users u on u.id = c.user_id
    where private.norm_email(u.email) = em
      and private.card_id_of(c.card) is not null
  ) into has_card;
  return jsonb_build_object(
    'is_admin', private.email_is_admin(em),
    'has_account', has_account,
    'has_card', has_card,
    'empty', false
  );
end;
$$;

create or replace function public.list_certified_raters_public()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'full_name', r.full_name,
      'active', r.active,
      'has_email', (r.email is not null),
      'ratings_count', (
        select count(*)::int from public.certified_ratings x where x.rater_id = r.id
      )
    ) order by r.active desc, (r.email is not null) desc, r.full_name)
    from public.certified_raters r
    where r.active
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_rating_request(
  p_rater_id uuid,
  p_card_id text,
  p_message text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid;
  cid text := nullif(trim(coalesce(p_card_id, '')), '');
  msg text := nullif(trim(coalesce(p_message, '')), '');
  rater public.certified_raters;
  pending_count int;
  rec public.rating_requests;
  rname text;
  pname text;
  pphoto text;
  plevel text;
begin
  if cid is null then
    raise exception 'invalid card' using errcode = '22023';
  end if;
  uid := private.require_card_owner(cid);
  if exists (select 1 from public.disabled_cards d where d.card_id = cid) then
    raise exception 'card unavailable' using errcode = '42501';
  end if;
  if msg is not null and char_length(msg) > 200 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  select * into rater from public.certified_raters r where r.id = p_rater_id;
  if rater.id is null or not rater.active then
    raise exception 'rater not found' using errcode = 'P0002';
  end if;
  if rater.email is null then
    raise exception 'rater has no email' using errcode = '42501';
  end if;
  if private.owner_user_id_of_card(cid) is not null
     and private.norm_email(private.user_email(uid)) = rater.email then
    raise exception 'cannot request own rating' using errcode = '42501';
  end if;
  select count(*)::int into pending_count
  from public.rating_requests q
  where q.requester_id = uid and q.status = 'pending';
  if pending_count >= 3 then
    raise exception 'too many pending requests' using errcode = '54000';
  end if;
  if exists (
    select 1 from public.rating_requests q
    where q.card_id = cid and q.rater_id = p_rater_id and q.status = 'pending'
  ) then
    raise exception 'request already pending' using errcode = '23505';
  end if;
  insert into public.rating_requests (card_id, requester_id, rater_id, message, status)
  values (cid, uid, p_rater_id, msg, 'pending')
  returning * into rec;
  select cr.full_name into rname from public.certified_raters cr where cr.id = rec.rater_id;
  select c.card #>> '{profile,name}', c.card #>> '{profile,photo}', c.card ->> 'levelId'
    into pname, pphoto, plevel
  from public.cards c
  where c.user_id = uid
  limit 1;
  return private.request_public_row(rec, rname, pname, pphoto, plevel);
end;
$$;

create or replace function public.list_my_rating_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(private.request_public_row(q, cr.full_name, c.card #>> '{profile,name}', c.card #>> '{profile,photo}', c.card ->> 'levelId') order by q.created_at desc)
    from public.rating_requests q
    join public.certified_raters cr on cr.id = q.rater_id
    left join public.cards c on c.user_id = q.requester_id
    where q.requester_id = uid
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_rater_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  rid := private.require_certified_rater();
  return coalesce((
    select jsonb_agg(private.request_public_row(
      q,
      cr.full_name,
      c.card #>> '{profile,name}',
      coalesce(c.card #>> '{profile,photo}', c.card ->> 'photo'),
      c.card ->> 'levelId'
    ) order by q.created_at desc)
    from public.rating_requests q
    join public.certified_raters cr on cr.id = q.rater_id
    left join public.cards c on c.user_id = q.requester_id
    where q.rater_id = rid
      and q.status in ('pending', 'done', 'declined')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.cancel_rating_request(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rec public.rating_requests;
begin
  if uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into rec from public.rating_requests q where q.id = p_id;
  if rec.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if rec.requester_id <> uid then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if rec.status <> 'pending' then
    raise exception 'request not pending' using errcode = '22023';
  end if;
  update public.rating_requests q
  set status = 'cancelled', completed_at = now()
  where q.id = p_id
  returning * into rec;
  return jsonb_build_object('ok', true, 'id', rec.id, 'status', rec.status);
end;
$$;

create or replace function public.decline_rating_request(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rid uuid;
  rec public.rating_requests;
begin
  rid := private.require_certified_rater();
  select * into rec from public.rating_requests q where q.id = p_id;
  if rec.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if rec.rater_id <> rid then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if rec.status <> 'pending' then
    raise exception 'request not pending' using errcode = '22023';
  end if;
  update public.rating_requests q
  set status = 'declined', completed_at = now()
  where q.id = p_id
  returning * into rec;
  return jsonb_build_object('ok', true, 'id', rec.id, 'status', rec.status, 'requester_id', rec.requester_id);
end;
$$;

create or replace function public.get_rating_request(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rid uuid;
  rec public.rating_requests;
  rname text;
  pname text;
  pphoto text;
  plevel text;
  is_rater boolean := false;
begin
  if uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into rec from public.rating_requests q where q.id = p_id;
  if rec.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  begin
    rid := private.require_certified_rater();
    is_rater := (rid = rec.rater_id);
  exception
    when others then
      is_rater := false;
  end;
  if rec.requester_id <> uid and not is_rater then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select cr.full_name into rname from public.certified_raters cr where cr.id = rec.rater_id;
  select c.card #>> '{profile,name}',
         coalesce(c.card #>> '{profile,photo}', c.card ->> 'photo'),
         c.card ->> 'levelId'
    into pname, pphoto, plevel
  from public.cards c
  where c.user_id = rec.requester_id
  limit 1;
  return private.request_public_row(rec, rname, pname, pphoto, plevel);
end;
$$;

create or replace function public.get_card_for_rating_request(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rid uuid;
  rec public.rating_requests;
  payload jsonb;
begin
  rid := private.require_certified_rater();
  select * into rec from public.rating_requests q where q.id = p_id;
  if rec.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if rec.rater_id <> rid then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.disabled_cards d where d.card_id = rec.card_id) then
    raise exception 'card unavailable' using errcode = '42501';
  end if;
  select c.card into payload
  from public.cards c
  where private.card_id_of(c.card) = rec.card_id
     or c.user_id = rec.requester_id
  limit 1;
  if payload is null then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'request_id', rec.id,
    'status', rec.status,
    'message', rec.message,
    'card_id', rec.card_id,
    'card', payload
  );
end;
$$;

-- When a rater saves a rating, complete a matching pending request.
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
  req_id uuid;
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
  update public.rating_requests q
  set status = 'done', completed_at = now()
  where q.card_id = cid
    and q.rater_id = rid
    and q.status = 'pending'
  returning q.id into req_id;
  select cr.full_name into rname from public.certified_raters cr where cr.id = rid;
  return jsonb_build_object(
    'id', rec.id,
    'rater_id', rec.rater_id,
    'rater_name', rname,
    'level', rec.level,
    'note', rec.note,
    'created_at', rec.created_at,
    'updated_at', rec.updated_at,
    'request_id', req_id
  );
end;
$$;

create or replace function public.admin_list_rating_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'pending', (select count(*)::int from public.rating_requests q where q.status = 'pending'),
      'done', (select count(*)::int from public.rating_requests q where q.status = 'done'),
      'declined', (select count(*)::int from public.rating_requests q where q.status = 'declined'),
      'cancelled', (select count(*)::int from public.rating_requests q where q.status = 'cancelled'),
      'total', (select count(*)::int from public.rating_requests)
    ),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'card_id', q.card_id,
        'status', q.status,
        'message', q.message,
        'created_at', q.created_at,
        'completed_at', q.completed_at,
        'rater_id', cr.id,
        'rater_name', cr.full_name,
        'player_name', c.card #>> '{profile,name}'
      ) order by q.created_at desc)
      from (
        select * from public.rating_requests order by created_at desc limit 80
      ) q
      join public.certified_raters cr on cr.id = q.rater_id
      left join public.cards c on c.user_id = q.requester_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Notify helper used by the Edge Function (service role or the involved user).
create or replace function public.get_rating_request_notify_payload(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rec public.rating_requests;
  rater public.certified_raters;
  is_admin boolean := false;
  is_party boolean := false;
  pname text;
  plevel text;
  requester_email text;
begin
  select * into rec from public.rating_requests q where q.id = p_id;
  if rec.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if uid is not null then
    is_admin := private.is_admin(uid);
    is_party := (rec.requester_id = uid);
    if not is_party then
      begin
        is_party := (private.require_certified_rater() = rec.rater_id);
      exception
        when others then
          is_party := false;
      end;
    end if;
  end if;
  -- Service role has no auth.uid(); allow it. Signed-in users must be a party or an admin.
  if uid is not null and not is_admin and not is_party then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into rater from public.certified_raters cr where cr.id = rec.rater_id;
  select c.card #>> '{profile,name}', c.card ->> 'levelId'
    into pname, plevel
  from public.cards c
  where c.user_id = rec.requester_id
  limit 1;
  requester_email := private.user_email(rec.requester_id);
  return jsonb_build_object(
    'id', rec.id,
    'status', rec.status,
    'message', rec.message,
    'card_id', rec.card_id,
    'player_name', pname,
    'player_level', plevel,
    'rater_name', rater.full_name,
    'rater_email', rater.email,
    'requester_email', requester_email
  );
end;
$$;

revoke all on function private.email_is_admin(text) from public, anon, authenticated;
revoke all on function private.require_card_owner(text) from public, anon, authenticated;
revoke all on function private.request_public_row(public.rating_requests, text, text, text, text) from public, anon, authenticated;

revoke all on function public.admin_add_certified_rater(text, text) from public, anon;
grant execute on function public.admin_add_certified_rater(text, text) to authenticated;

revoke all on function public.admin_set_certified_rater_email(uuid, text) from public, anon;
grant execute on function public.admin_set_certified_rater_email(uuid, text) to authenticated;

revoke all on function public.admin_preview_rater_email(text) from public, anon;
grant execute on function public.admin_preview_rater_email(text) to authenticated;

revoke all on function public.list_certified_raters_public() from public, anon;
grant execute on function public.list_certified_raters_public() to authenticated;

revoke all on function public.create_rating_request(uuid, text, text) from public, anon;
grant execute on function public.create_rating_request(uuid, text, text) to authenticated;

revoke all on function public.list_my_rating_requests() from public, anon;
grant execute on function public.list_my_rating_requests() to authenticated;

revoke all on function public.list_rater_requests() from public, anon;
grant execute on function public.list_rater_requests() to authenticated;

revoke all on function public.cancel_rating_request(uuid) from public, anon;
grant execute on function public.cancel_rating_request(uuid) to authenticated;

revoke all on function public.decline_rating_request(uuid) from public, anon;
grant execute on function public.decline_rating_request(uuid) to authenticated;

revoke all on function public.get_rating_request(uuid) from public, anon;
grant execute on function public.get_rating_request(uuid) to authenticated;

revoke all on function public.get_card_for_rating_request(uuid) from public, anon;
grant execute on function public.get_card_for_rating_request(uuid) to authenticated;

revoke all on function public.upsert_certified_rating(text, text, text) from public, anon;
grant execute on function public.upsert_certified_rating(text, text, text) to authenticated;

revoke all on function public.admin_list_rating_requests() from public, anon;
grant execute on function public.admin_list_rating_requests() to authenticated;

revoke all on function public.get_rating_request_notify_payload(uuid) from public, anon;
grant execute on function public.get_rating_request_notify_payload(uuid) to authenticated, service_role;
