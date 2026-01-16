import { test as teardown } from '@playwright/test';

teardown('cleanup', async () => {
  // Cleanup tasks if needed
  console.log('Test suite completed');
});
