-- Fix ambiguous card_id (PL/pgSQL variable vs disabled_cards.card_id column).

create or replace function public.admin_set_disabled(p_user_id uuid, p_disabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  v_card_id text;
begin
  perform private.require_admin();
  if p_user_id is null then
    raise exception 'missing user' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot change your own status' using errcode = '42501';
  end if;
  if private.is_admin(p_user_id) then
    raise exception 'cannot change an admin account' using errcode = '42501';
  end if;

  select u.email into target_email from auth.users u where u.id = p_user_id and u.deleted_at is null;
  if target_email is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  select private.card_id_of(c.card) into v_card_id from public.cards c where c.user_id = p_user_id;

  if p_disabled then
    update auth.users set banned_until = 'infinity'::timestamptz, updated_at = now() where id = p_user_id;
    perform private.revoke_sessions(p_user_id);
    if v_card_id is not null then
      insert into public.disabled_cards (card_id) values (v_card_id) on conflict (card_id) do nothing;
    end if;
    perform private.log_admin_action('disable', p_user_id, target_email, jsonb_build_object('card_id', v_card_id));
  else
    update auth.users set banned_until = null, updated_at = now() where id = p_user_id;
    if v_card_id is not null then
      delete from public.disabled_cards d where d.card_id = v_card_id;
    end if;
    perform private.log_admin_action('enable', p_user_id, target_email, jsonb_build_object('card_id', v_card_id));
  end if;

  return jsonb_build_object('ok', true, 'status', case when p_disabled then 'disabled' else 'active' end);
end;
$$;

create or replace function public.admin_delete_user(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  v_card_id text;
begin
  perform private.require_admin();
  if p_user_id is null then
    raise exception 'missing user' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot delete your own account' using errcode = '42501';
  end if;
  if private.is_admin(p_user_id) then
    raise exception 'cannot delete an admin account' using errcode = '42501';
  end if;

  select u.email into target_email from auth.users u where u.id = p_user_id and u.deleted_at is null;
  if target_email is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if lower(trim(coalesce(p_email, ''))) <> lower(target_email) then
    raise exception 'email confirmation does not match' using errcode = '22023';
  end if;

  select private.card_id_of(c.card) into v_card_id from public.cards c where c.user_id = p_user_id;
  if v_card_id is not null then
    insert into public.disabled_cards (card_id) values (v_card_id) on conflict (card_id) do nothing;
  end if;

  perform private.log_admin_action('delete', p_user_id, target_email, jsonb_build_object('card_id', v_card_id));
  perform private.revoke_sessions(p_user_id);
  delete from auth.users where id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;
