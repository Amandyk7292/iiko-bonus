-- Supabase grants new public tables to service_role by default. Remove those
-- inherited grants before allowing the minimum access to permanent device history.
revoke all on public.referral_device_owners,
  public.referral_stable_device_owners,
  public.referral_stable_devices,
  public.referral_device_proofs from service_role;

grant select,insert on public.referral_device_owners,
  public.referral_stable_device_owners to service_role;
grant select on public.referral_stable_devices,
  public.referral_device_proofs to service_role;
