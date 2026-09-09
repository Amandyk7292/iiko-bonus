-- Admin and staff logins remain revocable across restarts and releases.
-- Temporary WhatsApp operator links keep their existing finite lifetime.
-- Infinity preserves the expiry comparisons used by staff push/dispatch SQL.
update public.admin_sessions set expires_at = 'infinity'::timestamptz
where revoked_at is null and expires_at > now() and role <> 'whatsapp_operator';
comment on column public.admin_sessions.expires_at is
  'Infinity means a persistent session; revocation, active profile and credential version are still enforced.';
