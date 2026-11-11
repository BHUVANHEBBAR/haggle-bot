'use strict';
/** Deal <-> PayPal orchestration. The price always comes from the stored deal, never from the browser. */
const config = require('./config');
const store = require('./store');
const real = require('./paypal');
const mock = require('./paypal-mock');

const client = () => (config.paypalLive ? real : mock);
const mode = () => client().mode;

class UserError extends Error { constructor(msg, status = 400, code) { super(msg); this.status = status; this.code = code; } }

function liveDeal(id) {
  const deal = store.getDeal(id);
  if (!deal) throw new UserError('Deal not found', 404);
  return deal;
}

function ensureOpen(deal) {
  if (['captured', 'authorized', 'refunded', 'voided'].includes(deal.status)) return;
  if (Date.now() > Date.parse(deal.expiresAt)) {
    store.updateDeal(deal, { status: 'expired' });
    throw new UserError('This price has expired. Please negotiate again.', 410, 'expired');
  }
}

// Stock changes exactly once per payment, whichever path (return from PayPal or a later webhook) completes it.
function takeStock(deal) {
  if (deal.stockTaken === true) return;
  const product = store.getProduct(deal.productId);
  if (product) { product.stock = Math.max(0, product.stock - deal.qty); store.save(); }
  deal.stockTaken = true;
}
function restoreStock(deal) {
  if (deal.stockTaken === false) return; // never taken (or already given back)
  const product = store.getProduct(deal.productId);
  if (product) { product.stock += deal.qty; store.save(); }
  deal.stockTaken = false;
}

/** The payment did not go through: the negotiated price is still valid, so the buyer can retry. */
function declined(deal, issue, debugId) {
  store.updateDeal(deal, { status: 'agreed', lastError: issue, pending: false });
  store.addTrail(deal, 'payment_declined', { issue, debugId });
  store.logEvent('payment_declined', { dealId: deal.id, issue, debugId });
  return { ok: false, declined: true, deal };
}

/** Create the PayPal order for an agreed price and return where to send the buyer. */
async function startCheckout(dealId) {
  const deal = liveDeal(dealId);
  ensureOpen(deal);
  if (['captured', 'authorized'].includes(deal.status)) throw new UserError('This deal is already paid.', 409);
  if (deal.pending) throw new UserError('PayPal is still confirming this payment. Please wait a minute and refresh.', 409, 'pending');
  if (deal.status === 'invoiced') throw new UserError('The seller has sent you a PayPal invoice for this deal. Please pay it from there.', 409, 'invoiced');
  const product = store.getProduct(deal.productId);
  if (!product || product.stock < deal.qty) throw new UserError('Sorry, this item just sold out.', 409, 'sold_out');
  // another buyer may be mid-checkout on the last unit(s): hold them for the price-hold window instead of overselling
  if (store.availableStock(product, deal.id) < deal.qty) throw new UserError('Another buyer is checking out the last one right now. Please try again in a few minutes.', 409, 'reserved');
  const attempt = (deal.attempts || 0) + 1;
  try {
    const order = await client().createOrder({
      dealId, attempt, intent: deal.payMode === 'authorize' ? 'AUTHORIZE' : 'CAPTURE',
      amountCents: deal.totalCents, currency: deal.currency, productName: deal.productName,
      qty: deal.qty, unitCents: deal.unitCents, physical: !!product.physical,
    });
    if (!order.approveUrl) throw new UserError('PayPal did not return an approval link.', 502);
    store.updateDeal(deal, { status: 'order_created', paypalOrderId: order.id, attempts: attempt });
    store.addTrail(deal, 'order_created', { orderId: order.id, debugId: order.debugId, attempt, intent: deal.payMode === 'authorize' ? 'AUTHORIZE' : 'CAPTURE' });
    return { approveUrl: order.approveUrl, orderId: order.id, mode: mode() };
  } catch (err) {
    if (err instanceof UserError) throw err;
    store.logEvent('paypal_error', { op: 'create_order', issue: err.issue, debugId: err.debugId });
    throw new UserError('Could not start PayPal checkout. Please try again.', 502);
  }
}

