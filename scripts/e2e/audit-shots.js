'use strict';
// UX audit screenshots: every screen and state, 375 / 768 / 1280 px, light (and dark at 1280 and 375).
//   PW_DIR=<playwright folder> SHOT_PREFIX=ux1 node scripts/e2e/audit-shots.js
const fs = require('fs');
const path = require('path');
const { ui, SHOTS, playwright, startServer, MOCK, negotiateToDeal, login } = require('./lib');

const prefix = process.env.SHOT_PREFIX || 'ux';
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const { chromium } = playwright();
  const srv = await startServer(MOCK);
  const browser = await chromium.launch();
  let overflow = 0;
  const runs = [[1280, 'light'], [768, 'light'], [375, 'light'], [1280, 'dark'], [375, 'dark']];
  for (const [width, scheme] of runs) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const snap = async (name) => {
      await page.waitForTimeout(350);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (sw > 1) { overflow++; console.log(`OVERFLOW ${sw}px  ${width} ${scheme} ${name}`); }
      await page.screenshot({ path: path.join(SHOTS, `${prefix}-${width}-${scheme}-${name}.png`), fullPage: true });
    };
    const tag = `${width}-${scheme}`;

    await page.goto(ui('/')); await page.waitForSelector('.pcard'); await snap('01-shop');
    await negotiateToDeal(page, 'Tote', '$5', '$30'); await snap('02-chat-deal');
    await page.click('#pay'); await page.waitForURL(/mock-paypal\/approve/);
    await page.click('button[name=choice][value=approve]'); await page.waitForSelector('#notice .notice'); await snap('03-order-paid');
    await page.goto(ui('/')); await page.locator('.pcard', { hasText: 'Lamp' }).getByRole('button', { name: 'Buy now' }).click();
    await page.waitForSelector('#pay'); await snap('04-order-review');
    await page.goto(ui('/orders')); await page.getByRole('heading', { name: 'My orders' }).waitFor(); await snap('05-orders-signed-out');
    await page.getByRole('button', { name: 'Sign in with email' }).click(); await snap('06-signin-email');
    await page.fill('#buyerEmail', 'shopper@example.com'); await page.getByRole('button', { name: 'Send me a code' }).click();
    await page.getByTestId('demo-code').waitFor(); await snap('07-signin-code');
    await page.fill('#buyerCode', await page.getByTestId('demo-code').innerText());
    await page.locator('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('Signed in as').waitFor(); await snap('08-orders-empty');
    await page.goto(ui('/')); await page.locator('.pcard', { hasText: 'Tote' }).getByRole('button', { name: 'Buy now' }).click();
    await page.waitForSelector('#pay'); await page.goto(ui('/orders')); await page.getByText('Signed in as').waitFor(); await snap('09-orders-filled');
    await page.goto(ui('/nope')); await snap('10-not-found');

    await page.goto(ui('/seller')); await page.waitForSelector('#login'); await snap('11-seller-login');
    await login(page); await page.waitForSelector('#dash'); await page.waitForTimeout(900); await snap('12-console-overview');
    for (const [i, t] of ['Deals', 'Money & PayPal', 'Pricing rules', 'Insights', 'Settings'].entries()) {
      await page.getByRole('tab', { name: t }).click(); await page.waitForTimeout(900); await snap(`${13 + i}-console-${t.split(' ')[0].toLowerCase()}`);
    }
    await ctx.close();
    console.log('done', tag);
  }
  await browser.close(); srv.stop();
  console.log(overflow ? `\n${overflow} overflow(s)` : '\nno horizontal overflow');
})().catch((e) => { console.error(e); process.exit(2); });
