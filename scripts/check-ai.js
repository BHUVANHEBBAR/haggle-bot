'use strict';
// Diagnoses why Gemini is (not) being called. Never prints key values.
const config = require('../src/config');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const key = config.geminiKey;
const withTimeout = (opts = {}) => ({ ...opts, signal: AbortSignal.timeout(15000) });
const redact = (s) => (key ? String(s).split(key).join('[redacted]') : String(s));

async function main() {
  console.log(`Selected provider : ${config.llmProvider}`);
  console.log(`GEMINI_API_KEY set: ${!!config.geminiKey}`);
  console.log(`GROQ_API_KEY set  : ${!!config.groqKey}`);
  console.log(`Gemini model      : ${config.geminiModel}`);
  if (!key) return 'Gemini failing because: no GEMINI_API_KEY is set';

  let verdict = null;
  let suggest = null;

  // b. one real generateContent call
  try {
    const res = await fetch(`${BASE}/models/${encodeURIComponent(config.geminiModel)}:generateContent`, withTimeout({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with the JSON {"ok":true}' }] }],
        generationConfig: { maxOutputTokens: 50, responseMimeType: 'application/json' },
      }),
    }));
    const data = await res.json().catch(() => ({}));
    const msg = redact(data?.error?.message || '');
    console.log(`generateContent   : HTTP ${res.status}${data?.error?.status ? ` ${data.error.status}` : ''}${msg ? ` - ${msg}` : ''}`);
    if (res.ok) verdict = 'Gemini OK';
    else if (res.status === 404) verdict = 'Gemini failing because: wrong model name (not found / not supported)';
    else if (res.status === 429) verdict = 'Gemini failing because: quota / rate limit';
    else if (res.status === 503 || res.status === 500) verdict = `Gemini failing because: Google side overloaded/unavailable (HTTP ${res.status}), key and model name are fine`;
    else if (res.status === 403 || (res.status === 400 && /api key/i.test(msg))) verdict = 'Gemini failing because: invalid or unauthorised API key';
    else verdict = `Gemini failing because: HTTP ${res.status} ${msg}`.trim();
  } catch (err) {
    verdict = `Gemini failing because: network error (${redact(err.message)})`;
  }

  // c. models that support generateContent and contain "flash"
  try {
    const names = [];
    let pageToken = '';
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${BASE}/models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, withTimeout({ headers: { 'x-goog-api-key': key } }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { console.log(`models list       : HTTP ${res.status} ${redact(data?.error?.message || '')}`); break; }
      for (const m of data.models || []) {
        if ((m.supportedGenerationMethods || []).includes('generateContent') && /flash/i.test(m.name)) names.push(m.name.replace(/^models\//, ''));
      }
      pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    }
    console.log(`flash models (generateContent):\n  ${names.join('\n  ') || '(none listed)'}`);
    const ver = (n) => parseFloat(n.match(/^gemini-([\d.]+)-flash$/)[1]);
    const stable = names.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => ver(b) - ver(a));
    suggest = stable[0] || names[0] || null; // newest stable flash model
  } catch (err) {
    console.log(`models list       : network error (${redact(err.message)})`);
  }

  if (/wrong model name/.test(verdict) && suggest) verdict += `. Put GEMINI_MODEL=${suggest} in .env`;
  return verdict;
}

// ---------- Groq: which models can this key use, and does the configured one answer? ----------
const GROQ = 'https://api.groq.com/openai/v1';
const PREFERRED = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
async function checkGroq() {
  console.log('\n--- Groq ---');
  const gk = config.groqKey;
  if (!gk) return 'no GROQ_API_KEY set (optional)';
  const hide = (s) => String(s).split(gk).join('[redacted]');
  try {
    const list = await fetch(`${GROQ}/models`, { headers: { authorization: `Bearer ${gk}` }, signal: AbortSignal.timeout(15000) });
    const data = await list.json().catch(() => ({}));
    if (!list.ok) return `Groq failing because: HTTP ${list.status} ${hide(data?.error?.message || '')}`.trim();
    const ids = (data.data || []).map((m) => m.id).sort();
    console.log(`models this key can use (${ids.length}): ${ids.join(', ')}`);
    const wanted = config.groqModel;
    console.log(`configured model  : ${wanted} (${ids.includes(wanted) ? 'available' : 'NOT available to this key'})`);
    const best = PREFERRED.find((m) => ids.includes(m));
    const use = ids.includes(wanted) ? wanted : best;
    if (!use) return 'Groq failing because: none of the models HaggleBot knows how to use are available to this key';
    const t0 = Date.now();
    const res = await fetch(`${GROQ}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gk}` },
      body: JSON.stringify({ model: use, max_completion_tokens: 600, reasoning_effort: /gpt-oss|qwen3/.test(use) ? 'low' : undefined, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: 'Reply with the JSON {"ok":true}' }] }),
    });
    const body = await res.json().catch(() => ({}));
    console.log(`chat call (${use}): HTTP ${res.status} in ${Date.now() - t0}ms${res.ok ? '' : ` - ${hide(body?.error?.message || '')}`}`);
    if (!res.ok) return `Groq failing because: HTTP ${res.status} ${hide(body?.error?.message || '')}`.trim();
    return ids.includes(wanted) ? `Groq OK (${wanted})` : `Groq OK, but GROQ_MODEL="${wanted}" is not available to your key. HaggleBot will auto-switch; to make it permanent put GROQ_MODEL=${use} in .env`;
  } catch (err) {
    return `Groq failing because: network error (${hide(err.message)})`;
  }
}

(async () => {
  const g = await main();
  const q = await checkGroq();
  console.log(`\nVERDICT gemini: ${g}`);
  console.log(`VERDICT groq  : ${q}`);
})().catch((e) => { console.error(`VERDICT: script error: ${redact(e.message)}`); process.exit(1); });
