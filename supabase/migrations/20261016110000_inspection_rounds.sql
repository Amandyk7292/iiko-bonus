-- Independent, scoped employee inspection accounts. Credentials/media never public.
create table public.inspection_inspectors (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 1 and 100),
  username text not null unique check(username ~ '^[a-z0-9._-]{3,80}$'),
  password_hash text not null,
  city text not null,
  branch_ids uuid[] not null check(cardinality(branch_ids) between 1 and 50),
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.inspection_sessions (
  id uuid primary key default gen_random_uuid(),
  inspector_id uuid not null references public.inspection_inspectors(id) on delete cascade,
  token_hash text not null unique check(length(token_hash)=64),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index inspection_sessions_inspector on public.inspection_sessions(inspector_id);
create table public.inspection_rounds (
  id uuid primary key default gen_random_uuid(),
  inspector_id uuid not null references public.inspection_inspectors(id),
  branch_id uuid not null references public.bulka_locations(id),
  title text not null check(length(title) between 1 and 200),
  round_date date not null,
  deadline timestamptz not null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  check(deadline >= round_date::timestamp at time zone 'Asia/Almaty')
);
create index inspection_rounds_date_branch on public.inspection_rounds(round_date,branch_id);
create index inspection_rounds_assignee_date on public.inspection_rounds(inspector_id,round_date);
create table public.inspection_tasks (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.inspection_rounds(id) on delete cascade,
  title text not null check(length(title) between 1 and 200),
  instructions text not null default '' check(length(instructions)<=2000),
  evidence_type text not null check(evidence_type in ('none','photo','video','photo_video')),
  position integer not null check(position between 0 and 29),
  completed_at timestamptz,
  comment text not null default '' check(length(comment)<=2000),
  unique(round_id,position)
);
create table public.inspection_media (
  id uuid primary key,
  task_id uuid not null references public.inspection_tasks(id) on delete cascade,
  file_name text not null unique check(file_name ~ '^[a-f0-9-]{36}\.(jpg|mp4|webm)$'),
  kind text not null check(kind in ('photo','video')),
  mime text not null check(mime in ('image/jpeg','video/mp4','video/webm')),
  bytes integer not null check(bytes between 1 and 8388608),
  created_at timestamptz not null default now()
);
create index inspection_media_task on public.inspection_media(task_id);

create function public.inspection_save_inspector(p_id uuid,p_values jsonb,p_admin_scope uuid[],p_created_by text)
returns uuid language plpgsql security definer set search_path=public as $$
declare i public.inspection_inspectors; b uuid; selected uuid[]; selected_city text;
begin
  if p_id is not null then
    select * into i from inspection_inspectors where id=p_id for update;
    if not found or (cardinality(p_admin_scope)>0 and not(i.branch_ids<@p_admin_scope)) then
      raise exception 'ROUNDS_NOT_FOUND';
    end if;
  end if;
  selected=case when p_values ? 'branchIds' then array(select jsonb_array_elements_text(p_values->'branchIds')::uuid) else i.branch_ids end;
  selected_city=coalesce(p_values->>'city',i.city);
  if cardinality(selected) not between 1 and 50 or
     (cardinality(p_admin_scope)>0 and not(selected<@p_admin_scope)) then raise exception 'ROUNDS_BRANCH_FORBIDDEN'; end if;
  if p_id is null or p_values ? 'branchIds' or p_values ? 'city' then
    foreach b in array selected loop
      if not exists(select 1 from bulka_locations where id=b and active and city=selected_city) then
        raise exception 'ROUNDS_BRANCH_FORBIDDEN';
      end if;
    end loop;
  end if;
  if p_id is null then
    insert into inspection_inspectors(name,username,password_hash,city,branch_ids,created_by)
      values(p_values->>'name',p_values->>'username',p_values->>'passwordHash',selected_city,selected,p_created_by)
      returning id into p_id;
  else
    update inspection_inspectors set name=coalesce(p_values->>'name',name),city=selected_city,
      branch_ids=selected,active=coalesce((p_values->>'active')::boolean,active),
      password_hash=coalesce(p_values->>'passwordHash',password_hash),updated_at=now() where id=p_id;
    if p_values ? 'passwordHash' or p_values->>'active'='false' then
      delete from inspection_sessions where inspector_id=p_id;
    end if;
  end if;
  return p_id;
end $$;

create function public.inspection_open_session(p_inspector_id uuid,p_expected_hash text,p_token_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare i public.inspection_inspectors; result uuid;
begin
  select * into i from inspection_inspectors where id=p_inspector_id for update;
  if not found or not i.active or i.password_hash<>p_expected_hash then raise exception 'ROUNDS_SESSION_INVALID'; end if;
  delete from inspection_sessions where inspector_id=i.id and expires_at<=now();
  delete from inspection_sessions where id in(select id from inspection_sessions where inspector_id=i.id order by last_seen_at desc offset 9);
  insert into inspection_sessions(inspector_id,token_hash,expires_at)
    values(i.id,p_token_hash,now()+interval '30 days') returning id into result;
  return result;
end $$;

alter table public.inspection_inspectors enable row level security;
alter table public.inspection_sessions enable row level security;
alter table public.inspection_rounds enable row level security;
alter table public.inspection_tasks enable row level security;
alter table public.inspection_media enable row level security;
revoke all on public.inspection_inspectors,public.inspection_sessions,public.inspection_rounds,
  public.inspection_tasks,public.inspection_media from anon,authenticated;
grant all on public.inspection_inspectors,public.inspection_sessions,public.inspection_rounds,
  public.inspection_tasks,public.inspection_media to service_role;

-- All staff writes lock the round before tasks, rechecking current account,
-- branch and session access inside the same transaction as the write.
create function public.inspection_authorize_round(p_round_id uuid,p_inspector_id uuid,p_session_id uuid)
returns public.inspection_rounds language plpgsql security definer set search_path=public as $$
declare r public.inspection_rounds; i public.inspection_inspectors;
begin
  select * into i from inspection_inspectors where id=p_inspector_id for share;
  if not found or not i.active or not exists(select 1 from inspection_sessions
      where id=p_session_id and inspector_id=i.id and expires_at>now()) then
    raise exception 'ROUNDS_SESSION_INVALID' using errcode='P0001';
  end if;
  select * into r from inspection_rounds where id=p_round_id for update;
  if not found or r.inspector_id<>i.id or not(r.branch_id=any(i.branch_ids)) or
      not exists(select 1 from bulka_locations b where b.id=r.branch_id and b.active and b.city=i.city) then
    raise exception 'ROUNDS_NOT_FOUND' using errcode='P0001';
  end if;
  if r.cancelled_at is not null then raise exception 'ROUNDS_CANCELLED' using errcode='P0001'; end if;
  return r;
end $$;

create function public.inspection_create_rounds(p_inspector_id uuid,p_branch_ids uuid[],p_title text,
  p_date date,p_deadline timestamptz,p_tasks jsonb,p_created_by text,p_admin_scope uuid[])
returns uuid[] language plpgsql security definer set search_path=public as $$
declare i public.inspection_inspectors; b uuid; r uuid; ids uuid[]='{}'; t jsonb; n integer;
begin
  select * into i from inspection_inspectors where id=p_inspector_id for share;
  if not found or not i.active then raise exception 'ROUNDS_INSPECTOR_INVALID'; end if;
  if cardinality(p_branch_ids) not between 1 and 50 or cardinality(p_branch_ids)<>
      (select count(distinct x) from unnest(p_branch_ids) x) or
      jsonb_typeof(p_tasks)<>'array' or jsonb_array_length(p_tasks) not between 1 and 30 then
    raise exception 'ROUNDS_INVALID';
  end if;
  foreach b in array p_branch_ids loop
    if not(b=any(i.branch_ids)) or (cardinality(p_admin_scope)>0 and not(b=any(p_admin_scope))) or
      not exists(select 1 from bulka_locations where id=b and active and city=i.city) then
      raise exception 'ROUNDS_BRANCH_FORBIDDEN';
    end if;
    insert into inspection_rounds(inspector_id,branch_id,title,round_date,deadline,created_by)
      values(i.id,b,p_title,p_date,p_deadline,p_created_by) returning id into r;
    ids=array_append(ids,r); n=0;
    for t in select value from jsonb_array_elements(p_tasks) loop
      insert into inspection_tasks(round_id,title,instructions,evidence_type,position)
        values(r,t->>'title',coalesce(t->>'instructions',''),t->>'evidenceType',n);
      n=n+1;
    end loop;
  end loop;
  return ids;
end $$;

create function public.inspection_register_media(p_inspector_id uuid,p_session_id uuid,p_task_id uuid,
  p_id uuid,p_file_name text,p_kind text,p_mime text,p_bytes integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare t public.inspection_tasks; r public.inspection_rounds;
begin
  select * into t from inspection_tasks where id=p_task_id;
  if not found then raise exception 'ROUNDS_NOT_FOUND'; end if;
  r=inspection_authorize_round(t.round_id,p_inspector_id,p_session_id);
  select * into t from inspection_tasks where id=p_task_id for update;
  if t.completed_at is not null then raise exception 'ROUNDS_TASK_COMPLETED'; end if;
  if not(t.evidence_type=p_kind or t.evidence_type='photo_video') then raise exception 'ROUNDS_MEDIA_TYPE'; end if;
  if (select count(*) from inspection_media where task_id=t.id)>=6 then raise exception 'ROUNDS_MEDIA_LIMIT'; end if;
  insert into inspection_media(id,task_id,file_name,kind,mime,bytes)
    values(p_id,t.id,p_file_name,p_kind,p_mime,p_bytes);
  return p_id;
end $$;

create function public.inspection_delete_media(p_inspector_id uuid,p_session_id uuid,p_media_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare m public.inspection_media; t public.inspection_tasks;
begin
  select * into m from inspection_media where id=p_media_id;
  select * into t from inspection_tasks where id=m.task_id;
  if t.id is null then raise exception 'ROUNDS_NOT_FOUND'; end if;
  perform inspection_authorize_round(t.round_id,p_inspector_id,p_session_id);
  select * into t from inspection_tasks where id=t.id for update;
  if t.completed_at is not null then raise exception 'ROUNDS_TASK_COMPLETED'; end if;
  delete from inspection_media where id=p_media_id returning file_name into m.file_name;
  return m.file_name;
end $$;

create function public.inspection_complete_task(p_inspector_id uuid,p_session_id uuid,p_task_id uuid,p_comment text)
returns uuid language plpgsql security definer set search_path=public as $$
declare t public.inspection_tasks; r public.inspection_rounds;
begin
  select * into t from inspection_tasks where id=p_task_id;
  if not found then raise exception 'ROUNDS_NOT_FOUND'; end if;
  r=inspection_authorize_round(t.round_id,p_inspector_id,p_session_id);
  select * into t from inspection_tasks where id=p_task_id for update;
  if t.completed_at is not null then return r.id; end if;
  if (t.evidence_type in ('photo','photo_video') and not exists(select 1 from inspection_media where task_id=t.id and kind='photo')) or
     (t.evidence_type in ('video','photo_video') and not exists(select 1 from inspection_media where task_id=t.id and kind='video')) then
    raise exception 'ROUNDS_EVIDENCE_REQUIRED';
  end if;
  update inspection_tasks set completed_at=now(),comment=p_comment where id=t.id;
  if not exists(select 1 from inspection_tasks where round_id=r.id and completed_at is null) then
    update inspection_rounds set completed_at=now() where id=r.id;
  end if;
  return r.id;
end $$;

revoke all on function public.inspection_authorize_round(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.inspection_save_inspector(uuid,jsonb,uuid[],text) from public,anon,authenticated;
revoke all on function public.inspection_open_session(uuid,text,text) from public,anon,authenticated;
revoke all on function public.inspection_create_rounds(uuid,uuid[],text,date,timestamptz,jsonb,text,uuid[]) from public,anon,authenticated;
revoke all on function public.inspection_register_media(uuid,uuid,uuid,uuid,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.inspection_delete_media(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.inspection_complete_task(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.inspection_create_rounds(uuid,uuid[],text,date,timestamptz,jsonb,text,uuid[]) to service_role;
grant execute on function public.inspection_save_inspector(uuid,jsonb,uuid[],text) to service_role;
grant execute on function public.inspection_open_session(uuid,text,text) to service_role;
grant execute on function public.inspection_register_media(uuid,uuid,uuid,uuid,text,text,text,integer) to service_role;
grant execute on function public.inspection_delete_media(uuid,uuid,uuid) to service_role;
grant execute on function public.inspection_complete_task(uuid,uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
