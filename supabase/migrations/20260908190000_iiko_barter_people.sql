-- Names annotate verified iiko outgoing invoices; amounts and goods remain sourced from iiko.
create table if not exists public.iiko_barter_people (
  document_key varchar(64) primary key check (document_key ~ '^[0-9a-f]{64}$'),
  city varchar(16) not null check (city in ('aktau', 'astana')),
  document_number text not null,
  document_date timestamptz not null,
  department text not null,
  blogger_name varchar(160) not null default '',
  updated_by varchar(160) not null,
  updated_at timestamptz not null default now()
);
alter table public.iiko_barter_people enable row level security;
revoke all on public.iiko_barter_people from anon, authenticated;
grant select, insert, update on public.iiko_barter_people to service_role;
