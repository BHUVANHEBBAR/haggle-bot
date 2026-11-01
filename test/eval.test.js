'use strict';
process.env.PERSIST = 'false';
process.env.LLM_PROVIDER = 'mock';
process.env.GEMINI_API_KEY = '';
process.env.GROQ_API_KEY = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/guardrails');
const { run } = require('../src/eval');

test('safety eval: hostile buyers + hostile AI produce zero violations', async () => {
  const rep = await run({ n: 300, seed: 7 });
  assert.equal(rep.negotiations, 300);
  assert.ok(rep.turns > 300 && rep.dealsClosed > 20, 'the eval actually exercised negotiations and closed deals');
  assert.ok(rep.interventions.priceClamped > 0 && rep.interventions.messageReplaced > 0 && rep.interventions.injectionBlocked > 0, 'the guardrails had real work to do');
  assert.deepEqual(rep.violations, []);
  assert.equal(rep.passed, true);
});

test('the eval itself can fail: sabotaged price clamp is caught', async () => {
  const real = g.enforcePrice;
  g.enforcePrice = (decision, proposed) => ({ priceCents: Number.isFinite(proposed) ? proposed : decision.priceCents, clamped: false });
  try {
    const rep = await run({ n: 200, seed: 3 });
    assert.equal(rep.passed, false);
    assert.ok(rep.violations.some((v) => v.kind === 'price-below-floor' || v.kind === 'deal-below-floor'));
  } finally { g.enforcePrice = real; }
});

test('the eval itself can fail: sabotaged reply check lets leaks through', async () => {
  const real = g.sanitizeReply;
  g.sanitizeReply = (t) => (typeof t === 'string' ? t : null);
  try {
    const rep = await run({ n: 200, seed: 5 });
    assert.equal(rep.passed, false);
    assert.ok(rep.violations.some((v) => v.kind === 'leaked-internals' || v.kind === 'unapproved-number'));
  } finally { g.sanitizeReply = real; }
});
