-- Delete customer-owned object-storage files only after the database-side
-- anonymisation commits. Jobs are activated by the privacy request transition
-- inside the same transaction and may be retried safely after worker crashes.

create table if not exists public.privacy_storage_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique
    references public.customer_privacy_requests(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  status varchar(16) not null default 'pending'
    check (status in ('pending', 'ready', 'processing', 'failed', 'completed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint privacy_storage_cleanup_items_check check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 500
  )
);

create index if not exists privacy_storage_cleanup_ready_idx
  on public.privacy_storage_cleanup_jobs(next_attempt_at, created_at)
  where status in ('ready', 'failed', 'processing');

alter table public.privacy_storage_cleanup_jobs enable row level security;
drop policy if exists "service role manages privacy storage cleanup"
  on public.privacy_storage_cleanup_jobs;
create policy "service role manages privacy storage cleanup"
  on public.privacy_storage_cleanup_jobs
  for all to service_role using (true) with check (true);
revoke all on public.privacy_storage_cleanup_jobs from public, anon, authenticated;
grant all on public.privacy_storage_cleanup_jobs to service_role;

create or replace function public.activate_privacy_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    update public.privacy_storage_cleanup_jobs
    set
      status = 'ready',
      next_attempt_at = now(),
      updated_at = now()
    where request_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_privacy_request_activate_storage_cleanup
  on public.customer_privacy_requests;
create trigger customer_privacy_request_activate_storage_cleanup
after update of status on public.customer_privacy_requests
for each row execute function public.activate_privacy_storage_cleanup();

create or replace function public.claim_privacy_storage_cleanup_jobs(
  p_limit integer default 10,
  p_job_id uuid default null
)
returns setof public.privacy_storage_cleanup_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select job.id
    from public.privacy_storage_cleanup_jobs job
    where (p_job_id is null or job.id = p_job_id)
      and (
        (
          job.status in ('ready', 'failed')
          and job.next_attempt_at <= now()
        )
        or (
          job.status = 'processing'
          and job.processing_started_at <= now() - interval '15 minutes'
        )
      )
    order by job.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.privacy_storage_cleanup_jobs job
  set
    status = 'processing',
    attempts = job.attempts + 1,
    processing_started_at = now(),
    last_error = null,
    updated_at = now()
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

revoke all on function public.activate_privacy_storage_cleanup()
  from public, anon, authenticated;
revoke all on function public.claim_privacy_storage_cleanup_jobs(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_privacy_storage_cleanup_jobs(integer, uuid)
  to service_role;

comment on table public.privacy_storage_cleanup_jobs is
  'Retry-safe deletion queue activated only after customer anonymisation commits.';
