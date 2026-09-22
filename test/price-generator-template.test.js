const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('label editor and print use identical text-to-paper proportions at every zoom', () => {
  const source = fs.readFileSync('public/pricegenerator/app.js', 'utf8');
  const start = source.indexOf('  function styleElement(');
  const end = source.indexOf('  function buildLabel(', start);
  for (const zoom of [0.5, 1, 2]) {
    const context = vm.createContext({ state: { zoom, label: { foreground: '#222222' } } });
    vm.runInContext(source.slice(start, end), context);
    const screen = { style: {} },
      paper = { style: {} };
    const field = { x: 1, y: 1, w: 52, h: 15, font: 8, visible: true, align: 'left' };
    context.styleElement(screen, field, 'composition', false);
    context.styleElement(paper, field, 'composition', true);
    const previewRatio = parseFloat(screen.style.fontSize) / parseFloat(screen.style.width);
    const physicalRatio =
      (parseFloat(paper.style.fontSize) * 25.4) / 72 / parseFloat(paper.style.width);
    assert.ok(Math.abs(previewRatio - physicalRatio) < 0.000001);
  }
});

const values = new Map();
require.cache[require.resolve('../src/config/supabase')] = {
  exports: {
    supabase: {
      from(table) {
        assert.equal(table, 'settings');
        return {
          select() {
            return {
              eq(_field, key) {
                return {
                  async maybeSingle() {
                    return {
                      data: values.has(key) ? { value: values.get(key) } : null,
                      error: null,
                    };
                  },
                };
              },
            };
          },
          async upsert(row) {
            for (const item of Array.isArray(row) ? row : [row]) values.set(item.key, item.value);
            return { error: null };
          },
        };
      },
    },
  },
};

const router = require('../src/routes/price-generator.routes');
const handler = (method, path) =>
  router.stack
    .find((layer) => layer.route?.path === path && layer.route.methods[method])
    .route.stack.at(-1).handle;
const response = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    this.data = data;
    return this;
  },
});
const field = {
  x: 1,
  y: 1,
  w: 20,
  h: 10,
  font: 8,
  weight: 600,
  lineHeight: 1.15,
  align: 'left',
  visible: true,
};
const template = {
  layout: {
    name: field,
    composition: { ...field, breakLanguages: true },
    barcode: field,
    dates: field,
    price: field,
  },
  label: { width: 70, height: 50, radius: 4, background: '#ffffff', foreground: '#222222' },
  paper: { width: 210, height: 297, gapX: 3, gapY: 3, margin: 5 },
};

test('price generator template is shared through server settings', async () => {
  values.clear();
  const save = response();
  await handler('post', '/admin/api/pricegenerator/template')({ body: template }, save);
  assert.equal(save.statusCode, 200);
  const read = response();
  await handler('get', '/api/pricegenerator/template')({}, read);
  assert.deepEqual(read.data.template, template);
});

test('price generator template rejects unsafe or malformed values', async () => {
  const route = router.stack.find(
    (layer) =>
      layer.route?.path === '/admin/api/pricegenerator/template' && layer.route.methods.post,
  ).route;
  const validate = route.stack.at(-2).handle;
  let validationError;
  validate(
    { body: { ...template, label: { ...template.label, background: 'red;script' } } },
    response(),
    (error) => {
      validationError = error;
    },
  );
  assert.equal(validationError?.statusCode, 400);
  assert.equal(validationError?.code, 'VALIDATION_ERROR');
});

test('price generator private routes enforce the scoped editor guard', () => {
  for (const path of [
    '/admin/api/pricegenerator/template',
    '/admin/api/pricegenerator/import',
    '/admin/api/pricegenerator/products',
    '/admin/api/pricegenerator/history',
  ]) {
    const route = router.stack.find((layer) => layer.route?.path === path).route;
    assert(route.stack.some((layer) => layer.handle.name === 'priceGeneratorEditor'));
    if (route.methods.post) assert(route.stack.some((layer) => layer.handle.name === 'sameOrigin'));
  }
});

test('price generator products are saved and loaded for all devices', async () => {
  values.clear();
  const products = [
    {
      id: 'custom-1',
      name: 'Новый товар',
      composition: 'Құрамы: ұн. Состав: мука.',
      price: '500',
      expiry: '3',
      barcode: '2100000000001',
    },
  ];
  const save = response();
  await handler('post', '/admin/api/pricegenerator/products')(
    {
      body: {
        products,
        action: { type: 'save', productId: 'custom-1', productName: 'Новый товар' },
      },
      admin: { username: 'owner', role: 'owner' },
    },
    save,
  );
  assert.equal(save.statusCode, 200);
  const read = response();
  await handler('get', '/api/pricegenerator/products')({}, read);
  assert.deepEqual(read.data.products, products);
  const history = response();
  await handler('get', '/admin/api/pricegenerator/history')({}, history);
  assert.equal(history.data.history[0].username, 'owner');
  assert.equal(history.data.history[0].type, 'save');
});

test('price generator keeps templates and products separate for each city', async () => {
  values.clear();
  const astanaTemplate = {
    ...template,
    label: { ...template.label, width: 80 },
  };
  const saveTemplate = response();
  await handler('post', '/admin/api/pricegenerator/template')(
    { query: { city: 'astana' }, body: astanaTemplate },
    saveTemplate,
  );
  assert.equal(saveTemplate.statusCode, 200);

  const astanaRead = response();
  await handler('get', '/api/pricegenerator/template')({ query: { city: 'astana' } }, astanaRead);
  assert.deepEqual(astanaRead.data.template, astanaTemplate);

  const aktauRead = response();
  await handler('get', '/api/pricegenerator/template')({ query: { city: 'aktau' } }, aktauRead);
  assert.equal(aktauRead.data.template, null);
});
