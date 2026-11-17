-- v24: standalone coach profiles (no player-card link), self-declared level
-- and optional national ranking. Active raters cannot insert a player card.

alter table public.certified_rater_profiles
  add column if not exists level text,
  add column if not exists national_ranking text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crp_level_ok'
  ) then
    alter table public.certified_rater_profiles
      add constraint crp_level_ok
      check (level is null or level in ('D2','D1','C2','C1','B2','B1','A2','A1'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'crp_ranking_len'
  ) then
    alter table public.certified_rater_profiles
      add constraint crp_ranking_len
      check (national_ranking is null or char_length(national_ranking) <= 80);
  end if;
end;
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
  lvl text;
  ranking text;
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

  lvl := nullif(upper(trim(coalesce(p_profile ->> 'level', ''))), '');
  if lvl is not null and lvl not in ('D2','D1','C2','C1','B2','B1','A2','A1') then
    raise exception 'invalid level' using errcode = '22023';
  end if;

  ranking := nullif(trim(coalesce(p_profile ->> 'national_ranking', '')), '');
  if ranking is not null and char_length(ranking) > 80 then
    raise exception 'invalid profile' using errcode = '22023';
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
  rec.show_player_card := false;
  rec.level := lvl;
  rec.national_ranking := ranking;
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
begin
  -- p_include_player is ignored: coach cards no longer link a player card.
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
    audiences, bio, contact, contact_public, photo, show_player_card,
    level, national_ranking, updated_at
  ) values (
    rid, parsed.clubs, parsed.city, parsed.region, parsed.years_experience, parsed.certification,
    parsed.audiences, parsed.bio, parsed.contact, parsed.contact_public, parsed.photo, false,
    parsed.level, parsed.national_ranking, now()
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
    show_player_card = false,
    level = excluded.level,
    national_ranking = excluded.national_ranking,
    updated_at = now()
  returning * into rec;
  select * into r from public.certified_raters x where x.id = rid;
  return private.coach_public_json(r, rec, true, false) || jsonb_build_object('contact', rec.contact, 'contact_public', rec.contact_public);
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
    audiences, bio, contact, contact_public, photo, show_player_card,
    level, national_ranking, updated_at
  ) values (
    p_rater_id, parsed.clubs, parsed.city, parsed.region, parsed.years_experience, parsed.certification,
    parsed.audiences, parsed.bio, parsed.contact, parsed.contact_public, parsed.photo, false,
    parsed.level, parsed.national_ranking, now()
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
    show_player_card = false,
    level = excluded.level,
    national_ranking = excluded.national_ranking,
    updated_at = now()
  returning * into rec;
  select * into r from public.certified_raters x where x.id = p_rater_id;
  return private.coach_public_json(r, rec, true, false) || jsonb_build_object('contact', rec.contact, 'contact_public', rec.contact_public);
end;
$$;

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
      'photo', nullif(p.photo, ''),
      'level', p.level,
      'national_ranking', nullif(trim(coalesce(p.national_ranking, '')), ''),
      'is_complete', case when p.rater_id is null then false else private.profile_is_complete(p) end
    ) order by r.active desc, (r.email is not null) desc, r.full_name)
    from public.certified_raters r
    left join public.certified_rater_profiles p on p.rater_id = r.id
    where r.active
  ), '[]'::jsonb);
end;
$$;

create or replace function private.prevent_rater_player_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text;
begin
  em := private.norm_email(private.user_email(NEW.user_id));
  if em is not null and exists (
    select 1 from public.certified_raters r
    where r.active
      and r.email is not null
      and r.email = em
  ) then
    raise exception 'certified raters cannot have a player card' using errcode = '42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_prevent_rater_player_card on public.cards;
create trigger trg_prevent_rater_player_card
  before insert or update of user_id on public.cards
  for each row
  execute function private.prevent_rater_player_card();

revoke all on function private.parse_profile_payload(jsonb) from public, anon, authenticated;
revoke all on function private.coach_public_json(public.certified_raters, public.certified_rater_profiles, boolean, boolean) from public, anon, authenticated;
revoke all on function private.prevent_rater_player_card() from public, anon, authenticated;

revoke all on function public.upsert_my_certified_profile(jsonb) from public, anon;
grant execute on function public.upsert_my_certified_profile(jsonb) to authenticated;
revoke all on function public.admin_upsert_certified_profile(uuid, jsonb) from public, anon;
grant execute on function public.admin_upsert_certified_profile(uuid, jsonb) to authenticated;
revoke all on function public.list_certified_raters_public() from public, anon;
grant execute on function public.list_certified_raters_public() to authenticated;
