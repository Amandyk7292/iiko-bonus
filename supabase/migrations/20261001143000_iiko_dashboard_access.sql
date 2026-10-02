-- migration-safety: allow-destructive reason=Atomically widen the role CHECK; preserve every existing role and row.
alter table public.admin_user_profiles drop constraint admin_user_profiles_role_check;
alter table public.admin_user_profiles add constraint admin_user_profiles_role_check
  check(role in ('owner','branch_manager','operator','marketer','courier','editor','viewer','cashier','franchisee','iiko_dashboard'));

create or replace function public.get_iiko_dashboard_auth_record(p_username text)
returns table(username text,password_hash text,auth_version integer,role text,branch_ids uuid[],active boolean)
language sql stable security definer set search_path=public,pg_temp as $$
  select p.username,c.password_hash,c.auth_version,p.role,p.branch_ids,p.active
  from admin_user_profiles p join admin_staff_credentials c using(username)
  where p.username=p_username and p.role='iiko_dashboard';
$$;
create or replace function public.create_iiko_dashboard_access(p_username text,p_display_name text,p_password_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into admin_user_profiles(username,display_name,role,branch_ids,active)
    values(p_username,p_display_name,'iiko_dashboard','{}',true);
  insert into admin_staff_credentials(username,password_hash) values(p_username,p_password_hash);
  return jsonb_build_object('username',p_username,'role','iiko_dashboard');
end $$;
revoke all on function public.get_iiko_dashboard_auth_record(text),public.create_iiko_dashboard_access(text,text,text) from public,anon,authenticated;
grant execute on function public.get_iiko_dashboard_auth_record(text),public.create_iiko_dashboard_access(text,text,text) to service_role;
