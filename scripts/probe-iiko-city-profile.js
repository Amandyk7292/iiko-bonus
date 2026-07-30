const { IikoAPI } = require('../src/services/iiko.service');

const apiLogin = String(process.env.BULKA_IIKO_CITY_API_LOGIN || '').trim();
if (apiLogin.length < 16 || apiLogin.length > 256 || /\s|\p{Cc}/u.test(apiLogin)) {
  throw new Error('iiko API login has an unexpected format');
}

const client = new IikoAPI({
  profileKey: 'astana',
  apiLogin,
  // Probe a replacement login without reusing IDs from a previously connected
  // Astana account. Successful IDs are written back only after the probe.
  appId: '',
  clientSecret: '',
  organizationId: '',
  externalMenuId: '',
  externalMenuName: '',
  priceCategoryId: '',
  priceCategoryName: '',
});

async function main() {
  const menu = await client.getMenu({
    strict: true,
    forceRefresh: true,
    requireExternal: true,
  });
  const productsCount = Array.isArray(menu.products) ? menu.products.length : 0;
  const categoriesCount = Array.isArray(menu.groups) ? menu.groups.length : 0;
  if (productsCount === 0 || categoriesCount === 0) {
    throw new Error('iiko External Menu is empty');
  }

  process.stdout.write(
    `${JSON.stringify({
      status: 'ok',
      organizationId: menu.organizationId || null,
      externalMenuId: menu.externalMenuId || null,
      priceCategoryId: menu.priceCategoryId || null,
      priceCategoryName: menu.priceCategoryName || null,
      productsCount,
      categoriesCount,
    })}\n`,
  );
}

main().catch((error) => {
  console.error(`IIKO_ASTANA_PROBE_FAILED: ${error.message}`);
  process.exitCode = 1;
});
