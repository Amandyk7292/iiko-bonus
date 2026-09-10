-- A broken main register must not be required to finish its old recount.
-- Transfer control explicitly, keep allocations and mark unverified counts unknown.
create or replace function public.begin_tablet_stock_control(p_branch uuid,p_actor text,p_request uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare policy front_stock_policies%rowtype; needs_count boolean;
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
  needs_count:=policy.paused or policy.recount_id is not null;
  if needs_count then
    perform set_config('bulka.front_guard_write','true',true);
    perform set_config('bulka.stock_follow_iiko','true',true);
    update branch_product_inventory set source_quantity=null,updated_at=now() where branch_id=p_branch;
  end if;
  update front_stock_policies set control_mode='tablet',paused=false,recount_id=null,updated_at=now() where branch_id=p_branch;
  insert into front_stock_control_events(id,branch_id,actor,mode) values(p_request,p_branch,p_actor,'tablet');
  return jsonb_build_object('controlMode','tablet','countsRequired',needs_count);
end;
$$;
