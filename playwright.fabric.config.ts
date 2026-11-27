import { defineConfig } from '@playwright/test';

// End-to-end browser test against the real Hyperledger Fabric test network (not part of the default checks).
// Before running: ./fabric/up.sh, then in wethaq-api (LEDGER_MODE=fabric): npm run migrate && npm run seed -- --reset.
// The test starts and restarts the API itself, so nothing may be listening on port 4000. See docs/gp482/TEST_EVIDENCE.md.
export default defineConfig({
  testDir: './e2e-fabric',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4175', trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: 'npm run dev:live -- --host 127.0.0.1 --port 4175', url: 'http://127.0.0.1:4175', reuseExistingServer: false, timeout: 60_000 }
  ]
});
