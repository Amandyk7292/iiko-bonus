-- Offer the initial updater-capable release after its signed artifacts are deployed.
-- Preserve administrator-selected versions and all minimum/enforcement settings.
UPDATE public.pos_plugin_policy
SET latest_version='1.13.0',
    download_url='/downloads/BulkaPlugin-1.13.0-update.zip',
    guide_url='/docs/iiko-plugin-1.13.0.html',
    updated_at=now()
WHERE singleton=true AND latest_version='1.12.1';
