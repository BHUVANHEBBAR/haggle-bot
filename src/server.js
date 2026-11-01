'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('./config');
const store = require('./store');
const auth = require('./auth');
const personas = require('./personas');
const payments = require('./payments');
const reconcile = require('./reconcile');
const copilot = require('./copilot');
const proposals = require('./proposals');
const ppTools = require('./paypal-tools');
const ppMcp = require('./paypal-mcp');
const mock = require('./paypal-mock');
const seller = require('./agents/seller');
const buyer = require('./agents/buyer');
const g = require('./guardrails');
const llm = require('./llm');
const { usd } = require('./money');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isObj ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
const redirect = (res, url) => { res.writeHead(302, { location: url }); res.end(); };

function readRaw(req, limit = 40000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

// the client address; behind a trusted proxy (TRUST_PROXY=true) it is the first hop of x-forwarded-for, otherwise the socket
function clientIp(req) {
  if (config.trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'x';
}

const hits = new Map();
function rateLimit(req, key, max, windowMs = 60000) {
  const ip = clientIp(req);
  const k = `${key}:${ip}`, now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max * config.rateLimitMultiplier) throw new HttpError(429, 'Too many requests. Please slow down a little.');
  arr.push(now); hits.set(k, arr);
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k); }, 60000).unref();

// the seller is recognised by the x-seller-key header (scripts, tests) or by the session cookie the login form sets
function requireSeller(req) {
  if (!auth.sellerFromRequest(req)) throw new HttpError(401, 'Wrong seller key');
}
// the signed-in buyer's email, or null for a guest
const buyerEmailOf = (req) => auth.buyerFromRequest(req)?.email || null;

const publicProduct = (p) => ({
  id: p.id, name: p.name, emoji: p.emoji, description: p.description, listCents: p.listCents,
  inStock: store.availableStock(p) > 0, stock: store.availableStock(p) <= 3 ? store.availableStock(p) : undefined,
  reserved: p.stock > 0 && store.availableStock(p) === 0, // someone is checking out the last one right now
  payMode: p.payMode, physical: p.physical, bulkQty: p.bulkQty || undefined,
  highlights: p.highlights || [], shipping: p.shipping || '', returns: p.returns || '',
  haggler: personas.publicHaggler(p.persona),
});
const publicDeal = (d) => ({
  id: d.id, productId: d.productId, source: d.source || 'negotiated', productName: d.productName, qty: d.qty, unitCents: d.unitCents, totalCents: d.totalCents,
  listTotalCents: d.listTotalCents, currency: d.currency, status: d.status, payMode: d.payMode,
  expiresAt: d.expiresAt, lastError: d.lastError || null, pending: !!d.pending,
  invoice: d.invoice ? { status: d.invoice.status, url: d.invoice.url || null, number: d.invoice.number || null } : null,
});
const sellerProduct = (p) => ({ ...p, floorCents: g.effectiveFloorCents(p, 1) });

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler });

route('GET', '/api/health', async () => ({ status: 200, body: {
  ok: true, ai: llm.activeProvider(), aiStatus: llm.status(), paypal: payments.mode(),
  sellerKeyIsDefault: config.sellerKey === 'change-me',
} }));

// ---------- sign-in: seller (SELLER_KEY -> session cookie) and buyer (email + one-time code) ----------
route('POST', '/api/seller/login', async (req, m, u, res) => {
  const ip = clientIp(req);
  if (auth.lockedOut(ip)) throw new HttpError(429, `Too many wrong keys. Try again in ${Math.ceil(auth.lockSecondsLeft(ip) / 60)} minute(s).`);
  const { key } = await readJson(req);
  if (!auth.sellerKeyOk(key)) { auth.recordFail(ip); throw new HttpError(401, 'Wrong seller key'); }
  auth.clearFails(ip);
  send(res, 200, { ok: true }, { 'set-cookie': auth.sellerCookie(req), 'cache-control': 'no-store' });
  return { handled: true };
});
route('POST', '/api/seller/logout', async (req, m, u, res) => {
  send(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie(auth.SELLER_COOKIE, auth.isSecureRequest(req)) });
  return { handled: true };
});
route('GET', '/api/seller/me', async (req) => { requireSeller(req); return { status: 200, body: { ok: true } }; });

