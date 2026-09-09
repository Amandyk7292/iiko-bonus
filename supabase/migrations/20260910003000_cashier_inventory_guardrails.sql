-- Stop-list overrides must not freeze the quantity owned by the register.
create or replace function public.update_cashier_inventory(
  p_branch_id uuid, p_product_id text, p_product_name text,
  p_expected_revision bigint, p_changes jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare stock public.branch_product_inventory%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 0
    or p_product_id is null or length(p_product_id) not between 1 and 100
    or p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Некорректные данные остатка' using errcode = '22023';
  end if;
  if not (p_changes ? 'sourceQuantity' or p_changes ? 'manualStop' or p_changes ? 'useIiko')
    or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('sourceQuantity', 'manualStop', 'useIiko'))
    or (p_changes ? 'useIiko' and (p_changes->'useIiko' <> 'true'::jsonb or p_changes ? 'sourceQuantity' or p_changes ? 'manualStop'))
    or (p_changes ? 'manualStop' and jsonb_typeof(p_changes->'manualStop') <> 'boolean')
    or (p_changes ? 'sourceQuantity' and (jsonb_typeof(p_changes->'sourceQuantity') <> 'number'
      or (p_changes->>'sourceQuantity') !~ '^[0-9]{1,6}$'
      or (p_changes->>'sourceQuantity')::numeric > 100000)) then
    raise exception 'Укажите целый остаток от 0 до 100000' using errcode = '22023';
  end if;
  if not exists(select 1 from public.bulka_locations where id = p_branch_id and active = true) then
    raise exception 'Филиал больше недоступен' using errcode = 'P0001';
  end if;
  insert into public.branch_product_inventory(branch_id, product_id, product_name, source)
    values(p_branch_id, p_product_id, left(p_product_name, 160),
      case when exists(select 1 from public.custom_products where id::text = p_product_id) then 'admin' else 'iiko' end)
    on conflict(branch_id, product_id) do nothing;
  select * into stock from public.branch_product_inventory
    where branch_id = p_branch_id and product_id = p_product_id for update;
  if stock.stock_revision <> p_expected_revision then
    raise exception 'Остаток уже изменился. Проверьте новые данные и повторите сохранение.'
      using errcode = '40001';
  end if;
  if p_changes ? 'useIiko' then
    if not exists(select 1 from public.branch_front_inventory_sync
      where branch_id = p_branch_id and last_seen_at > now() - interval '45 seconds') then
      raise exception 'Нет свежих остатков iikoFront' using errcode = '40001';
    end if;
    perform set_config('bulka.stock_follow_iiko', 'true', true);
    update public.branch_product_inventory set source_quantity = front_quantity,
      source = 'iiko', manual_stop = false, updated_at = now()
      where branch_id = p_branch_id and product_id = p_product_id returning * into stock;
    return to_jsonb(stock);
  end if;
  update public.branch_product_inventory set
    source_quantity = case when p_changes ? 'sourceQuantity' then (p_changes->>'sourceQuantity')::integer else source_quantity end,
    source = case when p_changes ? 'sourceQuantity' then 'admin' else source end,
    manual_stop = case when p_changes ? 'manualStop' then (p_changes->>'manualStop')::boolean else manual_stop end,
    product_name = left(p_product_name, 160), updated_at = now()
    where branch_id = p_branch_id and product_id = p_product_id returning * into stock;
  return to_jsonb(stock);
end;
$$;
revoke all on function public.update_cashier_inventory(uuid, text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.update_cashier_inventory(uuid, text, text, bigint, jsonb) to service_role;


drop trigger if exists check_front_inventory_freshness on public.inventory_reservations;
create trigger check_front_inventory_freshness before insert or update of status, expires_at on public.inventory_reservations
  for each row execute function public.check_front_inventory_freshness();
