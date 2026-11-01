'use strict';
// Sessions for the two roles. Signed cookie tokens (HMAC-SHA256, node:crypto only), no server-side session table.
// The seller still proves who they are with SELLER_KEY (header or login form); buyers prove an email with a one-time code.
const crypto = require('crypto');
const config = require('./config');

const SELLER_COOKIE = 'hb_seller', BUYER_COOKIE = 'hb_buyer';
const TTL = { seller: 8 * 3600e3, buyer: 30 * 86400e3 };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const CODE_TTL_MS = 10 * 60e3, CODE_TRIES = 5;

// a stable secret when SESSION_SECRET is set; otherwise a random one per process (sessions end when the server restarts)
const secret = () => config.sessionSecret || (module.exports._ephemeral ||= crypto.randomBytes(32).toString('hex'));
const b64 = (s) => Buffer.from(s).toString('base64url');
const mac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function sign(role, extra = {}, now = Date.now()) {
  const body = b64(JSON.stringify({ r: role, exp: now + TTL[role], ...extra }));
  return `${body}.${mac(body)}`;
}

// returns the payload, or null for anything missing, tampered, expired or of the wrong role
function verify(token, role, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(sig, mac(body))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || p.r !== role || !(p.exp > now)) return null;
  return p;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, { maxAgeMs, secure }) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
}
const clearCookie = (name, secure) => cookie(name, '', { maxAgeMs: 0, secure });

const isSecure = (req) => req.headers['x-forwarded-proto'] === 'https' && config.trustProxy || config.baseUrl.startsWith('https://');

// ---- seller ----
function sellerKeyOk(given) {
  return safeEqual(given || '', config.sellerKey);
}
const sellerFromRequest = (req) => {
  if (sellerKeyOk(req.headers['x-seller-key'])) return { via: 'header' };
  const p = verify(parseCookies(req.headers.cookie)[SELLER_COOKIE], 'seller');
  return p ? { via: 'cookie', exp: p.exp } : null;
};
const sellerCookie = (req) => cookie(SELLER_COOKIE, sign('seller'), { maxAgeMs: TTL.seller, secure: isSecure(req) });

// ---- buyer ----
const buyerFromRequest = (req) => {
  const p = verify(parseCookies(req.headers.cookie)[BUYER_COOKIE], 'buyer');
  return p ? { email: p.email, exp: p.exp } : null;
};
const buyerCookie = (req, email) => cookie(BUYER_COOKIE, sign('buyer', { email }), { maxAgeMs: TTL.buyer, secure: isSecure(req) });

const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => EMAIL_RE.test(e);

// one-time codes live in memory only, and only as an HMAC of email+code
const codes = new Map();
const codeHash = (email, code) => mac(`code:${email}:${code}`);
function startCode(email, now = Date.now()) {
  const prev = codes.get(email);
  if (prev && now - prev.sentAt < 20e3) return { wait: Math.ceil((20e3 - (now - prev.sentAt)) / 1000) };
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  codes.set(email, { hash: codeHash(email, code), exp: now + CODE_TTL_MS, tries: 0, sentAt: now });
  for (const [k, v] of codes) if (v.exp < now) codes.delete(k);
  return { code };
}
function checkCode(email, code, now = Date.now()) {
  const c = codes.get(email);
  if (!c || c.exp < now) { codes.delete(email); return 'expired'; }
  c.tries += 1;
  if (c.tries > CODE_TRIES) { codes.delete(email); return 'locked'; }
  if (!safeEqual(codeHash(email, String(code || '').trim()), c.hash)) return 'wrong';
  codes.delete(email); // single use
  return 'ok';
}

// ---- failed-login throttle (per client address) ----
const fails = new Map();
const FAIL_MAX = 5, FAIL_WINDOW = 10 * 60e3;
function failedRecently(ip, now = Date.now()) {
  const arr = (fails.get(ip) || []).filter((t) => now - t < FAIL_WINDOW);
  fails.set(ip, arr);
  return arr;
}
const lockedOut = (ip, now = Date.now()) => failedRecently(ip, now).length >= FAIL_MAX;
const lockSecondsLeft = (ip, now = Date.now()) => { const a = failedRecently(ip, now); return a.length ? Math.max(1, Math.ceil((a[0] + FAIL_WINDOW - now) / 1000)) : 0; };
const recordFail = (ip, now = Date.now()) => { failedRecently(ip, now).push(now); };
const clearFails = (ip) => fails.delete(ip);

function resetForTests() { codes.clear(); fails.clear(); }

module.exports = {
  SELLER_COOKIE, BUYER_COOKIE, TTL, isSecureRequest: isSecure,
  sign, verify, parseCookies, cookie, clearCookie,
  sellerKeyOk, sellerFromRequest, sellerCookie, buyerFromRequest, buyerCookie,
  normEmail, validEmail, startCode, checkCode,
  lockedOut, lockSecondsLeft, recordFail, clearFails, resetForTests,
};