route('POST', '/api/buyer/login/start', async (req) => {
  rateLimit(req, 'buyerstart', 10);
  const email = auth.normEmail((await readJson(req)).email);
  if (!auth.validEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
  const r = auth.startCode(email);
  if (r.wait) throw new HttpError(429, `A code was just sent. You can ask for another in ${r.wait} seconds.`);
  // no mail service is connected (sandbox-only demo), so the code is shown on screen unless BUYER_DEMO_CODES=false
  return { status: 200, body: { sent: true, ...(config.buyerDemoCodes ? { demoCode: r.code } : {}) } };
});
route('POST', '/api/buyer/login/verify', async (req, m, u, res) => {
  const ip = clientIp(req);
  if (auth.lockedOut('b:' + ip)) throw new HttpError(429, 'Too many wrong codes. Please try again in a few minutes.');
  const b = await readJson(req);
  const email = auth.normEmail(b.email);
  const r = auth.checkCode(email, b.code);
  if (r !== 'ok') {
    auth.recordFail('b:' + ip);
    throw new HttpError(401, r === 'wrong' ? 'That code is not right.' : 'That code has expired. Please ask for a new one.');
  }
  auth.clearFails('b:' + ip);
  send(res, 200, { ok: true, email }, { 'set-cookie': auth.buyerCookie(req, email), 'cache-control': 'no-store' });
  return { handled: true };
});
route('POST', '/api/buyer/logout', async (req, m, u, res) => {
  send(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie(auth.BUYER_COOKIE, auth.isSecureRequest(req)) });
  return { handled: true };
});
route('GET', '/api/buyer/me', async (req) => {
  const b = auth.buyerFromRequest(req);
  return { status: 200, body: b ? { signedIn: true, email: b.email } : { signedIn: false } };
});
route('GET', '/api/buyer/orders', async (req) => {
  const email = buyerEmailOf(req);
  if (!email) throw new HttpError(401, 'Please sign in to see your orders.');
  const orders = store.state.deals.filter((d) => d.buyerEmail === email).slice(0, 50)
    .map((d) => ({ ...publicDeal(d), createdAt: d.createdAt }));
  return { status: 200, body: { email, orders } };
});

route('GET', '/api/products', async () => ({ status: 200, body: { products: store.state.products.map(publicProduct) } }));

// a product that can be sold right now, and a sane quantity of it (stock minus what other buyers are mid-checkout on)
function sellable(productId, qty) {
  const product = store.getProduct(productId);
  if (!product) throw new HttpError(404, 'Unknown product');
  if (product.stock < 1) throw new HttpError(409, 'Sold out');
  const available = store.availableStock(product);
  if (available < 1) throw new HttpError(409, 'Another buyer is checking out the last one right now. Please try again in a few minutes.');
  return { product, q: Math.min(Math.max(parseInt(qty, 10) || 1, 1), Math.min(available, 10)) };
}

// one place that opens a negotiation, used by the web chat and the agent API
function startChat(productId, qty, buyerEmail = null) {
  const { product, q } = sellable(productId, qty);
  const s = store.createSession(product.id, q);
  s.buyerEmail = buyerEmail;
  s.persona = personas.isValid(product.persona) ? product.persona : personas.DEFAULT; // fixed for this chat
  store.state.counters.chatsStarted += 1;
  s.askCents = product.listCents;
  const opening = personas.openingLine(s.persona, { name: product.name, listCents: product.listCents, q });
  s.history.push({ role: 'seller', text: opening });
  return { s, product, qty: q, opening };
}

route('POST', '/api/chat/start', async (req) => {
  rateLimit(req, 'start', 30);
  const { productId, qty } = await readJson(req);
  const { s, product, qty: q, opening } = startChat(productId, qty, buyerEmailOf(req));
  return { status: 200, body: { sessionId: s.id, message: opening, product: publicProduct(product), qty: q } };
});

// ---------- buying without (or after) haggling ----------
// The price always comes from the server: list price for "buy now", the seller's own current ask for "take the current price".
function dealView(d) {
  return { id: d.id, unitCents: d.unitCents, totalCents: d.totalCents, listTotalCents: d.listTotalCents, qty: d.qty, expiresAt: d.expiresAt, payMode: d.payMode };
}

function makeDeal(product, qty, unitCents, extra) {
  const floorUnit = g.effectiveFloorCents(product, qty);
  const deal = store.createDeal({
    productId: product.id, productName: product.name, qty, unitCents, totalCents: unitCents * qty,
    listTotalCents: product.listCents * qty, costTotalCents: product.costCents * qty, floorTotalCents: floorUnit * qty,
    currency: 'USD', payMode: product.payMode, ...extra,
  });
  store.logEvent('deal_agreed', { dealId: deal.id, productName: product.name, totalCents: deal.totalCents, listTotalCents: deal.listTotalCents, source: deal.source });
  return deal;
}

