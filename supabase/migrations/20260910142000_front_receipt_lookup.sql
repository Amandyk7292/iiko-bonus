create function public.lookup_front_stock_receipt(p_branch uuid,p_terminal uuid,p_receipt uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare sale front_stock_sales%rowtype; number bigint;
begin
  -- Same lock as authorization. A missing result never releases a server hold.
  perform id from bulka_locations where id=p_branch for update;
  select * into sale from front_stock_sales where branch_id=p_branch and receipt_id=p_receipt;
  if not found then return jsonb_build_object('status','absent'); end if;
  if sale.terminal_id is distinct from p_terminal then
    raise exception 'Чек закреплён за другой кассой' using errcode='P0001';
  end if;
  select order_number into number from kaspi_orders where id=sale.online_order_id;
  return jsonb_build_object('status',sale.status,'onlineNumber',number);
end;
$$;
revoke all on function public.lookup_front_stock_receipt(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.lookup_front_stock_receipt(uuid,uuid,uuid) to service_role;
