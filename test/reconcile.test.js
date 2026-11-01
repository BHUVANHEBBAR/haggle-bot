'use strict';
// Reconciliation against the REAL PayPal client code with a stubbed network (no internet needed).
process.env.PERSIST = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-id';
process.env.PAYPAL_CLIENT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const paypal = require('../src/paypal');
const { reconcileDeal, reconcileAll, accountView } = require('../src/reconcile');

const realFetch = global.fetch;
let calls = [];
let routes = {};
const resp = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'paypal-debug-id': 'dbg-test', ...headers } });
test.beforeEach(() => {
  calls = []; routes = {};
  global.fetch = async (url, opts = {}) => {
    const u = String(url); calls.push({ url: u, method: opts.method || 'GET' });
    if (u.endsWith('/v1/oauth2/token')) return resp(200, { access_token: 'tok', expires_in: 28800 });
    const hit = Object.entries(routes).find(([k]) => u.includes(k));
    return hit ? resp(hit[1].status, hit[1].body) : resp(404, { name: 'RESOURCE_NOT_FOUND', message: 'no route in test' });
  };
});
test.after(() => { global.fetch = realFetch; });

const deal = (o = {}) => ({ id: 'D1', productName: 'Tote', status: 'captured', totalCents: 4000, currency: 'USD', captureId: 'CAP1', ...o });
const capture = (value, status = 'COMPLETED', cur = 'USD') => ({ status: 200, body: { id: 'CAP1', status, amount: { currency_code: cur, value } } });

test('matched: PayPal confirms the amount, currency and status (compared in cents)', async () => {
  routes['/v2/payments/captures/CAP1'] = capture('40.00');
  const r = await reconcileDeal(deal(), paypal);
  assert.equal(r.result, 'matched');
  assert.equal(r.message, 'PayPal confirms $40.00 received');
  assert.equal(r.paypal.amountCents, 4000);
  assert.equal(r.debugId, 'dbg-test');
});

test('cents, not floats: 41.50, 0.10 and 1234.56 compare exactly', async () => {
  for (const [value, cents] of [['41.50', 4150], ['0.10', 10], ['1234.56', 123456], ['19.99', 1999]]) {
    routes['/v2/payments/captures/CAP1'] = capture(value);
    assert.equal((await reconcileDeal(deal({ totalCents: cents }), paypal)).result, 'matched', value);
  }
});

test('mismatch: PayPal received a different amount', async () => {
  routes['/v2/payments/captures/CAP1'] = capture('39.00');
  const r = await reconcileDeal(deal(), paypal);
  assert.equal(r.result, 'mismatch');
  assert.deepEqual(r.mismatches, [{ field: 'amount', ours: 4000, paypal: 3900 }]);
});

test('mismatch: refunded on PayPal but our store still says captured', async () => {
  routes['/v2/payments/captures/CAP1'] = capture('40.00', 'REFUNDED');
  const r = await reconcileDeal(deal(), paypal);
  assert.equal(r.result, 'mismatch');
  assert.deepEqual(r.mismatches, [{ field: 'status', ours: 'captured', paypal: 'REFUNDED' }]);
});

test('mismatch: wrong currency', async () => {
  routes['/v2/payments/captures/CAP1'] = capture('40.00', 'COMPLETED', 'EUR');
  assert.deepEqual((await reconcileDeal(deal(), paypal)).mismatches.map((m) => m.field), ['currency']);
});

test('a refunded deal matches a REFUNDED capture', async () => {
  routes['/v2/payments/captures/CAP1'] = capture('40.00', 'REFUNDED');
  const r = await reconcileDeal(deal({ status: 'refunded' }), paypal);
  assert.equal(r.result, 'matched');
  assert.match(r.message, /refunded/);
});

test('authorized and voided deals are checked against the authorization', async () => {
  routes['/v2/payments/authorizations/AUTH1'] = { status: 200, body: { id: 'AUTH1', status: 'CREATED', amount: { currency_code: 'USD', value: '40.00' } } };
  const held = await reconcileDeal(deal({ status: 'authorized', captureId: null, authorizationId: 'AUTH1' }), paypal);
  assert.equal(held.result, 'matched');
  assert.match(held.message, /on hold/);
  routes['/v2/payments/authorizations/AUTH1'] = { status: 200, body: { id: 'AUTH1', status: 'VOIDED', amount: { currency_code: 'USD', value: '40.00' } } };
  assert.equal((await reconcileDeal(deal({ status: 'voided', captureId: null, authorizationId: 'AUTH1' }), paypal)).result, 'matched');
  assert.equal((await reconcileDeal(deal({ status: 'authorized', captureId: null, authorizationId: 'AUTH1' }), paypal)).result, 'mismatch', 'we say held, PayPal says voided');
});

test('missing: PayPal has no such capture', async () => {
  routes['/v2/payments/captures/CAP1'] = { status: 404, body: { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] } };
  const r = await reconcileDeal(deal(), paypal);
  assert.equal(r.result, 'missing');
});

test('errors never throw: a PayPal outage becomes an error row', async () => {
  routes['/v2/payments/captures/CAP1'] = { status: 400, body: { name: 'INVALID_REQUEST', message: 'bad' } };
  const r = await reconcileDeal(deal(), paypal);
  assert.equal(r.result, 'error');
});

