'use strict';
// Exercises the REAL PayPal and LLM client code against a stubbed network (no internet needed).
process.env.PERSIST = 'false';
process.env.LLM_RETRY_DELAY_MS = '0';   // keep retries instant in tests
process.env.LLM_COOLDOWN_MS = '0';      // circuit breaker has its own test file
process.env.PAYPAL_CLIENT_ID = 'test-id';
process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
process.env.PAYPAL_WEBHOOK_ID = 'WH-TEST';
process.env.GEMINI_API_KEY = 'gem-key';
process.env.GROQ_API_KEY = '';
process.env.LLM_PROVIDER = 'gemini';

const test = require('node:test');
const assert = require('node:assert/strict');
const paypal = require('../src/paypal');
const llm = require('../src/llm');

const realFetch = global.fetch;
let calls = [];
let handler = () => ({ status: 200, body: {} });
const resp = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
test.beforeEach(() => {
  calls = [];
  global.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); const r = handler(String(url), opts, calls.length); return resp(r.status, r.body, r.headers); };
});
test.after(() => { global.fetch = realFetch; });

const tokenReply = { status: 200, body: { access_token: 'tok', expires_in: 28800 } };

test('createOrder sends the right body, auth and idempotency key; token is cached', async () => {
  handler = (url) => url.endsWith('/v1/oauth2/token') ? tokenReply
    : { status: 201, body: { id: 'ORD1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://sandbox.paypal.com/x' }] } };
  const o = await paypal.createOrder({ dealId: 'deal1', intent: 'CAPTURE', amountCents: 7800, currency: 'USD', productName: 'Tote', qty: 2, unitCents: 3900, physical: true });
  assert.equal(o.approveUrl, 'https://sandbox.paypal.com/x');
  const orderCall = calls.find((c) => c.url.endsWith('/v2/checkout/orders'));
  assert.ok(orderCall.url.startsWith('https://api-m.sandbox.paypal.com'));
  assert.equal(orderCall.opts.headers.authorization, 'Bearer tok');
  assert.equal(orderCall.opts.headers['paypal-request-id'], 'deal1:create:1');
  const body = JSON.parse(orderCall.opts.body);
  assert.equal(body.intent, 'CAPTURE');
  assert.equal(body.purchase_units[0].amount.value, '78.00');
  assert.equal(body.purchase_units[0].items[0].unit_amount.value, '39.00');
  assert.equal(body.purchase_units[0].custom_id, 'deal1');
  assert.equal(body.payment_source.paypal.experience_context.shipping_preference, 'GET_FROM_FILE');
  // second call must reuse the cached token
  await paypal.createOrder({ dealId: 'deal2', intent: 'AUTHORIZE', amountCents: 100, currency: 'USD', productName: 'X', qty: 1, unitCents: 100, physical: false });
  assert.equal(calls.filter((c) => c.url.endsWith('/v1/oauth2/token')).length, 1, 'token fetched only once for two orders');
});

test('declined capture surfaces as INSTRUMENT_DECLINED with the debug id', async () => {
  handler = (url) => url.includes('/capture')
    ? { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }], message: 'declined' }, headers: { 'paypal-debug-id': 'dbg123' } }
    : tokenReply;
  await assert.rejects(() => paypal.captureOrder('ORD1', 'deal1'), (e) => e.isDeclined && e.debugId === 'dbg123' && e.status === 422);
});

test('429 is retried with backoff and then succeeds', async () => {
  let n = 0;
  handler = (url) => {
    if (url.includes('/refund')) { n++; return n < 2 ? { status: 429, body: {} } : { status: 201, body: { id: 'R1', status: 'COMPLETED' } }; }
    return tokenReply;
  };
  const r = await paypal.refundCapture('CAP1', 'deal1', 'sorry');
  assert.equal(r.refundId, 'R1');
  assert.equal(n, 2);
  const refundCalls = calls.filter((c) => c.url.includes('/refund'));
  assert.equal(refundCalls[0].opts.headers['paypal-request-id'], refundCalls[1].opts.headers['paypal-request-id'], 'retry reuses the same idempotency key');
});

