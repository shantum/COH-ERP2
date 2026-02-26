import { test } from '@playwright/test';

/**
 * Opens the ERP app in a headed Playwright browser for manual browsing.
 * Usage: cd client && pnpm browse
 * Optional: PAGE=/returns pnpm browse  (go to a specific page)
 */
test('browse the app', async ({ page }) => {
  const startPage = process.env.PAGE || '/';
  await page.goto(startPage);
  await page.waitForLoadState('domcontentloaded');

  // Pause — opens Playwright Inspector. Use the browser freely.
  // Press the green Resume button or close the browser when done.
  await page.pause();
});
