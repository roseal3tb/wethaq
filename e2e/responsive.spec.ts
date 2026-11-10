import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Sign in to Wethaq/i })).toBeVisible();
  await page.getByRole('button', { name: /Sign in to Wethaq/i }).click();
  await expect(page).toHaveURL(/\/overview/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // SPA navigation from a taller login form must not keep its old scroll offset
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.locator('.topbar').evaluate(el => Math.abs(el.getBoundingClientRect().top))).toBeLessThanOrEqual(2);
}
async function setTheme(page: Page, theme: 'Dark' | 'Light') {
  const target = theme.toLowerCase();
  const current = await page.locator('html').getAttribute('data-theme');
  if (current !== target) await page.getByRole('button', { name: `Switch to ${target} mode` }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', target);
  await expect(page.getByRole('button', { name: `Switch to ${target === 'dark' ? 'light' : 'dark'} mode` })).toBeVisible();
}
async function verifyLoginLayout(page: Page) {
  const geometry = await page.evaluate(() => {
    const hero = document.querySelector('.login-brand')!.getBoundingClientRect();
    const form = document.querySelector('.login-right')!.getBoundingClientRect();
    const theme = document.querySelector('.login-theme')!.getBoundingClientRect();
    const wrapper = document.querySelector('.login')!.getBoundingClientRect();
    return {
      viewport: window.innerWidth, viewportHeight: window.innerHeight,
      hero: { x: hero.x, y: hero.y, width: hero.width, height: hero.height },
      form: { x: form.x, y: form.y, width: form.width, height: form.height },
      theme: { x: theme.x, y: theme.y, width: theme.width },
      wrapper: { x: wrapper.x, y: wrapper.y, width: wrapper.width }
    };
  });
  expect(Math.abs(geometry.wrapper.x)).toBeLessThanOrEqual(1);
  expect(geometry.wrapper.width).toBeGreaterThanOrEqual(geometry.viewport - 2);
  expect(Math.abs(geometry.hero.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.hero.y)).toBeLessThanOrEqual(2);
  if (geometry.viewport > 760) {
    // Brand and form MUST sit side by side, not diagonal with two empty cells
    expect(Math.abs(geometry.form.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.form.x - geometry.hero.width)).toBeLessThanOrEqual(3);
    expect(geometry.hero.height).toBeGreaterThanOrEqual(geometry.viewportHeight - 2);
    expect(geometry.form.height).toBeGreaterThanOrEqual(geometry.viewportHeight - 2);
  } else {
    expect(Math.abs(geometry.form.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.form.y - geometry.hero.height)).toBeLessThanOrEqual(3);
  }
  // Icon is a top-right overlay, not a separate grid column or grid row
  expect(geometry.theme.x).toBeGreaterThan(geometry.viewport - 100);
  expect(geometry.theme.y).toBeLessThanOrEqual(40);
  await expect(page.locator('.login-brand .login-message h1')).toBeVisible();
  await expect(page.locator('.login-right .login-form-wrap')).toBeVisible();
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
    await verifyLoginLayout(page);
    await page.screenshot({ path: info.outputPath(`${theme.toLowerCase()}-login.png`), fullPage: false });
    await login(page);
    await noDocumentOverflow(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
    await expect(page.locator('.header-actions .theme-icon-toggle')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${theme.toLowerCase()}-overview.png`), fullPage: false });
    await page.locator('.footer').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`${theme.toLowerCase()}-footer.png`), fullPage: false });
    await page.evaluate(() => window.scrollTo(0, 0));

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
    await page.screenshot({ path: info.outputPath(`${theme.toLowerCase()}-ledger.png`), fullPage: false });

    await page.getByRole('button', { name: /About this prototype/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const src = await page.locator('.about-logo-surface img').getAttribute('src');
    expect(src).toContain(theme === 'Dark' ? '-light.svg' : '-dark.svg');
    await page.screenshot({ path: info.outputPath(`${theme.toLowerCase()}-about.png`), fullPage: false });
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
