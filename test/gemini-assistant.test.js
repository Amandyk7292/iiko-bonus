const assert = require('node:assert/strict');
const test = require('node:test');

const {
  astanaLocations,
  buildKnowledgeText,
  normalizeMenu,
  selectProducts,
} = require('../src/services/bulka-assistant-knowledge.service');
const {
  buildSystemInstruction,
  createGeminiAssistant,
  customerErrorMessage,
  detectCustomerLanguage,
  redactSensitiveText,
  sanitizeCustomerReply,
} = require('../src/services/gemini-assistant.service');
const { isDirectWhatsAppChat } = require('../src/utils/whatsapp.util');

const successfulResponse = (text, thoughtSignature) => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [
      {
        content: {
          parts: [{ text, ...(thoughtSignature ? { thoughtSignature } : {}) }],
        },
        finishReason: 'STOP',
      },
    ],
  }),
});

const successfulOpenAiResponse = (text) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { role: 'assistant', content: text } }] }),
});

test('Gemini assistant keeps the API key in a header and carries short per-chat history', async () => {
  const requests = [];
  const knowledgeQueries = [];
  const knowledgeContexts = [];
  const env = {
    GEMINI_ASSISTANT_ENABLED: 'true',
    GEMINI_API_KEY: 'test-api-key-kept-out-of-the-url',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    GEMINI_CHAT_RPM: '10',
    GEMINI_GLOBAL_RPM: '20',
  };
  const assistant = createGeminiAssistant({
    env,
    knowledgeProvider: async (message, context) => {
      knowledgeQueries.push(message);
      knowledgeContexts.push(context);
      return '<bulka_data>Астана, Улы Дала 67</bulka_data>';
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return successfulResponse(
        requests.length === 1 ? 'Здравствуйте!' : 'Мы на Улы Дала, 67.',
        requests.length === 1 ? 'opaque-thought-signature' : undefined,
      );
    },
  });

  assert.equal(
    await assistant.reply({ chatId: '77000000001@s.whatsapp.net', message: 'Привет' }),
    'Здравствуйте!',
  );
  assert.equal(
    await assistant.reply({ chatId: '77000000001@s.whatsapp.net', message: 'А адрес?' }),
    'Мы на Улы Дала, 67.',
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.includes(env.GEMINI_API_KEY), false);
  assert.equal(requests[0].options.headers['x-goog-api-key'], env.GEMINI_API_KEY);
  assert.match(requests[0].body.system_instruction.parts[0].text, /только город Астана/);
  assert.match(requests[0].body.system_instruction.parts[0].text, /Улы Дала 67/);
  assert.deepEqual(
    requests[1].body.contents.map((item) => item.role),
    ['user', 'model', 'user'],
  );
  assert.equal(requests[1].body.contents[1].parts[0].thoughtSignature, 'opaque-thought-signature');
  assert.deepEqual(knowledgeQueries, ['Привет', 'А адрес?']);
  assert.deepEqual(
    knowledgeContexts.map((context) => context.chatId),
    ['77000000001@s.whatsapp.net', '77000000001@s.whatsapp.net'],
  );
});

test('AI assistant supports Qwen and DeepSeek through fixed OpenAI-compatible endpoints', async () => {
  for (const provider of [
    {
      id: 'qwen',
      model: 'qwen-flash',
      endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    },
    {
      id: 'deepseek',
      model: 'deepseek-v4-flash',
      endpoint: 'https://api.deepseek.com/chat/completions',
    },
  ]) {
    const requests = [];
    const assistant = createGeminiAssistant({
      env: { GEMINI_CHAT_RPM: '10', GEMINI_GLOBAL_RPM: '20' },
      configurationProvider: async () => ({
        enabled: true,
        provider: provider.id,
        model: provider.model,
        apiKey: `sk-${provider.id}-secret`,
      }),
      knowledgeProvider: async () => '<bulka_data>Только Астана</bulka_data>',
      fetchImpl: async (url, options) => {
        requests.push({ url, options, body: JSON.parse(options.body) });
        return successfulOpenAiResponse('Короткий ответ');
      },
    });

    assert.equal(
      await assistant.reply({ chatId: `${provider.id}-chat`, message: 'Где находится Bulka?' }),
      'Короткий ответ',
    );
    assert.equal(requests[0].url, provider.endpoint);
    assert.equal(requests[0].url.includes(`sk-${provider.id}`), false);
    assert.equal(requests[0].options.headers.Authorization, `Bearer sk-${provider.id}-secret`);
    assert.equal(requests[0].body.model, provider.model);
    assert.equal(requests[0].body.messages[0].role, 'system');
    assert.match(requests[0].body.messages[0].content, /только город Астана/i);
    assert.equal(requests[0].body.messages.at(-1).content, 'Где находится Bulka?');
  }
});

