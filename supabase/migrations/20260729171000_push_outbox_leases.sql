-- Expand the durable push outbox with a per-claim lease. Kept separate from
-- the original outbox migration so an already-applied immutable migration
-- never needs to be edited in production.

alter table public.push_notification_outbox
  add column if not exists lease_token uuid;

create or replace function public.claim_push_notification_outbox(
  p_limit integer default 50,
  p_message_id uuid default null
)
returns setof public.push_notification_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_notification_outbox message
  set
    status = 'failed',
    pending_tokens = '[]'::jsonb,
    last_error = coalesce(message.last_error, 'Delivery worker stopped during final attempt'),
    locked_at = null,
    lease_token = null,
    updated_at = now()
  where
    message.status = 'processing'
    and message.locked_at < now() - interval '5 minutes'
    and message.attempt_count >= message.max_attempts;

  return query
  with candidates as (
    select message.id
    from public.push_notification_outbox message
    where
      (p_message_id is null or message.id = p_message_id)
      and (
        (
          message.status in ('queued', 'retry')
          and message.next_attempt_at <= now()
        )
        or (
          message.status = 'processing'
          and message.locked_at < now() - interval '5 minutes'
        )
      )
      and message.attempt_count < message.max_attempts
    order by message.next_attempt_at, message.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  update public.push_notification_outbox message
  set
    status = 'processing',
    attempt_count = message.attempt_count + 1,
    locked_at = now(),
    lease_token = gen_random_uuid(),
    updated_at = now()
  from candidates
  where message.id = candidates.id
  returning message.*;
end;
$$;

revoke all on function public.claim_push_notification_outbox(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_push_notification_outbox(integer, uuid)
  to service_role;

comment on column public.push_notification_outbox.lease_token is
  'Unique claim token used to reject stale delivery-worker updates.';
