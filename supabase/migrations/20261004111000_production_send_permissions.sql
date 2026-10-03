begin;

-- Recheck permission for durable pending acts as well as newly claimed ones.
-- Lock order matches claim/resolve (point first), so toggles have a precise
-- boundary before HTTP. Frozen UUIDs, items and allocations are never replaced.
create or replace function public.begin_cashier_production_send(p_branch uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.cashier_iiko_production_acts%rowtype;
        b public.cashier_iiko_production_bindings%rowtype;
begin
 perform id from public.bulka_locations where id=p_branch and active for update;
 if not found then raise exception 'IIKO_PRODUCTION_BRANCH_UNAVAILABLE'; end if;
 select * into b from public.cashier_iiko_production_bindings where branch_id=p_branch for update;
 if not found then raise exception 'IIKO_PRODUCTION_BINDING_MISSING'; end if;
 if not b.enabled then raise exception 'IIKO_PRODUCTION_DISABLED'; end if;
 update public.cashier_iiko_production_acts set status='sending',error=null,error_code=null,updated_at=clock_timestamp()
  where id=p_request and branch_id=p_branch and status='pending' and send_started_at is null returning * into a;
 if not found then return null; end if;
 return to_jsonb(a);
end;
$$;

create or replace function public.start_cashier_production_http(p_branch uuid,p_request uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare point_active boolean; binding_enabled boolean; permission_error text;
begin
 select active into point_active from public.bulka_locations where id=p_branch for update;
 select enabled into binding_enabled from public.cashier_iiko_production_bindings where branch_id=p_branch for update;
 permission_error := case when point_active is distinct from true then 'IIKO_PRODUCTION_BRANCH_UNAVAILABLE'
   when binding_enabled is null then 'IIKO_PRODUCTION_BINDING_MISSING'
   when not binding_enabled then 'IIKO_PRODUCTION_DISABLED' end;
 if permission_error is not null then
  -- This request has never crossed the HTTP fence: it is safe to keep pending
  -- for an explicit resume after re-enabling. Never reset an uncertain send.
  update public.cashier_iiko_production_acts set status='pending',error_code=permission_error,
   error='Отправка отложена: точка или отправка актов отключена',updated_at=clock_timestamp()
   where id=p_request and branch_id=p_branch and status='sending' and send_started_at is null;
  return false;
 end if;
 update public.cashier_iiko_production_acts set send_started_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_request and branch_id=p_branch and status='sending' and send_started_at is null;
 return found;
end;
$$;
revoke all on function public.begin_cashier_production_send(uuid,uuid),public.start_cashier_production_http(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.begin_cashier_production_send(uuid,uuid),public.start_cashier_production_http(uuid,uuid) to service_role;
commit;
