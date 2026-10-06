-- Private customer photos for a separate, non-fiscal pickup souvenir strip.
create table public.pickup_photo_uploads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  image_base64 text,
  image_sha256 text not null check(image_sha256 ~ '^[a-f0-9]{64}$'),
  width integer not null check(width between 1 and 576),
  height integer not null check(height between 1 and 1000),
  image_bytes integer not null check(image_bytes between 1 and 512000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '24 hours'),
  deleted_at timestamptz,
  check(image_base64 is null or length(image_base64) <= 683000)
);
create index pickup_photo_uploads_owner on public.pickup_photo_uploads(customer_id,created_at);
create index pickup_photo_uploads_cleanup on public.pickup_photo_uploads(expires_at) where deleted_at is null;
create table public.pickup_photo_checkout_requests (
  customer_id uuid not null references public.customers(id),
  checkout_id uuid not null,
  photo_id uuid references public.pickup_photo_uploads(id),
  branch_id uuid not null references public.bulka_locations(id),
  created_at timestamptz not null default now(),
  primary key(customer_id,checkout_id)
);
alter table public.kaspi_orders add column pickup_photo_id uuid references public.pickup_photo_uploads(id);
create table public.pickup_photo_print_jobs (
  order_id uuid primary key references public.kaspi_orders(id),
  branch_id uuid not null references public.bulka_locations(id),
  terminal_id uuid,
  status text not null default 'pending' check(status in('pending','printing','printed','uncertain','expired','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  printed_at timestamptz,
  last_error text
);
create index pickup_photo_print_jobs_pending on public.pickup_photo_print_jobs(branch_id,updated_at) where status in('pending','printing','uncertain');
alter table public.pickup_photo_uploads enable row level security;
alter table public.pickup_photo_checkout_requests enable row level security;
alter table public.pickup_photo_print_jobs enable row level security;
revoke all on public.pickup_photo_uploads,public.pickup_photo_checkout_requests,public.pickup_photo_print_jobs from public,anon,authenticated;
grant all on public.pickup_photo_uploads,public.pickup_photo_checkout_requests,public.pickup_photo_print_jobs to service_role;

create function public.pickup_photo_printer_ready(p_branch uuid,p_terminal uuid default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from pos_devices d join bulka_locations b on b.id=d.branch_id
    where d.branch_id=p_branch and b.active and d.active and (p_terminal is null or d.terminal_id=p_terminal)
      and d.last_health_at>now()-interval '2 minutes' and d.connected_to_main
      and d.health_payload->>'photoPrinterReady'='true'
      and case when d.plugin_version ~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$'
        then string_to_array(d.plugin_version,'.')::int[] >= array[1,14,0] else false end);
$$;

create function public.create_pickup_photo_upload(p_customer uuid,p_image text,p_sha text,p_width integer,p_height integer,p_bytes integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare photo pickup_photo_uploads%rowtype;
begin
  perform id from customers where id=p_customer and deleted_at is null for update;
  if not found then raise exception 'Клиент недоступен' using errcode='P0001'; end if;
  if (select count(*) from pickup_photo_uploads where customer_id=p_customer and created_at>now()-interval '1 hour') >= 6
    or (select count(*) from pickup_photo_uploads where customer_id=p_customer and created_at>now()-interval '24 hours') >= 20 then
    return jsonb_build_object('error','rate_limited');
  end if;
  insert into pickup_photo_uploads(customer_id,image_base64,image_sha256,width,height,image_bytes)
    values(p_customer,p_image,p_sha,p_width,p_height,p_bytes) returning * into photo;
  return jsonb_build_object('photoId',photo.id,'expiresAt',photo.expires_at);
end;
$$;

create function public.reserve_pickup_photo_checkout(p_customer uuid,p_checkout uuid,p_photo uuid,p_branch uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior pickup_photo_checkout_requests%rowtype; photo pickup_photo_uploads%rowtype;
begin
  -- The customer lock also serializes create/retry across API processes.
  perform id from customers where id=p_customer and deleted_at is null for update;
  if not found then return jsonb_build_object('error','customer_unavailable'); end if;
  select * into prior from pickup_photo_checkout_requests where customer_id=p_customer and checkout_id=p_checkout;
  if found then
    if prior.photo_id is distinct from p_photo or (p_photo is not null and prior.branch_id is distinct from p_branch) then
      return jsonb_build_object('error','request_changed');
    end if;
  end if;
  if p_photo is not null then
    select * into photo from pickup_photo_uploads where id=p_photo and customer_id=p_customer for update;
    if photo.id is null or photo.deleted_at is not null or photo.image_base64 is null or photo.expires_at<=now() then
      return jsonb_build_object('error','photo_unavailable');
    end if;
    if not pickup_photo_printer_ready(p_branch) then return jsonb_build_object('error','printer_unavailable'); end if;
    update pickup_photo_uploads set expires_at=greatest(expires_at,now()+interval '1 hour') where id=p_photo;
  end if;
  insert into pickup_photo_checkout_requests(customer_id,checkout_id,photo_id,branch_id)
    values(p_customer,p_checkout,p_photo,p_branch) on conflict(customer_id,checkout_id)
      do update set branch_id=excluded.branch_id where pickup_photo_checkout_requests.photo_id is null;
  return jsonb_build_object('photoId',p_photo);
end;
$$;

create function public.discard_pickup_photo_upload(p_customer uuid,p_photo uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform id from customers where id=p_customer for update;
  perform id from pickup_photo_uploads where id=p_photo and customer_id=p_customer for update;
  if not found then return jsonb_build_object('error','photo_unavailable'); end if;
  if exists(select 1 from pickup_photo_checkout_requests where photo_id=p_photo) then
    return jsonb_build_object('error','request_changed'); end if;
  update pickup_photo_uploads set image_base64=null,deleted_at=coalesce(deleted_at,now()) where id=p_photo;
  return jsonb_build_object('deleted',true);
end;
$$;

create function public.protect_pickup_photo_attachment() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and (new.pickup_photo_id is distinct from old.pickup_photo_id
    or ((old.pickup_photo_id is not null or new.pickup_photo_id is not null) and
      (new.customer_id is distinct from old.customer_id or new.client_request_id is distinct from old.client_request_id
        or new.branch_id is distinct from old.branch_id or new.fulfillment_type is distinct from old.fulfillment_type
        or new.preorder_fulfillment_type is distinct from old.preorder_fulfillment_type))) then
    raise exception 'Фото заказа уже закреплено' using errcode='P0001';
  end if;
  if new.pickup_photo_id is null or tg_op='UPDATE' then return new; end if;
  if coalesce(new.fulfillment_type,'pickup') not in('pickup','preorder') or new.order_kind='gift_certificate'
    or (new.fulfillment_type='preorder' and coalesce(new.preorder_fulfillment_type,'pickup')<>'pickup')
    or not exists(select 1 from pickup_photo_checkout_requests r join pickup_photo_uploads p on p.id=r.photo_id
      where r.customer_id=new.customer_id and r.checkout_id=new.client_request_id and r.branch_id=new.branch_id
        and r.photo_id=new.pickup_photo_id and p.customer_id=new.customer_id and p.image_base64 is not null
        and p.deleted_at is null and p.expires_at>now()) then
    raise exception 'Фото недоступно для этого заказа' using errcode='P0001';
  end if;
  update pickup_photo_uploads set expires_at=greatest(expires_at,coalesce(new.scheduled_at,now())+interval '3 days') where id=new.pickup_photo_id;
  return new;
end;
$$;
create trigger protect_pickup_photo_attachment before insert or update on public.kaspi_orders
  for each row execute function public.protect_pickup_photo_attachment();

create function public.queue_pickup_photo_print() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.pickup_photo_id is not null and new.status='paid' and coalesce(new.fulfillment_type,'pickup') in('pickup','preorder')
    and (new.fulfillment_type<>'preorder' or coalesce(new.preorder_fulfillment_type,'pickup')='pickup')
    and coalesce(new.refund_status,'') in('','partial','failed') then
    insert into pickup_photo_print_jobs(order_id,branch_id) values(new.id,new.branch_id) on conflict(order_id) do nothing;
  end if;
  if new.status in('refunded','failed','expired') or coalesce(new.refund_status,'') not in('','partial','failed')
    or new.fulfillment_status in('cancelled','rejected') then
    update pickup_photo_print_jobs set status='cancelled',updated_at=now() where order_id=new.id and status='pending';
  end if;
  return new;
end;
$$;
create trigger queue_pickup_photo_print after insert or update on public.kaspi_orders
  for each row execute function public.queue_pickup_photo_print();

create function public.list_pickup_photo_print_jobs(p_branch uuid,p_terminal uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare jobs jsonb;
begin
  if not exists(select 1 from pos_devices where branch_id=p_branch and terminal_id=p_terminal and active) then
    return jsonb_build_object('error','terminal_unavailable'); end if;
  select coalesce(jsonb_agg(j),'[]'::jsonb) into jobs from(select jsonb_build_object('orderId',o.id,
    'number',o.order_number,'status',p.status,'photoId',o.pickup_photo_id) j
    from pickup_photo_print_jobs p join kaspi_orders o on o.id=p.order_id join pickup_photo_uploads f on f.id=o.pickup_photo_id
    where p.branch_id=p_branch and p.status in('pending','printing','uncertain') and (p.terminal_id is null or p.terminal_id=p_terminal)
      and o.status='paid' and o.fulfillment_type in('pickup','preorder') and o.kitchen_status in('preparing','ready')
      and (o.fulfillment_type<>'preorder' or coalesce(o.preorder_fulfillment_type,'pickup')='pickup')
      and coalesce(o.refund_status,'') in('','partial','failed') and o.fulfillment_status not in('cancelled','rejected')
      and (p.status in('printing','uncertain') or (f.deleted_at is null and f.image_base64 is not null and f.expires_at>now()))
    order by p.updated_at limit 20) ordered_jobs;
  return jsonb_build_object('jobs',jobs);
end;
$$;

create function public.pickup_photo_print_action(p_branch uuid,p_terminal uuid,p_order uuid,p_action text,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target kaspi_orders%rowtype; job pickup_photo_print_jobs%rowtype;
begin
  if not exists(select 1 from pos_devices where branch_id=p_branch and terminal_id=p_terminal and active) then
    return jsonb_build_object('error','terminal_unavailable'); end if;
  select * into target from kaspi_orders where id=p_order and branch_id=p_branch for update;
  select * into job from pickup_photo_print_jobs where order_id=p_order and branch_id=p_branch for update;
  if job.order_id is null then return jsonb_build_object('error','job_unavailable'); end if;
  if job.terminal_id is not null and job.terminal_id<>p_terminal then return jsonb_build_object('error','terminal_conflict'); end if;
  if p_action='complete' and job.status in('printing','uncertain','printed') and job.terminal_id=p_terminal then
    update pickup_photo_print_jobs set status='printed',printed_at=coalesce(printed_at,now()),last_error=null,updated_at=now() where order_id=p_order;
    return jsonb_build_object('status','printed','number',target.order_number,'photoId',target.pickup_photo_id);
  end if;
  if p_action='uncertain' and job.status in('printing','uncertain') and job.terminal_id=p_terminal then
    update pickup_photo_print_jobs set status='uncertain',last_error=left(p_error,400),updated_at=now() where order_id=p_order;
    return jsonb_build_object('status','uncertain');
  end if;
  if p_action='release' and job.status='printing' and job.terminal_id=p_terminal then
    -- Only a definite failure BEFORE invoking the printer may release a claim.
    update pickup_photo_print_jobs set status='pending',terminal_id=null,last_error=left(p_error,400),updated_at=now() where order_id=p_order;
    return jsonb_build_object('status','pending');
  end if;
  if p_action<>'claim' then return jsonb_build_object('error','invalid_action'); end if;
  if job.status='printed' then return jsonb_build_object('status','printed'); end if;
  if job.status in('printing','uncertain') then return jsonb_build_object('status','uncertain'); end if;
  if job.status<>'pending' or target.status<>'paid' or target.fulfillment_type not in('pickup','preorder')
    or (target.fulfillment_type='preorder' and coalesce(target.preorder_fulfillment_type,'pickup')<>'pickup')
    or coalesce(target.refund_status,'') not in('','partial','failed')
    or target.fulfillment_status in('cancelled','rejected')
    or target.kitchen_status not in('preparing','ready') then return jsonb_build_object('error','order_unavailable'); end if;
  if not pickup_photo_printer_ready(p_branch,p_terminal) then return jsonb_build_object('error','printer_unavailable'); end if;
  if not exists(select 1 from pickup_photo_uploads where id=target.pickup_photo_id and image_base64 is not null and deleted_at is null and expires_at>now()) then
    update pickup_photo_print_jobs set status='expired',updated_at=now() where order_id=p_order;
    return jsonb_build_object('error','photo_unavailable');
  end if;
  update pickup_photo_print_jobs set status='printing',terminal_id=p_terminal,claimed_at=now(),updated_at=now() where order_id=p_order;
  return jsonb_build_object('status','print','number',target.order_number,'photoId',target.pickup_photo_id);
end;
$$;

create function public.pickup_photo_print_image(p_branch uuid,p_terminal uuid,p_order uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target kaspi_orders%rowtype; job pickup_photo_print_jobs%rowtype; photo pickup_photo_uploads%rowtype;
begin
  if not exists(select 1 from pos_devices where branch_id=p_branch and terminal_id=p_terminal and active) then return jsonb_build_object('error','terminal_unavailable'); end if;
  select * into target from kaspi_orders where id=p_order and branch_id=p_branch;
  select * into job from pickup_photo_print_jobs where order_id=p_order and branch_id=p_branch;
  if target.status is distinct from 'paid' or target.fulfillment_type not in('pickup','preorder')
    or (target.fulfillment_type='preorder' and coalesce(target.preorder_fulfillment_type,'pickup')<>'pickup')
    or coalesce(target.refund_status,'') not in('','partial','failed') or target.fulfillment_status in('cancelled','rejected')
    or job.terminal_id is distinct from p_terminal or job.status<>'printing' then return jsonb_build_object('error','job_unavailable'); end if;
  select * into photo from pickup_photo_uploads where id=target.pickup_photo_id and customer_id=target.customer_id;
  if photo.image_base64 is null or photo.deleted_at is not null or photo.expires_at<=now() then return jsonb_build_object('error','photo_unavailable'); end if;
  return jsonb_build_object('image',photo.image_base64,'number',target.order_number);
end;
$$;

create function public.cleanup_pickup_photos() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare cleaned integer;
begin
  with expired as(select p.id from pickup_photo_uploads p where p.deleted_at is null and
    (p.expires_at<=now() or exists(select 1 from customers c where c.id=p.customer_id and c.deleted_at is not null)
      or (p.created_at<now()-interval '24 hours'
      and not exists(select 1 from pickup_photo_checkout_requests r where r.photo_id=p.id and r.created_at>now()-interval '1 hour')
      and not exists(select 1 from kaspi_orders o
      where o.pickup_photo_id=p.id and o.status='paid' and coalesce(o.refund_status,'') in('','partial','failed')
        and coalesce(o.scheduled_at,o.created_at)+interval '3 days'>now()))) limit 100 for update skip locked)
  update pickup_photo_uploads p set image_base64=null,deleted_at=now() from expired e where p.id=e.id;
  get diagnostics cleaned=row_count;
  update pickup_photo_print_jobs j set status='expired',updated_at=now() from kaspi_orders o,pickup_photo_uploads p
    where j.order_id=o.id and o.pickup_photo_id=p.id and p.deleted_at is not null and j.status='pending';
  return jsonb_build_object('deleted',cleaned);
end;
$$;
revoke all on function public.pickup_photo_printer_ready(uuid,uuid),public.create_pickup_photo_upload(uuid,text,text,integer,integer,integer),
  public.reserve_pickup_photo_checkout(uuid,uuid,uuid,uuid),public.protect_pickup_photo_attachment(),public.queue_pickup_photo_print(),
  public.discard_pickup_photo_upload(uuid,uuid),public.list_pickup_photo_print_jobs(uuid,uuid),
  public.pickup_photo_print_action(uuid,uuid,uuid,text,text),public.pickup_photo_print_image(uuid,uuid,uuid),public.cleanup_pickup_photos() from public,anon,authenticated;
grant execute on function public.pickup_photo_printer_ready(uuid,uuid),public.create_pickup_photo_upload(uuid,text,text,integer,integer,integer),
  public.reserve_pickup_photo_checkout(uuid,uuid,uuid,uuid),public.pickup_photo_print_action(uuid,uuid,uuid,text,text),
  public.discard_pickup_photo_upload(uuid,uuid),public.list_pickup_photo_print_jobs(uuid,uuid),
  public.pickup_photo_print_image(uuid,uuid,uuid),public.cleanup_pickup_photos() to service_role;
