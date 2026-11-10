import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Sign in to Wethaq/i })).toBeVisible();
  await page.getByRole('button', { name: /Sign in to Wethaq/i }).click();
  await expect(page).toHaveURL(/\/overview/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
async function setTheme(page: Page, theme: 'Dark' | 'Light') {
  await page.getByRole('combobox', { name: 'Color theme' }).click();
  await page.getByRole('option', { name: theme, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
}
async function noDocumentOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  )).toBeLessThanOrEqual(2);
}

for (const theme of ['Dark', 'Light'] as const) {
  test(`${theme} theme has no mobile/desktop horizontal overflow and consistent prototype branding`, async ({ page }, info) => {
    await page.goto('/login');
    await setTheme(page, theme);
    await noDocumentOverflow(page);
    await login(page);
    await noDocumentOverflow(page);
    await page.screenshot({ path: info.outputPath(`${theme.toLowerCase()}-overview.png`), fullPage: true });

    await page.goto('/shipments');
    await expect(page.getByRole('tab', { name: /Ledger/i })).toBeVisible();
    await page.getByRole('tab', { name: /Ledger/i }).click();
    await expect(page.getByRole('tab', { name: /Ledger/i })).toHaveAttribute('aria-selected', 'true');
    await noDocumentOverflow(page);
    const tabRadius = await page.getByRole('tab', { name: /Ledger/i }).evaluate(el => getComputedStyle(el).borderRadius);
    expect(parseFloat(tabRadius)).toBeGreaterThanOrEqual(10);
    const header = page.locator('.grid-wrap thead th').first();
    await expect(header).toBeVisible();
    if (theme === 'Dark') {
      const bg = await header.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(bg).not.toMatch(/rgb\(255, 255, 255\)|rgb\(250, 251, 252\)/);
    }
    await page.screenshot({ path: info.outputPath(`${theme.toLowerCase()}-ledger.png`), fullPage: true });

    await page.getByRole('button', { name: /About this prototype/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const src = await page.locator('.about-logo-surface img').getAttribute('src');
    expect(src).toContain(theme === 'Dark' ? '-light.svg' : '-dark.svg');
    await page.screenshot({ path: info.outputPath(`${theme.toLowerCase()}-about.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await noDocumentOverflow(page);
  });
}

test('Role menu is native-theme-free, navigable and closes with Escape', async ({ page }) => {
  await login(page);
  const trigger = page.getByRole('button', { name: /Demo role: Logistics Planner/i });
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Dispatcher' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.getByRole('menuitemradio', { name: 'Dispatcher' }).click();
  await expect(page.getByRole('button', { name: /Demo role: Dispatcher/i })).toBeVisible();
  await noDocumentOverflow(page);
});

test('All three workflow areas stay reachable at narrow viewports', async ({ page }) => {
  await login(page);
  for (const route of ['/forecasts', '/inventory', '/shipments']) {
    await page.goto(route);
    await expect(page.locator('.page')).toBeVisible();
    await noDocumentOverflow(page);
  }
  if (page.viewportSize()!.width < 761) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'Close menu' }).click();
  }
});
