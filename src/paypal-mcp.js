'use strict';
/**
 * Minimal client for PayPal's remote MCP server (sandbox) over the SSE transport, using only fetch.
 *   GET  {base}/sse           opens an event stream; the first event ("endpoint") names where to POST JSON-RPC
 *   POST {base}{endpoint}     initialize, tools/list, tools/call (answers arrive on the stream)
 * Auth is the same client-credentials access token the rest of the app already uses.
 *
 * Connecting and listing tools works. Executing tools is a separate question (it can fail on PayPal's side),
 * so selfTest() checks BOTH, and the tool layer only uses MCP while execution really works.
 */
const config = require('./config');
const { getAccessToken } = require('./paypal');

const base = () => (process.env.PAYPAL_MCP_URL || 'https://mcp.sandbox.paypal.com').replace(/\/$/, '');
const enabled = () => config.paypalLive && process.env.PAYPAL_MCP !== 'off';

class McpError extends Error {
  constructor(message, { code, status, setup } = {}) { super(message); this.name = 'McpError'; this.code = code; this.status = status; this.setup = !!setup; }
}

/** Open a session, run fn({rpc, listTools}), always close the stream. */
async function withSession(fn, { timeoutMs = 15000 } = {}) {
  const token = await getAccessToken();
  const ctrl = new AbortController();
  const res = await fetch(`${base()}/sse`, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, signal: ctrl.signal });
  if (!res.ok || !res.body) { ctrl.abort(); throw new McpError(`MCP connect failed (HTTP ${res.status})`, { status: res.status }); }

  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = ''; let endpoint = null; let nextId = 1; let closed = false;
  const pending = new Map();
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const ev = buf.slice(0, i); buf = buf.slice(i + 2);
          const type = (ev.match(/^event: (.*)$/m) || [])[1] || 'message';
          const data = (ev.match(/^data: (.*)$/m) || [])[1] || '';
          if (type === 'endpoint') endpoint = data;
          else { try { const j = JSON.parse(data); pending.get(j.id)?.(j); } catch { /* not a JSON-RPC reply */ } }
        }
      }
    } catch { /* aborted */ } finally { closed = true; for (const f of pending.values()) f({ error: { message: 'stream closed' } }); }
  })();

  const deadline = Date.now() + timeoutMs;
  while (!endpoint && !closed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  if (!endpoint) { ctrl.abort(); throw new McpError('MCP session did not announce a message endpoint'); }
  const url = endpoint.startsWith('http') ? endpoint : `${base()}${endpoint}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => { pending.delete(id); reject(new McpError(`MCP ${method} timed out`)); }, Math.max(1000, deadline - Date.now()));
    pending.set(id, (j) => { clearTimeout(t); pending.delete(id); j.error ? reject(new McpError(j.error.message || 'MCP error', { code: j.error.code })) : resolve(j.result); });
    fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) }).catch((e) => { clearTimeout(t); reject(new McpError(e.message)); });
  });

  try {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'haggle-bot', version: '1.0.0' } });
    await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    return await fn({ rpc });
  } finally { ctrl.abort(); await pump.catch(() => {}); }
}

// tools/call results arrive as text content holding JSON like {"ok":false,"code":"PAYPAL_API_SETUP_ERROR","message":"..."}
function parseToolResult(r) {
  const text = (r?.content || []).map((c) => c.text || '').join('');
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (r?.isError || data?.ok === false) throw new McpError(data?.message || text.slice(0, 160) || 'MCP tool error', { code: data?.code, setup: data?.code === 'PAYPAL_API_SETUP_ERROR' });
  return data;
}

async function callTool(name, args = {}, opts) {
  return withSession(async ({ rpc }) => parseToolResult(await rpc('tools/call', { name, arguments: args })), opts);
}

let health = null; // { at, connected, tools, executes, error }
const TTL_OK = 5 * 60 * 1000; const TTL_BAD = 60 * 1000;

/** Does MCP connect, how many tools does it list, and do tools actually execute? */
async function selfTest({ force = false } = {}) {
  if (!enabled()) return { at: Date.now(), connected: false, tools: 0, executes: false, error: 'MCP is off (no sandbox credentials, or PAYPAL_MCP=off)' };
  if (!force && health && Date.now() - health.at < (health.executes ? TTL_OK : TTL_BAD)) return health;
  const h = { at: Date.now(), connected: false, tools: 0, executes: false, error: null };
  try {
    await withSession(async ({ rpc }) => {
      h.connected = true;
      h.tools = ((await rpc('tools/list', {}))?.tools || []).length;
      try { parseToolResult(await rpc('tools/call', { name: 'list_disputes', arguments: { page_size: 1 } })); h.executes = true; }
      catch (e) { h.error = e.code ? `${e.code}: ${e.message}` : e.message; }
    }, { timeoutMs: 20000 });
  } catch (e) { h.error = e.message; }
  health = h;
  return h;
}

const status = () => health;
const _reset = () => { health = null; };
module.exports = { enabled, callTool, selfTest, status, McpError, _reset };