test('a deal with no PayPal object yet is skipped, not flagged', async () => {
  const r = await reconcileDeal(deal({ status: 'agreed', captureId: null }), paypal);
  assert.equal(r.result, 'skipped');
  assert.equal(calls.filter((c) => c.url.includes('/v2/')).length, 0, 'no network call');
});

test('summary: how much PayPal confirms received, held and refunded', async () => {
  routes['/v2/payments/captures/C-A'] = { status: 200, body: { id: 'C-A', status: 'COMPLETED', amount: { currency_code: 'USD', value: '41.50' } } };
  routes['/v2/payments/captures/C-B'] = { status: 200, body: { id: 'C-B', status: 'COMPLETED', amount: { currency_code: 'USD', value: '20.00' } } };
  routes['/v2/payments/captures/C-C'] = { status: 200, body: { id: 'C-C', status: 'REFUNDED', amount: { currency_code: 'USD', value: '10.00' } } };
  routes['/v2/payments/authorizations/A-D'] = { status: 200, body: { id: 'A-D', status: 'CREATED', amount: { currency_code: 'USD', value: '210.00' } } };
  const deals = [
    deal({ id: 'a', captureId: 'C-A', totalCents: 4150 }), deal({ id: 'b', captureId: 'C-B', totalCents: 2000 }),
    deal({ id: 'c', captureId: 'C-C', totalCents: 1000, status: 'refunded' }), deal({ id: 'd', captureId: null, authorizationId: 'A-D', totalCents: 21000, status: 'authorized' }),
    deal({ id: 'e', captureId: 'C-X', totalCents: 500 }), // PayPal has no C-X
    deal({ id: 'f', captureId: null, status: 'agreed' }),   // nothing to check
  ];
  const { results, summary } = await reconcileAll(deals, paypal);
  assert.equal(results.length, 5, 'deals without a PayPal id are left out');
  assert.deepEqual(summary, { checked: 5, matched: 4, mismatched: 0, missing: 1, errors: 0, confirmedReceivedCents: 6150, confirmedHeldCents: 21000, confirmedRefundedCents: 1000 });
});

test('account view degrades when Transaction Search is not enabled (403 NOT_AUTHORIZED)', async () => {
  routes['/v1/reporting/transactions'] = { status: 403, body: { name: 'NOT_AUTHORIZED', message: 'Authorization failed due to insufficient permissions.' } };
  routes['/v1/reporting/balances'] = { status: 403, body: { name: 'NOT_AUTHORIZED' } };
  const quiet = console.error; console.error = () => {};
  try {
    const a = await accountView(paypal);
    assert.equal(a.available, false);
    assert.equal(a.notes.length, 2);
    assert.match(a.notes[0], /Transaction Search is not enabled/);
    assert.match(a.notes[0], /Features/);
  } finally { console.error = quiet; }
});

test('account view shows transactions and balances when the permission exists', async () => {
  routes['/v1/reporting/transactions'] = { status: 200, body: { total_items: 1, transaction_details: [{ transaction_info: { transaction_id: 'TX1', transaction_status: 'S', transaction_amount: { currency_code: 'USD', value: '41.50' }, transaction_event_code: 'T0006' } }] } };
  routes['/v1/reporting/balances'] = { status: 200, body: { balances: [{ currency: 'USD', total_balance: { currency_code: 'USD', value: '5041.50' }, available_balance: { currency_code: 'USD', value: '5041.50' } }] } };
  const a = await accountView(paypal);
  assert.equal(a.available, true);
  assert.equal(a.transactions[0].amountCents, 4150);
  assert.equal(a.balances[0].totalCents, 504150);
});

test('two-way: PayPal transactions no deal explains are listed, and paid deals missing from the report are hinted', async () => {
  const deals = [
    { id: 'd1', status: 'captured', captureId: 'CAP-A', updatedAt: '2026-11-01T10:00:00Z' },
    { id: 'd2', status: 'refunded', captureId: 'CAP-B', refundId: 'REF-B', updatedAt: '2026-11-01T11:00:00Z' },
    { id: 'd3', status: 'captured', captureId: 'CAP-LATE', updatedAt: '2026-11-01T12:00:00Z' },
  ];
  const client = {
    listTransactions: async () => ({ total: 30, transactions: [
      { id: 'CAP-A', amountCents: 4150, date: '2026-11-01T09:00:00Z', status: 'S' },
      { id: 'REF-B', amountCents: -2000, date: '2026-11-01T09:30:00Z', status: 'S' },
      { id: 'CAP-B', amountCents: 2000, date: '2026-11-01T09:10:00Z', status: 'S' },
      { id: 'STRANGER', amountCents: 999, date: '2026-11-01T09:40:00Z', status: 'S', eventCode: 'T0006' },
    ] }),
    getBalances: async () => ({ balances: [{ currency: 'USD', totalCents: 100 }] }),
  };
  const v = await accountView(client, deals);
  assert.deepEqual(v.unmatched.map((t) => t.id), ['STRANGER']);
  assert.deepEqual(v.missingFromPaypal, [{ dealId: 'd3', captureId: 'CAP-LATE' }]);
  assert.ok(v.notes.some((n) => /reporting can take/i.test(n)));
  assert.ok(v.notes.some((n) => /most recent of 30/.test(n)));
});
