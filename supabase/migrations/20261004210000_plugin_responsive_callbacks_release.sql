-- Offer the callback responsiveness fix after deploying its signed artifacts.
-- Preserve administrator-selected releases and minimum/enforcement settings.
UPDATE public.pos_plugin_policy
SET latest_version='1.13.2',
    download_url='/downloads/BulkaPlugin-1.13.2-update.zip',
    guide_url='/docs/iiko-plugin-1.13.2.html',
    updated_at=now()
WHERE singleton=true AND latest_version='1.13.1';