// "Buy now": the normal purchase path, no haggling. Price = the stored list price; the browser sends only a product and a quantity.
route('POST', '/api/buy-now', async (req) => {
  rateLimit(req, 'buynow', 20);
  const { productId, qty } = await readJson(req);
  const { product, q } = sellable(productId, qty);
  const deal = makeDeal(product, q, product.listCents, { sessionId: null, messages: 0, transcript: [], source: 'buy_now', buyerEmail: buyerEmailOf(req) });
  store.state.counters.buyNow += 1;
  return { status: 200, body: { deal: dealView(deal) } };
});

// "Take the seller's current price": deterministic, no AI. Also works after the seller walked away, so a negotiation never dead-ends.
route('POST', '/api/chat/buy-at-current', async (req) => {
  rateLimit(req, 'buycurrent', 30);
  const { sessionId } = await readJson(req);
  const s = store.getSession(sessionId);
  if (!s) throw new HttpError(404, 'Session expired. Please start again.');
  if (s.status === 'agreed') throw new HttpError(409, 'A deal was already agreed in this chat.');
  const product = store.getProduct(s.productId);
  if (!product || product.stock < s.qty) throw new HttpError(409, 'Sorry, this item just sold out.');
  if (store.availableStock(product) < s.qty) throw new HttpError(409, 'Another buyer is checking out the last one right now. Please try again in a few minutes.');
  // never below the floor in force now (the seller may have tightened their rules since this price was quoted)
  const floor = g.effectiveFloorCents(product, s.qty);
  const unit = Math.max(floor, Math.min(s.askCents ?? product.listCents, product.listCents));
  const message = `Deal! ${usd(unit)}${s.qty > 1 ? ' each' : ''} for the ${product.name}. The price is held for ${config.dealTtlMinutes} minutes while you check out.`;
  s.history.push({ role: 'seller', text: message });
  s.messages += 1;
  const deal = makeDeal(product, s.qty, unit, { sessionId: s.id, messages: s.messages, transcript: s.history.slice(), source: s.round === 0 ? 'buy_now' : 'negotiated', persona: s.persona || null, buyerEmail: s.buyerEmail || null });
  s.status = 'agreed'; s.askCents = unit; s.dealId = deal.id;
  if (deal.source === 'buy_now') store.state.counters.buyNow += 1;
  return { status: 200, body: {
    message, action: 'accept', priceCents: unit, round: s.round, status: 'agreed', deal: dealView(deal),
    guard: { clamped: false, injection: false, belowFloor: false, messageReplaced: false, provider: 'code', fellBack: false },
  } };
});

// Restore a negotiation after a refresh (the browser keeps only the session id).
route('GET', '/api/chat/session/([a-f0-9]+)', async (req, m) => {
  const s = store.getSession(m[1]);
  if (!s) throw new HttpError(404, 'Session expired. Please start again.');
  const product = store.getProduct(s.productId);
  const deal = s.dealId ? store.getDeal(s.dealId) : null;
  return { status: 200, body: {
    sessionId: s.id, status: s.status, qty: s.qty, round: s.round, askCents: s.askCents ?? product.listCents,
    product: publicProduct(product),
    history: s.history.map((h) => ({ role: h.role, text: h.text, meta: h.meta || null })),
    deal: deal ? dealView(deal) : null,
  } };
});

require('./agent-api').install({ route, HttpError, readJson, rateLimit, store, seller, payments, g, usd, config, startChat, publicProduct });

route('POST', '/api/chat/message', async (req) => {
  rateLimit(req, 'chat', 40);
  const { sessionId, text } = await readJson(req);
  const s = store.getSession(sessionId);
  if (!s) throw new HttpError(404, 'Session expired. Please start again.');
  if (s.status !== 'open') throw new HttpError(409, s.status === 'agreed' ? 'A deal was already agreed in this chat.' : 'This negotiation has ended.');
  const t = String(text || '').trim();
  if (!t) throw new HttpError(400, 'Say something first');
  if (t.length > 300) throw new HttpError(400, 'Message too long (max 300 characters)');
  const r = await seller.respond(s, t);
  return { status: 200, body: r };
});

route('POST', '/api/checkout', async (req) => {
  rateLimit(req, 'checkout', 20);
  const { dealId } = await readJson(req);
  return { status: 200, body: await payments.startCheckout(dealId) };
});

route('GET', '/api/deals/([a-f0-9]+)', async (req, m) => {
  const d = store.getDeal(m[1]);
  if (!d) throw new HttpError(404, 'Not found');
  return { status: 200, body: { deal: publicDeal(d) } };
});

