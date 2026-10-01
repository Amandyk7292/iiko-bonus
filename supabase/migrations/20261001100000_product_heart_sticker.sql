-- Refresh the existing shared sticker so every selected product keeps its assignment.
update public.product_badges
set label = 'Менің таңдауым (сердце)',
    label_kk = 'Менің таңдауым (жүрек)',
    image_url = 'https://bulka.com.kz/assets/product-stickers/my-choice-heart-v2.png',
    updated_at = now()
where id = 'df8e0292-b404-4b19-adeb-7c1c4a10d684';

-- Offer a round alternative without changing any product's selected sticker.
insert into public.product_badges(id,label,label_kk,background,foreground,image_url)
values (
  'ab7f4960-35ed-4cd8-9fb6-c794d481aa85',
  'Менің таңдауым (круг)', 'Менің таңдауым (шеңбер)', '#782b0e', '#ffffff',
  'https://bulka.com.kz/assets/product-stickers/my-choice-circle-v2.png'
);
