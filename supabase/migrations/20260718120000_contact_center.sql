-- Admin-managed public contact center for the Flutter client.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.contact_cards (
  id uuid primary key default gen_random_uuid(),
  display_mode text not null default 'standard'
    check (display_mode in ('standard', 'compact')),
  title_ru varchar(120) not null check (char_length(btrim(title_ru)) between 1 and 120),
  title_kk varchar(120) not null check (char_length(btrim(title_kk)) between 1 and 120),
  title_en varchar(120) not null check (char_length(btrim(title_en)) between 1 and 120),
  icon_key varchar(40) not null default 'bulka',
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_actions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.contact_cards(id) on delete cascade,
  action_type text not null
    check (
      action_type in (
        'phone',
        'whatsapp',
        'telegram',
        'instagram',
        'vk',
        'email',
        'website',
        'online_chat',
        'custom_url'
      )
    ),
  label_ru varchar(80) not null check (char_length(btrim(label_ru)) between 1 and 80),
  label_kk varchar(80) not null check (char_length(btrim(label_kk)) between 1 and 80),
  label_en varchar(80) not null check (char_length(btrim(label_en)) between 1 and 80),
  target varchar(500) not null check (char_length(btrim(target)) between 1 and 500),
  icon_key varchar(40) not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_cards_public_order_idx
  on public.contact_cards (is_active, sort_order, created_at);
create index if not exists contact_actions_card_order_idx
  on public.contact_actions (card_id, is_active, sort_order, created_at);

alter table public.contact_cards enable row level security;
alter table public.contact_actions enable row level security;

drop policy if exists service_role_all_contact_cards on public.contact_cards;
drop policy if exists service_role_all_contact_actions on public.contact_actions;

create policy service_role_all_contact_cards
  on public.contact_cards
  for all
  to service_role
  using (true)
  with check (true);

create policy service_role_all_contact_actions
  on public.contact_actions
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.reorder_contact_cards(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_count integer := cardinality(coalesce(p_ids, array[]::uuid[]));
  distinct_count integer;
  existing_count integer;
  matching_count integer;
begin
  select count(*) into distinct_count
  from (
    select distinct requested.id
    from unnest(coalesce(p_ids, array[]::uuid[])) as requested(id)
  ) as unique_ids;

  select count(*) into existing_count from public.contact_cards;
  select count(*) into matching_count
  from public.contact_cards
  where id = any(coalesce(p_ids, array[]::uuid[]));

  if requested_count <> distinct_count
    or requested_count <> existing_count
    or requested_count <> matching_count then
    raise exception 'contact card reorder must contain the complete unique id set';
  end if;

  update public.contact_cards as card
  set sort_order = ordered.ordinality - 1
  from unnest(coalesce(p_ids, array[]::uuid[])) with ordinality
    as ordered(id, ordinality)
  where card.id = ordered.id;
end;
$$;

create or replace function public.reorder_contact_actions(
  p_card_id uuid,
  p_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_count integer := cardinality(coalesce(p_ids, array[]::uuid[]));
  distinct_count integer;
  existing_count integer;
  matching_count integer;
begin
  select count(*) into distinct_count
  from (
    select distinct requested.id
    from unnest(coalesce(p_ids, array[]::uuid[])) as requested(id)
  ) as unique_ids;

  select count(*) into existing_count
  from public.contact_actions
  where card_id = p_card_id;

  select count(*) into matching_count
  from public.contact_actions
  where card_id = p_card_id
    and id = any(coalesce(p_ids, array[]::uuid[]));

  if requested_count <> distinct_count
    or requested_count <> existing_count
    or requested_count <> matching_count then
    raise exception 'contact action reorder must contain the complete unique card id set';
  end if;

  update public.contact_actions as action
  set sort_order = ordered.ordinality - 1
  from unnest(coalesce(p_ids, array[]::uuid[])) with ordinality
    as ordered(id, ordinality)
  where action.card_id = p_card_id
    and action.id = ordered.id;
end;
$$;

revoke all on function public.reorder_contact_cards(uuid[])
  from public, anon, authenticated;
revoke all on function public.reorder_contact_actions(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.reorder_contact_cards(uuid[]) to service_role;
grant execute on function public.reorder_contact_actions(uuid, uuid[])
  to service_role;

drop trigger if exists contact_cards_set_updated_at on public.contact_cards;
create trigger contact_cards_set_updated_at
before update on public.contact_cards
for each row execute function public.set_updated_at();

drop trigger if exists contact_actions_set_updated_at on public.contact_actions;
create trigger contact_actions_set_updated_at
before update on public.contact_actions
for each row execute function public.set_updated_at();
