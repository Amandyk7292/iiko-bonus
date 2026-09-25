alter table public.product_badges
  add column label_kk text not null default ''
  check (length(label_kk) <= 24);

notify pgrst, 'reload schema';
