-- v22: certified rater profiles, one-time invite tokens, public coaches directory.
-- Access is RPC-only (tables revoked from anon/authenticated). RLS enabled.

create table if not exists public.certified_rater_profiles (
  rater_id uuid primary key references public.certified_raters(id) on delete cascade,
  clubs text[] not null default '{}',
  city text,
  region text,
  years_experience integer,
  certification text,
  audiences text[] not null default '{}',
  bio text,
  contact text,
  contact_public boolean not null default false,
  photo text,
  show_player_card boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crp_city_len check (city is null or char_length(city) <= 80),
  constraint crp_region_ok check (
    region is null or region in ('north','haifa','sharon','center','telaviv','shfela','jerusalem','south')
  ),
  constraint crp_years_ok check (years_experience is null or (years_experience >= 0 and years_experience <= 60)),
  constraint crp_cert_len check (certification is null or char_length(certification) <= 160),
  constraint crp_bio_len check (bio is null or char_length(bio) <= 600),
  constraint crp_contact_len check (contact is null or char_length(contact) <= 40),
  constraint crp_photo_len check (photo is null or char_length(photo) <= 500),
  constraint crp_clubs_len check (coalesce(array_length(clubs, 1), 0) <= 12),
  constraint crp_audiences_ok check (audiences <@ array['kids','beginners','advanced','competitive']::text[])
);

comment on table public.certified_rater_profiles is
  'Public-facing coach profile for a certified rater. Contact is returned only when contact_public is true.';