// PayPal sends the buyer back here after approval
route('GET', '/paypal/return', async (req, m, url) => {
  const dealId = url.searchParams.get('deal');
  try {
    const r = await payments.completeReturn(dealId);
    // success lands on the order page; a declined card goes back to the shop where the price is still held
    if (!r.declined && config.uiBase !== '/') return { redirect: `${config.uiBase}order/${encodeURIComponent(dealId)}` };
    return { redirect: `${config.uiBase}?deal=${encodeURIComponent(dealId)}${r.declined ? '&error=declined' : ''}` };
  } catch (err) {
    return { redirect: `${config.uiBase}?deal=${encodeURIComponent(dealId || '')}&error=failed` };
  }
});
route('GET', '/paypal/cancel', async (req, m, url) => ({ redirect: `${config.uiBase}?deal=${encodeURIComponent(url.searchParams.get('deal') || '')}&error=cancelled` }));

route('POST', '/api/paypal/webhook', async (req) => {
  const raw = await readRaw(req);
  const r = await payments.handleWebhook(req.headers, raw);
  return { status: r.status, body: r.body };
});

// ---------- simulated PayPal approval page (demo mode only) ----------
route('GET', '/mock-paypal/approve', async (req, m, url) => {
  if (payments.mode() !== 'simulated') throw new HttpError(404, 'Not found');
  const token = url.searchParams.get('token') || '';
  const o = mock.orderInfo(token);
  if (!o) throw new HttpError(404, 'Unknown order');
  const deal = store.getDeal(o.dealId);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return { status: 200, html: `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>HaggleBot demo checkout (simulated)</title>
<style>*{box-sizing:border-box}body{font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f3f6fb;color:#0b1f3a;margin:0;min-height:100vh;display:grid;place-items:center;padding:16px}
main{background:#fff;border:3px dashed #b45309;border-radius:18px;max-width:400px;width:100%;overflow:hidden;box-shadow:0 10px 30px rgba(11,31,58,.12)}
.demo{background:repeating-linear-gradient(-45deg,#fde68a,#fde68a 12px,#fcd34d 12px,#fcd34d 24px);color:#451a03;font-weight:800;text-align:center;padding:10px 12px;font-size:13px;letter-spacing:.04em;text-transform:uppercase}
.in{padding:22px}h1{font-size:19px;margin:0 0 4px}p{color:#4b5b75;margin:0}.amt{font-size:38px;font-weight:800;letter-spacing:-.03em;margin:14px 0;font-variant-numeric:tabular-nums}
button{width:100%;min-height:46px;padding:12px;border-radius:12px;border:0;font:inherit;font-weight:700;cursor:pointer;margin-top:8px}
.ok{background:#0b1f3a;color:#fff}.no{background:#eef1f6;color:#0b1f3a}button:focus-visible{outline:3px solid #2563eb;outline-offset:2px}.fine{font-size:12px;color:#4b5b75;margin-top:14px}</style>
<main><div class=demo>Demo mode: simulated payment page, not PayPal</div><div class=in><h1>Pay HaggleBot Demo Shop</h1><p>${esc(deal?.productName || '')}${deal?.payMode === 'authorize' ? ' (payment is held, not charged yet)' : ''}</p>
<div class=amt>${esc(usd(o.amountCents))} ${esc(o.currency)}</div>
<form method=post action="/mock-paypal/decide"><input type=hidden name=token value="${esc(token)}">
<button class=ok name=choice value=approve>Approve payment</button><button class=no name=choice value=decline>Simulate a declined card</button></form>
<div class=fine>No real money moves. With sandbox keys configured, the real PayPal sandbox page appears here instead.</div></div></main>` };
});
route('POST', '/mock-paypal/decide', async (req) => {
  if (payments.mode() !== 'simulated') throw new HttpError(404, 'Not found');
  const params = new URLSearchParams(await readRaw(req));
  const o = mock.orderInfo(params.get('token'));
  if (!o) throw new HttpError(404, 'Unknown order');
  mock.approve(o.id, { decline: params.get('choice') === 'decline' });
  return { redirect: `/paypal/return?deal=${o.dealId}&token=${o.id}` };
});

// ---------- agent vs agent (streamed as newline-delimited JSON) ----------
route('POST', '/api/battle', async (req, m, url, res) => {
  rateLimit(req, 'battle', 6);
  const { productId, persona, budgetPct } = await readJson(req);
  const product = store.getProduct(productId);
  if (!product) throw new HttpError(404, 'Unknown product');
  if (product.stock < 1) throw new HttpError(409, 'Sold out');
  const who = ['fair', 'tough', 'manipulator'].includes(persona) ? persona : 'fair';
  const pct = Math.min(Math.max(Number(budgetPct) || 85, 40), 120);
  const budgetCents = Math.round(product.listCents * pct / 100);

  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const out = (o) => res.write(JSON.stringify(o) + '\n');
  const s = store.createSession(product.id, 1);
  s.askCents = product.listCents;
  const opening = `Hi! The ${product.name} is ${usd(product.listCents)}. Make me an offer.`;
  s.history.push({ role: 'seller', text: opening });
  out({ type: 'start', persona: who, budgetCents, product: publicProduct(product), opening });

  let final = null;
  for (let turn = 1; turn <= 9 && s.status === 'open'; turn++) {
    const b = await buyer.turn({ persona: who, product, budgetCents, round: turn, askCents: s.askCents, history: s.history });
    out({ type: 'buyer', text: b.text, provider: b.provider });
    const r = await seller.respond(s, b.text);
    out({ type: 'seller', text: r.message, action: r.action, priceCents: r.priceCents, guard: r.guard, round: r.round });
    if (r.deal) final = r.deal;
  }
  out({ type: 'end', status: s.status, deal: final, budgetCents });
  res.end();
  return { handled: true };
});

