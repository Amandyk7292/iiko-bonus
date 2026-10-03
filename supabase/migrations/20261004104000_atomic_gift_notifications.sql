create index customer_notifications_gift_purchase_idx
  on public.customer_notifications ((payload->>'giftPurchaseId')) where type='gift';

create function public.deliver_gift_certificate_notification(p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare purchase public.gift_certificate_purchases%rowtype; card public.gift_cards%rowtype;
  recipient public.customers%rowtype; recipient_id uuid; notice_id uuid;
  notification_title text:='Вам подарили сертификат Bulka'; notification_body text; tokens jsonb;
begin
  select * into purchase from public.gift_certificate_purchases where id=p_purchase_id;
  if not found or purchase.status<>'active' then return jsonb_build_object('status','unavailable'); end if;
  if purchase.delivery_at>now() then return jsonb_build_object('status','not_due'); end if;
  select * into card from public.gift_cards where id=purchase.gift_card_id;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  recipient_id:=card.recipient_customer_id;
  if recipient_id is null then
    select id into recipient_id from public.customers where phone=purchase.recipient_phone and deleted_at is null;
  end if;
  -- Privacy deletion and notification creation lock the customer first. The
  -- customer's inbox/outbox cannot be resurrected after anonymization.
  select * into recipient from public.customers where id=recipient_id and deleted_at is null for no key update;
  if not found then return jsonb_build_object('status','unregistered'); end if;
  select * into purchase from public.gift_certificate_purchases where id=p_purchase_id for update;
  if not found or purchase.status<>'active' or purchase.delivery_at>now() then return jsonb_build_object('status','unavailable'); end if;
  select * into card from public.gift_cards where id=purchase.gift_card_id for update;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  if card.recipient_customer_id is not null and card.recipient_customer_id<>recipient.id then
    return jsonb_build_object('status','unavailable'); end if;
  select id into notice_id from public.customer_notifications
    where customer_id=recipient.id and type='gift' and payload->>'giftPurchaseId'=purchase.id::text
    order by created_at limit 1;
  if purchase.recipient_notified_at is not null and notice_id is not null then
    return jsonb_build_object('status','already_delivered','notificationId',notice_id,'customerId',recipient.id);
  end if;
  update public.gift_cards set recipient_customer_id=recipient.id where id=card.id and recipient_customer_id is null;
  notification_body:=coalesce(nullif(purchase.recipient_name,''),'Для вас')||' — сертификат на '||
    replace(to_char(purchase.amount,'FM999G999G999G990'),',',' ')||' ₸ уже доступен.';
  if notice_id is null then
    notice_id:=gen_random_uuid();
    insert into public.customer_notifications(id,customer_id,title,body,type,payload)
      values(notice_id,recipient.id,notification_title,notification_body,'gift',jsonb_build_object(
        'messageKey','gift_certificate_received','giftPurchaseId',purchase.id,'giftCardLast4',card.code_last4));
  end if;
  select coalesce(jsonb_agg(t.token),'[]'::jsonb) into tokens from (
    select distinct token from (
      select btrim(token) as token from public.customer_push_tokens where customer_id=recipient.id
      union select btrim(recipient.fcm_token)
    ) active_tokens where nullif(token,'') is not null limit 100
  ) t;
  insert into public.push_notification_outbox(dedupe_key,customer_id,title,body,payload,pending_tokens)
    values('gift-certificate:'||purchase.id,recipient.id,notification_title,notification_body,jsonb_build_object(
      'type','gift_certificate_received','giftPurchaseId',purchase.id,'notificationId',notice_id,
      'deepLink','/profile?section=gift-cards'),tokens)
    on conflict(dedupe_key) do nothing;
  -- This is a completion marker, never a claim before the durable writes.
  update public.gift_certificate_purchases set recipient_notified_at=now(),updated_at=now() where id=purchase.id;
  return jsonb_build_object('status','delivered','notificationId',notice_id,'customerId',recipient.id);
end; $$;
revoke all on function public.deliver_gift_certificate_notification(uuid) from public,anon,authenticated;
grant execute on function public.deliver_gift_certificate_notification(uuid) to service_role;

-- Run once only AFTER promoting the new backend and stopping all old workers.
-- An old worker may still be between its non-atomic claim and inbox insertion
-- while migrations run. Never reset those live claims during the migration.
create function public.repair_incomplete_gift_notifications()
returns integer language plpgsql security definer set search_path=public as $$
declare repaired integer;
begin
  -- Existing inbox deliveries remain completed; never resend historical gifts
  -- whose direct-push outcome is unknown.
  update public.gift_certificate_purchases p set recipient_notified_at=null,updated_at=now()
  where p.status='active' and p.recipient_notified_at is not null and not exists (
    select 1 from public.customer_notifications n where n.type='gift' and n.payload->>'giftPurchaseId'=p.id::text
  );
  get diagnostics repaired = row_count;
  return repaired;
end; $$;
revoke all on function public.repair_incomplete_gift_notifications() from public,anon,authenticated;
grant execute on function public.repair_incomplete_gift_notifications() to service_role;
