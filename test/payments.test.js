'use strict';
// A capture has its OWN status, separate from the order's: COMPLETED, PENDING or DECLINED.
// Stock moves exactly once per payment, whichever path (the buyer's return or a later webhook) finishes it.
process.env.PERSIST = 'false';
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const payments = require('../src/payments');
const store = require('../src/store');
const mock = require('../src/paypal-mock');

const realCapture = mock.captureOrder;
test.afterEach(() => { mock.captureOrder = realCapture; });

let n = 0;
const hook = (type, resource) => {
  const raw = JSON.stringify({ id: `WH-PAY${++n}`, event_type: type, resource });
  return payments.handleWebhook(mock.signForTest(raw), raw);
};

// an approved order waiting to be captured
async function approvedDeal(qty = 1) {
  const deal = store.createDeal({
    productId: 'tote', productName: 'Tote', qty, unitCents: 4000, totalCents: 4000 * qty, listTotalCents: 4800 * qty, costTotalCents: 1800, floorTotalCents: 3600,
    currency: 'USD', payMode: 'full', messages: 0, transcript: [], source: 'negotiated',
  });
  const co = await payments.startCheckout(deal.id);
  mock.approve(co.orderId);
  return deal;
}
const stock = () => store.getProduct('tote').stock;

test('COMPLETED capture: paid, stock taken once, and a replayed webhook does not take it again', async () => {
  const d = await approvedDeal();
  const before = stock();
  const r = await payments.completeReturn(d.id);
  assert.equal(r.ok, true);
  assert.equal(d.status, 'captured');
  assert.equal(stock(), before - 1);
  await hook('PAYMENT.CAPTURE.COMPLETED', { id: d.captureId, custom_id: d.id });
  assert.equal(stock(), before - 1, 'the COMPLETED webhook after a completed return changes nothing');
});

test('DECLINED capture inside a COMPLETED order: not paid, price kept, buyer can retry, stock untouched', async () => {
  const d = await approvedDeal();
  const before = stock();
  mock.captureOrder = async () => ({ status: 'COMPLETED', captureId: 'CAP-DEC', captureStatus: 'DECLINED', debugId: 'dbg-dec' });
  const r = await payments.completeReturn(d.id);
  assert.equal(r.ok, false);
  assert.equal(r.declined, true);
  assert.equal(d.status, 'agreed', 'back to agreed so the buyer can pay again');
  assert.equal(d.lastError, 'CAPTURE_DECLINED');
  assert.equal(stock(), before, 'no stock taken for a payment that did not happen');
  const step = d.trail.find((t) => t.step === 'payment_declined');
  assert.equal(step.issue, 'CAPTURE_DECLINED');
  assert.equal(step.debugId, 'dbg-dec');
});

test('PENDING capture: not counted as paid, units stay reserved, no second payment allowed, finishes on the webhook', async () => {
  const d = await approvedDeal();
  const before = stock();
  mock.captureOrder = async () => ({ status: 'COMPLETED', captureId: 'CAP-PEND', captureStatus: 'PENDING', debugId: 'dbg-pend' });
  const r = await payments.completeReturn(d.id);
  assert.equal(r.ok, true);
  assert.equal(r.pending, true);
  assert.equal(d.status, 'order_created', 'not captured yet');
  assert.equal(d.pending, true);
  assert.equal(stock(), before, 'stock is not taken until PayPal completes the capture');
  assert.ok(store.reservedQty('tote') >= 1, 'but the unit is still held for this buyer');
  assert.ok(d.trail.some((t) => t.step === 'capture_pending' && t.captureId === 'CAP-PEND'));
  await assert.rejects(() => payments.startCheckout(d.id), (e) => e.code === 'pending' && e.status === 409, 'no double payment');

  await hook('PAYMENT.CAPTURE.COMPLETED', { id: 'CAP-PEND', custom_id: d.id });
  assert.equal(d.status, 'captured');
  assert.equal(d.pending, false);
  assert.equal(stock(), before - 1, 'stock taken when PayPal confirms');
  await hook('PAYMENT.CAPTURE.COMPLETED', { id: 'CAP-PEND', custom_id: d.id }); // PayPal retries delivery
  assert.equal(stock(), before - 1, 'exactly once');
});

test('a PENDING capture that PayPal later declines goes back to agreed, stock never taken', async () => {
  const d = await approvedDeal();
  const before = stock();
  mock.captureOrder = async () => ({ status: 'COMPLETED', captureId: 'CAP-P2', captureStatus: 'PENDING', debugId: 'x' });
  await payments.completeReturn(d.id);
  await hook('PAYMENT.CAPTURE.DECLINED', { id: 'CAP-P2', custom_id: d.id });
  assert.equal(d.status, 'agreed');
  assert.equal(d.pending, false);
  assert.equal(stock(), before);
});

test('refund gives the stock back once, and a second refund path cannot give it back twice', async () => {
  const d = await approvedDeal();
  const before = stock();
  await payments.completeReturn(d.id);
  assert.equal(stock(), before - 1);
  await payments.sellerRefund(d.id);
  assert.equal(stock(), before, 'stock back');
  assert.equal(d.status, 'refunded');
  await hook('PAYMENT.CAPTURE.REFUNDED', { id: d.captureId, custom_id: d.id });
  assert.equal(stock(), before, 'the refund webhook does not add it again');
});
