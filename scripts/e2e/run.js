'use strict';
// End-to-end browser flows. Usage:
//   PW_DIR=<folder with playwright> node scripts/e2e/run.js            (simulated PayPal + offline brain)
//   PW_DIR=... E2E_FLOWS=g node scripts/e2e/run.js                      (flow g: real Gemini from .env)
const fs = require('fs');
const path = require('path');
const { ui, HOME_PATH, BASE, SELLER_KEY, SHOTS, playwright, startServer, MOCK, say, openChat, negotiateToDeal, payApprove, login } = require('./lib');

const only = (process.env.E2E_FLOWS || 'a,b,c,d,e,f,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v').split(',');
const results = [];
fs.mkdirSync(SHOTS, { recursive: true });

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${process.env.SHOT_PREFIX || 'flow'}-${name}.png`), fullPage: true });
const dash = async () => (await fetch(`${BASE}/api/seller/dashboard`, { headers: { 'x-seller-key': SELLER_KEY } })).json();

const dealIdFrom = async (page) => (await page.locator('#notice .notice').innerText()).match(/Order reference: (\w+)/)?.[1];

let closeAll = async () => {}; // closes every browser context a flow opened (also releases live-feed streams)
async function flow(id, name, fn) {
  if (!only.includes(id)) return;
  const t0 = Date.now();
  try { const note = await fn(); results.push({ id, name, pass: true, note: note || '' }); }
  catch (err) { results.push({ id, name, pass: false, note: String(err.message).split('\n')[0] }); if (process.env.E2E_DEBUG) console.log(err.stack); }
  await closeAll();
  console.log(`${results.at(-1).pass ? 'PASS' : 'FAIL'}  ${id}. ${name} (${Date.now() - t0}ms) ${results.at(-1).note}`);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  const { chromium } = playwright();
  const geminiRun = only.length === 1 && only[0] === 'g';
  const srv = await startServer(geminiRun
    ? { ...MOCK, LLM_PROVIDER: process.env.E2E_PROVIDER || 'gemini', GEMINI_API_KEY: undefined, GROQ_API_KEY: undefined, GEMINI_MODEL: process.env.E2E_GEMINI_MODEL || 'gemini-3.5-flash' }
    : MOCK);
  const browser = await chromium.launch();
  const ctxs = [];
  closeAll = async () => { for (const c of ctxs.splice(0)) await c.close().catch(() => {}); };
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: Number(process.env.E2E_WIDTH || 1280), height: 900 } });
    ctxs.push(ctx);
    const page = await ctx.newPage();
    page.dialogs = [];
    page.on('dialog', (d) => { page.dialogs.push(d.message()); d.dismiss(); });
    return page;
  };
  let toteDeal;

  await flow('a', 'Shop: lowball, mid offer, accept counter, pay (simulated PayPal)', async () => {
    const page = await newPage();
    await negotiateToDeal(page, 'Tote', '$5', '$30');
    await shot(page, 'a1-deal');
    await payApprove(page);
    const notice = await page.locator('#notice .notice').innerText();
    expect(/^Paid \$/.test(notice.trim()) || /Paid/.test(notice), `no success message: ${notice}`);
    toteDeal = await dealIdFrom(page);
    await shot(page, 'a2-paid');
    const d = (await dash()).deals.find((x) => x.id === toteDeal);
    expect(d && d.status === 'captured', `dashboard status ${d && d.status}`);
    expect(d.totalCents >= d.floorTotalCents, 'deal below floor');
    const dp = await newPage(); await login(dp); await dp.waitForSelector('#dash:not([hidden])');
    expect(await dp.locator('#dealsGrid .ag-row', { hasText: 'captured' }).count() > 0, 'captured not visible on dashboard');
    await shot(dp, 'a3-dashboard');
    return `deal ${toteDeal} captured at $${(d.totalCents / 100).toFixed(2)} (floor $${(d.floorTotalCents / 100).toFixed(2)})`;
  });

  await flow('b', 'Declined card: retry path works', async () => {
    const page = await newPage();
    await negotiateToDeal(page, 'Lamp', '$10', '$100');
    await page.click('#pay');
    await page.waitForURL(/mock-paypal\/approve/);
    await page.click('button[name=choice][value=decline]');
    await page.waitForURL((u) => u.pathname === HOME_PATH);
    await page.waitForSelector('#notice .notice.bad');
    expect(/declined/i.test(await page.locator('#notice').innerText()), 'no declined message');
    await shot(page, 'b1-declined');
    await page.waitForSelector('#pay', { timeout: 5000 });
    await payApprove(page);
    expect(/Paid/.test(await page.locator('#notice .notice').innerText()), 'retry did not succeed');
    await shot(page, 'b2-retry-ok');
    return 'declined, then retried and paid';
  });

  await flow('c', 'Logo package: authorize, accept (capture), decline (void)', async () => {
    const mk = async () => {
      const page = await newPage();
      await negotiateToDeal(page, 'Logo', '$20', '$220');
      await payApprove(page);
      const txt = await page.locator('#notice .notice').innerText();
      expect(/on hold/i.test(txt), `not authorized: ${txt}`);
      return { page, id: await dealIdFrom(page) };
    };
    const d1 = await mk();
    expect((await dash()).deals.find((x) => x.id === d1.id).status === 'authorized', 'deal 1 not authorized');
    const d2 = await mk();
    const dp = await newPage(); await login(dp); await dp.waitForSelector('#dash:not([hidden])');
    await shot(dp, 'c1-authorized');
    await dp.locator('#dealsGrid .ag-row', { hasText: 'authorized' }).first().getByRole('button', { name: /Accept job/ }).click();
    await dp.waitForTimeout(800);
    const after1 = (await dash()).deals;
    const captured = after1.filter((x) => [d1.id, d2.id].includes(x.id) && x.status === 'captured');
    expect(captured.length === 1, 'accept did not capture exactly one');
    await dp.locator('#dealsGrid .ag-row', { hasText: 'authorized' }).first().getByRole('button', { name: /Decline/ }).click();
    await dp.waitForTimeout(800);
    const after2 = (await dash()).deals;
    expect(after2.filter((x) => [d1.id, d2.id].includes(x.id)).map((x) => x.status).sort().join() === 'captured,voided', `statuses: ${after2.filter((x) => [d1.id, d2.id].includes(x.id)).map((x) => x.status)}`);
    await shot(dp, 'c2-captured-voided');
    return 'one captured, one voided';
  });

  await flow('d', 'Refund from the dashboard', async () => {
    const dp = await newPage(); await login(dp); await dp.waitForSelector('#dash:not([hidden])');
    const target = (await dash()).deals.find((x) => x.status === 'captured');
    expect(target, 'no captured deal to refund (run flow a first)');
    await dp.locator('#dealsGrid .ag-row', { hasText: 'captured' }).first().getByRole('button', { name: 'Refund' }).click();
    await dp.waitForTimeout(800);
    const st = (await dash()).deals.find((x) => x.id === target.id).status;
    expect(st === 'refunded', `status ${st}`);
    await shot(dp, 'd1-refunded');
    return `deal ${target.id} refunded`;
  });

  await flow('e', 'Agent vs agent (manipulator): chips shown, nothing below floor', async () => {
    const page = await newPage();
    await page.goto(ui('/battle'));
    await page.waitForFunction(() => document.querySelector('#product option'));
    await page.selectOption('#product', 'tote');
    await page.selectOption('#persona', 'manipulator');
    await page.selectOption('#budget', '95');
    await page.click('#go');
    await page.waitForFunction(() => document.querySelector('#result')?.children.length > 0, null, { timeout: 120000 });
    const chips = await page.locator('.chip.bad').allInnerTexts();
    expect(chips.some((c) => /Manipulation attempt/.test(c)), `no manipulation chip (${chips})`);
    await shot(page, 'e1-battle');
    const d = await dash();
    const bad = d.deals.filter((x) => x.totalCents < x.floorTotalCents);
    expect(!bad.length, `${bad.length} deal(s) below floor`);
    return `${chips.length} manipulation chip(s); ${d.deals.length} deals, none below floor`;
  });

  await flow('f', 'Seller dashboard: wrong key rejected, right key opens, rule edit changes floor', async () => {
    const page = await newPage();
    await login(page, 'definitely-wrong');
    await page.waitForFunction(() => document.querySelector('#loginErr')?.textContent.length > 0);
    expect(await page.locator('#dash').isHidden(), 'dashboard opened with wrong key');
    await shot(page, 'f1-wrong-key');
    await page.fill('#key', SELLER_KEY);
    await page.getByRole('button', { name: 'Open' }).click();
    await page.waitForSelector('#dash:not([hidden])');
    const row = page.locator('#products tr', { hasText: 'Tote' });
    const floorBefore = await row.locator('td').nth(6).innerText();
    await row.locator('input[aria-label$="maxDiscountPct"]').fill('10');
    await row.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction((b) => ![...document.querySelectorAll('#products tr')].find((r) => r.textContent.includes('Tote'))?.children[6].textContent.includes(b), floorBefore);
    const floorAfter = await page.locator('#products tr', { hasText: 'Tote' }).locator('td').nth(6).innerText();
    expect(floorAfter !== floorBefore, 'floor unchanged');
    await shot(page, 'f2-rule-edit');
    await page.locator('#products tr', { hasText: 'Tote' }).locator('input[aria-label$="maxDiscountPct"]').fill('25');
    await page.locator('#products tr', { hasText: 'Tote' }).getByRole('button', { name: 'Save' }).click();
    return `floor ${floorBefore} -> ${floorAfter}`;
  });

  await flow('h', 'Dashboard safety check: runs hostile eval and shows 0 violations', async () => {
    const page = await newPage();
    await login(page); await page.waitForSelector('#dash:not([hidden])');
    await page.getByRole('button', { name: 'Run safety check' }).click();
    await page.waitForFunction(() => /simulated negotiations/.test(document.querySelector('#evalCard')?.textContent || ''), null, { timeout: 60000 });
    const txt = (await page.locator('#evalCard').innerText()).replace(/\s+/g, ' ');
    expect(/passed/.test(txt) && /0 rule violations/.test(txt), `unexpected: ${txt.slice(0, 160)}`);
    await shot(page, 'h1-safety-check');
    return txt.slice(0, 110);
  });

  await flow('i', 'Rule playground: sliders redraw the floor, nothing saved until Apply', async () => {
    const page = await newPage();
    await login(page); await page.waitForSelector('#dash:not([hidden])');
    const floor = page.getByTestId('sim-floor');
    await floor.waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('[data-testid=sim-floor]')?.textContent === '$36.00', null, { timeout: 10000 });
    await page.locator('#sl-Maximumdiscount').fill('10');
    await page.waitForFunction(() => document.querySelector('[data-testid=sim-floor]')?.textContent === '$43.20', null, { timeout: 10000 });
    expect((await dash()).products.find((p) => p.id === 'tote').floorCents === 3600, 'the playground must not save anything');
    await shot(page, 'i1-playground');
    return 'floor $36.00 -> $43.20 on the slider, nothing saved';
  });

  await flow('j', 'Live feed: a deal made in another browser shows up instantly', async () => {
    const dp = await newPage();
    await login(dp); await dp.waitForSelector('#dash:not([hidden])');
    await dp.waitForFunction(() => /live/.test(document.querySelector('#liveFeed')?.textContent || '') && !/reconnecting/.test(document.querySelector('#liveFeed')?.textContent || ''), null, { timeout: 15000 });
    const buyer = await newPage();
    await negotiateToDeal(buyer, 'Tote', '$5', '$30');
    await dp.waitForFunction(() => /New deal: Handwoven/.test(document.querySelector('#liveFeed')?.textContent || ''), null, { timeout: 10000 });
    await shot(dp, 'j1-live-feed');
    return 'deal appeared in the live feed';
  });

  await flow('k', 'Agent API: an external agent negotiates in the live console, a human pays on PayPal', async () => {
    const page = await newPage();
    await page.goto(ui('/agents'));
    await page.click('#agentStart');
    await page.waitForFunction(() => /sessions -> 200/.test(document.querySelector('#agentLog')?.textContent || ''));
    await page.click('#agentOffer');                               // the first offer is 60% of list: a counter
    await page.waitForFunction(() => /"status": "counter"/.test(document.querySelector('#agentLog')?.textContent || ''));
    await page.click('#agentOffer');                               // the agent then offers the counter price: accepted
    await page.waitForFunction(() => /"status": "accepted"/.test(document.querySelector('#agentLog')?.textContent || ''));
    await page.click('#agentCheckout');
    await page.waitForSelector('#approveLink');
    await shot(page, 'k1-agent-console');
    const href = await page.getAttribute('#approveLink', 'href');
    await page.goto(href);                                         // the human opens the link
    await page.click('button[name=choice][value=approve]');
    await page.waitForURL((u) => u.pathname.startsWith(`${HOME_PATH}order/`));
    await page.waitForSelector('#notice .notice');
    const notice = await page.locator('#notice .notice').innerText();
    expect(/Paid/.test(notice), `not paid: ${notice}`);
    const id = notice.match(/Order reference: (\w+)/)?.[1];
    const d = (await dash()).deals.find((x) => x.id === id);
    expect(d && d.status === 'captured' && d.totalCents >= d.floorTotalCents, 'deal not captured at or above floor');
    return `agent deal ${id} captured at $${(d.totalCents / 100).toFixed(2)}`;
  });

  await flow('l', 'Embeddable widget: one script tag on a separate host page, deal reported to the host, PayPal opens in a tab', async () => {
    // a separate origin plays "some other shop" that pastes the one-line snippet
    const hostHtml = `<!doctype html><title>Some other shop</title><h1>My own website</h1>
      <script>window.__events = []; window.addEventListener('haggle:deal', (e) => window.__events.push(e.detail));</script>
      <script src="${BASE}/embed.js" data-product="tote" async></script>`;
    const hostSrv = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(hostHtml); });
    await new Promise((res) => hostSrv.listen(0, res));
    const host = await newPage();
    await host.goto(`http://localhost:${hostSrv.address().port}/`);
    await host.getByRole('button', { name: 'Haggle for a better price' }).click();
    const frame = host.frameLocator('iframe[title="HaggleBot negotiation"]');
    await frame.locator('#text').waitFor({ timeout: 15000 });
    await frame.locator('#text').fill('I can pay $5');
    await frame.locator('#send').click();
    await frame.locator('#msgs .msg.seller:not(.typing)').nth(1).waitFor({ timeout: 15000 });
    await frame.locator('#text').fill('How about $45?');
    await frame.locator('#send').click();
    await frame.locator('#pay').waitFor({ timeout: 15000 });
    await host.waitForFunction(() => window.__events.length > 0, null, { timeout: 5000 });
    expect(await host.evaluate(() => window.__events[0].status) === 'agreed', 'host page was not told about the deal');
    await shot(host, 'l1-embed-widget');
    const [popup] = await Promise.all([host.waitForEvent('popup'), frame.locator('#pay').click()]);
    await popup.waitForURL(/mock-paypal\/approve/, { timeout: 15000 });
    hostSrv.close();
    return 'widget negotiated, host notified, PayPal opened in a new tab';
  });

  const orderPath = (u) => u.pathname.startsWith(`${HOME_PATH}order/`);
  const putProduct = (id, body) => fetch(`${BASE}/api/seller/products/${id}`, { method: 'PUT', headers: { 'x-seller-key': SELLER_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  await flow('m', 'Buy now without haggling: list price, review, pay, order page, dashboard shows buy_now', async () => {
    const page = await newPage();
    await page.goto(ui('/'));
    await page.locator('.pcard', { hasText: 'Tote' }).getByRole('button', { name: 'Buy now' }).click();
    await page.waitForURL(orderPath);
    await page.waitForSelector('#pay');
    expect(/Review and pay/.test(await page.locator('h1').innerText()), 'review heading');
    expect(/\$48\.00/.test(await page.locator('main').innerText()), 'list price shown');
    await shot(page, 'm1-buy-now-review');
    await page.click('#pay');
    await page.waitForURL(/mock-paypal\/approve/);
    await page.click('button[name=choice][value=approve]');
    await page.waitForURL(orderPath);
    await page.waitForSelector('#notice .notice');
    const notice = await page.locator('#notice .notice').innerText();
    expect(/Paid \$48\.00/.test(notice), `notice: ${notice}`);
    expect(/Thank you/.test(await page.locator('h1').innerText()), 'thank-you heading');
    await shot(page, 'm2-order-paid');
    const id = notice.match(/Order reference: (\w+)/)?.[1];
    const d = (await dash()).deals.find((x) => x.id === id);
    expect(d && d.source === 'buy_now' && d.status === 'captured' && d.totalCents === 4800, `dashboard: ${d && d.source} ${d && d.status}`);
    return `bought at list price, deal ${id} captured, source=${d.source}`;
  });

  await flow('n', 'Walk-away is not a dead end: buy at the last price', async () => {
    const page = await newPage();
    await openChat(page, 'Tote');
    for (const offer of ['$5', '$6', '$7', '$8', '$9', '$10']) { if (await page.locator('#text').isDisabled()) break; await say(page, `I can pay ${offer}`); }
    await page.waitForSelector('#dealBox button:has-text("Buy at the last price")', { timeout: 10000 });
    await shot(page, 'n1-walked-away');
    await page.locator('#dealBox button', { hasText: 'Buy at the last price' }).click();
    await page.waitForSelector('#pay');
    const big = await page.locator('#dealBox .big').innerText();
    const cents = Math.round(parseFloat(big.match(/\$([\d.]+)/)[1]) * 100);
    expect(cents >= 3600 && cents <= 4800, `price ${cents} must sit between the floor and list`);
    const d = (await dash()).deals.find((x) => x.totalCents === cents && x.source === 'negotiated');
    expect(d, 'a negotiated deal exists at that price');
    return `bought at the last price $${(cents / 100).toFixed(2)} after the seller walked away`;
  });

  await flow('o', 'Refresh mid-negotiation: banner offers to resume, history and price come back', async () => {
    const page = await newPage();
    await openChat(page, 'Tote');
    await say(page, 'I can pay $20');
    const priceBefore = (await page.locator('#curPrice').innerText()).trim();
    await page.reload();
    await page.waitForSelector('#resumeBanner', { timeout: 10000 });
    await shot(page, 'o1-resume-banner');
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.waitForSelector('#msgs .msg.buyer');
    expect((await page.locator('#msgs').innerText()).includes('I can pay $20'), 'earlier message is back');
    expect((await page.locator('#curPrice').innerText()).trim() === priceBefore, 'price is back');
    expect(await page.locator('#msgs .chip').count() > 0, 'guardrail chips are back');
    await say(page, 'How about $38?'); // the restored session keeps working
    return `resumed at ${priceBefore} and carried on`;
  });

  await flow('p', 'Last item: a second buyer is told it is being checked out; after payment it shows sold out', async () => {
    await putProduct('lamp', { stock: 1 });
    const a = await newPage(); const b = await newPage();
    await a.goto(ui('/'));
    await a.locator('.pcard', { hasText: 'Lamp' }).getByRole('button', { name: 'Buy now' }).click();
    await a.waitForURL(orderPath);
    await a.click('#pay');
    await a.waitForURL(/mock-paypal\/approve/); // A is now mid-checkout: the lamp is held
    await b.goto(ui('/'));
    const card = b.locator('.pcard', { hasText: 'Lamp' });
    await card.getByText('Being checked out by another buyer').waitFor({ timeout: 10000 });
    expect(await card.getByRole('button', { name: 'Buy now' }).count() === 0, 'B cannot buy the held lamp');
    const api409 = await fetch(`${BASE}/api/buy-now`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'lamp' }) });
    expect(api409.status === 409, `buy-now while held returned ${api409.status}`);
    await shot(b, 'p1-lamp-held');
    await a.click('button[name=choice][value=approve]');
    await a.waitForURL(orderPath);
    await b.reload();
    await b.locator('.pcard', { hasText: 'Lamp' }).getByText('Sold out').first().waitFor({ timeout: 10000 });
    return 'held while A paid, sold out after';
  });

  await flow('q', 'Price hold runs out: clear expired state with a way forward', async () => {
    const page = await newPage();
    await page.clock.install();
    await page.goto(ui('/'));
    await page.locator('.pcard', { hasText: 'Tote' }).getByRole('button', { name: 'Buy now' }).click();
    await page.waitForURL(orderPath);
    await page.waitForSelector('#pay');
    await page.clock.fastForward('16:00'); // the 15 minute hold has passed
    await page.getByText('Price hold ended').waitFor({ timeout: 10000 });
    expect(await page.locator('#pay').count() === 0, 'no pay button once the hold ended');
    await shot(page, 'q1-expired');
    const oldId = page.url().split('/order/')[1];
    await page.getByRole('button', { name: 'Buy at list price' }).click();
    await page.waitForURL((u) => orderPath(u) && !u.pathname.endsWith(oldId), { timeout: 10000 });
    const newId = page.url().split('/order/')[1];
    expect((await dash()).deals.some((x) => x.id === newId && x.source === 'buy_now'), 'a fresh buy-now deal was created');
    return 'expired state offered a fresh list-price order';
  });

  await flow('r', 'Network failure while sending: message is kept, Retry works, no duplicate bubble', async () => {
    const page = await newPage();
    await openChat(page, 'Tote');
    let failed = false;
    await page.route('**/api/chat/message', (route) => { if (!failed) { failed = true; route.abort(); } else route.continue(); });
    await page.fill('#text', 'I can pay $30');
    await page.click('#send');
    await page.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 10000 });
    await shot(page, 'r1-retry');
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(() => document.querySelectorAll('#msgs .msg.seller:not(.typing)').length >= 2 && !document.querySelector('#msgs .msg.seller.typing') && !/Retry/.test(document.querySelector('#msgs')?.textContent || ''));
    const buyerBubbles = await page.locator('#msgs .msg.buyer').count();
    expect(buyerBubbles === 1, `expected one buyer bubble, got ${buyerBubbles}`);
    return 'one bubble, error replaced by the real reply';
  });

  await flow('s', 'PayPal check: every payment is fetched from PayPal by its id and compared with our records', async () => {
    const buyer = await newPage(); await negotiateToDeal(buyer, 'Tote', '$5', '$30'); await payApprove(buyer);
    const page = await newPage(); await login(page); await page.waitForSelector('#dash:not([hidden])');
    await page.click('#reconcileBtn');
    await page.waitForSelector('#reconcileSummary', { timeout: 20000 });
    const summary = await page.locator('#reconcileSummary').innerText();
    expect(/PayPal confirms \$[\d.]+ received/.test(summary), `summary: ${summary}`);
    const rows = page.locator('#reconcileRows tbody tr');
    expect(await rows.count() > 0, 'rows listed');
    expect(await page.locator('#reconcileRows').getByText('mismatch').count() === 0, 'no mismatches');
    expect(await page.locator('#reconcileRows').getByText('matched').count() > 0, 'matched rows');
    await shot(page, 's1-reconcile');
    return summary.replace(/\s+/g, ' ').slice(0, 100);
  });

  await flow('t', 'Copilot: a refund is only a proposal; Confirm makes PayPal refund it; the trail records the refund id', async () => {
    const buyer = await newPage(); await negotiateToDeal(buyer, 'Tote', '$5', '$30'); await payApprove(buyer);
    const id = await dealIdFrom(buyer);
    const page = await newPage(); await login(page); await page.waitForSelector('#dash:not([hidden])');
    await page.fill('#copilotInput', 'Please refund the tote deal');
    await page.click('#copilotSend');
    await page.locator('[data-testid=proposal]').first().waitFor({ timeout: 20000 });
    expect((await dash()).deals.find((x) => x.id === id).status === 'captured', 'nothing was refunded by merely asking');
    expect(await page.locator('.toolcall').count() >= 2, 'tool calls are visible');
    const log = await page.locator('#copilotLog').innerText();
    expect(/list_deals/.test(log) && /propose_refund/.test(log), 'both tool names shown');
    expect(/Nothing happens until you press Confirm/.test(log), 'reply says it is only a proposal');
    await shot(page, 't1-copilot-proposal');
    await page.getByRole('button', { name: /Confirm refund/ }).first().click();
    let d;
    for (let i = 0; i < 25; i++) { d = (await dash()).deals.find((x) => x.id === id); if (d.status === 'refunded') break; await page.waitForTimeout(200); }
    expect(d.status === 'refunded', `status ${d.status}`);
    const step = d.trail.find((t) => t.step === 'refunded');
    expect(step && step.refundId && step.captureId === d.captureId, 'refund id from PayPal on the trail');
    await shot(page, 't2-copilot-confirmed');
    return `refund ${step.refundId} on capture ${step.captureId}, only after Confirm`;
  });

  await flow('u', 'Money trail drawer: order, capture and the signature-verified webhook with real ids', async () => {
    const page = await newPage(); await login(page); await page.waitForSelector('#dash:not([hidden])');
    await page.locator('#dealsGrid .ag-row', { hasText: /captured|refunded/ }).first().getByRole('button', { name: 'Details' }).click();
    await page.waitForSelector('#moneyTrail', { timeout: 10000 });
    const txt = await page.locator('#moneyTrail').innerText();
    expect(/Price agreed/.test(txt) && /PayPal order created/.test(txt) && /Payment captured/.test(txt), `trail: ${txt.slice(0, 160)}`);
    expect(/signature verified/.test(txt), 'verified webhook on the trail');
    expect(/capture: \w+/.test(txt) && /order: \w+/.test(txt), 'real ids shown');
    await shot(page, 'u1-money-trail');
    return 'trail shows agreed, order, capture, webhook (verified) with ids';
  });

  await flow('v', 'PayPal invoice: seller invoices an agreed deal, buyer pays on the invoice page, PayPal confirms, deal is captured', async () => {
    const buyer = await newPage(); await negotiateToDeal(buyer, 'Tote', '$5', '$30'); // agreed, not paid
    const agreed = (await dash()).deals.filter((x) => x.status === 'agreed').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    expect(agreed, 'an agreed deal exists');
    const page = await newPage(); await login(page); await page.waitForSelector('#dash:not([hidden])');
    await page.locator('#dealsGrid .ag-row[row-id="' + agreed.id + '"]').getByRole('button', { name: 'Send PayPal invoice' }).click();
    await page.fill('#invEmail', 'buyer@example.com');
    await shot(page, 'v1-invoice-form');
    await page.getByRole('button', { name: 'Send invoice' }).click();
    let d;
    for (let i = 0; i < 25; i++) { d = (await dash()).deals.find((x) => x.id === agreed.id); if (d.status === 'invoiced') break; await page.waitForTimeout(200); }
    expect(d.status === 'invoiced', 'status ' + d.status);
    const pub = (await (await fetch(BASE + '/api/deals/' + agreed.id)).json()).deal;
    expect(pub.invoice && pub.invoice.url, 'invoice link is public to the buyer');
    // the buyer pays on the invoice page (simulated here; PayPal's own sandbox page with real keys)
    const pay = await newPage(); await pay.goto(pub.invoice.url);
    await pay.getByRole('button', { name: 'Pay this invoice' }).click();
    for (let i = 0; i < 40; i++) { d = (await dash()).deals.find((x) => x.id === agreed.id); if (d.status === 'captured') break; await page.waitForTimeout(200); }
    expect(d.status === 'captured', 'status after payment ' + d.status);
    const steps = d.trail.map((t) => t.step);
    expect(steps.includes('invoice_sent') && steps.includes('invoice_paid'), 'trail ' + steps.join(','));
    const order = await newPage(); await order.goto(BASE + '/app/order/' + agreed.id);
    await order.getByText(/Payment received/).first().waitFor({ timeout: 10000 });
    await shot(order, 'v2-invoice-paid');
    return 'invoice ' + d.invoiceId + ' paid, deal captured with ' + d.captureId;
  });

  await flow('g','Real AI (E2E_PROVIDER, default gemini): UI says "answered by <provider>"', async () => {
    const page = await newPage();
    await openChat(page, 'Tote');
    await say(page, 'I can pay $30');
    const label = (await page.locator('#msgs .who').last().innerText()).trim();
    await page.waitForTimeout(500);
    const badge = (await page.locator('#badges .badge').first().innerText()).trim();
    const health = await (await fetch(`${BASE}/api/health`)).json();
    await shot(page, 'g1-gemini-label');
    expect(label === `answered by ${process.env.E2E_PROVIDER || 'gemini'}`, `label "${label}" | badge "${badge}" | lastError ${health.aiStatus && health.aiStatus.error}`);
    return `label "${label}", badge "${badge}"`;
  });

  await browser.close();
  srv.stop();
  fs.writeFileSync(path.join(SHOTS, `${process.env.SHOT_PREFIX || 'flow'}-results.json`), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - fails}/${results.length} flows passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
