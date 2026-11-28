import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.getByRole('button', { name: 'Sign in to Wethaq' }).click();
}

async function changeRole(page: Page, role: string) {
  await page.getByRole('button', { name: /Demo role:/ }).click();
  await page.getByRole('menuitemradio', { name: role, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Demo role: ' + role })).toBeVisible();
}

test('Direct links resume after sign-in and restricted pages retain role navigation', async ({ page }) => {
  await page.goto('/forecasts?part=RAF0002');
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page);
  await expect(page).toHaveURL(/\/forecasts\?part=RAF0002/);
  await expect(page.getByRole('combobox', { name: 'Part', exact: true })).toContainText('RAF0002');
  await expect(page.getByRole('combobox', { name: 'Demand class' })).toContainText('All classes');
  const forecastDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  expect((await forecastDownload).suggestedFilename()).toBe('wethaq-raf-RAF0002.csv');

  await changeRole(page, 'Receiver');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  await changeRole(page, 'Admin');
  await expect(page.getByRole('heading', { name: 'Demand forecasting' })).toBeVisible();
  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'Users & roles' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Role permissions' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Demo role: Admin' })).toBeVisible();
});

test('A simulated request becomes a received shipment with three committed ledger entries', async ({ page }) => {
  await page.goto('/inventory?search=SP-001&location=Distribution+Center');
  await signIn(page);
  await expect(page).toHaveURL(/\/inventory\?search=SP-001/);
  await page.locator('tbody tr').first().press('Enter');
  await page.getByRole('button', { name: 'Create simulated shipment request' }).click();
  const quantity = page.getByRole('spinbutton', { name: 'Requested quantity' });
  const confirm = page.getByRole('button', { name: 'Confirm request' });
  await quantity.fill('1.5');
  await expect(confirm).toBeDisabled();
  await quantity.fill('100001');
  await expect(confirm).toBeDisabled();
  await quantity.fill('-5');
  await expect(confirm).toBeDisabled();
  await expect(quantity).toHaveValue('-5');
  await quantity.fill('2');
  await expect(confirm).toBeDisabled();
  await page.getByRole('textbox', { name: 'Review note (required)' }).fill('Reviewed low stock and lead time');
  await confirm.click();
  await expect(page).toHaveURL(/\/shipments\?search=SHP-/);
  const shipmentId = new URL(page.url()).searchParams.get('search')!;
  const record = page.locator('tbody tr').filter({ hasText: shipmentId });
  await expect(record).toContainText('Requested');

  await changeRole(page, 'Dispatcher');
  await record.press('Enter');
  await page.getByRole('button', { name: 'Record dispatch' }).click();
  await page.getByRole('button', { name: 'Commit simulated record' }).click();
  await page.getByRole('button', { name: 'Mark in transit' }).click();
  await page.getByRole('button', { name: 'Commit simulated record' }).click();
  await page.getByRole('button', { name: 'Close detail panel' }).click();
  await expect(record).toContainText('In Transit');

  await changeRole(page, 'Receiver');
  await record.press('Enter');
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await page.getByRole('button', { name: 'Commit simulated record' }).click();
  await page.getByRole('button', { name: 'Close detail panel' }).click();
  await expect(record).toContainText('Received');
  await page.getByRole('tab', { name: /^Ledger/ }).click();
  await expect(page.locator('tbody tr').filter({ hasText: shipmentId })).toHaveCount(3);
  await expect(page.locator('tbody tr').filter({ hasText: /Committed/ })).toHaveCount(3);
  await page.reload();
  await expect(page.locator('tbody tr').filter({ hasText: /Committed/ })).toHaveCount(3);
});

test('Alert acknowledgment updates the badge and the alert export follows the filter', async ({ page }) => {
  await page.goto('/inventory?tab=alerts&alert=New');
  await signIn(page);
  const badge = page.getByRole('button', { name: /active alerts$/ });
  const initial = Number((await badge.getAttribute('aria-label'))!.match(/^\d+/)![0]);
  expect(initial).toBeGreaterThan(10);
  await expect(page.getByRole('button', { name: 'Export data', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).first().click();
  await expect(badge).toHaveAttribute('aria-label', `${initial - 1} active alerts`);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('wethaq-alerts.csv');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8').trim();
  expect(csv.split('\r\n').length).toBeGreaterThan(10);
  expect(csv).toContain('"STATE"');
  expect(csv).toContain('"New"');
  expect(csv).not.toContain('"Acknowledged"');
});

test('A rejected demonstration attempt opens its own ledger record even with an existing search', async ({ page }) => {
  await page.goto('/shipments?search=missing-record');
  await signIn(page);
  await page.getByRole('button', { name: /Demonstration tools/ }).click();
  await page.getByRole('button', { name: 'Run rejection demo' }).click();
  await expect(page.getByText(/Validation rejected ·/)).toBeVisible();
  await page.getByRole('button', { name: 'View rejected ledger attempt' }).click();
  await expect(page).toHaveURL(/tab=ledger&search=TX-REJ-/);
  const records = page.locator('tbody tr');
  await expect(records).toHaveCount(1);
  await expect(records.first()).toContainText('Rejected');
  await expect(page.getByRole('button', { name: /active alerts$/ })).toBeVisible();
});


test('Login rejects malformed email and renders the decorative login animation', async ({ page }) => {
  await page.goto('/login');
  const animation = page.locator('.login-flow');
  await expect(animation).toHaveCount(1);
  await expect(animation).toHaveAttribute('aria-hidden', 'true');
  await expect(animation.locator('.w-orbit--login')).toHaveCount(1);
  const email = page.getByRole('textbox', { name: 'Email address' });
  await email.fill('notanemail');
  expect(await email.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
  await page.getByRole('button', { name: 'Sign in to Wethaq' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await email.fill('planner@wethaq.demo');
  await page.getByRole('button', { name: 'Sign in to Wethaq' }).click();
  await expect(page).toHaveURL(/\/overview$/);
});

test('The forecast chart has a table alternative and panel headings sit under the page heading (NFR2)', async ({ page }) => {
  await page.goto('/forecasts?part=RAF0002');
  await signIn(page);
  await expect(page.getByRole('heading', { level: 1, name: /Demand\s*forecasting/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Demand history & forecast' })).toBeVisible();
  const toggle = page.getByRole('button', { name: 'View as table' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  const viewChart = page.getByRole('button', { name: 'View chart' });
  await expect(viewChart).toHaveAttribute('aria-pressed', 'true');
  const table = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'PHASE' }) });
  await expect(table).toBeVisible();
  expect(await table.getByRole('row').count()).toBeGreaterThan(10);
  await viewChart.click();
  await expect(page.getByRole('button', { name: 'View as table' })).toHaveAttribute('aria-pressed', 'false');
});
