-- Each register has its own credential. Pairing another register never rotates
-- the branch credential or changes inventory quantities / pending receipts.
create table public.pos_devices (
  terminal_id uuid primary key,
  branch_id uuid not null references public.bulka_locations(id),
  terminal_group_id uuid not null,
  name text not null check (length(name) between 1 and 100),
  token_hash text not null unique check (length(token_hash) = 64),
  active boolean not null default true,
  paired_at timestamptz not null default now()
);
create index pos_devices_branch on public.pos_devices(branch_id);
create table public.pos_pairing_codes (
  id uuid not null unique default gen_random_uuid(),
  code_hash text primary key check (length(code_hash) = 64),
  branch_id uuid not null references public.bulka_locations(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  terminal_id uuid,
  token_hash text,
  consumed_at timestamptz
);
create table public.pos_pairing_attempts (
  source_hash text primary key check (length(source_hash) = 64),
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
alter table public.pos_devices enable row level security;
alter table public.pos_pairing_codes enable row level security;
alter table public.pos_pairing_attempts enable row level security;
revoke all on public.pos_devices, public.pos_pairing_codes, public.pos_pairing_attempts from public, anon, authenticated;
grant all on public.pos_devices, public.pos_pairing_codes, public.pos_pairing_attempts to service_role;

create function public.issue_pos_pairing_code(p_branch uuid, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare expiry timestamptz := now() + interval '5 minutes'; pairing_id uuid;
begin
  perform 1 from bulka_locations where id=p_branch and active for update;
  if not found then raise exception 'Филиал недоступен' using errcode='22023'; end if;
  if (select count(*) from pos_pairing_codes where branch_id=p_branch and created_at > now()-interval '10 minutes') >= 10 then
    raise exception 'Подождите перед созданием нового кода' using errcode='P0001';
  end if;
  -- Keep consumed codes briefly for retries after a lost activation response.
  update pos_pairing_codes set expires_at=least(expires_at,now()) where branch_id=p_branch and consumed_at is null;
  delete from pos_pairing_codes where expires_at < now()-interval '1 day';
  insert into pos_pairing_codes(code_hash,branch_id,expires_at) values(p_code_hash,p_branch,expiry) returning id into pairing_id;
  return jsonb_build_object('id',pairing_id,'expiresAt',expiry);
end;
$$;

-- Returning false (rather than raising) commits the attempt counter even for
-- invalid codes. This limiter survives process restarts and multiple workers.
create function public.allow_pos_pairing_attempt(p_source_hash text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from pos_pairing_attempts where window_start < now()-interval '1 day';
  insert into pos_pairing_attempts(source_hash) values(p_source_hash)
  on conflict(source_hash) do update set
    attempts=case when pos_pairing_attempts.window_start < now()-interval '10 minutes' then 1 else pos_pairing_attempts.attempts+1 end,
    window_start=case when pos_pairing_attempts.window_start < now()-interval '10 minutes' then now() else pos_pairing_attempts.window_start end
  returning attempts into n;
  return n <= 10;
end;
$$;

create function public.activate_pos_device(p_code_hash text,p_terminal uuid,p_group uuid,p_name text,p_token_hash text,p_expected_branch uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c pos_pairing_codes%rowtype; d pos_devices%rowtype; branch_name text; policy front_stock_policies%rowtype;
begin
  if p_terminal is null or p_group is null or length(p_token_hash)<>64 or length(trim(p_name)) not between 1 and 100 then
    raise exception 'Некорректные данные кассы' using errcode='22023';
  end if;
  select * into c from pos_pairing_codes where code_hash=p_code_hash for update;
  if not found then return jsonb_build_object('error','invalid_code'); end if;
  if p_expected_branch is not null and p_expected_branch<>c.branch_id then
    return jsonb_build_object('error','different_branch');
  end if;
  -- Serialize different activation codes targeting the same physical register.
  perform pg_advisory_xact_lock(hashtextextended('pos-device:'||p_terminal::text,0));
  perform pg_advisory_xact_lock(hashtextextended('pos-group:'||p_group::text,0));
  select * into d from pos_devices where terminal_id=p_terminal for update;
  if c.consumed_at is not null then
    if c.terminal_id is distinct from p_terminal or c.token_hash is distinct from p_token_hash
       or c.consumed_at < now()-interval '10 minutes' or not coalesce(d.active,false)
       or d.token_hash is distinct from p_token_hash or d.branch_id is distinct from c.branch_id then
      return jsonb_build_object('error','invalid_code');
    end if;
  else
    if c.expires_at <= now() then return jsonb_build_object('error','invalid_code'); end if;
    if d.terminal_id is not null and d.branch_id <> c.branch_id then
      return jsonb_build_object('error','different_branch');
    end if;
  end if;
  if exists(select 1 from pos_devices where terminal_group_id=p_group and active and branch_id<>c.branch_id) then
    return jsonb_build_object('error','different_branch');
  end if;
  select name into branch_name from bulka_locations where id=c.branch_id and active for update;
  if not found then return jsonb_build_object('error','invalid_code'); end if;
  if exists(select 1 from pos_devices where branch_id=c.branch_id and active and terminal_group_id<>p_group) then
    return jsonb_build_object('error','different_group');
  end if;
  if c.consumed_at is null then
    if d.terminal_id is null and (select count(*) from pos_devices where branch_id=c.branch_id and active)>=8 then
      return jsonb_build_object('error','device_limit');
    end if;
    insert into pos_devices(terminal_id,branch_id,terminal_group_id,name,token_hash)
      values(p_terminal,c.branch_id,p_group,trim(p_name),p_token_hash)
    on conflict(terminal_id) do update set name=excluded.name,token_hash=excluded.token_hash,active=true,paired_at=now();
    update pos_pairing_codes set terminal_id=p_terminal,token_hash=p_token_hash,consumed_at=now() where code_hash=p_code_hash;
  end if;
  select * into policy from front_stock_policies where branch_id=c.branch_id for update;
  if coalesce(policy.enabled,false) and not p_terminal=any(policy.terminal_ids) then
    update front_stock_policies set terminal_ids=array_append(terminal_ids,p_terminal),updated_at=now() where branch_id=c.branch_id;
  end if;
  return jsonb_build_object('branchId',c.branch_id,'branchName',branch_name,'terminalId',p_terminal,'sharedStockEnabled',coalesce(policy.enabled,false));
end;
$$;
revoke all on function public.issue_pos_pairing_code(uuid,text), public.allow_pos_pairing_attempt(text), public.activate_pos_device(text,uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.issue_pos_pairing_code(uuid,text), public.allow_pos_pairing_attempt(text), public.activate_pos_device(text,uuid,uuid,text,text,uuid) to service_role;
