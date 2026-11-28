import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: string, password = 'demo') {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(`${who}@wethaq.demo`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in to Wethaq' }).click();
}

async function switchRole(page: Page, role: string) {
  await page.getByRole('button', { name: /Demo role:/ }).click();
  await page.getByRole('menuitemradio', { name: role, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Demo role: ' + role })).toBeVisible();
}

test('A wrong password is refused by the API', async ({ page }) => {
  await signIn(page, 'planner', 'wrong-password');
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
  await expect(page).toHaveURL(/\/login$/);
});

test('A request goes through dispatch, transit and receipt on the ledger and verifies', async ({ page }) => {
  await signIn(page, 'planner');
  await expect(page).toHaveURL(/\/overview/);
  await page.goto('/inventory?search=SP-001&location=Distribution+Center');
  await page.locator('tbody tr').first().press('Enter');
  await page.getByRole('button', { name: 'Create shipment request' }).click();
  await page.getByRole('spinbutton', { name: 'Requested quantity' }).fill('4');
  await page.getByRole('textbox', { name: 'Review note (required)' }).fill('Live test request');
  await page.getByRole('button', { name: 'Confirm request' }).click();
  await expect(page).toHaveURL(/\/shipments\?search=SHP-/);
  const shipmentId = new URL(page.url()).searchParams.get('search')!;
  const record = page.locator('tbody tr').filter({ hasText: shipmentId });
  await expect(record).toContainText('Requested');

  await switchRole(page, 'Dispatcher');
  await record.press('Enter');
  await page.getByRole('button', { name: 'Record dispatch' }).click();
  await page.getByRole('button', { name: 'Submit to ledger' }).click();
  await expect(page.getByText(/committed on the local development ledger · block \d+/)).toBeVisible();
  await page.getByRole('button', { name: 'Mark in transit' }).click();
  await page.getByRole('button', { name: 'Submit to ledger' }).click();
  await page.getByRole('button', { name: 'Close detail panel' }).click();
  await expect(record).toContainText('In Transit');

  await switchRole(page, 'Receiver');
  await record.press('Enter');
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await page.getByRole('button', { name: 'Submit to ledger' }).click();
  await page.getByRole('button', { name: 'Verify against ledger' }).click();
  await expect(page.getByText('The database record matches the ledger')).toBeVisible();
  await page.getByRole('button', { name: 'Close detail panel' }).click();
  await expect(record).toContainText('Received');

  await page.getByRole('tab', { name: /^Ledger/ }).click();
  await expect(page.locator('tbody tr').filter({ hasText: shipmentId }).filter({ hasText: 'Committed' })).toHaveCount(3);
  await page.reload();
  await expect(page.locator('tbody tr').filter({ hasText: shipmentId }).filter({ hasText: 'Committed' })).toHaveCount(3);
});

test('A partial receipt, the rest, a return and a cancellation are recorded on the ledger (chaincode version 2)', async ({ page }) => {
  async function request(qty: string) {
    await page.goto('/inventory?search=SP-002&location=Distribution+Center');
    await page.locator('tbody tr').first().press('Enter');
    await page.getByRole('button', { name: 'Create shipment request' }).click();
    await page.getByRole('spinbutton', { name: 'Requested quantity' }).fill(qty);
    await page.getByRole('textbox', { name: 'Review note (required)' }).fill('Live test, version 2');
    await page.getByRole('button', { name: 'Confirm request' }).click();
    await expect(page).toHaveURL(/\/shipments\?search=SHP-/);
    return new URL(page.url()).searchParams.get('search')!;
  }
  async function submit(action: string, qty?: string) {
    await page.getByRole('button', { name: action, exact: true }).click();
    if (qty) await page.getByRole('dialog').getByRole('spinbutton').fill(qty);
    await page.getByRole('button', { name: 'Submit to ledger' }).click();
    await expect(page.getByText(/committed on the local development ledger · block \d+/).last()).toBeVisible();
  }
  await signIn(page, 'planner');
  await expect(page).toHaveURL(/\/overview/);
  const kept = await request('6');
  const dropped = await request('3');

  await switchRole(page, 'Dispatcher');
  await page.goto(`/shipments?search=${dropped}`);
  await page.locator('tbody tr').filter({ hasText: dropped }).press('Enter');
  await submit('Cancel shipment');
  await page.getByRole('button', { name: 'Close detail panel' }).click();
  await expect(page.locator('tbody tr').filter({ hasText: dropped })).toContainText('Cancelled');

  await page.goto(`/shipments?search=${kept}`);
  const record = page.locator('tbody tr').filter({ hasText: kept });
  await record.press('Enter');
  await submit('Record dispatch');
  await page.getByRole('button', { name: 'Close detail panel' }).click();

  await switchRole(page, 'Receiver');
  await record.press('Enter');
  await submit('Record partial receipt', '2');
  await expect(page.getByRole('dialog').getByText('Partially Received').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close detail panel' }).click();
  await expect(record).toContainText('Partially Received');
  await record.press('Enter');
  await submit('Confirm receipt', '4');
  await page.getByRole('button', { name: 'Close detail panel' }).click();
  await expect(record).toContainText('Received');
  await record.press('Enter');
  await submit('Record return', '1');
  await page.getByRole('button', { name: 'Verify against ledger' }).click();
  await expect(page.getByText('The database record matches the ledger')).toBeVisible();
  await page.getByRole('button', { name: 'Close detail panel' }).click();
  await expect(record).toContainText('Returned');

  await page.getByRole('tab', { name: /^Ledger/ }).click();
  for (const type of ['PARTIAL_RECEIPT', 'RECEIPT', 'RETURN']) await expect(page.locator('tbody tr').filter({ hasText: kept }).filter({ hasText: type }).first()).toBeVisible();
  await page.goto(`/shipments?tab=ledger&search=${dropped}`);
  await expect(page.locator('tbody tr').filter({ hasText: dropped }).filter({ hasText: 'CANCELLATION' })).toHaveCount(1);
});

test('A rejection demonstration is rejected by the smart-contract rules', async ({ page }) => {
  await signIn(page, 'admin');
  await expect(page).toHaveURL(/\/overview/);
  await page.goto('/shipments');
  await expect(page.getByText('Local development ledger · not Fabric')).toBeVisible();
  await page.getByRole('button', { name: /Demonstration tools/ }).click();
  await page.getByRole('button', { name: 'Run rejection demo' }).click();
  await expect(page.getByText(/Validation rejected ·/)).toBeVisible();
  await expect(page.getByText(/Smart contract rejected the operation/)).toBeVisible();
});

test('A new user gets a temporary password and must change it at first sign-in', async ({ page, browser }) => {
  await signIn(page, 'admin');
  await expect(page).toHaveURL(/\/overview/);
  await page.goto('/users');
  await page.getByRole('button', { name: 'Add user' }).click();
  await page.getByPlaceholder('Demo User A. Example').fill('Live Test User');
  await page.getByPlaceholder('example@wethaq.demo').fill('live.test@wethaq.demo');
  await page.getByRole('dialog').getByRole('button', { name: 'Add user' }).click();
  const temporary = await page.getByLabel('Temporary password', { exact: true }).inputValue();
  expect(temporary).toHaveLength(12);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('tbody tr').filter({ hasText: 'live.test@wethaq.demo' })).toContainText('Temporary password');

  const other = await browser.newPage();
  await other.goto('/login');
  await other.getByLabel('Email address').fill('live.test@wethaq.demo');
  await other.getByLabel('Password', { exact: true }).fill(temporary);
  await other.getByRole('button', { name: 'Sign in to Wethaq' }).click();
  const dialog = other.getByRole('dialog', { name: 'Choose a new password' });
  await expect(dialog).toBeVisible();
  await other.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Temporary password').fill(temporary);
  await dialog.getByLabel('New password', { exact: true }).fill('LiveTest2026');
  await dialog.getByLabel('Confirm new password').fill('LiveTest2026');
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog).toBeHidden();
  await expect(other.getByText('Password changed')).toBeVisible();
  await other.close();
  await expect(page.locator('tbody tr').filter({ hasText: 'live.test@wethaq.demo' })).not.toContainText('Temporary password');
});

test('A change made by another user appears without reloading the page', async ({ page, request }) => {
  await signIn(page, 'dispatcher');
  await expect(page).toHaveURL(/\/overview/);
  await page.goto('/shipments');
  await expect(page.getByText('Live updates on')).toBeVisible();
  const token = (await (await request.post('http://127.0.0.1:4000/api/auth/login', { data: { email: 'planner@wethaq.demo', password: 'demo' } })).json()).token;
  const created = await (await request.post('http://127.0.0.1:4000/api/shipments', {
    headers: { Authorization: `Bearer ${token}` },
    data: { partId: 'SP-002', location: 'Central Warehouse', qty: 3, month: '2026-12', note: 'Created by another user' }
  })).json();
  await expect(page.getByText(new RegExp(`${created.id} · Requested on the local development ledger · block \\d+`))).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: created.id })).toContainText('Requested');
});

