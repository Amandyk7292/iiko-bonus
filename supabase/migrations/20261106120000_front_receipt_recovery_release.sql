-- Publish only from the reviewed previous release. Preserve enforcement,
-- minimum version and any newer/custom rollout selected by an administrator.
UPDATE public.pos_plugin_policy
SET latest_version = '1.15.3',
    download_url = '/downloads/BulkaPlugin-1.15.3-update.zip',
    guide_url = '/docs/iiko-plugin-1.15.3.html',
    updated_at = now()
WHERE singleton = true AND latest_version = '1.15.2';