// ---------- seller area ----------
route('GET', '/api/seller/dashboard', async (req) => {
  requireSeller(req);
  return { status: 200, body: {
    stats: store.stats(), mode: { ai: llm.activeProvider(), paypal: payments.mode() },
    products: store.state.products.map(sellerProduct),
    deals: store.state.deals.slice(0, 50).map((d) => ({ ...publicDeal(d), floorTotalCents: d.floorTotalCents, costTotalCents: d.costTotalCents, createdAt: d.createdAt, captureId: d.captureId, authorizationId: d.authorizationId, paypalOrderId: d.paypalOrderId, invoiceId: d.invoice?.id || null, invoiceEmail: d.invoice?.email || null, trail: d.trail || [], messages: d.messages, transcript: (d.transcript || []).map((t) => ({ role: t.role, text: t.text })) })),
    events: store.state.events.slice(0, 60),
  } };
});
route('PUT', '/api/seller/products/([a-z0-9_-]+)', async (req, m) => {
  requireSeller(req);
  const p = store.getProduct(m[1]);
  if (!p) throw new HttpError(404, 'Unknown product');
  const b = await readJson(req);
  const num = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, 'Value out of range'); return n; };
  if (b.listPrice !== undefined) p.listCents = Math.round(num(b.listPrice, 1, 100000) * 100);
  if (b.costPrice !== undefined) p.costCents = Math.round(num(b.costPrice, 0, 100000) * 100);
  if (b.minMarginPct !== undefined) p.minMarginPct = num(b.minMarginPct, 0, 500);
  if (b.maxDiscountPct !== undefined) p.maxDiscountPct = num(b.maxDiscountPct, 0, 90);
  if (b.stock !== undefined) p.stock = Math.round(num(b.stock, 0, 100000));
  if (b.persona !== undefined) {
    if (!personas.isValid(b.persona)) throw new HttpError(400, 'Unknown personality');
    p.persona = b.persona;
  }
  if (p.costCents > p.listCents) throw new HttpError(400, 'Cost cannot be above list price');
  store.save(); store.logEvent('rules_changed', { productId: p.id, persona: p.persona });
  return { status: 200, body: { product: sellerProduct(p) } };
});
for (const [name, fn] of [['capture', payments.sellerCapture], ['void', payments.sellerVoid], ['refund', payments.sellerRefund]]) {
  route('POST', `/api/seller/deals/([a-f0-9]+)/${name}`, async (req, m) => {
    requireSeller(req);
    try { const d = await fn(m[1]); return { status: 200, body: { deal: publicDeal(d) } }; }
    catch (err) { if (err instanceof payments.UserError) throw new HttpError(err.status, err.message); throw new HttpError(502, `PayPal said: ${err.issue || err.message}`); }
  });
}

// ---------- PayPal invoices: the seller invoices an unpaid deal; the buyer pays on PayPal's invoice page ----------
const sellerDealAction = (fn) => async (req, m) => {
  requireSeller(req);
  try { const d = await fn(m[1], req); return { status: 200, body: { deal: publicDeal(d) } }; }
  catch (err) { if (err instanceof payments.UserError) throw new HttpError(err.status, err.message); throw new HttpError(502, `PayPal said: ${err.issue || err.message}`); }
};
route('POST', '/api/seller/deals/([a-f0-9]+)/invoice', async (req, m) => {
  requireSeller(req); rateLimit(req, 'invoice', 10);
  const b = await readJson(req);
  return sellerDealAction((id) => payments.sellerInvoice(id, { email: b.email, name: b.name }))(req, m);
});
route('POST', '/api/seller/deals/([a-f0-9]+)/invoice/refresh', sellerDealAction((id) => payments.syncInvoice(id)));
route('POST', '/api/seller/deals/([a-f0-9]+)/invoice/cancel', sellerDealAction((id) => payments.sellerCancelInvoice(id)));

