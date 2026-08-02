-- Keep support resolution state consistent when a customer reopens a conversation.

create or replace function public.sync_customer_support_request_from_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customer_support_requests
  set
    last_message_at = new.created_at,
    last_message_preview = left(new.body, 500),
    first_responded_at = case
      when new.sender_type = 'admin' and new.is_internal = false
        then coalesce(first_responded_at, new.created_at)
      else first_responded_at
    end,
    resolution = case
      when new.sender_type = 'customer' and status in ('resolved', 'rejected')
        then null
      else resolution
    end,
    status = case
      when new.sender_type = 'admin' and new.is_internal = false and status = 'new'
        then 'in_review'
      when new.sender_type = 'customer' and status in ('resolved', 'rejected')
        then 'in_review'
      else status
    end,
    resolved_at = case
      when new.sender_type = 'customer' and status in ('resolved', 'rejected') then null
      else resolved_at
    end,
    updated_at = now()
  where id = new.request_id;
  return new;
end;
$$;

revoke all on function public.sync_customer_support_request_from_message()
  from public, anon, authenticated;
