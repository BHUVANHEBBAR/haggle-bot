'use strict';
// Real PayPal SANDBOX flow (flow a). Needs E2E_PAYPAL_EMAIL / E2E_PAYPAL_PASSWORD (sandbox Personal account) in .env.
//   PW_DIR=<playwright folder> node scripts/e2e/sandbox.js
// Runs a visible browser so a captcha / verification step can be completed by hand. Never prints credentials.
const path = require('path');
require('../../src/config'); // loads .env into process.env (parent process)
const { BASE, SELLER_KEY, SHOTS, playwright, startServer, MOCK, negotiateToDeal, login } = require('./lib');

const email = (process.env.E2E_PAYPAL_EMAIL || '').trim();
const password = process.env.E2E_PAYPAL_PASSWORD || '';
const shot = (page, n) => page.screenshot({ path: path.join(SHOTS, `sandbox-${n}.png`), fullPage: true });
const dash = async () => (await fetch(`${BASE}/api/seller/dashboard`, { headers: { 'x-seller-key': SELLER_KEY } })).json();

(async () => {
  if (!email || !password) throw new Error('E2E_PAYPAL_EMAIL / E2E_PAYPAL_PASSWORD not set');
  // PayPal stays live (from .env); only the AI brain is forced offline so the test is deterministic.
  const srv = await startServer({ ...MOCK, PAYPAL_CLIENT_ID: undefined, PAYPAL_CLIENT_SECRET: undefined });
  const health = await (await fetch(`${BASE}/api/health`)).json();
  if (health.paypal !== 'sandbox') throw new Error(`server is in "${health.paypal}" mode, not sandbox`);
  console.log('server PayPal mode: sandbox');

  const browser = await playwright().chromium.launch({ headless: false });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  try {
    await negotiateToDeal(page, 'Tote', '$5', '$30');
    await page.click('#pay');
    await page.waitForURL(/paypal\.com/, { timeout: 30000 });
    console.log('on PayPal sandbox page:', new URL(page.url()).hostname);
    await page.waitForLoadState('domcontentloaded');
    await shot(page, '1-paypal-landing');

    // email step (single-page or two-step login)
    const emailBox = page.locator('#email, input[name=login_email], input[type=email]').first();
    await emailBox.waitFor({ timeout: 30000 });
    await emailBox.fill(email);
    const next = page.locator('#btnNext, button:has-text("Next")').first();
    if (await next.count() && await next.isVisible()) await next.click();
    const pw = page.locator('#password, input[name=login_password], input[type=password]').first();
    await pw.waitFor({ timeout: 30000 });
    await pw.fill(password);
    await page.locator('#btnLogin, button:has-text("Log In")').first().click();
    await page.waitForLoadState('domcontentloaded');
    await shot(page, '2-after-login');

    // review page: "Complete Purchase" / "Pay Now" / "Continue"
    const pay = page.locator('#payment-submit-btn, [data-testid=submit-button-initial], button:has-text("Complete Purchase"), button:has-text("Pay Now"), button:has-text("Continue")').first();
    await pay.waitFor({ timeout: 60000 });
    await shot(page, '3-review');
    await pay.click();

    await page.waitForURL((u) => u.origin === BASE, { timeout: 90000 });
    await page.waitForSelector('#notice .notice', { timeout: 15000 });
    const notice = (await page.locator('#notice .notice').innerText()).trim();
    await shot(page, '4-return');
    const id = notice.match(/Order reference: (\w+)/)?.[1];
    const d = (await dash()).deals.find((x) => x.id === id);
    const pass = /Paid/.test(notice) && d && d.status === 'captured';
    console.log(`${pass ? 'PASS' : 'FAIL'}: notice="${notice.slice(0, 120)}" dashboardStatus=${d && d.status} totalCents=${d && d.totalCents} floorCents=${d && d.floorTotalCents}`);

    // seller dashboard shows it, then refund it
    const dp = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    dp.on('dialog', (x) => { console.log('dashboard dialog:', x.message()); x.dismiss(); });
    await login(dp); await dp.waitForSelector('#dash:not([hidden])');
    await shot(dp, '5-dashboard');
    await dp.locator('#deals tr', { hasText: 'captured' }).first().getByRole('button', { name: 'Refund' }).click();
    await dp.waitForTimeout(4000);
    const after = (await dash()).deals.find((x) => x.id === id);
    console.log(`refund: ${after && after.status === 'refunded' ? 'PASS' : 'FAIL'} (status ${after && after.status})`);
    await shot(dp, '6-refunded');
    process.exitCode = pass && after && after.status === 'refunded' ? 0 : 1;
  } catch (err) {
    await shot(page, 'stopped').catch(() => {});
    console.log(`STOPPED at ${new URL(page.url()).hostname}${new URL(page.url()).pathname}: ${String(err.message).split('\n')[0]}`);
    console.log('See e2e-screens/sandbox-stopped.png (password is never typed into screenshots; it is masked).');
    process.exitCode = 1;
  } finally {
    await browser.close(); srv.stop();
  }
})().catch((e) => { console.error(e.message); process.exit(2); });
