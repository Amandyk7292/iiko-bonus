begin;

create or replace function public.replace_product_options(
  p_product_id text, p_configuration jsonb, p_groups jsonb
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_group jsonb;
  v_option jsonb;
  v_group_id uuid;
begin
  if nullif(btrim(p_product_id), '') is null or length(p_product_id) > 128
    or jsonb_typeof(p_configuration) is distinct from 'object'
    or jsonb_typeof(p_groups) is distinct from 'array' then
    raise exception 'Invalid product options';
  end if;
  if jsonb_array_length(p_groups) > 50 or exists (
    select 1 from jsonb_array_elements(p_groups) g
    group by g->>'code' having count(*) > 1
  ) then raise exception 'Duplicate or excessive modifier groups'; end if;

  -- The product row serializes concurrent saves. Every subsequent edit belongs
  -- to this transaction; any invalid option rolls the complete save back.
  insert into public.product_configurations (
    product_id, product_kind, enabled, allow_inscription, inscription_max_length,
    allow_candles, allow_reference_upload, min_lead_hours, max_advance_days,
    weight_options, filling_options, design_options, updated_at
  ) values (
    p_product_id, p_configuration->>'product_kind', (p_configuration->>'enabled')::boolean,
    (p_configuration->>'allow_inscription')::boolean, (p_configuration->>'inscription_max_length')::integer,
    (p_configuration->>'allow_candles')::boolean, (p_configuration->>'allow_reference_upload')::boolean,
    (p_configuration->>'min_lead_hours')::integer, (p_configuration->>'max_advance_days')::integer,
    p_configuration->'weight_options', p_configuration->'filling_options', p_configuration->'design_options', now()
  ) on conflict (product_id) do update set
    product_kind = excluded.product_kind, enabled = excluded.enabled,
    allow_inscription = excluded.allow_inscription, inscription_max_length = excluded.inscription_max_length,
    allow_candles = excluded.allow_candles, allow_reference_upload = excluded.allow_reference_upload,
    min_lead_hours = excluded.min_lead_hours, max_advance_days = excluded.max_advance_days,
    weight_options = excluded.weight_options, filling_options = excluded.filling_options,
    design_options = excluded.design_options, updated_at = now();

  for v_group in select value from jsonb_array_elements(p_groups) loop
    if nullif(btrim(v_group->>'code'), '') is null
      or jsonb_typeof(v_group->'options') is distinct from 'array' then
      raise exception 'Invalid modifier group';
    end if;
    if jsonb_array_length(v_group->'options') not between 1 and 100 or exists (
      select 1 from jsonb_array_elements(v_group->'options') o
      group by o->>'code' having count(*) > 1
    ) then raise exception 'Duplicate or invalid modifier options'; end if;
    insert into public.product_modifier_groups (
      product_id, code, title_translations, selection_type, required,
      min_selected, max_selected, sort_order, active, updated_at
    ) values (
      p_product_id, v_group->>'code', v_group->'title_translations', v_group->>'selection_type',
      (v_group->>'required')::boolean, (v_group->>'min_selected')::integer,
      (v_group->>'max_selected')::integer, (v_group->>'sort_order')::integer,
      (v_group->>'active')::boolean, now()
    ) on conflict (product_id, code) do update set
      title_translations = excluded.title_translations, selection_type = excluded.selection_type,
      required = excluded.required, min_selected = excluded.min_selected,
      max_selected = excluded.max_selected, sort_order = excluded.sort_order,
      active = excluded.active, updated_at = now()
    returning id into v_group_id;

    for v_option in select value from jsonb_array_elements(v_group->'options') loop
      if nullif(btrim(v_option->>'code'), '') is null then raise exception 'Invalid option code'; end if;
      insert into public.product_modifier_options (
        group_id, code, title_translations, price_delta, is_default, sort_order, active, updated_at
      ) values (
        v_group_id, v_option->>'code', v_option->'title_translations',
        (v_option->>'price_delta')::numeric, (v_option->>'is_default')::boolean,
        (v_option->>'sort_order')::integer, (v_option->>'active')::boolean, now()
      ) on conflict (group_id, code) do update set
        title_translations = excluded.title_translations, price_delta = excluded.price_delta,
        is_default = excluded.is_default, sort_order = excluded.sort_order,
        active = excluded.active, updated_at = now();
    end loop;
    delete from public.product_modifier_options o where o.group_id = v_group_id
      and not exists (select 1 from jsonb_array_elements(v_group->'options') n where n->>'code' = o.code);
  end loop;
  delete from public.product_modifier_groups g where g.product_id = p_product_id
    and not exists (select 1 from jsonb_array_elements(p_groups) n where n->>'code' = g.code);
end;
$$;

revoke all on function public.replace_product_options(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_product_options(text, jsonb, jsonb) to service_role;
commit;
