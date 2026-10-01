-- A photo sticker is independent of the existing three text badges.
alter table public.product_badges add column image_url text
  check (image_url is null or (length(image_url) <= 2048 and image_url ~ '^https://[^[:space:]]+$'));
alter table public.product_badge_assignments add column sticker_id uuid
  references public.product_badges(id);
create index product_badge_assignments_sticker_idx
  on public.product_badge_assignments(sticker_id) where sticker_id is not null;

-- Available in the shared picker, with no automatic assignment to products.
insert into public.product_badges(id,label,label_kk,background,foreground,image_url)
values (
  'df8e0292-b404-4b19-adeb-7c1c4a10d684',
  'Шамрадтың таңдауы', 'Шамрадтың таңдауы', '#782b0e', '#ffffff',
  'https://bulka.com.kz/assets/product-stickers/shamrad-choice-v1.png'
);
