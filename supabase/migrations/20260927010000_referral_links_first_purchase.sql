-- Persist purchase events in the payment transaction. A retryable worker awards
-- both wallets together, independently of HTTP responses and process restarts.
insert into public.settings(key, value)
values ('bonus_referral', '{"enabled":true,"inviter_bonus":1000,"friend_bonus":500,"min_first_order":0}')
on conflict (key) do update set value = excluded.value;

alter table public.referral_redemptions
  add column if not exists reward_referrer numeric(12,2),
  add column if not exists reward_friend numeric(12,2),
  add column if not exists min_first_order numeric(12,2),
  add column if not exists purchase_source text,
  add column if not exists purchase_id uuid;

create table public.referral_first_purchases (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  source text not null check (source in ('online', 'pos')),
  purchase_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  branch_id uuid,
  purchased_at timestamptz not null default clock_timestamp(),
  state text not null default 'pending' check (state in ('pending', 'done', 'rejected'))
);
create index referral_first_purchases_pending on public.referral_first_purchases(purchased_at)
where state = 'pending';
alter table public.referral_first_purchases enable row level security;
create policy service_role_referral_purchases on public.referral_first_purchases
for all to service_role using (true) with check (true);
revoke all on public.referral_first_purchases from public, anon, authenticated;
grant all on public.referral_first_purchases to service_role;

