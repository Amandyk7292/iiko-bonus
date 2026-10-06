-- Advertise the signed photo-printing plugin only with its deployed artifacts.
-- Preserve administrator overrides and the current minimum/enforcement policy.
UPDATE public.pos_plugin_policy
SET latest_version='1.14.0',
    download_url='/downloads/BulkaPlugin-1.14.0-update.zip',
    guide_url='/docs/iiko-plugin-1.14.0.html',
    updated_at=now()
WHERE singleton=true AND latest_version IN ('1.13.0','1.13.1','1.13.2');
