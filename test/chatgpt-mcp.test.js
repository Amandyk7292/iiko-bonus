const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createBulkaMcpServer, WIDGET_URI } = require('../src/services/chatgpt-mcp.service');
const { createMcpRouter, mcpCors } = require('../src/routes/chatgpt-mcp.routes');
const { AppError, publicError } = require('../src/utils/app-error.util');

const id = '11111111-1111-4111-8111-111111111111';
const catalog = {
  findBranches: async () => ({
    branches: [{ id, name: 'Bulka', city: 'Актау' }],
    cities: ['Актау'],
  }),
  getMenu: async (args) => ({ branch: { id }, ...args, products: [{ id: 'bun', price: 300 }] }),
  getProductOptions: async () => ({
    productId: 'bun',
    options: { configuration: null, modifierGroups: [] },
  }),
};
const cart = {
  prepareCart: async (args) => ({
    ...args,
    itemSubtotal: 600,
    checkoutUrl: 'https://bulka.com.kz/?chatgptCart=example',
  }),
};
const createServer = () =>
  createBulkaMcpServer({ catalog, cart, widgetHtml: '<main>Bulka</main>' });

test('MCP advertises only public catalog and unreserved draft tools, with constrained UI resources', async (t) => {
  const server = createServer(),
    client = new Client({ name: 'test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((x) => x.name),
    ['find_bulka_branches', 'get_bulka_menu', 'get_bulka_product_options', 'prepare_bulka_cart'],
  );
  assert.ok(tools.every((x) => x.annotations.readOnlyHint && !x.annotations.destructiveHint));
  assert.ok(tools.every((x) => x._meta.securitySchemes[0].type === 'noauth'));
  const { resources } = await client.listResources();
  assert.equal(resources.length, 1);
  const resource = await client.readResource({ uri: resources[0].uri });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(resource.contents[0]._meta.ui.csp.resourceDomains, ['https://bulka.com.kz']);
  assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, []);
  const branches = await client.callTool({
    name: 'find_bulka_branches',
    arguments: { city: 'Актау' },
  });
  assert.equal(branches.structuredContent.view, 'branches');
  const menu = await client.callTool({ name: 'get_bulka_menu', arguments: { branchId: id } });
  assert.equal(menu.structuredContent.orderType, 'pickup');
  const invalid = await client.callTool({
    name: 'prepare_bulka_cart',
    arguments: { branchId: id, items: [{ id: 'bun', quantity: 2, price: 1 }] },
  });
  assert.equal(invalid.isError, true);
  const preview = await client.callTool({
    name: 'prepare_bulka_cart',
    arguments: { branchId: id, items: [{ id: 'bun', quantity: 2 }] },
  });
  assert.equal(preview.structuredContent.itemSubtotal, 600);
});

test('MCP versions widget resources by actual HTML and uses that identity in every tool and resource', async (t) => {
  async function inspect(widgetHtml) {
    const server = createBulkaMcpServer({ catalog, cart, widgetHtml });
    const client = new Client({ name: 'widget-cache-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    t.after(async () => {
      await client.close();
      await server.close();
    });
    const { resources } = await client.listResources();
    assert.equal(resources.length, 1);
    const uri = resources[0].uri;
    assert.match(uri, /^ui:\/\/bulka-bakery\/menu-[a-f0-9]{16}\.html$/);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 4);
    for (const tool of tools) {
      assert.equal(tool._meta.ui.resourceUri, uri);
      assert.equal(tool._meta['openai/outputTemplate'], uri);
    }
    const resource = await client.readResource({ uri });
    assert.equal(resource.contents[0].uri, uri);
    if (widgetHtml !== undefined) assert.equal(resource.contents[0].text, widgetHtml);
    return uri;
  }
  const original = await inspect('<main>Bulka · Добавить</main>');
  assert.equal(await inspect('<main>Bulka · Добавить</main>'), original);
  assert.notEqual(await inspect('<main>Bulka · Выбрать варианты</main>'), original);
  assert.equal(await inspect(undefined), WIDGET_URI);
});

test('Streamable HTTP initializes and serves tools without sessions; rejects foreign origins and oversized payloads', async (t) => {
  const app = express();
  app.use(mcpCors);
  app.use(express.json());
  app.use(createMcpRouter({ createServer }));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  const url = `http://127.0.0.1:${listener.address().port}/mcp`;
  const rpc = (body, origin) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(origin && { Origin: origin }),
      },
      body: JSON.stringify(body),
    });
  const initial = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    },
  });
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).result.serverInfo.name, 'bulka-bakery');
  assert.equal(initial.headers.get('mcp-session-id'), null);
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'https://chatgpt.com');
  assert.equal(list.headers.get('access-control-allow-origin'), 'https://chatgpt.com');
  assert.equal((await list.json()).result.tools.length, 4);
  const foreign = await rpc(
    { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    'https://attacker.example',
  );
  assert.equal(foreign.status, 403);
  const oversized = await rpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/list',
    params: { x: 'x'.repeat(33000) },
  });
  assert.equal(oversized.status, 413);
  const get = await fetch(url);
  assert.equal(get.status, 405);
});

test('MCP tool errors hide upstream database details', async (t) => {
  const server = createBulkaMcpServer({
    catalog: {
      ...catalog,
      findBranches: async () => {
        throw Error('database secret internal relation');
      },
    },
    cart,
  });
  const client = new Client({ name: 'test', version: '1' }),
    [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const result = await client.callTool({ name: 'find_bulka_branches', arguments: {} });
  assert.equal(result.isError, true);
  assert.doesNotMatch(result.content[0].text, /secret|database|relation/);
});

test('MCP explains an intentional ordering pause while keeping every other server failure private', async (t) => {
  let failure = publicError(503, 'ONLINE_ORDERING_DISABLED', 'Онлайн-заказы временно отключены');
  const server = createBulkaMcpServer({
    catalog,
    cart: {
      prepareCart: async () => {
        throw failure;
      },
    },
  });
  const client = new Client({ name: 'test', version: '1' }),
    [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const request = {
    name: 'prepare_bulka_cart',
    arguments: { branchId: id, items: [{ id: 'bun', quantity: 1 }] },
  };
  const paused = await client.callTool(request);
  assert.equal(paused.isError, true);
  assert.equal(paused.content[0].text, 'Онлайн-заказы временно отключены');
  assert.equal(paused.structuredContent, undefined);
  for (const hidden of [
    publicError(500, 'DATABASE_ERROR', 'database secret internal relation'),
    publicError(503, 'UPSTREAM_UNAVAILABLE', 'upstream secret database connection'),
    new AppError('secret disabled diagnosis', {
      statusCode: 503,
      code: 'ONLINE_ORDERING_DISABLED',
      expose: false,
    }),
    publicError(500, 'ONLINE_ORDERING_DISABLED', 'secret unexpected server failure'),
  ]) {
    failure = hidden;
    const result = await client.callTool(request);
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'Bulka временно недоступна. Попробуйте ещё раз.');
    assert.doesNotMatch(result.content[0].text, /secret|database|upstream|diagnosis/);
  }
});
