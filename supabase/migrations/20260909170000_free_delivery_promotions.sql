-- migration-safety: allow-destructive reason=Add the requested free-delivery promotion type by replacing CHECK constraints without deleting data.
-- Only replace CHECK constraints to add a promotion type; existing rows are retained.
alter table public.targeted_promotions
  drop constraint if exists targeted_promotions_discount_type_check,
  drop constraint if exists targeted_promotions_discount_value_check;

alter table public.targeted_promotions
  add constraint targeted_promotions_discount_type_check
    check (discount_type in ('percent', 'fixed', 'free_delivery')),
  add constraint targeted_promotions_discount_value_check
    check ((discount_type = 'free_delivery' and discount_value = 0)
      or (discount_type in ('percent', 'fixed') and discount_value > 0));
