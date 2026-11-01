'use strict';
// Shared helpers for the browser tests. Playwright is NOT a project dependency: set PW_DIR to a folder
// that has it installed (npm i playwright), e.g. PW_DIR=/tmp/pw node scripts/e2e/run.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.E2E_PORT || '3999';
const BASE = `http://localhost:${PORT}`;
const SELLER_KEY = 'e2e-test-key';
// The React app (served at /app/) is the default UI. E2E_UI=legacy runs the same flows against the original pages.
const UI_APP = process.env.E2E_UI !== 'legacy';
const ui = (route) => (UI_APP ? `${BASE}/app${route === '/' ? '/' : route}` : `${BASE}${route === '/' ? '/' : `${route}.html`}`);
const HOME_PATH = UI_APP ? '/app/' : '/';
const SHOTS = path.join(__dirname, '..', '..', 'e2e-screens');

function playwright() {
  if (!process.env.PW_DIR) throw new Error('Set PW_DIR to a folder where `npm i playwright` was run');
  return require(path.join(process.env.PW_DIR, 'node_modules', 'playwright'));
}

// extraEnv overrides: use { LLM_PROVIDER: '' , GEMINI_API_KEY: undefined } style to inherit .env values.
async function startServer(extraEnv = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'haggle-e2e-'));
  const env = { ...process.env, PORT, BASE_URL: BASE, PERSIST: 'false', DATA_DIR: data, SELLER_KEY, ...(UI_APP ? {} : { UI_BASE: '/' }), ...extraEnv };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'src', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return { child, log, stop: () => child.kill() }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`server did not start:\n${log.join('')}`);
}

async function say(page, text) {
  const sel = '#msgs .msg.seller';
  const before = await page.locator(sel).count();
  await page.fill('#text', text);
  await page.click('#send');
  await page.waitForFunction(([s, n]) => {
    const m = [...document.querySelectorAll(s)];
    const last = m[m.length - 1];
    return m.length > n && last && !last.classList.contains('typing') && last.textContent.trim() !== '…';
  }, [sel, before], { timeout: 60000 });
}

async function openChat(page, productName) {
  await page.goto(ui('/'));
  const card = page.locator('.pcard', { hasText: productName });
  await card.getByRole('button', { name: /Make an offer|Haggle/ }).click();
  await page.waitForSelector('#msgs .msg.seller');
}

// lowball, mid offer, then accept the counter until a deal exists
async function negotiateToDeal(page, productName, lowball, mid) {
  await openChat(page, productName);
  await say(page, `I can pay ${lowball}`);
  await say(page, `How about ${mid}?`);
  for (let i = 0; i < 4 && !(await page.locator('#pay').count()); i++) {
    const accept = page.locator('#dealBox button', { hasText: /^Accept/ });
    if (await accept.count()) {
      const before = await page.locator('#msgs .msg.seller').count();
      await accept.first().dispatchEvent('click');
      await page.waitForFunction((n) => document.querySelectorAll('#msgs .msg.seller').length > n && !document.querySelector('#msgs .msg.seller.typing'), before, { timeout: 60000 });
    } else {
      await say(page, `OK, final offer ${mid}`);
    }
  }
  await page.waitForSelector('#pay', { timeout: 5000 });
}

async function payApprove(page, choice = 'approve') {
  await page.click('#pay');
  await page.waitForURL(/mock-paypal\/approve/);
  await page.click(`button[name=choice][value=${choice}]`);
  // a successful payment lands on the order page; a declined card goes back to the shop
  await page.waitForURL((u) => u.pathname === HOME_PATH || u.pathname.startsWith(`${HOME_PATH}order/`));
  await page.waitForSelector('#notice .notice');
}

async function login(page, key = SELLER_KEY) {
  await page.goto(ui('/seller'));
  await page.fill('#key', key);
  await page.getByRole('button', { name: 'Open' }).click();
}

const MOCK = { PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', LLM_PROVIDER: 'mock', GEMINI_API_KEY: '', GROQ_API_KEY: '' };

module.exports = { ui, HOME_PATH, UI_APP, PORT, BASE, SELLER_KEY, SHOTS, playwright, startServer, MOCK, say, openChat, negotiateToDeal, payApprove, login };
