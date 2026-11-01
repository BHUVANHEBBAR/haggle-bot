'use strict';
process.env.PERSIST = 'false';
process.env.LLM_PROVIDER = 'mock';
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
process.env.GEMINI_API_KEY = '';
process.env.GROQ_API_KEY = '';
process.env.SELLER_KEY = 'test-key';
process.env.PORT = '0';
process.env.RATE_LIMIT_MULTIPLIER = '50';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'haggle-persona-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const personas = require('../src/personas');
const g = require('../src/guardrails');
const { start, server } = require('../src/server');
const store = require('../src/store');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

const j = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
};
const seller = { 'x-seller-key': 'test-key' };

test('the default personality keeps today\'s pacing exactly', () => {
  assert.deepEqual(personas.progressFor('friendly'), g.PROGRESS);
  assert.equal(personas.DEFAULT, 'friendly');
  assert.equal(personas.get('nonsense').label, 'Friendly', 'an unknown key falls back to the default');
  assert.equal(personas.isValid('constructor'), false, 'prototype keys are not personalities');
});

test('pacing tables are valid: 6 steps, between 0 and 1, never going back, reaching the floor by the end', () => {
  for (const k of personas.KEYS) {
    const p = personas.progressFor(k);
    assert.equal(p.length, 6, k);
    for (let i = 0; i < 6; i++) {
      assert.ok(p[i] >= 0 && p[i] <= 1, `${k} step ${i}`);
      if (i) assert.ok(p[i] >= p[i - 1], `${k} must not move back at step ${i}`);
    }
    assert.ok(p[5] === 1, `${k} reaches the floor at the last round`);
    assert.ok(p[4] >= 0.9, `${k} is close to the floor by round 5`);
  }
});

test('every canned line passes the reply checks: no leaky words, only the prices it was given', () => {
  const ctx = { name: 'Handwoven Block-Print Tote', priceCents: 4200, minCents: 4200, listCents: 4800, q: 1 };
  const allowed = [4200, 4800];
  for (const k of personas.KEYS) {
    const lines = [personas.openingLine(k, { name: ctx.name, listCents: 4800, q: 1 }), personas.openingLine(k, { name: ctx.name, listCents: 4800, q: 3 })];
    for (const kind of ['accept', 'counter', 'final', 'walk', 'injection', 'chat']) {
      const n = personas.get(k).lines[kind].length;
      for (let s = 0; s < n; s++) lines.push(personas.line(k, kind, ctx, s));
    }
    for (const action of ['accept', 'walk_away', 'chat']) lines.push(personas.fallbackLine(k, { action, priceCents: 4200 }, ctx.name));
    for (const final of [true, false]) lines.push(personas.fallbackLine(k, { action: 'counter', final, priceCents: 4200 }, ctx.name));
    for (const l of lines) {
      assert.ok(g.sanitizeReply(l, allowed), `${k}: "${l}" would be rejected by sanitizeReply`);
      assert.ok(l.length <= 220, `${k}: line too long`);
    }
    assert.ok(!/floor|margin|cost|reserve|wholesale|instruction/i.test(personas.voiceFor(k)), `${k} voice text`);
  }
});

test('whatever the personality, no offer below the floor is accepted and no counter dips below it', () => {
  const sweepOffers = (list) => { const o = []; for (let c = 1; c <= list + 500; c += Math.max(1, Math.round(list / 250))) o.push(c); return o; };
  for (const k of personas.KEYS) {
    const progress = personas.progressFor(k);
    for (const product of store.state.products) {
      for (const qty of [1, 3]) {
        const floor = g.effectiveFloorCents(product, qty);
        for (let round = 1; round <= 6; round++) {
          for (const offerCents of sweepOffers(product.listCents)) {
            const d = g.decide({ product, qty, round, offerCents, askCents: product.listCents, progress });
            if (d.action === 'accept') assert.ok(d.priceCents >= floor, `${k} ${product.id} accepted ${d.priceCents} < floor ${floor}`);
            if (d.action === 'counter') {
              assert.ok(d.minCents >= floor, `${k} ${product.id} counter ${d.minCents} < floor ${floor}`);
              assert.ok(d.minCents <= d.maxCents && d.maxCents <= product.listCents);
            }
          }
          const e = g.enforcePrice({ action: 'counter', minCents: g.counterCents(product, qty, round, progress), maxCents: product.listCents, priceCents: 0 }, 1, product, qty);
          assert.ok(e.priceCents >= floor, `${k} an AI price of one cent is clamped up to at least the floor`);
        }
      }
    }
  }
});

