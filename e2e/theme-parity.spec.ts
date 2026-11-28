import { test, expect, type Page } from '@playwright/test';

/**
 * A regression test for Wethaq's design contract: theme changes paint, not
 * layout. Run in the same browser, viewport, zoom, account, and data state.
 * Visual animations are disabled via reduced motion to compare stable bounds.
 */
const routes: Record<string, string[]> = {
  '/overview': [
    '.overview-page', '.overview-hero', '.overview-hero-content',
    '.overview-hero h1', '.overview-hero h1 em', '.overview-hero p',
    '.overview-hero-actions', '.overview-hero-art', '.w-orbit',
    '.kpi-grid', '.kpi-link', '.kpi', '.kpi-label', '.kpi-value', '.kpi-note',
    '.overview-primary', '.overview-bottom', '.panel', '.panel-heading',
    '.panel-heading h2', '.panel-heading p', '.donut-layout',
    '.status-legend', '.risk-row', '.overview-context-note',
  ],
  '/forecasts': [
    '.page', '.forecast-mode-switch', '.panel', '.panel-heading',
    '.panel-heading h2', '.method-panel', '.method-head',
    '.raf-model-comparison', '.table-scroller',
  ],
  '/inventory': ['.page', '.panel', '.panel-heading', '.grid-wrap', '.grid-toolbar', '.table-scroller', '.grid-footer'],
  '/shipments': [
    '.page', '.shipments-workspace', '.tabs', '.tab', '.filters-panel',
    '.shipment-context-panel', '.grid-wrap', '.grid-toolbar',
    '.table-scroller', '.grid-footer',
  ],
};

// Select real route content, never the generic loading placeholder.
const pageReadySelectors: Record<string, string> = {
  '/overview': '.overview-page .overview-hero',
  '/forecasts': '.forecast-dataset-picker .forecast-mode-switch',
  '/inventory': '.page .page-title-row h1',
  '/shipments': '.shipments-workspace .tabs',
};

const geometryProps = [
  'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
  'padding', 'margin', 'gap', 'display', 'gridTemplateColumns',
  'boxSizing', 'borderWidth', 'borderRadius', 'alignItems',
  'justifyContent', 'whiteSpace', 'overflow',
] as const;

type Sample = { bounds: [number, number, number, number]; props: Record<string, string> };

async function setTheme(page: Page, target: 'light' | 'dark') {
  if (await page.locator('html').getAttribute('data-theme') !== target) {
    await page.getByRole('button', { name: `Switch to ${target} mode` }).click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', target);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(80);
}

async function measure(page: Page, selectors: string[]) {
  return page.evaluate(({ selectors, props }) => {
    const result: Record<string, Sample[]> = {};
    for (const selector of selectors) {
      result[selector] = Array.from(document.querySelectorAll<HTMLElement>(selector)).map(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          bounds: [rect.x, rect.y, rect.width, rect.height] as [number, number, number, number],
          props: Object.fromEntries(props.map(prop => [prop, style.getPropertyValue(
            prop.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`),
          )])),
        };
      });
    }
    return result;
  }, { selectors, props: [...geometryProps] });
}

test('Light and dark modes preserve identical UI geometry on all four pages', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Sign in to Wethaq/i })).toBeVisible();
  await page.getByRole('button', { name: /Sign in to Wethaq/i }).click();
  await expect(page).toHaveURL(/\/overview(?:\?|$)/);
  for (const [route, selectors] of Object.entries(routes)) {
    await page.goto(route);
    // LoadGate renders a temporary `.page.skeleton-page` before the actual route.
    // Waiting for `.page` alone compared a skeleton in light mode with the
    // fully loaded overview in dark mode (false geometry mismatch).
    await expect(page).toHaveURL(new RegExp(`${route}(?:\\?|$)`));
    await expect(page.locator('.skeleton-page')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(pageReadySelectors[route])).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.state-page')).toHaveCount(0);
    await page.evaluate(() => scrollTo(0, 0));

    await setTheme(page, 'light');
    await expect(page.locator(pageReadySelectors[route])).toBeVisible();
    await expect(page.locator('.skeleton-page')).toHaveCount(0);
    const light = await measure(page, selectors);
    if (route === '/overview') await page.screenshot({ path: info.outputPath('overview-light.png') });

    await setTheme(page, 'dark');
    await expect(page.locator(pageReadySelectors[route])).toBeVisible();
    await expect(page.locator('.skeleton-page')).toHaveCount(0);
    const dark = await measure(page, selectors);
    if (route === '/overview') await page.screenshot({ path: info.outputPath('overview-dark.png') });

    // Fail if a route was accidentally measuring two empty skeletons.
    expect(light[selectors[0]].length, `${route}: ready elements must exist`).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(dark[selector].length, `${route}: ${selector} element count`).toBe(light[selector].length);
      for (let i = 0; i < light[selector].length; i++) {
        const before = light[selector][i];
        const after = dark[selector][i];
        for (let n = 0; n < 4; n++) {
          expect(Math.abs(after.bounds[n] - before.bounds[n]),
            `${route}: ${selector}[${i}] bound ${n}`).toBeLessThanOrEqual(1);
        }
        for (const prop of geometryProps) {
          expect(after.props[prop], `${route}: ${selector}[${i}] ${prop}`).toBe(before.props[prop]);
        }
      }
    }
  }
});
