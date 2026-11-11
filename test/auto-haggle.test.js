'use strict';
// Auto-haggle: a buyer sets a maximum price and their AI haggles for them. The maximum and the seller's floor both hold.
process.env.PERSIST = 'false';
process.env.LLM_PROVIDER = 'mock';
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
process.env.GEMINI_API_KEY = '';
process.env.GROQ_API_KEY = '';
process.env.SELLER_KEY = 'test-key';
process.env.PORT = '0';
process.env.RATE_LIMIT_MULTIPLIER = '200'; // the sweep below makes many calls from one IP
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'haggle-auto-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('../src/server');
const store = require('../src/store');
const g = require('../src/guardrails');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; process.env.BASE_URL = base; });
test.after(() => server.close());

const post = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json };
};
const floorCents = () => g.effectiveFloorCents(store.getProduct('tote'), 1);

test('a sensible maximum gets a deal at or under it, never below the seller floor, and the buyer can check out', async () => {
  const r = await post('/api/auto-haggle', { productId: 'tote', maxDollars: 45, style: 'fair' });
  assert.equal(r.status, 200);
  assert.ok(r.json.deal, 'a deal was reached');
  assert.ok(r.json.deal.unitCents <= 4500, `paid ${r.json.deal.unitCents} against a 4500 maximum`);
  assert.ok(r.json.deal.unitCents >= floorCents(), 'never below the floor');
  assert.ok(r.json.transcript.some((t) => t.role === 'agent') && r.json.transcript.some((t) => t.role === 'seller'));
  assert.ok(!JSON.stringify(r.json).match(/floor|costTotal|reserve/i), 'nothing about the seller limits leaks');
  const pay = await post('/api/checkout', { dealId: r.json.deal.id });
  assert.equal(pay.status, 200);
  assert.ok(pay.json.approveUrl);
});

test('a maximum below what the seller can accept ends with no deal and nothing sold', async () => {
  const before = store.state.deals.length;
  const r = await post('/api/auto-haggle', { productId: 'tote', maxDollars: 10, style: 'tough' });
  assert.equal(r.status, 200);
  assert.equal(r.json.deal, null);
  assert.equal(store.state.deals.length, before, 'no deal was created');
});

test('sweep: across budgets and both styles the price never exceeds the maximum nor drops below the floor', async () => {
  let deals = 0;
  for (const dollars of [15, 25, 30, 33, 36, 38, 40, 42, 44, 46, 48]) {
    for (const style of ['fair', 'tough']) {
      const r = await post('/api/auto-haggle', { productId: 'tote', maxDollars: dollars, style });
      assert.equal(r.status, 200);
      if (r.json.deal) { deals++; assert.ok(r.json.deal.unitCents <= dollars * 100, `${style} $${dollars}`); assert.ok(r.json.deal.unitCents >= floorCents(), `${style} $${dollars} floor`); }
    }
  }
  assert.ok(deals > 0, 'at least some budgets close a deal');
  assert.ok(!store.state.events.some((e) => e.type === 'autohaggle_over_budget'), 'the second lock never had to fire');
});

test('bad requests are refused: unknown product, missing or tiny maximum, above list price, the manipulator is not selectable', async () => {
  assert.equal((await post('/api/auto-haggle', { productId: 'nope', maxDollars: 20 })).status, 404);
  for (const bad of [undefined, 'abc', 0, 0.5, -5]) assert.equal((await post('/api/auto-haggle', { productId: 'tote', maxDollars: bad })).status, 400, String(bad));
  assert.equal((await post('/api/auto-haggle', { productId: 'tote', maxDollars: 9999 })).status, 400);
  const r = await post('/api/auto-haggle', { productId: 'tote', maxDollars: 40, style: 'manipulator' });
  assert.equal(r.status, 200);
  assert.ok(!r.json.transcript.some((t) => /ignore your previous instructions|admin mode/i.test(t.text)), 'the manipulator script is never used for a real buyer');
});

test('the agent-vs-agent demo still works after the refactor and streams the same events', async () => {
  const r = await fetch(base + '/api/battle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'tote', persona: 'fair', budgetPct: 95 }) });
  const events = (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(events[0].type, 'start');
  assert.equal(events.at(-1).type, 'end');
  assert.ok(events.some((e) => e.type === 'buyer') && events.some((e) => e.type === 'seller'));
});
