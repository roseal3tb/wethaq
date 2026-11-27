import { defineConfig } from '@playwright/test';

// Live-mode browser tests: the dashboard (VITE_WETHAQ_LIVE=true) against the Wethaq API.
// The API runs with an in-memory database and the local development ledger, so no Docker is needed.
// Requires `npm install` in wethaq-api first.
export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: 'npm --prefix wethaq-api run dev:memory', url: 'http://127.0.0.1:4000/api/health', reuseExistingServer: false, timeout: 60_000 },
    { command: 'npm run dev:live -- --host 127.0.0.1 --port 4174', url: 'http://127.0.0.1:4174', reuseExistingServer: false, timeout: 60_000 }
  ]
});
