import { defineConfig } from '@playwright/test';

// Checks against a running deployment (deploy/compose.yml or Caddy with deploy/Caddyfile); starts no server.
// WETHAQ_URL is the site address, WETHAQ_EMAIL and WETHAQ_PASSWORD a Planner account on it.
export default defineConfig({
  testDir: './e2e-deploy',
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.WETHAQ_URL ?? 'http://127.0.0.1:8089', viewport: { width: 1440, height: 900 } }
});
