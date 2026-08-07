-- Global owner-controlled switch for customer checkout and purchase creation.
-- Catalog browsing, existing payment reconciliation, webhooks and refunds stay available.
insert into public.settings (key, value)
values ('online_ordering', '{"disabled":false}')
on conflict (key) do nothing;
