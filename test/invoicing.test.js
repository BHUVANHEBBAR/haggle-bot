'use strict';
// PayPal Invoicing: the seller invoices an unpaid deal, the buyer pays on PayPal's page, the deal follows what PayPal says.
process.env.PERSIST = 'false';
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const payments = require('../src/payments');
const store = require('../src/store');
const mock = require('../src/paypal-mock');
const { reconcileDeal } = require('../src/reconcile');

const mkDeal = (extra = {}) => store.createDeal({
  productId: 'tote', productName: 'Tote', qty: 1, unitCents: 4000, totalCents: 4000, listTotalCents: 4800, costTotalCents: 1800, floorTotalCents: 3600,
  currency: 'USD', payMode: 'full', messages: 0, transcript: [], source: 'negotiated', ...extra,
});
const stock = () => store.getProduct('tote').stock;
const settle = () => new Promise((r) => setTimeout(r, 30)); // the simulated PayPal delivers webhooks asynchronously

test('invoice an agreed deal: status, link, trail, and the checkout is closed while it is open', async () => {
  const d = mkDeal();
  await payments.sellerInvoice(d.id, { email: 'buyer@example.com' });
  assert.equal(d.status, 'invoiced');
  assert.match(d.invoice.url, /\/mock-paypal\/invoice\?id=MOCKINV-/);
  assert.equal(d.trail.at(-1).step, 'invoice_sent');
  await assert.rejects(() => payments.startCheckout(d.id), (e) => e.code === 'invoiced' && e.status === 409);
});

test('rejects bad emails and deals that are already paid', async () => {
  const d = mkDeal();
  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', '<x>@y.com']) await assert.rejects(() => payments.sellerInvoice(d.id, { email: bad }), (e) => e.status === 400, bad);
  const paid = mkDeal({ status: 'captured', captureId: 'CAP-X' });
  await assert.rejects(() => payments.sellerInvoice(paid.id, { email: 'a@b.com' }), (e) => e.status === 409);
});

test('an expired deal can still be invoiced (the price was agreed)', async () => {
  const d = mkDeal({ status: 'expired' });
  await payments.sellerInvoice(d.id, { email: 'late@example.com' });
  assert.equal(d.status, 'invoiced');
});

test('the buyer pays: the PAID webhook makes the deal captured, takes stock once, and reconciliation confirms it', async () => {
  const d = mkDeal();
  const before = stock();
  await payments.sellerInvoice(d.id, { email: 'buyer@example.com' });
  assert.ok(store.reservedQty('tote') >= 1, 'an unpaid invoice holds the unit');
  mock.payInvoice(d.invoice.id);
  await settle();
  assert.equal(d.status, 'captured');
  assert.match(d.captureId, /^MOCKCAP-/);
  assert.equal(stock(), before - 1);
  const steps = d.trail.map((t) => t.step);
  assert.ok(steps.includes('invoice_paid'));
  assert.ok(d.trail.some((t) => t.step === 'webhook' && t.eventType === 'INVOICING.INVOICE.PAID' && t.verified === true));
  const rec = await reconcileDeal(d, mock);
  assert.equal(rec.result, 'matched');
  assert.match(rec.message, /PayPal confirms \$40\.00 received/);
  await payments.syncInvoice(d.id); // a manual refresh afterwards changes nothing
  assert.equal(stock(), before - 1, 'stock taken exactly once');
});

test('a paid invoice can be refunded like any other payment', async () => {
  const d = mkDeal();
  const before = stock();
  await payments.sellerInvoice(d.id, { email: 'buyer@example.com' });
  mock.payInvoice(d.invoice.id);
  await settle();
  await payments.sellerRefund(d.id);
  assert.equal(d.status, 'refunded');
  assert.equal(stock(), before);
});

test('cancelling releases the deal back to agreed and the held unit; a paid invoice cannot be cancelled', async () => {
  const d = mkDeal();
  await payments.sellerInvoice(d.id, { email: 'buyer@example.com' });
  const held = store.reservedQty('tote');
  await payments.sellerCancelInvoice(d.id);
  await settle();
  assert.equal(d.status, 'agreed');
  assert.equal(store.reservedQty('tote'), held - 1);
  assert.ok(d.trail.some((t) => t.step === 'invoice_cancelled'));
  const d2 = mkDeal();
  await payments.sellerInvoice(d2.id, { email: 'b@example.com' });
  mock.payInvoice(d2.invoice.id);
  await settle();
  await assert.rejects(() => payments.sellerCancelInvoice(d2.id), (e) => e.status === 409);
});

test('webhook payload is not trusted for money: a forged PAID event for an unpaid invoice changes nothing', async () => {
  const d = mkDeal();
  await payments.sellerInvoice(d.id, { email: 'buyer@example.com' });
  const raw = JSON.stringify({ id: 'WH-FAKEPAID', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: d.invoice.id, status: 'PAID' } } });
  const r = await payments.handleWebhook(mock.signForTest(raw), raw); // validly signed, but PayPal itself says the invoice is still SENT
  assert.equal(r.status, 200);
  assert.equal(d.status, 'invoiced', 'we asked PayPal and it said the invoice is not paid');
});

test('a duplicate PAID delivery is applied once', async () => {
  const d = mkDeal();
  const before = stock();
  await payments.sellerInvoice(d.id, { email: 'buyer@example.com' });
  mock.payInvoice(d.invoice.id);
  await settle();
  const raw = JSON.stringify({ id: 'WH-DUP-INV', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: d.invoice.id } } });
  await payments.handleWebhook(mock.signForTest(raw), raw);
  const again = await payments.handleWebhook(mock.signForTest(raw), raw);
  assert.equal(again.body.duplicate, true, 'the same event id is recognised as a repeat');
  assert.equal(stock(), before - 1);
});

test('reconciliation checks an unpaid invoice against PayPal', async () => {
  const d = mkDeal();
  await payments.sellerInvoice(d.id, { email: 'buyer@example.com' });
  const rec = await reconcileDeal(d, mock);
  assert.equal(rec.result, 'matched');
  assert.match(rec.message, /invoice is SENT \(not paid yet\)/);
});
