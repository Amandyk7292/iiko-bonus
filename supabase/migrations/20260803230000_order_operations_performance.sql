create index if not exists kaspi_orders_admin_recent_idx
  on public.kaspi_orders(created_at desc);

create index if not exists kaspi_orders_admin_branch_recent_idx
  on public.kaspi_orders(branch_id, created_at desc)
  where branch_id is not null;

create index if not exists kaspi_orders_active_kitchen_schedule_idx
  on public.kaspi_orders(branch_id, promised_ready_at, created_at)
  where status = 'paid'
    and kitchen_status in ('queued', 'preparing', 'ready');
