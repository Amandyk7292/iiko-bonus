-- One operational view for every paired iikoFront register.
alter table public.pos_devices
  add column if not exists plugin_version text,
  add column if not exists plugin_api_version text,
  add column if not exists plugin_started_at timestamptz,
  add column if not exists last_health_at timestamptz,
  add column if not exists connected_to_main boolean,
  add column if not exists printer_status text not null default 'unknown',
  add column if not exists health_status text not null default 'unknown',
  add column if not exists health_payload jsonb not null default '{}'::jsonb,
  add column if not exists last_error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='pos_devices_printer_status_check') then
    alter table public.pos_devices add constraint pos_devices_printer_status_check
      check (printer_status in ('unknown','ready','missing','error'));
  end if;
  if not exists (select 1 from pg_constraint where conname='pos_devices_health_status_check') then
    alter table public.pos_devices add constraint pos_devices_health_status_check
      check (health_status in ('unknown','healthy','attention','error'));
  end if;
  if not exists (select 1 from pg_constraint where conname='pos_devices_health_payload_size_check') then
    alter table public.pos_devices add constraint pos_devices_health_payload_size_check
      check (octet_length(health_payload::text)<=32768);
  end if;
end;
$$;

create index if not exists pos_devices_health_idx
  on public.pos_devices(active,last_health_at desc);

create table if not exists public.pos_plugin_policy (
  singleton boolean primary key default true check(singleton),
  latest_version text not null default '1.10.0' check(latest_version ~ '^\d+\.\d+\.\d+$'),
  minimum_version text not null default '1.9.0' check(minimum_version ~ '^\d+\.\d+\.\d+$'),
  enforce_minimum boolean not null default false,
  download_url text not null default '/downloads/BulkaPlugin-1.10.0-full.zip',
  guide_url text not null default '/docs/iiko-plugin-installation.html',
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.pos_plugin_policy(singleton) values(true) on conflict(singleton) do nothing;
alter table public.pos_plugin_policy enable row level security;
revoke all on public.pos_plugin_policy from public,anon,authenticated;
grant all on public.pos_plugin_policy to service_role;
create policy pos_plugin_policy_service on public.pos_plugin_policy
  for all to service_role using(true) with check(true);

create table if not exists public.pos_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique check(length(source_key) between 3 and 240),
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  terminal_id uuid references public.pos_devices(terminal_id) on delete set null,
  kind text not null check(kind in (
    'personal_account','front_receipt','assembly_print','loyalty_queue',
    'offline_receipt','stock_sync','plugin_health'
  )),
  severity text not null default 'warning' check(severity in ('info','warning','critical')),
  status text not null default 'open' check(status in ('open','retrying','resolved','manual_closed')),
  title text not null check(length(title) between 1 and 200),
  details text not null default '' check(length(details)<=2000),
  payload jsonb not null default '{}'::jsonb check(octet_length(payload::text)<=32768),
  attempts integer not null default 0 check(attempts between 0 and 1000),
  retry_requested_at timestamptz,
  last_checked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  resolution_note text check(resolution_note is null or length(resolution_note) between 3 and 500),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pos_reconciliation_open_idx
  on public.pos_reconciliation_cases(status,severity,last_seen_at desc)
  where status in ('open','retrying');
create index if not exists pos_reconciliation_branch_idx
  on public.pos_reconciliation_cases(branch_id,status,updated_at desc);
alter table public.pos_reconciliation_cases enable row level security;
revoke all on public.pos_reconciliation_cases from public,anon,authenticated;
grant all on public.pos_reconciliation_cases to service_role;
create policy pos_reconciliation_service on public.pos_reconciliation_cases
  for all to service_role using(true) with check(true);
