-- These seven RPCs are invoked by Bulka backend services using service_role.
-- Remove explicit API-role grants left by historical Supabase default privileges.
-- Keep shared-app functions, trigger functions, all bodies and data unchanged.
revoke all on function
  public.admin_scoped_customers(uuid[],text,integer,integer),
  public.claim_partial_refund(uuid,uuid,uuid,numeric,text,text,jsonb),
  public.fail_partial_refund(uuid,text,boolean),
  public.complete_courier_delivery(uuid,uuid,uuid,text,text,numeric,numeric),
  public.claim_stock_subscription_notification(uuid),
  public.rotate_branch_pos_credential(uuid,text,text),
  public.verify_pickup_order_handoff(uuid,text,text,text)
from public,anon,authenticated;

grant execute on function
  public.admin_scoped_customers(uuid[],text,integer,integer),
  public.claim_partial_refund(uuid,uuid,uuid,numeric,text,text,jsonb),
  public.fail_partial_refund(uuid,text,boolean),
  public.complete_courier_delivery(uuid,uuid,uuid,text,text,numeric,numeric),
  public.claim_stock_subscription_notification(uuid),
  public.rotate_branch_pos_credential(uuid,text,text),
  public.verify_pickup_order_handoff(uuid,text,text,text)
to service_role;
