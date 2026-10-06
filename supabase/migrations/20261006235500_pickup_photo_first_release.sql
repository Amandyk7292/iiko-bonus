-- New photo attachments require the photo-first coordinator. Preserve all
-- payment, pairing, live-printer and administrator update-policy safeguards.
create or replace function public.pickup_photo_printer_ready(p_branch uuid,p_terminal uuid default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from pos_devices d join bulka_locations b on b.id=d.branch_id
    where d.branch_id=p_branch and b.active and d.active and (p_terminal is null or d.terminal_id=p_terminal)
      and d.last_health_at>now()-interval '2 minutes' and d.connected_to_main
      and d.health_payload->>'photoPrinterReady'='true'
      and case when d.plugin_version ~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$'
        then string_to_array(d.plugin_version,'.')::int[] >= array[1,14,3] else false end);
$$;
revoke all on function public.pickup_photo_printer_ready(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pickup_photo_printer_ready(uuid,uuid) to service_role;

UPDATE public.pos_plugin_policy
SET latest_version='1.14.3',
    download_url='/downloads/BulkaPlugin-1.14.3-update.zip',
    guide_url='/docs/iiko-plugin-1.14.3.html',
    updated_at=now()
WHERE singleton=true AND latest_version IN ('1.13.0','1.13.1','1.13.2','1.14.0','1.14.1','1.14.2');
