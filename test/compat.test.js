'use strict';
// OpenAI-compatible alternate provider, against a stubbed network.
process.env.PERSIST = 'false';
process.env.LLM_RETRY_DELAY_MS = '0';   // keep retries instant in tests
process.env.LLM_COOLDOWN_MS = '0';      // circuit breaker has its own test file
process.env.GEMINI_API_KEY = 'gem-key';
process.env.GROQ_API_KEY = '';
process.env.LLM_PROVIDER = 'gemini';
process.env.LLM_BASE_URL = 'https://alt.example.com/v1/';
process.env.LLM_API_KEY = 'alt-key';
process.env.LLM_MODEL = 'alt-model';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const llm = require('../src/llm');

const realFetch = global.fetch;
let calls = [];
let handler;
const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
test.beforeEach(() => {
  calls = [];
  global.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); const r = handler(String(url)); return resp(r.status, r.body); };
});
test.after(() => { global.fetch = realFetch; });

const req = { system: 's', user: 'u', meta: { task: 'seller', action: 'chat', priceCents: 4800, productName: 'Tote', round: 0 } };
const altOk = { status: 200, body: { choices: [{ message: { content: '{"price": 41.5, "message": "Sure, $41.50."}' } }] } };
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test('config picks up the compat provider and trims the base URL', () => {
  assert.equal(config.compatReady, true);
  assert.equal(config.compatBaseUrl, 'https://alt.example.com/v1');
});

test('when Gemini fails the alternate answers (not the offline brain)', async () => {
  handler = (url) => url.includes('generativelanguage') ? { status: 503, body: { error: { message: 'overloaded' } } } : altOk;
  const r = await quiet(() => llm.completeJson(req));
  assert.equal(r.provider, 'compat');
  assert.equal(r.fellBack, true);
  assert.match(r.error, /overloaded/);
  assert.equal(r.json.price, 41.5);
  const alt = calls.find((c) => c.url.startsWith('https://alt.example.com'));
  assert.equal(alt.url, 'https://alt.example.com/v1/chat/completions');
  assert.equal(alt.opts.headers.authorization, 'Bearer alt-key');
  assert.equal(JSON.parse(alt.opts.body).model, 'alt-model');
  assert.ok(!alt.url.includes('alt-key'), 'key never in the URL');
  assert.equal(llm.status().provider, 'compat');
});

test('if both fail the offline brain still answers and the errors are kept', async () => {
  handler = (url) => url.includes('generativelanguage') ? { status: 503, body: { error: { message: 'overloaded' } } } : { status: 401, body: { error: { message: 'bad key' } } };
  const r = await quiet(() => llm.completeJson(req));
  assert.equal(r.provider, 'mock');
  assert.match(r.error, /overloaded/);
  assert.match(llm.status().error, /overloaded/);
});

test('compat can be the primary provider, with no key (local Ollama style)', async () => {
  process.env.LLM_PROVIDER = 'compat';
  process.env.LLM_API_KEY = '';
  handler = () => altOk;
  const r = await llm.completeJson(req);
  assert.equal(r.provider, 'compat');
  assert.equal(r.fellBack, false);
  assert.equal(calls[0].opts.headers.authorization, undefined);
});
