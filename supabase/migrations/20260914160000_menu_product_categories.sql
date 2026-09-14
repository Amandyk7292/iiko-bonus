ALTER TABLE public.menu_overrides
  ADD COLUMN IF NOT EXISTS custom_category_id text;
