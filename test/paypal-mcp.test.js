'use strict';
// MCP client + dual-transport tool layer, against a fake local MCP server (SSE transport) and a stubbed PayPal REST API.
process.env.PERSIST = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-id';
process.env.PAYPAL_CLIENT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// ---- fake MCP server: GET /sse opens a stream and announces an endpoint; POST /sse/message answers on the stream
let mode = 'ok';           // 'ok' | 'setup-error' | 'no-auth-check'
let calls = [];
const streams = new Map();
let sidCounter = 0;
const server = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer tok') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"invalid_token"}'); }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/sse') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const sid = String(++sidCounter); // never reused, even after streams close
    streams.set(sid, res);
    res.write(`event: endpoint\ndata: /sse/message?sessionId=${sid}\n\n`);
    req.on('close', () => streams.delete(sid));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/sse/message') {
    let raw = ''; req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(202); res.end('Accepted');
      const msg = JSON.parse(raw);
      if (msg.id == null) return; // notification
      const out = streams.get(url.searchParams.get('sessionId'));
      if (!out) return;
      calls.push(msg.method === 'tools/call' ? `${msg.method}:${msg.params.name}` : msg.method);
      let result;
      if (msg.method === 'initialize') result = { serverInfo: { name: 'Fake PayPal MCP' }, capabilities: {} };
      else if (msg.method === 'tools/list') result = { tools: [{ name: 'get_order' }, { name: 'list_disputes' }, { name: 'get_refund' }] };
      else if (msg.method === 'tools/call') {
        result = mode === 'setup-error'
          ? { content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'PAYPAL_API_SETUP_ERROR', message: 'Unsupported cache mode: default' }) }] }
          : { content: [{ type: 'text', text: JSON.stringify(msg.params.name === 'get_order' ? { id: msg.params.arguments.id, status: 'COMPLETED', via: 'mcp' } : { disputes: [] }) }] };
      }
      out.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`);
    });
    return;
  }
  res.writeHead(404); res.end('Not Found');
});

// ---- stubbed PayPal REST + token; anything for the fake MCP server goes to the real network (loopback)
const realFetch = global.fetch;
let rest = {};
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (u.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 28800 }), { status: 200, headers: { 'content-type': 'application/json' } });
  const hit = Object.entries(rest).find(([k]) => u.includes(k));
  return hit ? new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'content-type': 'application/json', 'paypal-debug-id': 'rest-dbg' } }) : new Response('{"name":"RESOURCE_NOT_FOUND"}', { status: 404, headers: { 'content-type': 'application/json' } });
};

test.before(async () => { await new Promise((r) => server.listen(0, '127.0.0.1', r)); process.env.PAYPAL_MCP_URL = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { global.fetch = realFetch; for (const s of streams.values()) s.end(); server.close(); });
test.beforeEach(() => { mode = 'ok'; calls = []; rest = {}; require('../src/paypal-mcp')._reset(); });

const mcp = () => require('../src/paypal-mcp');
const tools = () => require('../src/paypal-tools');

test('self-test: connects, lists tools, and proves tools really execute', async () => {
  const h = await mcp().selfTest({ force: true });
  assert.equal(h.connected, true);
  assert.equal(h.tools, 3);
  assert.equal(h.executes, true);
  assert.equal(h.error, null);
});

test('self-test tells "connects" apart from "executes" (PayPal returns a setup error on tools/call today)', async () => {
  mode = 'setup-error';
  const h = await mcp().selfTest({ force: true });
  assert.equal(h.connected, true);
  assert.equal(h.tools, 3);
  assert.equal(h.executes, false);
  assert.match(h.error, /PAYPAL_API_SETUP_ERROR: Unsupported cache mode/);
});

test('callTool returns parsed JSON, and a setup error surfaces as a typed error', async () => {
  const r = await mcp().callTool('get_order', { id: 'ORD1' });
  assert.deepEqual(r, { id: 'ORD1', status: 'COMPLETED', via: 'mcp' });
  mode = 'setup-error';
  await assert.rejects(() => mcp().callTool('get_order', { id: 'ORD1' }), (e) => e.name === 'McpError' && e.setup === true && e.code === 'PAYPAL_API_SETUP_ERROR');
});

test('a wrong token is rejected by the server (401 on connect)', async () => {
  const t = require('../src/paypal');
  const real = t.getAccessToken;
  // use a token the fake server does not accept
  const orig = global.fetch;
  global.fetch = async (u, o) => (String(u).endsWith('/v1/oauth2/token') ? new Response(JSON.stringify({ access_token: 'wrong', expires_in: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }) : orig(u, o));
  try {
    await t.getAccessToken(true);
    await assert.rejects(() => mcp().callTool('get_order', { id: 'X' }), /MCP connect failed \(HTTP 401\)/);
  } finally { global.fetch = orig; await real(true); }
});

test('tool layer uses MCP while its execution is proven, and says so', async () => {
  await mcp().selfTest({ force: true });
  rest['/v2/checkout/orders/ORD1'] = { id: 'ORD1', status: 'COMPLETED', purchase_units: [{ amount: { currency_code: 'USD', value: '41.50' } }] };
  const rec = await tools().callTool('get_order', { id: 'ORD1' });
  assert.equal(rec.ok, true);
  assert.equal(rec.transport, 'mcp');
  assert.equal(rec.result.via, 'mcp');
  assert.ok(calls.includes('tools/call:get_order'));
});

test('tool layer falls back to REST when MCP execution fails, and the result names REST', async () => {
  await mcp().selfTest({ force: true });   // healthy at first
  mode = 'setup-error';                    // then PayPal's MCP starts failing
  rest['/v2/checkout/orders/ORD2'] = { id: 'ORD2', status: 'COMPLETED', purchase_units: [{ amount: { currency_code: 'USD', value: '20.00' } }] };
  const rec = await tools().callTool('get_order', { id: 'ORD2' });
  assert.equal(rec.ok, true);
  assert.equal(rec.transport, 'rest');
  assert.equal(rec.result.amountCents, 2000);
  assert.equal(rec.debugId, 'rest-dbg');
  assert.equal(mcp().status().executes, false, 'the failure is remembered, so later calls skip MCP');
  const again = await tools().callTool('get_order', { id: 'ORD2' });
  assert.equal(again.transport, 'rest');
});

test('tools without a verified MCP schema (capture, authorization) always use REST', async () => {
  await mcp().selfTest({ force: true });
  rest['/v2/payments/captures/CAP9'] = { id: 'CAP9', status: 'COMPLETED', amount: { currency_code: 'USD', value: '9.99' } };
  const rec = await tools().callTool('get_capture', { id: 'CAP9' });
  assert.equal(rec.transport, 'rest');
  assert.equal(rec.result.amountCents, 999);
});

test('MCP can be switched off', async () => {
  process.env.PAYPAL_MCP = 'off';
  try {
    assert.equal(mcp().enabled(), false);
    const h = await mcp().selfTest({ force: true });
    assert.equal(h.connected, false);
  } finally { delete process.env.PAYPAL_MCP; }
});
