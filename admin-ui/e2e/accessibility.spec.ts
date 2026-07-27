import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('login has no serious accessibility violations and supports keyboard navigation', async ({
  page,
}) => {
  await page.route('**/admin/api/session', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false }),
    }),
  );
  await page.goto('/admin/');
  await page.waitForLoadState('networkidle');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || '')),
  ).toEqual([]);

  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  const focusStyle = await focused.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
      boxShadow: style.boxShadow,
    };
  });
  expect(focusStyle.outlineWidth > 0 || focusStyle.boxShadow !== 'none').toBe(true);
});
