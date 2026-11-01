'use strict';
// Small JSON-file store: products, deals, events. Sessions live in memory only.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const SEED_PRODUCTS = [
  {
    id: 'tote', name: 'Handwoven Block-Print Tote', emoji: '👜', physical: true, payMode: 'full', persona: 'friendly',
    description: 'Hand block-printed cotton tote made by a small studio in Jaipur. Sturdy, washable, fits a laptop.',
    listCents: 4800, costCents: 1800, minMarginPct: 25, maxDiscountPct: 25, stock: 8,
    lowStockThreshold: 2, lowStockMaxDiscountPct: 10, bulkQty: 3, bulkExtraDiscountPct: 5,
    highlights: ['Hand block-printed cotton', 'Fits a laptop', 'Washable'], shipping: 'Ships in 3-5 business days (demo store)', returns: '14-day returns on unused items (demo policy)',
  },
  {
    id: 'lamp', name: 'Vintage 1970s Brass Desk Lamp', emoji: '💡', physical: true, payMode: 'full', persona: 'friendly',
    description: 'One-of-a-kind restored brass lamp with a working switch and new wiring. Only one available.',
    listCents: 12000, costCents: 5500, minMarginPct: 20, maxDiscountPct: 20, stock: 1,
    lowStockThreshold: 2, lowStockMaxDiscountPct: 8, bulkQty: 0, bulkExtraDiscountPct: 0,
    highlights: ['Restored 1970s brass', 'New wiring, working switch', 'One of a kind'], shipping: 'Ships in 3-5 business days (demo store)', returns: '14-day returns on unused items (demo policy)',
  },
  {
    id: 'logo', name: 'Logo Design Package (3 concepts)', emoji: '🎨', physical: false, payMode: 'authorize', persona: 'friendly',
    description: 'Freelance logo design: three concepts, two revision rounds, final files. Payment is held (authorized) now and only captured when the designer accepts the brief.',
    listCents: 30000, costCents: 6000, minMarginPct: 30, maxDiscountPct: 30, stock: 5,
    lowStockThreshold: 1, lowStockMaxDiscountPct: 12, bulkQty: 0, bulkExtraDiscountPct: 0,
    highlights: ['Three distinct concepts', 'Two revision rounds', 'Final files included'], shipping: 'Delivered digitally. Kickoff within 2 business days (demo store)', returns: 'Your payment is only held until the designer accepts the brief',
  },
];

const { EventEmitter } = require('events');
const state = { products: [], deals: [], events: [], webhookEventIds: [], counters: { chatsStarted: 0, offersMade: 0, chatsWithOffer: 0, buyNow: 0 } };
const bus = new EventEmitter(); // live feed: emits 'event' for every logged event
bus.setMaxListeners(50);
const sessions = new Map();

function file() { return path.join(config.dataDir, 'store.json'); }

function load() {
  state.products = JSON.parse(JSON.stringify(SEED_PRODUCTS));
  state.deals = []; state.events = []; state.webhookEventIds = []; state.counters = { chatsStarted: 0, offersMade: 0, chatsWithOffer: 0, buyNow: 0 };
  if (!config.persist) return;
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    // saved rules win, but fields added in newer versions (highlights, shipping, ...) are filled in from the seed
    if (Array.isArray(saved.products) && saved.products.length) state.products = saved.products.map((p) => ({ ...(SEED_PRODUCTS.find((s) => s.id === p.id) || {}), ...p }));
    state.deals = saved.deals || [];
    state.events = saved.events || [];
    state.webhookEventIds = saved.webhookEventIds || [];
    state.counters = { chatsStarted: 0, offersMade: 0, chatsWithOffer: 0, buyNow: 0, ...(saved.counters || {}) };
  } catch { /* first run */ }
}

let saveTimer = null;
function save() {
  if (!config.persist) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(file(), JSON.stringify(state, null, 2));
    } catch (err) { console.error('store save failed:', err.message); }
  }, 100);
  saveTimer.unref?.();
}

const rid = (n = 12) => crypto.randomBytes(n).toString('hex');

function logEvent(type, detail = {}) {
  const evt = { ...detail, id: rid(4), ts: new Date().toISOString(), type };
  state.events.unshift(evt);
  if (state.events.length > 300) state.events.length = 300;
  bus.emit('event', evt);
  save();
}

const getProduct = (id) => state.products.find((p) => p.id === id);

