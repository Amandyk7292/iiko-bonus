-- Publish the signed order-alarm update without changing the minimum version
-- or any administrator-customized policy.
UPDATE public.pos_plugin_policy
SET latest_version='1.15.2',
    download_url='/downloads/BulkaPlugin-1.15.2-update.zip',
    guide_url='/docs/iiko-plugin-1.15.2.html',
    updated_at=now()
WHERE singleton=true AND latest_version='1.15.1';
