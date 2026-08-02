-- Complete customer privacy lifecycle across application, WhatsApp and exports.

alter table public.whatsapp_conversations
  add column if not exists customer_id uuid
    references public.customers(id) on delete set null;

alter table public.whatsapp_outbox
  add column if not exists customer_id uuid
    references public.customers(id) on delete set null;

create index if not exists whatsapp_conversations_customer_idx
  on public.whatsapp_conversations(customer_id)
  where customer_id is not null;

create index if not exists whatsapp_outbox_customer_idx
  on public.whatsapp_outbox(customer_id)
  where customer_id is not null;

update public.whatsapp_conversations conversation
set customer_id = (
  select customer.id
  from public.customers customer
  where customer.deleted_at is null
    and right(regexp_replace(customer.phone, '\D', '', 'g'), 10)
      = right(
          regexp_replace(
            coalesce(conversation.phone, split_part(conversation.chat_jid, '@', 1)),
            '\D',
            '',
            'g'
          ),
          10
        )
  order by customer.updated_at desc nulls last
  limit 1
)
where conversation.customer_id is null
  and length(
    regexp_replace(
      coalesce(conversation.phone, split_part(conversation.chat_jid, '@', 1)),
      '\D',
      '',
      'g'
    )
  ) >= 10;

update public.whatsapp_outbox outbox
set customer_id = (
  select customer.id
  from public.customers customer
  where customer.deleted_at is null
    and right(regexp_replace(customer.phone, '\D', '', 'g'), 10)
      = right(regexp_replace(split_part(outbox.chat_jid, '@', 1), '\D', '', 'g'), 10)
  order by customer.updated_at desc nulls last
  limit 1
)
where outbox.customer_id is null
  and length(regexp_replace(split_part(outbox.chat_jid, '@', 1), '\D', '', 'g')) >= 10;

create or replace function public.link_whatsapp_conversation_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  phone_digits text;
begin
  if new.customer_id is not null then
    return new;
  end if;
  phone_digits := right(
    regexp_replace(coalesce(new.phone, split_part(new.chat_jid, '@', 1)), '\D', '', 'g'),
    10
  );
  if length(phone_digits) <> 10 then
    return new;
  end if;
  select customer.id
  into new.customer_id
  from public.customers customer
  where customer.deleted_at is null
    and right(regexp_replace(customer.phone, '\D', '', 'g'), 10) = phone_digits
  order by customer.updated_at desc nulls last
  limit 1;
  return new;
end;
$$;

create or replace function public.link_whatsapp_outbox_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  phone_digits text;
begin
  if new.customer_id is not null then
    return new;
  end if;
  phone_digits := right(
    regexp_replace(split_part(new.chat_jid, '@', 1), '\D', '', 'g'),
    10
  );
  if length(phone_digits) <> 10 then
    return new;
  end if;
  select customer.id
  into new.customer_id
  from public.customers customer
  where customer.deleted_at is null
    and right(regexp_replace(customer.phone, '\D', '', 'g'), 10) = phone_digits
  order by customer.updated_at desc nulls last
  limit 1;
  return new;
end;
$$;

drop trigger if exists whatsapp_conversations_link_customer
  on public.whatsapp_conversations;
create trigger whatsapp_conversations_link_customer
before insert or update of phone, chat_jid, customer_id
on public.whatsapp_conversations
for each row execute function public.link_whatsapp_conversation_customer();

drop trigger if exists whatsapp_outbox_link_customer
  on public.whatsapp_outbox;
create trigger whatsapp_outbox_link_customer
before insert or update of chat_jid, customer_id
on public.whatsapp_outbox
for each row execute function public.link_whatsapp_outbox_customer();

revoke all on function public.link_whatsapp_conversation_customer()
  from public, anon, authenticated;
revoke all on function public.link_whatsapp_outbox_customer()
  from public, anon, authenticated;

alter table public.customer_privacy_requests
  add column if not exists export_expires_at timestamptz,
  add column if not exists payload_purged_at timestamptz;

update public.customer_privacy_requests
set
  export_payload = null,
  export_expires_at = coalesce(export_expires_at, now()),
  payload_purged_at = coalesce(payload_purged_at, now())
where export_payload is not null;

create or replace function public.purge_expired_customer_exports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  purged_count integer;
begin
  update public.customer_privacy_requests
  set
    export_payload = null,
    payload_purged_at = coalesce(payload_purged_at, now())
  where export_payload is not null
    and coalesce(export_expires_at, requested_at + interval '24 hours') <= now();
  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

revoke all on function public.purge_expired_customer_exports()
  from public, anon, authenticated;
grant execute on function public.purge_expired_customer_exports()
  to service_role;