// Stock held by buyers who are mid-checkout (PayPal order created, not yet paid) for the price-hold window.
// Stock itself only drops when a payment completes, so without this two buyers could both pay for the last item.
function reservedQty(productId, excludeDealId) {
  const holdMs = config.dealTtlMinutes * 60000;
  const now = Date.now();
  return state.deals
    // an open PayPal order holds the unit for the price-hold window; an unpaid invoice holds it until it is paid or cancelled
    .filter((d) => d.productId === productId && d.id !== excludeDealId
      && ((d.status === 'order_created' && now - Date.parse(d.updatedAt || d.createdAt) < holdMs) || d.status === 'invoiced'))
    .reduce((n, d) => n + d.qty, 0);
}
const availableStock = (p, excludeDealId) => Math.max(0, p.stock - reservedQty(p.id, excludeDealId));
const getDeal = (id) => state.deals.find((d) => d.id === id);

function createDeal(d) {
  const deal = {
    id: rid(10), status: 'agreed', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + config.dealTtlMinutes * 60000).toISOString(),
    paypalOrderId: null, captureId: null, authorizationId: null, attempts: 0, ...d,
  };
  // money trail: an append-only record of every PayPal step for this deal (ids and debug_ids come from PayPal)
  deal.trail = deal.trail || [{ ts: new Date().toISOString(), step: 'agreed', source: deal.source || 'negotiated', totalCents: deal.totalCents }];
  state.deals.unshift(deal);
  save();
  return deal;
}

function addTrail(deal, step, detail = {}) {
  deal.trail = deal.trail || [];
  deal.trail.push({ ts: new Date().toISOString(), step, ...detail });
  if (deal.trail.length > 60) deal.trail.splice(1, deal.trail.length - 60); // keep the first entry (agreed)
  save();
}

function updateDeal(deal, patch) { Object.assign(deal, patch, { updatedAt: new Date().toISOString() }); save(); }

function createSession(productId, qty) {
  const s = {
    id: rid(12), productId, qty, round: 0, askCents: null, status: 'open',
    history: [], messages: 0, dealId: null, createdAt: Date.now(),
  };
  sessions.set(s.id, s);
  for (const [k, v] of sessions) if (Date.now() - v.createdAt > 3600000) sessions.delete(k);
  return s;
}
const getSession = (id) => sessions.get(id);

function markWebhookSeen(id) {
  if (state.webhookEventIds.includes(id)) return false;
  state.webhookEventIds.unshift(id);
  if (state.webhookEventIds.length > 500) state.webhookEventIds.length = 500;
  save();
  return true;
}

/** Numbers for the seller dashboard. */
function stats() {
  const paid = state.deals.filter((d) => ['captured', 'authorized'].includes(d.status));
  const closed = state.deals.filter((d) => !['agreed', 'expired'].includes(d.status) || d.captureId);
  const revenue = paid.reduce((s, d) => s + d.totalCents, 0);
  const negotiated = paid.filter((d) => d.source !== 'buy_now'); // the discount tile is about haggling, so buy-now sales are left out
  const negRevenue = negotiated.reduce((s, d) => s + d.totalCents, 0);
  const listTotal = negotiated.reduce((s, d) => s + d.listTotalCents, 0);
  const costTotal = paid.reduce((s, d) => s + d.costTotalCents, 0);
  const marginCents = revenue - costTotal;
  const count = (t) => state.events.filter((e) => e.type === t).length;
  const messages = state.deals.reduce((s, d) => s + (d.messages || 0), 0);
  return {
    dealsPaid: paid.length,
    dealsAgreed: state.deals.length,
    revenueCents: revenue,
    avgDiscountPct: listTotal ? Math.round((1 - negRevenue / listTotal) * 1000) / 10 : 0,
    marginPct: revenue ? Math.round((marginCents / revenue) * 1000) / 10 : 0,
    belowFloorRefused: count('below_floor_refused'),
    priceClamped: count('price_clamped'),
    injectionsBlocked: count('injection_blocked'),
    estMinutesSaved: Math.round(messages * 0.75),
    closedCount: closed.length,
  };
}

load();
module.exports = {
  state, bus, addTrail, reservedQty, availableStock, load, save, logEvent, getProduct, getDeal, createDeal, updateDeal,
  createSession, getSession, markWebhookSeen, stats, rid, SEED_PRODUCTS,
};
