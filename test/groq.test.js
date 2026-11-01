'use strict';
// Groq client: model self-healing, request shape (strict schema, reasoning effort), Retry-After.
process.env.PERSIST = 'false';
process.env.LLM_RETRY_DELAY_MS = '0';
process.env.LLM_COOLDOWN_MS = '0';
process.env.GROQ_API_KEY = 'groq-key';
process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
process.env.GEMINI_API_KEY = '';
process.env.LLM_BASE_URL = '';
process.env.LLM_PROVIDER = 'groq';

const test = require('node:test');
const assert = require('node:assert/strict');
const groq = require('../src/llm/groq');
const llm = require('../src/llm');
const { toJsonSchema } = require('../src/llm/schema');

const realFetch = global.fetch;
const realWarn = console.warn;
let calls = [];
let handler;
const resp = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const chatOk = { status: 200, body: { choices: [{ message: { content: '{"price": 41.5, "message": "Sure, $41.50."}' } }] } };
const SCHEMA = { type: 'OBJECT', properties: { price: { type: 'NUMBER' }, message: { type: 'STRING' } }, required: ['price', 'message'] };
const req = { system: 's', user: 'u', schema: SCHEMA };
const bodyOf = (c) => JSON.parse(c.opts.body);

test.beforeEach(() => {
  calls = []; groq._reset(); llm.resetHealth(); console.warn = () => {};
  global.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); const r = handler(String(url), calls.length); return resp(r.status, r.body, r.headers); };
});
test.afterEach(() => { console.warn = realWarn; });
test.after(() => { global.fetch = realFetch; });

test('gpt-oss gets a strict JSON schema, short reasoning and a roomy token cap', async () => {
  handler = () => chatOk;
  await groq.complete(req);
  const b = bodyOf(calls[0]);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer groq-key');
  assert.equal(b.model, 'openai/gpt-oss-120b');
  assert.equal(b.reasoning_effort, 'low');
  assert.equal(b.max_completion_tokens, 1200);
  assert.equal(b.max_tokens, undefined);
  assert.equal(b.response_format.type, 'json_schema');
  assert.equal(b.response_format.json_schema.strict, true);
  assert.deepEqual(b.response_format.json_schema.schema, {
    type: 'object', properties: { price: { type: 'number' }, message: { type: 'string' } }, required: ['price', 'message'], additionalProperties: false,
  });
});

test('a model without reasoning or strict schemas gets the plain request shape', async () => {
  process.env.GROQ_MODEL = 'llama-3.3-70b-versatile';
  try {
    handler = () => chatOk;
    await groq.complete(req);
    const b = bodyOf(calls[0]);
    assert.equal(b.reasoning_effort, undefined);
    assert.equal(b.max_tokens, 400);
    assert.equal(b.response_format.type, 'json_object');
  } finally { process.env.GROQ_MODEL = 'openai/gpt-oss-120b'; }
});

test('a model this key cannot use is replaced by one it can, and the choice is remembered', async () => {
  process.env.GROQ_MODEL = 'llama-3.3-70b-versatile';
  try {
    handler = (url) => {
      if (url.endsWith('/models')) return { status: 200, body: { data: [{ id: 'whisper-large-v3' }, { id: 'openai/gpt-oss-20b' }, { id: 'qwen/qwen3.8-27b' }] } };
      const model = JSON.parse(calls.at(-1).opts.body).model;
      return model === 'llama-3.3-70b-versatile'
        ? { status: 404, body: { error: { message: 'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.', code: 'model_not_found' } } }
        : chatOk;
    };
    const text = await groq.complete(req);
    assert.match(text, /41\.5/);
    const chats = calls.filter((c) => c.url.endsWith('/chat/completions')).map((c) => bodyOf(c).model);
    assert.deepEqual(chats, ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b']);
    assert.equal(groq.modelInUse(), 'openai/gpt-oss-20b');
    calls = [];
    await groq.complete(req);
    assert.deepEqual(calls.map((c) => bodyOf(c).model), ['openai/gpt-oss-20b'], 'next call goes straight to the working model, no new discovery');
  } finally { process.env.GROQ_MODEL = 'openai/gpt-oss-120b'; }
});

test('if no listed model is usable the original error is reported', async () => {
  handler = (url) => (url.endsWith('/models') ? { status: 200, body: { data: [{ id: 'whisper-large-v3' }] } } : { status: 404, body: { error: { message: 'model does not exist' } } });
  await assert.rejects(() => groq.complete(req), /does not exist/);
});

test('strict schema rejected with 400 falls back to plain JSON mode', async () => {
  handler = () => (JSON.parse(calls.at(-1).opts.body).response_format.type === 'json_schema' ? { status: 400, body: { error: { message: 'schema not supported' } } } : chatOk);
  await groq.complete(req);
  assert.deepEqual(calls.map((c) => bodyOf(c).response_format.type), ['json_schema', 'json_object']);
});

test('Retry-After on a 429 is read from the header', async () => {
  handler = () => ({ status: 429, body: { error: { message: 'rate limited' } }, headers: { 'retry-after': '2' } });
  await assert.rejects(() => groq.complete(req), (e) => e.status === 429 && e.retryAfterMs === 2000);
});

test('through the chain: a 429 is retried and then answered; status reports the model', async () => {
  handler = (url, n) => (n === 1 ? { status: 429, body: { error: { message: 'slow down' } }, headers: { 'retry-after': '0' } } : chatOk);
  const r = await llm.completeJson({ system: 's', user: 'u', schema: SCHEMA, meta: { task: 'seller', action: 'chat', priceCents: 4800, productName: 'Tote', round: 0 } });
  assert.equal(r.provider, 'groq');
  assert.equal(r.fellBack, false);
  assert.equal(llm.status().model, 'openai/gpt-oss-120b');
});

test('toJsonSchema converts our Gemini-style schema without mutating it', () => {
  const before = JSON.stringify(SCHEMA);
  const s = toJsonSchema({ type: 'OBJECT', properties: { a: { type: 'ARRAY', items: { type: 'STRING' } } } });
  assert.deepEqual(s, { type: 'object', properties: { a: { type: 'array', items: { type: 'string' } } }, required: ['a'], additionalProperties: false });
  assert.equal(JSON.stringify(SCHEMA), before);
});
