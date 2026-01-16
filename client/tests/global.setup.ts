import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_FILE = 'test-output/.auth/user.json';

setup('authenticate', async ({ page }) => {
  const config = {
    email: process.env.TEST_EMAIL || 'admin@coh.com',
    password: process.env.TEST_PASSWORD || 'XOFiya@34',
  };

  // Ensure auth directory exists
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // Go to login page
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  // Clear and fill login form
  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');

  await emailInput.clear();
  await emailInput.fill(config.email);
  await passwordInput.clear();
  await passwordInput.fill(config.password);

  // Submit
  await page.click('button[type="submit"]');

  // Wait for successful redirect
  await page.waitForURL(/\/(orders|dashboard)?$/, { timeout: 30000 });

  // Verify we're logged in
  await expect(page.locator('h1:has-text("Orders"), h1:has-text("Dashboard")')).toBeVisible({ timeout: 10000 });

  // Save auth state
  await page.context().storageState({ path: AUTH_FILE });
  console.log('Authentication successful, state saved to', AUTH_FILE);
});
