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
  if (geometry.viewport <= 760) {
    const breaks = await page.locator('.login-brand .login-message h1 br').evaluateAll(els =>
      els.map(el => getComputedStyle(el).display)
    );
    expect(breaks).toHaveLength(3);
    expect(breaks.every(style => style !== 'none')).toBe(true);
  }
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

test('Overview controls carry the selected records and forecast into their modules', async ({ page }) => {
  await login(page);
  const forecast = page.getByRole('combobox', { name: 'Select forecast part' });
  await forecast.click();
  await page.getByRole('option', { name: /SP-002/ }).click();
  await page.getByRole('button', { name: '3 mo' }).click();
  await expect(page.getByRole('button', { name: '3 mo' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Open forecast' }).click();
  await expect(page).toHaveURL(/part=SP-002&horizon=3/);

  await page.goto('/overview');
  await page.getByRole('link', { name: /Pending receipt/ }).click();
  await expect(page.getByRole('combobox', { name: 'Status' })).toContainText('Pending receipt');
  await expect(page.locator('tbody tr').filter({ hasText: /Received|Requested/ })).toHaveCount(0);
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await expect(page.getByRole('combobox', { name: 'Status' })).toContainText('All statuses');

  await page.goto('/overview');
  await page.getByRole('link', { name: 'Review alerts' }).click();
  await expect(page.getByRole('combobox', { name: 'Alert state' })).toContainText('New');
  await expect(page.locator('tbody tr').filter({ hasText: 'Acknowledged' })).toHaveCount(0);
});

test('Mobile navigation can be dismissed and returns keyboard focus', async ({ page }) => {
  test.skip(page.viewportSize()!.width > 760, 'Mobile navigation only');
  await login(page);
  const trigger = page.getByRole('button', { name: 'Open menu' });
  await trigger.click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
  const sidebar = page.locator('#workspace-navigation');
  const backdrop = page.locator('.mobile-overlay');
  await expect(sidebar).toHaveCSS('opacity', '1');
  await expect(backdrop).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(sidebar).toHaveJSProperty('inert', true);
  await expect(backdrop).toHaveCSS('opacity', '0');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
  await expect(trigger).toBeFocused();
});


test('Reduced motion turns off dashboard entrance and sidebar transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await expect(page.locator('.overview-hero-content')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('#workspace-navigation')).toHaveCSS('transition-duration', '0s');
  if (page.viewportSize()!.width <= 760) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.locator('.mobile-overlay')).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(page.locator('.mobile-overlay')).toBeHidden();
  }
});

test('Theme switches animate on login and overview without changing the login layout', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.goto('/login');
  const hero = page.locator('.login-brand');
  const lightColor = await hero.evaluate(element => getComputedStyle(element).backgroundColor);
  const originalLayout = await hero.boundingBox();
  const heroTransition = hero.evaluate(element => new Promise<boolean>(resolve => {
    element.addEventListener('transitionrun', event => {
      if (event.target === element && event.propertyName === 'background-color') resolve(true);
    });
    window.setTimeout(() => resolve(false), 2500);
  }));
  await setTheme(page, 'Dark');
  expect(await heroTransition).toBe(true);
  await expect(page.locator('.login-brand .login-logo-paper')).toHaveCSS('opacity', '1');
  await expect(page.locator('.theme-moon')).toHaveCSS('opacity', '1');
  await expect(hero).not.toHaveCSS('background-color', lightColor);
  expect(await hero.boundingBox()).toEqual(originalLayout);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#101B28');

  await login(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const topbarTransition = page.locator('.topbar').evaluate(element => new Promise<boolean>(resolve => {
    element.addEventListener('transitionrun', event => {
      if (event.target === element && event.propertyName === 'background-color') resolve(true);
    });
    window.setTimeout(() => resolve(false), 2500);
  }));
  await setTheme(page, 'Light');
  expect(await topbarTransition).toBe(true);
  await expect(page.locator('.theme-sun')).toHaveCSS('opacity', '1');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#F7F8FA');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
