import { test, expect } from '@playwright/test';

// Walking skeleton smoke test. Replace the assertions with the skeleton's real slice
// (for example: the page renders the row read from the database).
test('home page loads', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/.+/);
});
