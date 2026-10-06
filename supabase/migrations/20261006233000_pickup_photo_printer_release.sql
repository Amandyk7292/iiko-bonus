-- Publish the signed printer-selection fix with its versioned artifacts.
-- Preserve administrator overrides and the existing enforcement policy.
UPDATE public.pos_plugin_policy
SET latest_version='1.14.1',
    download_url='/downloads/BulkaPlugin-1.14.1-update.zip',
    guide_url='/docs/iiko-plugin-1.14.1.html',
    updated_at=now()
WHERE singleton=true AND latest_version IN ('1.13.0','1.13.1','1.13.2','1.14.0');
