-- ============================================================================
-- Réordonnancement d'une étape de séquence (T24, éditeur de campagne).
--
-- `sequence_steps` porte une contrainte `unique (campaign_id, position)` NON
-- déférable : impossible d'échanger deux positions en un seul UPDATE (violation
-- transitoire). On fait le swap dans une fonction (donc une transaction), via une
-- position temporaire. SECURITY DEFINER + contrôle admin explicite (l'écriture
-- réelle passe autrement par la RLS `sequence_steps_write`).
-- ============================================================================
create or replace function app.move_sequence_step(p_step uuid, p_up boolean)
returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_campaign uuid;
  v_pos int;
  v_org uuid;
  v_other uuid;
  v_other_pos int;
begin
  select s.campaign_id, s.position, c.organization_id
    into v_campaign, v_pos, v_org
    from public.sequence_steps s
    join public.campaigns c on c.id = s.campaign_id
   where s.id = p_step;
  if v_campaign is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not (v_org in (select app.user_orgs('admin'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_up then
    select id, position into v_other, v_other_pos
      from public.sequence_steps
     where campaign_id = v_campaign and position < v_pos
     order by position desc limit 1;
  else
    select id, position into v_other, v_other_pos
      from public.sequence_steps
     where campaign_id = v_campaign and position > v_pos
     order by position asc limit 1;
  end if;
  if v_other is null then
    return; -- déjà en bout de séquence
  end if;

  -- Swap via position temporaire (-1) : la contrainte unique tient à chaque étape.
  update public.sequence_steps set position = -1 where id = p_step;
  update public.sequence_steps set position = v_pos where id = v_other;
  update public.sequence_steps set position = v_other_pos where id = p_step;
end;
$$;

grant execute on function app.move_sequence_step(uuid, boolean) to authenticated;

create or replace function public.move_sequence_step(p_step uuid, p_up boolean)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  perform app.move_sequence_step(p_step, p_up);
end;
$$;
grant execute on function public.move_sequence_step(uuid, boolean) to authenticated;
