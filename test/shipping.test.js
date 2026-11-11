'use strict';
// Shipment tracking: after payment the seller adds a tracking number; PayPal gets it through the Orders v2 "track" call.
process.env.PERSIST = 'false';
process.env.LLM_PROVIDER = 'mock';
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
process.env.GEMINI_API_KEY = '';
process.env.GROQ_API_KEY = '';
process.env.SELLER_KEY = 'test-key';
process.env.PORT = '0';
process.env.RATE_LIMIT_MULTIPLIER = '50';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'haggle-ship-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('../src/server');
const payments = require('../src/payments');
const store = require('../src/store');
const mock = require('../src/paypal-mock');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; process.env.BASE_URL = base; });
test.after(() => server.close());

const j = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json };
};
const seller = { 'x-seller-key': 'test-key' };

const mkDeal = (productId = 'tote') => store.createDeal({
  productId, productName: productId, qty: 1, unitCents: 4000, totalCents: 4000, listTotalCents: 4800, costTotalCents: 1800, floorTotalCents: 3600,
  currency: 'USD', payMode: 'full', messages: 0, transcript: [], source: 'negotiated',
});
async function paid(productId) {
  const d = mkDeal(productId);
  const { orderId } = await payments.startCheckout(d.id);
  mock.approve(orderId);
  await payments.completeReturn(d.id);
  assert.equal(d.status, 'captured');
  return d;
}
const good = { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' };

test('a paid physical deal can be shipped: PayPal gets the tracking, the deal and the money trail show it', async () => {
  const d = await paid();
  await payments.sellerShip(d.id, good);
  assert.equal(d.shipment.carrierName, 'UPS');
  assert.equal(d.shipment.sentToPayPal, true);
  assert.deepEqual(mock.trackerInfo(d.captureId), { orderId: d.paypalOrderId, trackingNumber: good.trackingNumber, carrier: 'UPS', carrierOther: null });
  assert.equal(d.trail.at(-1).step, 'tracking_added');
  assert.equal(d.trail.at(-1).sentToPayPal, true);
});

test('what is refused: unpaid deals, digital items, unknown carriers, bad numbers, OTHER without a name', async () => {
  const unpaid = mkDeal();
  await assert.rejects(() => payments.sellerShip(unpaid.id, good), (e) => e.status === 409);
  const digital = mkDeal('logo'); // a service, nothing to ship, even once paid
  store.updateDeal(digital, { status: 'captured', captureId: 'MOCKCAP-LOGO' });
  await assert.rejects(() => payments.sellerShip(digital.id, good), (e) => e.status === 409 && /physical/.test(e.message));
  const d = await paid();
  for (const bad of [{ ...good, carrier: 'NOPE' }, { ...good, carrier: '' }, { ...good, carrier: '__proto__' }, { ...good, trackingNumber: '' }, { ...good, trackingNumber: 'ab' }, { ...good, trackingNumber: '<script>x</script>' }, { carrier: 'OTHER', trackingNumber: 'ABC1234' }]) {
    await assert.rejects(() => payments.sellerShip(d.id, bad), (e) => e.status === 400, JSON.stringify(bad));
  }
  assert.equal(d.shipment, undefined, 'nothing was saved by the refused attempts');
  await payments.sellerShip(d.id, { carrier: 'OTHER', carrierName: 'Local Courier Co', trackingNumber: 'LC-99887' });
  assert.equal(d.shipment.carrierName, 'Local Courier Co');
  assert.equal(mock.trackerInfo(d.captureId).carrierOther, 'Local Courier Co');
});

test('a deal paid through an invoice has no checkout order: tracking is kept on our side and says so', async () => {
  const d = mkDeal();
  await payments.sellerInvoice(d.id, { email: 'buyer@example.com' });
  mock.payInvoice(d.invoice.id);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(d.status, 'captured');
  await payments.sellerShip(d.id, good);
  assert.equal(d.shipment.sentToPayPal, false);
  assert.equal(d.trail.at(-1).sentToPayPal, false);
});

test('the seller route: needs the key, validates, and the buyer-facing deal shows the shipment without leaking seller data', async () => {
  const d = await paid();
  const none = await j('POST', `/api/seller/deals/${d.id}/tracking`, good);
  assert.equal(none.status, 401);
  const bad = await j('POST', `/api/seller/deals/${d.id}/tracking`, { carrier: 'NOPE', trackingNumber: 'XYZ12345' }, seller);
  assert.equal(bad.status, 400);
  const ok = await j('POST', `/api/seller/deals/${d.id}/tracking`, good, seller);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.deal.shipment.trackingNumber, good.trackingNumber);
  const pub = await j('GET', `/api/deals/${d.id}`);
  assert.equal(pub.json.deal.shipment.carrier, 'UPS');
  assert.ok(!('floorTotalCents' in pub.json.deal) && !('costTotalCents' in pub.json.deal));
  const list = await j('GET', '/api/seller/carriers', null, seller);
  assert.ok(list.json.carriers.some((c) => c.code === 'FEDEX'));
  assert.equal((await j('GET', '/api/seller/carriers')).status, 401);
});

test('PayPal refusing the tracking (unknown capture) is reported and nothing is saved', async () => {
  const d = await paid();
  d.captureId = 'MOCKCAP-DOES-NOT-EXIST';
  await assert.rejects(() => payments.sellerShip(d.id, good), (e) => e.status === 502);
  assert.equal(d.shipment, undefined);
});
