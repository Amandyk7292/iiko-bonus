-- Branch stock entered by staff survives background iiko sync. Concurrent staff
-- edits use a revision independent of the timestamp of the latest iiko refresh.
alter table public.branch_product_inventory
  add column if not exists stock_revision bigint not null default 0,
  add column if not exists front_quantity integer,
  add column if not exists front_managed boolean not null default false;

create or replace function public.preserve_manual_branch_stock()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.front_managed and new.source = 'iiko'
    and current_setting('bulka.front_snapshot', true) is distinct from 'true'
    and current_setting('bulka.stock_follow_iiko', true) is distinct from 'true' then
    new.source_quantity := old.source_quantity;
    new.source := old.source;
  end if;
  if old.source = 'admin' and new.source = 'iiko'
    and current_setting('bulka.stock_follow_iiko', true) is distinct from 'true' then
    new.source_quantity := old.source_quantity;
    new.source := old.source;
    new.manual_stop := old.manual_stop;
  end if;
  if (new.source_quantity, new.manual_stop, new.source, new.front_quantity, new.front_managed)
    is distinct from (old.source_quantity, old.manual_stop, old.source, old.front_quantity, old.front_managed) then
    new.stock_revision := old.stock_revision + 1;
  else
    new.stock_revision := old.stock_revision;
  end if;
  return new;
end;
$$;
drop trigger if exists preserve_manual_branch_stock on public.branch_product_inventory;
create trigger preserve_manual_branch_stock before update on public.branch_product_inventory
for each row execute function public.preserve_manual_branch_stock();

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
    values(p_branch_id, p_product_id, left(p_product_name, 160), 'admin')
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
    source = 'admin',
    manual_stop = case when p_changes ? 'manualStop' then (p_changes->>'manualStop')::boolean else manual_stop end,
    product_name = left(p_product_name, 160), updated_at = now()
    where branch_id = p_branch_id and product_id = p_product_id returning * into stock;
  return to_jsonb(stock);
end;
$$;
revoke all on function public.update_cashier_inventory(uuid, text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.update_cashier_inventory(uuid, text, text, bigint, jsonb) to service_role;

-- Releasing a completed order must not put its sold units back on sale when
-- the branch uses manually counted stock. Cancelled orders keep their stock.
create or replace function public.consume_completed_manual_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare refunded_quantity integer;
begin
  if old.status = 'committed' and new.status = 'released' and old.order_id is not null
    and exists(select 1 from public.kaspi_orders where id = old.order_id
      and (fulfillment_status = 'completed' or kitchen_status = 'handed_over')) then
    select coalesce(sum(items.quantity), 0)::integer into refunded_quantity
      from public.order_partial_refund_items items
      join public.order_partial_refunds refunds on refunds.id = items.refund_id
      where refunds.order_id = old.order_id and refunds.status = 'succeeded'
        and items.product_id = old.product_id;
    update public.branch_product_inventory
      set source_quantity = greatest(0, source_quantity - greatest(0, old.quantity - refunded_quantity)), updated_at = now()
      where branch_id = old.branch_id and product_id = old.product_id
        and source = 'admin' and source_quantity is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists consume_completed_manual_stock on public.inventory_reservations;
create trigger consume_completed_manual_stock before update of status on public.inventory_reservations
for each row execute function public.consume_completed_manual_stock();
