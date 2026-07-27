const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const budgets = new Map([
  ['admin-ui/src/index.css', 2320],
  ['admin-ui/src/pages/MenuPage.tsx', 2200],
  ['admin-ui/src/pages/WhatsAppPage.tsx', 2060],
  ['admin-ui/src/lib/i18n.tsx', 2705],
  ['admin-ui/src/lib/api.ts', 1245],
  ['BulkaAndroid/lib/core/localization.dart', 380],
  ['BulkaAndroid/lib/screens/catalog_screen.dart', 2750],
  ['BulkaAndroid/lib/screens/orders_screen.dart', 2830],
  ['BulkaAndroid/lib/screens/login_screen.dart', 1505],
  ['BulkaAndroid/lib/widgets/stories.dart', 1620],
  ['BulkaAndroid/lib/models/models.dart', 1640],
  ['src/routes/admin.routes.js', 1670],
  ['src/services/legal-page.service.js', 1200],
  ['src/services/whatsapp-assistant-console.service.js', 1205],
]);

const failures = [];
for (const [relativePath, maximumLines] of budgets) {
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const lines = content.split(/\r?\n/).length;
  if (lines > maximumLines) failures.push(`${relativePath}: ${lines} > ${maximumLines}`);
}

if (failures.length) {
  console.error(`Source-size budgets exceeded:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Source-size budgets passed (${budgets.size} ratcheted hotspots).`);
}
