-- Historical zone columns stay intact; they no longer control delivery.
-- migration-safety: allow-destructive reason=User requested removal of delivery zones; replace the tariff constraint with coordinate validation without deleting branch or order data.
alter table public.bulka_locations
  drop constraint if exists bulka_locations_delivery_rules_check;
alter table public.bulka_locations
  add constraint bulka_locations_delivery_rules_check
  check (delivery_enabled = false or (latitude is not null and longitude is not null));
