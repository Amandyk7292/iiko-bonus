-- Миграция: Добавить поля для кастомного названия и цены в menu_overrides.
-- Canonical immutable migration; apply it only through the migration runner.

ALTER TABLE menu_overrides ADD COLUMN IF NOT EXISTS custom_name TEXT;
ALTER TABLE menu_overrides ADD COLUMN IF NOT EXISTS custom_price INTEGER;
