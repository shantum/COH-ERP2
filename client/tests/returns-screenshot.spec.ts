import { test } from '@playwright/test';

test('screenshot returns page', async ({ page }) => {
  await page.goto('/returns');
  await page.waitForLoadState('domcontentloaded');
  // Wait for action queue to load
  await page.waitForSelector('[class*="grid-cols-4"]', { timeout: 15000 });
  // Small extra wait for data to populate
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-output/returns-updated.png' });
});
