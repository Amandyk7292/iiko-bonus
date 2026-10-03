begin;
-- Attendance point IDs must be reviewed against customer branch UUIDs. Names
-- are labels, never an authorization join or automatic match.
create table public.staff_cashier_branch_mappings (
 point_id text primary key check(point_id ~ '^[1-9][0-9]{0,18}$'),
 branch_id uuid not null references public.bulka_locations(id),
 reviewed_by text not null check(length(btrim(reviewed_by)) between 1 and 160),
 reviewed_at timestamptz not null default now()
);
alter table public.staff_cashier_branch_mappings enable row level security;
create policy staff_cashier_branch_mappings_service on public.staff_cashier_branch_mappings
 for all to service_role using(true) with check(true);
revoke all on public.staff_cashier_branch_mappings from public,anon,authenticated,service_role;
grant select,insert,update on public.staff_cashier_branch_mappings to service_role;

create function public.apply_staff_cashier_branch_mapping() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Reward point_id is a historical snapshot. Never overwrite a previously
 -- known branch, including when an employee later transfers to another point.
 update public.cashier_signup_directory set branch_id=new.branch_id
  where point_id=new.point_id and branch_id is null;
 update public.cashier_signup_rewards set branch_id=new.branch_id
  where point_id=new.point_id and branch_id is null;
 return new;
end;
$$;
create trigger staff_cashier_branch_mapping_backfill after insert or update on public.staff_cashier_branch_mappings
 for each row execute function public.apply_staff_cashier_branch_mapping();
revoke all on function public.apply_staff_cashier_branch_mapping() from public,anon,authenticated;

-- Reviewed 2026-10-04 against the live attendance point directory and the
-- customer location directory: unique matching Aktau names/addresses only.
-- Night point 33 is the second roster for 19/33, not a separate shop. Office
-- point 18 and all uncertain Astana matches intentionally remain unassigned.
insert into public.staff_cashier_branch_mappings(point_id,branch_id,reviewed_by)
select reviewed.point_id,location.id,'audit-2026-10-04: verified Aktau point/address'
from (values
 ('17','48a835eb-b78d-548e-a450-7789189d5785'::uuid), -- 19/33
 ('33','48a835eb-b78d-548e-a450-7789189d5785'::uuid), -- 19/33 ночь
 ('16','ea829279-4b48-5e9f-a763-e8ef06a53e57'::uuid), -- 40 Central Park
 ('11','cb2b13f5-6c4e-5592-adc7-8908bacddabd'::uuid), -- 16-85
 ('2','dcd47584-8559-574d-a223-467ce30069e6'::uuid), -- Ардагер
 ('15','dc180678-d414-54bd-a077-959e72b7afe5'::uuid), -- Bulka28мкр
 ('10','a18ea0f1-ac22-5530-a56a-65d810181a12'::uuid), -- 17-95
 ('13','18ab2d90-7187-5b0b-a245-9c819a67a605'::uuid), -- 5-20
 ('5','7f073eb5-d112-5121-a132-68d8519b1188'::uuid), -- Premium plaza
 ('9','07788c1e-8ef0-5f24-ae46-0cbb9109e3eb'::uuid), -- Green Plaza
 ('14','b49c5f6f-e051-553f-aa7a-968fef73e62a'::uuid), -- 26 Достық
 ('12','48f71218-aa08-51bf-a6d9-2497c4a1e55b'::uuid), -- Дукат17/1
 ('32','62fa7ada-3d67-4f85-bb37-5b13f0e1345c'::uuid), -- 19a
 ('20','92a71bf8-74b2-56a6-ae83-6d08f030ae6d'::uuid) -- 17/55
) reviewed(point_id,branch_id)
join public.bulka_locations location on location.id=reviewed.branch_id
on conflict(point_id) do nothing;
commit;
