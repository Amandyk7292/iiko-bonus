begin;

create table public.fortune_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 1 and 160),
  status text not null check(status in ('draft','active','paused')),
  branch_ids uuid[] not null check(cardinality(branch_ids) between 1 and 100),
  config jsonb not null check(jsonb_typeof(config)='object'),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.fortune_receipt_proofs (
  id uuid primary key,
  token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),
  guest_hash text not null check(guest_hash~'^[a-f0-9]{64}$'),
  campaign_id uuid not null references public.fortune_campaigns(id),
  branch_id uuid not null references public.bulka_locations(id),
  server_id text not null check(length(btrim(server_id)) between 1 and 160),
  sale_guid text not null check(length(btrim(sale_guid)) between 1 and 160),
  receipt_identity text not null check(length(btrim(receipt_identity)) between 1 and 500),
  receipt jsonb not null check(jsonb_typeof(receipt)='object'),
  expires_at timestamptz not null,
  verified_at timestamptz not null default now(),
  check(expires_at>verified_at)
);
create index fortune_proofs_campaign on public.fortune_receipt_proofs(campaign_id,verified_at desc);
create table public.fortune_draws (
  id uuid primary key,
  campaign_id uuid not null references public.fortune_campaigns(id),
  branch_id uuid not null references public.bulka_locations(id),
  proof_id uuid not null unique references public.fortune_receipt_proofs(id),
  server_id text not null,
  sale_guid text not null,
  receipt_identity text not null,
  guest_hash text not null check(guest_hash~'^[a-f0-9]{64}$'),
  claim_hash text not null unique check(claim_hash~'^[a-f0-9]{64}$'),
  prize_id uuid not null,
  prize_snapshot jsonb not null check(jsonb_typeof(prize_snapshot)='object'),
  wheel_snapshot jsonb not null check(jsonb_typeof(wheel_snapshot)='array'),
  receipt jsonb not null check(jsonb_typeof(receipt)='object'),
  status text not null default 'pending' check(status in ('pending','claimed','redeemed')),
  customer_id uuid references public.customers(id),
  won_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by text,
  unique(server_id,sale_guid),
  unique(receipt_identity),
  check(expires_at>won_at),
  check((status='pending' and customer_id is null and claimed_at is null and redeemed_at is null)
    or (status='claimed' and customer_id is not null and claimed_at is not null and redeemed_at is null)
    or (status='redeemed' and customer_id is not null and claimed_at is not null and redeemed_at is not null))
);
comment on table public.fortune_draws is 'One verified fiscal sale may spin once globally. A drawn prize reserves stock permanently, including unclaimed and expired vouchers.';
comment on column public.fortune_draws.prize_snapshot is 'Immutable label, color, kind, bonus amount and validity at winning time. Private odds and stock are omitted.';
create index fortune_draws_campaign_history on public.fortune_draws(campaign_id,won_at desc,id);
create index fortune_draws_customer_history on public.fortune_draws(customer_id,won_at desc);
create index fortune_draws_stock on public.fortune_draws(campaign_id,prize_id);

