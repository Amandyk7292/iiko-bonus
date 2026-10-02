-- Offer the family-compatible cashier client without blocking older registers.
-- Keep the administrator's minimum-version and enforcement settings unchanged.
update public.pos_plugin_policy
set latest_version = '1.12.0',
    download_url = '/downloads/BulkaPlugin-1.12.0-update.zip',
    updated_at = now()
where singleton = true
  and latest_version = '1.11.1';
