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
