begin;

update public.marketing_automations
set body_translations = '{"ru":"{{productName}} снова ждёт вас. Загляните в Bulka за свежей выпечкой.","kk":"{{productName}} сізді қайта күтіп тұр. Жаңа піскен өнімдер үшін Bulka-ға кіріңіз.","en":"{{productName}} is waiting for you again. Visit Bulka for something freshly baked."}'::jsonb,
  updated_at = now()
where code = 'inactive_default';

commit;
