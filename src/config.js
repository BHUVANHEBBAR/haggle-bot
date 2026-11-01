'use strict';
// Tiny .env loader (no dependencies). Real environment variables always win.
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(path.join(__dirname, '..', '.env'));

const e = process.env;
const config = {
  get port() { return Number(e.PORT || 3000); },
  get baseUrl() { return (e.BASE_URL || `http://localhost:${this.port}`).replace(/\/$/, ''); },

  get paypalClientId() { return (e.PAYPAL_CLIENT_ID || '').trim(); },
  get paypalClientSecret() { return (e.PAYPAL_CLIENT_SECRET || '').trim(); },
  get paypalWebhookId() { return (e.PAYPAL_WEBHOOK_ID || '').trim(); },
  // HaggleBot only ever talks to the PayPal SANDBOX. PAYPAL_ENVIRONMENT exists so that intent is explicit and checked.
  get paypalEnvironment() { return (e.PAYPAL_ENVIRONMENT || 'sandbox').trim().toLowerCase(); },
  get paypalApiBase() { return 'https://api-m.sandbox.paypal.com'; }, // SANDBOX ONLY by design
  get paypalLive() { return !!(this.paypalClientId && this.paypalClientSecret); },

  get geminiKey() { return (e.GEMINI_API_KEY || '').trim(); },
  get geminiModel() { return e.GEMINI_MODEL || 'gemini-flash-latest'; },
  get groqKey() { return (e.GROQ_API_KEY || '').trim(); },
  get groqModel() { return (e.GROQ_MODEL || '').trim() || 'openai/gpt-oss-120b'; },
  // AI call behaviour: per-call timeout, one retry on 429/5xx, and a circuit breaker per provider
  get llmTimeoutMs() { return Number(e.LLM_TIMEOUT_MS || 10000); },
  get llmRetryDelayMs() { return Number(e.LLM_RETRY_DELAY_MS || 400); },
  get llmFailLimit() { return Number(e.LLM_FAIL_LIMIT || 2); },        // consecutive failures before cooling down
  get llmCooldownMs() { return Number(e.LLM_COOLDOWN_MS ?? 60000); },   // 0 disables the breaker
  // Any OpenAI-compatible endpoint (OpenRouter, Together, local Ollama, ...). Key is optional (Ollama needs none).
  get compatBaseUrl() { return (e.LLM_BASE_URL || '').trim().replace(/\/$/, ''); },
  get compatKey() { return (e.LLM_API_KEY || '').trim(); },
  get compatModel() { return (e.LLM_MODEL || '').trim(); },
  get compatReady() { return !!(this.compatBaseUrl && this.compatModel); },
  // Which AI provider is actually used. Falls back to the scripted "mock" brain with no keys.
  get llmProvider() {
    const want = (e.LLM_PROVIDER || '').trim().toLowerCase();
    if (want === 'mock') return 'mock';
    if (want === 'gemini' && this.geminiKey) return 'gemini';
    if (want === 'groq' && this.groqKey) return 'groq';
    if (want === 'compat' && this.compatReady) return 'compat';
    if (this.geminiKey) return 'gemini';
    if (this.groqKey) return 'groq';
    if (this.compatReady) return 'compat';
    return 'mock';
  },

  // Where PayPal sends buyers back to: the React app (the original pages are still served at /index.html etc.)
  // Multiplies every per-IP rate limit (tests and load checks set it higher; leave at 1 in production)
  get rateLimitMultiplier() { return Math.max(1, Number(e.RATE_LIMIT_MULTIPLIER || 1)); },
  get uiBase() { return e.UI_BASE || '/app/'; },
  get sellerKey() { return e.SELLER_KEY || 'change-me'; },
  get sessionSecret() { return e.SESSION_SECRET || ''; },
  // true behind a reverse proxy that sets x-forwarded-for (Render): then the client address is the first hop
  get trustProxy() { return e.TRUST_PROXY === 'true'; },
  // this is a sandbox-only demo with no mail service, so the one-time buyer code is shown on screen; set false to hide it
  get buyerDemoCodes() { return e.BUYER_DEMO_CODES !== 'false'; },
  get dataDir() { return e.DATA_DIR || path.join(__dirname, '..', 'data'); },
  get persist() { return e.PERSIST !== 'false'; },
  get mockDuplicateWebhooks() { return e.MOCK_DUPLICATE_WEBHOOKS !== 'false'; },
  get dealTtlMinutes() { return Number(e.DEAL_TTL_MINUTES || 15); },
};

module.exports = config;
