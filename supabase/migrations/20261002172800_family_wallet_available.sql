-- A member's allowance must also reflect money reserved by other members or
-- by the owner's ordinary cashier payment. Reservations are not spending.
create or replace function public.family_member_wallet_stats(p_member_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  with member as (
    select m.id,m.daily_limit_minor,g.owner_customer_id,a.balance_minor,a.blocked
    from public.family_members m
    join public.family_groups g on g.id=m.group_id
    join public.customers c on c.id=g.owner_customer_id and c.deleted_at is null
    left join public.personal_accounts a on a.customer_id=g.owner_customer_id
    where m.id=p_member_id and m.status='active' and not m.blocked
  ), valid_holds as (
    select p.amount_minor,p.family_member_id
    from public.personal_account_pos_payments p
    join member m on m.owner_customer_id=p.customer_id
    where p.status='authorized' and p.expires_at>now()
      and (p.family_member_id is null or exists (
        select 1 from public.family_members h
        join public.family_groups g on g.id=h.group_id
        where h.id=p.family_member_id and h.status='active' and not h.blocked
          and g.owner_customer_id=p.customer_id
          and h.qr_version=p.family_qr_version and p.family_qr_expires_at>now()
      ))
  ), usage as (
    select coalesce(sum(p.amount_minor),0) as paid_today
    from public.personal_account_pos_payments p
    join member m on m.id=p.family_member_id and m.owner_customer_id=p.customer_id
    where p.status='paid' and p.family_paid_at>=
      (date_trunc('day',now() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty')
  )
  select jsonb_build_object(
    'spentToday',u.paid_today/100.0,
    'remainingToday',greatest(0,least(
      case when m.blocked then 0 else coalesce(m.balance_minor,0)-
        coalesce((select sum(h.amount_minor) from valid_holds h),0) end,
      m.daily_limit_minor-u.paid_today-
        coalesce((select sum(h.amount_minor) from valid_holds h where h.family_member_id=m.id),0)
    ))/100.0
  ) from member m cross join usage u;
$$;
revoke all on function public.family_member_wallet_stats(uuid) from public,anon,authenticated;
grant execute on function public.family_member_wallet_stats(uuid) to service_role;
