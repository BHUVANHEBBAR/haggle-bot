'use strict';
/**
 * PayPal Orders v2 / Payments v2 client (SANDBOX).
 *  - access token cached and refreshed before expiry
 *  - PayPal-Request-Id on every POST (deterministic per deal + operation => safe retries)
 *  - backoff on 429/5xx, debug_id logging, typed errors (INSTRUMENT_DECLINED etc.)
 *  - webhook signature verification through PayPal's verify-webhook-signature API
 * A simulated client with the same interface lives in paypal-mock.js and is used when no
 * credentials are configured.
 */
const config = require('./config');
const { fmt, toCents } = require('./money');

class PayPalError extends Error {
  constructor(status, body, debugId) {
    const issue = body?.details?.[0]?.issue || body?.name || 'PAYPAL_ERROR';
    super(`PayPal ${status} ${issue}: ${body?.message || ''}`.trim());
    this.name = 'PayPalError';
    this.status = status;
    this.issue = issue;
    this.debugId = debugId || body?.debug_id || null;
    this.body = body;
  }
  get isDeclined() { return this.issue === 'INSTRUMENT_DECLINED' || this.issue === 'PAYER_ACTION_REQUIRED'; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tokenCache = { value: null, expiresAt: 0 };

async function getAccessToken(force = false) {
  if (!force && tokenCache.value && Date.now() < tokenCache.expiresAt - 60000) return tokenCache.value;
  const basic = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64');
  const res = await fetch(`${config.paypalApiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayPalError(res.status, body, res.headers.get('paypal-debug-id'));
  tokenCache = { value: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

async function request(method, path, { body, requestId, headers = {} } = {}, attempt = 0, refreshed = false) {
  const token = await getAccessToken();
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers };
  if (requestId) h['paypal-request-id'] = requestId;
  const res = await fetch(`${config.paypalApiBase}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const debugId = res.headers.get('paypal-debug-id');
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (res.status === 401 && !refreshed) { await getAccessToken(true); return request(method, path, { body, requestId, headers }, attempt, true); }
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await sleep(400 * 2 ** attempt + Math.random() * 200);
    return request(method, path, { body, requestId, headers }, attempt + 1, refreshed);
  }
  if (!res.ok) {
    console.error(`[paypal] ${method} ${path} -> ${res.status} debug_id=${debugId} ${data?.details?.[0]?.issue || data?.name || ''}`);
    throw new PayPalError(res.status, data, debugId);
  }
  return { ...data, _debugId: debugId };
}

const approveLink = (o) => (o.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;

async function createOrder({ dealId, attempt = 1, intent, amountCents, currency, productName, qty, unitCents, physical }) {
  const value = fmt(amountCents);
  const body = {
    intent,
    purchase_units: [{
      reference_id: dealId,
      custom_id: dealId,
      description: `Negotiated price: ${productName}`.slice(0, 127),
      amount: { currency_code: currency, value, breakdown: { item_total: { currency_code: currency, value } } },
      items: [{
        name: productName.slice(0, 127), quantity: String(qty),
        unit_amount: { currency_code: currency, value: fmt(unitCents) },
        category: physical ? 'PHYSICAL_GOODS' : 'DIGITAL_GOODS',
      }],
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'HaggleBot Demo Shop',
          user_action: 'PAY_NOW',
          shipping_preference: physical ? 'GET_FROM_FILE' : 'NO_SHIPPING',
          return_url: `${config.baseUrl}/paypal/return?deal=${dealId}`,
          cancel_url: `${config.baseUrl}/paypal/cancel?deal=${dealId}`,
        },
      },
    },
  };
  const o = await request('POST', '/v2/checkout/orders', { body, requestId: `${dealId}:create:${attempt}` });
  return { id: o.id, status: o.status, approveUrl: approveLink(o), debugId: o._debugId };
}

async function captureOrder(orderId, dealId) {
  const o = await request('POST', `/v2/checkout/orders/${orderId}/capture`, { body: {}, requestId: `${dealId}:capture:${orderId}` }); // per order: a retry after a declined card uses a NEW order, so it must not replay the old answer
  const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
  return { status: o.status, captureId: cap?.id, captureStatus: cap?.status, debugId: o._debugId };
}

async function authorizeOrder(orderId, dealId) {
  const o = await request('POST', `/v2/checkout/orders/${orderId}/authorize`, { body: {}, requestId: `${dealId}:authorize:${orderId}` });
  const a = o.purchase_units?.[0]?.payments?.authorizations?.[0];
  return { status: o.status, authorizationId: a?.id, authStatus: a?.status, debugId: o._debugId };
}

async function captureAuthorization(authId, dealId) {
  const c = await request('POST', `/v2/payments/authorizations/${authId}/capture`, { body: { final_capture: true }, requestId: `${dealId}:capture-auth:${authId}` });
  return { captureId: c.id, captureStatus: c.status, debugId: c._debugId };
}

async function voidAuthorization(authId, dealId) {
  await request('POST', `/v2/payments/authorizations/${authId}/void`, { requestId: `${dealId}:void:${authId}` });
  return { status: 'VOIDED' };
}

async function refundCapture(captureId, dealId, note) {
  const r = await request('POST', `/v2/payments/captures/${captureId}/refund`, {
    body: { note_to_payer: (note || 'Refund from HaggleBot Demo Shop').slice(0, 255) }, requestId: `${dealId}:refund:${captureId}`,
  });
  return { refundId: r.id, status: r.status, debugId: r._debugId };
}

/**
 * POST /v2/checkout/orders/{id}/track: "Adds tracking information for an Order".
 * Body (from PayPal's Orders v2 spec): capture_id, tracking_number and carrier are required;
 * carrier_name_other only when carrier is OTHER; notify_payer is optional (default false). Replies 200/201 with the order.
 */
async function addTracking({ orderId, captureId, trackingNumber, carrier, carrierOther, notifyPayer = false, dealId }) {
  const body = { capture_id: captureId, tracking_number: trackingNumber, carrier, notify_payer: !!notifyPayer };
  if (carrier === 'OTHER' && carrierOther) body.carrier_name_other = carrierOther;
  const r = await request('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/track`, { body, requestId: `${dealId}:track:${trackingNumber}` });
  return { ok: true, debugId: r._debugId };
}

// ---------- read APIs: PayPal is the source of truth for what was actually paid ----------
const cents = (a) => (a && a.value != null ? toCents(a.value) : null);
const pick = (c) => ({ id: c.id, status: c.status, amountCents: cents(c.amount), currency: c.amount?.currency_code || null });

/** Order with its captures and authorizations (GET /v2/checkout/orders/{id}). */
async function getOrder(orderId) {
  const o = await request('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  const pu = o.purchase_units?.[0] || {};
  return {
    id: o.id, status: o.status, intent: o.intent, amountCents: cents(pu.amount), currency: pu.amount?.currency_code || null,
    customId: pu.custom_id || null, captures: (pu.payments?.captures || []).map(pick), authorizations: (pu.payments?.authorizations || []).map(pick), debugId: o._debugId,
  };
}

/** GET /v2/payments/captures/{id}: status is COMPLETED, PARTIALLY_REFUNDED, REFUNDED, PENDING, DECLINED... */
async function getCapture(captureId) {
  const c = await request('GET', `/v2/payments/captures/${encodeURIComponent(captureId)}`);
  return { ...pick(c), customId: c.custom_id || null, debugId: c._debugId };
}

/** GET /v2/payments/authorizations/{id}: status is CREATED, CAPTURED, VOIDED, EXPIRED... */
async function getAuthorization(authId) {
  const a = await request('GET', `/v2/payments/authorizations/${encodeURIComponent(authId)}`);
  return { ...pick(a), customId: a.custom_id || null, debugId: a._debugId };
}

/** GET /v2/payments/refunds/{id} */
async function getRefund(refundId) {
  const r = await request('GET', `/v2/payments/refunds/${encodeURIComponent(refundId)}`);
  return { ...pick(r), debugId: r._debugId };
}

const iso = (d) => new Date(d).toISOString().replace(/\.\d+Z$/, '-0000');

/** Account-level transactions. Needs "Transaction Search" enabled on the app: a 403 NOT_AUTHORIZED means it is not. */
async function listTransactions({ startDate, endDate, pageSize = 20, page = 1 } = {}) {
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(end.getTime() - 3 * 86400000);
  const q = new URLSearchParams({ start_date: iso(start), end_date: iso(end), fields: 'all', page_size: String(pageSize), page: String(page) });
  const r = await request('GET', `/v1/reporting/transactions?${q}`);
  return {
    total: r.total_items ?? (r.transaction_details || []).length, debugId: r._debugId,
    transactions: (r.transaction_details || []).map((t) => ({
      id: t.transaction_info?.transaction_id, status: t.transaction_info?.transaction_status, amountCents: cents(t.transaction_info?.transaction_amount),
      currency: t.transaction_info?.transaction_amount?.currency_code || null, date: t.transaction_info?.transaction_initiation_date || null,
      eventCode: t.transaction_info?.transaction_event_code || null,
    })),
  };
}

/** GET /v1/reporting/balances (same Transaction Search permission). */
async function getBalances() {
  const r = await request('GET', `/v1/reporting/balances?as_of_time=${encodeURIComponent(iso(new Date()))}`);
  return { debugId: r._debugId, balances: (r.balances || []).map((b) => ({ currency: b.currency, totalCents: cents(b.total_balance), availableCents: cents(b.available_balance) })) };
}

/** Disputes (read-only). */
async function listDisputes({ pageSize = 10 } = {}) {
  const r = await request('GET', `/v1/customer/disputes?page_size=${pageSize}`);
  return { debugId: r._debugId, disputes: (r.items || []).map((d) => ({ id: d.dispute_id, status: d.status, reason: d.reason, amountCents: cents(d.dispute_amount), currency: d.dispute_amount?.currency_code || null })) };
}
async function getDispute(id) {
  const d = await request('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`);
  return { id: d.dispute_id, status: d.status, reason: d.reason, amountCents: cents(d.dispute_amount), currency: d.dispute_amount?.currency_code || null, debugId: d._debugId };
}

// ---- Invoicing v2 (shapes verified against the real sandbox: create returns 201 with status DRAFT and
// detail.metadata.recipient_view_url / invoicer_view_url; a draft can be deleted (204); links offer send and record-payment)
const invoiceView = (inv, debugId) => {
  const pay = inv.payments || {};
  const tx = (pay.transactions || [])[0] || null;
  return {
    id: inv.id, status: inv.status, amountCents: cents(inv.amount), currency: inv.amount?.currency_code || inv.detail?.currency_code || null,
    paidCents: cents(pay.paid_amount), paymentId: tx?.payment_id || null, number: inv.detail?.invoice_number || null,
    customId: inv.detail?.reference || null, recipientUrl: inv.detail?.metadata?.recipient_view_url || null,
    invoicerUrl: inv.detail?.metadata?.invoicer_view_url || null, debugId,
  };
};

/** Create a draft invoice for an agreed deal and send it. The buyer pays on PayPal's own invoice page. */
async function issueInvoice({ dealId, attempt = 1, email, name, amountCents, currency, productName, qty, unitCents, note }) {
  const num = await request('POST', '/v2/invoicing/generate-next-invoice-number');
  const exact = qty * unitCents === amountCents; // one line item whose total must equal the agreed price exactly
  const draft = await request('POST', '/v2/invoicing/invoices', {
    requestId: `${dealId}:invoice:${attempt}`, headers: { prefer: 'return=representation' },
    body: {
      detail: { invoice_number: num.invoice_number, currency_code: currency, reference: dealId, note: note || 'Agreed price from HaggleBot (sandbox)', invoice_date: new Date().toISOString().slice(0, 10) },
      primary_recipients: [{ billing_info: { email_address: email, ...(name ? { name: { given_name: String(name).slice(0, 40) } } : {}) } }],
      items: [{ name: String(productName).slice(0, 100), quantity: String(exact ? qty : 1), unit_amount: { currency_code: currency, value: fmt(exact ? unitCents : amountCents) } }],
    },
  });
  await request('POST', `/v2/invoicing/invoices/${encodeURIComponent(draft.id)}/send`, { body: { send_to_recipient: true, send_to_invoicer: false } });
  return getInvoice(draft.id);
}
async function getInvoice(id) {
  const inv = await request('GET', `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
  return invoiceView(inv, inv._debugId);
}
async function cancelInvoice(id) {
  const r = await request('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, { body: { send_to_recipient: false, send_to_invoicer: false } });
  return { debugId: r._debugId };
}

/** True only if PayPal says the signature of this webhook is valid. */
async function verifyWebhook(headers, rawBody) {
  if (!config.paypalWebhookId) return false;
  let event;
  try { event = JSON.parse(rawBody); } catch { return false; }
  const h = (k) => headers[k] || headers[k.toLowerCase()];
  try {
    const r = await request('POST', '/v1/notifications/verify-webhook-signature', {
      body: {
        auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'), transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'), webhook_id: config.paypalWebhookId, webhook_event: event,
      },
    });
    return r.verification_status === 'SUCCESS';
  } catch { return false; }
}

module.exports = {
  mode: 'sandbox', PayPalError, createOrder, captureOrder, authorizeOrder, captureAuthorization,
  voidAuthorization, refundCapture, addTracking, verifyWebhook, getAccessToken,
  getOrder, getCapture, getAuthorization, getRefund, listTransactions, getBalances, listDisputes, getDispute,
  issueInvoice, getInvoice, cancelInvoice,
};