/** Buyer came back from PayPal: capture (or authorize) the approved order. */
async function completeReturn(dealId) {
  const deal = liveDeal(dealId);
  if (['captured', 'authorized'].includes(deal.status)) return { ok: true, deal };
  if (!deal.paypalOrderId) throw new UserError('No PayPal order for this deal.', 409);
  try {
    store.addTrail(deal, 'buyer_approved', { orderId: deal.paypalOrderId }); // PayPal sent the buyer back approved
    if (deal.payMode === 'authorize') {
      const a = await client().authorizeOrder(deal.paypalOrderId, deal.id);
      if (a.authStatus === 'DENIED') return declined(deal, 'AUTHORIZATION_DENIED', a.debugId);
      store.updateDeal(deal, { status: 'authorized', authorizationId: a.authorizationId });
      store.addTrail(deal, 'authorized', { authorizationId: a.authorizationId, debugId: a.debugId });
    } else {
      const c = await client().captureOrder(deal.paypalOrderId, deal.id);
      // the ORDER can say COMPLETED while the CAPTURE inside it is DECLINED or still PENDING: trust the capture's own status
      if (c.captureStatus === 'DECLINED' || c.captureStatus === 'FAILED') return declined(deal, `CAPTURE_${c.captureStatus}`, c.debugId);
      if (c.captureStatus === 'PENDING') {
        // money has not moved yet: keep the units reserved (order_created) and finish when PAYMENT.CAPTURE.COMPLETED arrives
        store.updateDeal(deal, { status: 'order_created', captureId: c.captureId, pending: true });
        store.addTrail(deal, 'capture_pending', { captureId: c.captureId, debugId: c.debugId });
        store.logEvent('payment_pending', { dealId: deal.id, captureId: c.captureId });
        return { ok: true, pending: true, deal };
      }
      store.updateDeal(deal, { status: 'captured', captureId: c.captureId });
      store.addTrail(deal, 'captured', { captureId: c.captureId, debugId: c.debugId });
    }
    takeStock(deal);
    store.logEvent('payment_ok', { dealId: deal.id, status: deal.status });
    return { ok: true, deal };
  } catch (err) {
    if (err.isDeclined || err.issue === 'ORDER_NOT_APPROVED') {
      return declined(deal, err.issue, err.debugId); // payment method refused
    }
    store.logEvent('paypal_error', { op: 'capture', issue: err.issue, debugId: err.debugId });
    throw new UserError('Payment could not be completed. You have not been charged.', 502);
  }
}

async function sellerCapture(dealId) {
  const deal = liveDeal(dealId);
  if (deal.status !== 'authorized') throw new UserError('Only an authorized payment can be captured.', 409);
  const c = await client().captureAuthorization(deal.authorizationId, deal.id);
  store.updateDeal(deal, { status: 'captured', captureId: c.captureId });
  store.addTrail(deal, 'captured', { captureId: c.captureId, by: 'seller', debugId: c.debugId });
  store.logEvent('seller_captured', { dealId });
  return deal;
}

async function sellerVoid(dealId) {
  const deal = liveDeal(dealId);
  if (deal.status !== 'authorized') throw new UserError('Only an authorized payment can be voided.', 409);
  await client().voidAuthorization(deal.authorizationId, deal.id);
  restoreStock(deal);
  store.updateDeal(deal, { status: 'voided' });
  store.addTrail(deal, 'voided', { authorizationId: deal.authorizationId, by: 'seller' });
  store.logEvent('seller_voided', { dealId });
  return deal;
}

