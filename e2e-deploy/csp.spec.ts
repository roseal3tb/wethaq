import { expect, test } from '@playwright/test';
// The live-mode build behind Caddy (deploy/Caddyfile): no Content-Security-Policy violations while signed in.
// Needs Caddy serving dist-live with the API behind it; see docs/gp482/DEPLOYMENT_GUIDE.md (checking the CSP).
test('the dashboard runs under the Caddy Content-Security-Policy with no violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => console.log('Refused to load (CSP) ' + e.violatedDirective + ' ' + e.blockedURI)));
  const res = await page.goto('/login');
  expect(res!.headers()['content-security-policy']).toContain("default-src 'self'");
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
  await page.getByLabel('Email address').fill(process.env.WETHAQ_EMAIL ?? 'planner@wethaq.demo');
  await page.getByLabel('Password', { exact: true }).fill(process.env.WETHAQ_PASSWORD ?? 'demo');
  await page.getByRole('button', { name: 'Sign in to Wethaq' }).click();
  await expect(page).toHaveURL(/\/overview/);
  for (const path of ['/forecasts', '/inventory', '/shipments', '/overview']) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible(); await page.waitForTimeout(1500);
  }
  await expect(page.getByRole('main')).toBeVisible();
  console.log('pages visited, CSP violations:', violations.length);
  expect(violations).toEqual([]);
});
