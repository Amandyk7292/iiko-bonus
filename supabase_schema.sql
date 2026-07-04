-- ====================================================================
-- ПОЛНАЯ СХЕМА БАЗЫ ДАННЫХ SUPABASE ДЛЯ СИСТЕМЫ BULKA BONUS
-- Выполните этот SQL в редакторе SQL вашего проекта Supabase
-- ====================================================================

-- 1. Таблица клиентов
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100) DEFAULT 'Гость',
  balance NUMERIC(10, 2) DEFAULT 0.00,
  total_spent NUMERIC(10, 2) DEFAULT 0.00,
  telegram_id VARCHAR(50) NULL,
  fcm_token VARCHAR(255) NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Добавление колонки fcm_token для существующих баз данных
ALTER TABLE customers ADD COLUMN IF NOT EXISTS fcm_token VARCHAR(255) NULL;

-- 2. Таблица истории транзакций (заказы, списания, начисления)
CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'order', 'bonus_earn', 'bonus_spend', etc.
  amount NUMERIC(10, 2) NOT NULL,
  description TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Таблица настроек лояльности (кэшбэк, пороги статусов)
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL
);

-- Начальные настройки (если таблица пустая)
INSERT INTO settings (key, value) VALUES
  ('base_cashback_percent', '3'),
  ('tier_silver_th', '50000'),
  ('tier_silver_cb', '5'),
  ('tier_gold_th', '150000'),
  ('tier_gold_cb', '7'),
  ('tier_platinum_th', '300000'),
  ('tier_platinum_cb', '10'),
  ('max_discount_percent', '50')
ON CONFLICT (key) DO NOTHING;

-- 4. Таблица рекламных историй (Сториз в мобильном приложении)
CREATE TABLE IF NOT EXISTS stories (
  id BIGINT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  coverUrl TEXT NOT NULL,
  contentUrl TEXT NOT NULL,
  description TEXT,
  duration INTEGER DEFAULT 15,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Начальные акции по умолчанию (если таблица пустая)
INSERT INTO stories (id, title, coverUrl, contentUrl, description, duration) VALUES
  (1, 'СЕЗОННЫЙ ФРАППЕ', 'https://images.unsplash.com/photo-1572490122747-3968b75bf699?w=500&q=80', 'https://images.unsplash.com/photo-1572490122747-3968b75bf699?w=1000&q=80', 'Попробуй наш новый летний кофейный напиток с карамелью и льдом! Освежает и заряжает бодростью на весь день.', 15),
  (2, 'НОВИНКА', 'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=500&q=80', 'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=1000&q=80', 'Свежая выпечка каждое утро в Bulka! Хрустящие круассаны и ароматный эспрессо уже ждут тебя.', 15),
  (3, 'ПЛЮШКИ ЗА ДРУГА', 'https://images.unsplash.com/photo-1559525839-b184a4d698c7?w=500&q=80', 'https://images.unsplash.com/photo-1559525839-b184a4d698c7?w=1000&q=80', 'Приглашай друзей в нашу бонусную программу! Получай 500 подарочных баллов за каждого нового друга.', 15)
ON CONFLICT (id) DO NOTHING;

-- 5. Таблица регистраций Apple Wallet push уведомлений
CREATE TABLE IF NOT EXISTS wallet_registrations (
  id BIGSERIAL PRIMARY KEY,
  serial_number VARCHAR(100) NOT NULL,
  push_token TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(serial_number, push_token)
);

-- Включение Row Level Security (RLS) по желанию
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_registrations ENABLE ROW LEVEL SECURITY;

-- Создание политик для Service Role Key (полный доступ для нашего бэкенда)
CREATE POLICY "Allow all access for Service Role" ON customers USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for Service Role" ON transactions USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for Service Role" ON settings USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for Service Role" ON stories USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for Service Role" ON wallet_registrations USING (true) WITH CHECK (true);
