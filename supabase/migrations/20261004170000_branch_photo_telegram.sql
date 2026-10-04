begin;
create table public.photo_report_telegram_users (
  user_id text primary key check(user_id ~ '^[1-9][0-9]{0,19}$'),
  chat_id text not null check(chat_id=user_id),
  username text check(username is null or username ~ '^[a-z0-9_]{5,32}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index photo_report_telegram_username on public.photo_report_telegram_users(username) where username is not null;
create table public.photo_report_telegram_state (
  singleton boolean primary key default true check(singleton),
  send_time time not null default '09:00' check(extract(second from send_time)=0 and send_time<time '24:00'),
  owner_user_id text references public.photo_report_telegram_users(user_id),
  update_offset bigint not null default 0 check(update_offset>=0),
  poll_lease_id uuid,
  poll_lease_until timestamptz,
  delivery_not_before timestamptz
);
insert into public.photo_report_telegram_state(singleton) values(true);
create table public.photo_report_telegram_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id text unique references public.photo_report_telegram_users(user_id),
  grant_username text not null check(grant_username ~ '^[a-z0-9_]{5,32}$'),
  role text not null check(role in ('owner','admin')),
  status text not null check(status in ('pending','active','disabled','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((status='pending' and user_id is null and role='admin') or status='removed' or (user_id is not null and status in ('active','disabled')))
);
create unique index photo_report_telegram_pending_username on public.photo_report_telegram_recipients(grant_username) where status='pending';
create unique index photo_report_telegram_one_owner on public.photo_report_telegram_recipients(role) where role='owner';
create function public.photo_report_telegram_immutable_identity() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_table_name='photo_report_telegram_state' then
    if old.owner_user_id is not null and new.owner_user_id is distinct from old.owner_user_id then raise exception 'Telegram owner identity is immutable'; end if;
  elsif old.user_id is not null and new.user_id is distinct from old.user_id then raise exception 'Telegram recipient identity is immutable'; end if;
  return new;
end $$;
create trigger photo_report_telegram_owner_immutable before update of owner_user_id on public.photo_report_telegram_state
  for each row execute function public.photo_report_telegram_immutable_identity();
create trigger photo_report_telegram_recipient_immutable before update of user_id on public.photo_report_telegram_recipients
  for each row execute function public.photo_report_telegram_immutable_identity();
create table public.photo_report_telegram_updates (
  update_id bigint primary key check(update_id>=0),
  lease_id uuid not null,
  status text not null check(status in ('processing','prepared','reply_attempted','completed')),
  reply_parts jsonb check(reply_parts is null or (jsonb_typeof(reply_parts)='array' and jsonb_array_length(reply_parts) between 1 and 20)),
  reply_requires_report_access boolean not null default false,
  reply_part_index integer not null default 0 check(reply_part_index between 0 and 20),
  reply_not_before timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.photo_report_telegram_digests (
  report_date date primary key,
  parts jsonb not null check(jsonb_typeof(parts)='array' and jsonb_array_length(parts) between 1 and 20),
  created_at timestamptz not null default now()
);
create table public.photo_report_telegram_outbox (
  id uuid primary key default gen_random_uuid(),
  report_date date not null references public.photo_report_telegram_digests(report_date),
  recipient_id uuid not null references public.photo_report_telegram_recipients(id),
  part_index integer not null check(part_index between 0 and 19),
  chat_id text not null,
  text text not null check(length(text) between 1 and 4096),
  status text not null default 'queued' check(status in ('queued','sending','sent','failed','uncertain','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  message_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(report_date,recipient_id,part_index)
);
create index photo_report_telegram_outbox_due on public.photo_report_telegram_outbox(status,next_attempt_at);
alter table public.photo_report_telegram_users enable row level security;
alter table public.photo_report_telegram_state enable row level security;
alter table public.photo_report_telegram_recipients enable row level security;
alter table public.photo_report_telegram_updates enable row level security;
alter table public.photo_report_telegram_digests enable row level security;
alter table public.photo_report_telegram_outbox enable row level security;
revoke all on public.photo_report_telegram_users,public.photo_report_telegram_state,public.photo_report_telegram_recipients,
  public.photo_report_telegram_updates,public.photo_report_telegram_digests,public.photo_report_telegram_outbox from public,anon,authenticated;
grant all on public.photo_report_telegram_users,public.photo_report_telegram_state,public.photo_report_telegram_recipients,
  public.photo_report_telegram_updates,public.photo_report_telegram_digests,public.photo_report_telegram_outbox to service_role;

create function public.photo_report_telegram_recipient(p_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('recipientId',r.id,'username',coalesce(u.username,r.grant_username),'userId',r.user_id,'role',r.role,'status',r.status)
  from photo_report_telegram_recipients r left join photo_report_telegram_users u on u.user_id=r.user_id where r.id=p_id;
$$;
create function public.photo_report_telegram_settings() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('sendTime',left(send_time::text,5),'timeZone','Asia/Oral',
    'ownerUserId',owner_user_id,'deliveryNotBefore',delivery_not_before) from photo_report_telegram_state where singleton;
$$;
create function public.observe_photo_report_telegram_user(p_user_id text,p_chat_id text,p_username text,p_owner_username text,p_owner_user_id text,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s photo_report_telegram_state%rowtype; r photo_report_telegram_recipients%rowtype; pending uuid; actor_role text:='user';
begin
  if p_user_id !~ '^[1-9][0-9]{0,19}$' or p_chat_id is distinct from p_user_id or (p_username is not null and p_username !~ '^[a-z0-9_]{5,32}$')
    or p_owner_username !~ '^[a-z0-9_]{5,32}$' then return jsonb_build_object('error','invalid'); end if;
  select * into s from photo_report_telegram_state where singleton for update;
  -- A recycled nickname updates discovery only. Existing ownership and grants never follow it.
  update photo_report_telegram_users set username=null where username=p_username and user_id<>p_user_id;
  insert into photo_report_telegram_users(user_id,chat_id,username,created_at,last_seen_at)
    values(p_user_id,p_chat_id,p_username,p_now,p_now)
    on conflict(user_id) do update set username=excluded.username,chat_id=excluded.chat_id,last_seen_at=excluded.last_seen_at;
  if s.owner_user_id is null and p_username=p_owner_username and (p_owner_user_id is null or p_user_id=p_owner_user_id) then
    update photo_report_telegram_state set owner_user_id=p_user_id where singleton;
    insert into photo_report_telegram_recipients(user_id,grant_username,role,status,created_at,updated_at)
      values(p_user_id,p_username,'owner','active',p_now,p_now);
    s.owner_user_id:=p_user_id;
  end if;
  select * into r from photo_report_telegram_recipients where user_id=p_user_id;
  select id into pending from photo_report_telegram_recipients where grant_username=p_username and status='pending';
  if pending is not null then
    if r.id is null then
      update photo_report_telegram_recipients set user_id=p_user_id,status='active',updated_at=p_now where id=pending returning * into r;
    else
      update photo_report_telegram_recipients set status='removed',updated_at=p_now where id=pending;
      update photo_report_telegram_recipients set status='active',updated_at=p_now where id=r.id returning * into r;
    end if;
  elsif r.status='disabled' then
    -- A new private update proves this user has unblocked/started the bot again.
    update photo_report_telegram_recipients set status='active',updated_at=p_now where id=r.id returning * into r;
  end if;
  if s.owner_user_id=p_user_id then actor_role:='owner';
  elsif r.role='admin' and r.status='active' then actor_role:='admin'; end if;
  return jsonb_build_object('userId',p_user_id,'chatId',p_chat_id,'username',p_username,'role',actor_role);
end $$;

create function public.photo_report_telegram_owner_command(p_actor text,p_lease uuid,p_update bigint,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s photo_report_telegram_state%rowtype;
begin
  select * into s from photo_report_telegram_state where singleton for update;
  if s.owner_user_id is null or s.owner_user_id is distinct from p_actor then return jsonb_build_object('error','owner_required'); end if;
  if p_lease is not null or p_update is not null then
    if p_lease is null or p_update is null or s.poll_lease_id is distinct from p_lease or s.poll_lease_until<=p_now
      or not exists(select 1 from photo_report_telegram_updates where update_id=p_update and lease_id=p_lease and status='processing') then
      return jsonb_build_object('error','lease_lost');
    end if;
  end if;
  return jsonb_build_object('authorized',true);
end $$;
create function public.add_photo_report_telegram_admin(p_actor text,p_username text,p_lease uuid,p_update bigint,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare auth jsonb; target text; r photo_report_telegram_recipients%rowtype;
begin
  auth:=public.photo_report_telegram_owner_command(p_actor,p_lease,p_update,p_now); if auth ? 'error' then return auth; end if;
  if p_username !~ '^[a-z0-9_]{5,32}$' then return jsonb_build_object('error','invalid'); end if;
  select user_id into target from photo_report_telegram_users where username=p_username;
  if target is not null then
    select * into r from photo_report_telegram_recipients where user_id=target;
    if r.id is null then
      select * into r from photo_report_telegram_recipients where grant_username=p_username and status='pending';
      if r.id is null then insert into photo_report_telegram_recipients(user_id,grant_username,role,status,created_at,updated_at)
        values(target,p_username,'admin','active',p_now,p_now) returning * into r;
      else update photo_report_telegram_recipients set user_id=target,status='active',updated_at=p_now where id=r.id returning * into r; end if;
    elsif r.role='admin' then
      update photo_report_telegram_recipients set status='active',updated_at=p_now where id=r.id returning * into r;
    end if;
  else
    select * into r from photo_report_telegram_recipients where grant_username=p_username and status='pending';
    if r.id is null then insert into photo_report_telegram_recipients(grant_username,role,status,created_at,updated_at)
      values(p_username,'admin','pending',p_now,p_now) returning * into r; end if;
  end if;
  return public.photo_report_telegram_recipient(r.id);
end $$;
create function public.remove_photo_report_telegram_admin(p_actor text,p_username text,p_lease uuid,p_update bigint,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare auth jsonb; r photo_report_telegram_recipients%rowtype;
begin
  auth:=public.photo_report_telegram_owner_command(p_actor,p_lease,p_update,p_now); if auth ? 'error' then return auth; end if;
  select r1.* into r from photo_report_telegram_recipients r1 join photo_report_telegram_users u on u.user_id=r1.user_id where u.username=p_username;
  if r.id is null then select * into r from photo_report_telegram_recipients where grant_username=p_username and status<>'removed' order by created_at desc,id limit 1; end if;
  if r.id is null or r.status='removed' then return jsonb_build_object('removed',false,'username',p_username); end if;
  if r.role='owner' then return jsonb_build_object('error','owner_protected'); end if;
  update photo_report_telegram_recipients set status='removed',updated_at=p_now where id=r.id;
  update photo_report_telegram_outbox set status='cancelled',completed_at=p_now where recipient_id=r.id and status in ('queued','sending','uncertain','failed');
  return jsonb_build_object('removed',true,'recipientId',r.id,'username',p_username,'userId',r.user_id);
end $$;
create function public.list_photo_report_telegram_admins(p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s photo_report_telegram_state%rowtype;
begin
  select * into s from photo_report_telegram_state where singleton;
  if s.owner_user_id is null or s.owner_user_id is distinct from p_actor then return jsonb_build_object('error','owner_required'); end if;
  return coalesce((select jsonb_agg(public.photo_report_telegram_recipient(id) order by role desc,created_at,id)
    from photo_report_telegram_recipients where status<>'removed'),'[]'::jsonb);
end $$;
create function public.set_photo_report_telegram_time(p_actor text,p_time text,p_lease uuid,p_update bigint,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare auth jsonb;
begin
  auth:=public.photo_report_telegram_owner_command(p_actor,p_lease,p_update,p_now); if auth ? 'error' then return auth; end if;
  if p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return jsonb_build_object('error','invalid'); end if;
  update photo_report_telegram_state set send_time=p_time::time where singleton;
  return public.photo_report_telegram_settings();
end $$;

create function public.photo_report_telegram_poll_lease(p_action text,p_lease uuid,p_offset bigint,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s photo_report_telegram_state%rowtype;
begin
  select * into s from photo_report_telegram_state where singleton for update;
  if p_action='acquire' then
    if s.poll_lease_id is not null and s.poll_lease_id<>p_lease and s.poll_lease_until>p_now then return 'null'::jsonb; end if;
    update photo_report_telegram_state set poll_lease_id=p_lease,poll_lease_until=p_now+interval '90 seconds' where singleton;
    return to_jsonb(s.update_offset);
  end if;
  if s.poll_lease_id is distinct from p_lease or (p_action<>'release' and s.poll_lease_until<=p_now) then return 'false'::jsonb; end if;
  if p_action='release' then update photo_report_telegram_state set poll_lease_id=null,poll_lease_until=null where singleton;
  elsif p_action='renew' then update photo_report_telegram_state set poll_lease_until=p_now+interval '90 seconds' where singleton;
  elsif p_action='advance' and p_offset>=0 then
    update photo_report_telegram_state set update_offset=greatest(update_offset,p_offset),poll_lease_until=p_now+interval '90 seconds' where singleton;
  else return 'false'::jsonb; end if;
  return 'true'::jsonb;
end $$;
create function public.photo_report_telegram_bot_update(p_action text,p_update bigint,p_lease uuid,p_parts jsonb,p_requires_report_access boolean,p_retry integer,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s photo_report_telegram_state%rowtype; u photo_report_telegram_updates%rowtype;
begin
  select * into s from photo_report_telegram_state where singleton for update;
  if s.poll_lease_id is distinct from p_lease or s.poll_lease_until<=p_now then
    if p_action='claim' then return 'null'::jsonb; else return 'false'::jsonb; end if;
  end if;
  if p_action='claim' then
    if p_update<s.update_offset then return to_jsonb('completed'::text); end if;
    select * into u from photo_report_telegram_updates where update_id=p_update;
    if u.update_id is null then
      insert into photo_report_telegram_updates(update_id,lease_id,status,created_at,updated_at) values(p_update,p_lease,'processing',p_now,p_now);
      return to_jsonb('claimed'::text);
    end if;
    update photo_report_telegram_updates set lease_id=p_lease,updated_at=p_now where update_id=p_update;
    return to_jsonb(case when u.status='processing' then 'claimed' else u.status end);
  end if;
  select * into u from photo_report_telegram_updates where update_id=p_update and lease_id=p_lease;
  if u.update_id is null then return 'false'::jsonb; end if;
  if p_action='get_reply' then return case when u.reply_parts is null or u.status='completed' then 'null'::jsonb else jsonb_build_object('parts',u.reply_parts,'requiresReportAccess',u.reply_requires_report_access,'notBefore',greatest(u.reply_not_before,s.delivery_not_before),'partIndex',u.reply_part_index) end;
  elsif p_action='prepare' and u.status='processing' and jsonb_typeof(p_parts)='array' and jsonb_array_length(p_parts) between 1 and 20
    and not exists(select 1 from jsonb_array_elements(p_parts) part where jsonb_typeof(part)<>'string' or length(part#>>'{}') not between 1 and 4096) then
    update photo_report_telegram_updates set status='prepared',reply_parts=p_parts,reply_requires_report_access=coalesce(p_requires_report_access,false),reply_part_index=0,updated_at=p_now where update_id=p_update;
  elsif p_action='reply' and u.status='prepared' and (u.reply_not_before is null or u.reply_not_before<=p_now)
    and (s.delivery_not_before is null or s.delivery_not_before<=p_now) then
    update photo_report_telegram_updates set status='reply_attempted',updated_at=p_now where update_id=p_update;
  elsif p_action='retry_reply' and u.status='reply_attempted' and u.reply_parts is not null then
    update photo_report_telegram_updates set status='prepared',reply_not_before=p_now+make_interval(secs=>greatest(0,p_retry)),updated_at=p_now where update_id=p_update;
    update photo_report_telegram_state set delivery_not_before=greatest(delivery_not_before,p_now+make_interval(secs=>greatest(0,p_retry))) where singleton;
  elsif p_action='advance_part' and u.status='reply_attempted' and u.reply_parts is not null then
    update photo_report_telegram_updates set reply_part_index=reply_part_index+1,
      status=case when reply_part_index+1>=jsonb_array_length(reply_parts) then 'completed' else 'prepared' end,
      reply_not_before=null,updated_at=p_now where update_id=p_update;
    if u.reply_part_index+1>=jsonb_array_length(u.reply_parts) then
      update photo_report_telegram_state set update_offset=greatest(update_offset,p_update+1),poll_lease_until=p_now+interval '90 seconds' where singleton;
    end if;
  elsif p_action='complete' then
    update photo_report_telegram_updates set status='completed',updated_at=p_now where update_id=p_update;
    update photo_report_telegram_state set update_offset=greatest(update_offset,p_update+1),poll_lease_until=p_now+interval '90 seconds' where singleton;
  else return 'false'::jsonb; end if;
  return 'true'::jsonb;
end $$;

create function public.enqueue_photo_report_telegram_digest(p_date date,p_parts jsonb,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  perform 1 from photo_report_telegram_state where singleton for update;
  if p_date is distinct from (timezone('Asia/Oral',p_now)::date-1) or jsonb_typeof(p_parts)<>'array'
    or jsonb_array_length(p_parts) not between 1 and 20
    or exists(select 1 from jsonb_array_elements(p_parts) part where jsonb_typeof(part)<>'string' or length(part#>>'{}') not between 1 and 4096) then
    return jsonb_build_object('error','invalid');
  end if;
  insert into photo_report_telegram_digests(report_date,parts,created_at) values(p_date,p_parts,p_now) on conflict do nothing;
  if not found then return jsonb_build_object('enqueued',false,'count',0); end if;
  insert into photo_report_telegram_outbox(report_date,recipient_id,part_index,chat_id,text,next_attempt_at,created_at)
    select p_date,r.id,(part.ordinality-1)::int,u.chat_id,part.value#>>'{}',p_now,p_now
    from photo_report_telegram_recipients r join photo_report_telegram_users u on u.user_id=r.user_id
    cross join jsonb_array_elements(p_parts) with ordinality part(value,ordinality) where r.status='active';
  get diagnostics n=row_count;
  return jsonb_build_object('enqueued',true,'count',n);
end $$;
create function public.claim_photo_report_telegram_deliveries(p_limit integer,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s photo_report_telegram_state%rowtype; result jsonb;
begin
  select * into s from photo_report_telegram_state where singleton for update;
  -- Sending after a crash may already have succeeded. Never automatically send it twice.
  update photo_report_telegram_outbox set status='uncertain' where status='sending' and lease_until<=p_now;
  update photo_report_telegram_outbox o set status='cancelled',completed_at=p_now
    where status in ('queued','sending','uncertain','failed') and not exists(select 1 from photo_report_telegram_recipients r where r.id=o.recipient_id and r.status='active');
  if s.delivery_not_before>p_now then return '[]'::jsonb; end if;
  with candidates as (
    select o.id from photo_report_telegram_outbox o where o.status='queued' and o.next_attempt_at<=p_now
      and not exists(select 1 from photo_report_telegram_outbox earlier where earlier.report_date=o.report_date
        and earlier.recipient_id=o.recipient_id and earlier.part_index<o.part_index and earlier.status not in ('sent','failed','cancelled'))
      order by o.report_date,o.recipient_id,o.part_index limit greatest(1,least(p_limit,100)) for update skip locked
  ), claimed as (
    update photo_report_telegram_outbox o set status='sending',lease_token=gen_random_uuid(),lease_until=p_now+interval '90 seconds',attempts=attempts+1
      from candidates c where o.id=c.id returning o.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'chatId',chat_id,'text',text,'leaseToken',lease_token,
      'recipientId',recipient_id,'reportDate',report_date,'partIndex',part_index) order by report_date,recipient_id,part_index),'[]'::jsonb) into result from claimed;
  return result;
end $$;
create function public.authorize_photo_report_telegram_delivery(p_id uuid,p_lease uuid,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o photo_report_telegram_outbox%rowtype;
begin
  perform 1 from photo_report_telegram_state where singleton for update;
  select * into o from photo_report_telegram_outbox where id=p_id and lease_token=p_lease;
  if o.id is null or o.status<>'sending' then return 'false'::jsonb; end if;
  if o.lease_until<=p_now then update photo_report_telegram_outbox set status='uncertain' where id=p_id; return 'false'::jsonb; end if;
  if not exists(select 1 from photo_report_telegram_recipients where id=o.recipient_id and status='active') then
    update photo_report_telegram_outbox set status='cancelled',completed_at=p_now where id=p_id; return 'false'::jsonb;
  end if;
  if (select delivery_not_before from photo_report_telegram_state where singleton)>p_now then
    update photo_report_telegram_outbox set status='queued',lease_token=null,lease_until=null where id=p_id; return 'false'::jsonb;
  end if;
  return 'true'::jsonb;
end $$;
create function public.complete_photo_report_telegram_delivery(p_id uuid,p_lease uuid,p_message_id text,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform 1 from photo_report_telegram_state where singleton for update;
  update photo_report_telegram_outbox set status='sent',message_id=p_message_id,completed_at=p_now
    where id=p_id and lease_token=p_lease and status in ('sending','uncertain');
  return to_jsonb(found);
end $$;
create function public.fail_photo_report_telegram_delivery(p_id uuid,p_lease uuid,p_retry integer,p_permanent boolean,p_uncertain boolean,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform 1 from photo_report_telegram_state where singleton for update;
  update photo_report_telegram_outbox set status=case when p_uncertain then 'uncertain' when p_permanent then 'failed' else 'queued' end,
    next_attempt_at=case when not p_uncertain and not p_permanent then p_now+make_interval(secs=>greatest(0,p_retry)) else next_attempt_at end,
    completed_at=case when p_permanent then p_now else null end
    where id=p_id and lease_token=p_lease and status='sending';
  if not found then return 'false'::jsonb; end if;
  if not p_uncertain and not p_permanent then update photo_report_telegram_state
    set delivery_not_before=greatest(delivery_not_before,p_now+make_interval(secs=>greatest(0,p_retry))) where singleton; end if;
  return 'true'::jsonb;
end $$;
create function public.disable_photo_report_telegram_recipient(p_id uuid,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform 1 from photo_report_telegram_state where singleton for update;
  update photo_report_telegram_recipients set status='disabled',updated_at=p_now where id=p_id and status='active';
  if not found then return 'false'::jsonb; end if;
  update photo_report_telegram_outbox set status='cancelled',completed_at=p_now where recipient_id=p_id and status in ('queued','sending','uncertain','failed');
  return 'true'::jsonb;
end $$;
create function public.unresolved_photo_report_telegram_deliveries(p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform 1 from photo_report_telegram_state where singleton for update;
  update photo_report_telegram_outbox set status='uncertain' where status='sending' and lease_until<=p_now;
  update photo_report_telegram_outbox o set status='cancelled',completed_at=p_now
    where status in ('queued','sending','uncertain','failed') and not exists(select 1 from photo_report_telegram_recipients r where r.id=o.recipient_id and r.status='active');
  return (select jsonb_build_object('uncertain',count(*) filter(where o.status='uncertain'),'failed',count(*) filter(where o.status='failed'))
    from photo_report_telegram_outbox o join photo_report_telegram_recipients r on r.id=o.recipient_id
    where r.status='active' and o.status in ('uncertain','failed'));
end $$;

-- Only the trusted, token-authenticated bot process may call these functions.
revoke all on function public.photo_report_telegram_immutable_identity(),public.photo_report_telegram_recipient(uuid),public.photo_report_telegram_settings(),
  public.observe_photo_report_telegram_user(text,text,text,text,text,timestamptz),public.photo_report_telegram_owner_command(text,uuid,bigint,timestamptz),
  public.add_photo_report_telegram_admin(text,text,uuid,bigint,timestamptz),public.remove_photo_report_telegram_admin(text,text,uuid,bigint,timestamptz),
  public.list_photo_report_telegram_admins(text),public.set_photo_report_telegram_time(text,text,uuid,bigint,timestamptz),
  public.photo_report_telegram_poll_lease(text,uuid,bigint,timestamptz),public.photo_report_telegram_bot_update(text,bigint,uuid,jsonb,boolean,integer,timestamptz),
  public.enqueue_photo_report_telegram_digest(date,jsonb,timestamptz),public.claim_photo_report_telegram_deliveries(integer,timestamptz),
  public.authorize_photo_report_telegram_delivery(uuid,uuid,timestamptz),public.complete_photo_report_telegram_delivery(uuid,uuid,text,timestamptz),
  public.fail_photo_report_telegram_delivery(uuid,uuid,integer,boolean,boolean,timestamptz),public.disable_photo_report_telegram_recipient(uuid,timestamptz),
  public.unresolved_photo_report_telegram_deliveries(timestamptz) from public,anon,authenticated;
grant execute on function public.photo_report_telegram_immutable_identity(),public.photo_report_telegram_recipient(uuid),public.photo_report_telegram_settings(),
  public.observe_photo_report_telegram_user(text,text,text,text,text,timestamptz),public.photo_report_telegram_owner_command(text,uuid,bigint,timestamptz),
  public.add_photo_report_telegram_admin(text,text,uuid,bigint,timestamptz),public.remove_photo_report_telegram_admin(text,text,uuid,bigint,timestamptz),
  public.list_photo_report_telegram_admins(text),public.set_photo_report_telegram_time(text,text,uuid,bigint,timestamptz),
  public.photo_report_telegram_poll_lease(text,uuid,bigint,timestamptz),public.photo_report_telegram_bot_update(text,bigint,uuid,jsonb,boolean,integer,timestamptz),
  public.enqueue_photo_report_telegram_digest(date,jsonb,timestamptz),public.claim_photo_report_telegram_deliveries(integer,timestamptz),
  public.authorize_photo_report_telegram_delivery(uuid,uuid,timestamptz),public.complete_photo_report_telegram_delivery(uuid,uuid,text,timestamptz),
  public.fail_photo_report_telegram_delivery(uuid,uuid,integer,boolean,boolean,timestamptz),public.disable_photo_report_telegram_recipient(uuid,timestamptz),
  public.unresolved_photo_report_telegram_deliveries(timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
