'use strict';
const config = require('../config');
const { httpError, describe } = require('./http-error');

// schema (optional): a Gemini responseSchema so the model must return exactly the JSON fields we read.
async function complete({ system, user, schema }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.llmTimeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 800, responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) },
      }),
    });
    if (!res.ok) throw await httpError('Gemini', res);
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('');
    if (!text) throw new Error('Gemini returned no text');
    return text;
  } catch (err) {
    throw describe('Gemini', err, config.llmTimeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { complete };
