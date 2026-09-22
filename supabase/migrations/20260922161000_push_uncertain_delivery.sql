begin;
-- A durable pre-send marker prevents a crashed worker from blindly resending
-- notifications whose provider response or acknowledgement was lost.
alter table public.push_notification_outbox
  add column if not exists in_flight_tokens jsonb not null default '[]'::jsonb,
  add column if not exists uncertain_tokens jsonb not null default '[]'::jsonb;
commit;
