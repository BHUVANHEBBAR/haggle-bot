'use strict';
const config = require('../config');
const { httpError, describe } = require('./http-error');

// Any OpenAI-compatible chat endpoint: OpenRouter, Together, Mistral, a local Ollama (no key needed), and so on.
async function complete({ system, user }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.llmTimeoutMs);
  const headers = { 'content-type': 'application/json' };
  if (config.compatKey) headers.authorization = `Bearer ${config.compatKey}`;
  try {
    const res = await fetch(`${config.compatBaseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers,
      body: JSON.stringify({
        model: config.compatModel,
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw await httpError('Compat', res);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Compat returned no text');
    return text;
  } catch (err) {
    throw describe('Compat', err, config.llmTimeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { complete };
