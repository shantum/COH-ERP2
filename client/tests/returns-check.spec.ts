import { test, expect } from '@playwright/test';

test('returns page loads and shows data', async ({ page }) => {
  await page.goto('/returns');
  await page.waitForLoadState('networkidle');

  // Take a screenshot for review
  await page.screenshot({ path: 'test-output/returns-page.png', fullPage: true });

  // Check page loaded
  await expect(page).toHaveURL(/returns/);

  // Log what we see
  const heading = await page.locator('h1, h2').first().textContent();
  console.log('Page heading:', heading);

  // Check for table/grid content
  const hasGrid = await page.locator('.ag-root, table, [role="grid"]').count();
  console.log('Grid/table elements found:', hasGrid);

  // Check for any error states
  const errors = await page.locator('[role="alert"], .error, .text-red-500, .text-destructive').count();
  console.log('Error elements found:', errors);

  // Pause to let you inspect the browser
  await page.pause();
});