// simulated invoice page (demo mode only; with sandbox keys the buyer pays on PayPal's own invoice page)
route('GET', '/mock-paypal/invoice', async (req, m, url) => {
  if (payments.mode() !== 'simulated') throw new HttpError(404, 'Not found');
  const inv = mock.invoiceInfo(url.searchParams.get('id') || '');
  if (!inv) throw new HttpError(404, 'Unknown invoice');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deal = store.getDeal(inv.dealId);
  return { status: 200, html: `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>HaggleBot demo invoice (simulated)</title>
<style>*{box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#f3f6fb;color:#0b1f3a;margin:0;min-height:100vh;display:grid;place-items:center;padding:16px}
main{background:#fff;border:3px dashed #b45309;border-radius:18px;max-width:420px;width:100%;overflow:hidden}.demo{background:#fde68a;color:#451a03;font-weight:800;text-align:center;padding:10px;font-size:13px;text-transform:uppercase}
.in{padding:22px}h1{font-size:19px;margin:0 0 4px}.amt{font-size:38px;font-weight:800;margin:14px 0}button{width:100%;min-height:46px;border-radius:12px;border:0;font:inherit;font-weight:700;background:#0b1f3a;color:#fff;cursor:pointer}
.fine{font-size:12px;color:#4b5b75;margin-top:14px}</style>
<main><div class=demo>Demo mode: simulated invoice, not PayPal</div><div class=in><h1>Invoice ${esc(inv.number)} for ${esc(deal?.productName || '')}</h1><p>Status: ${esc(inv.status)}</p>
<div class=amt>${esc(usd(inv.amountCents))} ${esc(inv.currency)}</div>
${inv.status === 'SENT' ? '<form method=post action="/mock-paypal/invoice/pay"><input type=hidden name=id value="' + esc(inv.id) + '"><button>Pay this invoice</button></form>' : '<p><b>This invoice is ' + esc(inv.status) + '.</b></p>'}
<div class=fine>No real money moves. With sandbox keys configured, the buyer pays on PayPal's real sandbox invoice page.</div></div></main>` };
});
route('POST', '/mock-paypal/invoice/pay', async (req) => {
  if (payments.mode() !== 'simulated') throw new HttpError(404, 'Not found');
  const id = new URLSearchParams(await readRaw(req)).get('id') || '';
  if (!mock.invoiceInfo(id)) throw new HttpError(404, 'Unknown invoice');
  mock.payInvoice(id);
  return { redirect: `/mock-paypal/invoice?id=${encodeURIComponent(id)}` };
});

// ---------- rule playground: what would these rules do? (read-only, changes nothing) ----------
route('POST', '/api/seller/simulate', async (req) => {
  requireSeller(req);
  const b = await readJson(req);
  const num = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, 'Value out of range'); return n; };
  const base = store.getProduct(b.productId) || {};
  const p = {
    lowStockThreshold: base.lowStockThreshold ?? 2, lowStockMaxDiscountPct: base.lowStockMaxDiscountPct ?? 10,
    bulkQty: base.bulkQty ?? 0, bulkExtraDiscountPct: base.bulkExtraDiscountPct ?? 0,
    listCents: Math.round(num(b.listPrice, 1, 100000) * 100), costCents: Math.round(num(b.costPrice, 0, 100000) * 100),
    minMarginPct: num(b.minMarginPct, 0, 500), maxDiscountPct: num(b.maxDiscountPct, 0, 90), stock: Math.round(num(b.stock, 0, 100000)),
  };
  if (p.costCents > p.listCents) throw new HttpError(400, 'Cost cannot be above list price');
  const qty = Math.round(num(b.qty ?? 1, 1, 100));
  if (b.persona !== undefined && !personas.isValid(b.persona)) throw new HttpError(400, 'Unknown personality');
  const progress = personas.progressFor(b.persona ?? base.persona);
  const floorCents = g.effectiveFloorCents(p, qty);
  const round1 = (x) => Math.round(x * 10) / 10;
  return { status: 200, body: {
    floorCents, listCents: p.listCents, qty,
    ladder: Array.from({ length: g.MAX_ROUNDS }, (_, i) => ({ round: i + 1, askCents: g.counterCents(p, qty, i + 1, progress) })),
    discountAtFloorPct: round1((1 - floorCents / p.listCents) * 100),
    marginAtFloorPct: floorCents ? round1(((floorCents - p.costCents) / floorCents) * 100) : 0,
  } };
});

// ---------- haggler personalities (seller-only: includes the pacing the buyer never sees) ----------
route('GET', '/api/seller/personas', async (req) => {
  requireSeller(req);
  return { status: 200, body: { default: personas.DEFAULT, personas: personas.catalog() } };
});

