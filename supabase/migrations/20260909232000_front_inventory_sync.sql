create table if not exists public.branch_front_inventory_sync (
  branch_id uuid primary key references public.bulka_locations(id) on delete cascade,
  terminal_id uuid not null,
  terminal_group_id uuid not null,
  session_id uuid not null,
  sequence bigint not null check (sequence > 0),
  captured_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
alter table public.branch_front_inventory_sync enable row level security;
revoke all on public.branch_front_inventory_sync from public, anon, authenticated;
grant all on public.branch_front_inventory_sync to service_role;

create or replace function public.apply_front_inventory_snapshot(
  p_branch_id uuid, p_terminal_id uuid, p_terminal_group_id uuid,
  p_session_id uuid, p_sequence bigint, p_captured_at timestamptz, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  previous public.branch_front_inventory_sync%rowtype;
  item jsonb;
  updated_count integer := 0;
  affected integer;
  reconnected boolean;
  changed_ids text[] := '{}';
begin
  if p_sequence is null or p_sequence <= 0 or p_session_id is null or p_terminal_id is null
    or p_terminal_group_id is null or p_captured_at is null
    or p_captured_at < now() - interval '2 minutes' or p_captured_at > now() + interval '1 minute'
    or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 450 then
    raise exception 'Invalid iikoFront snapshot' using errcode = '22023';
  end if;
  -- Serialize whole snapshots of this branch, including the first connection.
  perform id from public.bulka_locations where id = p_branch_id and active = true for update;
  if not found then raise exception 'Inactive branch' using errcode = '22023'; end if;
  select * into previous from public.branch_front_inventory_sync where branch_id = p_branch_id for update;
  if found then
    if previous.terminal_group_id <> p_terminal_group_id then
      raise exception 'Another iikoFront group is bound to this branch' using errcode = '22023';
    end if;
    if (previous.session_id = p_session_id and previous.sequence >= p_sequence)
      or previous.captured_at >= p_captured_at then
      return jsonb_build_object('applied', false, 'changed', false);
    end if;
  end if;
  reconnected := previous.last_seen_at is null or previous.last_seen_at < now() - interval '45 seconds';
  perform set_config('bulka.front_snapshot', 'true', true);
  if exists(select 1 from jsonb_array_elements(p_items) x where
      jsonb_typeof(x->'productId') is distinct from 'string' or length(x->>'productId') not between 1 and 100
      or jsonb_typeof(x->'quantity') is distinct from 'number' or (x->>'quantity') !~ '^[0-9]{1,6}$'
      or (x->>'quantity')::numeric > 100000)
    or (select count(*) from jsonb_array_elements(p_items)) <>
       (select count(distinct x->>'productId') from jsonb_array_elements(p_items) x) then
    raise exception 'Invalid iikoFront products' using errcode = '22023';
  end if;
  insert into public.branch_front_inventory_sync values
    (p_branch_id, p_terminal_id, p_terminal_group_id, p_session_id, p_sequence, p_captured_at, now())
    on conflict(branch_id) do update set terminal_id = excluded.terminal_id,
      session_id = excluded.session_id, sequence = excluded.sequence,
      captured_at = excluded.captured_at, last_seen_at = now();

  -- A full snapshot also communicates removal from the finite stop list.
  with changed as (update public.branch_product_inventory inv set
    front_quantity = null, front_managed = true,
    source_quantity = case when source = 'admin' then source_quantity else null end,
    last_synced_at = now(), updated_at = now()
    where branch_id = p_branch_id and source in ('admin', 'iiko')
      and (front_quantity is not null or not front_managed)
      and not exists(select 1 from jsonb_array_elements(p_items) x where x->>'productId' = inv.product_id)
    returning product_id)
  select count(*), coalesce(array_agg(product_id), '{}') into affected, changed_ids from changed;
  updated_count := updated_count + affected;

  for item in select value from jsonb_array_elements(p_items) order by value->>'productId' loop
    insert into public.branch_product_inventory as inv
      (branch_id, product_id, product_name, source_quantity, source, front_quantity, front_managed, last_synced_at)
    values (p_branch_id, item->>'productId', left(item->>'productName',160),
      (item->>'quantity')::integer, 'iiko', (item->>'quantity')::integer, true, now())
    on conflict(branch_id,product_id) do update set
      front_quantity = excluded.front_quantity, front_managed = true,
      source_quantity = case when inv.source in ('admin', 'custom') then inv.source_quantity else excluded.source_quantity end,
      source = case when inv.source in ('admin', 'custom') then inv.source else 'iiko' end,
      last_synced_at = now(), updated_at = now()
    where inv.front_quantity is distinct from excluded.front_quantity or not inv.front_managed;
    get diagnostics affected = row_count;
    updated_count := updated_count + affected;
    if affected > 0 then changed_ids := array_append(changed_ids, item->>'productId'); end if;
  end loop;
  return jsonb_build_object('applied', true, 'changed', updated_count > 0 or reconnected,
    'updated', updated_count, 'productIds', to_jsonb(changed_ids));
end;
$$;
revoke all on function public.apply_front_inventory_snapshot(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_front_inventory_snapshot(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb) to service_role;

-- A disconnected register cannot authorize new reservations using old counts.
-- Staff can explicitly confirm a manual count while repairing the register.
create or replace function public.check_front_inventory_freshness()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'active' and exists (
    select 1 from public.branch_front_inventory_sync sync
    where sync.branch_id = new.branch_id and sync.last_seen_at < now() - interval '45 seconds'
      and not exists(select 1 from public.branch_product_inventory inv
        where inv.branch_id = new.branch_id and inv.product_id = new.product_id and inv.source in ('admin', 'custom'))
  ) then
    raise exception 'Остаток товара требует подтверждения кассиром' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists check_front_inventory_freshness on public.inventory_reservations;
create trigger check_front_inventory_freshness before insert on public.inventory_reservations
  for each row execute function public.check_front_inventory_freshness();

-- An explicit administrator reset may resume the source; background cloud
-- writes cannot use this path or silently replace a confirmed manual count.
create or replace function public.update_admin_inventory(p_stock jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  saved public.branch_product_inventory%rowtype;
  selected_quantity integer := (p_stock->>'source_quantity')::integer;
  selected_source text := case when selected_quantity is null then 'iiko' else 'admin' end;
  selected_branch uuid := (p_stock->>'branch_id')::uuid;
begin
  if selected_quantity < 0 or selected_quantity > 100000
    or coalesce(length(p_stock->>'product_id'), 0) not between 1 and 100 then
    raise exception 'Некорректный остаток' using errcode = '22023';
  end if;
  perform id from public.bulka_locations where id = selected_branch and active = true for update;
  if not found then raise exception 'Филиал больше недоступен' using errcode = '22023'; end if;
  select * into saved from public.branch_product_inventory
    where branch_id = selected_branch and product_id = p_stock->>'product_id' for update;
  if selected_source = 'iiko' and exists (
    select 1 from public.branch_front_inventory_sync where branch_id = selected_branch
  ) then
    if not exists(select 1 from public.branch_front_inventory_sync
      where branch_id = selected_branch and last_seen_at > now() - interval '45 seconds') then
      raise exception 'Нет свежих остатков iikoFront. Укажите количество вручную.' using errcode = '40001';
    end if;
    selected_quantity := saved.front_quantity;
  end if;
  perform set_config('bulka.stock_follow_iiko', 'true', true);
  insert into public.branch_product_inventory
    (branch_id, product_id, product_name, source_quantity, source, manual_stop, preparation_minutes)
    values (selected_branch, p_stock->>'product_id', left(p_stock->>'product_name',160),
      selected_quantity, selected_source, coalesce((p_stock->>'manual_stop')::boolean,false),
      (p_stock->>'preparation_minutes')::integer)
    on conflict(branch_id,product_id) do update set
      product_name = excluded.product_name, source_quantity = excluded.source_quantity,
      source = excluded.source, manual_stop = excluded.manual_stop,
      preparation_minutes = excluded.preparation_minutes, updated_at = now()
    returning * into saved;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.update_admin_inventory(jsonb) from public,anon,authenticated;
grant execute on function public.update_admin_inventory(jsonb) to service_role;
