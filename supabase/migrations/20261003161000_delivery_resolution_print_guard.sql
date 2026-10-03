-- Block fresh printing until delivery replacement is resolved.
create or replace function public.front_receipt_job_action(p_branch uuid,p_terminal uuid,p_order uuid,p_action text,
  p_receipt uuid default null,p_items jsonb default null,p_total numeric default null,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job front_receipt_jobs%rowtype; target kaspi_orders%rowtype; expected jsonb; result jsonb; receipt jsonb;
begin
  perform id from bulka_locations where id=p_branch and active for update;
  if not found or not exists(select 1 from pos_devices where branch_id=p_branch and terminal_id=p_terminal and active) then
    raise exception 'Касса не привязана к филиалу' using errcode='P0001';
  end if;
  select * into target from kaspi_orders where id=p_order and branch_id=p_branch for update;
  select * into job from front_receipt_jobs where order_id=p_order and branch_id=p_branch for update;
  if job.order_id is null then raise exception 'Нет задания на кассовый чек' using errcode='P0001'; end if;
  if job.terminal_id is not null and job.terminal_id<>p_terminal then
    raise exception 'Этот чек уже выполняется другой кассой' using errcode='P0001';
  end if;
  -- Lock order and print job before checking the replacement decision. A stale
  -- terminal cannot print or fiscalize a delivery while the customer/cashier decides.
  if p_action in ('claim','bind','assembly-claim','verify','complete')
    and coalesce(target.delivery_resolution->>'status','') in
      ('pending','pickup_cancelling','cancel_cancelling','pickup_pending_approval','pickup_accepting',
       'pickup_rejecting','cancel_refunding') then
    raise exception 'Замена доставки ожидает решения клиента или кассира' using errcode='P0001';
  end if;
  if p_action='problem' and (job.terminal_id=p_terminal or job.terminal_id is null) then
    update front_receipt_jobs set last_error=left(p_error,400),updated_at=now() where order_id=p_order and status<>'completed';
    return jsonb_build_object('status',job.status);
  end if;
  if p_action='return' then
    if job.status<>'completed' or job.receipt_id is distinct from p_receipt or target.refund_status is distinct from 'succeeded' then
      raise exception 'Сначала оформите и завершите возврат в Bulka' using errcode='P0001';
    end if;
    if job.expected_items is null or job.expected_items is distinct from p_items or job.expected_total is distinct from p_total then
      raise exception 'Состав или сумма возврата не совпадает с исходным чеком Bulka' using errcode='P0001';
    end if;
    return jsonb_build_object('status','refunded','number',target.order_number);
  end if;
  receipt:=front_remaining_receipt(p_order);
  if not coalesce((receipt->>'ready')::boolean,false) then
    raise exception 'Оплата заказа не подтверждена либо выполняется возврат' using errcode='P0001';
  end if;
  if p_action='claim' then
    if job.receipt_id is null or not job.fiscal_started then
      update front_receipt_jobs set expected_items=receipt->'items',expected_total=(receipt->>'total')::numeric where order_id=p_order;
    end if;
    update front_receipt_jobs set terminal_id=p_terminal,fiscal_started=fiscal_started or fiscal_due,status=case when status='completed' then status else 'assigned' end,
      updated_at=now() where order_id=p_order returning * into job;
    return jsonb_build_object('status',job.status,'receiptId',job.receipt_id,'number',target.order_number);
  end if;
  if job.terminal_id is distinct from p_terminal or p_receipt is null then
    raise exception 'Сначала закрепите чек за кассой' using errcode='P0001';
  end if;
  if p_action='bind' then
    if job.receipt_id is not null and job.receipt_id<>p_receipt then
      raise exception 'Заказ уже связан с другим чеком' using errcode='P0001';
    end if;
    if exists(select 1 from front_stock_sales where online_order_id=p_order and status<>'voided' and receipt_id<>p_receipt) then
      raise exception 'Онлайн-заказ уже пробивается в другом чеке' using errcode='P0001';
    end if;
    update front_receipt_jobs set receipt_id=p_receipt,updated_at=now() where order_id=p_order;
    return jsonb_build_object('status',job.status,'receiptId',p_receipt);
  end if;
  if job.receipt_id is distinct from p_receipt then raise exception 'Чек не связан с заказом' using errcode='P0001'; end if;
  if p_action='assembly-claim' then
    if job.assembly_status='printed' then return jsonb_build_object('status','printed'); end if;
    if job.assembly_status<>'pending' then
      raise exception 'Печать сборочного чека не подтверждена. Проверьте принтер и выполните повторную печать вручную' using errcode='P0001';
    end if;
    update front_receipt_jobs set assembly_status='printing',updated_at=now() where order_id=p_order;
    return jsonb_build_object('status','print');
  elsif p_action='assembly-complete' then
    if job.assembly_status not in ('printing','printed') then raise exception 'Печать не начата' using errcode='P0001'; end if;
    update front_receipt_jobs set assembly_status='printed',last_error=null,updated_at=now() where order_id=p_order;
    return jsonb_build_object('status','printed');
  end if;
  if not job.fiscal_due then raise exception 'Фискальная печать ожидает выдачи заказа' using errcode='P0001'; end if;
  expected:=job.expected_items;
  if expected is null or expected is distinct from p_items or expected is distinct from receipt->'items'
    or p_total is distinct from job.expected_total
    or p_total is distinct from (receipt->>'total')::numeric then
    raise exception 'Состав или сумма чека не совпадает с оплаченным заказом Bulka' using errcode='P0001';
  end if;
  if p_action='verify' then
    if job.status='completed' then raise exception 'Чек уже закрыт. Повторная оплата запрещена' using errcode='P0001'; end if;
    return jsonb_build_object('status','verified','number',target.order_number);
  elsif p_action='complete' then
    update front_receipt_jobs set status='completed',last_error=null,updated_at=now() where order_id=p_order;
    update kaspi_orders set pos_receipt_due=false where id=p_order;
    return jsonb_build_object('status','completed','number',target.order_number);
  end if;
  raise exception 'Неизвестное действие чека' using errcode='22023';
end;
$$;

-- Preserve a previously printed assembly ticket after approval. Installed
-- terminals remember that print locally; resetting only the server status
-- would strand their durable acknowledgement and block later fiscalization.
-- The web cashier shows the replacement badge; no receipt or payment is replayed.