test('The forecasting page reads the analysis results from the API, with their checksum', async ({ page }) => {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const sha = createHash('sha256').update(readFileSync('analysis/results/raf-forecasts.json')).digest('hex');
  await signIn(page, 'planner');
  await expect(page).toHaveURL(/\/overview/);
  await page.goto('/forecasts');
  await expect(page.getByText(`From the API · analysis/results/raf-forecasts.json · ${sha.slice(0, 8)}`)).toBeVisible();
  await expect(page.getByText('could not be loaded from the Wethaq API')).toHaveCount(0);
});

test('Signing out ends the session on the server, not only in the browser', async ({ page, request }) => {
  await signIn(page, 'receiver');
  await expect(page).toHaveURL(/\/overview/);
  const token = await page.evaluate(() => sessionStorage.getItem('wethaq.token'));
  expect(token).toBeTruthy();
  expect((await request.get('http://127.0.0.1:4000/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => sessionStorage.getItem('wethaq.token'))).toBeNull();
  await expect.poll(async () => (await request.get('http://127.0.0.1:4000/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
});

test('An expired or ended session returns to the sign-in page and shows no data', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => sessionStorage.setItem('wethaq.token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJVU1ItMDAxIiwiZXhwIjoxfQ.expired'));
  await page.goto('/shipments');
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => sessionStorage.getItem('wethaq.token'))).toBeNull();
  await expect(page.getByText('SHP-2026-0001')).toHaveCount(0);
});

test('When the API cannot be reached, the dashboard says so and shows no demonstration data', async ({ page }) => {
  // Only the API (/api/...), not the dashboard's own modules such as /src/api/live.ts.
  await page.route(url => url.pathname.startsWith('/api/'), route => route.abort('connectionrefused'));
  await signIn(page, 'planner');
  await expect(page.getByRole('alert')).toContainText('Wethaq API is not reachable');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('SHP-2026-0001')).toHaveCount(0);
});
