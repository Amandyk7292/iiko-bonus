import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('admin production invariants', () => {
  it('ships Russian document metadata and valid motion tokens', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const css = [
      'src/index.css',
      'src/styles/commerce.css',
      'src/styles/operations.css',
      'src/styles/interaction.css',
      'src/styles/release.css',
      'src/styles/contacts.css',
      'src/styles/whatsapp.css',
    ]
      .map((file) => readFileSync(resolve(root, file), 'utf8'))
      .join('\n');
    expect(html).toContain('<html lang="ru">');
    expect(css).not.toContain('var(--motion-ease-in-out)-out');
    expect(css).toContain('outline: 3px solid var(--focus-ring)');
  });

  it('uses links for internal navigation and persists workspace state in the URL', () => {
    const operations = readFileSync(resolve(root, 'src/pages/OperationsPage.tsx'), 'utf8');
    const transactions = readFileSync(resolve(root, 'src/pages/TransactionsPage.tsx'), 'utf8');
    expect(operations).toContain("import { Link } from '../lib/router'");
    expect(operations).not.toContain('navigate(');
    expect(transactions).toContain('<Link');
    for (const page of ['MarketingPage.tsx', 'MenuPage.tsx', 'InventoryPage.tsx']) {
      expect(readFileSync(resolve(root, 'src/pages', page), 'utf8'), page).toContain(
        'useSearchParams',
      );
    }
  });

  it('ships every locally referenced font and product mark', () => {
    const assets = [
      'GolosText-Regular.ttf',
      'GolosText-Medium.ttf',
      'GolosText-SemiBold.ttf',
      'GolosText-Bold.ttf',
      'GolosText-ExtraBold.ttf',
      'GolosText-Black.ttf',
      'Montserrat-Regular.ttf',
      'Montserrat-Medium.ttf',
      'Montserrat-SemiBold.ttf',
      'Montserrat-Bold.ttf',
      'Montserrat-ExtraBold.ttf',
      'Montserrat-Black.ttf',
    ];
    for (const file of assets) {
      expect(existsSync(resolve(root, 'public/assets/fonts', file)), file).toBe(true);
    }
    for (const mark of ['halal.png', 'eac.png', 'iso.png', 'under-3.png']) {
      expect(existsSync(resolve(root, 'public/assets/product_marks', mark)), mark).toBe(true);
    }
  });

  it('uses the backend analytics event names in the checkout funnel', () => {
    const analyticsPage = readFileSync(resolve(root, 'src/pages/AnalyticsPage.tsx'), 'utf8');
    const analyticsService = readFileSync(
      resolve(root, '../src/services/analytics-event.service.js'),
      'utf8',
    );
    for (const eventName of [
      'checkout_start',
      'payment_created',
      'payment_failed',
      'payment_cancelled',
    ]) {
      expect(analyticsPage, eventName).toContain(eventName);
      expect(analyticsService, eventName).toContain(eventName);
    }
    expect(analyticsPage).not.toContain("'checkout_started'");
    expect(analyticsPage).not.toContain("'payment_started'");
  });
});
