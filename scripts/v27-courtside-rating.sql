-- v27: court-side player cards — public lookup by card id, and a
-- certified-rater RPC to rate a scanned player without a prior request.
-- 3-month cooldown is counted from the player's last certified rating.

create or replace function public.get_shared_card(p_card_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid text := nullif(trim(coalesce(p_card_id, '')), '');
  payload jsonb;
begin
  if cid is null or char_length(cid) > 120 then
    raise exception 'invalid card' using errcode = '22023';
  end if;
  if exists (select 1 from public.disabled_cards d where d.card_id = cid) then
    raise exception 'card unavailable' using errcode = '42501';
  end if;
  select c.card into payload
  from public.cards c
  where private.card_id_of(c.card) = cid
  limit 1;
  if payload is null then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'card_id', cid,
    'card', payload
  );
end;
$$;

create or replace function private.courtside_last_rating(p_card_id text)
returns table (
  last_at timestamptz,
  last_level text,
  last_rater_name text,
  last_rater_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.updated_at, r.level, cr.full_name, r.rater_id
  from public.certified_ratings r
  join public.certified_raters cr on cr.id = r.rater_id
  where r.card_id = p_card_id
  order by r.updated_at desc, r.created_at desc
  limit 1;
$$;

create or replace function public.get_card_for_courtside(p_card_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rid uuid;
  uid uuid := auth.uid();
  cid text := nullif(trim(coalesce(p_card_id, '')), '');
  payload jsonb;
  owner uuid;
  last_at timestamptz;
  last_level text;
  last_name text;
  last_rid uuid;
  next_at timestamptz;
  cooling boolean := false;
  is_self boolean := false;
  req_id uuid;
begin
  rid := private.require_certified_rater();
  if cid is null or char_length(cid) > 120 then
    raise exception 'invalid card' using errcode = '22023';
  end if;
  if exists (select 1 from public.disabled_cards d where d.card_id = cid) then
    raise exception 'card unavailable' using errcode = '42501';
  end if;
  select c.card, c.user_id into payload, owner
  from public.cards c
  where private.card_id_of(c.card) = cid
  limit 1;
  if payload is null then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  is_self := (owner is not null and owner = uid);
  select s.last_at, s.last_level, s.last_rater_name, s.last_rater_id
    into last_at, last_level, last_name, last_rid
  from private.courtside_last_rating(cid) s;
  if last_at is not null then
    next_at := last_at + interval '3 months';
    cooling := now() < next_at;
  end if;
  select q.id into req_id
  from public.rating_requests q
  where q.card_id = cid
    and q.rater_id = rid
    and q.status = 'pending'
  order by q.created_at desc
  limit 1;
  return jsonb_build_object(
    'card_id', cid,
    'card', payload,
    'is_self', is_self,
    'can_rate', (not is_self and not cooling),
    'pending_request_id', req_id,
    'cooldown', case
      when last_at is null then jsonb_build_object('active', false)
      when cooling then jsonb_build_object(
        'active', true,
        'last_rated_at', last_at,
        'last_level', last_level,
        'last_rater_name', last_name,
        'next_allowed_at', next_at,
        'next_allowed_date', to_char(next_at at time zone 'Asia/Jerusalem', 'DD/MM/YYYY')
      )
      else jsonb_build_object(
        'active', false,
        'last_rated_at', last_at,
        'last_level', last_level,
        'last_rater_name', last_name,
        'next_allowed_at', next_at
      )
    end
  );
end;
$$;

create or replace function public.rate_card_courtside(
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
  last_at timestamptz;
  next_at timestamptz;
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
  if owner is null then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  if owner = uid then
    raise exception 'cannot rate own card' using errcode = '42501';
  end if;
  select s.last_at into last_at from private.courtside_last_rating(cid) s;
  if last_at is not null then
    next_at := last_at + interval '3 months';
    if now() < next_at then
      raise exception 'certified rating cooldown until %',
        to_char(next_at at time zone 'Asia/Jerusalem', 'YYYY-MM-DD')
        using errcode = 'P0001';
    end if;
  end if;
  insert into public.certified_ratings (card_id, rater_id, level, note)
  values (cid, rid, lvl, nt)
  on conflict (card_id, rater_id) do update
    set level = excluded.level,
        note = excluded.note,
        updated_at = now(),
        seen_at = null
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
    'request_id', req_id,
    'card_id', cid
  );
end;
$$;

revoke all on function private.courtside_last_rating(text) from public, anon, authenticated;
revoke all on function public.get_shared_card(text) from public;
grant execute on function public.get_shared_card(text) to anon, authenticated;
revoke all on function public.get_card_for_courtside(text) from public, anon;
grant execute on function public.get_card_for_courtside(text) to authenticated;
revoke all on function public.rate_card_courtside(text, text, text) from public, anon;
grant execute on function public.rate_card_courtside(text, text, text) to authenticated;
