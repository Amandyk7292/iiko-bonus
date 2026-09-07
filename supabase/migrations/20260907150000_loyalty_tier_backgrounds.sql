ALTER TABLE public.loyalty_tiers
  ADD COLUMN IF NOT EXISTS background_image_url text;

COMMENT ON COLUMN public.loyalty_tiers.background_image_url IS
  'Optional loyalty card background; null uses the built-in tier artwork.';
