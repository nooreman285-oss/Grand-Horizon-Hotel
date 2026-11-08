// Full booking flow: guest signs up -> searches -> books -> receptionist checks in/out -> guest downloads invoice.
const { test, expect } = require('@playwright/test');
const iso = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('guest books a room and reception completes the stay', async ({ page }) => {
  const email = `e2e${Date.now()}@test.com`;
  await page.goto('/#/login');
  await page.click('#sw');
  await page.fill('input[name=name]', 'E2E Guest');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'password123');
  await page.click('button:has-text("Sign up")');
  await expect(page.locator('h1')).toContainText('Find your perfect stay');

  await page.fill('#sf input[name=checkIn]', iso(0));
  await page.fill('#sf input[name=checkOut]', iso(1));
  await page.click('#sf button:has-text("Search")');
  await page.locator('a.room').first().click();
  await page.click('a:has-text("Book this room")');
  await page.click('#bb');
  await expect(page.locator('.toast.ok')).toContainText('Booking confirmed');
  await expect(page.locator('.bk').first()).toContainText('Confirmed');

  // reception checks the guest in and out
  await page.click('#lo');
  await page.fill('input[name=email]', 'reception@hotel.com');
  await page.fill('input[name=password]', 'Reception@123');
  await page.click('button:has-text("Login")');
  await page.goto('/#/reception');
  await page.fill('#q', 'E2E Guest');
  await page.click('button[data-a=checkin]');
  await page.click('button[data-a=checkout]');

  // guest sees the completed stay and invoice link
  await page.click('#lo');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'password123');
  await page.click('button:has-text("Login")');
  await page.goto('/#/my');
  await expect(page.locator('.bk').first()).toContainText('Completed');
  await expect(page.locator('button[data-a=invoice]').first()).toBeVisible();
});
