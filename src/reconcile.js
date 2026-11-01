'use strict';
/**
 * Reconciliation: PayPal is the source of truth for what was actually paid.
 * For every deal that has a PayPal object we fetch it BY ITS STORED ID (instant, needs no special permission)
 * and compare amount, currency and status with our own record. Amounts are compared in integer cents.
 * Account-level Transaction Search / balances are shown when the app has that permission, and degrade cleanly when it does not.
 */
const { usd } = require('./money');

// What PayPal should say about an object, given what our store says about the deal
const EXPECTED = {
  captured: { kind: 'capture', statuses: ['COMPLETED'] },
  refunded: { kind: 'capture', statuses: ['REFUNDED', 'PARTIALLY_REFUNDED'] },
  authorized: { kind: 'authorization', statuses: ['CREATED', 'PENDING'] },
  invoiced: { kind: 'invoice', statuses: ['SENT', 'UNPAID', 'PAYMENT_PENDING', 'VIEWED'] },
  voided: { kind: 'authorization', statuses: ['VOIDED'] },
};

async function fetchObject(deal, client) {
  // a deal that was authorized and then captured has both ids: the capture is the money that moved
  if (deal.status === 'invoiced' && deal.invoice?.id) return { kind: 'invoice', id: deal.invoice.id, data: await client.getInvoice(deal.invoice.id) };
  if (deal.captureId && ['captured', 'refunded'].includes(deal.status)) return { kind: 'capture', id: deal.captureId, data: await client.getCapture(deal.captureId) };
  if (deal.authorizationId && ['authorized', 'voided'].includes(deal.status)) return { kind: 'authorization', id: deal.authorizationId, data: await client.getAuthorization(deal.authorizationId) };
  if (deal.captureId) return { kind: 'capture', id: deal.captureId, data: await client.getCapture(deal.captureId) };
  if (deal.authorizationId) return { kind: 'authorization', id: deal.authorizationId, data: await client.getAuthorization(deal.authorizationId) };
  if (deal.paypalOrderId) return { kind: 'order', id: deal.paypalOrderId, data: await client.getOrder(deal.paypalOrderId) };
  return null;
}

const base = (deal) => ({ dealId: deal.id, productName: deal.productName, ourStatus: deal.status, ourCents: deal.totalCents, currency: deal.currency });

/** Compare one deal with PayPal. Never throws: every outcome is a result row. */
async function reconcileDeal(deal, client) {
  const row = base(deal);
  if (!deal.captureId && !deal.authorizationId && !deal.paypalOrderId && !deal.invoice?.id) return { ...row, result: 'skipped', message: 'No PayPal object yet (the buyer has not started checkout).' };
  try {
    const obj = await fetchObject(deal, client);
    const pp = obj.data;
    const mismatches = [];
    if (pp.amountCents !== deal.totalCents) mismatches.push({ field: 'amount', ours: deal.totalCents, paypal: pp.amountCents });
    if (pp.currency && pp.currency !== deal.currency) mismatches.push({ field: 'currency', ours: deal.currency, paypal: pp.currency });
    const want = EXPECTED[deal.status];
    if (want && want.kind === obj.kind && !want.statuses.includes(pp.status)) mismatches.push({ field: 'status', ours: deal.status, paypal: pp.status });
    const paypal = { kind: obj.kind, id: obj.id, status: pp.status, amountCents: pp.amountCents, currency: pp.currency };
    if (mismatches.length) return { ...row, result: 'mismatch', paypal, mismatches, debugId: pp.debugId, message: `PayPal disagrees on ${mismatches.map((m) => m.field).join(', ')}.` };
    return { ...row, result: 'matched', paypal, debugId: pp.debugId, message: matchedMessage(deal, paypal) };
  } catch (err) {
    if (err.status === 404) return { ...row, result: 'missing', debugId: err.debugId || null, message: 'PayPal has no record of this ID.' };
    return { ...row, result: 'error', debugId: err.debugId || null, message: `${err.issue || err.name || 'Error'}: ${String(err.message || '').slice(0, 140)}` };
  }
}

