-- Clearing a cashier report starts a new visible reporting window for today.
-- Journal rows stay immutable for audit and reconciliation.
create table if not exists public.display_stock_report_resets (
  branch_id uuid not null references public.bulka_locations(id),
  business_date date not null,
  reset_at timestamptz not null default clock_timestamp(),
  reset_by text not null,
  primary key (branch_id, business_date)
);

alter table public.display_stock_report_resets enable row level security;
revoke all on public.display_stock_report_resets from public, anon, authenticated;
grant select, insert, update on public.display_stock_report_resets to service_role;

create or replace function public.reset_cashier_display_stock_report(
  p_branch uuid,
  p_actor text
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  current_date_local date := (now() at time zone 'Asia/Aqtau')::date;
  cleared_at timestamptz := clock_timestamp();
begin
  if p_actor is null or btrim(p_actor) = '' or char_length(p_actor) > 160 then
    raise exception 'Некорректный сотрудник' using errcode='22023';
  end if;
  perform id from public.bulka_locations where id=p_branch and active for update;
  if not found then
    raise exception 'Филиал больше недоступен' using errcode='P0001';
  end if;
  insert into public.display_stock_report_resets(branch_id,business_date,reset_at,reset_by)
  values(p_branch,current_date_local,cleared_at,left(btrim(p_actor),160))
  on conflict(branch_id,business_date) do update set
    reset_at=excluded.reset_at,
    reset_by=excluded.reset_by;
  return jsonb_build_object('date',current_date_local,'resetAt',cleared_at);
end;
$$;

create or replace function public.cashier_display_stock_report(
  p_branch uuid,p_date date,p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  start_at timestamptz;
  end_at timestamptz;
  visible_from timestamptz;
  reset_at_value timestamptz;
  result jsonb;
begin
  if p_date is null or p_date<'2020-01-01'::date
    or p_date>(now() at time zone 'Asia/Aqtau')::date
    or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception 'Некорректная дата отчёта' using errcode='22023';
  end if;
  start_at:=p_date::timestamp at time zone 'Asia/Aqtau';
  end_at:=(p_date+1)::timestamp at time zone 'Asia/Aqtau';
  select reset_at into reset_at_value from public.display_stock_report_resets
    where branch_id=p_branch and business_date=p_date;
  visible_from:=greatest(start_at,coalesce(reset_at_value,start_at));
  with changes as (
    select *,after_quantity-before_quantity delta from display_stock_changes
      where branch_id=p_branch and created_at>=visible_from and created_at<end_at
  ), products as (
    select product_id,unit,(array_agg(product_name order by created_at desc,id desc))[1] product_name,
      coalesce(sum(greatest(delta,0)) filter(
        where before_quantity is not null and reason='receipt'),0) added,
      coalesce(sum(greatest(delta,0)) filter(
        where before_quantity is not null and reason='correction'),0) correction_increase,
      coalesce(sum(greatest(-delta,0)) filter(
        where before_quantity is not null and reason='correction'),0) correction_decrease,
      coalesce(sum(greatest(delta,0)) filter(
        where before_quantity is not null and reason='recount'),0) recount_increase,
      coalesce(sum(greatest(-delta,0)) filter(
        where before_quantity is not null and reason='recount'),0) recount_decrease,
      coalesce(sum(after_quantity) filter(where before_quantity is null),0) initial_quantity,
      count(*) operations from changes group by product_id,unit
  ), events as (
    select * from changes order by created_at,id limit 100 offset p_offset
  ) select jsonb_build_object(
    'date',p_date,'timezone','Asia/Aqtau',
    'trackingStartedAt',greatest(
      (select started_at from display_stock_report_settings),visible_from
    ),
    'resetAt',reset_at_value,
    'products',coalesce((select jsonb_agg(to_jsonb(products) order by product_name,product_id,unit)
      from products),'[]'::jsonb),
    'totals',coalesce((select jsonb_agg(t) from (
      select unit,sum(added) added from products group by unit
        having sum(added)>0 order by unit
    ) t),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(events) order by created_at,id) from events),'[]'::jsonb),
    'eventCount',(select count(*) from changes),'offset',p_offset,
    'hasMore',(select count(*) from changes)>p_offset+100
  ) into result;
  return result;
end;
$$;

revoke all on function public.reset_cashier_display_stock_report(uuid,text),
  public.cashier_display_stock_report(uuid,date,integer)
  from public,anon,authenticated;
grant execute on function public.reset_cashier_display_stock_report(uuid,text),
  public.cashier_display_stock_report(uuid,date,integer)
  to service_role;
