const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { chatgptCartPrepareSchema } = require('../contracts/chatgpt-cart.contract');

// A resource URI identifies immutable HTML to the ChatGPT host. Read the
// released widget once, so future UI changes automatically get a new cache key.
const defaultWidgetHtml = fs.readFileSync(
  path.resolve(__dirname, '../../public/chatgpt/widget.html'),
  'utf8',
);
const widgetUri = (html) =>
  `ui://bulka-bakery/menu-${crypto.createHash('sha256').update(html).digest('hex').slice(0, 16)}.html`;
const WIDGET_URI = widgetUri(defaultWidgetHtml);
const language = z.enum(['ru', 'kk', 'en']).default('ru');
const branchId = z.string().uuid();
const orderType = z.enum(['pickup', 'delivery', 'preorder']).default('pickup');
const publicId = z.string().min(1).max(100);
const readonly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

function createBulkaMcpServer({ catalog, cart, widgetHtml, baseUrl } = {}) {
  catalog ||= require('./chatgpt-catalog.service');
  cart ||= require('./chatgpt-cart.service');
  baseUrl ||= process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz';
  const origin = new URL(baseUrl).origin;
  const html = widgetHtml ?? defaultWidgetHtml;
  const resourceUri = widgetUri(html);
  const server = new McpServer(
    { name: 'bulka-bakery', version: '1.0.0' },
    {
      instructions:
        'Help customers choose food from Bulka Bakery in Kazakhstan. First find a branch, then fetch its menu for the requested order type. Use only returned product IDs and current prices; do not invent stock, ingredients or allergy guarantees. Fetch product options before configuring variants. Prepare a draft cart only after the customer chooses products. It does not place or pay for an order. Show the draft link so the customer can review, sign in and confirm on Bulka. Delivery fees, bonuses and fulfillment time are confirmed there.',
    },
  );
  server.registerResource(
    'bulka-menu',
    resourceUri,
    { mimeType: 'text/html;profile=mcp-app' },
    async () => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: 'text/html;profile=mcp-app',
          text: html,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: { connectDomains: [], resourceDomains: [origin], redirectDomains: [origin] },
            },
            'openai/widgetDescription':
              'Bulka Bakery: точки, меню и корзина с оформлением на Bulka.',
          },
        },
      ],
    }),
  );
  const register = (name, title, description, inputSchema, handler, view, status) =>
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema,
        outputSchema: z.object({ view: z.string() }).passthrough(),
        annotations: readonly,
        _meta: {
          securitySchemes: [{ type: 'noauth' }],
          ui: { resourceUri },
          'openai/outputTemplate': resourceUri,
          'openai/widgetAccessible': true,
          'openai/toolInvocation/invoking': status,
          'openai/toolInvocation/invoked': title,
        },
      },
      async (args) => {
        try {
          const result = { ...(await handler(args)), view };
          return {
            structuredContent: result,
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        } catch (error) {
          const publicOrderingPause =
            error.statusCode === 503 && error.code === 'ONLINE_ORDERING_DISABLED';
          const safe =
            error.expose === true &&
            ((error.statusCode >= 400 && error.statusCode < 500) || publicOrderingPause)
              ? String(error.message).slice(0, 300)
              : 'Bulka временно недоступна. Попробуйте ещё раз.';
          return { isError: true, content: [{ type: 'text', text: safe }] };
        }
      },
    );
  register(
    'find_bulka_branches',
    'Точки Bulka',
    'Find active Bulka Bakery branches in Kazakhstan by city or address. Use the returned branch ID to fetch a menu.',
    { city: z.string().max(100).optional(), query: z.string().max(150).optional() },
    (args) => catalog.findBranches(args),
    'branches',
    'Ищем точки Bulka…',
  );
  register(
    'get_bulka_menu',
    'Меню Bulka',
    'Get current public products, prices in KZT, stock and category IDs for a chosen branch and order type. Supports search and pagination; do not assume products absent from this page do not exist.',
    {
      branchId,
      orderType,
      language,
      query: z.string().max(150).optional(),
      categoryId: publicId.optional(),
      limit: z.number().int().min(1).max(40).default(24),
      offset: z.number().int().min(0).max(2000).default(0),
    },
    (args) => catalog.getMenu(args),
    'menu',
    'Загружаем меню…',
  );
  register(
    'get_bulka_product_options',
    'Варианты товара',
    'Get available configuration codes and modifier option IDs for a product from the selected branch menu. Choose actual required options before preparing a cart.',
    { branchId, orderType, language, productId: publicId },
    (args) => catalog.getProductOptions(args),
    'options',
    'Загружаем варианты…',
  );
  register(
    'prepare_bulka_cart',
    'Корзина Bulka',
    'Prepare a temporary, unreserved draft cart from customer-selected products. Rechecks current prices, stock and options. Returns an external Bulka checkout link valid for 30 minutes. Does not create or pay for an order. Item subtotal excludes delivery fees and bonuses; missing required variants must be selected on Bulka.',
    chatgptCartPrepareSchema,
    (args) => cart.prepareCart(args),
    'cart',
    'Проверяем корзину…',
  );
  return server;
}

module.exports = { createBulkaMcpServer, WIDGET_URI };
