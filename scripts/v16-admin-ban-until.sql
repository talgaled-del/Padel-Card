-- 'infinity' for banned_until can make GoTrue return "Database error querying schema"
-- on sign-in. Use a far-future timestamp that is still unambiguously banned.
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
    update auth.users
      set banned_until = timestamptz '9999-12-31 23:59:59+00',
          updated_at = now()
      where id = p_user_id;
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
