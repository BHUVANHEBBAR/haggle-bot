'use strict';
// Retry, circuit breaker and structured output, against a stubbed network.
process.env.PERSIST = 'false';
process.env.LLM_RETRY_DELAY_MS = '0';
process.env.LLM_FAIL_LIMIT = '2';
process.env.LLM_COOLDOWN_MS = '60000';
process.env.GEMINI_API_KEY = 'gem-key';
process.env.GROQ_API_KEY = '';
process.env.LLM_BASE_URL = '';
process.env.LLM_PROVIDER = 'gemini';

const test = require('node:test');
const assert = require('node:assert/strict');
const llm = require('../src/llm');

const realFetch = global.fetch;
const realWarn = console.warn;
let calls = [];
let handler;
const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = { status: 200, body: { candidates: [{ content: { parts: [{ text: '{"price": 41.5, "message": "Sure, $41.50."}' }] } }] } };
const down = { status: 503, body: { error: { message: 'overloaded' } } };
const req = { system: 's', user: 'u', meta: { task: 'seller', action: 'chat', priceCents: 4800, productName: 'Tote', round: 0 } };

test.beforeEach(() => {
  calls = []; llm.resetHealth(); console.warn = () => {};
  global.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); const r = handler(calls.length); return resp(r.status, r.body); };
});
test.afterEach(() => { console.warn = realWarn; });
test.after(() => { global.fetch = realFetch; });

test('a single 503 is retried once and the real model still answers', async () => {
  handler = (n) => (n === 1 ? down : ok);
  const r = await llm.completeJson(req);
  assert.equal(r.provider, 'gemini');
  assert.equal(r.fellBack, false);
  assert.equal(calls.length, 2, 'one retry');
});

test('a 400 is not retried (it would fail again)', async () => {
  handler = () => ({ status: 400, body: { error: { message: 'bad request' } } });
  const r = await llm.completeJson(req);
  assert.equal(r.provider, 'mock');
  assert.equal(calls.length, 1);
});

test('after repeated failures the provider is paused, then skipped without a network call', async () => {
  handler = () => down;
  await llm.completeJson(req); // fail 1 (with its retry)
  await llm.completeJson(req); // fail 2 -> breaker opens
  const before = calls.length;
  const r = await llm.completeJson(req);
  assert.equal(calls.length, before, 'no network call while paused');
  assert.equal(r.provider, 'mock');
  assert.match(r.error, /paused/);
  assert.deepEqual(llm.status().paused, ['gemini']);
});

test('a success clears the failure count', async () => {
  handler = () => down;
  await llm.completeJson(req);
  handler = () => ok;
  await llm.completeJson(req);
  handler = () => down;
  const r = await llm.completeJson(req); // only 1 consecutive failure again, breaker still closed
  assert.deepEqual(llm.status().paused, []);
  assert.equal(r.provider, 'mock');
});

test('seller and buyer requests ask Gemini for structured JSON', async () => {
  handler = () => ok;
  await llm.completeJson({ ...req, schema: { type: 'OBJECT', properties: { price: { type: 'NUMBER' } } } });
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseSchema.type, 'OBJECT');
});
