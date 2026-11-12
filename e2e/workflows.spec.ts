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
  await page.goto('/forecasts?part=SP-002&location=unknown&horizon=invalid');
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page);
  await expect(page).toHaveURL(/\/forecasts\?part=SP-002/);
  await expect(page.getByRole('combobox', { name: 'Forecast horizon' })).toContainText('6 months');
  await expect(page.getByRole('combobox', { name: 'Location', exact: true })).toContainText('All locations');
  const forecastDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  expect((await forecastDownload).suggestedFilename()).toBe('wethaq-forecast-SP-002.csv');

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
  await quantity.fill('2');
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
  await expect(page.getByRole('button', { name: '10 active alerts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export data', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '9 active alerts' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(9);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('wethaq-alerts.csv');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8').trim();
  expect(csv.split('\r\n')).toHaveLength(10);
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
  await expect(page.getByRole('button', { name: '11 active alerts' })).toBeVisible();
});
