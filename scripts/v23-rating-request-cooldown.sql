-- v23: 3-month cooldown between certified rating requests (any rater),
-- counted from the requester's latest rating_requests.created_at.

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
  last_at timestamptz;
  next_at timestamptz;
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
  select max(q.created_at) into last_at
  from public.rating_requests q
  where q.requester_id = uid;
  if last_at is not null then
    next_at := last_at + interval '3 months';
    if now() < next_at then
      raise exception 'rating request cooldown until %',
        to_char(next_at at time zone 'Asia/Jerusalem', 'YYYY-MM-DD')
        using errcode = 'P0001';
    end if;
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

create or replace function public.get_rating_request_cooldown()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  last_at timestamptz;
  next_at timestamptz;
begin
  if uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select max(q.created_at) into last_at
  from public.rating_requests q
  where q.requester_id = uid;
  if last_at is null then
    return jsonb_build_object('active', false);
  end if;
  next_at := last_at + interval '3 months';
  if now() >= next_at then
    return jsonb_build_object(
      'active', false,
      'last_requested_at', last_at,
      'next_allowed_at', next_at
    );
  end if;
  return jsonb_build_object(
    'active', true,
    'last_requested_at', last_at,
    'next_allowed_at', next_at,
    'next_allowed_date', to_char(next_at at time zone 'Asia/Jerusalem', 'DD/MM/YYYY')
  );
end;
$$;

revoke all on function public.create_rating_request(uuid, text, text) from public, anon;
grant execute on function public.create_rating_request(uuid, text, text) to authenticated;

revoke all on function public.get_rating_request_cooldown() from public, anon;
grant execute on function public.get_rating_request_cooldown() to authenticated;