create table if not exists public.certified_rater_invites (
  id uuid primary key default gen_random_uuid(),
  rater_id uuid not null references public.certified_raters(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint cri_hash_len check (char_length(token_hash) = 64)
);

create unique index if not exists certified_rater_invites_token_hash_key
  on public.certified_rater_invites (token_hash);

create index if not exists certified_rater_invites_rater_id_idx
  on public.certified_rater_invites (rater_id);

alter table public.certified_rater_profiles enable row level security;
alter table public.certified_rater_invites enable row level security;

revoke all on table public.certified_rater_profiles from public, anon, authenticated;
revoke all on table public.certified_rater_invites from public, anon, authenticated;

create or replace function private.sha256_hex(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function private.profile_is_complete(p public.certified_rater_profiles)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p.years_experience is not null
    and (coalesce(array_length(p.clubs, 1), 0) > 0 or nullif(trim(coalesce(p.city, '')), '') is not null)
    and coalesce(array_length(p.audiences, 1), 0) > 0;
$$;

create or replace function private.user_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where private.norm_email(u.email) = private.norm_email(p_email)
  limit 1;
$$;

create or replace function private.sanitize_player_card(p_card jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_card is null then null
    else jsonb_build_object(
      'levelId', p_card ->> 'levelId',
      'ai_level', coalesce(p_card #>> '{profile,ai,l}', p_card #>> '{ai,l}'),
      'profile', jsonb_build_object(
        'id', coalesce(p_card #>> '{profile,id}', p_card ->> 'id'),
        'name', p_card #>> '{profile,name}',
        'photo', coalesce(p_card #>> '{profile,photo}', p_card ->> 'photo'),
        'region', p_card #>> '{profile,region}'
      )
    )
  end;
$$;

create or replace function private.rater_player_card(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.sanitize_player_card(c.card)
  from public.cards c
  where c.user_id = private.user_id_for_email(p_email)
  limit 1;
$$;

create or replace function private.player_photo_of_email(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(c.card #>> '{profile,photo}', c.card ->> 'photo')
  from public.cards c
  where c.user_id = private.user_id_for_email(p_email)
  limit 1;
$$;

create or replace function private.parse_profile_payload(p_profile jsonb)
returns public.certified_rater_profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  rec public.certified_rater_profiles;
  clubs text[];
  audiences text[];
  contact text;
  photo text;
begin
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'invalid profile' using errcode = '22023';
  end if;

  select array_agg(nullif(trim(x), ''))
    into clubs
  from unnest(coalesce(
    array(select jsonb_array_elements_text(coalesce(p_profile -> 'clubs', '[]'::jsonb))),
    '{}'::text[]
  )) as x
  where nullif(trim(x), '') is not null;

  clubs := coalesce(clubs, '{}');
  if coalesce(array_length(clubs, 1), 0) > 12 then
    raise exception 'too many clubs' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(clubs) c where char_length(c) > 80) then
    raise exception 'invalid club' using errcode = '22023';
  end if;

  select array_agg(distinct x)
    into audiences
  from unnest(coalesce(
    array(select jsonb_array_elements_text(coalesce(p_profile -> 'audiences', '[]'::jsonb))),
    '{}'::text[]
  )) as x
  where x in ('kids', 'beginners', 'advanced', 'competitive');
  audiences := coalesce(audiences, '{}');

  contact := nullif(trim(coalesce(p_profile ->> 'contact', '')), '');
  if contact is not null and contact !~ '^[0-9+()[:space:]-]{6,40}$' then
    raise exception 'invalid contact' using errcode = '22023';
  end if;

  photo := nullif(trim(coalesce(p_profile ->> 'photo', '')), '');
  if photo is not null and photo !~ '^https://' then
    raise exception 'invalid photo' using errcode = '22023';
  end if;

  rec.clubs := clubs;
  rec.city := nullif(trim(coalesce(p_profile ->> 'city', '')), '');
  rec.region := nullif(trim(coalesce(p_profile ->> 'region', '')), '');
  rec.years_experience := case
    when p_profile ->> 'years_experience' is null or p_profile ->> 'years_experience' = '' then null
    else (p_profile ->> 'years_experience')::int
  end;
  rec.certification := nullif(trim(coalesce(p_profile ->> 'certification', '')), '');
  rec.audiences := audiences;
  rec.bio := nullif(trim(coalesce(p_profile ->> 'bio', '')), '');
  rec.contact := contact;
  rec.contact_public := coalesce((p_profile ->> 'contact_public')::boolean, false);
  rec.photo := photo;
  rec.show_player_card := coalesce((p_profile ->> 'show_player_card')::boolean, true);
  return rec;
exception
  when invalid_text_representation then
    raise exception 'invalid profile' using errcode = '22023';
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
declare
  photo text;
  player jsonb;
  player_card_id text;
  certs jsonb;
begin
  photo := nullif(trim(coalesce(p.photo, '')), '');
  if photo is null then
    photo := private.player_photo_of_email(r.email);
  end if;
  player := null;
  certs := '[]'::jsonb;
  if p_include_player and coalesce(p.show_player_card, true) and r.email is not null then
    player := private.rater_player_card(r.email);
    player_card_id := player #>> '{profile,id}';
    if player_card_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('level', x.level) order by x.updated_at), '[]'::jsonb)
        into certs
      from public.certified_ratings x
      where x.card_id = player_card_id;
    end if;
  end if;
  return jsonb_build_object(
    'id', r.id,
    'full_name', r.full_name,
    'active', r.active,
    'clubs', coalesce(p.clubs, '{}'),
    'city', p.city,
    'region', p.region,
    'years_experience', p.years_experience,
    'certification', p.certification,
    'audiences', coalesce(p.audiences, '{}'),
    'bio', p.bio,
    'photo', photo,
    'contact', case when p_include_contact and p.contact_public then p.contact else null end,
    'contact_public', coalesce(p.contact_public, false) and p_include_contact,
    'show_player_card', coalesce(p.show_player_card, true),
    'is_complete', case when p.rater_id is null then false else private.profile_is_complete(p) end,
    'has_player_card', player is not null,
    'player', player,
    'player_cert_levels', certs,
    'ratings_count', (select count(*)::int from public.certified_ratings x where x.rater_id = r.id),
    'updated_at', p.updated_at
  );
end;
$$;

-- Public directory: active raters with a completed profile. No emails, contact only if opted in.
create or replace function public.list_certified_coaches_public()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce((
    select jsonb_agg(private.coach_public_json(r, p, true, false) order by r.full_name)
    from public.certified_raters r
    join public.certified_rater_profiles p on p.rater_id = r.id
    where r.active and private.profile_is_complete(p)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_certified_coach_public(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.certified_raters;
  p public.certified_rater_profiles;
begin
  select * into r from public.certified_raters x where x.id = p_id and x.active;
  if r.id is null then
    raise exception 'coach not found' using errcode = 'P0002';
  end if;
  select * into p from public.certified_rater_profiles x where x.rater_id = p_id;
  if p.rater_id is null or not private.profile_is_complete(p) then
    raise exception 'coach not found' using errcode = 'P0002';
  end if;
  return private.coach_public_json(r, p, true, true);
end;
$$;

create or replace function public.get_my_certified_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rid uuid;
  r public.certified_raters;
  p public.certified_rater_profiles;
  out jsonb;
begin
  rid := private.require_certified_rater();
  select * into r from public.certified_raters x where x.id = rid;
  select * into p from public.certified_rater_profiles x where x.rater_id = rid;
  out := private.coach_public_json(r, p, true, true);
  -- Owner always sees their saved contact, even if not public yet.
  if p.rater_id is not null then
    out := out || jsonb_build_object('contact', p.contact, 'contact_public', p.contact_public);
  else
    out := out || jsonb_build_object('contact', null, 'contact_public', false, 'is_complete', false);
  end if;
  return out;
end;
$$;

create or replace function public.upsert_my_certified_profile(p_profile jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rid uuid;
  parsed public.certified_rater_profiles;
  rec public.certified_rater_profiles;
  r public.certified_raters;
begin
  rid := private.require_certified_rater();
  parsed := private.parse_profile_payload(p_profile);
  insert into public.certified_rater_profiles as t (
    rater_id, clubs, city, region, years_experience, certification,
    audiences, bio, contact, contact_public, photo, show_player_card, updated_at
  ) values (
    rid, parsed.clubs, parsed.city, parsed.region, parsed.years_experience, parsed.certification,
    parsed.audiences, parsed.bio, parsed.contact, parsed.contact_public, parsed.photo, parsed.show_player_card, now()
  )
  on conflict (rater_id) do update set
    clubs = excluded.clubs,
    city = excluded.city,
    region = excluded.region,
    years_experience = excluded.years_experience,
    certification = excluded.certification,
    audiences = excluded.audiences,
    bio = excluded.bio,
    contact = excluded.contact,
    contact_public = excluded.contact_public,
    photo = excluded.photo,
    show_player_card = excluded.show_player_card,
    updated_at = now()
  returning * into rec;
  select * into r from public.certified_raters x where x.id = rid;
  return private.coach_public_json(r, rec, true, true) || jsonb_build_object('contact', rec.contact, 'contact_public', rec.contact_public);
end;
$$;

create or replace function public.admin_upsert_certified_profile(p_rater_id uuid, p_profile jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  parsed public.certified_rater_profiles;
  rec public.certified_rater_profiles;
  r public.certified_raters;
begin
  perform private.require_admin();
  select * into r from public.certified_raters x where x.id = p_rater_id;
  if r.id is null then
    raise exception 'rater not found' using errcode = 'P0002';
  end if;
  parsed := private.parse_profile_payload(p_profile);
  insert into public.certified_rater_profiles as t (
    rater_id, clubs, city, region, years_experience, certification,
    audiences, bio, contact, contact_public, photo, show_player_card, updated_at
  ) values (
    p_rater_id, parsed.clubs, parsed.city, parsed.region, parsed.years_experience, parsed.certification,
    parsed.audiences, parsed.bio, parsed.contact, parsed.contact_public, parsed.photo, parsed.show_player_card, now()
  )
  on conflict (rater_id) do update set
    clubs = excluded.clubs,
    city = excluded.city,
    region = excluded.region,
    years_experience = excluded.years_experience,
    certification = excluded.certification,
    audiences = excluded.audiences,
    bio = excluded.bio,
    contact = excluded.contact,
    contact_public = excluded.contact_public,
    photo = excluded.photo,
    show_player_card = excluded.show_player_card,
    updated_at = now()
  returning * into rec;
  return private.coach_public_json(r, rec, true, true) || jsonb_build_object('contact', rec.contact, 'contact_public', rec.contact_public);
end;
$$;

create or replace function public.admin_get_certified_profile(p_rater_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.certified_raters;
  p public.certified_rater_profiles;
begin
  perform private.require_admin();
  select * into r from public.certified_raters x where x.id = p_rater_id;
  if r.id is null then
    raise exception 'rater not found' using errcode = 'P0002';
  end if;
  select * into p from public.certified_rater_profiles x where x.rater_id = p_rater_id;
  return private.coach_public_json(r, p, true, true) || jsonb_build_object(
    'contact', p.contact,
    'contact_public', coalesce(p.contact_public, false)
  );
end;
$$;

create or replace function public.admin_create_rater_invite(p_rater_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.certified_raters;
  token text;
  digest text;
  exp timestamptz := now() + interval '30 days';
begin
  perform private.require_admin();
  select * into r from public.certified_raters x where x.id = p_rater_id;
  if r.id is null then
    raise exception 'rater not found' using errcode = 'P0002';
  end if;
  if not r.active then
    raise exception 'rater inactive' using errcode = '42501';
  end if;
  -- One live invite per rater: retire unused links.
  update public.certified_rater_invites i
  set used_at = now()
  where i.rater_id = p_rater_id
    and i.used_at is null;
  token := encode(extensions.gen_random_bytes(24), 'hex');
  digest := private.sha256_hex(token);
  insert into public.certified_rater_invites (rater_id, token_hash, expires_at, created_by)
  values (p_rater_id, digest, exp, auth.uid());
  return jsonb_build_object(
    'rater_id', r.id,
    'rater_name', r.full_name,
    'token', token,
    'url', 'https://padelcard.app/#/invite/' || token,
    'expires_at', exp
  );
end;
$$;

create or replace function public.claim_rater_invite(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  token text := nullif(trim(coalesce(p_token, '')), '');
  digest text;
  inv public.certified_rater_invites;
  r public.certified_raters;
  em text;
begin
  if uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if token is null or token !~ '^[0-9a-f]{32,128}$' then
    raise exception 'invalid invite' using errcode = '22023';
  end if;
  digest := private.sha256_hex(token);
  select * into inv from public.certified_rater_invites i where i.token_hash = digest;
  if inv.id is null then
    raise exception 'invalid invite' using errcode = 'P0002';
  end if;
  if inv.used_at is not null then
    raise exception 'invite already used' using errcode = '42501';
  end if;
  if inv.expires_at <= now() then
    raise exception 'invite expired' using errcode = '42501';
  end if;
  em := private.norm_email(private.user_email(uid));
  if em is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if private.email_is_admin(em) then
    raise exception 'cannot assign admin email' using errcode = '42501';
  end if;
  select * into r from public.certified_raters x where x.id = inv.rater_id;
  if r.id is null or not r.active then
    raise exception 'rater not found' using errcode = 'P0002';
  end if;
  if r.email is not null and r.email <> em then
    raise exception 'rater already linked' using errcode = '42501';
  end if;
  -- Unique email: another rater must not already own this address.
  if exists (
    select 1 from public.certified_raters x
    where x.email = em and x.id is distinct from r.id
  ) then
    raise exception 'email already in use' using errcode = '23505';
  end if;
  update public.certified_raters
  set email = em, updated_at = now()
  where id = r.id;
  update public.certified_rater_invites
  set used_at = now()
  where id = inv.id;
  return jsonb_build_object(
    'ok', true,
    'rater_id', r.id,
    'rater_name', r.full_name
  );
end;
$$;

-- Enrich the existing picker list with public profile fields (still no emails/contact).
create or replace function public.list_certified_raters_public()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  self_email text;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  self_email := private.norm_email(private.user_email(auth.uid()));
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'full_name', r.full_name,
      'active', r.active,
      'has_email', (r.email is not null),
      'is_self', (self_email is not null and self_email = private.norm_email(r.email)),
      'ratings_count', (select count(*)::int from public.certified_ratings x where x.rater_id = r.id),
      'clubs', coalesce(p.clubs, '{}'),
      'city', p.city,
      'region', p.region,
      'years_experience', p.years_experience,
      'photo', coalesce(nullif(p.photo, ''), private.player_photo_of_email(r.email)),
      'is_complete', case when p.rater_id is null then false else private.profile_is_complete(p) end
    ) order by r.active desc, (r.email is not null) desc, r.full_name)
    from public.certified_raters r
    left join public.certified_rater_profiles p on p.rater_id = r.id
    where r.active
  ), '[]'::jsonb);
end;
$$;

revoke all on function private.sha256_hex(text) from public, anon, authenticated;
revoke all on function private.profile_is_complete(public.certified_rater_profiles) from public, anon, authenticated;
revoke all on function private.user_id_for_email(text) from public, anon, authenticated;
revoke all on function private.sanitize_player_card(jsonb) from public, anon, authenticated;
revoke all on function private.rater_player_card(text) from public, anon, authenticated;
revoke all on function private.player_photo_of_email(text) from public, anon, authenticated;
revoke all on function private.parse_profile_payload(jsonb) from public, anon, authenticated;
revoke all on function private.coach_public_json(public.certified_raters, public.certified_rater_profiles, boolean, boolean) from public, anon, authenticated;

revoke all on function public.list_certified_coaches_public() from public;
grant execute on function public.list_certified_coaches_public() to anon, authenticated;

revoke all on function public.get_certified_coach_public(uuid) from public;
grant execute on function public.get_certified_coach_public(uuid) to anon, authenticated;

revoke all on function public.get_my_certified_profile() from public, anon;
grant execute on function public.get_my_certified_profile() to authenticated;

revoke all on function public.upsert_my_certified_profile(jsonb) from public, anon;
grant execute on function public.upsert_my_certified_profile(jsonb) to authenticated;

revoke all on function public.admin_upsert_certified_profile(uuid, jsonb) from public, anon;
grant execute on function public.admin_upsert_certified_profile(uuid, jsonb) to authenticated;

revoke all on function public.admin_get_certified_profile(uuid) from public, anon;
grant execute on function public.admin_get_certified_profile(uuid) to authenticated;

revoke all on function public.admin_create_rater_invite(uuid) from public, anon;
grant execute on function public.admin_create_rater_invite(uuid) to authenticated;

revoke all on function public.claim_rater_invite(text) from public, anon;
grant execute on function public.claim_rater_invite(text) to authenticated;

revoke all on function public.list_certified_raters_public() from public, anon;
grant execute on function public.list_certified_raters_public() to authenticated;