do $$ declare t text; begin
  foreach t in array array['fortune_campaigns','fortune_receipt_proofs','fortune_draws'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('create policy %I on public.%I for select to service_role using(true)',t||'_service_read',t);
  end loop;
end $$;

create function public.fortune_campaign_json(p_row public.fortune_campaigns) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select to_jsonb(p_row)||jsonb_build_object('config',p_row.config||jsonb_build_object('prizes',
    (select coalesce(jsonb_agg(p.value||jsonb_build_object('issuedCount',
      (select count(*) from fortune_draws d where d.campaign_id=p_row.id and d.prize_id=(p.value->>'id')::uuid)) order by p.ord),'[]'::jsonb)
     from jsonb_array_elements(p_row.config->'prizes') with ordinality p(value,ord))));
$$;

create function public.fortune_save_campaign(p_id uuid,p_expected_version integer,p_config jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  c fortune_campaigns%rowtype; cfg jsonb; branches uuid[]; prize jsonb; old_prize jsonb;
  total_weight integer:=0; active_count integer:=0; has_fallback boolean:=false; issued bigint; ids uuid[]:='{}';
  start_at timestamptz; end_at timestamptz;
begin
  if p_config is null or jsonb_typeof(p_config) is distinct from 'object' or
    length(btrim(coalesce(p_config->>'title',''))) not between 1 and 160 or
    coalesce(p_config->>'status','') not in ('draft','active','paused') or
    jsonb_typeof(p_config->'branchIds') is distinct from 'array' or jsonb_array_length(p_config->'branchIds') not between 1 and 100 or
    jsonb_typeof(p_config->'prizes') is distinct from 'array' or jsonb_array_length(p_config->'prizes') not between 2 and 12 or
    jsonb_typeof(p_config->'minReceiptAmount') is distinct from 'number' or
    (p_config->>'minReceiptAmount')::numeric not between 0 and 10000000 or
    jsonb_typeof(p_config->'maxReceiptAgeHours') is distinct from 'number' or
    (p_config->>'maxReceiptAgeHours')::numeric not between 1 and 168 or
    (p_config->>'maxReceiptAgeHours')::numeric<>trunc((p_config->>'maxReceiptAgeHours')::numeric) then
    raise exception 'FORTUNE_CONFIG_INVALID' using errcode='22023';
  end if;
  select array_agg(value::uuid) into branches from jsonb_array_elements_text(p_config->'branchIds');
  if cardinality(branches)<>(select count(distinct v) from unnest(branches) v) or
    (select count(*) from bulka_locations where id=any(branches))<>cardinality(branches) then
    raise exception 'FORTUNE_CONFIG_INVALID' using errcode='22023';
  end if;
  start_at:=(p_config->>'startsAt')::timestamptz; end_at:=(p_config->>'endsAt')::timestamptz;
  if start_at is not null and end_at is not null and end_at<=start_at then
    raise exception 'FORTUNE_CONFIG_INVALID' using errcode='22023';
  end if;
  if p_id is not null then
    select * into c from fortune_campaigns where id=p_id for update;
    if not found then raise exception 'FORTUNE_UNAVAILABLE' using errcode='P0001'; end if;
    if p_expected_version is null or p_expected_version<>c.version then
      raise exception 'FORTUNE_VERSION_CONFLICT' using errcode='P0001';
    end if;
  end if;
  cfg:=p_config-'expectedVersion';
  cfg:=jsonb_set(cfg,'{prizes}','[]');
  for prize in select value from jsonb_array_elements(p_config->'prizes') loop
    if jsonb_typeof(prize) is distinct from 'object' or nullif(prize->>'id','') is null or
      length(btrim(coalesce(prize->>'label',''))) not between 1 and 100 or
      coalesce(prize->>'color','')!~'^#[0-9a-fA-F]{6}$' or
      coalesce(prize->>'kind','') not in ('gift','bonus','none') or
      jsonb_typeof(prize->'weight') is distinct from 'number' or (prize->>'weight')::numeric not between 0 and 100 or
      (prize->>'weight')::numeric<>trunc((prize->>'weight')::numeric) or
      jsonb_typeof(prize->'validityDays') is distinct from 'number' or (prize->>'validityDays')::numeric not between 1 and 365 or
      (prize->>'validityDays')::numeric<>trunc((prize->>'validityDays')::numeric) or
      jsonb_typeof(prize->'active') is distinct from 'boolean' then
      raise exception 'FORTUNE_CONFIG_INVALID' using errcode='22023';
    end if;
    if (prize->>'id')::uuid=any(ids) then raise exception 'FORTUNE_CONFIG_INVALID' using errcode='22023'; end if;
    ids:=array_append(ids,(prize->>'id')::uuid);
    if prize->>'kind'='bonus' and (jsonb_typeof(prize->'bonusAmount') is distinct from 'number' or
      (prize->>'bonusAmount')::numeric not between 1 and 100000 or
      (prize->>'bonusAmount')::numeric<>trunc((prize->>'bonusAmount')::numeric)) then
      raise exception 'FORTUNE_CONFIG_INVALID' using errcode='22023';
    end if;
    if prize->>'stockLimit' is not null and (jsonb_typeof(prize->'stockLimit') is distinct from 'number' or
      (prize->>'stockLimit')::numeric not between 0 and 1000000 or
      (prize->>'stockLimit')::numeric<>trunc((prize->>'stockLimit')::numeric)) then
      raise exception 'FORTUNE_CONFIG_INVALID' using errcode='22023';
    end if;
    select count(*) into issued from fortune_draws where campaign_id=p_id and prize_id=(prize->>'id')::uuid;
    if prize->>'stockLimit' is not null and (prize->>'stockLimit')::integer<issued then
      raise exception 'FORTUNE_CONFIG_INVALID' using errcode='P0001';
    end if;
    if (prize->>'active')::boolean then
      active_count:=active_count+1;
      total_weight:=total_weight+(prize->>'weight')::integer;
      if prize->>'kind'='none' and (prize->>'weight')::integer>0 then has_fallback:=true; end if;
    end if;
    prize:=prize-'issuedCount';
    if prize->>'kind'<>'bonus' then prize:=prize||jsonb_build_object('bonusAmount',null); end if;
    if prize->>'kind'='none' then prize:=prize||jsonb_build_object('stockLimit',null); end if;
    cfg:=jsonb_set(cfg,'{prizes}',cfg->'prizes'||jsonb_build_array(prize));
  end loop;
  if p_id is not null and exists(select 1 from fortune_draws where campaign_id=p_id and not(prize_id=any(ids))) then
    raise exception 'FORTUNE_CONFIG_INVALID' using errcode='P0001';
  end if;
  if cfg->>'status'='active' and (active_count<2 or total_weight<>100 or not has_fallback or
    exists(select 1 from bulka_locations where id=any(branches) and active is not true)) then
    raise exception 'FORTUNE_CONFIG_INVALID' using errcode='P0001';
  end if;
  if p_id is null then
    insert into fortune_campaigns(title,status,branch_ids,config)
      values(btrim(cfg->>'title'),cfg->>'status',branches,cfg) returning * into c;
  else
    update fortune_campaigns set title=btrim(cfg->>'title'),status=cfg->>'status',branch_ids=branches,
      config=cfg,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into c;
  end if;
  return fortune_campaign_json(c);
end $$;

create function public.fortune_campaign_result(p_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select fortune_campaign_json(c) from fortune_campaigns c where c.id=p_id;
$$;

create function public.fortune_campaign_list() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(fortune_campaign_json(c) order by c.created_at desc,c.id),'[]'::jsonb)
  from (select * from fortune_campaigns order by created_at desc,id limit 100) c;
$$;

create function public.fortune_verify_receipt(
  p_id uuid,p_token_hash text,p_guest_hash text,p_campaign_id uuid,p_branch_id uuid,
  p_server_id text,p_sale_guid text,p_receipt_identity text,p_receipt jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c fortune_campaigns%rowtype; r fortune_receipt_proofs%rowtype; closed_at timestamptz; amount numeric;
begin
  select * into c from fortune_campaigns where id=p_campaign_id for update;
  if not found or c.status<>'active' or not(p_branch_id=any(c.branch_ids)) or
    (c.config->>'startsAt')::timestamptz>now() or (c.config->>'endsAt')::timestamptz<=now() then
    raise exception 'FORTUNE_UNAVAILABLE' using errcode='P0001';
  end if;
  if p_receipt is null or jsonb_typeof(p_receipt) is distinct from 'object' or p_receipt->>'closedAt' is null or
    jsonb_typeof(p_receipt->'total') is distinct from 'number' then
    raise exception 'FORTUNE_RECEIPT_INVALID' using errcode='22023';
  end if;
  closed_at:=(p_receipt->>'closedAt')::timestamptz; amount:=(p_receipt->>'total')::numeric;
  if closed_at>now()+interval '5 minutes' or closed_at<now()-make_interval(hours=>(c.config->>'maxReceiptAgeHours')::integer)
    or amount<(c.config->>'minReceiptAmount')::numeric or amount<=0 then
    raise exception 'FORTUNE_RECEIPT_INVALID' using errcode='P0001';
  end if;
  if not exists(select 1 from bulka_locations where id=p_branch_id and active=true) then
    raise exception 'FORTUNE_UNAVAILABLE' using errcode='P0001';
  end if;
  insert into fortune_receipt_proofs(id,token_hash,guest_hash,campaign_id,branch_id,server_id,sale_guid,receipt_identity,receipt,verified_at,expires_at)
    values(p_id,p_token_hash,p_guest_hash,p_campaign_id,p_branch_id,btrim(p_server_id),lower(btrim(p_sale_guid)),
      btrim(p_receipt_identity),p_receipt,now(),now()+interval '30 minutes') returning * into r;
  return to_jsonb(r);
end $$;

create function public.fortune_spin(
  p_proof_token_hash text,p_guest_hash text,p_draw_id uuid,p_claim_hash text,p_random numeric
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  proof fortune_receipt_proofs%rowtype; c fortune_campaigns%rowtype; d fortune_draws%rowtype;
  prize jsonb; candidate jsonb; eligible jsonb:='[]'; selected jsonb; total_weight numeric:=0; point numeric;
  issued bigint; closed_at timestamptz;
begin
  if p_random is null or p_random<0 or p_random>=1 or p_random::text in ('NaN','Infinity','-Infinity') then
    raise exception 'FORTUNE_CONFIG_INVALID' using errcode='22023';
  end if;
  select * into proof from fortune_receipt_proofs where token_hash=p_proof_token_hash;
  if not found or proof.guest_hash<>p_guest_hash then raise exception 'FORTUNE_RECEIPT_INVALID' using errcode='P0001'; end if;
  select * into c from fortune_campaigns where id=proof.campaign_id for update;
  -- Lock order is campaign, canonical sale, fiscal identity, proof, draw. All stock and save operations share the campaign lock.
  perform pg_advisory_xact_lock(hashtextextended('fortune-sale:'||proof.server_id||':'||proof.sale_guid,0));
  perform pg_advisory_xact_lock(hashtextextended('fortune-receipt:'||proof.receipt_identity,0));
  select * into proof from fortune_receipt_proofs where id=proof.id for update;
  select * into d from fortune_draws where (server_id=proof.server_id and sale_guid=proof.sale_guid) or receipt_identity=proof.receipt_identity;
  if found then
    if d.guest_hash=p_guest_hash and d.campaign_id=proof.campaign_id then
      return to_jsonb(d)||jsonb_build_object('repeated',true);
    end if;
    raise exception 'FORTUNE_RECEIPT_USED' using errcode='P0001';
  end if;
  if proof.expires_at<=now() then raise exception 'FORTUNE_EXPIRED' using errcode='P0001'; end if;
  if c.status<>'active' or not(proof.branch_id=any(c.branch_ids)) or
    (c.config->>'startsAt')::timestamptz>now() or (c.config->>'endsAt')::timestamptz<=now() or
    not exists(select 1 from bulka_locations where id=proof.branch_id and active=true) then
    raise exception 'FORTUNE_UNAVAILABLE' using errcode='P0001';
  end if;
  closed_at:=(proof.receipt->>'closedAt')::timestamptz;
  if closed_at<now()-make_interval(hours=>(c.config->>'maxReceiptAgeHours')::integer) or
    (proof.receipt->>'total')::numeric<(c.config->>'minReceiptAmount')::numeric then
    raise exception 'FORTUNE_RECEIPT_INVALID' using errcode='P0001';
  end if;
  for prize in select value from jsonb_array_elements(c.config->'prizes') loop
    if not(prize->>'active')::boolean or (prize->>'weight')::numeric<=0 then continue; end if;
    select count(*) into issued from fortune_draws where campaign_id=c.id and prize_id=(prize->>'id')::uuid;
    if prize->>'stockLimit' is not null and issued>=(prize->>'stockLimit')::integer then continue; end if;
    eligible:=eligible||jsonb_build_array(prize); total_weight:=total_weight+(prize->>'weight')::numeric;
  end loop;
  if total_weight<=0 then raise exception 'FORTUNE_UNAVAILABLE' using errcode='P0001'; end if;
  point:=p_random*total_weight;
  for candidate in select value from jsonb_array_elements(eligible) loop
    if point<(candidate->>'weight')::numeric then selected:=candidate; exit; end if;
    point:=point-(candidate->>'weight')::numeric;
  end loop;
  if selected is null then raise exception 'FORTUNE_UNAVAILABLE' using errcode='P0001'; end if;
  insert into fortune_draws(id,campaign_id,branch_id,proof_id,server_id,sale_guid,receipt_identity,guest_hash,claim_hash,
    prize_id,prize_snapshot,wheel_snapshot,receipt,won_at,expires_at)
    values(p_draw_id,c.id,proof.branch_id,proof.id,proof.server_id,proof.sale_guid,proof.receipt_identity,p_guest_hash,p_claim_hash,
      (selected->>'id')::uuid,jsonb_build_object('id',selected->>'id','label',selected->>'label','color',selected->>'color',
        'kind',selected->>'kind','bonusAmount',selected->'bonusAmount','validityDays',(selected->>'validityDays')::integer),
      (select jsonb_agg(jsonb_build_object('id',p.value->>'id','label',p.value->>'label','color',p.value->>'color') order by p.ord)
        from jsonb_array_elements(c.config->'prizes') with ordinality p(value,ord) where (p.value->>'active')::boolean),
      proof.receipt,now(),now()+make_interval(days=>(selected->>'validityDays')::integer)) returning * into d;
  return to_jsonb(d)||jsonb_build_object('repeated',false);
end $$;

create function public.fortune_claim(p_claim_hash text,p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d fortune_draws%rowtype; campaign uuid;
begin
  select campaign_id into campaign from fortune_draws where claim_hash=p_claim_hash;
  if not found then raise exception 'FORTUNE_CLAIM_INVALID' using errcode='P0001'; end if;
  perform 1 from fortune_campaigns where id=campaign for update;
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  perform 1 from customers where id=p_customer_id and deleted_at is null for update;
  if not found then raise exception 'FORTUNE_CLAIM_INVALID' using errcode='P0001'; end if;
  select * into d from fortune_draws where claim_hash=p_claim_hash for update;
  if d.prize_snapshot->>'kind'='none' then raise exception 'FORTUNE_CLAIM_INVALID' using errcode='P0001'; end if;
  if d.customer_id is not null and d.customer_id<>p_customer_id then raise exception 'FORTUNE_CLAIM_INVALID' using errcode='P0001'; end if;
  if d.customer_id=p_customer_id then return to_jsonb(d); end if;
  if d.expires_at<=now() then raise exception 'FORTUNE_EXPIRED' using errcode='P0001'; end if;
  update fortune_draws set customer_id=p_customer_id,status='claimed',claimed_at=now() where id=d.id returning * into d;
  return to_jsonb(d);
end $$;

create function public.fortune_redeem_bonus(p_draw_id uuid,p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d fortune_draws%rowtype; campaign uuid; new_balance numeric; amount numeric;
begin
  select campaign_id into campaign from fortune_draws where id=p_draw_id;
  if not found then raise exception 'FORTUNE_CLAIM_INVALID' using errcode='P0001'; end if;
  perform 1 from fortune_campaigns where id=campaign for update;
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select balance into new_balance from customers where id=p_customer_id and deleted_at is null for update;
  if not found then raise exception 'FORTUNE_CLAIM_INVALID' using errcode='P0001'; end if;
  select * into d from fortune_draws where id=p_draw_id for update;
  if d.customer_id is distinct from p_customer_id or d.prize_snapshot->>'kind'<>'bonus' then
    raise exception 'FORTUNE_CLAIM_INVALID' using errcode='P0001';
  end if;
  if d.status='redeemed' then return to_jsonb(d)||jsonb_build_object('balance',new_balance,'repeated',true); end if;
  if d.status<>'claimed' or d.expires_at<=now() then raise exception 'FORTUNE_EXPIRED' using errcode='P0001'; end if;
  amount:=(d.prize_snapshot->>'bonusAmount')::numeric;
  if amount is null or amount<=0 or amount>100000 then raise exception 'FORTUNE_CONFIG_INVALID' using errcode='22023'; end if;
  update customers set balance=balance+amount,updated_at=now() where id=p_customer_id returning balance into new_balance;
  insert into transactions(customer_id,order_id,type,amount,description,available_at,activated_at)
    values(p_customer_id,'FORTUNE-'||d.id,'deposit',amount,'Рулетка Bulka · '||(d.prize_snapshot->>'label'),now(),now());
  update fortune_draws set status='redeemed',redeemed_at=now(),redeemed_by='customer:'||p_customer_id where id=d.id returning * into d;
  return to_jsonb(d)||jsonb_build_object('balance',new_balance,'repeated',false);
end $$;

create function public.fortune_redeem_gift(p_draw_id uuid,p_branches uuid[],p_actor text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d fortune_draws%rowtype; campaign uuid;
begin
  if p_branches is null or array_position(p_branches,null) is not null or length(btrim(coalesce(p_actor,''))) not between 1 and 160 then
    raise exception 'FORTUNE_FORBIDDEN' using errcode='22023';
  end if;
  select campaign_id into campaign from fortune_draws where id=p_draw_id;
  if not found then raise exception 'FORTUNE_CLAIM_INVALID' using errcode='P0001'; end if;
  perform 1 from fortune_campaigns where id=campaign for update;
  select * into d from fortune_draws where id=p_draw_id for update;
  if cardinality(p_branches)>0 and not(d.branch_id=any(p_branches)) then raise exception 'FORTUNE_FORBIDDEN' using errcode='P0001'; end if;
  if d.prize_snapshot->>'kind'<>'gift' or d.customer_id is null then raise exception 'FORTUNE_CLAIM_INVALID' using errcode='P0001'; end if;
  if d.status='redeemed' then return to_jsonb(d)||jsonb_build_object('repeated',true); end if;
  if d.status<>'claimed' or d.expires_at<=now() then raise exception 'FORTUNE_EXPIRED' using errcode='P0001'; end if;
  update fortune_draws set status='redeemed',redeemed_at=now(),redeemed_by=btrim(p_actor) where id=d.id returning * into d;
  return to_jsonb(d)||jsonb_build_object('repeated',false);
end $$;

revoke all on function public.fortune_campaign_json(public.fortune_campaigns),public.fortune_campaign_result(uuid),public.fortune_campaign_list(),
  public.fortune_save_campaign(uuid,integer,jsonb),
  public.fortune_verify_receipt(uuid,text,text,uuid,uuid,text,text,text,jsonb),
  public.fortune_spin(text,text,uuid,text,numeric),public.fortune_claim(text,uuid),
  public.fortune_redeem_bonus(uuid,uuid),public.fortune_redeem_gift(uuid,uuid[],text)
from public,anon,authenticated;
grant execute on function public.fortune_campaign_result(uuid),public.fortune_campaign_list(),public.fortune_save_campaign(uuid,integer,jsonb),
  public.fortune_verify_receipt(uuid,text,text,uuid,uuid,text,text,text,jsonb),
  public.fortune_spin(text,text,uuid,text,numeric),public.fortune_claim(text,uuid),
  public.fortune_redeem_bonus(uuid,uuid),public.fortune_redeem_gift(uuid,uuid[],text)
to service_role;
commit;
