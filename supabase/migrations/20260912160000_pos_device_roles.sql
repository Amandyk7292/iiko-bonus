-- A bakery terminal belongs to the branch but has no order or payment access.
alter table public.pos_devices add column if not exists device_role text not null default 'register';
alter table public.pos_devices add column if not exists last_seen_at timestamptz not null default now();
alter table public.pos_pairing_codes add column if not exists device_role text not null default 'register';

do $$
begin
  if not exists (select 1 from pg_constraint where conname='pos_devices_device_role_check') then
    alter table public.pos_devices add constraint pos_devices_device_role_check
      check(device_role in ('register','bakery'));
  end if;
  if not exists (select 1 from pg_constraint where conname='pos_pairing_codes_device_role_check') then
    alter table public.pos_pairing_codes add constraint pos_pairing_codes_device_role_check
      check(device_role in ('register','bakery'));
  end if;
end;
$$;

create or replace function public.issue_pos_pairing_code(
  p_branch uuid,p_code_hash text,p_device_role text
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare expiry timestamptz:=now()+interval '5 minutes'; pairing_id uuid;
begin
  if p_device_role not in ('register','bakery') then
    raise exception 'Некорректный режим устройства' using errcode='22023';
  end if;
  perform 1 from bulka_locations where id=p_branch and active for update;
  if not found then raise exception 'Филиал недоступен' using errcode='22023'; end if;
  if (select count(*) from pos_pairing_codes where branch_id=p_branch and created_at>now()-interval '10 minutes')>=10 then
    raise exception 'Подождите перед созданием нового кода' using errcode='P0001';
  end if;
  update pos_pairing_codes set expires_at=least(expires_at,now())
    where branch_id=p_branch and consumed_at is null;
  delete from pos_pairing_codes where branch_id=p_branch and expires_at<now()-interval '1 day';
  insert into pos_pairing_codes(code_hash,branch_id,expires_at,device_role)
    values(p_code_hash,p_branch,expiry,p_device_role) returning id into pairing_id;
  return jsonb_build_object('id',pairing_id,'expiresAt',expiry,'deviceRole',p_device_role);
end;
$$;

create or replace function public.issue_pos_pairing_code(p_branch uuid,p_code_hash text)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select public.issue_pos_pairing_code(p_branch,p_code_hash,'register')
$$;

create or replace function public.activate_pos_device(
  p_code_hash text,p_terminal uuid,p_group uuid,p_name text,p_token_hash text,p_expected_branch uuid default null
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c pos_pairing_codes%rowtype; d pos_devices%rowtype; branch_name text; policy front_stock_policies%rowtype;
begin
  if p_terminal is null or p_group is null or length(p_token_hash)<>64 or length(trim(p_name)) not between 1 and 100 then
    raise exception 'Некорректные данные кассы' using errcode='22023';
  end if;
  select * into c from pos_pairing_codes where code_hash=p_code_hash;
  if not found then return jsonb_build_object('error','invalid_code'); end if;
  if p_expected_branch is not null and p_expected_branch<>c.branch_id then
    return jsonb_build_object('error','different_branch');
  end if;
  perform 1 from bulka_locations where id=c.branch_id and active for update;
  if not found then return jsonb_build_object('error','invalid_code'); end if;
  select * into c from pos_pairing_codes where code_hash=p_code_hash for update;
  if not found then return jsonb_build_object('error','invalid_code'); end if;
  perform pg_advisory_xact_lock(hashtextextended('pos-device:'||p_terminal::text,0));
  perform pg_advisory_xact_lock(hashtextextended('pos-group:'||p_group::text,0));
  select * into d from pos_devices where terminal_id=p_terminal for update;
  if c.consumed_at is not null then
    if c.terminal_id is distinct from p_terminal or c.token_hash is distinct from p_token_hash
       or c.consumed_at<now()-interval '10 minutes' or not coalesce(d.active,false)
       or d.token_hash is distinct from p_token_hash or d.branch_id is distinct from c.branch_id
       or d.device_role is distinct from c.device_role then
      return jsonb_build_object('error','invalid_code');
    end if;
  else
    if c.expires_at<=now() then return jsonb_build_object('error','invalid_code'); end if;
    if d.terminal_id is not null and d.branch_id<>c.branch_id then
      return jsonb_build_object('error','different_branch');
    end if;
  end if;
  if exists(select 1 from pos_devices where terminal_group_id=p_group and active and branch_id<>c.branch_id) then
    return jsonb_build_object('error','different_branch');
  end if;
  select name into branch_name from bulka_locations where id=c.branch_id and active for update;
  if not found then return jsonb_build_object('error','invalid_code'); end if;
  if c.device_role='register' and exists(
    select 1 from pos_devices where branch_id=c.branch_id and active
      and device_role='register' and terminal_group_id<>p_group
  ) then
    return jsonb_build_object('error','different_group');
  end if;
  if c.consumed_at is null and d.terminal_id is not null
    and d.device_role='register' and c.device_role='bakery'
    and exists(select 1 from front_stock_policies where branch_id=c.branch_id and enabled and p_terminal=any(terminal_ids)) then
    return jsonb_build_object('error','device_role_conflict');
  end if;
  if c.consumed_at is null then
    if d.terminal_id is null and (select count(*) from pos_devices where branch_id=c.branch_id and active)>=8 then
      return jsonb_build_object('error','device_limit');
    end if;
    insert into pos_devices(terminal_id,branch_id,terminal_group_id,name,token_hash,device_role,last_seen_at)
      values(p_terminal,c.branch_id,p_group,trim(p_name),p_token_hash,c.device_role,now())
    on conflict(terminal_id) do update set terminal_group_id=excluded.terminal_group_id,
      name=excluded.name,token_hash=excluded.token_hash,device_role=excluded.device_role,
      active=true,paired_at=now(),last_seen_at=now();
    update pos_pairing_codes set terminal_id=p_terminal,token_hash=p_token_hash,consumed_at=now()
      where code_hash=p_code_hash;
  else
    update pos_devices set last_seen_at=now() where terminal_id=p_terminal;
  end if;
  select * into policy from front_stock_policies where branch_id=c.branch_id for update;
  if c.device_role='register' and coalesce(policy.enabled,false) and not p_terminal=any(policy.terminal_ids) then
    update front_stock_policies set terminal_ids=array_append(terminal_ids,p_terminal),updated_at=now()
      where branch_id=c.branch_id;
  elsif c.device_role='bakery' and coalesce(policy.enabled,false)
    and p_terminal=any(policy.terminal_ids) and cardinality(policy.terminal_ids)>1 then
    update front_stock_policies set terminal_ids=array_remove(terminal_ids,p_terminal),updated_at=now()
      where branch_id=c.branch_id;
  end if;
  return jsonb_build_object(
    'branchId',c.branch_id,'branchName',branch_name,'terminalId',p_terminal,
    'deviceRole',c.device_role,
    'sharedStockEnabled',c.device_role='register' and coalesce(policy.enabled,false)
  );
end;
$$;

revoke all on function public.issue_pos_pairing_code(uuid,text,text),
  public.issue_pos_pairing_code(uuid,text),
  public.activate_pos_device(text,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.issue_pos_pairing_code(uuid,text,text),
  public.issue_pos_pairing_code(uuid,text),
  public.activate_pos_device(text,uuid,uuid,text,text,uuid) to service_role;
