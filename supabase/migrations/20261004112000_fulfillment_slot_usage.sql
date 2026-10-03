begin;
-- A scalar JSON aggregate is not truncated by PostgREST's max_rows. Count
-- reservations in the current buckets, including starts from an older grid.
create function public.fulfillment_slot_usage(p_branch uuid,p_type text,p_from timestamptz,p_to timestamptz,
 p_minutes integer,p_offset integer default 300,p_now timestamptz default now(),p_exclude_request uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_type not in ('pickup','delivery','preorder') or p_minutes not between 15 and 240
  or p_offset not between -840 and 840 or p_from is null or p_to is null or p_now is null
  or p_to<=p_from or p_to>p_from+interval '17 days' then raise exception 'Invalid slot usage request'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('startsAt',bucket,'used',held) order by bucket) from (
  select lower(public.fulfillment_slot_bounds(scheduled_at,p_minutes,p_offset)) bucket,count(*) held
  from public.fulfillment_slot_reservations
  where branch_id=p_branch and fulfillment_type=p_type and scheduled_at>=p_from and scheduled_at<p_to
   and (p_exclude_request is null or client_request_id is distinct from p_exclude_request)
   and (status='committed' or (status='active' and expires_at>p_now))
  group by 1
 ) usage),'[]'::jsonb);
end;
$$;
revoke all on function public.fulfillment_slot_usage(uuid,text,timestamptz,timestamptz,integer,integer,timestamptz,uuid)
 from public,anon,authenticated;
grant execute on function public.fulfillment_slot_usage(uuid,text,timestamptz,timestamptz,integer,integer,timestamptz,uuid) to service_role;
commit;
