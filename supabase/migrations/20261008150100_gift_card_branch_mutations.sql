-- Preserve settlement/idempotency semantics while binding every mutation to
-- the authenticated terminal's branch under the original lock ordering.
create or replace function public.commit_gift_card_for_iiko_scoped(
  p_branch_id uuid, p_reservation_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  card_id uuid;
  reservation public.gift_card_pos_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('gift-commit:' || p_request_id::text, 0));
  select gift_card_id into card_id from public.gift_card_pos_reservations where id=p_reservation_id;
  perform 1 from public.gift_cards where id=card_id for update;
  select * into reservation from public.gift_card_pos_reservations where id=p_reservation_id for update;
  if p_branch_id is null or reservation.id is null
    or reservation.branch_id is distinct from p_branch_id
    or reservation.gift_card_id is distinct from card_id then
    raise exception 'gift card reservation branch mismatch' using errcode='42501';
  end if;
  return public.commit_gift_card_for_iiko(p_reservation_id,p_request_id);
end;
$$;

create or replace function public.cancel_gift_card_for_iiko_scoped(
  p_branch_id uuid, p_reservation_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare reservation public.gift_card_pos_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('gift-cancel:' || p_request_id::text, 0));
  select * into reservation from public.gift_card_pos_reservations where id=p_reservation_id for update;
  if p_branch_id is null or reservation.id is null or reservation.branch_id is distinct from p_branch_id then
    raise exception 'gift card reservation branch mismatch' using errcode='42501';
  end if;
  return public.cancel_gift_card_for_iiko(p_reservation_id,p_request_id);
end;
$$;

revoke all on function public.commit_gift_card_for_iiko_scoped(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.cancel_gift_card_for_iiko_scoped(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.commit_gift_card_for_iiko_scoped(uuid,uuid,uuid) to service_role;
grant execute on function public.cancel_gift_card_for_iiko_scoped(uuid,uuid,uuid) to service_role;
