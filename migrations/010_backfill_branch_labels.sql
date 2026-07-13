-- Replace the retired test branch label without changing financial data.
update public.kaspi_orders
set
  branch_id = 'dcd47584-8559-574d-a223-467ce30069e6'::uuid,
  branch_name = 'ТЦ Ardager, 9-й микрорайон, 30/3'
where branch_name = 'Ардагер, 11 мкр';
