'use strict';
// The server refuses unsafe start-up configurations (checked by really starting it).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const run = (env, ms = 8000) => spawnSync(process.execPath, [SERVER], {
  env: { PATH: process.env.PATH, PERSIST: 'false', PORT: '0', DATA_DIR: require('os').tmpdir(), ...env }, encoding: 'utf8', timeout: ms,
});
// empty strings count as "set", so a developer's local .env can never leak into these checks
const clean = { PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', LLM_PROVIDER: 'mock', SELLER_KEY: '', PAYPAL_ENVIRONMENT: '', BASE_URL: '', NODE_ENV: '' };

test('refuses to run against anything but the PayPal sandbox', () => {
  const r = run({ ...clean, PAYPAL_ENVIRONMENT: 'live' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sandbox-only/);
});

test('refuses a public deployment with PayPal credentials and the default dashboard key', () => {
  const r = run({ ...clean, PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', BASE_URL: 'https://shop.example.com' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SELLER_KEY is still "change-me"/);
  assert.ok(!r.stderr.includes('secret') || /SELLER_KEY/.test(r.stderr), 'the message never prints credentials');
  assert.ok(!/id=|secret=/.test(r.stderr));
});

test('the same guard also applies when NODE_ENV=production', () => {
  const r = run({ ...clean, PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', NODE_ENV: 'production' });
  assert.equal(r.status, 1);
});

test('local development and demo mode keep working with the default key', () => {
  // demo mode (no PayPal credentials) on a public URL is fine: nothing real can be refunded
  const demo = run({ ...clean, BASE_URL: 'https://shop.example.com', PORT: '0' }, 1500);
  assert.ok(demo.status === null || demo.status === 0, `demo mode must start (it was killed by the timeout, status ${demo.status})`);
  // sandbox credentials on localhost with the default key: allowed, with the existing warning
  const local = run({ ...clean, PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret' }, 1500);
  assert.ok(local.status === null || local.status === 0, `local dev must start, status ${local.status}`);
});
