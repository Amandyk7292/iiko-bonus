const test = require('node:test');
const assert = require('node:assert/strict');

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
            values.set(row.key, row.value);
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
  await handler('get', '/admin/api/pricegenerator/template')({}, read);
  assert.deepEqual(read.data.template, template);
});

test('price generator template rejects unsafe or malformed values', async () => {
  const result = response();
  await handler('post', '/admin/api/pricegenerator/template')(
    { body: { ...template, label: { ...template.label, background: 'red;script' } } },
    result,
  );
  assert.equal(result.statusCode, 400);
});
