'use strict';
// Screenshots of every page at 1280px and 375px, plus a no-horizontal-scroll check.
//   PW_DIR=<playwright folder> SHOT_PREFIX=before node scripts/e2e/shots.js
const fs = require('fs');
const path = require('path');
const { ui, BASE, SHOTS, playwright, startServer, MOCK, negotiateToDeal, login } = require('./lib');

const prefix = process.env.SHOT_PREFIX || 'shot';
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const { chromium } = playwright();
  const srv = await startServer(MOCK);
  const browser = await chromium.launch();
  let overflow = 0;
  for (const width of [1280, 375]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss());
    const snap = async (name) => {
      await page.waitForTimeout(250);
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      const bad = sw[0] > sw[1];
      if (bad) overflow++;
      console.log(`${bad ? 'OVERFLOW' : 'ok      '} ${width}px ${name} (scrollWidth ${sw[0]})`);
      await page.screenshot({ path: path.join(SHOTS, `${prefix}-${width}-${name}.png`), fullPage: true });
    };

    await page.goto(ui('/')); await page.waitForSelector('.pcard'); await snap('shop');
    await negotiateToDeal(page, 'Tote', '$5', '$30'); await snap('chat-deal');
    await page.click('#pay'); await page.waitForURL(/mock-paypal\/approve/); await snap('mock-approve');

    await page.goto(ui('/battle'));
    await page.waitForFunction(() => document.querySelector('#product option'));
    await snap('battle-idle');
    await page.selectOption('#persona', 'manipulator'); await page.selectOption('#budget', '95');
    await page.click('#go');
    await page.waitForFunction(() => document.querySelector('#result')?.children.length > 0, null, { timeout: 120000 });
    await snap('battle-done');

    await page.goto(ui('/seller')); await snap('seller-login');
    await login(page); await page.waitForSelector('#dash:not([hidden])'); await snap('seller-dashboard');
    await ctx.close();
  }
  await browser.close();
  srv.stop();
  console.log(overflow ? `\n${overflow} page(s) overflow horizontally` : '\nno horizontal overflow');
  process.exit(overflow ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
