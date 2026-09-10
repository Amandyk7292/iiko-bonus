alter table public.front_stock_policies add column paused boolean not null default false,
  add column recount_id uuid;
create table public.front_stock_recounts (
  id uuid primary key,
  branch_id uuid not null references public.bulka_locations(id),
  terminal_id uuid not null,
  items jsonb not null,
  completed_at timestamptz not null default now()
);
alter table public.front_stock_recounts enable row level security;
revoke all on public.front_stock_recounts from public,anon,authenticated;
grant all on public.front_stock_recounts to service_role;

create or replace function public.front_stock_ready(p_branch uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists(select 1 from front_stock_policies p where p.branch_id=p_branch and p.enabled
    and (p.paused or exists(select 1 from unnest(p.terminal_ids) t(id) where not exists (
      select 1 from front_stock_terminals s where s.branch_id=p_branch and s.terminal_id=t.id
        and s.connected and s.protocol=1 and s.last_seen_at > now()-interval '45 seconds'))));
$$;

create function public.begin_front_stock_recount(p_branch uuid,p_terminal uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare policy front_stock_policies%rowtype;
begin
  perform id from bulka_locations where id=p_branch for update;
  select * into policy from front_stock_policies where branch_id=p_branch for update;
  if p_id is null or p_terminal is null or not found or not policy.enabled
    or not p_terminal=any(policy.terminal_ids) or not exists(select 1 from branch_front_inventory_sync where branch_id=p_branch and terminal_id=p_terminal) then
    raise exception 'Сверка выполняется на главной кассе настроенного филиала' using errcode='P0001';
  end if;
  if exists(select 1 from front_stock_recounts where id=p_id and branch_id=p_branch and terminal_id=p_terminal) then
    return jsonb_build_object('status','completed','recountId',p_id);
  end if;
  if policy.paused then
    update front_stock_policies set recount_id=coalesce(recount_id,p_id) where branch_id=p_branch returning * into policy;
    return jsonb_build_object('status','paused','recountId',policy.recount_id);
  end if;
  if exists(select 1 from front_stock_sales where branch_id=p_branch and status='reserved') then
    raise exception 'Сначала завершите или отмените незавершённые чеки. Неопределённые результаты требуют сверки.' using errcode='P0001';
  end if;
  if exists(select 1 from inventory_reservations where branch_id=p_branch and status='active' and expires_at>now()) then
    raise exception 'Покупатель сейчас оплачивает заказ. Дождитесь завершения оплаты.' using errcode='P0001';
  end if;
  update front_stock_policies set paused=true,recount_id=p_id,updated_at=now() where branch_id=p_branch;
  return jsonb_build_object('status','paused','recountId',p_id);
end;
$$;

create function public.finish_front_stock_recount(p_branch uuid,p_terminal uuid,p_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare policy front_stock_policies%rowtype; item jsonb; held integer;
begin
  perform id from bulka_locations where id=p_branch for update;
  if exists(select 1 from front_stock_recounts where id=p_id and branch_id=p_branch and terminal_id=p_terminal and items=p_items) then
    return jsonb_build_object('status','completed','recountId',p_id);
  end if;
  select * into policy from front_stock_policies where branch_id=p_branch for update;
  if not found or not policy.enabled or not policy.paused or policy.recount_id is distinct from p_id
    or p_terminal is null or not p_terminal=any(policy.terminal_ids)
    or not exists(select 1 from branch_front_inventory_sync where branch_id=p_branch and terminal_id=p_terminal)
    or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 450 then
    raise exception 'Сверка остатков не подтверждена' using errcode='P0001';
  end if;
  if exists(select 1 from front_stock_sales where branch_id=p_branch and status='reserved') then
    raise exception 'Есть незавершённый чек' using errcode='P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where x->>'productId' is null
    or length(x->>'productId') not between 1 and 100 or x->>'quantity' is null
    or x->>'quantity' !~ '^[0-9]{1,6}$' or (x->>'quantity')::integer>100000)
    or (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct x->>'productId') from jsonb_array_elements(p_items) x) then
    raise exception 'Некорректный состав сверки' using errcode='22023';
  end if;
  if exists(select 1 from inventory_reservations r where r.branch_id=p_branch and r.status='committed'
    and not exists(select 1 from jsonb_array_elements(p_items) x where x->>'productId'=r.product_id)) then
    raise exception 'В сверке отсутствует товар оплаченного онлайн-заказа' using errcode='P0001';
  end if;
  perform set_config('bulka.front_guard_write','true',true);
  perform set_config('bulka.stock_follow_iiko','true',true);
  -- Omitted items are UNKNOWN, never unlimited, in the strict allocation mode.
  update branch_product_inventory set source_quantity=null,updated_at=now() where branch_id=p_branch;
  for item in select value from jsonb_array_elements(p_items) order by value->>'productId' loop
    select coalesce(sum(quantity),0)::integer into held from inventory_reservations where branch_id=p_branch
      and product_id=item->>'productId' and status='committed';
    if (item->>'quantity')::integer<held then
      raise exception 'Фактического товара не хватает для оплаченных заказов. Нужна сверка заказа.' using errcode='P0001';
    end if;
    insert into branch_product_inventory(branch_id,product_id,product_name,source_quantity,source)
      values(p_branch,item->>'productId',left(item->>'productName',160),(item->>'quantity')::integer,'iiko')
      on conflict(branch_id,product_id) do update set source_quantity=excluded.source_quantity,source='iiko',updated_at=now();
  end loop;
  insert into front_stock_recounts(id,branch_id,terminal_id,items) values(p_id,p_branch,p_terminal,p_items);
  update front_stock_policies set paused=false,recount_id=null,updated_at=now() where branch_id=p_branch;
  return jsonb_build_object('status','completed','recountId',p_id);
end;
$$;

-- Enable only after explicitly identifying ALL registers and checking the physical counts.
create function public.enable_front_stock_guard(p_branch uuid,p_terminals uuid[],p_counts_confirmed boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform id from bulka_locations where id=p_branch and active for update;
  if not found or p_counts_confirmed is distinct from true or p_terminals is null
    or cardinality(p_terminals) not between 1 and 8 or array_position(p_terminals,null) is not null
    or cardinality(p_terminals)<>(select count(distinct t) from unnest(p_terminals) t) then
    raise exception 'Подтвердите кассы филиала и физический остаток' using errcode='22023';
  end if;
  if exists(select 1 from front_stock_policies where branch_id=p_branch and enabled) then
    raise exception 'Общий учёт уже включён. Для изменения касс требуется контролируемая остановка.' using errcode='P0001';
  end if;
  if not exists(select 1 from branch_front_inventory_sync where branch_id=p_branch and terminal_id=any(p_terminals) and last_seen_at>now()-interval '45 seconds')
    or exists(select 1 from unnest(p_terminals) t where not exists(select 1 from front_stock_terminals
      where branch_id=p_branch and terminal_id=t and connected and last_seen_at>now()-interval '45 seconds')) then
    raise exception 'Не все кассы подтверждают защиту и подключение' using errcode='P0001';
  end if;
  if exists(select 1 from inventory_reservations where branch_id=p_branch and
    (status='committed' or (status='active' and expires_at>now())))
    or exists(select 1 from kaspi_orders where branch_id=p_branch and status='paid' and fulfillment_status not in ('cancelled','completed')) then
    raise exception 'Завершите текущие онлайн-заказы перед первым включением' using errcode='P0001';
  end if;
  if not exists(select 1 from branch_product_inventory where branch_id=p_branch and source_quantity is not null) then
    raise exception 'Численные остатки ещё не заданы' using errcode='P0001';
  end if;
  insert into front_stock_policies(branch_id,enabled,terminal_ids) values(p_branch,true,p_terminals)
    on conflict(branch_id) do update set enabled=true,terminal_ids=excluded.terminal_ids,updated_at=now();
end;
$$;

create view public.branch_front_inventory_health as
  select b.id branch_id,s.last_seen_at,s.terminal_group_id,coalesce(p.enabled,false) guard_enabled,
    public.front_stock_ready(b.id) guard_ready from public.bulka_locations b
    left join public.branch_front_inventory_sync s on s.branch_id=b.id
    left join public.front_stock_policies p on p.branch_id=b.id where s.branch_id is not null or p.enabled;
revoke all on public.branch_front_inventory_health from public,anon,authenticated;
grant select on public.branch_front_inventory_health to service_role;

create function public.pause_unexplained_front_stock_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare held integer;
begin
  if current_setting('bulka.front_snapshot',true)='true' and exists(select 1 from front_stock_policies where branch_id=new.branch_id and enabled)
    and new.source_quantity is not null then
    select coalesce(sum(quantity),0)::integer into held from inventory_reservations where branch_id=new.branch_id and product_id=new.product_id
      and (status='committed' or (status='active' and expires_at>now()));
    if new.front_quantity is null or new.front_quantity<greatest(0,new.source_quantity-held) then
      update front_stock_policies set paused=true,updated_at=now() where branch_id=new.branch_id and not paused;
    end if;
  end if;
  return new;
end;
$$;
create trigger pause_unexplained_front_stock_change after update on public.branch_product_inventory
  for each row execute function public.pause_unexplained_front_stock_change();
revoke all on function public.begin_front_stock_recount(uuid,uuid,uuid),public.finish_front_stock_recount(uuid,uuid,uuid,jsonb),
  public.enable_front_stock_guard(uuid,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.begin_front_stock_recount(uuid,uuid,uuid),public.finish_front_stock_recount(uuid,uuid,uuid,jsonb),
  public.enable_front_stock_guard(uuid,uuid[],boolean) to service_role;
