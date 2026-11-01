'use strict';
// LIVE PayPal SANDBOX proof that PayPal is central: real purchase, then
//   reconcile (PayPal confirms the capture by its id) -> Copilot proposes a refund -> human Confirm -> real PayPal refund
//   -> reconcile again (PayPal says REFUNDED) -> money trail with real ids. Never prints credentials.
//   PW_DIR=<playwright folder> node scripts/e2e/sandbox-paypal.js     (needs E2E_PAYPAL_EMAIL / E2E_PAYPAL_PASSWORD in .env)
const path = require('path');
require('../../src/config'); // loads .env into this process
const { BASE, SELLER_KEY, SHOTS, playwright, startServer, MOCK, negotiateToDeal } = require('./lib');

const email = (process.env.E2E_PAYPAL_EMAIL || '').trim();
const password = process.env.E2E_PAYPAL_PASSWORD || '';
const seller = { 'x-seller-key': SELLER_KEY, 'content-type': 'application/json' };
const api = async (method, p, body) => { const r = await fetch(`${BASE}${p}`, { method, headers: seller, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const line = (k, v) => console.log(`${k.padEnd(34)} ${v}`);

(async () => {
  if (!email || !password) throw new Error('E2E_PAYPAL_EMAIL / E2E_PAYPAL_PASSWORD not set');
  const srv = await startServer({ ...MOCK, PAYPAL_CLIENT_ID: undefined, PAYPAL_CLIENT_SECRET: undefined }); // PayPal live from .env, AI offline for a deterministic Copilot
  const browser = await playwright().chromium.launch({ headless: false });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  try {
    const health = await (await fetch(`${BASE}/api/health`)).json();
    line('PayPal mode', health.paypal);
    if (health.paypal !== 'sandbox') throw new Error('not in sandbox mode');

    // 1. real purchase on PayPal's sandbox
    await negotiateToDeal(page, 'Tote', '$5', '$30');
    await page.click('#pay');
    await page.waitForURL(/paypal\.com/, { timeout: 30000 });
    const emailBox = page.locator('#email, input[name=login_email], input[type=email]').first();
    await emailBox.waitFor({ timeout: 30000 }); await emailBox.fill(email);
    const next = page.locator('#btnNext, button:has-text("Next")').first();
    if (await next.count() && await next.isVisible()) await next.click();
    const pw = page.locator('#password, input[name=login_password], input[type=password]').first();
    await pw.waitFor({ timeout: 30000 }); await pw.fill(password);
    await page.locator('#btnLogin, button:has-text("Log In")').first().click();
    const pay = page.locator('#payment-submit-btn, [data-testid=submit-button-initial], button:has-text("Complete Purchase"), button:has-text("Pay Now"), button:has-text("Continue")').first();
    await pay.waitFor({ timeout: 60000 }); await pay.click();
    await page.waitForURL((u) => u.origin === BASE, { timeout: 90000 });
    await page.waitForSelector('#notice .notice', { timeout: 20000 });
    const notice = (await page.locator('#notice .notice').innerText()).trim();
    const dealId = notice.match(/Order reference: (\w+)/)?.[1];
    line('order page', notice.slice(0, 60));
    if (!/Paid/.test(notice) || !dealId) throw new Error('payment did not complete');

    // 2. PayPal is the source of truth: fetch the capture by id and compare
    const rec = (await api('POST', '/api/seller/reconcile', {})).json.report;
    const row = rec.results.find((r) => r.dealId === dealId);
    line('RECONCILE result', `${row.result}: ${row.message}`);
    line('  PayPal object', `${row.paypal.kind} ${row.paypal.id} status ${row.paypal.status} $${(row.paypal.amountCents / 100).toFixed(2)}`);
    line('  PayPal debug_id', row.debugId);
    line('  summary', JSON.stringify(rec.summary));
    line('  Transaction Search', rec.account.available ? 'available' : `not available: ${rec.account.notes[0]?.slice(0, 90)}`);

    // 3. Copilot proposes (nothing happens), then a human confirms
    const cop = (await api('POST', '/api/seller/copilot', { message: 'Please refund the tote deal' })).json;
    line('COPILOT tool calls', cop.toolCalls.map((c) => `${c.tool}[${c.transport}]`).join(', '));
    const prop = cop.proposals[0];
    line('  proposal', `${prop.status}: ${prop.summary}`);
    const mid = (await api('POST', '/api/seller/reconcile', {})).json.report.results.find((r) => r.dealId === dealId);
    line('  PayPal after proposal', `${mid.paypal.status} (still not refunded)`);
    const done = await api('POST', `/api/seller/copilot/proposals/${prop.id}/confirm`, {});
    line('  Confirm', `HTTP ${done.status}, deal now ${done.json.deal?.status}`);

    // 4. PayPal says refunded; the trail has the real refund id
    const after = (await api('POST', '/api/seller/reconcile', {})).json.report.results.find((r) => r.dealId === dealId);
    line('RECONCILE after refund', `${after.result}: ${after.message}`);
    line('  PayPal says', `${after.paypal.kind} ${after.paypal.status}`);
    const deal = (await api('GET', '/api/seller/dashboard')).json.deals.find((d) => d.id === dealId);
    console.log('MONEY TRAIL (real PayPal ids):');
    for (const t of deal.trail) console.log(`  ${t.step.padEnd(16)} ${[t.orderId && `order ${t.orderId}`, t.captureId && `capture ${t.captureId}`, t.refundId && `refund ${t.refundId}`, t.eventType, t.verified && 'verified', t.debugId && `debug_id ${t.debugId}`, t.result].filter(Boolean).join(' | ')}`);

    // 5. is PayPal's remote MCP usable right now?
    const st = (await api('GET', '/api/seller/copilot/status')).json;
    line('PayPal MCP', st.mcp ? `connected=${st.mcp.connected} tools=${st.mcp.tools} executes=${st.mcp.executes}${st.mcp.error ? ` (${String(st.mcp.error).slice(0, 80)})` : ''}` : 'off');
    await page.screenshot({ path: path.join(SHOTS, 'sandbox-paypal-order.png'), fullPage: true });
    console.log('\nLIVE CHECK COMPLETE');
  } catch (err) {
    console.log(`STOPPED: ${String(err.message).split('\n')[0]}`);
    await page.screenshot({ path: path.join(SHOTS, 'sandbox-paypal-stopped.png') }).catch(() => {});
    process.exitCode = 1;
  } finally { await browser.close(); srv.stop(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