create or replace function public.delete_customer_personal_data(
  p_customer_id uuid,
  p_deleted_phone text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_row public.customers%rowtype;
  raw_customer_phone_digits text;
  customer_phone_digits text;
  completed_time timestamptz := now();
begin
  if p_customer_id is null
    or p_request_id is null
    or p_deleted_phone !~ '^deleted-[0-9a-f]{20}$'
  then
    raise exception 'invalid privacy deletion arguments';
  end if;

  select *
  into customer_row
  from public.customers
  where id = p_customer_id
  for update;

  if customer_row.id is null then
    return jsonb_build_object('deleted', false, 'reason', 'not_found');
  end if;

  raw_customer_phone_digits := regexp_replace(customer_row.phone, '\D', '', 'g');
  customer_phone_digits := case
    when customer_row.deleted_at is null and length(raw_customer_phone_digits) >= 10
      then right(raw_customer_phone_digits, 10)
    else null
  end;

  delete from public.referral_redemptions redemption
  where redemption.referred_customer_id = p_customer_id
    or redemption.referral_code_id in (
      select code.id
      from public.referral_codes code
      where code.customer_id = p_customer_id
    );
  delete from public.referral_codes where customer_id = p_customer_id;
  delete from public.promotion_redemptions where customer_id = p_customer_id;
  delete from public.order_reviews where customer_id = p_customer_id;
  delete from public.customer_credentials where customer_id = p_customer_id;
  delete from public.customer_refresh_tokens where customer_id = p_customer_id;
  delete from public.customer_addresses where customer_id = p_customer_id;
  delete from public.customer_favorites where customer_id = p_customer_id;
  delete from public.customer_recent_products where customer_id = p_customer_id;
  delete from public.customer_cart_snapshots where customer_id = p_customer_id;
  delete from public.customer_notifications where customer_id = p_customer_id;
  delete from public.customer_app_events where customer_id = p_customer_id;
  delete from public.marketing_deliveries where customer_id = p_customer_id;
  delete from public.customer_push_tokens where customer_id = p_customer_id;
  delete from public.customer_notification_preferences where customer_id = p_customer_id;
  delete from public.customer_live_activity_tokens where customer_id = p_customer_id;
  delete from public.customer_support_requests where customer_id = p_customer_id;
  delete from public.inventory_reservations where customer_id = p_customer_id;
  delete from public.fulfillment_slot_reservations where customer_id = p_customer_id;
  delete from public.loyalty_reservations where customer_id = p_customer_id;

  delete from public.whatsapp_conversations conversation
  where conversation.customer_id = p_customer_id
    or (
      customer_phone_digits is not null
      and right(
        regexp_replace(
          coalesce(conversation.phone, split_part(conversation.chat_jid, '@', 1)),
          '\D',
          '',
          'g'
        ),
        10
      ) = customer_phone_digits
    );
  delete from public.whatsapp_outbox outbox
  where outbox.customer_id = p_customer_id
    or (
      customer_phone_digits is not null
      and right(regexp_replace(split_part(outbox.chat_jid, '@', 1), '\D', '', 'g'), 10)
        = customer_phone_digits
    );

  update public.targeted_promotions
  set customer_ids = array_remove(customer_ids, p_customer_id)
  where p_customer_id = any(customer_ids);

  update public.gift_cards
  set purchaser_customer_id = null
  where purchaser_customer_id = p_customer_id;
  update public.gift_cards
  set
    recipient_customer_id = null,
    recipient_name = null,
    message = null
  where recipient_customer_id = p_customer_id;
  update public.gift_card_transactions
  set customer_id = null
  where customer_id = p_customer_id;
  update public.payment_receipts
  set customer_id = null
  where customer_id = p_customer_id;
  update public.transactions
  set customer_id = null
  where customer_id = p_customer_id;

  update public.kaspi_orders
  set
    customer_id = null,
    phone = 'deleted-' || left(replace(id::text, '-', ''), 20),
    additional_phone = null,
    delivery_address = case
      when fulfillment_type = 'delivery' then '{"redacted":true}'::jsonb
      else null
    end,
    delivery_latitude = case when fulfillment_type = 'delivery' then 0 else null end,
    delivery_longitude = case when fulfillment_type = 'delivery' then 0 else null end,
    comment = null,
    qr_token = null,
    updated_at = completed_time
  where customer_id = p_customer_id
    or (
      customer_phone_digits is not null
      and right(regexp_replace(phone, '\D', '', 'g'), 10) = customer_phone_digits
    );

  update public.customer_privacy_requests
  set
    customer_id = null,
    export_payload = null,
    export_expires_at = coalesce(export_expires_at, completed_time),
    payload_purged_at = coalesce(payload_purged_at, completed_time)
  where customer_id = p_customer_id;

  update public.customers
  set
    phone = p_deleted_phone,
    name = 'Удалённый пользователь',
    last_name = null,
    email = null,
    birth_date = null,
    gender = null,
    region = null,
    telegram_id = null,
    fcm_token = null,
    preferred_language = 'ru',
    tags = '{}',
    balance = 0,
    total_spent = 0,
    deleted_at = coalesce(deleted_at, completed_time),
    updated_at = completed_time
  where id = p_customer_id;

  update public.customer_privacy_requests
  set
    status = 'completed',
    customer_id = null,
    export_payload = null,
    error = null,
    completed_at = completed_time,
    payload_purged_at = coalesce(payload_purged_at, completed_time)
  where id = p_request_id;

  return jsonb_build_object(
    'deleted',
    true,
    'customerId',
    p_customer_id,
    'completedAt',
    completed_time
  );
end;
$$;

revoke all on function public.delete_customer_personal_data(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_customer_personal_data(uuid, text, uuid)
  to service_role;
