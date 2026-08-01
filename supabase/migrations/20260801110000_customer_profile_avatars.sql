alter table public.customers
  add column if not exists avatar_key varchar(40);

alter table public.customers
  drop constraint if exists customers_avatar_key_check;

alter table public.customers
  add constraint customers_avatar_key_check check (
    avatar_key is null
    or avatar_key in (
      'kz_female_01',
      'kz_female_02',
      'kz_female_03',
      'kz_female_04',
      'kz_female_05',
      'kz_female_06',
      'kz_male_01',
      'kz_male_02',
      'kz_male_03',
      'kz_male_04',
      'kz_male_05',
      'kz_male_06'
    )
  );
