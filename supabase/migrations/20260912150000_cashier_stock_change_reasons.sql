-- Distinguish real display receipts from corrections and recounts.
alter table public.display_stock_changes add column if not exists reason text;
update public.display_stock_changes
set reason = case when source = 'recount' then 'recount' else 'correction' end
where reason is null;
alter table public.display_stock_changes alter column reason set default 'correction';
-- migration-safety: allow-destructive reason=all existing rows are backfilled above before enforcing the required reporting reason
alter table public.display_stock_changes alter column reason set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.display_stock_changes'::regclass
      and conname = 'display_stock_changes_reason_check'
  ) then
    alter table public.display_stock_changes
      add constraint display_stock_changes_reason_check
      check (reason in ('receipt', 'correction', 'recount'));
  end if;
end;
$$;

create or replace function public.record_display_stock_change(
  p_branch uuid,
  p_product text,
  p_before numeric,
  p_source text,
  p_key text,
  p_reason text
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_reason is null or p_reason not in ('receipt', 'correction', 'recount') then
    raise exception 'Некорректная причина изменения остатка' using errcode='22023';
  end if;
  insert into display_stock_changes(
    branch_id,product_id,product_name,unit,before_quantity,after_quantity,source,operation_key,reason
  )
    select branch_id,product_id,coalesce(nullif(product_name,''),product_id),unit,
      p_before,source_quantity,p_source,p_key,p_reason
    from branch_product_inventory
    where branch_id=p_branch and product_id=p_product
      and source_quantity is not null and source_quantity is distinct from p_before
    on conflict(operation_key) do nothing;
end;
$$;

create or replace function public.record_display_stock_change(
  p_branch uuid,p_product text,p_before numeric,p_source text,p_key text
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform record_display_stock_change(
    p_branch,p_product,p_before,p_source,p_key,
    case when p_source='recount' then 'recount' else 'correction' end
  );
end;
$$;

create or replace function public.update_cashier_inventory(
  p_branch_id uuid,p_product_id text,p_product_name text,p_expected_revision bigint,p_changes jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous numeric; result jsonb; requested_reason text; clean_changes jsonb;
begin
  if p_changes ? 'stockReason' and not p_changes ? 'sourceQuantity' then
    raise exception 'Причина указывается только при изменении количества' using errcode='22023';
  end if;
  if p_changes ? 'sourceQuantity' then
    requested_reason:=p_changes->>'stockReason';
    if requested_reason is null or requested_reason not in ('receipt','correction') then
      raise exception 'Выберите причину изменения остатка' using errcode='22023';
    end if;
  end if;
  clean_changes:=p_changes-'stockReason';
  perform id from bulka_locations where id=p_branch_id for update;
  select source_quantity into previous from branch_product_inventory
    where branch_id=p_branch_id and product_id=p_product_id for update;
  result:=update_cashier_inventory_before_report(
    p_branch_id,p_product_id,p_product_name,p_expected_revision,clean_changes
  );
  if clean_changes ? 'sourceQuantity' then
    perform record_display_stock_change(
      p_branch_id,p_product_id,previous,'cashier',
      'cashier:'||p_branch_id||':'||p_product_id||':'||p_expected_revision,
      requested_reason
    );
  end if;
  return result;
end;
$$;

create or replace function public.update_admin_inventory(p_stock jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous numeric; result jsonb; branch uuid:=(p_stock->>'branch_id')::uuid;
  requested_reason text:=coalesce(nullif(p_stock->>'stock_reason',''),'correction');
begin
  if p_stock->>'source_quantity' is not null and requested_reason not in ('receipt','correction') then
    raise exception 'Некорректная причина изменения остатка' using errcode='22023';
  end if;
  perform id from bulka_locations where id=branch for update;
  select source_quantity into previous from branch_product_inventory
    where branch_id=branch and product_id=p_stock->>'product_id' for update;
  result:=update_admin_inventory_before_report(p_stock-'stock_reason');
  if p_stock->>'source_quantity' is not null then
    perform record_display_stock_change(
      branch,p_stock->>'product_id',previous,'admin','admin:'||gen_random_uuid(),requested_reason
    );
  end if;
  return result;
end;
$$;

create or replace function public.finish_front_stock_recount(
  p_branch uuid,p_terminal uuid,p_id uuid,p_items jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous jsonb; item jsonb; result jsonb; already_done boolean;
begin
  perform id from bulka_locations where id=p_branch for update;
  select exists(select 1 from front_stock_recounts where id=p_id) into already_done;
  select jsonb_object_agg(product_id,source_quantity) into previous
    from branch_product_inventory where branch_id=p_branch;
  result:=finish_front_stock_recount_before_report(p_branch,p_terminal,p_id,p_items);
  if not already_done then
    for item in select value from jsonb_array_elements(p_items) loop
      perform record_display_stock_change(
        p_branch,item->>'productId',(previous->>(item->>'productId'))::numeric,
        'recount','recount:'||p_id||':'||(item->>'productId'),'recount'
      );
    end loop;
  end if;
  return result;
end;
$$;

create or replace function public.cashier_display_stock_report(
  p_branch uuid,p_date date,p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare start_at timestamptz; end_at timestamptz; result jsonb;
begin
  if p_date is null or p_date<'2020-01-01'::date
    or p_date>(now() at time zone 'Asia/Aqtau')::date
    or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception 'Некорректная дата отчёта' using errcode='22023';
  end if;
  start_at:=p_date::timestamp at time zone 'Asia/Aqtau';
  end_at:=(p_date+1)::timestamp at time zone 'Asia/Aqtau';
  with changes as (
    select *,after_quantity-before_quantity delta from display_stock_changes
      where branch_id=p_branch and created_at>=start_at and created_at<end_at
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
    'trackingStartedAt',(select started_at from display_stock_report_settings),
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

revoke all on function public.record_display_stock_change(uuid,text,numeric,text,text,text),
  public.record_display_stock_change(uuid,text,numeric,text,text),
  public.update_cashier_inventory(uuid,text,text,bigint,jsonb),
  public.update_admin_inventory(jsonb),public.finish_front_stock_recount(uuid,uuid,uuid,jsonb),
  public.cashier_display_stock_report(uuid,date,integer) from public,anon,authenticated;
grant execute on function public.update_cashier_inventory(uuid,text,text,bigint,jsonb),
  public.update_admin_inventory(jsonb),public.finish_front_stock_recount(uuid,uuid,uuid,jsonb),
  public.cashier_display_stock_report(uuid,date,integer) to service_role;
