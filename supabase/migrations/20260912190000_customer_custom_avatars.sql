alter table public.customers
  add column if not exists avatar_url text,
  add column if not exists avatar_storage_path text;

-- migration-safety: allow-destructive reason=replace the avatar key check with the same built-in keys plus custom uploads; no customer or avatar data is removed
alter table public.customers
  drop constraint if exists customers_avatar_key_check;

alter table public.customers
  add constraint customers_avatar_key_check check (
    avatar_key is null
    or avatar_key in (
      'kz_female_01', 'kz_female_02', 'kz_female_03',
      'kz_female_04', 'kz_female_05', 'kz_female_06',
      'kz_male_01', 'kz_male_02', 'kz_male_03',
      'kz_male_04', 'kz_male_05', 'kz_male_06',
      'custom'
    )
  );

alter table public.customers
  drop constraint if exists customers_avatar_url_length_check;
alter table public.customers
  add constraint customers_avatar_url_length_check check (
    avatar_url is null or char_length(avatar_url) <= 2000
  );

alter table public.customers
  drop constraint if exists customers_avatar_storage_path_check;
alter table public.customers
  add constraint customers_avatar_storage_path_check check (
    avatar_storage_path is null
    or (
      char_length(avatar_storage_path) <= 500
      and avatar_storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|png|webp)$'
    )
  );

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer_avatars',
  'customer_avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.clear_customer_avatar_on_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.deleted_at is not null then
    new.avatar_key := null;
    new.avatar_url := null;
    new.avatar_storage_path := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_customer_avatar_on_delete_trigger on public.customers;
create trigger clear_customer_avatar_on_delete_trigger
before update of deleted_at on public.customers
for each row execute function public.clear_customer_avatar_on_delete();

revoke all on function public.clear_customer_avatar_on_delete() from public, anon, authenticated;
grant execute on function public.clear_customer_avatar_on_delete() to service_role;
