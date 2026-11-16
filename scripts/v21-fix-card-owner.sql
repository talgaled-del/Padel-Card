-- v21: require_card_owner accepts the signed-in user's row even if the same
-- card_id was cloned onto another account. list_certified_raters_public adds is_self.
-- Applied on project ehcsbtbcelfoxfgraytl as migration fix_card_owner_lookup_and_self_rater.

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
  order by case when c.user_id = auth.uid() then 0 else 1 end, c.updated_at desc nulls last
  limit 1;
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
begin
  if uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.cards c
    where c.user_id = uid and private.card_id_of(c.card) = p_card_id
  ) then
    raise exception 'not your card' using errcode = '42501';
  end if;
  return uid;
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
      'ratings_count', (
        select count(*)::int from public.certified_ratings x where x.rater_id = r.id
      )
    ) order by r.active desc, (r.email is not null) desc, r.full_name)
    from public.certified_raters r
    where r.active
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_certified_raters_public() from public, anon;
grant execute on function public.list_certified_raters_public() to authenticated;
