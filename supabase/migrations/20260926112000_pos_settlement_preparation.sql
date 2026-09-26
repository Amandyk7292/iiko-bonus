-- Prepare is acknowledged BEFORE the POS may close a discounted receipt.
-- Keep status=active and use PostgreSQL infinity so every existing balance,
-- expiry worker and checkout query continues to include the durable hold.
-- Only an explicit cancel or an idempotent commit releases this obligation.
alter table public.loyalty_reservations add column prepared_at timestamptz;
alter table public.gift_card_pos_reservations add column prepared_at timestamptz;
alter table public.gift_card_pos_reservations add column prepare_request_id uuid unique;

-- Expiration may only consume spendable bonus. A prepared POS payment must
-- remain payable even while an inactivity-expiration job runs during an outage.
create or replace function public.expire_customer_bonus(
  p_customer_id uuid, p_expected_balance numeric, p_order_id text
) returns numeric language plpgsql security definer set search_path=public,pg_temp as $$
declare current_balance numeric; held_balance numeric; expired_balance numeric;
begin
  if p_customer_id is null or coalesce(p_expected_balance,0)<=0
    or nullif(btrim(p_order_id),'') is null then
    raise exception 'invalid expiration values';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select balance into current_balance from public.customers
    where id=p_customer_id for update;
  if not found or current_balance is distinct from p_expected_balance then return 0; end if;
  if exists(select 1 from public.transactions where customer_id=p_customer_id
    and order_id=p_order_id and type='expiration') then return 0; end if;

  select coalesce(sum(discount_amount),0) into held_balance
    from public.loyalty_reservations
    where customer_id=p_customer_id and status='active' and expires_at>now();
  expired_balance:=greatest(0,current_balance-held_balance);
  if expired_balance=0 then return 0; end if;
  update public.customers set balance=balance-expired_balance,updated_at=now()
    where id=p_customer_id;
  insert into public.transactions(customer_id,order_id,type,amount,description)
    values(p_customer_id,p_order_id,'expiration',expired_balance,'Автоматическое сгорание бонусов');
  return expired_balance;
