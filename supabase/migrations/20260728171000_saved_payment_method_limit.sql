-- Keep customer card selection compact and prevent direct API/database writes
-- from exceeding the product limit.

create or replace function public.enforce_customer_payment_methods_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_requires_check boolean := false;
  v_active_count integer;
begin
  if tg_op = 'INSERT' then
    v_requires_check := new.status = 'active';
  else
    v_requires_check :=
      new.status = 'active'
      and (
        old.status is distinct from 'active'
        or old.customer_id is distinct from new.customer_id
        or old.provider is distinct from new.provider
      );
  end if;

  if not v_requires_check then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.customer_id::text || ':' || new.provider, 0)
  );

  select count(*)
  into v_active_count
  from public.customer_payment_methods
  where customer_id = new.customer_id
    and provider = new.provider
    and status = 'active'
    and id is distinct from new.id;

  if v_active_count >= 3 then
    raise exception using
      errcode = '23514',
      message = 'customer_payment_methods_active_limit';
  end if;

  return new;
end;
$$;

drop trigger if exists customer_payment_methods_enforce_limit
  on public.customer_payment_methods;
create trigger customer_payment_methods_enforce_limit
before insert or update of customer_id, provider, status
on public.customer_payment_methods
for each row execute function public.enforce_customer_payment_methods_limit();

revoke all on function public.enforce_customer_payment_methods_limit()
  from public, anon, authenticated;
grant execute on function public.enforce_customer_payment_methods_limit()
  to service_role;
