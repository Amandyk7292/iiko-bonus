-- Миграция: Добавить поля для переводов названий и описаний.
-- Canonical immutable migration; apply it only through the migration runner.

ALTER TABLE menu_overrides ADD COLUMN IF NOT EXISTS name_translations JSONB;
ALTER TABLE menu_overrides ADD COLUMN IF NOT EXISTS description_translations JSONB;

ALTER TABLE menu_category_overrides ADD COLUMN IF NOT EXISTS name_translations JSONB;
