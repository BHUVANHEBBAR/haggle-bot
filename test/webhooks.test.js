'use strict';
// Webhook handling through the real verification + idempotency code (simulated PayPal signs the events).
process.env.PERSIST = 'false';
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const payments = require('../src/payments');
const store = require('../src/store');
const mock = require('../src/paypal-mock');

let n = 0;
const send = (type, resource, id = `WH-T${++n}`) => {
  const raw = JSON.stringify({ id, event_type: type, resource });
  return payments.handleWebhook(mock.signForTest(raw), raw);
};
const deal = (extra = {}) => store.createDeal({
  productId: 'tote', productName: 'Tote', qty: 1, unitCents: 4000, totalCents: 4000, listTotalCents: 4800, costTotalCents: 1800, floorTotalCents: 3600,
  currency: 'USD', payMode: 'full', messages: 0, transcript: [], source: 'negotiated', ...extra,
});
const steps = (d) => d.trail.map((t) => t.step);

test('PAYMENT.CAPTURE.DECLINED (Payments v2) sends the deal back to "agreed" so the buyer can retry', async () => {
  const d = deal({ status: 'captured', captureId: 'CAP-D1' });
  const r = await send('PAYMENT.CAPTURE.DECLINED', { id: 'CAP-D1', custom_id: d.id, status: 'DECLINED' });
  assert.equal(r.status, 200);
  assert.equal(d.status, 'agreed');
  assert.equal(d.lastError, 'CAPTURE_DECLINED');
});

test('the older PAYMENT.CAPTURE.DENIED name still works', async () => {
  const d = deal({ status: 'captured', captureId: 'CAP-D2' });
  await send('PAYMENT.CAPTURE.DENIED', { id: 'CAP-D2', custom_id: d.id });
  assert.equal(d.status, 'agreed');
  assert.equal(d.lastError, 'CAPTURE_DENIED');
});

test('a reversal marks the deal refunded and records why', async () => {
  const d = deal({ status: 'captured', captureId: 'CAP-R1' });
  await send('PAYMENT.CAPTURE.REVERSED', { id: 'CAP-R1', custom_id: d.id });
  assert.equal(d.status, 'refunded');
  assert.equal(d.lastError, 'CAPTURE_REVERSED');
});

test('a refund event finds the deal through the capture link when custom_id is missing', async () => {
  const d = deal({ status: 'captured', captureId: 'CAP-L1' });
  await send('PAYMENT.CAPTURE.REFUNDED', { id: 'REF-1', links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAP-L1' }] });
  assert.equal(d.status, 'refunded');
});

test('pending, authorization-created and order-approved only add to the trail', async () => {
  const d = deal({ status: 'order_created', paypalOrderId: 'ORD-9', authorizationId: 'AUTH-9' });
  await send('PAYMENT.CAPTURE.PENDING', { id: 'CAP-P', custom_id: d.id });
  await send('PAYMENT.AUTHORIZATION.CREATED', { id: 'AUTH-9' });
  await send('CHECKOUT.ORDER.APPROVED', { id: 'ORD-9' });
  assert.equal(d.status, 'order_created', 'status unchanged');
  const hooks = d.trail.filter((t) => t.step === 'webhook').map((t) => t.eventType);
  assert.deepEqual(hooks, ['PAYMENT.CAPTURE.PENDING', 'PAYMENT.AUTHORIZATION.CREATED', 'CHECKOUT.ORDER.APPROVED']);
  assert.ok(d.trail.filter((t) => t.step === 'webhook').every((t) => t.verified === true));
});

test('idempotent: the same event id twice is applied once; unknown events and unknown deals are acknowledged', async () => {
  const d = deal({ status: 'captured', captureId: 'CAP-I1' });
  await send('PAYMENT.CAPTURE.REFUNDED', { id: 'REF-I', custom_id: d.id }, 'WH-SAME');
  const before = d.trail.length;
  const again = await send('PAYMENT.CAPTURE.REFUNDED', { id: 'REF-I', custom_id: d.id }, 'WH-SAME');
  assert.equal(again.body.duplicate, true);
  assert.equal(d.trail.length, before, 'no second trail entry');
  assert.equal((await send('SOMETHING.NEW.FROM.PAYPAL', { id: 'X' })).status, 200);
  assert.equal((await send('PAYMENT.CAPTURE.COMPLETED', { id: 'NOPE', custom_id: 'no-such-deal' })).status, 200);
});

test('a forged webhook is rejected and changes nothing', async () => {
  const d = deal({ status: 'captured', captureId: 'CAP-F1' });
  const raw = JSON.stringify({ id: 'WH-FORGED', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'CAP-F1', custom_id: d.id } });
  const r = await payments.handleWebhook({ 'paypal-transmission-id': 'x', 'paypal-transmission-time': 'y', 'paypal-transmission-sig': 'z' }, raw);
  assert.equal(r.status, 400);
  assert.equal(d.status, 'captured');
});

test('the money trail starts with the agreed price', () => {
  const d = deal();
  assert.deepEqual(steps(d), ['agreed']);
  assert.equal(d.trail[0].source, 'negotiated');
});

test('a dispute is recorded on the deal and its trail, and nothing is accepted or refunded automatically', async () => {
  const d = deal({ status: 'captured', captureId: 'CAP-DS1' });
  const r = await send('CUSTOMER.DISPUTE.CREATED', {
    dispute_id: 'PP-D-1001', status: 'OPEN', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    disputed_transactions: [{ seller_transaction_id: 'CAP-DS1' }],
  });
  assert.equal(r.status, 200);
  assert.equal(d.status, 'captured', 'a dispute needs a human: the deal is not refunded or changed');
  assert.deepEqual({ id: d.dispute.id, status: d.dispute.status }, { id: 'PP-D-1001', status: 'OPEN' });
  const step = d.trail.find((t) => t.step === 'dispute');
  assert.equal(step.disputeId, 'PP-D-1001');
  assert.equal(step.reason, 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED');
  await send('CUSTOMER.DISPUTE.RESOLVED', { dispute_id: 'PP-D-1001', status: 'RESOLVED', disputed_transactions: [{ seller_transaction_id: 'CAP-DS1' }] });
  assert.equal(d.dispute.status, 'RESOLVED');
  assert.equal(d.status, 'captured');
});
