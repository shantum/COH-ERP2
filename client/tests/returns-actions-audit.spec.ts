import { test, expect } from '@playwright/test';

const TARGET_PATH = '/returns?tab=actions&requestType=all&datePreset=30d';
const credentials = {
  email: process.env.TEST_EMAIL || 'admin@coh.com',
  password: process.env.TEST_PASSWORD || 'XOFiya@34',
};

test('audit returns actions workflow context', async ({ page }) => {
  const responses: Array<{ url: string; status: number; body?: unknown }> = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('getLineReturnActionQueue')) return;
    const entry: { url: string; status: number; body?: unknown } = {
      url,
      status: response.status(),
    };
    try {
      entry.body = await response.json();
    } catch {
      // Ignore non-JSON responses
    }
    responses.push(entry);
  });

  await page.goto(TARGET_PATH);
  await page.waitForLoadState('networkidle');

  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.clear();
    await emailInput.fill(credentials.email);
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.clear();
    await passwordInput.fill(credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(orders|dashboard|returns)/, { timeout: 30000 });
    await page.goto(TARGET_PATH);
    await page.waitForLoadState('networkidle');
  }

  await expect(page.locator('h1:has-text("Returns")')).toBeVisible();
  await page.waitForTimeout(2000);

  const actionCounts = {
    schedulePickup: await page.getByRole('button', { name: /Schedule Pickup/i }).count(),
    receive: await page.getByRole('button', { name: /^Receive$/i }).count(),
    processRefund: await page.getByRole('button', { name: /Process Refund/i }).count(),
    createExchange: await page.getByRole('button', { name: /Create Exchange/i }).count(),
    complete: await page.getByRole('button', { name: /^Complete$/i }).count(),
    awaitingQcBadges: await page.getByText(/Awaiting QC/i).count(),
  };

  const agingTexts = await page.locator('text=/Requested\\s+\\d+d ago|Requested today/').allTextContents();
  const agingDays = agingTexts
    .map((text) => text.match(/Requested\s+(\d+)d ago/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number.parseInt(value, 10));

  const summaryCards = await page.locator('div.border.border-gray-200.rounded-lg.bg-white').count();

  const visibleRows = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('div.p-4'));
    const candidates = rows
      .map((row) => row.textContent?.replace(/\s+/g, ' ').trim() || '')
      .filter((text) => text.includes('Requested') && text.includes('Qty:'))
      .slice(0, 10);
    return candidates;
  });

  const queueResponse = responses.at(-1)?.body;
  const queueItems = Array.isArray(queueResponse) ? queueResponse : [];
  const actionMixFromApi = queueItems.reduce<Record<string, number>>((acc, item) => {
    const key = typeof item === 'object' && item && 'actionNeeded' in item
      ? String((item as { actionNeeded?: string }).actionNeeded)
      : 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const oldestDaysFromApi = queueItems.reduce((max, item) => {
    const days = typeof item === 'object' && item && 'daysSinceRequest' in item
      ? Number((item as { daysSinceRequest?: number }).daysSinceRequest || 0)
      : 0;
    return Math.max(max, days);
  }, 0);

  console.log('\n========== RETURNS ACTIONS AUDIT ==========' );
  console.log('URL:', page.url());
  console.log('Summary cards rendered:', summaryCards);
  console.log('Action buttons visible:', actionCounts);
  console.log('Aging entries found:', agingTexts.length);
  console.log('Oldest visible age (days):', agingDays.length ? Math.max(...agingDays) : 0);
  console.log('Action mix from API:', actionMixFromApi);
  console.log('Queue size from API:', queueItems.length);
  console.log('Oldest item age from API (days):', oldestDaysFromApi);
  console.log('Sample visible rows:');
  visibleRows.forEach((row, index) => {
    console.log(`  ${index + 1}. ${row.slice(0, 200)}`);
  });
  console.log('===========================================\n');
});
