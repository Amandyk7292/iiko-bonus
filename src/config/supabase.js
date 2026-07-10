const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
// Для операций в бэкенде нам нужен Service Role Key (SUPABASE_SERVICE_ROLE_KEY)
// чтобы иметь полные права на чтение и запись (обходя Row Level Security).
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  const message = 'SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не заданы в .env';
  if (process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.VERCEL) {
    throw new Error(message);
  }
  console.warn('ВНИМАНИЕ: ' + message);
}

const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder-key',
);

module.exports = { supabase };
