'use strict';
process.env.PERSIST = 'false';
process.env.LLM_PROVIDER = 'mock';
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
process.env.GEMINI_API_KEY = '';
process.env.GROQ_API_KEY = '';
process.env.SELLER_KEY = 'test-key';
process.env.SESSION_SECRET = 'unit-test-session-secret';
process.env.PORT = '0';
process.env.RATE_LIMIT_MULTIPLIER = '50';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'haggle-auth-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/auth');
const { start, server } = require('../src/server');
const store = require('../src/store');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
test.beforeEach(() => auth.resetForTests());

const j = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, json, text, headers: r.headers };
};
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

test('tokens verify, and tampering, expiry and the wrong role are all rejected', () => {
  const t = auth.sign('buyer', { email: 'a@b.co' });
  assert.equal(auth.verify(t, 'buyer').email, 'a@b.co');
  assert.equal(auth.verify(t, 'seller'), null, 'a buyer token is not a seller token');
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ r: 'seller', exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(auth.verify(`${forged}.${sig}`, 'seller'), null, 'a swapped body fails the signature');
  const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1); // always a different first character, so the signature really changes
  assert.equal(auth.verify(`${body}.${flipped}`, 'buyer'), null);
  assert.equal(auth.verify(auth.sign('seller', {}, Date.now() - auth.TTL.seller - 1000), 'seller'), null, 'expired');
  assert.equal(auth.verify(undefined, 'seller'), null);
  assert.equal(auth.verify('nonsense', 'seller'), null);
});

test('cookies are HttpOnly and SameSite', () => {
  const c = auth.cookie('x', 'y', { maxAgeMs: 5000, secure: true });
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Lax/); assert.match(c, /Secure/); assert.match(c, /Max-Age=5/);
});

test('seller: wrong key is 401, right key sets a session cookie that opens the dashboard, logout ends it', async () => {
  assert.equal((await j('GET', '/api/seller/dashboard')).status, 401);
  const bad = await j('POST', '/api/seller/login', { key: 'nope' });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('set-cookie'), null);

  const ok = await j('POST', '/api/seller/login', { key: 'test-key' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  const cookie = cookieOf(ok);
  assert.equal((await j('GET', '/api/seller/dashboard', null, { cookie })).status, 200);
  assert.equal((await j('GET', '/api/seller/me', null, { cookie })).status, 200);

  const out = await j('POST', '/api/seller/logout');
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await j('GET', '/api/seller/dashboard', null, { cookie: 'hb_seller=' })).status, 401);
});

test('seller: the x-seller-key header still works (scripts and tests rely on it)', async () => {
  assert.equal((await j('GET', '/api/seller/dashboard', null, { 'x-seller-key': 'test-key' })).status, 200);
  assert.equal((await j('GET', '/api/seller/dashboard', null, { 'x-seller-key': 'wrong' })).status, 401);
});

test('seller: a buyer session does not open the seller dashboard', async () => {
  const s = await j('POST', '/api/buyer/login/start', { email: 'buyer@example.com' });
  const v = await j('POST', '/api/buyer/login/verify', { email: 'buyer@example.com', code: s.json.demoCode });
  assert.equal(v.status, 200);
  assert.equal((await j('GET', '/api/seller/dashboard', null, { cookie: cookieOf(v) })).status, 401);
});

test('seller: five wrong keys lock further attempts, even with the right key', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await j('POST', '/api/seller/login', { key: 'bad' + i })).status, 401);
  const locked = await j('POST', '/api/seller/login', { key: 'test-key' });
  assert.equal(locked.status, 429);
  assert.match(locked.json.error, /Too many wrong keys/);
});

test('buyer: email + one-time code signs in; the code works once and a wrong code fails', async () => {
  assert.equal((await j('POST', '/api/buyer/login/start', { email: 'not-an-email' })).status, 400);
  const s = await j('POST', '/api/buyer/login/start', { email: ' Buyer@Example.com ' });
  assert.equal(s.status, 200);
  assert.match(s.json.demoCode, /^\d{6}$/);
  const wrong = await j('POST', '/api/buyer/login/verify', { email: 'buyer@example.com', code: '000000' === s.json.demoCode ? '111111' : '000000' });
  assert.equal(wrong.status, 401);
  const good = await j('POST', '/api/buyer/login/verify', { email: 'buyer@example.com', code: s.json.demoCode });
  assert.equal(good.status, 200);
  assert.equal(good.json.email, 'buyer@example.com', 'emails are normalised');
  const again = await j('POST', '/api/buyer/login/verify', { email: 'buyer@example.com', code: s.json.demoCode });
  assert.equal(again.status, 401, 'a code cannot be reused');
  const me = await j('GET', '/api/buyer/me', null, { cookie: cookieOf(good) });
  assert.deepEqual(me.json, { signedIn: true, email: 'buyer@example.com' });
  assert.equal((await j('GET', '/api/buyer/me')).json.signedIn, false);
});

test('buyer: codes are rate limited per email and expire', async () => {
  const first = await j('POST', '/api/buyer/login/start', { email: 'rate@example.com' });
  assert.equal(first.status, 200);
  assert.equal((await j('POST', '/api/buyer/login/start', { email: 'rate@example.com' })).status, 429, 'asked again too soon');
  const c = auth.startCode('exp@example.com', 1000);
  assert.equal(auth.checkCode('exp@example.com', c.code, 1000 + 11 * 60e3), 'expired');
});

test('buyer: too many wrong tries burn the code', () => {
  const { code } = auth.startCode('burn@example.com');
  for (let i = 0; i < 5; i++) assert.equal(auth.checkCode('burn@example.com', 'x' + i), 'wrong');
  assert.equal(auth.checkCode('burn@example.com', code), 'locked');
});

test('buyer: orders are listed for the signed-in email only, and the email never leaks to the public deal', async () => {
  const sign = async (email) => {
    const s = await j('POST', '/api/buyer/login/start', { email });
    return cookieOf(await j('POST', '/api/buyer/login/verify', { email, code: s.json.demoCode }));
  };
  assert.equal((await j('GET', '/api/buyer/orders')).status, 401);
  const alice = await sign('alice@example.com'), bob = await sign('bob@example.com');
  const products = (await j('GET', '/api/products')).json.products;
  const a = await j('POST', '/api/buy-now', { productId: products[0].id }, { cookie: alice });
  const guest = await j('POST', '/api/buy-now', { productId: products[0].id });
  assert.equal(a.status, 200); assert.equal(guest.status, 200);

  const mine = (await j('GET', '/api/buyer/orders', null, { cookie: alice })).json;
  assert.deepEqual(mine.orders.map((o) => o.id), [a.json.deal.id]);
  assert.equal((await j('GET', '/api/buyer/orders', null, { cookie: bob })).json.orders.length, 0);

  const pub = await j('GET', '/api/deals/' + a.json.deal.id);
  assert.equal(pub.status, 200);
  assert.ok(!JSON.stringify(pub.json).includes('alice@example.com'), 'public deal view has no email');
  assert.equal(store.getDeal(a.json.deal.id).buyerEmail, 'alice@example.com');
  assert.equal(store.getDeal(guest.json.deal.id).buyerEmail, null);
});
