-- Offer the pending-stock heartbeat fix without blocking installed registers.
-- Preserve administrator minimum-version, enforcement and customized policy.
update public.pos_plugin_policy
set latest_version='1.12.1',
    download_url='/downloads/BulkaPlugin-1.12.1-update.zip',
    updated_at=now()
where singleton=true and latest_version='1.12.0';