test('Gemini assistant redacts common customer secrets before provider calls', async () => {
  const sanitized = redactSensitiveText(
    'Мой телефон +7 (700) 123-45-67, email guest@example.com, код: 1234, карта 4111 1111 1111 1111. Цена 680 тенге.',
  );
  assert.doesNotMatch(sanitized, /700\)? 123/);
  assert.doesNotMatch(sanitized, /guest@example\.com/);
  assert.doesNotMatch(sanitized, /1234/);
  assert.doesNotMatch(sanitized, /4111/);
  assert.match(sanitized, /Цена 680 тенге/);
});

test('mixed Kazakh questions keep Kazakh even when the product name is Russian', () => {
  const question = 'Сіздерде датский с маком неше теңге?';
  assert.equal(detectCustomerLanguage(question), 'kk');
  assert.equal(detectCustomerLanguage('Сколько стоит датский с маком?'), 'ru');
  assert.equal(detectCustomerLanguage('How much is the Danish pastry?'), 'en');
  const instruction = buildSystemInstruction('<bulka_data />', 'kk');
  assert.match(instruction, /Язык текущего ответа: казахский/i);
  assert.match(instruction, /не по языку названия товара/i);
});

test('customer reply guard removes unreleased app and website recommendations', () => {
  const sanitized = sanitizeCustomerReply(
    'Датский с маком стоит 4 800 ₸. Уточните наличие в приложении или на нашем сайте.',
    'ru',
  );
  assert.match(sanitized, /4 800 ₸/);
  assert.doesNotMatch(sanitized, /приложени|сайт|онлайн-каталог/i);
});

test('customer reply guard removes internal branch and landmark labels', () => {
  const sanitized = sanitizeCustomerReply(
    '• *Времена года*: проспект Кабанбай батыра, 46а.\n• *Будапешт*: проспект Кабанбай батыра, 59/3.',
    'ru',
  );
  assert.match(sanitized, /Кабанбай батыра, 46а/i);
  assert.match(sanitized, /Кабанбай батыра, 59\/3/i);
  assert.doesNotMatch(sanitized, /Времена года|Будапешт/i);
});

test('Gemini assistant can disable local conversation history', async () => {
  const requests = [];
  const assistant = createGeminiAssistant({
    env: {
      GEMINI_ASSISTANT_ENABLED: 'true',
      GEMINI_API_KEY: 'test-key',
      GEMINI_HISTORY_TURNS: '0',
      GEMINI_CHAT_RPM: '10',
      GEMINI_GLOBAL_RPM: '20',
    },
    knowledgeProvider: async () => '<bulka_data />',
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return successfulResponse('Ответ');
    },
  });

  await assistant.reply({ chatId: 'chat-without-history', message: 'Первый вопрос' });
  await assistant.reply({ chatId: 'chat-without-history', message: 'Второй вопрос' });

  assert.deepEqual(
    requests[1].contents.map((item) => item.role),
    ['user'],
  );
});