// ---------- funnel analytics ----------
route('GET', '/api/seller/analytics', async (req) => {
  requireSeller(req);
  const deals = store.state.deals;
  const paid = deals.filter((d) => ['captured', 'authorized'].includes(d.status));
  const bought = deals.filter((d) => d.source === 'buy_now');
  const haggled = deals.filter((d) => d.source !== 'buy_now');
  const isPaid = (d) => ['captured', 'authorized'].includes(d.status);
  const byDay = {};
  for (const d of paid) { const day = String(d.createdAt).slice(0, 10); byDay[day] = (byDay[day] || 0) + d.totalCents; }
  const msgs = deals.map((d) => d.messages || 0).filter(Boolean);
  return { status: 200, body: {
    funnel: { chats: store.state.counters.chatsStarted, offered: store.state.counters.chatsWithOffer, agreed: haggled.length, paid: haggled.filter(isPaid).length },
    buyNow: { deals: bought.length, paid: bought.filter(isPaid).length },
    offersPerChat: store.state.counters.chatsWithOffer ? Math.round((store.state.counters.offersMade / store.state.counters.chatsWithOffer) * 10) / 10 : 0,
    avgMessagesToClose: msgs.length ? Math.round((msgs.reduce((a, b) => a + b, 0) / msgs.length) * 10) / 10 : 0,
    byPersona: personas.KEYS.map((k) => {
      const ds = deals.filter((d) => d.source !== 'buy_now' && (d.persona || personas.DEFAULT) === k); // only haggled deals reflect a personality
      const discounts = ds.filter((d) => d.listTotalCents).map((d) => (1 - d.totalCents / d.listTotalCents) * 100);
      return { key: k, label: personas.get(k).label, emoji: personas.get(k).emoji, deals: ds.length, paid: ds.filter(isPaid).length, avgDiscountPct: discounts.length ? Math.round((discounts.reduce((a, b) => a + b, 0) / discounts.length) * 10) / 10 : 0 };
    }).filter((r) => r.deals > 0 || r.key === personas.DEFAULT),
    revenueByDay: Object.entries(byDay).sort().slice(-14).map(([date, cents]) => ({ date, cents })),
  } };
});

// ---------- live feed (server-sent events). The browser reads it with fetch so the seller key stays in a header ----------
let liveStreams = 0;
route('GET', '/api/seller/stream', async (req, m, url, res) => {
  requireSeller(req);
  if (liveStreams >= 20) throw new HttpError(429, 'Too many live feeds open');
  liveStreams++;
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(': connected\n\n');
  const onEvent = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  store.bus.on('event', onEvent);
  const beat = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(beat); store.bus.off('event', onEvent); liveStreams--; });
  return { handled: true };
});

// ---------- Seller Copilot: an assistant whose tools are PayPal actions. Money actions are proposals the seller confirms ----------
route('GET', '/api/seller/copilot/status', async (req) => {
  requireSeller(req);
  const mcp = ppMcp.enabled() ? await ppMcp.selfTest() : null;
  return { status: 200, body: { mode: payments.mode(), tools: ppTools.describeTools(), mcp, proposals: proposals.list() } };
});
route('POST', '/api/seller/copilot', async (req) => {
  requireSeller(req); rateLimit(req, 'copilot', 20);
  const { message, history } = await readJson(req);
  return { status: 200, body: await copilot.ask({ message, history: Array.isArray(history) ? history.slice(-8) : [] }) };
});
route('GET', '/api/seller/copilot/proposals', async (req) => { requireSeller(req); return { status: 200, body: { proposals: proposals.list() } }; });
route('POST', '/api/seller/copilot/proposals/([a-f0-9]+)/confirm', async (req, m) => {
  requireSeller(req); rateLimit(req, 'confirm', 20);
  const r = await proposals.confirm(m[1]);
  if (!r.ok) throw new HttpError(r.status || 400, r.error);
  return { status: 200, body: r };
});
route('POST', '/api/seller/copilot/proposals/([a-f0-9]+)/reject', async (req, m) => {
  requireSeller(req);
  const r = proposals.reject(m[1]);
  if (!r.ok) throw new HttpError(r.status || 400, r.error);
  return { status: 200, body: r };
});

