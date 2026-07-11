-- Миграция: Админ-панель управления меню
-- Запустить в Supabase SQL Editor

-- 1. Оверрайды для товаров (фото, скрытие, стоп-лист)
CREATE TABLE IF NOT EXISTS menu_overrides (
  iiko_product_id TEXT PRIMARY KEY,
  custom_image_url TEXT,
  custom_description TEXT,
  is_hidden BOOLEAN DEFAULT false,
  is_stop_listed BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Оверрайды для категорий (скрытие, переименование)
CREATE TABLE IF NOT EXISTS menu_category_overrides (
  iiko_category_id TEXT PRIMARY KEY,
  custom_name TEXT,
  custom_image_url TEXT,
  is_hidden BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Кастомные товары, добавленные вручную (не из iiko)
CREATE TABLE IF NOT EXISTS custom_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL,
  category_name TEXT NOT NULL,
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
