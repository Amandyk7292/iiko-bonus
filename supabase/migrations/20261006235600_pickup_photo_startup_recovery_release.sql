-- Offer startup recovery without weakening the physical-printer readiness guard
-- or changing the administrator's minimum-version/enforcement settings.
UPDATE public.pos_plugin_policy
SET latest_version='1.14.4',
    download_url='/downloads/BulkaPlugin-1.14.4-update.zip',
    guide_url='/docs/iiko-plugin-1.14.4.html',
    updated_at=now()
WHERE singleton=true AND latest_version IN ('1.13.0','1.13.1','1.13.2','1.14.0','1.14.1','1.14.2','1.14.3');