// ---------- reconcile with PayPal: fetch each payment by its stored id and compare ----------
let lastReconcile = null;
route('GET', '/api/seller/reconcile', async (req) => { requireSeller(req); return { status: 200, body: { report: lastReconcile } }; });
route('POST', '/api/seller/reconcile', async (req) => {
  requireSeller(req); rateLimit(req, 'reconcile', 6);
  const client = payments.client();
  const { results, summary } = await reconcile.reconcileAll(store.state.deals, client);
  for (const r of results) {
    const deal = store.getDeal(r.dealId);
    if (deal) store.addTrail(deal, 'reconciled', { result: r.result, debugId: r.debugId || null, paypalStatus: r.paypal?.status || null });
  }
  const account = await reconcile.accountView(client, store.state.deals);
  store.logEvent('reconciled', { checked: summary.checked, matched: summary.matched, mismatched: summary.mismatched, missing: summary.missing });
  lastReconcile = { at: new Date().toISOString(), mode: payments.mode(), results, summary, account };
  return { status: 200, body: { report: lastReconcile } };
});

// ---------- safety eval (runs in a child process so it never touches real deals) ----------
const evalFile = () => path.join(config.dataDir, 'eval-report.json');
function readEvalReport() { try { return JSON.parse(fs.readFileSync(evalFile(), 'utf8')); } catch { return null; } }
function runEvalChild(count) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'eval.js'), String(count), String(Date.now() % 100000)], { env: { ...process.env, PERSIST: 'false' }, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new HttpError(504, 'Safety check timed out')); }, 60000);
    child.on('exit', (code) => { clearTimeout(timer); if (code === 0 || code === 1) resolve(); else reject(new HttpError(500, 'Safety check failed to run')); });
    child.on('error', () => { clearTimeout(timer); reject(new HttpError(500, 'Safety check failed to start')); });
  });
}
route('GET', '/api/seller/eval', async (req) => { requireSeller(req); return { status: 200, body: { report: readEvalReport() } }; });
route('POST', '/api/seller/eval/run', async (req) => {
  requireSeller(req); rateLimit(req, 'eval', 3);
  const { n } = await readJson(req);
  await runEvalChild(Math.min(Math.max(parseInt(n, 10) || 400, 50), 1000));
  return { status: 200, body: { report: readEvalReport() } };
});

route('GET', '/', async () => ({ redirect: '/app/' }));
route('GET', '/app', async () => ({ redirect: '/app/' }));

// ---------- static files ----------
function serveStatic(req, res, pathname, requested = pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    // React app: unknown paths under /app/ without a file extension are client-side routes
    if (err && pathname.startsWith('/app/') && !path.extname(pathname)) return serveStatic(req, res, '/app/index.html', pathname);
    if (err) return send(res, 404, 'Not found');
    // only the chat widget (/app/embed) may be framed by other sites; every other page is same-origin only (no clickjacking)
    const framing = requested.startsWith('/app/embed') ? {} : { 'x-frame-options': 'SAMEORIGIN', 'content-security-policy': "frame-ancestors 'self'" };
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache', ...framing });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // the agent API and its descriptor are public (no cookies or credentials), so any agent may call them from anywhere
    if (url.pathname.startsWith('/api/agent/') || url.pathname.startsWith('/.well-known/')) {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const result = await r.handler(req, m, url, res);
      if (result?.handled) return;
      if (result?.redirect) return redirect(res, result.redirect);
      if (result?.html) return send(res, result.status || 200, result.html);
      return send(res, result.status || 200, result.body);
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, decodeURIComponent(url.pathname));
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (res.headersSent) { res.end(); return; }
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    if (err instanceof payments.UserError) return send(res, err.status, { error: err.message, code: err.code });
    console.error('Unhandled error:', err);
    return send(res, 500, { error: 'Something went wrong on our side.' });
  }
});

function start(port = config.port) {
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (require.main === module) {
  if (config.paypalEnvironment !== 'sandbox') {
    console.error(`PAYPAL_ENVIRONMENT=${config.paypalEnvironment} is not supported: HaggleBot is sandbox-only. Remove the variable or set it to "sandbox".`);
    process.exit(1);
  }
  if (config.paypalLive && config.sellerKey === 'change-me' && (config.baseUrl.startsWith('https://') || process.env.NODE_ENV === 'production')) {
    console.error('Refusing to start: SELLER_KEY is still "change-me" on a public deployment with PayPal credentials. Anyone could open the seller dashboard and refund payments. Set SELLER_KEY.');
    process.exit(1);
  }
  start().then(() => {
    console.log(`HaggleBot running at ${config.baseUrl}`);
    console.log(`  AI brain : ${config.llmProvider}${config.llmProvider === 'mock' ? '  (no API key found: using the offline scripted brain)' : ''}`);
    console.log(`  PayPal   : ${config.paypalLive ? 'SANDBOX (live API calls)' : 'simulated (no PAYPAL_CLIENT_ID/SECRET set)'}`);
    if (config.sellerKey === 'change-me') console.log('  WARNING  : SELLER_KEY is still "change-me". Set your own in .env.');
  });
}

module.exports = { server, start };
