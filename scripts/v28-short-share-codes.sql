-- v28: short, hash-free share codes so WhatsApp and in-app browsers
-- can open player cards at https://padelcard.app/c/<code> and coach
-- cards at https://padelcard.app/k/<code>. Backfills existing rows.
-- Old #/card/<id>, #/p/<payload> and #/coach/<id> links stay valid.

alter table public.cards
  add column if not exists short_code text;

alter table public.certified_raters
  add column if not exists short_code text;

create unique index if not exists cards_short_code_key
  on public.cards (short_code);

create unique index if not exists certified_raters_short_code_key
  on public.certified_raters (short_code);

create or replace function private.generate_short_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  result text;
  i int;
  tries int := 0;
  len int := 7;
  idx int;
begin
  loop
    result := '';
    for i in 1..len loop
      idx := 1 + floor(random() * 62)::int;
      result := result || substr(alphabet, idx, 1);
    end loop;
    exit when
      not exists (select 1 from public.cards c where c.short_code = result)
      and not exists (select 1 from public.certified_raters r where r.short_code = result);
    tries := tries + 1;
    if tries > 40 then
      len := len + 1;
      tries := 0;
    end if;
    if len > 12 then
      raise exception 'could not allocate short code';
    end if;
  end loop;
  return result;
end;
$$;

revoke all on function private.generate_short_code() from public, anon, authenticated;

create or replace function private.ensure_short_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.short_code is not null and btrim(old.short_code) <> '' then
    new.short_code := old.short_code;
  end if;
  if new.short_code is null or btrim(new.short_code) = '' then
    new.short_code := private.generate_short_code();
  end if;
  return new;
end;
$$;

revoke all on function private.ensure_short_code() from public, anon, authenticated;

drop trigger if exists trg_cards_short_code on public.cards;
create trigger trg_cards_short_code
  before insert or update on public.cards
  for each row execute function private.ensure_short_code();

drop trigger if exists trg_certified_raters_short_code on public.certified_raters;
create trigger trg_certified_raters_short_code
  before insert or update on public.certified_raters
  for each row execute function private.ensure_short_code();

do $$
declare
  rec record;
begin
  for rec in select user_id from public.cards where short_code is null loop
    update public.cards
      set short_code = private.generate_short_code()
      where user_id = rec.user_id and short_code is null;
  end loop;
  for rec in select id from public.certified_raters where short_code is null loop
    update public.certified_raters
      set short_code = private.generate_short_code()
      where id = rec.id and short_code is null;
  end loop;
end;
$$;

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
  code text;
begin
  if cid is null or char_length(cid) > 120 then
    raise exception 'invalid card' using errcode = '22023';
  end if;
  if exists (select 1 from public.disabled_cards d where d.card_id = cid) then
    raise exception 'card unavailable' using errcode = '42501';
  end if;
  select c.card, c.short_code into payload, code
  from public.cards c
  where private.card_id_of(c.card) = cid
  limit 1;
  if payload is null then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'card_id', cid,
    'short_code', code,
    'card', payload
  );
end;
$$;

create or replace function public.resolve_share_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw text := nullif(trim(coalesce(p_code, '')), '');
  payload jsonb;
  code text;
  cid text;
  coach_id uuid;
begin
  if raw is null or raw !~ '^[A-Za-z0-9]{6,12}$' then
    raise exception 'invalid code' using errcode = '22023';
  end if;

  select c.card, c.short_code into payload, code
  from public.cards c
  where c.short_code = raw
  limit 1;
  if payload is not null then
    cid := private.card_id_of(payload);
    if cid is not null and exists (select 1 from public.disabled_cards d where d.card_id = cid) then
      raise exception 'card unavailable' using errcode = '42501';
    end if;
    return jsonb_build_object(
      'kind', 'card',
      'short_code', code,
      'card_id', cid,
      'card', payload
    );
  end if;

  select r.id, r.short_code into coach_id, code
  from public.certified_raters r
  where r.short_code = raw and r.active
  limit 1;
  if coach_id is not null then
    return jsonb_build_object(
      'kind', 'coach',
      'short_code', code,
      'coach_id', coach_id
    );
  end if;

  raise exception 'code not found' using errcode = 'P0002';
end;
$$;

create or replace function public.my_card_share_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  code text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select c.short_code into code
  from public.cards c
  where c.user_id = uid;
  if not found then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  if code is null or btrim(code) = '' then
    update public.cards
      set short_code = private.generate_short_code()
      where user_id = uid and (short_code is null or btrim(short_code) = '')
      returning short_code into code;
    if code is null then
      select c.short_code into code from public.cards c where c.user_id = uid;
    end if;
  end if;
  return code;
end;
$$;

create or replace function private.coach_public_json(
  r public.certified_raters,
  p public.certified_rater_profiles,
  p_include_contact boolean,
  p_include_player boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- p_include_player is ignored: coach cards no longer link a player card.
  return jsonb_build_object(
    'id', r.id,
    'full_name', r.full_name,
    'active', r.active,
    'short_code', r.short_code,
    'clubs', coalesce(p.clubs, '{}'),
    'city', p.city,
    'region', p.region,
    'years_experience', p.years_experience,
    'certification', p.certification,
    'audiences', coalesce(p.audiences, '{}'),
    'bio', p.bio,
    'photo', nullif(trim(coalesce(p.photo, '')), ''),
    'level', p.level,
    'national_ranking', nullif(trim(coalesce(p.national_ranking, '')), ''),
    'contact', case when p_include_contact and p.contact_public then p.contact else null end,
    'contact_public', coalesce(p.contact_public, false) and p_include_contact,
    'is_complete', case when p.rater_id is null then false else private.profile_is_complete(p) end,
    'ratings_count', (select count(*)::int from public.certified_ratings x where x.rater_id = r.id),
    'updated_at', p.updated_at
  );
end;
$$;

revoke all on function public.get_shared_card(text) from public;
grant execute on function public.get_shared_card(text) to anon, authenticated;

revoke all on function public.resolve_share_code(text) from public;
grant execute on function public.resolve_share_code(text) to anon, authenticated;

revoke all on function public.my_card_share_code() from public, anon;
grant execute on function public.my_card_share_code() to authenticated;

revoke all on function private.coach_public_json(public.certified_raters, public.certified_rater_profiles, boolean, boolean)
  from public, anon, authenticated;