async function sellerRefund(dealId) {
  const deal = liveDeal(dealId);
  if (deal.status !== 'captured' || !deal.captureId) throw new UserError('Only a captured payment can be refunded.', 409);
  const refund = await client().refundCapture(deal.captureId, deal.id, 'Refund from the seller');
  store.addTrail(deal, 'refunded', { refundId: refund.refundId, captureId: deal.captureId, by: 'seller', debugId: refund.debugId });
  restoreStock(deal);
  store.updateDeal(deal, { status: 'refunded' });
  store.logEvent('seller_refunded', { dealId });
  return deal;
}

// ---- Shipment tracking: after a physical item is paid, the seller adds a tracking number; PayPal gets it through the Orders v2 "track" call.
// Carrier codes are a short subset of PayPal's own shipment_carrier list (checked against the Orders v2 spec); OTHER takes a free name.
const CARRIERS = { USPS: 'USPS', UPS: 'UPS', FEDEX: 'FedEx', DHL: 'DHL', ROYAL_MAIL: 'Royal Mail', INDIA_POST: 'India Post', BLUEDART: 'Blue Dart', OTHER: 'Other carrier' };
const TRACKING_NO = /^[A-Za-z0-9][A-Za-z0-9 _-]{3,63}$/;
const CARRIER_NAME = /^[A-Za-z0-9][A-Za-z0-9 .&'-]{1,63}$/;

async function sellerShip(dealId, { carrier, trackingNumber, carrierName, notifyBuyer } = {}) {
  const deal = liveDeal(dealId);
  const product = store.getProduct(deal.productId);
  if (!product?.physical) throw new UserError('Only physical items are shipped; this one has nothing to track.', 409);
  if (deal.status !== 'captured' || !deal.captureId) throw new UserError('Add tracking after the payment is captured.', 409);
  if (!Object.hasOwn(CARRIERS, String(carrier))) throw new UserError('Choose a carrier from the list.', 400);
  const number = String(trackingNumber || '').trim();
  if (!TRACKING_NO.test(number)) throw new UserError('Enter the tracking number (4 to 64 letters, numbers, spaces, dashes).', 400);
  const other = carrier === 'OTHER' ? String(carrierName || '').trim() : '';
  if (carrier === 'OTHER' && !CARRIER_NAME.test(other)) throw new UserError('Name the carrier (2 to 64 characters).', 400);
  let sentToPayPal = false;
  // an invoice payment has no checkout order, so there is nothing to attach tracking to at PayPal: keep it on our side and say so
  if (deal.paypalOrderId) {
    try {
      const t = await client().addTracking({ orderId: deal.paypalOrderId, captureId: deal.captureId, trackingNumber: number, carrier, carrierOther: other, notifyPayer: !!notifyBuyer, dealId: deal.id });
      sentToPayPal = true;
      store.addTrail(deal, 'tracking_added', { captureId: deal.captureId, carrier, trackingNumber: number, sentToPayPal, by: 'seller', debugId: t.debugId });
    } catch (err) {
      store.logEvent('paypal_error', { op: 'tracking', issue: err.issue, debugId: err.debugId });
      throw new UserError(`PayPal did not accept the tracking number (${err.issue || 'error'}).`, 502);
    }
  } else {
    store.addTrail(deal, 'tracking_added', { captureId: deal.captureId, carrier, trackingNumber: number, sentToPayPal, by: 'seller' });
  }
  store.updateDeal(deal, { shipment: { carrier, carrierName: carrier === 'OTHER' ? other : CARRIERS[carrier], trackingNumber: number, sentToPayPal, at: new Date().toISOString() } });
  store.logEvent('tracking_added', { dealId: deal.id, carrier, sentToPayPal });
  return deal;
}

// ---- PayPal Invoicing: the seller invoices an agreed (or expired) deal; the buyer pays on PayPal's invoice page.
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,}$/;

