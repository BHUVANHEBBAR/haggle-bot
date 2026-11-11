'use strict';
/**
 * Simulated PayPal used when no sandbox credentials are configured (demo mode, tests).
 * Same interface as paypal.js, including realistic failure modes (declined instrument) and
 * signed webhooks that go through the real verification + idempotency code path.
 */
const crypto = require('crypto');
const config = require('./config');
const { PayPalError } = require('./paypal');
const { fmt } = require('./money');

const SECRET = crypto.randomBytes(16).toString('hex');
const orders = new Map();      // id -> order
const captures = new Map();    // id -> { refunded }
const auths = new Map();       // id -> { status }
const refunds = new Map();     // id -> { captureId, amountCents }
let webhookSink = null;        // set by the server: async (headers, rawBody) => void

const rid = (p) => `${p}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

function sign(rawBody, id, time) {
  return crypto.createHmac('sha256', SECRET).update(`${id}|${time}|${rawBody}`).digest('hex');
}

function emit(eventType, resource, { dup = false } = {}) {
  if (!webhookSink) return;
  const event = { id: rid('WH'), event_type: eventType, create_time: new Date().toISOString(), resource };
  const send = () => {
    const rawBody = JSON.stringify(event);
    const time = new Date().toISOString();
    const headers = { 'paypal-transmission-id': event.id, 'paypal-transmission-time': time, 'paypal-transmission-sig': sign(rawBody, event.id, time) };
    setImmediate(() => webhookSink(headers, rawBody).catch((e) => console.error("[mock webhook]", e.message)));
  };
  send();
  if (dup && config.mockDuplicateWebhooks) send(); // PayPal retries; prove we are idempotent
}

async function createOrder({ dealId, attempt = 1, intent, amountCents, currency }) {
  const id = rid('MOCKORDER');
  orders.set(id, { id, dealId, intent, amountCents, currency, status: 'CREATED', decline: false });
  return { id, status: 'PAYER_ACTION_REQUIRED', approveUrl: `${config.baseUrl}/mock-paypal/approve?token=${id}`, debugId: `mock-${attempt}` };
}

function mustOrder(id) {
  const o = orders.get(id);
  if (!o) throw new PayPalError(404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }], message: 'Order not found' });
  return o;
}

function declineCheck(o) {
  if (o.decline) throw new PayPalError(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }], message: 'The instrument presented was either declined by the processor or bank, or it can\'t be used for this payment.' }, 'mock-declined');
  if (o.status !== 'APPROVED') throw new PayPalError(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }], message: 'Payer has not approved the order.' });
}

async function captureOrder(orderId, dealId) {
  const o = mustOrder(orderId);
  if (o.status === 'COMPLETED') return o.result; // idempotent replay
  declineCheck(o);
  const captureId = rid('MOCKCAP');
  captures.set(captureId, { refunded: false, dealId, orderId, amountCents: o.amountCents, currency: o.currency, createdAt: new Date().toISOString() });
  o.status = 'COMPLETED';
  o.result = { status: 'COMPLETED', captureId, captureStatus: 'COMPLETED', debugId: 'mock' };
  emit('PAYMENT.CAPTURE.COMPLETED', { id: captureId, custom_id: dealId, status: 'COMPLETED', supplementary_data: { related_ids: { order_id: orderId } }, amount: { currency_code: o.currency, value: fmt(o.amountCents) } }, { dup: true });
  return o.result;
}

async function authorizeOrder(orderId, dealId) {
  const o = mustOrder(orderId);
  if (o.status === 'COMPLETED') return o.result;
  declineCheck(o);
  const authorizationId = rid('MOCKAUTH');
  auths.set(authorizationId, { status: 'CREATED', dealId, amountCents: o.amountCents, currency: o.currency, orderId });
  o.status = 'COMPLETED';
  o.result = { status: 'COMPLETED', authorizationId, authStatus: 'CREATED', debugId: 'mock' };
  return o.result;
}

async function captureAuthorization(authId, dealId) {
  const a = auths.get(authId);
  if (!a) throw new PayPalError(404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] });
  if (a.status !== 'CREATED') throw new PayPalError(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'AUTHORIZATION_ALREADY_CAPTURED' }], message: 'Authorization already used' });
  a.status = 'CAPTURED';
  const captureId = rid('MOCKCAP');
  captures.set(captureId, { refunded: false, dealId, orderId: a.orderId, amountCents: a.amountCents, currency: a.currency, createdAt: new Date().toISOString() });
  emit('PAYMENT.CAPTURE.COMPLETED', { id: captureId, custom_id: dealId, status: 'COMPLETED', supplementary_data: { related_ids: { order_id: a.orderId } } });
  return { captureId, captureStatus: 'COMPLETED', debugId: 'mock' };
}

async function voidAuthorization(authId, dealId) {
  const a = auths.get(authId);
  if (!a || a.status !== 'CREATED') throw new PayPalError(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'AUTHORIZATION_NOT_VOIDABLE' }] });
  a.status = 'VOIDED';
  emit('PAYMENT.AUTHORIZATION.VOIDED', { id: authId, custom_id: dealId, status: 'VOIDED' });
  return { status: 'VOIDED' };
}

async function refundCapture(captureId, dealId) {
  const c = captures.get(captureId);
  if (!c) throw new PayPalError(404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] });
  if (c.refunded) throw new PayPalError(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'CAPTURE_FULLY_REFUNDED' }], message: 'Already refunded' });
  c.refunded = true;
  const refundId = rid('MOCKREF');
  refunds.set(refundId, { captureId, amountCents: c.amountCents, currency: c.currency });
  emit('PAYMENT.CAPTURE.REFUNDED', { id: refundId, custom_id: dealId, status: 'COMPLETED', links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }] });
  return { refundId, status: 'COMPLETED', debugId: 'mock' };
}

const trackers = new Map(); // capture id -> { orderId, trackingNumber, carrier }
// Mirrors POST /v2/checkout/orders/{id}/track: the order and the capture must exist and belong together; the same tracking number is idempotent.
async function addTracking({ orderId, captureId, trackingNumber, carrier, carrierOther }) {
  const c = captures.get(captureId);
  if (!orders.get(orderId) || !c || c.orderId !== orderId) throw new PayPalError(404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] });
  trackers.set(captureId, { orderId, trackingNumber, carrier, carrierOther: carrierOther || null });
  return { ok: true, debugId: 'mock' };
}
const trackerInfo = (captureId) => trackers.get(captureId) || null;

async function verifyWebhook(headers, rawBody) {
  const id = headers['paypal-transmission-id'], time = headers['paypal-transmission-time'], sig = headers['paypal-transmission-sig'];
  if (!id || !time || !sig) return false;
  const expected = sign(rawBody, id, time);
  const a = Buffer.from(expected), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- read API (same shapes as the real client)
const notFound = () => new PayPalError(404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }], message: 'The specified resource does not exist.' }, 'mock-404');
const capView = (id, c) => ({ id, status: c.refunded ? 'REFUNDED' : 'COMPLETED', amountCents: c.amountCents, currency: c.currency, customId: c.dealId, debugId: 'mock-get' });
const authView = (id, a) => ({ id, status: a.status, amountCents: a.amountCents, currency: a.currency, customId: a.dealId, debugId: 'mock-get' });

async function getOrder(orderId) {
  const o = orders.get(orderId);
  if (!o) throw notFound();
  const cap = [...captures].filter(([, c]) => c.orderId === orderId).map(([id, c]) => ({ id, status: c.refunded ? 'REFUNDED' : 'COMPLETED', amountCents: c.amountCents, currency: c.currency }));
  const au = [...auths].filter(([, a]) => a.orderId === orderId).map(([id, a]) => ({ id, status: a.status, amountCents: a.amountCents, currency: a.currency }));
  return { id: o.id, status: o.status, intent: o.intent, amountCents: o.amountCents, currency: o.currency, customId: o.dealId, captures: cap, authorizations: au, debugId: 'mock-get' };
}
async function getCapture(id) { const c = captures.get(id); if (!c) throw notFound(); return capView(id, c); }
async function getAuthorization(id) { const a = auths.get(id); if (!a) throw notFound(); return authView(id, a); }
async function getRefund(id) { const r = refunds.get(id); if (!r) throw notFound(); return { id, status: 'COMPLETED', amountCents: r.amountCents, currency: r.currency, debugId: 'mock-get' }; }
async function listTransactions({ pageSize = 20 } = {}) {
  const tx = [...captures].map(([id, c]) => ({ id, status: 'S', amountCents: c.amountCents, currency: c.currency, date: c.createdAt, eventCode: 'T0006' })).slice(-pageSize);
  return { total: tx.length, transactions: tx, debugId: 'mock-get' };
}
async function getBalances() {
  const total = [...captures.values()].filter((c) => !c.refunded).reduce((n, c) => n + (c.amountCents || 0), 0);
  return { balances: [{ currency: 'USD', totalCents: total, availableCents: total }], debugId: 'mock-get' };
}
async function listDisputes() { return { disputes: [], debugId: 'mock-get' }; }
async function getDispute() { throw notFound(); }

// ---- simulated Invoicing (same shape as the real client; the payment page is a clearly labelled demo page)
const invoices = new Map(); // id -> invoice
const invoiceOut = (v) => ({ id: v.id, status: v.status, amountCents: v.amountCents, currency: v.currency, paidCents: v.status === 'PAID' ? v.amountCents : 0,
  paymentId: v.paymentId, number: v.number, customId: v.dealId, recipientUrl: `${config.baseUrl}/mock-paypal/invoice?id=${v.id}`, invoicerUrl: null, debugId: 'mock-invoice' });
async function issueInvoice({ dealId, email, amountCents, currency }) {
  const id = rid('MOCKINV');
  invoices.set(id, { id, dealId, email, amountCents, currency, status: 'SENT', paymentId: null, number: String(invoices.size + 1).padStart(4, '0') });
  return invoiceOut(invoices.get(id));
}
async function getInvoice(id) { const v = invoices.get(id); if (!v) throw notFound(); return invoiceOut(v); }
async function cancelInvoice(id) {
  const v = invoices.get(id); if (!v) throw notFound();
  if (v.status === 'PAID') throw new PayPalError(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'CANCELLATION_NOT_ALLOWED' }], message: 'A paid invoice cannot be cancelled.' }, 'mock-422');
  v.status = 'CANCELLED';
  emit('INVOICING.INVOICE.CANCELLED', { invoice: { id, status: 'CANCELLED' } });
  return { debugId: 'mock-invoice' };
}
/** The buyer pays on the simulated invoice page: a capture exists afterwards and PayPal sends the PAID webhook. */
function payInvoice(id) {
  const v = invoices.get(id); if (!v) throw notFound();
  if (v.status !== 'SENT') return invoiceOut(v);
  v.status = 'PAID';
  v.paymentId = rid('MOCKCAP');
  captures.set(v.paymentId, { refunded: false, dealId: v.dealId, orderId: null, amountCents: v.amountCents, currency: v.currency, createdAt: new Date().toISOString() });
  emit('INVOICING.INVOICE.PAID', { invoice: { id, status: 'PAID' } });
  return invoiceOut(v);
}
const invoiceInfo = (id) => invoices.get(id);

// ---- helpers for the simulated approval page
function approve(orderId, { decline = false } = {}) {
  const o = mustOrder(orderId);
  o.status = 'APPROVED';
  o.decline = decline;
  return o;
}
const orderInfo = (id) => orders.get(id);
function setWebhookSink(fn) { webhookSink = fn; }
function signForTest(rawBody) {
  const id = rid('WH'), time = new Date().toISOString();
  return { 'paypal-transmission-id': id, 'paypal-transmission-time': time, 'paypal-transmission-sig': sign(rawBody, id, time) };
}

module.exports = {
  mode: 'simulated', PayPalError, createOrder, captureOrder, authorizeOrder, captureAuthorization,
  voidAuthorization, refundCapture, addTracking, trackerInfo, verifyWebhook, approve, orderInfo, setWebhookSink, signForTest,
  getOrder, getCapture, getAuthorization, getRefund, listTransactions, getBalances, listDisputes, getDispute,
  issueInvoice, getInvoice, cancelInvoice, payInvoice, invoiceInfo,
};
