-- Offer configured receipt-printer support while preserving administrator
-- enforcement and the requirement for an actual image-capable device.
UPDATE public.pos_plugin_policy
SET latest_version='1.14.5',
    download_url='/downloads/BulkaPlugin-1.14.5-update.zip',
    guide_url='/docs/iiko-plugin-1.14.5.html',
    updated_at=now()
WHERE singleton=true AND latest_version IN ('1.13.0','1.13.1','1.13.2','1.14.0','1.14.1','1.14.2','1.14.3','1.14.4');
