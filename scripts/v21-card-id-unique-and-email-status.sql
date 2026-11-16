-- v21: one card_id per user; email status on rating requests; player seen_at on certified ratings.

create unique index if not exists cards_card_id_unique
  on public.cards ( (nullif(coalesce(card #>> '{profile,id}', card ->> 'id'), '')) )
  where nullif(coalesce(card #>> '{profile,id}', card ->> 'id'), '') is not null;

create or replace function private.prevent_foreign_card_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id text := private.card_id_of(NEW.card);
begin
  if new_id is null then
    return NEW;
  end if;
  if exists (
    select 1 from public.cards c
    where private.card_id_of(c.card) = new_id
      and c.user_id is distinct from NEW.user_id
  ) then
    raise exception 'card id already owned by another user' using errcode = '23505';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_prevent_foreign_card_id on public.cards;
create trigger trg_prevent_foreign_card_id
  before insert or update of card, user_id on public.cards
  for each row
  execute function private.prevent_foreign_card_id();

alter table public.rating_requests
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_status text,
  add column if not exists seen_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rating_requests_email_status_chk'
  ) then
    alter table public.rating_requests
      add constraint rating_requests_email_status_chk
      check (email_status is null or email_status in ('sent', 'failed', 'skipped'));
  end if;
end $$;

alter table public.certified_ratings
  add column if not exists seen_at timestamptz;

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
    'completed_at', req.completed_at,
    'email_sent_at', req.email_sent_at,
    'email_status', req.email_status,
    'seen_at', req.seen_at
  );
$$;

create or replace function public.record_rating_request_email(p_request_id uuid, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rec public.rating_requests;
  uid uuid := auth.uid();
  st text := lower(trim(coalesce(p_status, '')));
  is_party boolean := false;
begin
  if st not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid email status' using errcode = '22023';
  end if;
  select * into rec from public.rating_requests q where q.id = p_request_id;
  if rec.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if uid is not null then
    is_party := (rec.requester_id = uid);
    if not is_party then
      begin
        is_party := (private.require_certified_rater() = rec.rater_id);
      exception
        when others then
          is_party := false;
      end;
    end if;
    if not is_party and not private.is_admin(uid) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  update public.rating_requests q
  set email_status = st,
      email_sent_at = case
        when st = 'sent' then coalesce(q.email_sent_at, now())
        else q.email_sent_at
      end
  where q.id = p_request_id
  returning * into rec;
  return jsonb_build_object(
    'id', rec.id,
    'email_status', rec.email_status,
    'email_sent_at', rec.email_sent_at
  );
end;
$$;

revoke all on function public.record_rating_request_email(uuid, text) from public, anon;
grant execute on function public.record_rating_request_email(uuid, text) to authenticated, service_role;

create or replace function public.get_certified_rating_notify_payload(p_card_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rid uuid;
  cid text := nullif(trim(coalesce(p_card_id, '')), '');
  owner uuid;
  rname text;
  pname text;
  plevel text;
  owner_email text;
begin
  if cid is null then
    raise exception 'invalid card' using errcode = '22023';
  end if;
  if uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  begin
    rid := private.require_certified_rater();
  exception
    when others then
      if not private.is_admin(uid) then
        raise exception 'not authorized' using errcode = '42501';
      end if;
  end;
  owner := private.owner_user_id_of_card(cid);
  if owner is null then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  select cr.full_name into rname
  from public.certified_raters cr
  where cr.id = rid;
  select c.card #>> '{profile,name}', c.card ->> 'levelId'
    into pname, plevel
  from public.cards c
  where c.user_id = owner
  limit 1;
  owner_email := private.user_email(owner);
  return jsonb_build_object(
    'card_id', cid,
    'player_name', pname,
    'player_level', plevel,
    'rater_name', rname,
    'requester_email', owner_email
  );
end;
$$;

revoke all on function public.get_certified_rating_notify_payload(text) from public, anon;
grant execute on function public.get_certified_rating_notify_payload(text) to authenticated, service_role;

create or replace function public.list_unseen_certified_ratings()
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
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'card_id', r.card_id,
      'rater_id', r.rater_id,
      'rater_name', cr.full_name,
      'level', r.level,
      'updated_at', r.updated_at
    ) order by r.updated_at desc)
    from public.certified_ratings r
    join public.certified_raters cr on cr.id = r.rater_id
    join public.cards c
      on c.user_id = uid
     and private.card_id_of(c.card) = r.card_id
    where r.seen_at is null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_unseen_certified_ratings() from public, anon;
grant execute on function public.list_unseen_certified_ratings() to authenticated;

create or replace function public.mark_certified_ratings_seen()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n int := 0;
begin
  if uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.certified_ratings r
  set seen_at = now()
  from public.cards c
  where c.user_id = uid
    and private.card_id_of(c.card) = r.card_id
    and r.seen_at is null;
  get diagnostics n = row_count;
  update public.rating_requests q
  set seen_at = now()
  where q.requester_id = uid
    and q.status = 'done'
    and q.seen_at is null;
  return jsonb_build_object('updated', n);
end;
$$;

revoke all on function public.mark_certified_ratings_seen() from public, anon;
grant execute on function public.mark_certified_ratings_seen() to authenticated;
