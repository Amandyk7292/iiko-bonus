create table public.product_badges (
 id uuid primary key default gen_random_uuid(),
 label text not null check(length(label) between 1 and 24),
 background text not null check(background ~ '^#[0-9A-Fa-f]{6}$'),
 foreground text not null check(foreground ~ '^#[0-9A-Fa-f]{6}$'),
 updated_at timestamptz not null default now()
);
create table public.product_badge_assignments (
 product_id text primary key check(length(product_id) between 1 and 100),
 badge_ids uuid[] not null default '{}' check(cardinality(badge_ids)<=3)
);
alter table public.product_badges enable row level security;
alter table public.product_badge_assignments enable row level security;
revoke all on public.product_badges,public.product_badge_assignments from public,anon,authenticated;
grant select,insert,update,delete on public.product_badges,public.product_badge_assignments to service_role;
