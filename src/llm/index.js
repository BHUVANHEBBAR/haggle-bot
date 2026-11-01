'use strict';
/**
 * One swappable "brain" setting. Providers: gemini | groq | compat (any OpenAI-compatible endpoint) | mock.
 * If a real provider fails (rate limit, timeout, bad JSON), we try the other keys, then the mock,
 * so a demo never dies on stage. A failing provider is retried once (429/5xx) and then paused briefly.
 */
const config = require('../config');
const gemini = require('./gemini');
const groq = require('./groq');
const compat = require('./compat');
const mock = require('./mock');

const providers = { gemini, groq, compat, mock };

function parseJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/```json|```/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

function chain() {
  const first = config.llmProvider;
  const order = [first];
  if (first !== 'gemini' && config.geminiKey) order.push('gemini');
  if (first !== 'groq' && config.groqKey) order.push('groq');
  if (first !== 'compat' && config.compatReady) order.push('compat');
  if (!order.includes('mock')) order.push('mock');
  return order;
}

// ---------- provider health: retry once on 429/5xx, then a circuit breaker ----------
const health = new Map(); // name -> { fails, until }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cooling = (name) => { const h = health.get(name); return !!h && h.until > Date.now(); };
function noteOk(name) { health.delete(name); }
function noteFail(name) {
  const h = health.get(name) || { fails: 0, until: 0 };
  h.fails += 1;
  if (config.llmCooldownMs > 0 && h.fails >= config.llmFailLimit) {
    h.until = Date.now() + config.llmCooldownMs; h.fails = 0;
    console.warn(`[ai] ${name} paused for ${Math.round(config.llmCooldownMs / 1000)}s after repeated failures`);
  }
  health.set(name, h);
}
const retryable = (err) => err && (err.status === 429 || err.status >= 500);
async function callProvider(name, req) {
  try { return await providers[name].complete(req); }
  catch (err) {
    if (name === 'mock' || !retryable(err)) throw err;
    const wait = err.retryAfterMs ? Math.min(err.retryAfterMs, 3000) : config.llmRetryDelayMs * (0.75 + Math.random() * 0.5);
    await sleep(wait); // honour Retry-After (capped), else a jittered single retry
    return providers[name].complete(req);
  }
}

// Outcome of the most recent call, exposed via status() for /api/health.
let lastStatus = null;
function record(result) {
  lastStatus = {
    provider: result.provider,
    fellBack: result.fellBack,
    error: result.error ? String(result.error).slice(0, 200) : null,
    model: providers[result.provider] && providers[result.provider].modelInUse ? providers[result.provider].modelInUse() : null,
    paused: [...health.keys()].filter(cooling),
    at: new Date().toISOString(),
  };
  return result;
}

/**
 * req: { system, user, meta, schema? }  meta is used only by the offline mock brain;
 * schema (optional) is a Gemini responseSchema describing the JSON we expect.
 * Returns { json, provider, fellBack, error? }.
 */
async function completeJson(req) {
  const errors = [];
  const order = chain();
  for (const name of order) {
    if (name !== 'mock' && cooling(name)) { errors.push(`${name}: skipped (paused after repeated failures)`); continue; }
    try {
      const text = await callProvider(name, req);
      const json = parseJson(text);
      if (json && typeof json === 'object') {
        noteOk(name);
        const fellBack = name !== order[0];
        if (fellBack) console.warn(`[ai] fell back to ${name} (${order[0]} failed: ${errors[0] || 'unknown'})`);
        return record({ json, provider: name, fellBack, error: errors[0] });
      }
      errors.push(`${name}: unparseable reply`);
      if (name !== 'mock') noteFail(name);
      console.warn(`[ai] ${name} failed: unparseable reply`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      if (name !== 'mock') noteFail(name);
      console.warn(`[ai] ${name} failed: ${err.message}`);
    }
  }
  return record({ json: null, provider: 'none', fellBack: true, error: errors.join(' | ') });
}

const resetHealth = () => { health.clear(); lastStatus = null; };

module.exports = { completeJson, parseJson, activeProvider: () => config.llmProvider, status: () => lastStatus, resetHealth };
