-- Gift-card mutations are called only by the authenticated backend using service_role.
-- Revoking PUBLIC alone does not remove explicit grants from Supabase default
-- privileges; CREATE OR REPLACE also preserves those grants on an existing RPC.
-- Do not change any function body, balance, reservation or historical migration.
revoke all on function
  public.reserve_gift_card_for_iiko(text,uuid,text,numeric,uuid,integer),
  public.prepare_gift_card_for_iiko(uuid,uuid,uuid),
  public.commit_gift_card_for_iiko(uuid,uuid),
  public.cancel_gift_card_for_iiko(uuid,uuid),
  public.redeem_gift_card(text,uuid),
  public.activate_gift_certificate_purchase(uuid),
  public.prepare_gift_certificate_refund(uuid),
  public.rollback_gift_certificate_refund(uuid),
  public.finalize_gift_certificate_refund(uuid),
  public.issue_admin_gift_card(uuid,text,text,text,text,numeric,uuid,uuid,text,text,timestamptz,text,numeric,integer)
from public,anon,authenticated;

grant execute on function
  public.reserve_gift_card_for_iiko(text,uuid,text,numeric,uuid,integer),
  public.prepare_gift_card_for_iiko(uuid,uuid,uuid),
  public.commit_gift_card_for_iiko(uuid,uuid),
  public.cancel_gift_card_for_iiko(uuid,uuid),
  public.redeem_gift_card(text,uuid),
  public.activate_gift_certificate_purchase(uuid),
  public.prepare_gift_certificate_refund(uuid),
  public.rollback_gift_certificate_refund(uuid),
  public.finalize_gift_certificate_refund(uuid),
  public.issue_admin_gift_card(uuid,text,text,text,text,numeric,uuid,uuid,text,text,timestamptz,text,numeric,integer)
to service_role;
