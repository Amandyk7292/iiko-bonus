const { supabase } = require('../config/supabase');
const { taplinkDocumentSchema } = require('../contracts/taplink.contract');

const TAPLINK_SLUG = 'main';
const TAPLINK_PAGE_SELECT =
  'slug,draft_document,draft_version,published_document,published_version,updated_at,updated_by,published_at,published_by';

const FALLBACK_TAPLINK_DOCUMENT = Object.freeze({
  schemaVersion: 1,
  defaultLocale: 'kk',
  enabledLocales: ['kk', 'ru'],
  profile: {
    logoUrl: '/taplink/assets/brand/bulka_logo.png?v=20260806-1',
    title: { kk: 'Bulka жаныңызда', ru: 'Bulka рядом' },
    description: {
      kk: 'Күн сайын балғын пісірме, сүйікті дәмдер және ыңғайлы жеткізу.',
      ru: 'Свежая выпечка, любимые вкусы и удобная доставка каждый день.',
    },
    footer: {
      kk: 'Bulka отбасылық наубайханасы',
      ru: 'Семейная пекарня Bulka',
    },
  },
  seo: {
    title: {
      kk: 'Bulka — жеткізу және мекенжайлар',
      ru: 'Bulka — доставка и адреса',
    },
    description: {
      kk: 'Bulka жеткізу қызметі және Ақтау мен Астанадағы отбасылық наубайхананың мекенжайлары.',
      ru: 'Доставка Bulka и адреса семейной пекарни в Актау и Астане.',
    },
    ogImageUrl: '/taplink/assets/brand/bulka_logo.png?v=20260806-1',
  },
  theme: {
    preset: 'bulka',
    backgroundImageUrl: '/taplink/assets/mobile-background.png?v=20260806-1',
    buttonStyle: 'soft',
    radius: 22,
  },
  blocks: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      type: 'link',
      enabled: true,
      style: 'primary',
      labels: { kk: 'Жеткізуге тапсырыс беру', ru: 'Заказать доставку' },
      subtitles: { kk: '+7 701 277 22 33', ru: '+7 701 277 22 33' },
      ariaLabels: {
        kk: 'WhatsApp арқылы Bulka жеткізуіне тапсырыс беру: +7 701 277 22 33',
        ru: 'Заказать доставку Bulka в WhatsApp: +7 701 277 22 33',
      },
      icon: 'phone',
      target: { type: 'whatsapp', value: '77012772233' },
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      type: 'section',
      enabled: true,
      labels: { kk: '2GIS-тегі филиалдарымыз', ru: 'Наши филиалы в 2GIS' },
    },
    {
      id: '10000000-0000-4000-8000-000000000003',
      type: 'link',
      enabled: true,
      style: 'city',
      labels: { kk: 'Bulka Ақтауда', ru: 'Bulka в Актау' },
      subtitles: { kk: 'Мекенжайлар мен бағыттар', ru: 'Адреса и маршруты' },
      ariaLabels: {
        kk: '2GIS қолданбасында Ақтаудағы Bulka филиалдарын ашу',
        ru: 'Открыть филиалы Bulka в Актау в 2GIS',
      },
      icon: '2gis',
      target: {
        type: 'url',
        value: 'https://2gis.kz/aktau/branches/70000001035248861',
      },
    },
    {
      id: '10000000-0000-4000-8000-000000000004',
      type: 'link',
      enabled: true,
      style: 'city',
      labels: { kk: 'Bulka Астанада', ru: 'Bulka в Астане' },
      subtitles: { kk: 'Мекенжайлар мен бағыттар', ru: 'Адреса и маршруты' },
      ariaLabels: {
        kk: '2GIS қолданбасында Астанадағы Bulka филиалдарын ашу',
        ru: 'Открыть филиалы Bulka в Астане в 2GIS',
      },
      icon: '2gis',
      target: {
        type: 'url',
        value: 'https://2gis.kz/astana/branches/70000001114429416',
      },
    },
  ],
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const taplinkError = (message, statusCode, code) =>
  Object.assign(new Error(message), { statusCode, code });

const isMissingTaplinkSchema = (error) =>
  ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(String(error?.code || '')) ||
  (/taplink_pages|publish_taplink_page/i.test(String(error?.message || '')) &&
    /does not exist|schema cache/i.test(String(error?.message || '')));

const schemaUnavailable = (error) =>
  taplinkError(
    `Taplink schema is not installed${error?.message ? `: ${error.message}` : ''}`,
    503,
    'TAPLINK_SCHEMA_MISSING',
  );

const versionConflict = () =>
  taplinkError(
    'Черновик Taplink уже изменён в другой вкладке. Обновите данные и повторите действие.',
    409,
    'TAPLINK_VERSION_CONFLICT',
  );

const normalizeActor = (value) =>
  String(value || 'system')
    .trim()
    .slice(0, 160) || 'system';

