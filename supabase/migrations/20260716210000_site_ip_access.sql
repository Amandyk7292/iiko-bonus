-- Public website IP allowlist. The feature remains disabled until an owner
-- adds at least one address and enables it from the admin panel.
insert into public.settings (key, value)
values ('site_access', '{"enabled":false,"allowed_ips":[]}')
on conflict (key) do nothing;
