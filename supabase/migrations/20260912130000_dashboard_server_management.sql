create table public.iiko_dashboard_servers (
  id text primary key,
  host text not null unique check(host ~ '^[a-z0-9][a-z0-9-]*\.iiko\.it$'),
  city text not null check(city in ('aktau','astana')),
  kind text not null check(kind in ('chain','rms')),
  active boolean not null default true,
  deleted boolean not null default false,
  credential_cipher text,
  updated_at timestamptz not null default now()
);
alter table public.iiko_dashboard_servers enable row level security;
revoke all on public.iiko_dashboard_servers from public,anon,authenticated;
grant select,insert,update on public.iiko_dashboard_servers to service_role;
