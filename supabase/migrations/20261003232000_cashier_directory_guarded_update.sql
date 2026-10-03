-- Supabase safe-update requires a predicate even for deliberate full refreshes.
-- Leave already-inactive identities untouched; the applied original migration
-- stays immutable and all QR tokens/history are preserved.
create or replace function public.sync_cashier_signup_directory(p_cashiers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare item jsonb;
begin
  if p_cashiers is null or jsonb_typeof(p_cashiers) <> 'array' or jsonb_array_length(p_cashiers) > 20000 then
    raise exception 'Invalid cashier directory';
  end if;
  perform pg_advisory_xact_lock(hashtext('cashier-directory-sync'));
  update public.cashier_signup_directory set is_active = false where is_active;
  for item in select value from jsonb_array_elements(p_cashiers) loop
    insert into public.cashier_signup_directory(employee_id, invite_token, name, point_id,
      branch_name, city, branch_id, is_active, synced_at)
    values(item->>'id', item->>'inviteToken', item->>'name', item->>'pointId',
      item->>'branchName', item->>'city', nullif(item->>'branchId', '')::uuid,
      (item->>'isActive')::boolean, now())
    on conflict(employee_id) do update set name = excluded.name, point_id = excluded.point_id,
      branch_name = excluded.branch_name, city = excluded.city, branch_id = excluded.branch_id,
      is_active = excluded.is_active, synced_at = excluded.synced_at;
  end loop;
  return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(d) order by name, employee_id)
    from public.cashier_signup_directory d where is_active), '[]'::jsonb));
end; $$;
