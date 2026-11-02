'use strict';
const config = require('../config');
const { httpError, describe } = require('./http-error');
const { toJsonSchema } = require('./schema');

// Groq exposes an OpenAI-compatible endpoint. Which models a key can use differs per account
// (for example llama-3.3-70b-versatile is enterprise-only for many keys), so we self-heal.
const BASE = 'https://api.groq.com/openai/v1';
const PREFERRED = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const STRICT_SCHEMA = /^(openai\/gpt-oss-(20b|120b)|qwen\/qwen3)/; // models with constrained-decoding structured outputs
const REASONING = /^(openai\/gpt-oss|qwen\/qwen3)/;                // reasoning models: keep the hidden thinking short
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

let substitute = null; // { model, at } used when the configured model is not available to this key

const missing = (err) => err && (err.status === 404 || /does not exist|model_not_found|decommissioned|not found/i.test(err.message));
const modelInUse = () => (substitute && Date.now() - substitute.at < DISCOVERY_TTL_MS ? substitute.model : config.groqModel);

async function call(model, { system, user, schema, temperature }, useSchema) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.llmTimeoutMs);
  const body = {
    model,
    temperature: temperature ?? 0.7,
    ...(REASONING.test(model) ? { reasoning_effort: 'low', max_completion_tokens: 1200 } : { max_tokens: 400 }),
    response_format: useSchema && schema && STRICT_SCHEMA.test(model)
      ? { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: toJsonSchema(schema) } }
      : { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.groqKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await httpError('Groq', res);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq returned no text');
    return text;
  } catch (err) {
    throw describe('Groq', err, config.llmTimeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

// Ask Groq which models this key can use and pick the best one we know how to talk to.
async function discover(wanted) {
  const res = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${config.groqKey}` }, signal: AbortSignal.timeout(config.llmTimeoutMs) });
  if (!res.ok) return null;
  const ids = ((await res.json()).data || []).map((m) => m.id);
  return PREFERRED.find((m) => ids.includes(m) && m !== wanted) || null;
}

async function complete(req) {
  const model = modelInUse();
  try {
    return await withSchemaFallback(model, req);
  } catch (err) {
    if (!missing(err)) throw err;
    const sub = await discover(model).catch(() => null);
    if (!sub) throw err;
    console.warn(`[ai] groq model "${model}" is not available to this key, using "${sub}" (set GROQ_MODEL=${sub})`);
    substitute = { model: sub, at: Date.now() };
    return withSchemaFallback(sub, req);
  }
}

// If strict structured output is rejected for any reason, retry once in plain JSON mode.
async function withSchemaFallback(model, req) {
  try { return await call(model, req, true); }
  catch (err) {
    if (err.status === 400 && req.schema && STRICT_SCHEMA.test(model)) return call(model, req, false);
    throw err;
  }
}

module.exports = { complete, modelInUse, _reset: () => { substitute = null; } };