end;
$$;
revoke all on function public.expire_customer_bonus(uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.expire_customer_bonus(uuid,numeric,text) to service_role;

create function public.protect_prepared_loyalty_reservation() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if old.prepared_at is not null and old.status='active' then
    if new.customer_id is distinct from old.customer_id
      or new.order_id is distinct from old.order_id
      or new.order_total is distinct from old.order_total
      or new.discount_amount is distinct from old.discount_amount
      or new.pos_branch_id is distinct from old.pos_branch_id
      or new.status not in ('active','committed','cancelled') then
      raise exception 'prepared reservation values do not match';
    end if;
    new.prepared_at:=old.prepared_at;
    new.expires_at:='infinity'::timestamptz;
  end if;
  return new;
end;
$$;
create trigger protect_prepared_loyalty_reservation before update on public.loyalty_reservations
  for each row execute function public.protect_prepared_loyalty_reservation();

create function public.protect_prepared_gift_reservation() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if old.prepared_at is not null and old.status='active' then
    if new.gift_card_id is distinct from old.gift_card_id
      or new.branch_id is distinct from old.branch_id
      or new.iiko_order_id is distinct from old.iiko_order_id
      or new.amount is distinct from old.amount
      or new.request_id is distinct from old.request_id
      or new.status not in ('active','committed','cancelled') then
      raise exception 'prepared reservation values do not match';
    end if;
    new.prepared_at:=old.prepared_at;
    new.prepare_request_id:=old.prepare_request_id;
    new.expires_at:='infinity'::timestamptz;
  end if;
  return new;
end;
$$;
create trigger protect_prepared_gift_reservation before update on public.gift_card_pos_reservations
  for each row execute function public.protect_prepared_gift_reservation();

create function public.prepare_pos_loyalty_reservation(
  p_branch_id uuid,p_customer_id uuid,p_order_id text,p_reservation_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare reservation public.loyalty_reservations%rowtype; duplicate boolean;
begin
  if p_branch_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('branch-pos-loyalty:' || p_branch_id::text,0));
    if not exists(select 1 from public.bulka_locations where id=p_branch_id and active) then
      raise exception 'branch loyalty claim conflict';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  perform id from public.customers where id=p_customer_id for update;
  if not found then raise exception 'customer not found'; end if;
  select * into reservation from public.loyalty_reservations
    where id=p_reservation_id and customer_id=p_customer_id and order_id=p_order_id for update;
  if not found then raise exception 'reservation not found'; end if;
  if reservation.pos_branch_id is distinct from p_branch_id
    or (p_branch_id is not null and not exists (
      select 1 from public.branch_pos_loyalty_usage where reservation_id=p_reservation_id
        and branch_id=p_branch_id and customer_id=p_customer_id and order_id=p_order_id
    )) then raise exception 'branch loyalty claim conflict'; end if;
  if reservation.status<>'active' or reservation.expires_at<=now() then
    raise exception 'reservation is not active';
  end if;
  duplicate:=reservation.prepared_at is not null;
  update public.loyalty_reservations set prepared_at=coalesce(prepared_at,now()),
    expires_at='infinity'::timestamptz,updated_at=now() where id=p_reservation_id;
  return jsonb_build_object('reservationId',p_reservation_id,'status','prepared','duplicate',duplicate);
end;
$$;

create function public.prepare_gift_card_for_iiko(
  p_branch_id uuid,p_reservation_id uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare reservation public.gift_card_pos_reservations%rowtype; card public.gift_cards%rowtype;
  card_id uuid; duplicate boolean;
begin
  if p_request_id is null then raise exception 'gift card idempotency key required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('gift-prepare:' || p_request_id::text,0));
  if exists(select 1 from public.gift_card_pos_reservations
    where prepare_request_id=p_request_id and id<>p_reservation_id) then
    raise exception 'gift card prepare idempotency conflict';
  end if;
  select gift_card_id into card_id from public.gift_card_pos_reservations where id=p_reservation_id;
  select * into card from public.gift_cards where id=card_id for update;
  select * into reservation from public.gift_card_pos_reservations
    where id=p_reservation_id and branch_id=p_branch_id for update;
  if not found then raise exception 'gift card reservation not found'; end if;
  if reservation.gift_card_id is distinct from card_id then
    raise exception 'gift card reservation changed';
  end if;
  if not exists(select 1 from public.bulka_locations where id=p_branch_id and active) then
    raise exception 'gift card branch not found';
  end if;
  if reservation.status<>'active' or reservation.expires_at<=now() then
    raise exception 'gift card reservation expired';
  end if;
  duplicate:=reservation.prepared_at is not null;
  if duplicate and reservation.prepare_request_id is distinct from p_request_id then
    raise exception 'gift card prepare idempotency conflict';
  end if;
  -- A retry after a lost prepare reply confirms the already durable obligation,
  -- even if the card's own validity date has since passed.
  if not duplicate and (card.id is null or not card.active or card.balance<reservation.amount
    or (card.expires_at is not null and card.expires_at<=now())) then
    raise exception 'gift card not found or expired';
  end if;
  update public.gift_card_pos_reservations set prepared_at=coalesce(prepared_at,now()),
    prepare_request_id=p_request_id,expires_at='infinity'::timestamptz,updated_at=now()
    where id=p_reservation_id;
  return jsonb_build_object('reservationId',p_reservation_id,'status','prepared','duplicate',duplicate);
end;
$$;

revoke all on function public.protect_prepared_loyalty_reservation(),
  public.protect_prepared_gift_reservation(),
  public.prepare_pos_loyalty_reservation(uuid,uuid,text,uuid),
  public.prepare_gift_card_for_iiko(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_pos_loyalty_reservation(uuid,uuid,text,uuid),
  public.prepare_gift_card_for_iiko(uuid,uuid,uuid) to service_role;

-- A card valid at prepare remains payable after its validity date passes.
create or replace function public.commit_gift_card_for_iiko(
  p_reservation_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation public.gift_card_pos_reservations%rowtype;
  card public.gift_cards%rowtype;
  next_balance numeric(12,2);
  card_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('gift-commit:' || p_request_id::text, 0));
  if exists (
    select 1
    from public.gift_card_pos_reservations
    where commit_request_id = p_request_id
      and id <> p_reservation_id
  ) then
    raise exception 'gift card commit idempotency conflict';
  end if;

  -- Match reserve/prepare lock ordering. A concurrent prepare retry must not
  -- hold the card while commit holds the reservation and waits on that card.
  select gift_card_id into card_id from public.gift_card_pos_reservations
  where id=p_reservation_id;
  select * into card from public.gift_cards where id=card_id for update;
  select *
    into reservation
  from public.gift_card_pos_reservations
  where id = p_reservation_id
  for update;

  if reservation.id is null then
    raise exception 'gift card reservation not found';
  end if;
  if reservation.gift_card_id is distinct from card_id then
    raise exception 'gift card reservation changed';
  end if;
  if reservation.status = 'committed' then
    if reservation.commit_request_id <> p_request_id then
      raise exception 'gift card commit idempotency conflict';
    end if;
    return jsonb_build_object(
      'status', 'committed',
      'duplicate', true,
      'reservationId', reservation.id,
      'giftCardId', reservation.gift_card_id,
      'amount', reservation.amount,
      'balanceAfter', reservation.balance_after,
      'committedAt', reservation.committed_at
    );
  end if;
  if reservation.prepared_at is not null
    and reservation.prepare_request_id is distinct from p_request_id then
    raise exception 'gift card commit idempotency conflict';
  end if;
  if reservation.status <> 'active' then
    raise exception 'gift card reservation is not active';
  end if;
  if reservation.expires_at <= now() then
    update public.gift_card_pos_reservations
    set status = 'expired', updated_at = now()
    where id = reservation.id;
    raise exception 'gift card reservation expired';
  end if;

  if card.id is null or (reservation.prepared_at is null and not card.active) then
    raise exception 'gift card not found';
  end if;
  if reservation.prepared_at is null and card.expires_at is not null and card.expires_at <= now() then
    raise exception 'gift card expired';
  end if;
  if card.balance < reservation.amount then
    raise exception 'gift card insufficient balance';
  end if;

  next_balance := card.balance - reservation.amount;
  update public.gift_cards
  set balance = next_balance,
      active = card.active and next_balance > 0,
      redeemed_at = case when next_balance = 0 then now() else redeemed_at end
  where id = card.id;

  update public.gift_card_pos_reservations
  set status = 'committed',
      commit_request_id = p_request_id,
      balance_after = next_balance,
      committed_at = now(),
      updated_at = now()
  where id = reservation.id
    and status = 'active'
  returning * into reservation;

  if reservation.status <> 'committed' then
    raise exception 'gift card reservation conflict';
  end if;

  insert into public.gift_card_transactions(
    gift_card_id,
    customer_id,
    order_id,
    pos_reservation_id,
    type,
    amount
  )
  values(
    card.id,
    card.recipient_customer_id,
    null,
    reservation.id,
    'redeem',
    reservation.amount
  );

  return jsonb_build_object(
    'status', 'committed',
    'duplicate', false,
    'reservationId', reservation.id,
    'giftCardId', card.id,
    'amount', reservation.amount,
    'balanceAfter', reservation.balance_after,
    'committedAt', reservation.committed_at
  );
end;
$$;
