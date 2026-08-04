-- Payment receipts remain available in authenticated order details. They must
-- not be delivered as long signed URLs through the WhatsApp assistant.

update public.whatsapp_outbox
set
  status = case when status = 'sent' then status else 'cancelled' end,
  payload = '{}'::jsonb,
  last_error = case
    when status = 'sent' then last_error
    else 'Automatic payment receipt messages are disabled'
  end,
  locked_at = null,
  updated_at = now()
where source_type = 'payment_receipt';

create or replace function public.suppress_whatsapp_payment_receipt_messages()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_type = 'payment_receipt' then
    new.status := 'cancelled';
    new.payload := '{}'::jsonb;
    new.last_error := 'Automatic payment receipt messages are disabled';
    new.locked_at := null;
    new.provider_message_id := null;
    new.sent_at := null;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists suppress_whatsapp_payment_receipt_messages
  on public.whatsapp_outbox;
create trigger suppress_whatsapp_payment_receipt_messages
before insert or update
on public.whatsapp_outbox
for each row execute function public.suppress_whatsapp_payment_receipt_messages();

revoke all on function public.suppress_whatsapp_payment_receipt_messages()
  from public, anon, authenticated;

comment on function public.suppress_whatsapp_payment_receipt_messages() is
  'Prevents payment receipt links from being sent by the WhatsApp assistant.';
