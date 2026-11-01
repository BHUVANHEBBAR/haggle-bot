'use strict';
/**
 * Money actions proposed by the Copilot. A proposal is only a description of what WOULD happen.
 * It runs only when the seller confirms it in the dashboard, through our own payment code
 * (src/payments.js), and only once, only while it is fresh, and only if the deal has not changed.
 * The model never receives a proposal id and has no tool that can execute anything.
 */
const crypto = require('crypto');
const store = require('./store');
const payments = require('./payments');
const { usd } = require('./money');

const TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 20;
const proposals = new Map();

// what each proposable action needs from the deal, and how it executes
const ACTIONS = {
  create_refund: {
    needs: (d) => (d.status === 'captured' && d.captureId ? null : 'Only a captured payment can be refunded.'),
    ids: (d) => ({ captureId: d.captureId, orderId: d.paypalOrderId }),
    summary: (d) => `Refund ${usd(d.totalCents)} to the buyer for "${d.productName}" (PayPal capture ${d.captureId}).`,
    run: (d) => payments.sellerRefund(d.id),
  },
  capture_authorization: {
    needs: (d) => (d.status === 'authorized' && d.authorizationId ? null : 'Only an authorized (held) payment can be captured.'),
    ids: (d) => ({ authorizationId: d.authorizationId, orderId: d.paypalOrderId }),
    summary: (d) => `Capture the held ${usd(d.totalCents)} for "${d.productName}" (PayPal authorization ${d.authorizationId}). The buyer is charged.`,
    run: (d) => payments.sellerCapture(d.id),
  },
  void_authorization: {
    needs: (d) => (d.status === 'authorized' && d.authorizationId ? null : 'Only an authorized (held) payment can be released.'),
    ids: (d) => ({ authorizationId: d.authorizationId, orderId: d.paypalOrderId }),
    summary: (d) => `Release the hold of ${usd(d.totalCents)} for "${d.productName}" (PayPal authorization ${d.authorizationId}). The buyer is not charged.`,
    run: (d) => payments.sellerVoid(d.id),
  },
};

const fingerprint = (d, action) => crypto.createHash('sha256').update(JSON.stringify([action, d.id, d.status, d.totalCents, d.captureId, d.authorizationId])).digest('hex');
const sweep = () => { const now = Date.now(); for (const [id, p] of proposals) if (p.status === 'pending' && now > p.expiresAt) p.status = 'expired'; };

const view = (p) => ({
  id: p.id, action: p.action, dealId: p.dealId, summary: p.summary, objectIds: p.objectIds, status: p.status,
  createdAt: p.createdAt, expiresAt: p.expiresAt, tainted: p.tainted, reason: p.reason,
});

/** Create a proposal. Never executes anything. tainted = created after the model read untrusted buyer text. */
function propose({ action, dealId, reason = '', tainted = false }) {
  const spec = ACTIONS[action];
  if (!spec) return { ok: false, error: `Unknown action "${action}".` };
  const deal = store.getDeal(dealId);
  if (!deal) return { ok: false, error: `No deal with id "${String(dealId).slice(0, 40)}".` };
  const why = spec.needs(deal);
  if (why) return { ok: false, error: why };
  sweep();
  const dup = [...proposals.values()].find((p) => p.status === 'pending' && p.dealId === deal.id && p.action === action);
  if (dup) return { ok: true, proposal: view(dup), duplicate: true };
  if ([...proposals.values()].filter((p) => p.status === 'pending').length >= MAX_PENDING) return { ok: false, error: 'Too many proposals are waiting for a decision.' };
  const p = {
    id: crypto.randomBytes(12).toString('hex'), action, dealId: deal.id, summary: spec.summary(deal), objectIds: spec.ids(deal),
    fingerprint: fingerprint(deal, action), status: 'pending', createdAt: new Date().toISOString(), expiresAt: Date.now() + TTL_MS, tainted, reason: String(reason).slice(0, 200),
  };
  proposals.set(p.id, p);
  store.logEvent('copilot_proposed', { dealId: deal.id, action, tainted });
  return { ok: true, proposal: view({ ...p, expiresAt: new Date(p.expiresAt).toISOString() }) };
}

const list = () => { sweep(); return [...proposals.values()].filter((p) => p.status === 'pending').map((p) => view({ ...p, expiresAt: new Date(p.expiresAt).toISOString() })); };

/** The human clicked Confirm. Re-checks everything, then runs through our payment code. */
async function confirm(id) {
  sweep();
  const p = proposals.get(id);
  if (!p) return { ok: false, status: 404, error: 'Unknown proposal.' };
  if (p.status !== 'pending') return { ok: false, status: 409, error: `This proposal is already ${p.status}.` };
  const deal = store.getDeal(p.dealId);
  if (!deal || fingerprint(deal, p.action) !== p.fingerprint) { p.status = 'expired'; return { ok: false, status: 409, error: 'The deal changed since this was proposed. Ask the Copilot again.' }; }
  p.status = 'confirmed'; // single use: marked before running so a double click cannot run it twice
  try {
    await ACTIONS[p.action].run(deal);
    store.logEvent('copilot_confirmed', { dealId: deal.id, action: p.action });
    return { ok: true, proposal: view({ ...p, expiresAt: new Date(p.expiresAt).toISOString() }), deal: { id: deal.id, status: deal.status } };
  } catch (err) {
    p.status = 'failed';
    return { ok: false, status: err.status || 502, error: err.message || 'PayPal could not do that.' };
  }
}

function reject(id) {
  const p = proposals.get(id);
  if (!p || p.status !== 'pending') return { ok: false, status: 404, error: 'No pending proposal with that id.' };
  p.status = 'rejected';
  return { ok: true };
}

const _reset = () => proposals.clear();
const _expire = (id) => { const p = proposals.get(id); if (p) p.expiresAt = 0; }; // tests only
module.exports = { propose, list, confirm, reject, ACTIONS, _reset, _expire };
