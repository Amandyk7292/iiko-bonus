-- Offline earn-only receipts keep the family recipient from the verified QR scan time.
-- Membership removal and pause history must not redirect delayed receipts after reconnecting.
create index family_audit_member_history on public.family_audit(member_id,created_at desc,id desc)
  where member_id is not null;

create function public.family_bonus_owner_at(p_customer_id uuid,p_scanned_at timestamptz) returns uuid
language sql stable security definer set search_path=public as $$
  select coalesce((
    select g.owner_customer_id
    from public.family_members m join public.family_groups g on g.id=m.group_id
    where m.customer_id=p_customer_id and m.created_at<=p_scanned_at
      and p_scanned_at<coalesce(
        (select min(a.created_at) from public.family_audit a
          where a.member_id=m.id and a.action='member_removed'),
        case when m.status='removed' then m.updated_at else 'infinity'::timestamptz end)
      and not coalesce((
        select (a.details->>'blocked')::boolean from public.family_audit a
        where a.member_id=m.id and a.action='member_updated' and a.details ? 'blocked'
          and a.created_at<=p_scanned_at
        order by a.created_at desc,a.id desc limit 1
      ),false)
    order by m.created_at desc,m.id desc limit 1
  ),p_customer_id);
$$;
revoke all on function public.family_bonus_owner_at(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.family_bonus_owner_at(uuid,timestamptz) to service_role;
