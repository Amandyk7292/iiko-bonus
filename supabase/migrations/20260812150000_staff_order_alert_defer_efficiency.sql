-- Avoid rewriting every deferred staff-order alert on every 15-second worker
-- tick while the external receiver is not configured. Queued/retry rows are
-- deferred immediately; an existing config_pending row is touched only when
-- its bounded retry window is actually due.

create or replace function public.defer_staff_order_alerts_configuration(
  p_retry_seconds integer default 900
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_deferred integer := 0;
begin
  update public.staff_order_alerts alert
  set status = 'config_pending',
      next_attempt_at = now() + make_interval(
        secs => least(greatest(coalesce(p_retry_seconds, 900), 60), 3600)
      ),
      locked_at = null,
      lease_token = null,
      last_error = 'ALERT_RECEIVER_NOT_CONFIGURED',
      updated_at = now()
  where alert.status in ('queued', 'retry')
     or (
       alert.status = 'config_pending'
       and alert.next_attempt_at <= now()
     );
  get diagnostics v_deferred = row_count;
  return v_deferred;
end;
$$;

revoke all on function public.defer_staff_order_alerts_configuration(integer)
  from public, anon, authenticated;
grant execute on function public.defer_staff_order_alerts_configuration(integer)
  to service_role;