const normalizeExpectedRevision = (value) => {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw taplinkError('Некорректная версия Taplink', 400, 'TAPLINK_REVISION_INVALID');
  }
  return revision;
};

const parseDocument = (value) => {
  const parsed = taplinkDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw taplinkError(
      'Сохранённая конфигурация Taplink повреждена',
      500,
      'TAPLINK_CONFIG_INVALID',
    );
  }
  return parsed.data;
};

const hrefForTarget = (target) => {
  if (target.type === 'whatsapp') return `https://wa.me/${target.value}`;
  if (target.type === 'phone') return `tel:+${target.value.replace(/\D/g, '')}`;
  if (target.type === 'email') return `mailto:${target.value}`;
  return target.value;
};

const publicDocument = (document) => {
  const parsed = parseDocument(document);
  return {
    ...parsed,
    blocks: parsed.blocks
      .filter((block) => block.enabled)
      .map((block) =>
        block.type === 'link'
          ? {
              ...block,
              href: hrefForTarget(block.target),
            }
          : block,
      ),
  };
};

const adminPageFromRow = (row) => ({
  slug: row.slug,
  draft: parseDocument(row.draft_document),
  published: parseDocument(row.published_document),
  draftRevision: Number(row.draft_version),
  publishedRevision: Number(row.published_version),
  updatedAt: row.updated_at || null,
  updatedBy: row.updated_by || null,
  publishedAt: row.published_at || null,
  publishedBy: row.published_by || null,
});

async function readTaplinkRow({ db = supabase, signal } = {}) {
  let query = db.from('taplink_pages').select(TAPLINK_PAGE_SELECT).eq('slug', TAPLINK_SLUG);
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) {
    if (isMissingTaplinkSchema(error)) throw schemaUnavailable(error);
    throw error;
  }
  return data || null;
}

async function getAdminTaplink(options = {}) {
  const row = await readTaplinkRow(options);
  if (!row) {
    throw taplinkError('Страница Taplink не настроена', 503, 'TAPLINK_NOT_CONFIGURED');
  }
  return adminPageFromRow(row);
}

async function getPublicTaplink({ db = supabase, signal } = {}) {
  let row;
  try {
    row = await readTaplinkRow({ db, signal });
  } catch (error) {
    if (error.code !== 'TAPLINK_SCHEMA_MISSING') throw error;
  }
  if (!row?.published_document) {
    return {
      slug: TAPLINK_SLUG,
      revision: 0,
      config: publicDocument(clone(FALLBACK_TAPLINK_DOCUMENT)),
      publishedAt: null,
      source: 'fallback',
    };
  }
  return {
    slug: row.slug,
    revision: Number(row.published_version),
    config: publicDocument(row.published_document),
    publishedAt: row.published_at || null,
    source: 'database',
  };
}

async function updateTaplinkDraft(config, expectedRevision, actor, { db = supabase } = {}) {
  const document = taplinkDocumentSchema.parse(config);
  const revision = normalizeExpectedRevision(expectedRevision);
  const nextRevision = revision + 1;
  const { data, error } = await db
    .from('taplink_pages')
    .update({
      draft_document: document,
      draft_version: nextRevision,
      updated_at: new Date().toISOString(),
      updated_by: normalizeActor(actor),
    })
    .eq('slug', TAPLINK_SLUG)
    .eq('draft_version', revision)
    .select(TAPLINK_PAGE_SELECT)
    .maybeSingle();
  if (error) {
    if (isMissingTaplinkSchema(error)) throw schemaUnavailable(error);
    throw error;
  }
  if (!data) throw versionConflict();
  return adminPageFromRow(data);
}

async function publishTaplink(expectedRevision, actor, { db = supabase } = {}) {
  const revision = normalizeExpectedRevision(expectedRevision);
  const { data, error } = await db.rpc('publish_taplink_page', {
    p_actor: normalizeActor(actor),
    p_expected_draft_version: revision,
    p_slug: TAPLINK_SLUG,
  });
  if (error) {
    if (
      String(error.code || '') === '40001' ||
      /TAPLINK_VERSION_CONFLICT/i.test(String(error.message || ''))
    ) {
      throw versionConflict();
    }
    if (isMissingTaplinkSchema(error)) throw schemaUnavailable(error);
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw taplinkError('Не удалось опубликовать Taplink', 500, 'TAPLINK_PUBLISH_FAILED');
  return adminPageFromRow(row);
}

module.exports = {
  FALLBACK_TAPLINK_DOCUMENT,
  TAPLINK_PAGE_SELECT,
  TAPLINK_SLUG,
  getAdminTaplink,
  getPublicTaplink,
  hrefForTarget,
  isMissingTaplinkSchema,
  normalizeExpectedRevision,
  publicDocument,
  publishTaplink,
  readTaplinkRow,
  updateTaplinkDraft,
};
