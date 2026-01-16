import { defineConfig, devices } from '@playwright/test';

/**
 * Production tests configuration for COH-ERP2
 * Tests page loading, data freshness, and performance metrics
 *
 * Environment variables:
 * - TEST_URL: Base URL to test (default: http://localhost:5173)
 * - RECORD_HAR: Set to 'true' to record HAR files for network analysis
 * - CI: Set in CI environments for adjusted retry/parallel settings
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run tests sequentially for accurate timing
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  outputDir: 'test-output',
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.TEST_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    // Persist storage state (cookies/localStorage) between tests
    storageState: 'test-output/.auth/user.json',

    // Record HAR files for detailed network analysis (optional)
    ...(process.env.RECORD_HAR === 'true' && {
      recordHar: {
        path: 'playwright-report/network.har',
        mode: 'full',
        content: 'embed',
      },
    }),
  },

  projects: [
    // Setup project - runs first to authenticate
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
      teardown: 'cleanup',
    },
    {
      name: 'cleanup',
      testMatch: /global\.teardown\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'test-output/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  // Timeout settings for production tests
  timeout: 60000, // 60s per test
  expect: {
    timeout: 30000, // 30s for assertions
  },
});