async function sellerInvoice(dealId, { email, name } = {}) {
  const deal = liveDeal(dealId);
  if (!['agreed', 'expired'].includes(deal.status)) throw new UserError('Only an unpaid deal can be invoiced.', 409);
  if (!EMAIL.test(String(email || '').trim())) throw new UserError("Enter the buyer's email address.", 400);
  const product = store.getProduct(deal.productId);
  if (product && store.availableStock(product, deal.id) < deal.qty) throw new UserError('That item is no longer in stock.', 409, 'sold_out');
  const attempt = (deal.invoiceAttempts || 0) + 1;
  try {
    const inv = await client().issueInvoice({
      dealId: deal.id, attempt, email: String(email).trim(), name: name ? String(name).trim() : '', amountCents: deal.totalCents, currency: deal.currency,
      productName: deal.productName, qty: deal.qty, unitCents: deal.unitCents,
    });
    store.updateDeal(deal, { status: 'invoiced', invoiceAttempts: attempt, invoice: { id: inv.id, status: inv.status, url: inv.recipientUrl, number: inv.number, email: String(email).trim() } });
    store.addTrail(deal, 'invoice_sent', { invoiceId: inv.id, invoiceStatus: inv.status, debugId: inv.debugId });
    store.logEvent('invoice_sent', { dealId: deal.id, invoiceId: inv.id });
    return deal;
  } catch (err) {
    if (err instanceof UserError) throw err;
    store.logEvent('paypal_error', { op: 'invoice', issue: err.issue, debugId: err.debugId });
    throw new UserError(`PayPal could not create the invoice (${err.issue || 'error'}).`, 502);
  }
}

/** Ask PayPal what the invoice's state is and make our deal agree. PayPal is the source of truth; webhooks only trigger this. */
async function syncInvoice(dealId) {
  const deal = liveDeal(dealId);
  if (!deal.invoice?.id) throw new UserError('This deal has no invoice.', 409);
  const inv = await client().getInvoice(deal.invoice.id);
  deal.invoice = { ...deal.invoice, status: inv.status, url: inv.recipientUrl || deal.invoice.url };
  if (inv.status === 'PAID' && !['captured', 'refunded'].includes(deal.status)) {
    // the invoice payment is a normal PayPal payment: its id is what reconciliation and refunds use
    store.updateDeal(deal, { status: 'captured', captureId: inv.paymentId || deal.captureId || null, pending: false });
    takeStock(deal);
    store.addTrail(deal, 'invoice_paid', { invoiceId: inv.id, captureId: inv.paymentId, debugId: inv.debugId });
    store.logEvent('invoice_paid', { dealId: deal.id, invoiceId: inv.id });
  } else if (['CANCELLED', 'MARKED_AS_REFUNDED', 'REFUNDED'].includes(inv.status) && deal.status === 'invoiced') {
    store.updateDeal(deal, { status: 'agreed' });
    store.addTrail(deal, 'invoice_cancelled', { invoiceId: inv.id, invoiceStatus: inv.status, debugId: inv.debugId });
  } else {
    store.updateDeal(deal, {});
  }
  return deal;
}

async function sellerCancelInvoice(dealId) {
  const deal = liveDeal(dealId);
  if (deal.status !== 'invoiced' || !deal.invoice?.id) throw new UserError('Only an unpaid invoice can be cancelled.', 409);
  try { await client().cancelInvoice(deal.invoice.id); }
  catch (err) { throw new UserError(`PayPal did not cancel the invoice (${err.issue || 'error'}). Refresh it to see its state.`, 502); }
  return syncInvoice(dealId);
}

