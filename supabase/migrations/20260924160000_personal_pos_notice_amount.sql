create or replace function public.personal_account_pos_notice(p_id uuid,p_status text) returns uuid
language plpgsql security definer set search_path=public as $$
declare v public.personal_account_pos_payments%rowtype; lang text; nid uuid; title text; body text; formatted_amount text;
begin
  select * into v from public.personal_account_pos_payments where id=p_id;
  select preferred_language into lang from public.customers where id=v.customer_id;
  formatted_amount := case when v.amount_minor % 100 = 0 then (v.amount_minor / 100)::text else (v.amount_minor::numeric / 100)::numeric(20,2)::text end;
  if lang is distinct from 'en' then formatted_amount := replace(formatted_amount,'.',','); end if;
  nid := md5('personal-pos:'||p_id||':'||p_status)::uuid;
  if p_status='paid' then
    title := case lang when 'kk' then 'Төлем сәтті өтті' when 'en' then 'Payment successful' else 'Оплата прошла успешно' end;
    body := case lang when 'kk' then format('Кассадағы сатып алу үшін жеке шотыңыздан %s ₸ есептен шығарылды.',formatted_amount)
      when 'en' then format('%s ₸ was paid from your personal account at the counter.',formatted_amount)
      else format('С личного счёта списано %s ₸ за покупку на кассе.',formatted_amount) end;
  else
    title := case lang when 'kk' then 'Ақша қайтарылды' when 'en' then 'Payment refunded' else 'Деньги возвращены' end;
    body := case lang when 'kk' then format('Жеке шотыңызға %s ₸ қайтарылды.',formatted_amount)
      when 'en' then format('%s ₸ was returned to your personal account.',formatted_amount)
      else format('На личный счёт возвращено %s ₸.',formatted_amount) end;
  end if;
  insert into public.customer_notifications(id,customer_id,title,body,type,payload)
    values(nid,v.customer_id,title,body,'order_personal_account_'||p_status,
      jsonb_build_object('destination','notifications','paymentId',p_id,'amount',v.amount_minor::numeric/100,'status',p_status))
    on conflict(id) do nothing;
  return nid;
end; $$;