test('Firm holds the price longer than Friendly, and Generous comes down faster, in every round', () => {
  for (const product of store.state.products) {
    for (let round = 1; round <= 6; round++) {
      const firm = g.counterCents(product, 1, round, personas.progressFor('firm'));
      const friendly = g.counterCents(product, 1, round, personas.progressFor('friendly'));
      const generous = g.counterCents(product, 1, round, personas.progressFor('generous'));
      assert.ok(firm >= friendly && friendly >= generous, `${product.id} round ${round}: ${firm} / ${friendly} / ${generous}`);
    }
  }
  const tote = store.getProduct('tote');
  assert.ok(g.counterCents(tote, 1, 1, personas.progressFor('firm')) > g.counterCents(tote, 1, 1, personas.progressFor('generous')), 'round 1 really differs');
});

test('the seller can choose a personality; an unknown one is refused; buyers see who they chat with but not the pacing', async () => {
  const bad = await j('PUT', '/api/seller/products/lamp', { persona: 'pirate' }, seller);
  assert.equal(bad.status, 400);
  assert.equal(store.getProduct('lamp').persona, 'friendly', 'nothing changed');
  const ok = await j('PUT', '/api/seller/products/lamp', { persona: 'trader' }, seller);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.product.persona, 'trader');
  assert.equal((await j('PUT', '/api/seller/products/lamp', { persona: 'trader' })).status, 401, 'needs the seller key');

  const pub = await j('GET', '/api/products');
  const lamp = pub.json.products.find((p) => p.id === 'lamp');
  assert.deepEqual(lamp.haggler, { key: 'trader', label: 'Market trader', emoji: '🧺' });
  assert.ok(!/progress|pacing|persona"/i.test(JSON.stringify(pub.json)), 'no pacing numbers reach buyers');

  const cat = await j('GET', '/api/seller/personas', null, seller);
  assert.equal(cat.status, 200);
  assert.equal(cat.json.personas.length, personas.KEYS.length);
  assert.equal(cat.json.personas[0].progress.length, 6);
  assert.equal((await j('GET', '/api/seller/personas')).status, 401);
  await j('PUT', '/api/seller/products/lamp', { persona: 'friendly' }, seller);
});

test('the opening line is in the chosen voice and the chat keeps that personality even if the seller changes it mid-chat', async () => {
  await j('PUT', '/api/seller/products/tote', { persona: 'firm' }, seller);
  const start1 = await j('POST', '/api/chat/start', { productId: 'tote' });
  assert.match(start1.json.message, /^Hello\. The Handwoven Block-Print Tote is \$48\.00/);
  assert.equal(start1.json.product.haggler.key, 'firm');

  await j('PUT', '/api/seller/products/tote', { persona: 'generous' }, seller); // changed after the chat began
  const reply = await j('POST', '/api/chat/message', { sessionId: start1.json.sessionId, text: 'I can pay $5' });
  const tote = store.getProduct('tote');
  assert.equal(reply.json.priceCents, g.counterCents(tote, 1, 1, personas.progressFor('firm')), 'still the Firm ladder');
  assert.notEqual(reply.json.priceCents, g.counterCents(tote, 1, 1, personas.progressFor('generous')));

  const start2 = await j('POST', '/api/chat/start', { productId: 'tote' });
  assert.match(start2.json.message, /^Hi there, so glad you stopped by!/, 'a new chat uses the new personality');
  await j('PUT', '/api/seller/products/tote', { persona: 'friendly' }, seller);
});

test('the playground preview follows the personality, and the floor is the same for all of them', async () => {
  const body = { productId: 'tote', listPrice: 48, costPrice: 18, minMarginPct: 25, maxDiscountPct: 25, stock: 5, qty: 1 };
  const firm = (await j('POST', '/api/seller/simulate', { ...body, persona: 'firm' }, seller)).json;
  const generous = (await j('POST', '/api/seller/simulate', { ...body, persona: 'generous' }, seller)).json;
  assert.equal(firm.floorCents, generous.floorCents);
  assert.ok(firm.ladder[0].askCents > generous.ladder[0].askCents);
  assert.equal((await j('POST', '/api/seller/simulate', { ...body, persona: 'pirate' }, seller)).status, 400);
});

test('the offline brain speaks in each voice and a deal records which personality closed it', async () => {
  for (const key of personas.KEYS) {
    await j('PUT', '/api/seller/products/tote', { persona: key }, seller);
    const s = (await j('POST', '/api/chat/start', { productId: 'tote' })).json;
    let last;
    for (const text of ['I can pay $5', 'How about $30?', 'Okay, final offer $40', 'deal']) {
      last = (await j('POST', '/api/chat/message', { sessionId: s.sessionId, text })).json;
      if (last.deal) break;
    }
    assert.ok(last.message.length > 0);
    if (last.deal) assert.equal(store.getDeal(last.deal.id).persona, key);
  }
  await j('PUT', '/api/seller/products/tote', { persona: 'friendly' }, seller);
});