test('Gemini assistant enforces a free-tier chat limit and returns a safe message', async () => {
  const assistant = createGeminiAssistant({
    env: {
      GEMINI_ASSISTANT_ENABLED: 'true',
      GEMINI_API_KEY: 'test-key',
      GEMINI_CHAT_RPM: '1',
      GEMINI_GLOBAL_RPM: '10',
    },
    knowledgeProvider: async () => '<bulka_data />',
    fetchImpl: async () => successfulResponse('Ответ'),
  });
  await assistant.reply({ chatId: 'chat-a', message: 'Первый вопрос' });
  await assert.rejects(
    () => assistant.reply({ chatId: 'chat-a', message: 'Второй вопрос' }),
    (error) => error.code === 'GEMINI_RATE_LIMITED',
  );
  assert.match(customerErrorMessage({ code: 'GEMINI_RATE_LIMITED' }), /подождите минуту/);
});

test('Astana knowledge fallback contains exactly the five current Bulka branches', () => {
  const locations = astanaLocations([
    { name: 'Другой город', city: 'Алматы', address: 'Абая 1', hours: {} },
  ]);
  assert.equal(locations.length, 5);
  assert.ok(locations.every((location) => location.city === 'Астана'));
  const text = buildKnowledgeText(
    {
      loadedAt: '2026-07-22T00:00:00.000Z',
      locations,
      categories: [],
      products: [],
      contacts: [],
      tiers: [],
      sources: { locations: false, menu: false, contacts: false, loyalty: false },
    },
    'Где вы находитесь?',
    {},
  );
  for (const address of [
    'Кабанбай батыра, 46а',
    'Кабанбай батыра, 59/3',
    'Улы Дала, 67',
    'Улы Дала, 41/2',
    'Розы Баглановой, 4',
  ]) {
    assert.match(text, new RegExp(address.replace('/', '\\/'), 'i'));
  }
  for (const label of ['Времена года', 'Будапешт', 'Арнау', 'Панорама', 'Sezim Qala']) {
    assert.doesNotMatch(text, new RegExp(label, 'i'));
  }
});

test('system instruction forbids stop and landmark labels in branch answers', () => {
  const instruction = buildSystemInstruction('<bulka_data />');
  assert.match(instruction, /только официальный уличный адрес/i);
  assert.match(instruction, /никогда не называй.*остановки.*жилые комплексы/i);
});

test('system instruction gives the confirmed Astana price list priority over iiko prices', () => {
  const instruction = buildSystemInstruction(
    '<authoritative_astana_prices>Круассан с сыром — 450 ₸</authoritative_astana_prices>',
  );
  assert.match(instruction, /прайс Астаны имеет приоритет над ценой из меню iiko/i);
  assert.match(instruction, /Круассан с сыром — 450 ₸/i);
  assert.match(instruction, /не придумывай единицу продажи/i);
});

test('menu knowledge retrieves matching products and excludes hidden ones', () => {
  const menu = normalizeMenu(
    {
      groups: [{ id: 'bread', name: 'Хлеб' }],
      products: [
        {
          id: 'baguette',
          name: 'Картофельный багет',
          parentGroup: 'bread',
          type: 'Good',
          sizePrices: [{ price: { currentPrice: 680 } }],
        },
        {
          id: 'hidden',
          name: 'Служебный хлеб',
          parentGroup: 'bread',
          type: 'Good',
          sizePrices: [{ price: { currentPrice: 1 } }],
        },
      ],
    },
    [{ iiko_product_id: 'hidden', is_hidden: true }],
    [],
    [],
  );
  assert.equal(menu.products.length, 1);
  assert.equal(selectProducts(menu, 'Сколько стоит картофельный багет?')[0].price, 680);
});

test('WhatsApp AI routing accepts personal JIDs and rejects groups and broadcasts', () => {
  assert.equal(isDirectWhatsAppChat('77000000000@s.whatsapp.net'), true);
  assert.equal(isDirectWhatsAppChat('123456789@lid'), true);
  assert.equal(isDirectWhatsAppChat('120363000000000000@g.us'), false);
  assert.equal(isDirectWhatsAppChat('status@broadcast'), false);
});