create or replace function public.capture_referral_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'kaspi_orders' then
    if new.status = 'paid' and new.customer_id is not null and new.amount > 0 then
      insert into public.referral_first_purchases(customer_id, source, purchase_id, amount, branch_id)
      values (new.customer_id, 'online', new.id, new.amount, new.branch_id)
      on conflict (customer_id) do nothing;
    end if;
  elsif new.status = 'committed' and new.order_total - new.discount_amount > 0 then
    insert into public.referral_first_purchases(customer_id, source, purchase_id, amount)
    values (new.customer_id, 'pos', new.id, new.order_total - new.discount_amount)
    on conflict (customer_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger referral_online_purchase after insert or update of status on public.kaspi_orders
for each row execute function public.capture_referral_purchase();
create trigger referral_pos_purchase after insert or update of status on public.loyalty_reservations
for each row execute function public.capture_referral_purchase();

create or replace function public.redeem_referral_code(p_customer_id uuid, p_code text)
returns public.referral_redemptions language plpgsql security definer set search_path = public as $$
declare
  v_code public.referral_codes%rowtype;
  v_redemption public.referral_redemptions%rowtype;
  v_settings jsonb;
begin
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then raise exception 'customer not found'; end if;
  select * into v_code from public.referral_codes where upper(code) = upper(btrim(p_code));
  if v_code.id is null or not v_code.active then raise exception 'referral not found'; end if;
  if v_code.customer_id = p_customer_id then raise exception 'own referral'; end if;
  select * into v_redemption from public.referral_redemptions where referred_customer_id = p_customer_id;
  if v_redemption.id is not null then
    if v_redemption.referral_code_id = v_code.id then return v_redemption; end if;
    raise exception 'referral already redeemed';
  end if;
  select value::jsonb into v_settings from public.settings where key = 'bonus_referral';
  if not coalesce((v_settings->>'enabled')::boolean, false) then raise exception 'referral disabled'; end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then raise exception 'referral expired'; end if;
  if v_code.max_uses is not null and v_code.uses_count >= v_code.max_uses then raise exception 'referral limit reached'; end if;
  if exists (select 1 from public.customers where id = p_customer_id and total_spent > 0)
    or exists (select 1 from public.kaspi_orders where customer_id = p_customer_id and status in ('paid', 'refunded'))
    or exists (select 1 from public.loyalty_reservations where customer_id = p_customer_id and committed_at is not null)
    or exists (select 1 from public.referral_first_purchases where customer_id = p_customer_id) then
    raise exception 'referral requires first order';
  end if;
  insert into public.referral_redemptions(referral_code_id, referred_customer_id, reward_referrer, reward_friend, min_first_order)
  values (v_code.id, p_customer_id, greatest(0, (v_settings->>'inviter_bonus')::numeric),
    greatest(0, (v_settings->>'friend_bonus')::numeric), greatest(0, (v_settings->>'min_first_order')::numeric))
  returning * into v_redemption;
  return v_redemption;
end;
$$;

create or replace function public.process_referral_purchase(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_purchase public.referral_first_purchases%rowtype;
  v_redemption public.referral_redemptions%rowtype;
  v_code public.referral_codes%rowtype;
  v_friend numeric;
  v_owner numeric;
begin
  select * into v_purchase from public.referral_first_purchases where customer_id = p_customer_id for update;
  if v_purchase.customer_id is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_purchase.state <> 'pending' then return jsonb_build_object('status', 'already_processed'); end if;
  select * into v_redemption from public.referral_redemptions where referred_customer_id = p_customer_id for update;
  if v_redemption.id is null or v_redemption.status not in ('registered', 'qualified')
    or v_redemption.created_at > v_purchase.purchased_at
    or v_purchase.amount < coalesce(v_redemption.min_first_order, 0) then
    update public.referral_first_purchases set state = 'rejected' where customer_id = p_customer_id;
    return jsonb_build_object('status', 'not_eligible');
  end if;
  if (v_purchase.source = 'online' and not exists (
      select 1 from public.kaspi_orders where id = v_purchase.purchase_id and status = 'paid'))
    or (v_purchase.source = 'pos' and not exists (
      select 1 from public.loyalty_reservations where id = v_purchase.purchase_id and status = 'committed')) then
    update public.referral_first_purchases set state = 'rejected' where customer_id = p_customer_id;
    return jsonb_build_object('status', 'cancelled');
  end if;
  select * into v_code from public.referral_codes where id = v_redemption.referral_code_id for update;
  if v_code.max_uses is not null and v_code.uses_count >= v_code.max_uses then
    update public.referral_first_purchases set state = 'rejected' where customer_id = p_customer_id;
    return jsonb_build_object('status', 'limit_reached');
  end if;
  perform 1 from public.customers where id in (p_customer_id, v_code.customer_id) order by id for update;
  v_friend := coalesce(v_redemption.reward_friend, v_code.reward_friend, 0);
  v_owner := coalesce(v_redemption.reward_referrer, v_code.reward_referrer, 0);
  if v_friend > 0 then
    insert into public.transactions(customer_id, order_id, type, amount, description, branch_id)
    values (p_customer_id, 'REFERRAL-' || v_redemption.id || ':friend', 'deposit', v_friend, 'Бонус за первую покупку по приглашению', v_purchase.branch_id);
    update public.customers set balance = balance + v_friend, updated_at = now() where id = p_customer_id;
  end if;
  if v_owner > 0 then
    insert into public.transactions(customer_id, order_id, type, amount, description, branch_id)
    values (v_code.customer_id, 'REFERRAL-' || v_redemption.id || ':owner', 'deposit', v_owner, 'Друг совершил первую покупку', v_purchase.branch_id);
    update public.customers set balance = balance + v_owner, updated_at = now() where id = v_code.customer_id;
  end if;
  update public.referral_redemptions set status = 'rewarded', rewarded_at = now(),
    reward_friend = v_friend, reward_referrer = v_owner,
    purchase_source = v_purchase.source, purchase_id = v_purchase.purchase_id,
    order_id = case when v_purchase.source = 'online' then v_purchase.purchase_id else null end
  where id = v_redemption.id;
  update public.referral_codes set uses_count = uses_count + 1 where id = v_code.id;
  update public.referral_first_purchases set state = 'done' where customer_id = p_customer_id;
  return jsonb_build_object('status', 'rewarded', 'friendCustomerId', p_customer_id,
    'ownerCustomerId', v_code.customer_id, 'friendReward', v_friend, 'ownerReward', v_owner);
end;
$$;

-- Keep the existing payment callback compatible; the durable worker retries failures.
create or replace function public.qualify_referral_for_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_customer uuid;
begin
  select customer_id into v_customer from public.kaspi_orders where id = p_order_id and status = 'paid';
  if v_customer is null then return jsonb_build_object('status', 'not_eligible'); end if;
  return public.process_referral_purchase(v_customer);
end;
$$;
revoke all on function public.capture_referral_purchase() from public, anon, authenticated;
revoke all on function public.process_referral_purchase(uuid) from public, anon, authenticated;
revoke all on function public.redeem_referral_code(uuid, text) from public, anon, authenticated;
revoke all on function public.qualify_referral_for_order(uuid) from public, anon, authenticated;
grant execute on function public.process_referral_purchase(uuid) to service_role;
grant execute on function public.redeem_referral_code(uuid, text) to service_role;
grant execute on function public.qualify_referral_for_order(uuid) to service_role;
