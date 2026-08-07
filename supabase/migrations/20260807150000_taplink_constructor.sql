-- Versioned Taplink configuration with an isolated draft and atomic publication.

begin;

create extension if not exists pgcrypto;

create table if not exists public.taplink_pages (
  slug text primary key
    check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  draft_document jsonb not null,
  draft_version bigint not null default 1
    check (draft_version > 0),
  published_document jsonb not null,
  published_version bigint not null default 1
    check (published_version > 0 and published_version <= draft_version),
  updated_at timestamptz not null default now(),
  updated_by varchar(160) not null default 'system',
  published_at timestamptz not null default now(),
  published_by varchar(160) not null default 'system',
  constraint taplink_pages_draft_object_check check (
    jsonb_typeof(draft_document) = 'object'
    and pg_column_size(draft_document) <= 262144
  ),
  constraint taplink_pages_published_object_check check (
    jsonb_typeof(published_document) = 'object'
    and pg_column_size(published_document) <= 262144
  )
);

create table if not exists public.taplink_revisions (
  id uuid primary key default gen_random_uuid(),
  page_slug text not null references public.taplink_pages(slug) on delete cascade,
  version bigint not null check (version > 0),
  document jsonb not null,
  published_at timestamptz not null default now(),
  published_by varchar(160) not null default 'system',
  constraint taplink_revisions_page_version_unique unique (page_slug, version),
  constraint taplink_revisions_document_object_check check (
    jsonb_typeof(document) = 'object'
    and pg_column_size(document) <= 262144
  )
);

create index if not exists taplink_revisions_page_time_idx
  on public.taplink_revisions(page_slug, published_at desc);

do $migration$
declare
  seed_document jsonb := $seed$
  {
    "schemaVersion": 1,
    "defaultLocale": "kk",
    "enabledLocales": ["kk", "ru"],
    "profile": {
      "logoUrl": "/taplink/assets/brand/bulka_logo.png?v=20260806-1",
      "title": {
        "kk": "Bulka жаныңызда",
        "ru": "Bulka рядом"
      },
      "description": {
        "kk": "Күн сайын балғын пісірме, сүйікті дәмдер және ыңғайлы жеткізу.",
        "ru": "Свежая выпечка, любимые вкусы и удобная доставка каждый день."
      },
      "footer": {
        "kk": "Bulka отбасылық наубайханасы",
        "ru": "Семейная пекарня Bulka"
      }
    },
    "seo": {
      "title": {
        "kk": "Bulka — жеткізу және мекенжайлар",
        "ru": "Bulka — доставка и адреса"
      },
      "description": {
        "kk": "Bulka жеткізу қызметі және Ақтау мен Астанадағы отбасылық наубайхананың мекенжайлары.",
        "ru": "Доставка Bulka и адреса семейной пекарни в Актау и Астане."
      },
      "ogImageUrl": "/taplink/assets/brand/bulka_logo.png?v=20260806-1"
    },
    "theme": {
      "preset": "bulka",
      "backgroundImageUrl": "/taplink/assets/mobile-background.png?v=20260806-1",
      "buttonStyle": "soft",
      "radius": 22
    },
    "blocks": [
      {
        "id": "10000000-0000-4000-8000-000000000001",
        "type": "link",
        "enabled": true,
        "style": "primary",
        "labels": {
          "kk": "Жеткізуге тапсырыс беру",
          "ru": "Заказать доставку"
        },
        "subtitles": {
          "kk": "+7 701 277 22 33",
          "ru": "+7 701 277 22 33"
        },
        "ariaLabels": {
          "kk": "WhatsApp арқылы Bulka жеткізуіне тапсырыс беру: +7 701 277 22 33",
          "ru": "Заказать доставку Bulka в WhatsApp: +7 701 277 22 33"
        },
        "icon": "phone",
        "target": {
          "type": "whatsapp",
          "value": "77012772233"
        }
      },
      {
        "id": "10000000-0000-4000-8000-000000000002",
        "type": "section",
        "enabled": true,
        "labels": {
          "kk": "2GIS-тегі филиалдарымыз",
          "ru": "Наши филиалы в 2GIS"
        }
      },
      {
        "id": "10000000-0000-4000-8000-000000000003",
        "type": "link",
        "enabled": true,
        "style": "city",
        "labels": {
          "kk": "Bulka Ақтауда",
          "ru": "Bulka в Актау"
        },
        "subtitles": {
          "kk": "Мекенжайлар мен бағыттар",
          "ru": "Адреса и маршруты"
        },
        "ariaLabels": {
          "kk": "2GIS қолданбасында Ақтаудағы Bulka филиалдарын ашу",
          "ru": "Открыть филиалы Bulka в Актау в 2GIS"
        },
        "icon": "2gis",
        "target": {
          "type": "url",
          "value": "https://2gis.kz/aktau/branches/70000001035248861"
        }
      },
      {
        "id": "10000000-0000-4000-8000-000000000004",
        "type": "link",
        "enabled": true,
        "style": "city",
        "labels": {
          "kk": "Bulka Астанада",
          "ru": "Bulka в Астане"
        },
        "subtitles": {
          "kk": "Мекенжайлар мен бағыттар",
          "ru": "Адреса и маршруты"
        },
        "ariaLabels": {
          "kk": "2GIS қолданбасында Астанадағы Bulka филиалдарын ашу",
          "ru": "Открыть филиалы Bulka в Астане в 2GIS"
        },
        "icon": "2gis",
        "target": {
          "type": "url",
          "value": "https://2gis.kz/astana/branches/70000001114429416"
        }
      }
    ]
  }
  $seed$::jsonb;
