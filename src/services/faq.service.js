const { supabase } = require('../config/supabase');
const { faqBodySchema, faqParamsSchema, faqQuerySchema } = require('../contracts/faq.contract');
const { AppError, notFound } = require('../utils/app-error.util');

const FAQ_FIELDS = 'id,question_ru,answer_ru,question_kk,answer_kk,sort_order,is_active';

function validate(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError('Некорректные параметры FAQ', {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      expose: true,
      fields: result.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

const validateFaqPayload = (input) => validate(faqBodySchema, input);
const toApiFaq = (row) => ({
  id: row.id,
  questionRu: row.question_ru,
  answerRu: row.answer_ru,
  questionKk: row.question_kk || '',
  answerKk: row.answer_kk || '',
  sortOrder: row.sort_order,
  isActive: row.is_active,
});

function toPublicFaq(row, language) {
  // A translated question and answer are a pair; never mix languages within it.
  const useKk = language === 'kk' && row.question_kk?.trim() && row.answer_kk?.trim();
  return {
    id: row.id,
    question: useKk ? row.question_kk : row.question_ru,
    answer: useKk ? row.answer_kk : row.answer_ru,
    sortOrder: row.sort_order,
  };
}

const toDatabaseFaq = (item) => ({
  question_ru: item.questionRu,
  answer_ru: item.answerRu,
  question_kk: item.questionKk,
  answer_kk: item.answerKk,
  sort_order: item.sortOrder,
  is_active: item.isActive,
});

function requireDatabaseResult({ data, error }, { requireItem = false } = {}) {
  if (error) {
    throw new AppError('FAQ временно недоступен', {
      statusCode: 503,
      code: 'FAQ_UNAVAILABLE',
      cause: error,
    });
  }
  if (requireItem && !data) throw notFound('FAQ_NOT_FOUND', 'Вопрос не найден');
  return data;
}

class FaqService {
  constructor({ db = supabase } = {}) {
    this.db = db;
  }

  async rows({ activeOnly = false } = {}) {
    let query = this.db.from('loyalty_faq').select(FAQ_FIELDS);
    if (activeOnly) query = query.eq('is_active', true);
    const data = requireDatabaseResult(
      await query.order('sort_order', { ascending: true }).order('id', { ascending: true }),
    );
    return data || [];
  }

  async listAdmin() {
    return (await this.rows()).map(toApiFaq);
  }

  async listPublic(language = 'ru') {
    const { lang } = validate(faqQuerySchema, { lang: language });
    return (await this.rows({ activeOnly: true }))
      .filter((row) => row.is_active === true)
      .map((row) => toPublicFaq(row, lang));
  }

  async create(input) {
    const item = validateFaqPayload(input);
    const data = requireDatabaseResult(
      await this.db.from('loyalty_faq').insert(toDatabaseFaq(item)).select(FAQ_FIELDS).single(),
      { requireItem: true },
    );
    return toApiFaq(data);
  }

  async update(id, input) {
    validate(faqParamsSchema, { id });
    const item = validateFaqPayload(input);
    return this.save(id, toDatabaseFaq(item));
  }

  async hide(id) {
    validate(faqParamsSchema, { id });
    return this.save(id, { is_active: false });
  }

  async save(id, changes) {
    const data = requireDatabaseResult(
      await this.db
        .from('loyalty_faq')
        .update(changes)
        .eq('id', id)
        .select(FAQ_FIELDS)
        .maybeSingle(),
      { requireItem: true },
    );
    return toApiFaq(data);
  }
}

module.exports = { FaqService, faq: new FaqService(), toApiFaq, toPublicFaq, validateFaqPayload };
