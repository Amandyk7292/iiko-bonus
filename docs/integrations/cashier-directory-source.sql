-- Apply only to the attendance project iqseuohstngblkzimjrp.
-- Public directory requested for the cashier QR page. Employee table RLS stays intact.
-- This function cannot return phone, email, credentials, attendance or payroll data.
create or replace function public.bulka_cashier_signup_directory()
returns table(id text, name text, point_id text, branch_name text, city text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id::text,
    case
      when nullif(btrim(u.first_name), '') is not null
       and nullif(btrim(u.last_name), '') is not null
       and coalesce(array_length(regexp_split_to_array(btrim(u.display_name), '\s+'), 1), 0)
         <= array_length(regexp_split_to_array(concat_ws(' ', btrim(u.first_name), btrim(u.last_name)), '\s+'), 1)
      then concat_ws(' ', btrim(u.first_name), btrim(u.last_name))
      else coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), 'Кассир')
    end,
    u.point_id::text,
    coalesce(nullif(btrim(p.name), ''), 'Точка не назначена'),
    coalesce(nullif(btrim(p.city), ''), '')
  from public.bulka_users u
  left join public.points p on p.id = u.point_id
  where u.is_deleted is not true
    and u.deleted_at is null
    and (lower(coalesce(u.role::text, '')) = 'cashier'
      or lower(coalesce(u.position, '')) like '%кассир%')
  order by 2, u.id;
$$;
revoke all on function public.bulka_cashier_signup_directory() from public;
grant execute on function public.bulka_cashier_signup_directory() to anon, authenticated, service_role;
comment on function public.bulka_cashier_signup_directory() is
  'Public active cashier name/workpoint/city only for Bulka personal signup QR directory.';
