alter table public.front_stock_policies add column control_mode text not null default 'front'
  check(control_mode in ('front','tablet'));
create table public.front_stock_control_events(
  id uuid primary key, branch_id uuid not null references bulka_locations(id),
  actor text not null, mode text not null, created_at timestamptz not null default now()
);
alter table public.front_stock_control_events enable row level security;
revoke all on public.front_stock_control_events from public,anon,authenticated;
grant all on public.front_stock_control_events to service_role;

create or replace function public.front_stock_ready(p_branch uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from front_stock_policies p where p.branch_id=p_branch and p.enabled
    and (p.paused or (p.control_mode='front' and not exists(
      select 1 from front_stock_terminals s where s.branch_id=p_branch
        and s.terminal_id=any(p.terminal_ids) and s.connected and s.protocol=1
        and s.last_seen_at>now()-interval '45 seconds'))));
$$;

create or replace function public.front_stock_heartbeat(p_branch uuid,p_terminal uuid,p_connected boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare policy front_stock_policies%rowtype;
begin
  if p_terminal is null or p_connected is null or not exists(select 1 from bulka_locations where id=p_branch and active) then
    raise exception 'Некорректная касса' using errcode='22023';
  end if;
  insert into front_stock_terminals values(p_branch,p_terminal,now(),p_connected,1)
    on conflict(branch_id,terminal_id) do update set last_seen_at=now(),connected=excluded.connected,protocol=1;
  select * into policy from front_stock_policies where branch_id=p_branch;
  return jsonb_build_object('enabled',coalesce(policy.enabled,false),
    'registered',coalesce(p_terminal=any(policy.terminal_ids),false),
    'ready',front_stock_ready(p_branch) and coalesce(policy.control_mode='front',true),
    'controlMode',coalesce(policy.control_mode,'front'));
end;
$$;

-- An offline register cannot borrow the remaining register's heartbeat.
-- Already authorized receipts may still report their terminal outcome.
create function public.protect_front_terminal_sale() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='reserved' and not exists(
    select 1 from front_stock_policies p join front_stock_terminals t
      on t.branch_id=p.branch_id and t.terminal_id=new.terminal_id
    where p.branch_id=new.branch_id and p.enabled and not p.paused and p.control_mode='front'
      and new.terminal_id=any(p.terminal_ids) and t.connected and t.protocol=1
      and t.last_seen_at>now()-interval '45 seconds') then
    raise exception 'Эта касса недоступна или учёт временно ведётся с планшета' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger protect_front_terminal_sale before insert or update on public.front_stock_sales
  for each row execute function public.protect_front_terminal_sale();

create function public.begin_tablet_stock_control(p_branch uuid,p_actor text,p_request uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare policy front_stock_policies%rowtype;
begin
  perform id from bulka_locations where id=p_branch and active for update;
  if not found or p_request is null or length(coalesce(p_actor,'')) not between 1 and 200 then
    raise exception 'Филиал или сотрудник недоступен' using errcode='P0001';
  end if;
  select * into policy from front_stock_policies where branch_id=p_branch for update;
  if not found or not policy.enabled then raise exception 'Общий учёт ещё не включён' using errcode='P0001'; end if;
  if exists(select 1 from front_stock_control_events where id=p_request and branch_id=p_branch and actor=p_actor) then
    return jsonb_build_object('controlMode',policy.control_mode);
  end if;
  if policy.paused or policy.recount_id is not null then
    raise exception 'Сначала завершите начатую сверку остатков' using errcode='P0001';
  end if;
  update front_stock_policies set control_mode='tablet',updated_at=now() where branch_id=p_branch;
  insert into front_stock_control_events(id,branch_id,actor,mode) values(p_request,p_branch,p_actor,'tablet');
  return jsonb_build_object('controlMode','tablet');
end;
$$;

alter function public.update_cashier_inventory(uuid,text,text,bigint,jsonb) rename to update_cashier_inventory_before_tablet;
create function public.update_cashier_inventory(p_branch_id uuid,p_product_id text,p_product_name text,
  p_expected_revision bigint,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare policy front_stock_policies%rowtype; held numeric;
begin
  perform id from bulka_locations where id=p_branch_id for update;
  select * into policy from front_stock_policies where branch_id=p_branch_id for update;
  if policy.enabled and p_changes ? 'sourceQuantity' then
    if policy.control_mode<>'tablet' or policy.paused then
      raise exception 'Включите резервное управление с планшета или измените остаток на кассе' using errcode='P0001';
    end if;
    if exists(select 1 from front_stock_sales where branch_id=p_branch_id and status='reserved' and items ? p_product_id) then
      raise exception 'По этому товару есть незавершённый кассовый чек. Сначала сверяйте его итог.' using errcode='P0001';
    end if;
    select coalesce(sum(quantity),0) into held from inventory_reservations where branch_id=p_branch_id and product_id=p_product_id
      and (status='committed' or (status='active' and expires_at>now()));
    if (p_changes->>'sourceQuantity')::numeric<held then
      raise exception 'Количество меньше резерва оплачиваемых и оплаченных заказов' using errcode='P0001';
    end if;
    perform set_config('bulka.front_guard_write','true',true);
  end if;
  if policy.enabled and p_changes ? 'useIiko' then
    raise exception 'Возврат управления кассе выполняется полной сверкой на главной кассе' using errcode='P0001';
  end if;
  return update_cashier_inventory_before_tablet(p_branch_id,p_product_id,p_product_name,p_expected_revision,p_changes);
end;
$$;

-- Returning to Front requires its full, physically confirmed recount.
create function public.return_front_control_after_recount() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update front_stock_policies set control_mode='front',updated_at=now() where branch_id=new.branch_id;
  insert into front_stock_control_events(id,branch_id,actor,mode)
    values(gen_random_uuid(),new.branch_id,'iikofront:'||new.terminal_id,'front');
  return new;
end;
$$;
create trigger return_front_control_after_recount after insert on public.front_stock_recounts
  for each row execute function public.return_front_control_after_recount();

create or replace function public.pause_unexplained_front_stock_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare held numeric;
begin
  if current_setting('bulka.front_snapshot',true)='true' and exists(select 1 from front_stock_policies
      where branch_id=new.branch_id and enabled and control_mode='front') and new.source_quantity is not null then
    select coalesce(sum(quantity),0) into held from inventory_reservations where branch_id=new.branch_id and product_id=new.product_id
      and (status='committed' or (status='active' and expires_at>now()));
    if new.front_quantity is null or new.front_quantity<greatest(0,new.source_quantity-held) then
      update front_stock_policies set paused=true,updated_at=now() where branch_id=new.branch_id and not paused;
    end if;
  end if;
  return new;
end;
$$;

create or replace view public.branch_front_inventory_health as
  select b.id branch_id,s.last_seen_at,s.terminal_group_id,coalesce(p.enabled,false) guard_enabled,
    public.front_stock_ready(b.id) guard_ready,coalesce(p.control_mode,'front') control_mode
  from public.bulka_locations b
    left join public.branch_front_inventory_sync s on s.branch_id=b.id
    left join public.front_stock_policies p on p.branch_id=b.id where s.branch_id is not null or p.enabled;
revoke all on function public.protect_front_terminal_sale(),public.begin_tablet_stock_control(uuid,text,uuid),
  public.update_cashier_inventory(uuid,text,text,bigint,jsonb),public.return_front_control_after_recount() from public,anon,authenticated;
grant execute on function public.begin_tablet_stock_control(uuid,text,uuid),
  public.update_cashier_inventory(uuid,text,text,bigint,jsonb) to service_role;