begin
  insert into public.taplink_pages (
    slug,
    draft_document,
    draft_version,
    published_document,
    published_version,
    updated_by,
    published_by
  )
  values (
    'main',
    seed_document,
    1,
    seed_document,
    1,
    'migration',
    'migration'
  )
  on conflict (slug) do nothing;

  insert into public.taplink_revisions (
    page_slug,
    version,
    document,
    published_at,
    published_by
  )
  select
    page.slug,
    page.published_version,
    page.published_document,
    page.published_at,
    page.published_by
  from public.taplink_pages as page
  where page.slug = 'main'
  on conflict (page_slug, version) do nothing;
end;
$migration$;

create or replace function public.publish_taplink_page(
  p_slug text,
  p_expected_draft_version bigint,
  p_actor text
)
returns table (
  slug text,
  draft_document jsonb,
  draft_version bigint,
  published_document jsonb,
  published_version bigint,
  updated_at timestamptz,
  updated_by varchar,
  published_at timestamptz,
  published_by varchar
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_page public.taplink_pages%rowtype;
  normalized_actor varchar(160);
begin
  normalized_actor := left(coalesce(nullif(btrim(p_actor), ''), 'system'), 160);

  select page.*
  into current_page
  from public.taplink_pages as page
  where page.slug = p_slug
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TAPLINK_NOT_FOUND';
  end if;

  if current_page.draft_version <> p_expected_draft_version then
    raise exception using
      errcode = '40001',
      message = 'TAPLINK_VERSION_CONFLICT';
  end if;

  if current_page.published_version <> current_page.draft_version then
    insert into public.taplink_revisions (
      page_slug,
      version,
      document,
      published_at,
      published_by
    )
    values (
      current_page.slug,
      current_page.draft_version,
      current_page.draft_document,
      now(),
      normalized_actor
    );

    update public.taplink_pages as page
    set
      published_document = current_page.draft_document,
      published_version = current_page.draft_version,
      published_at = now(),
      published_by = normalized_actor
    where page.slug = current_page.slug;
  end if;

  return query
  select
    page.slug,
    page.draft_document,
    page.draft_version,
    page.published_document,
    page.published_version,
    page.updated_at,
    page.updated_by,
    page.published_at,
    page.published_by
  from public.taplink_pages as page
  where page.slug = current_page.slug;
end;
$function$;

alter table public.taplink_pages enable row level security;
alter table public.taplink_revisions enable row level security;

drop policy if exists service_role_all_taplink_pages on public.taplink_pages;
create policy service_role_all_taplink_pages
  on public.taplink_pages
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists service_role_all_taplink_revisions on public.taplink_revisions;
create policy service_role_all_taplink_revisions
  on public.taplink_revisions
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.taplink_pages from public, anon, authenticated;
revoke all on table public.taplink_revisions from public, anon, authenticated;
grant all on table public.taplink_pages to service_role;
grant all on table public.taplink_revisions to service_role;

revoke all on function public.publish_taplink_page(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.publish_taplink_page(text, bigint, text)
  to service_role;

commit;
