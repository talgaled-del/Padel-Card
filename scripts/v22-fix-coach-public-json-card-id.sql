-- v22 follow-up: rename local card_id variable to avoid ambiguity with certified_ratings.card_id.
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

revoke all on function private.coach_public_json(public.certified_raters, public.certified_rater_profiles, boolean, boolean) from public, anon, authenticated;
