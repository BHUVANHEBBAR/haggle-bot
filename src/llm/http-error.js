'use strict';
// Builds a short, key-free error for a failed provider HTTP response.
async function httpError(name, res) {
  let detail = '';
  try {
    const data = await res.json();
    detail = String(data?.error?.message || data?.error || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  } catch { /* body was not JSON */ }
  const err = new Error(`${name} HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  err.status = res.status; // lets the caller decide whether a retry makes sense
  const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
  if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = ra * 1000; // sent by Groq on 429
  return err;
}

// AbortController timeouts surface as a vague "aborted"; make them readable.
function describe(name, err, ms) {
  return err && err.name === 'AbortError' ? new Error(`${name} timed out after ${ms / 1000}s`) : err;
}

module.exports = { httpError, describe };