/** Webhook handler: verify signature, ignore duplicates, then update the deal. */
async function handleWebhook(headers, rawBody) {
  const ok = await client().verifyWebhook(headers, rawBody);
  if (!ok) {
    const reason = client().verifyWebhook.lastReason || 'bad signature';
    store.logEvent('webhook_rejected', { reason });
    console.log(`[webhook] rejected: ${reason}`); // shows in the host's application log
    return { status: 400, body: { ok: false, error: 'invalid signature' } };
  }
  let event;
  try { event = JSON.parse(rawBody); } catch { return { status: 400, body: { ok: false, error: 'bad json' } }; }
  if (!store.markWebhookSeen(event.id)) {
    store.logEvent('webhook_duplicate', { eventId: event.id, eventType: event.event_type });
    return { status: 200, body: { ok: true, duplicate: true } };
  }
  const r = event.resource || {};
  // the refund resource points at its capture through an "up" link
  const upCapture = (r.links || []).map((l) => String(l.href || '').match(/\/captures\/([A-Za-z0-9-]+)/)?.[1]).find(Boolean);
  // a dispute event names the disputed capture instead of our custom_id
  const disputedCapture = (r.disputed_transactions || []).map((t) => t.seller_transaction_id).find(Boolean);
  const invoiceId = r.invoice?.id || (String(event.event_type || '').startsWith('INVOICING.') ? r.id : null);
  const deal = store.getDeal(r.custom_id) || (invoiceId && store.state.deals.find((d) => d.invoice?.id === invoiceId)) || store.state.deals.find((d) => d.captureId === r.id || d.captureId === upCapture || (disputedCapture && d.captureId === disputedCapture)
    || d.authorizationId === r.id || d.paypalOrderId === r.id || d.paypalOrderId === r.supplementary_data?.related_ids?.order_id);
  if (deal) {
    const t = event.event_type;
    // Payments v2 reports a failed capture as DECLINED (DENIED is the older v1 name); both put the deal back to "agreed" so the buyer can retry
    if (t === 'PAYMENT.CAPTURE.COMPLETED' && deal.status !== 'refunded') { store.updateDeal(deal, { status: 'captured', captureId: deal.captureId || r.id, pending: false }); takeStock(deal); }
    else if (t === 'PAYMENT.CAPTURE.REFUNDED') store.updateDeal(deal, { status: 'refunded' });
    else if (t === 'PAYMENT.CAPTURE.REVERSED') store.updateDeal(deal, { status: 'refunded', lastError: 'CAPTURE_REVERSED' });
    else if (t === 'PAYMENT.AUTHORIZATION.VOIDED') store.updateDeal(deal, { status: 'voided' });
    else if (t === 'PAYMENT.CAPTURE.DECLINED' || t === 'PAYMENT.CAPTURE.DENIED') store.updateDeal(deal, { status: 'agreed', pending: false, lastError: t.endsWith('DECLINED') ? 'CAPTURE_DECLINED' : 'CAPTURE_DENIED' });
    // PENDING, AUTHORIZATION.CREATED and ORDER.APPROVED change nothing but are part of the money trail
    if (t.startsWith('CUSTOMER.DISPUTE.')) {
      // never acted on automatically: a dispute needs a human to review it in PayPal (accepting a claim is irreversible)
      deal.dispute = { id: r.dispute_id || null, status: r.status || null, reason: r.reason || null, updatedAt: new Date().toISOString() };
      store.addTrail(deal, 'dispute', { disputeId: r.dispute_id || null, disputeStatus: r.status || null, reason: r.reason || null, eventType: t });
      store.logEvent('dispute', { dealId: deal.id, status: r.status || null, eventType: t });
    }
    store.addTrail(deal, 'webhook', { eventId: event.id, eventType: t, verified: true });
    if (t.startsWith('INVOICING.INVOICE.') && deal.invoice?.id) {
      // never trust the payload for money: fetch the invoice from PayPal and follow what it says
      try { await syncInvoice(deal.id); } catch (err) { store.logEvent('paypal_error', { op: 'invoice_sync', issue: err.issue, debugId: err.debugId }); }
    }
  }
  store.logEvent('webhook_processed', { eventId: event.id, eventType: event.event_type, dealId: deal?.id });
  return { status: 200, body: { ok: true } };
}

mock.setWebhookSink((h, b) => handleWebhook(h, b));

module.exports = { startCheckout, completeReturn, sellerCapture, sellerVoid, sellerRefund, sellerShip, CARRIERS, sellerInvoice, sellerCancelInvoice, syncInvoice, handleWebhook, UserError, mode, client };
