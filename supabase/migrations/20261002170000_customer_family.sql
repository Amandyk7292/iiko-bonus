create table public.family_groups (
  id uuid primary key default gen_random_uuid(),
  owner_customer_id uuid not null unique references public.customers(id),
  created_at timestamptz not null default now()
);
create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.family_groups(id),
  customer_id uuid references public.customers(id),
  name text not null check (length(name) between 1 and 160),
  relation text not null check (relation in ('child','husband','wife','sister','brother','mother','father','grandmother','grandfather')),
  login text, email text, password_hash text,
  daily_limit_minor bigint not null default 0 check (daily_limit_minor between 0 and 20000000),
  blocked boolean not null default false,
  auth_version integer not null default 1 check (auth_version > 0),
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((relation='child' and customer_id is null and login is not null and login ~ '^[a-z][a-z0-9._-]{2,31}$' and email is not null and password_hash is not null and password_hash ~ '^\$2[aby]\$')
    or (relation<>'child' and customer_id is not null and login is null and password_hash is null))
);
create unique index family_member_customer_active on public.family_members(customer_id) where status='active';
create unique index family_child_login on public.family_members(lower(login)) where login is not null;
create index family_members_group on public.family_members(group_id,status);
create table public.family_invitations (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.family_groups(id),
  recipient_customer_id uuid not null references public.customers(id),
  relation text not null check (relation in ('husband','wife','sister','brother','mother','father','grandmother','grandfather')),
  daily_limit_minor bigint not null default 0 check (daily_limit_minor between 0 and 20000000),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days', answered_at timestamptz
);
create unique index family_invitation_pending on public.family_invitations(group_id,recipient_customer_id) where status='pending';
create index family_invitation_inbox on public.family_invitations(recipient_customer_id,status,expires_at);
create table public.family_child_sessions (
  token_hash text primary key check (length(token_hash)=64), member_id uuid not null references public.family_members(id),
  auth_version integer not null, expires_at timestamptz not null, revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.family_audit (
  id bigint generated always as identity primary key, group_id uuid not null references public.family_groups(id),
  actor_customer_id uuid not null references public.customers(id), member_id uuid references public.family_members(id),
  action text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['family_groups','family_members','family_invitations','family_child_sessions','family_audit'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy family_service_only on public.%I for all to service_role using (true) with check (true)',t);
  end loop;
end $$;
grant usage,select on sequence public.family_audit_id_seq to service_role;

create function public.family_owner_group(p_owner_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare gid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('family:'||p_owner_id));
  perform 1 from public.customers where id=p_owner_id and deleted_at is null;
  if not found then raise exception 'family customer unavailable'; end if;
  if exists(select 1 from public.family_members where customer_id=p_owner_id and status='active') then return null; end if;
  insert into public.family_groups(owner_customer_id) values(p_owner_id) on conflict(owner_customer_id) do nothing;
  select id into gid from public.family_groups where owner_customer_id=p_owner_id;
  return gid;
end $$;

create function public.family_bonus_owner(p_customer_id uuid) returns uuid
language sql stable security definer set search_path=public as $$
  select coalesce((select g.owner_customer_id from public.family_members m join public.family_groups g on g.id=m.group_id
    join public.customers c on c.id=g.owner_customer_id and c.deleted_at is null
    where m.customer_id=p_customer_id and m.status='active' and not m.blocked),p_customer_id);
$$;

create function public.family_summary(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare gid uuid; owner_id uuid; me public.family_members%rowtype; result jsonb;
begin
  select * into me from public.family_members where customer_id=p_customer_id and status='active';
  if me.id is not null then
    select id,owner_customer_id into gid,owner_id from public.family_groups where id=me.group_id;
  else
    select id,owner_customer_id into gid,owner_id from public.family_groups where owner_customer_id=p_customer_id;
  end if;
  result := jsonb_build_object('status','ok','groupId',gid,'isOwner',owner_id=p_customer_id,'memberId',me.id,
    'ownerName',(select name from public.customers where id=owner_id),'sharedBalance',coalesce((select balance from public.customers where id=owner_id),0),
    'personalBonusBalance',coalesce((select balance from public.customers where id=p_customer_id),0),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'relation',m.relation,'isChild',m.relation='child',
      'blocked',m.blocked,'dailyLimit',case when owner_id=p_customer_id or m.customer_id=p_customer_id then m.daily_limit_minor/100.0 end,
      'login',case when owner_id=p_customer_id then m.login end,'email',case when owner_id=p_customer_id and m.relation='child' then m.email end)
      order by m.created_at) from public.family_members m where m.group_id=gid and m.status='active'),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'ownerName',c.name,'relation',i.relation,'dailyLimit',i.daily_limit_minor/100.0,
      'expiresAt',i.expires_at) order by i.created_at desc) from public.family_invitations i join public.family_groups g on g.id=i.group_id
      join public.customers c on c.id=g.owner_customer_id where i.recipient_customer_id=p_customer_id and i.status='pending' and i.expires_at>now() and c.deleted_at is null),'[]'::jsonb),
    'sentInvitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',c.name,'relation',i.relation,'status',case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end))
      from public.family_invitations i join public.customers c on c.id=i.recipient_customer_id where i.group_id=gid and owner_id=p_customer_id and i.created_at>now()-interval '30 days'),'[]'::jsonb));
  return result;