function matchedMessage(deal, pp) {
  if (deal.status === 'captured') return `PayPal confirms ${usd(pp.amountCents)} received`;
  if (deal.status === 'authorized') return `PayPal confirms ${usd(pp.amountCents)} is on hold (authorized)`;
  if (deal.status === 'refunded') return `PayPal confirms ${usd(pp.amountCents)} was refunded`;
  if (deal.status === 'invoiced') return `PayPal confirms the ${usd(pp.amountCents)} invoice is ${pp.status} (not paid yet)`;
  if (deal.status === 'voided') return 'PayPal confirms the hold was released';
  return `PayPal order is ${pp.status}`;
}

/** Account-level view. A 403 NOT_AUTHORIZED means Transaction Search is not enabled for the app: say so, do not fail. */
// PayPal's own ids for money that HaggleBot knows about (capture, refund, and any later invoice payment)
function knownIds(deals) {
  const ids = new Set();
  for (const d of deals || []) for (const k of ['captureId', 'refundId', 'authorizationId']) if (d[k]) ids.add(d[k]);
  return ids;
}

async function accountView(client, deals = []) {
  const out = { available: false, transactions: [], balances: [], notes: [], unmatched: [], missingFromPaypal: [] };
  const attempt = async (name, fn) => {
    try { return await fn(); } catch (err) {
      out.notes.push(err.status === 403
        ? `${name} is not enabled for this app (PayPal answered 403 NOT_AUTHORIZED). Enable "Transaction Search" in the sandbox app's Features on developer.paypal.com; it can take a while to start working.`
        : `${name} failed: ${err.issue || err.message}`);
      return null;
    }
  };
  const tx = await attempt('Transaction Search', () => client.listTransactions({ pageSize: 20 }));
  const bal = await attempt('Balances', () => client.getBalances());
  if (tx) {
    out.available = true; out.transactions = tx.transactions; out.totalTransactions = tx.total;
    // the reverse check: money PayPal shows that none of our deals explains
    const known = knownIds(deals);
    out.unmatched = tx.transactions.filter((t) => t.id && !known.has(t.id));
    // and deals we believe are paid that PayPal's report does not list (reports can lag by hours, so this is a hint, not a verdict)
    const seen = new Set(tx.transactions.map((t) => t.id));
    const oldest = tx.transactions.reduce((m, t) => (t.date && (!m || t.date < m) ? t.date : m), null);
    out.missingFromPaypal = (deals || []).filter((d) => d.captureId && ['captured', 'refunded'].includes(d.status) && !seen.has(d.captureId)
      && (!oldest || (d.updatedAt || d.createdAt || '') >= oldest)).map((d) => ({ dealId: d.id, captureId: d.captureId }));
    if (out.missingFromPaypal.length) out.notes.push('Some paid deals are not in the Transaction Search page yet. PayPal reporting can take a few hours to show new transactions, so this is a hint, not an error.');
    if (tx.total > tx.transactions.length) out.notes.push(`Showing the ${tx.transactions.length} most recent of ${tx.total} transactions.`);
  }
  if (bal) { out.available = true; out.balances = bal.balances; }
  return out;
}

/** Reconcile every deal that has a PayPal object, a few at a time, and summarise. */
async function reconcileAll(deals, client, { concurrency = 3 } = {}) {
  const list = deals.filter((d) => d.captureId || d.authorizationId || d.paypalOrderId);
  const results = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (next < list.length) { const i = next++; results[i] = await reconcileDeal(list[i], client); }
  }));
  const count = (r) => results.filter((x) => x.result === r).length;
  const sum = (status) => results.filter((x) => x.result === 'matched' && x.ourStatus === status).reduce((n, x) => n + x.paypal.amountCents, 0);
  return {
    results,
    summary: {
      checked: results.length, matched: count('matched'), mismatched: count('mismatch'), missing: count('missing'), errors: count('error'),
      confirmedReceivedCents: sum('captured'), confirmedHeldCents: sum('authorized'), confirmedRefundedCents: sum('refunded'),
    },
  };
}

module.exports = { reconcileDeal, reconcileAll, accountView };
