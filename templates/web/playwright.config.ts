import { defineConfig, devices } from '@playwright/test';

// PORT lets parallel worktrees run their own app (rb worktree add prints an offset).
// E2E_BASE_URL points the suite at an app that is already running and skips webServer.
const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['.explore/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a flaky test must be classified by the healer, never passed by luck.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