end $$;

create function public.family_invite(p_owner_id uuid,p_phone text,p_relation text,p_limit_minor bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare gid uuid; recipient uuid; invitation uuid; notice uuid; lang text; owner_name text;
begin
  if p_relation not in ('husband','wife','sister','brother','mother','father','grandmother','grandfather') or p_limit_minor not between 0 and 20000000 then raise exception 'invalid family invite'; end if;
  select id into recipient from public.customers where regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g') and deleted_at is null order by created_at limit 1;
  if recipient is null then return jsonb_build_object('status','recipient_missing'); end if;
  if recipient=p_owner_id then return jsonb_build_object('status','self'); end if;
  gid:=public.family_owner_group(p_owner_id);
  if gid is null then return jsonb_build_object('status','forbidden'); end if;
  if exists(select 1 from public.family_members where customer_id=recipient and status='active') then return jsonb_build_object('status','already_member'); end if;
  update public.family_invitations set status='expired' where group_id=gid and status='pending' and expires_at<=now();
  if exists(select 1 from public.family_invitations where group_id=gid and recipient_customer_id=recipient and status='pending')
    or (select count(*) from public.family_invitations where group_id=gid and created_at>now()-interval '1 day')>=30 then return jsonb_build_object('status','rate_limited'); end if;
  insert into public.family_invitations(group_id,recipient_customer_id,relation,daily_limit_minor) values(gid,recipient,p_relation,p_limit_minor) returning id into invitation;
  notice:=md5('family-invite:'||invitation)::uuid;
  select preferred_language into lang from public.customers where id=recipient;
  select name into owner_name from public.customers where id=p_owner_id;
  insert into public.customer_notifications(id,customer_id,title,body,type,payload) values(notice,recipient,
    case lang when 'kk' then 'Отбасына шақыру' when 'en' then 'Family invitation' else 'Приглашение в семью' end,
    case lang when 'kk' then format('%s сізді Bulka отбасына шақырды. Қабылдау немесе бас тарту үшін профильдегі «Отбасы» бөлімін ашыңыз.',owner_name)
      when 'en' then format('%s invited you to a Bulka family. Open Family in your profile to accept or decline.',owner_name)
      else format('%s приглашает вас в семью Bulka. Откройте «Семья» в профиле, чтобы принять или отклонить.',owner_name) end,
    'family_invitation',jsonb_build_object('destination','notifications','invitationId',invitation));
  insert into public.family_audit(group_id,actor_customer_id,action,details) values(gid,p_owner_id,'invited',jsonb_build_object('invitationId',invitation));
  return jsonb_build_object('status','ok','invitationId',invitation,'notificationId',notice);
end $$;

create function public.family_answer_invitation(p_customer_id uuid,p_invitation_id uuid,p_accept boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare i public.family_invitations%rowtype; member_id uuid; owner_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('family:'||p_customer_id));
  select * into i from public.family_invitations where id=p_invitation_id and recipient_customer_id=p_customer_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if i.status in ('accepted','declined') then return jsonb_build_object('status',i.status); end if;
  if i.status<>'pending' or i.expires_at<=now() then return jsonb_build_object('status','expired'); end if;
  select g.owner_customer_id into owner_id from public.family_groups g join public.customers c on c.id=g.owner_customer_id where g.id=i.group_id and c.deleted_at is null;
  if owner_id is null then return jsonb_build_object('status','not_found'); end if;
  if p_accept then
    if exists(select 1 from public.family_members where customer_id=p_customer_id and status='active') then return jsonb_build_object('status','already_member'); end if;
    if exists(select 1 from public.family_groups g join public.family_members m on m.group_id=g.id and m.status='active' where g.owner_customer_id=p_customer_id)
      or exists(select 1 from public.family_groups g join public.family_invitations x on x.group_id=g.id and x.status='pending' and x.expires_at>now() where g.owner_customer_id=p_customer_id) then return jsonb_build_object('status','own_family'); end if;
    insert into public.family_members(group_id,customer_id,name,relation,daily_limit_minor)
      select i.group_id,c.id,c.name,i.relation,i.daily_limit_minor from public.customers c where c.id=p_customer_id and c.deleted_at is null returning id into member_id;
    if member_id is null then return jsonb_build_object('status','not_found'); end if;
    update public.family_invitations set status='cancelled',answered_at=now() where recipient_customer_id=p_customer_id and id<>i.id and status='pending';
  end if;
  update public.family_invitations set status=case when p_accept then 'accepted' else 'declined' end,answered_at=now() where id=i.id;
  insert into public.family_audit(group_id,actor_customer_id,member_id,action,details) values(i.group_id,p_customer_id,member_id,case when p_accept then 'joined' else 'declined' end,jsonb_build_object('invitationId',i.id));
  return jsonb_build_object('status',case when p_accept then 'accepted' else 'declined' end);
end $$;

create function public.family_create_child(p_owner_id uuid,p_name text,p_login text,p_email text,p_password_hash text,p_limit_minor bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare gid uuid; mid uuid;
begin
  gid:=public.family_owner_group(p_owner_id);
  if gid is null then return jsonb_build_object('status','forbidden'); end if;
  if exists(select 1 from public.family_members where lower(login)=lower(p_login)) then return jsonb_build_object('status','conflict'); end if;
  insert into public.family_members(group_id,name,relation,login,email,password_hash,daily_limit_minor)
    values(gid,btrim(p_name),'child',lower(p_login),lower(p_email),p_password_hash,p_limit_minor) returning id into mid;
  insert into public.family_audit(group_id,actor_customer_id,member_id,action) values(gid,p_owner_id,mid,'child_created');
  return jsonb_build_object('status','ok','memberId',mid);
exception when unique_violation then return jsonb_build_object('status','conflict');
end $$;

create function public.family_update_member(p_owner_id uuid,p_member_id uuid,p_limit_minor bigint,p_blocked boolean,p_password_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare m public.family_members%rowtype;
begin
  select m0.* into m from public.family_members m0 join public.family_groups g on g.id=m0.group_id where m0.id=p_member_id and g.owner_customer_id=p_owner_id and m0.status='active' for update of m0;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if p_password_hash is not null and m.relation<>'child' then return jsonb_build_object('status','forbidden'); end if;
  update public.family_members set daily_limit_minor=coalesce(p_limit_minor,daily_limit_minor),blocked=coalesce(p_blocked,blocked),
    password_hash=coalesce(p_password_hash,password_hash),auth_version=auth_version+1,updated_at=now() where id=m.id;
  insert into public.family_audit(group_id,actor_customer_id,member_id,action,details) values(m.group_id,p_owner_id,m.id,'member_updated',jsonb_strip_nulls(jsonb_build_object('dailyLimitMinor',p_limit_minor,'blocked',p_blocked,'passwordChanged',p_password_hash is not null)));
  return jsonb_build_object('status','ok');
end $$;

create function public.family_remove_member(p_customer_id uuid,p_member_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare m public.family_members%rowtype;
begin
  select m0.* into m from public.family_members m0 join public.family_groups g on g.id=m0.group_id where m0.id=p_member_id and (g.owner_customer_id=p_customer_id or m0.customer_id=p_customer_id) for update of m0;
  if not found then return jsonb_build_object('status','not_found'); end if;
  update public.family_members set status='removed',auth_version=auth_version+1,updated_at=now() where id=m.id;
  insert into public.family_audit(group_id,actor_customer_id,member_id,action) values(m.group_id,p_customer_id,m.id,'member_removed');
  return jsonb_build_object('status','removed','customerId',m.customer_id);
end $$;

revoke all on function public.family_owner_group(uuid),public.family_bonus_owner(uuid),public.family_summary(uuid),public.family_invite(uuid,text,text,bigint),
  public.family_answer_invitation(uuid,uuid,boolean),public.family_create_child(uuid,text,text,text,text,bigint),public.family_update_member(uuid,uuid,bigint,boolean,text),public.family_remove_member(uuid,uuid) from public,anon,authenticated;
grant execute on function public.family_bonus_owner(uuid),public.family_summary(uuid),public.family_invite(uuid,text,text,bigint),public.family_answer_invitation(uuid,uuid,boolean),
  public.family_create_child(uuid,text,text,text,text,bigint),public.family_update_member(uuid,uuid,bigint,boolean,text),public.family_remove_member(uuid,uuid) to service_role;
