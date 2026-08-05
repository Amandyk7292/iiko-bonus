const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const budgets = new Map([
  ['admin-ui/src/index.css', 2320],
  ['admin-ui/src/pages/MenuPage.tsx', 80],
  ['admin-ui/src/pages/menu/use-menu-page-controller.tsx', 900],
  ['admin-ui/src/pages/menu/MenuPageView.tsx', 620],
  ['admin-ui/src/pages/menu/MenuEditorModals.tsx', 1000],
  ['admin-ui/src/pages/WhatsAppPage.tsx', 80],
  ['admin-ui/src/pages/whatsapp/use-whatsapp-page-controller.tsx', 1000],
  ['admin-ui/src/pages/whatsapp/use-whatsapp-conversation-query.ts', 100],
  ['admin-ui/src/pages/whatsapp/WhatsAppPageView.tsx', 700],
  ['admin-ui/src/pages/whatsapp/WhatsAppSettingsPanel.tsx', 500],
  ['admin-ui/src/pages/whatsapp/WhatsAppKnowledgeModal.tsx', 180],
  ['admin-ui/src/lib/i18n.tsx', 2705],
  ['admin-ui/src/lib/api.ts', 1245],
  ['BulkaAndroid/lib/core/localization.dart', 380],
  ['BulkaAndroid/lib/screens/catalog_screen.dart', 300],
  ['BulkaAndroid/lib/screens/catalog_screen_helpers.dart', 250],
  ['BulkaAndroid/lib/screens/catalog_data_controller.dart', 650],
  ['BulkaAndroid/lib/screens/catalog_interaction_controller.dart', 450],
  ['BulkaAndroid/lib/screens/catalog_screen_view.dart', 550],
  ['BulkaAndroid/lib/screens/catalog_screen_layout.dart', 600],
  ['BulkaAndroid/lib/screens/catalog_product_card.dart', 300],
  ['BulkaAndroid/lib/screens/orders_screen.dart', 520],
  ['BulkaAndroid/lib/screens/orders_cart_widgets.dart', 350],
  ['BulkaAndroid/lib/screens/orders_checkout_screen.dart', 800],
  ['BulkaAndroid/lib/screens/orders_checkout_layout.dart', 350],
  ['BulkaAndroid/lib/screens/orders_checkout_widgets.dart', 700],
  ['BulkaAndroid/lib/screens/balance_history_screen.dart', 350],
  ['BulkaAndroid/lib/screens/login_screen.dart', 1505],
  ['BulkaAndroid/lib/widgets/stories.dart', 1620],
  ['BulkaAndroid/lib/models/models.dart', 1640],
  ['src/routes/admin.routes.js', 1670],
  ['src/services/legal-page.service.js', 1727],
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
