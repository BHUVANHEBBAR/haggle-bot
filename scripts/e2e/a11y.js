'use strict';
// Accessibility audit with axe-core (WCAG 2 A/AA) on every page, light and dark.
//   PW_DIR=<folder with playwright and axe-core> node scripts/e2e/a11y.js
const path = require('path');
const { ui, BASE, playwright, startServer, MOCK, negotiateToDeal, login } = require('./lib');

(async () => {
  const axeSrc = require('fs').readFileSync(path.join(process.env.PW_DIR, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
  const srv = await startServer(MOCK);
  const browser = await playwright().chromium.launch();
  let failures = 0;
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const audit = async (name) => {
      await page.waitForTimeout(400);
      await page.evaluate(axeSrc);
      const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
      const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      const minor = res.violations.length - bad.length;
      console.log(`${bad.length ? 'FAIL' : 'ok  '} ${scheme.padEnd(5)} ${name}  serious/critical: ${bad.length}  (other: ${minor})`);
      for (const v of bad) { failures++; console.log(`      ${v.id} (${v.impact}): ${v.help}\n        e.g. ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`); }
    };
    await page.goto(ui('/')); await page.waitForSelector('.pcard'); await audit('shop');
    await negotiateToDeal(page, 'Tote', '$5', '$30'); await audit('chat + deal card');
    await page.goto(ui('/')); await page.locator('.pcard', { hasText: 'Lamp' }).getByRole('button', { name: 'Buy now' }).click();
    await page.waitForSelector('#pay'); await audit('order page (review and pay)');
    await page.goto(ui('/battle')); await page.waitForFunction(() => document.querySelector('#product option')); await audit('battle');
    await page.goto(ui('/agents')); await audit('for agents');
    await page.goto(ui('/orders')); await page.getByRole('heading', { name: 'My orders' }).waitFor(); await audit('my orders (signed out)');
    await page.getByRole('button', { name: 'Sign in with email' }).click(); await audit('buyer sign-in dialog');
    await page.keyboard.press('Escape');
    await page.goto(ui('/seller')); await page.waitForSelector('#login'); await audit('seller sign-in');
    await login(page); await page.waitForSelector('#dash:not([hidden])'); await page.waitForTimeout(1200); await audit('seller dashboard (overview)');
    for (const t of ['Deals', 'Money & PayPal', 'Pricing rules', 'Insights', 'Settings']) { await page.getByRole('tab', { name: t }).click(); await page.waitForTimeout(800); await audit('seller tab: ' + t); }
    await ctx.close();
  }
  await browser.close(); srv.stop();
  console.log(failures ? `\n${failures} serious/critical issue(s)` : '\nno serious or critical accessibility issues');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
