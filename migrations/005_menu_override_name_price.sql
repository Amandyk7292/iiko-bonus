-- Миграция: Добавить поля для кастомного названия и цены в menu_overrides
-- Запустить в Supabase SQL Editor

ALTER TABLE menu_overrides ADD COLUMN IF NOT EXISTS custom_name TEXT;
ALTER TABLE menu_overrides ADD COLUMN IF NOT EXISTS custom_price INTEGER;