test('webhook verification calls PayPal and trusts only SUCCESS', async () => {
  const headers = { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://x', 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': 'now' };
  handler = (url) => url.includes('verify-webhook-signature') ? { status: 200, body: { verification_status: 'SUCCESS' } } : tokenReply;
  assert.equal(await paypal.verifyWebhook(headers, JSON.stringify({ id: 'E1' })), true);
  const sent = JSON.parse(calls.find((c) => c.url.includes('verify-webhook-signature')).opts.body);
  assert.equal(sent.webhook_id, 'WH-TEST');
  handler = (url) => url.includes('verify-webhook-signature') ? { status: 200, body: { verification_status: 'FAILURE' } } : tokenReply;
  assert.equal(await paypal.verifyWebhook(headers, JSON.stringify({ id: 'E1' })), false);
  assert.equal(await paypal.verifyWebhook(headers, 'not json'), false);
});

test('Gemini client sends the key in a header and parses JSON; falls back to mock on failure', async () => {
  handler = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: '{"price": 41.5, "message": "Sure, $41.50."}' }] } }] } });
  let r = await llm.completeJson({ system: 's', user: 'u', meta: { task: 'seller', action: 'chat', priceCents: 4800, productName: 'Tote' } });
  assert.equal(r.provider, 'gemini');
  assert.equal(r.json.price, 41.5);
  const c = calls.at(-1);
  assert.equal(c.opts.headers['x-goog-api-key'], 'gem-key');
  assert.ok(!c.url.includes('gem-key'), 'key must not be in the URL');

  assert.equal(llm.status().provider, 'gemini');
  assert.equal(llm.status().fellBack, false);
  assert.equal(llm.status().error, null);

  // failure: Google's error message is surfaced, a warning is logged (never with the key), status records the fallback
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    handler = () => ({ status: 503, body: { error: { code: 503, message: 'model overloaded', status: 'UNAVAILABLE' } } });
    r = await llm.completeJson({ system: 's', user: 'u', meta: { task: 'seller', action: 'chat', priceCents: 4800, productName: 'Tote', round: 0 } });
  } finally { console.warn = realWarn; }
  assert.equal(r.provider, 'mock');
  assert.equal(r.fellBack, true);
  assert.match(r.error, /Gemini HTTP 503: model overloaded/);
  assert.ok(warnings.some((w) => w.includes('[ai] gemini failed') && w.includes('model overloaded')), 'provider failure is logged');
  assert.ok(warnings.some((w) => w.includes('[ai] fell back to mock')), 'fallback is logged');
  assert.ok(!warnings.join('\n').includes('gem-key'), 'key never logged');
  const st = llm.status();
  assert.equal(st.provider, 'mock');
  assert.equal(st.fellBack, true);
  assert.match(st.error, /model overloaded/);

  handler = () => ({ status: 429, body: {} });
  console.warn = () => {};
  try { r = await llm.completeJson({ system: 's', user: 'u', meta: { task: 'seller', action: 'chat', priceCents: 4800, productName: 'Tote', round: 0 } }); }
  finally { console.warn = realWarn; }
  assert.equal(r.provider, 'mock');
  assert.equal(r.fellBack, true);
  assert.match(r.error, /Gemini HTTP 429/);

  handler = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'sorry, no json here' }] } }] } });
  console.warn = () => {};
  try { r = await llm.completeJson({ system: 's', user: 'u', meta: { task: 'seller', action: 'chat', priceCents: 4800, productName: 'Tote', round: 0 } }); }
  finally { console.warn = realWarn; }
  assert.equal(r.provider, 'mock');
});

test('idempotency keys are per PayPal object: a retry on a NEW order never replays an old capture', async () => {
  handler = (url) => (url.endsWith('/v1/oauth2/token') ? tokenReply
    : { status: 201, body: { status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'C', status: 'COMPLETED' }], authorizations: [{ id: 'A', status: 'CREATED' }] } }] } });
  await paypal.captureOrder('ORD-A', 'deal9');   // first attempt (say it was declined)
  await paypal.captureOrder('ORD-B', 'deal9');   // buyer retries: a NEW order for the same deal
  await paypal.captureOrder('ORD-A', 'deal9');   // a network retry of the first call
  await paypal.authorizeOrder('ORD-B', 'deal9');
  await paypal.captureAuthorization('AUTH-1', 'deal9');
  await paypal.voidAuthorization('AUTH-2', 'deal9');
  await paypal.refundCapture('CAP-1', 'deal9', 'x');
  const ids = calls.filter((c) => c.opts.method === 'POST' && !c.url.endsWith('/token')).map((c) => c.opts.headers['paypal-request-id']);
  assert.deepEqual(ids, ['deal9:capture:ORD-A', 'deal9:capture:ORD-B', 'deal9:capture:ORD-A', 'deal9:authorize:ORD-B', 'deal9:capture-auth:AUTH-1', 'deal9:void:AUTH-2', 'deal9:refund:CAP-1']);
  assert.equal(ids[0], ids[2], 'the same call retried keeps the same key (safe retry)');
  assert.notEqual(ids[0], ids[1], 'a different order gets a different key');
});

test('invoice client: creates the draft with an idempotency key, sends it, and returns the buyer link from PayPal', async () => {
  handler = (url) => {
    if (url.endsWith('/v1/oauth2/token')) return tokenReply;
    if (url.endsWith('/generate-next-invoice-number')) return { status: 200, body: { invoice_number: '0007' } };
    if (url.endsWith('/v2/invoicing/invoices')) return { status: 201, body: { id: 'INV2-AAAA', status: 'DRAFT' } };
    if (url.endsWith('/send')) return { status: 200, body: {} };
    return { status: 200, body: { id: 'INV2-AAAA', status: 'SENT', amount: { currency_code: 'USD', value: '78.00' }, detail: { invoice_number: '0007', reference: 'deal5', metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#AAAA' } } } };
  };
  const inv = await paypal.issueInvoice({ dealId: 'deal5', email: 'b@example.com', amountCents: 7800, currency: 'USD', productName: 'Tote', qty: 2, unitCents: 3900 });
  assert.equal(inv.recipientUrl, 'https://www.sandbox.paypal.com/invoice/p/#AAAA');
  assert.equal(inv.amountCents, 7800);
  const create = calls.find((c) => c.url.endsWith('/v2/invoicing/invoices') && c.opts.method === 'POST');
  assert.equal(create.opts.headers['paypal-request-id'], 'deal5:invoice:1');
  const body = JSON.parse(create.opts.body);
  assert.equal(body.items[0].quantity, '2');
  assert.equal(body.items[0].unit_amount.value, '39.00');
  assert.equal(body.detail.reference, 'deal5');
  assert.ok(calls.some((c) => c.url.endsWith('/send')), 'invoice was sent');
  // an uneven total becomes one line item of the exact agreed amount
  await paypal.issueInvoice({ dealId: 'deal6', email: 'b@example.com', amountCents: 7801, currency: 'USD', productName: 'Tote', qty: 2, unitCents: 3900 });
  const odd = JSON.parse(calls.filter((c) => c.url.endsWith('/v2/invoicing/invoices') && c.opts.method === 'POST').at(-1).opts.body);
  assert.equal(odd.items[0].quantity, '1');
  assert.equal(odd.items[0].unit_amount.value, '78.01');
});
